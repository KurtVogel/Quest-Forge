/**
 * Portrait bytes live OUTSIDE the record that changes every turn (2026-09-21
 * audit P1). A generated portrait is an immutable ~30–110k-char base64 data
 * URL; portraits were ~96 % of every autosave payload (12 NPC portraits =
 * 1.2 MB, 40 = 3.7 MB) and 0 % of what changes between turns, yet every
 * 2-second flush structured-cloned all of them into `savePayloads`.
 *
 * The split (the DB-v3 payload split's pattern, one layer down): the save
 * payload carries a content-addressed `portraitRef` in place of the inline
 * `portraitUrl`, and the bytes sit once in the `portraits` IndexedDB store.
 * Content addressing makes the blob immutable by construction — a reroll is a
 * NEW key, an older manual slot keeps pointing at its own picture, and a save
 * writes a blob only when its key is absent. Live state never sees a ref:
 * `restorePortraits` runs inside `loadGame`, before LOAD_GAME.
 *
 * Generalized by field name 2026-09-24 (the 09-23 audit's P2): the chronicle
 * chapters' prose takes the same split into a `chronicleChapters` store
 * (`extractChapters` / `restoreChapters` / `collectChapterRefs`, refs listed
 * as `chapterRefs` on the metadata record). The summarized-message prefix is
 * deliberately NOT split — its rows still change (DELETE_MESSAGE flips flags).
 *
 * Pure helpers only — the IndexedDB wiring is persistence.js.
 */

/** Below this a portrait is a plain URL (Pollinations prompt URL) and stays inline. */
export const PORTRAIT_INLINE_MAX = 2000;

// One memo per blob kind (text → key), so a chapter and a portrait can never
// answer each other's key. 300 covers a mature campaign's 40 portraits + 20
// chapters several times over; eviction is oldest-inserted.
const KEY_CACHES = { p: new Map(), c: new Map() };
const KEY_CACHE_MAX = 300;

function fnv1a(text, seed) {
    let hash = seed >>> 0;
    for (let i = 0; i < text.length; i++) {
        hash ^= text.charCodeAt(i);
        hash = Math.imul(hash, 0x01000193) >>> 0;
    }
    return hash.toString(36);
}

/**
 * Content key for a portrait data URL: length + two independently seeded
 * FNV-1a passes (~64 bits with the length — a collision would show the wrong
 * face, so 32 bits alone is not enough). Memoized: a Map keyed by the string
 * costs one cached string hash per later save, not a 90k-char walk.
 */
export function portraitKey(url) {
    return contentKey('p', url);
}

/**
 * Content key for a chronicle chapter's text (2026-09-23 audit P2: the
 * chronicle is the portrait case exactly — chapters are immutable, only the
 * newest is removable, player-facing, never in a prompt — and was 23–25 % of
 * every autosave). Same construction, its own prefix and memo.
 */
export function chapterKey(text) {
    return contentKey('c', text);
}

function contentKey(prefix, text) {
    const cache = KEY_CACHES[prefix];
    const cached = cache.get(text);
    if (cached) return cached;
    const key = `${prefix}-${text.length.toString(36)}-${fnv1a(text, 0x811c9dc5)}-${fnv1a(text, 0x9747b28c)}`;
    if (cache.size >= KEY_CACHE_MAX) cache.delete(cache.keys().next().value);
    cache.set(text, key);
    return key;
}

const isStorablePortrait = (url) =>
    typeof url === 'string' && url.length > PORTRAIT_INLINE_MAX && url.startsWith('data:image/');

/** Any chapter with prose is stored out of line — the text IS the chapter. */
const isStorableChapterText = (text) => typeof text === 'string' && text.length > 0;

const isPlainObject = (value) => value && typeof value === 'object' && !Array.isArray(value);

/**
 * A blob field: `field` on a record holds immutable bytes that live in a
 * content-addressed store; the stored record carries `refField` instead.
 * `onMissing(rest)` shapes the loaded record when the blob is gone — a
 * record for a portrait, `null` (drop) for a chapter.
 */
const PORTRAIT_FIELD = {
    field: 'portraitUrl',
    refField: 'portraitRef',
    isStorable: isStorablePortrait,
    keyOf: portraitKey,
    // The blob is gone (evicted storage, a hand-edited save): the record loads
    // without a picture and without the stamps that describe one — the card
    // simply offers "Portrait" again. A ref never reaches live state.
    onMissing: (rest) => {
        const { portraitProvider: _provider, portraitUpdatedAt: _at, ...bare } = rest;
        return bare;
    },
};

const CHAPTER_FIELD = {
    field: 'text',
    refField: 'chapterRef',
    isStorable: isStorableChapterText,
    keyOf: chapterKey,
    // A chapter without its prose is no chapter (the load heal drops one
    // anyway): the newest one's span re-opens for a fresh "Close chapter",
    // exactly the REMOVE_CHRONICLE_CHAPTER recovery path.
    onMissing: () => null,
};

function extractRecord(record, blobs, spec) {
    if (!isPlainObject(record) || !spec.isStorable(record[spec.field])) return record;
    const key = spec.keyOf(record[spec.field]);
    blobs.set(key, record[spec.field]);
    const { [spec.field]: _bytes, ...rest } = record;
    return { ...rest, [spec.refField]: key };
}

function refOf(record, spec) {
    const ref = isPlainObject(record) ? record[spec.refField] : null;
    return typeof ref === 'string' && ref ? ref : null;
}

function restoreRecord(record, lookup, spec) {
    if (!isPlainObject(record) || !(spec.refField in record)) return record;
    const { [spec.refField]: ref, ...rest } = record;
    const bytes = typeof ref === 'string' ? lookup(ref) : null;
    if (spec.isStorable(bytes)) return { ...rest, [spec.field]: bytes };
    return spec.onMissing(rest);
}

const extractFrom = (record, blobs) => extractRecord(record, blobs, PORTRAIT_FIELD);

/**
 * Swap every inline portrait (the hero's + each roster NPC's) for a ref.
 * Non-mutating: only the touched records are copied. Returns the slimmed
 * payload, the blobs to ensure (`Map<key, dataUrl>`), and the ref list the
 * slot's metadata record carries so the orphan sweep never opens a payload.
 */
export function extractPortraits(payload) {
    const blobs = new Map();
    if (!isPlainObject(payload)) return { state: payload, blobs, refs: [] };
    const character = extractFrom(payload.character, blobs);
    const npcs = Array.isArray(payload.npcs) ? payload.npcs.map(npc => extractFrom(npc, blobs)) : payload.npcs;
    return { state: { ...payload, character, npcs }, blobs, refs: [...blobs.keys()] };
}

/** Every `portraitRef` a stored payload names (hero + roster). */
export function collectPortraitRefs(payload) {
    const refs = new Set();
    if (!isPlainObject(payload)) return [];
    const visit = (record) => {
        const ref = refOf(record, PORTRAIT_FIELD);
        if (ref) refs.add(ref);
    };
    visit(payload.character);
    if (Array.isArray(payload.npcs)) payload.npcs.forEach(visit);
    return [...refs];
}

const restoreInto = (record, lookup) => restoreRecord(record, lookup, PORTRAIT_FIELD);

/** Inverse of `extractPortraits`; `lookup(key)` returns the stored data URL or nothing. */
export function restorePortraits(payload, lookup) {
    if (!isPlainObject(payload)) return payload;
    const character = restoreInto(payload.character, lookup);
    const npcs = Array.isArray(payload.npcs) ? payload.npcs.map(npc => restoreInto(npc, lookup)) : payload.npcs;
    return { ...payload, character, npcs };
}

/**
 * Swap every chronicle chapter's prose for a ref (the portrait split by field
 * name). Same contract as `extractPortraits`: non-mutating, returns the
 * slimmed payload, the blobs to ensure (`Map<key, text>`), and the ref list
 * the slot's metadata record carries as `chapterRefs`. The chapter's own
 * metadata (id, title, from/toIndex, createdAt) stays in the payload, so the
 * stored record still says what it is without its prose.
 */
export function extractChapters(payload) {
    const blobs = new Map();
    if (!isPlainObject(payload) || !Array.isArray(payload.chronicle)) return { state: payload, blobs, refs: [] };
    const chronicle = payload.chronicle.map(chapter => extractRecord(chapter, blobs, CHAPTER_FIELD));
    return { state: { ...payload, chronicle }, blobs, refs: [...blobs.keys()] };
}

/** Every `chapterRef` a stored payload names. */
export function collectChapterRefs(payload) {
    if (!isPlainObject(payload) || !Array.isArray(payload.chronicle)) return [];
    const refs = new Set();
    for (const chapter of payload.chronicle) {
        const ref = refOf(chapter, CHAPTER_FIELD);
        if (ref) refs.add(ref);
    }
    return [...refs];
}

/**
 * Inverse of `extractChapters`; `lookup(key)` returns the stored text or
 * nothing. A chapter whose blob is gone is dropped (no prose, no chapter);
 * a chapter that still carries inline text (pre-split payload) is untouched.
 */
export function restoreChapters(payload, lookup) {
    if (!isPlainObject(payload) || !Array.isArray(payload.chronicle)) return payload;
    const chronicle = payload.chronicle
        .map(chapter => restoreRecord(chapter, lookup, CHAPTER_FIELD))
        .filter(chapter => chapter !== null);
    return { ...payload, chronicle };
}
