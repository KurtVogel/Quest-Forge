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
 * Pure helpers only — the IndexedDB wiring is persistence.js.
 */

/** Below this a portrait is a plain URL (Pollinations prompt URL) and stays inline. */
export const PORTRAIT_INLINE_MAX = 2000;

const KEY_CACHE = new Map();
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
    const cached = KEY_CACHE.get(url);
    if (cached) return cached;
    const key = `p-${url.length.toString(36)}-${fnv1a(url, 0x811c9dc5)}-${fnv1a(url, 0x9747b28c)}`;
    if (KEY_CACHE.size >= KEY_CACHE_MAX) KEY_CACHE.delete(KEY_CACHE.keys().next().value);
    KEY_CACHE.set(url, key);
    return key;
}

const isStorablePortrait = (url) =>
    typeof url === 'string' && url.length > PORTRAIT_INLINE_MAX && url.startsWith('data:image/');

const isPlainObject = (value) => value && typeof value === 'object' && !Array.isArray(value);

function extractFrom(record, blobs) {
    if (!isPlainObject(record) || !isStorablePortrait(record.portraitUrl)) return record;
    const key = portraitKey(record.portraitUrl);
    blobs.set(key, record.portraitUrl);
    const { portraitUrl: _url, ...rest } = record;
    return { ...rest, portraitRef: key };
}

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
        if (isPlainObject(record) && typeof record.portraitRef === 'string' && record.portraitRef) refs.add(record.portraitRef);
    };
    visit(payload.character);
    if (Array.isArray(payload.npcs)) payload.npcs.forEach(visit);
    return [...refs];
}

function restoreInto(record, lookup) {
    if (!isPlainObject(record) || !('portraitRef' in record)) return record;
    const { portraitRef, ...rest } = record;
    const url = typeof portraitRef === 'string' ? lookup(portraitRef) : null;
    if (isStorablePortrait(url)) return { ...rest, portraitUrl: url };
    // The blob is gone (evicted storage, a hand-edited save): the record loads
    // without a picture and without the stamps that describe one — the card
    // simply offers "Portrait" again. A ref never reaches live state.
    const { portraitProvider: _provider, portraitUpdatedAt: _at, ...bare } = rest;
    return bare;
}

/** Inverse of `extractPortraits`; `lookup(key)` returns the stored data URL or nothing. */
export function restorePortraits(payload, lookup) {
    if (!isPlainObject(payload)) return payload;
    const character = restoreInto(payload.character, lookup);
    const npcs = Array.isArray(payload.npcs) ? payload.npcs.map(npc => restoreInto(npc, lookup)) : payload.npcs;
    return { ...payload, character, npcs };
}

/**
 * Cloud saves keep portraits INLINE (another device has no local blob store),
 * so they get a byte budget instead (2026-09-21 P1: 100 portraits alone
 * exceeded the 9 MiB cloud ceiling and the whole campaign was refused). Drops
 * NPC portraits oldest-first — never the hero's — until the payload fits.
 * base64 is ASCII, so a URL's char count IS its byte count.
 * Returns `{ state, dropped }`; `state` is the input when nothing had to go.
 */
export function fitPortraitsToBudget(payload, byteLength, byteLimit) {
    if (!isPlainObject(payload) || !Array.isArray(payload.npcs) || byteLength <= byteLimit) {
        return { state: payload, dropped: 0 };
    }
    const candidates = payload.npcs
        .map((npc, index) => ({ index, npc }))
        .filter(({ npc }) => isPlainObject(npc) && isStorablePortrait(npc.portraitUrl))
        .sort((a, b) => (Number(a.npc.portraitUpdatedAt) || 0) - (Number(b.npc.portraitUpdatedAt) || 0));
    const drop = new Set();
    let remaining = byteLength;
    for (const { index, npc } of candidates) {
        if (remaining <= byteLimit) break;
        remaining -= npc.portraitUrl.length;
        drop.add(index);
    }
    if (drop.size === 0) return { state: payload, dropped: 0 };
    const npcs = payload.npcs.map((npc, index) => {
        if (!drop.has(index)) return npc;
        const { portraitUrl: _url, portraitProvider: _provider, portraitUpdatedAt: _at, ...rest } = npc;
        return rest;
    });
    return { state: { ...payload, npcs }, dropped: drop.size };
}
