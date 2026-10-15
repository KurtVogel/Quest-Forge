import { containment, overlapCount, tokenSet as sharedTokenSet } from './textMatch.js';
import { conversationalAgeSince } from './replayLedger.js';
import { clampNumber, textOr as cleanText, toFlag } from './text.js';

const ALLOWED_TYPES = new Set([
    'callback',
    'promise',
    'wound',
    'relationship',
    'mystery',
    'playerCanon',
    'foreshadow',
    'npcAgenda',
]);

const ALLOWED_STATUS = new Set(['active', 'resolved', 'dormant']);
const MAX_TEXT_LENGTH = 260;
const MAX_SUBJECT_LENGTH = 80;
const MAX_TAGS = 8;
const MAX_LINKED_NPCS = 6;
const DEFAULT_CARD_LIMIT = 5;
/**
 * Callback cooldown and recency are measured in CONVERSATIONAL distance
 * (2026-09-06 audit — the last wall-clock windows in the memory layer: eight
 * minutes was one turn in a slow session and three in a fast one). A card the
 * DM just paid off stays out of curation for CALLBACK_COOLDOWN_MESSAGES
 * conversational messages (~4 turns); the recency bonus decays from 3 to 0
 * over 3 × RECENCY_DECAY_MESSAGES (~6 journal cadences). Cards born before
 * the message stamps existed fall back to their wall-clock stamps.
 */
export const CALLBACK_COOLDOWN_MESSAGES = 8;
const RECENCY_DECAY_MESSAGES = 20;
/**
 * A callback is what the window FORGOT (WOW 2026-10-14, memory-callbacks):
 * a card seen inside the DM's own message window is already on the page, so
 * the block offers only cards at least this many conversational messages old
 * — the DM window's row count (turnOrchestrator MESSAGE_WINDOW, pinned equal
 * in the tests) — and the old "recency bonus" is inverted into an AGE bonus
 * past it. On the 09-30 proof run a fresh card was paid the largest term
 * after presence and the block rendered on 6 of 7 return turns with nothing
 * the DM could not already see.
 */
export const CALLBACK_MIN_AGE = 20;
/** The landed-callback judge: this share of a curated card's meaning tokens in the DM's reply. */
export const CALLBACK_PAYOFF_CONTAINMENT = 0.5;
const LEGACY_CALLBACK_COOLDOWN_MS = 1000 * 60 * 8;
const LEGACY_RECENCY_DECAY_HOURS = 24;
/**
 * Type identity folds case and punctuation before the whitelist (2026-09-17
 * audit P2): `Promise` / `PROMISE` / `player canon` / `npc-agenda` all used to
 * demote to `callback` — losing the promise/mystery/foreshadow scoring bonus
 * and the dormancy exemption — because the alias map was consulted lowercase
 * while the allowed set was not. `foldTypeKey` reduces any spelling to its
 * alphanumeric lowercase spine ("player_canon" → "playercanon"), which is the
 * one key the canonical names and every alias share.
 */
function foldTypeKey(value) {
    return String(value || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}
const TYPE_BY_FOLDED_KEY = new Map([...ALLOWED_TYPES].map(type => [foldTypeKey(type), type]));

/**
 * String-or-drop (2026-09-17 audit P2, the 09-15/09-16 rule): an object
 * `text` / `subject` / `id` used to mint a card whose prompt line read
 * "subject: [object Object]" into DRAMATIC CALLBACKS and the RAG seed — and
 * an object `id` became the string "[object Object]", so the next such card
 * MERGED into it by id. A finite number still reads as its digits (a numeric
 * id from the DM is harmless); everything else is no text. The rule lives in
 * engine/text.js; `cleanText` here is its `(value, fallback)` form.
 */

/**
 * A list field read from a lane. A SCALAR string is a one-item list (2026-09-17
 * audit P1, the 09-15 `conditions: "prone"` parity rule): the Scribe's
 * `"knownBy": "the hero"` used to read as NO knowers — the secret rendered as
 * common knowledge, reached every NPC, and travelled as hearsay because
 * `witnessed` survived an empty knowers list. Elements are clamped to
 * MAX_SUBJECT_LENGTH (same audit P2): one 100k-character knower name rode
 * the callback block, the save, and the RAG seed whole.
 */
function normalizeTextArray(value, max = MAX_TAGS) {
    const source = Array.isArray(value) ? value : (typeof value === 'string' ? [value] : []);
    return [...new Set(source.map(v => cleanText(v).slice(0, MAX_SUBJECT_LENGTH)).filter(Boolean))]
        .slice(0, max);
}

/**
 * A finite WALL-CLOCK stamp, or the fallback (junk used to persist and
 * NaN-compare in dormancy). The wall-clock trio is the legacy fallback for
 * cards born before the message stamps (2026-10-12: every reader prefers the
 * conversational clock) — named apart from the message-stamp typers.
 */
function wallClockStamp(value, fallback) {
    return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : fallback;
}

/**
 * A reducer-stamped conversational message index: finite, non-negative, and —
 * when the caller supplies the live transcript length — never in the future
 * (2026-09-17 audit P2): LOAD passed `lastUsedMessage: 1e9` through, so the
 * cooldown counted 0 and the promise scored 0 for the campaign's life.
 */
function messageStamp(value, fallback, maxMessageCount) {
    const n = typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.round(value)) : undefined;
    if (n === undefined) return fallback;
    return Number.isFinite(maxMessageCount) ? Math.min(n, Math.max(0, maxMessageCount)) : n;
}

const STORY_STOP_WORDS = new Set([
    'the', 'and', 'that', 'with', 'from', 'this', 'they', 'your', 'you', 'for',
    'into', 'about', 'what', 'when', 'where', 'there', 'their', 'have', 'has',
    'had', 'was', 'were', 'are', 'but', 'not', 'all', 'his', 'her', 'she', 'him',
]);

// Shared Unicode tokenizer (textMatch.js): the old local `[a-z0-9']{3,}`
// matcher silently dropped every non-ASCII token, so cards about "Virtapää"
// could never dedupe or score by name.
function tokenSet(text) {
    return sharedTokenSet(text, { stopWords: STORY_STOP_WORDS, minLength: 3 });
}

const overlapScore = overlapCount;

/** tokenSet with possessives folded ("jack's" → "jack") so subject phrasings
 * like "Jack's promise" and "Jack, the promise" compare as the same entity. */
function meaningTokens(text) {
    return sharedTokenSet(text, { stopWords: STORY_STOP_WORDS, minLength: 3, foldPossessives: true });
}

/** Fraction of the SMALLER set's tokens found in the larger one (0..1). */
const tokenContainment = containment;

/** The Scribe re-reports the same durable beat with fresh framing each turn
 * ("Jack's promise to Oren…" / "Jack's broken promise to Oren, now amidst…"),
 * defeating the exact-subject/exact-text dedupe and flooding the card pool.
 * Same-type cards whose text token sets largely contain each other — or whose
 * subjects name the same entities with substantial text overlap — are the same
 * card being restated, not new material. */
export function isNearDuplicateStoryCard(a = {}, b = {}) {
    if (!a || !b || a.type !== b.type) return false;
    const textA = meaningTokens(a.text);
    const textB = meaningTokens(b.text);
    const textScore = tokenContainment(textA, textB);
    if (Math.min(textA.size, textB.size) >= 3 && textScore >= 0.75) return true;
    const subjectA = meaningTokens(a.subject);
    const subjectB = meaningTokens(b.subject);
    if (!subjectA.size || !subjectB.size) return false;
    return tokenContainment(subjectA, subjectB) >= 0.8 && textScore >= 0.5;
}

/** On a near-duplicate merge the newest framing usually wins, but a bare
 * fragment must never clobber a strictly richer record of the same beat. */
export function pickMergedCardText(existingText = '', incomingText = '') {
    if (!existingText) return incomingText;
    if (!incomingText) return existingText;
    const existing = meaningTokens(existingText);
    const incoming = meaningTokens(incomingText);
    const fragment = incoming.size < existing.size
        && overlapScore(incoming, existing) / (incoming.size || 1) >= 0.8;
    return fragment ? existingText : incomingText;
}

/** "public"/"everyone" in a knowers list means the info is NOT secret. */
const PUBLIC_KNOWER_RE = /^(public|everyone|everybody|all|common knowledge)$/i;

/**
 * Epistemics boundary (DECISIONS.md 2026-08-05 ×2): a non-empty knownBy list
 * marks information as PRIVATE to exactly those people. Empty/absent = common
 * knowledge. Any "public"-style entry clears the whole list — the extractor
 * saying "everyone knows" must never render as a secret known to "everyone".
 */
export function normalizeKnownBy(value) {
    const list = normalizeTextArray(value, MAX_LINKED_NPCS);
    if (list.some(name => PUBLIC_KNOWER_RE.test(name))) return [];
    return list;
}

/** "[SECRET — known only to: X, Y] " prefix, or '' for common knowledge. */
export function formatSecrecyTag(knownBy) {
    // Same reader as the store (scalar = one knower, elements clamped): a
    // pre-fix save's raw list must not print a 100k name into the prompt.
    const list = normalizeTextArray(knownBy, MAX_LINKED_NPCS);
    return list.length > 0 ? `[SECRET — known only to: ${list.join(', ')}] ` : '';
}

/**
 * The engine's own stamps, which a LANE payload may never carry (2026-09-16
 * audit P2): a salience-5 promise born with `lastUsedMessage: 1e9` scored 0
 * for the campaign's life, and `firstSeenMessage: 0` aged a witnessed deed
 * into ancient legend for hearsay. The reducer strips these from an incoming
 * card before normalizing; the load path and the engine's own merges keep
 * passing them through normalizeStoryMemoryCard as before.
 */
export const STORY_MEMORY_ENGINE_STAMPS = Object.freeze([
    'firstSeenMessage', 'lastSeenMessage', 'lastUsedMessage', 'usedCount',
    'firstSeenAt', 'first_seen_at', 'lastSeenAt', 'last_seen_at', 'lastUsedAt', 'last_used_at',
    // Source-stamped retraction (2026-09-30): the reducer stamps the DM
    // message a card was read from and the message count it was retracted at.
    'sourceMessage', 'retractedAtMessage',
]);

export function stripStoryMemoryEngineStamps(card) {
    if (!card || typeof card !== 'object') return card;
    const out = { ...card };
    for (const key of STORY_MEMORY_ENGINE_STAMPS) delete out[key];
    return out;
}

/** Only a plain object is a card: `null`, arrays, and scalars normalize to null. */
function isCardShape(card) {
    return !!card && typeof card === 'object' && !Array.isArray(card);
}

/**
 * @param {object} card - a lane or stored card
 * @param {object|null} [existing] - the stored card a merge lands on
 * @param {{ maxMessageCount?: number }} [options] - the live transcript length;
 *   LOAD_GAME passes it so the three message stamps clamp to "now" (the
 *   09-14 `openedAtMessage` / 09-10 rollHistory pattern). An OPTIONS OBJECT,
 *   never positional — `.map` would pass the index.
 */
export function normalizeStoryMemoryCard(card = {}, existing = null, { maxMessageCount } = {}) {
    // A `null` element used to walk into `card.text` and throw — out of
    // validateSaveState (the campaign un-loadable) and out of the middle of
    // ADD_STORY_MEMORY_CARDS (every card and dispatch queued behind it lost
    // for the turn) — 2026-09-17 audit P1; the 09-08 fronts null-entry class.
    if (!isCardShape(card)) return null;
    const base = isCardShape(existing) ? existing : null;
    const now = Date.now();
    const text = cleanText(card.text || card.memory || card.note, base?.text || '').slice(0, MAX_TEXT_LENGTH);
    if (!text) return null;

    const rawType = cleanText(card.type, base?.type || 'callback');
    const type = TYPE_BY_FOLDED_KEY.get(foldTypeKey(rawType)) || 'callback';
    const rawStatus = cleanText(card.status, base?.status || 'active');
    const status = ALLOWED_STATUS.has(rawStatus) ? rawStatus : 'active';
    // Conditional keys: an update that omits the field must not wipe the
    // stored value through the {...existing, ...card} merge spread.
    const knownBy = normalizeKnownBy(card.knownBy ?? card.known_by ?? base?.knownBy);
    // witnessed and knownBy are mutually exclusive; when the extractor emits
    // both (2026-08-06 live playtest: a public accusation carried
    // knownBy ["the hero"]), secrecy wins — a secret must never travel as
    // hearsay, while an under-traveled public deed is only lost color.
    // Read through toFlag (2026-09-17 P2): `witnessed: "false"` was `true`.
    const witnessed = knownBy.length === 0
        && (card.witnessed !== undefined ? toFlag(card.witnessed) : toFlag(base?.witnessed));
    // Reducer-stamped at card birth; ages witnessed deeds for regional hearsay.
    const firstSeenMessage = messageStamp(card.firstSeenMessage, messageStamp(base?.firstSeenMessage, undefined, maxMessageCount), maxMessageCount);
    // Conversational stamps for the curation windows (reducer-owned like
    // firstSeenMessage): the message count when the card was last merged and
    // when the DM last paid it off.
    const lastSeenMessage = messageStamp(card.lastSeenMessage, messageStamp(base?.lastSeenMessage, undefined, maxMessageCount), maxMessageCount);
    const lastUsedMessage = messageStamp(card.lastUsedMessage, messageStamp(base?.lastUsedMessage, undefined, maxMessageCount), maxMessageCount);
    // Retraction stamps (2026-09-30): the DM message this card came from, and
    // when it was retracted with that message — engine-owned, string / clamped.
    const sourceMessage = typeof card.sourceMessage === 'string' && card.sourceMessage
        ? card.sourceMessage.slice(0, 80)
        : (typeof base?.sourceMessage === 'string' && base.sourceMessage ? base.sourceMessage.slice(0, 80) : null);
    const retractedAtMessage = messageStamp(card.retractedAtMessage, messageStamp(base?.retractedAtMessage, undefined, maxMessageCount), maxMessageCount);
    const usedCount = Math.max(0, Math.trunc(Number(card.usedCount ?? base?.usedCount) || 0));

    return {
        ...(knownBy.length > 0 && { knownBy }),
        ...(sourceMessage && { sourceMessage }),
        ...(Number.isFinite(retractedAtMessage) && { retractedAtMessage }),
        ...(witnessed && { witnessed: true }),
        ...(Number.isFinite(firstSeenMessage) && { firstSeenMessage }),
        ...(Number.isFinite(lastSeenMessage) && { lastSeenMessage }),
        ...(Number.isFinite(lastUsedMessage) && { lastUsedMessage }),
        // How many times a callback LANDED (WOW 2026-10-14): the DM's own
        // `used` and the engine's payoff judge both count; engine-owned.
        ...(usedCount > 0 && { usedCount }),
        id: cleanText(card.id, base?.id || `mem-${now}-${Math.random().toString(36).slice(2, 7)}`).slice(0, MAX_SUBJECT_LENGTH),
        type,
        text,
        subject: cleanText(card.subject, base?.subject || '').slice(0, MAX_SUBJECT_LENGTH),
        tags: normalizeTextArray(card.tags, MAX_TAGS),
        salience: clampNumber(card.salience, 1, 5, base?.salience ?? 3),
        emotionalCharge: clampNumber(card.emotionalCharge ?? card.emotional_charge, 0, 5, base?.emotionalCharge ?? 2),
        status,
        // Wall-clock trio typed finite (2026-09-17 P2): `firstSeenAt: "junk"`
        // persisted and NaN-compared in applyStoryMemoryDormancy, so a
        // salience-2 card went dormant on the very next cadence.
        firstSeenAt: wallClockStamp(card.firstSeenAt, wallClockStamp(card.first_seen_at, wallClockStamp(base?.firstSeenAt, now))),
        lastSeenAt: wallClockStamp(card.lastSeenAt, wallClockStamp(card.last_seen_at, now)),
        lastUsedAt: wallClockStamp(card.lastUsedAt, wallClockStamp(card.last_used_at, wallClockStamp(base?.lastUsedAt, null))),
        source: cleanText(card.source, base?.source || 'scribe').slice(0, 40),
        linkedNpcNames: normalizeTextArray(card.linkedNpcNames || card.linked_npc_names, MAX_LINKED_NPCS),
        location: cleanText(card.location, base?.location || '').slice(0, MAX_SUBJECT_LENGTH),
    };
}

export function normalizeStoryMemoryUpdate(update = {}) {
    if (!update || typeof update !== 'object') return null;
    const id = cleanText(update.id || update.memoryId || update.memory_id);
    const subject = cleanText(update.subject);
    const text = cleanText(update.text);
    if (!id && !subject && !text) return null;

    const out = {};
    if (id) out.id = id;
    if (subject) out.subject = subject.slice(0, MAX_SUBJECT_LENGTH);
    if (text) out.text = text.slice(0, MAX_TEXT_LENGTH);
    if (update.status && ALLOWED_STATUS.has(update.status)) out.status = update.status;
    // The engine owns the clock: `used` is a FLAG the reducer turns into the
    // conversational `lastUsedMessage` (and its wall-clock twin). A raw
    // lastUsedAt pass-through was never part of the DM contract ({id, used})
    // and would let a hallucinated timestamp pin a card outside — or forever
    // inside — scoreStoryMemory's callback-cooldown gate (2026-07-14 audit);
    // read through toFlag since 2026-10-12 (`used: "false"` was a use).
    if (toFlag(update.used) || toFlag(update.markUsed) || toFlag(update.mark_used)) out.used = true;
    if (update.salience !== undefined) out.salience = clampNumber(update.salience, 1, 5, 3);
    if (update.emotionalCharge !== undefined || update.emotional_charge !== undefined) {
        out.emotionalCharge = clampNumber(update.emotionalCharge ?? update.emotional_charge, 0, 5, 2);
    }
    // Same scalar-is-a-list reading as the card lane (2026-09-17 P1).
    const isListField = value => Array.isArray(value) || typeof value === 'string';
    if (isListField(update.tags)) out.tags = normalizeTextArray(update.tags, MAX_TAGS);
    if (isListField(update.linkedNpcNames) || isListField(update.linked_npc_names)) {
        out.linkedNpcNames = normalizeTextArray(update.linkedNpcNames || update.linked_npc_names, MAX_LINKED_NPCS);
    }
    if (update.location) out.location = cleanText(update.location).slice(0, MAX_SUBJECT_LENGTH);
    return out;
}

export function findStoryMemoryMatch(memories = [], card = {}) {
    const subject = cleanText(card.subject).toLowerCase();
    const text = cleanText(card.text).toLowerCase();
    return memories.findIndex(m => {
        if (card.id && m.id === card.id) return true;
        if (subject && m.subject?.toLowerCase() === subject && m.type === card.type) return true;
        if (text && m.text?.toLowerCase() === text) return true;
        return isNearDuplicateStoryCard(m, card);
    });
}

/**
 * A card's BIRTH stamps — the one composer for every lane that adds a card
 * (ADD_STORY_MEMORY_CARD for the Scribe / DM / engine cards, the roster
 * promotion — 2026-10-12 story-memory Lap-4 P2: the promotion stamped
 * `firstSeenMessage` only, so a fresh promotion's recency scored through the
 * legacy wall-clock fallback). `firstSeenMessage` ages a witnessed deed for
 * hearsay, `lastSeenMessage` feeds the curation recency window, and
 * `sourceMessage` (M0, 2026-09-30) is the DM message the card was read from,
 * so removing that message retracts the card. A lane without a single source
 * message (the cadence reflection, which reads a journal batch; the roster
 * promotion, a snapshot of the dossier) passes none and is never retracted.
 */
export function bornStoryMemoryCard(card, messageCount, { sourceMessage } = {}) {
    if (!card) return null;
    const source = typeof sourceMessage === 'string' && sourceMessage ? sourceMessage : null;
    return { ...card, firstSeenMessage: messageCount, lastSeenMessage: messageCount, ...(source && { sourceMessage: source }) };
}

/**
 * Newest-first order for cards: the conversational stamp when both carry one,
 * the wall-clock stamp as the legacy fallback (2026-10-12: the Scribe's KNOWN
 * STORY CARDS and the promotion-twin heal sorted by wall-clock only).
 */
export function compareCardRecency(a, b) {
    const am = a?.lastSeenMessage;
    const bm = b?.lastSeenMessage;
    if (Number.isFinite(am) && Number.isFinite(bm) && am !== bm) return bm - am;
    return (Number(b?.lastSeenAt) || 0) - (Number(a?.lastSeenAt) || 0);
}

/**
 * @param {object} card - a stored (normalized) story card
 * @param {object} [scene]
 * @param {string} [scene.query] - the player's line + scene context
 * @param {string} [scene.location] - the hero's current location
 * @param {object[]} [scene.npcs] - the NPCs PRESENT IN THE SCENE (2026-09-06
 *   audit) — never the whole roster: the linked-NPC bonus asks "is this
 *   card's person here?", and only their NAMES join the query tokens.
 *   Roster-wide dispositions/notes used to make an absent smuggler's card
 *   outscore the person the hero is talking to.
 * @param {object[]} [scene.messages] - the live transcript, for conversational
 *   cooldown/recency (falls back to raw index distance, then to wall-clock).
 * @param {number} [scene.messageCount] - transcript length when omitted.
 * @param {number} [scene.now] - wall-clock, legacy-card fallback only.
 */
export function scoreStoryMemory(card, { query = '', location = '', npcs = [], messages = null, messageCount, now = Date.now() } = {}) {
    if (!card || (card.status || 'active') !== 'active') return 0;
    const usedAge = conversationalAgeSince(card.lastUsedMessage, { messages, messageCount });
    if (usedAge !== null) {
        if (usedAge < CALLBACK_COOLDOWN_MESSAGES) return 0;
    } else if (card.lastUsedAt && now - card.lastUsedAt < LEGACY_CALLBACK_COOLDOWN_MS) {
        return 0;
    }

    const queryTokens = tokenSet([
        query,
        location,
        ...(npcs || []).map(n => String(n?.name || '')),
    ].filter(Boolean).join(' '));
    // Exported entry point: guard field types rather than trust every caller
    // to pass a normalized card (all stored cards are, but the function isn't).
    const cardTags = Array.isArray(card.tags) ? card.tags : [];
    const cardNpcNames = Array.isArray(card.linkedNpcNames) ? card.linkedNpcNames : [];
    const cardTokens = tokenSet([
        card.text,
        card.subject,
        card.location,
        ...cardTags,
        ...cardNpcNames,
    ].filter(Boolean).join(' '));

    let score = card.salience * 2 + card.emotionalCharge;
    score += overlapScore(cardTokens, queryTokens) * 3;

    if (location && card.location && card.location.toLowerCase() === String(location).toLowerCase()) {
        score += 4;
    }

    const npcNames = new Set((npcs || []).map(n => String(n.name || '').toLowerCase()).filter(Boolean));
    for (const name of cardNpcNames) {
        if (npcNames.has(String(name).toLowerCase())) score += 5;
    }

    const seenAge = conversationalAgeSince(card.lastSeenMessage, { messages, messageCount });
    if (seenAge !== null) {
        // Inside the window the DM already has it; past the window the older
        // the better, up to +3 (the inverted recency term, 2026-10-14).
        if (seenAge < CALLBACK_MIN_AGE) return 0;
        score += Math.min(3, (seenAge - CALLBACK_MIN_AGE) / RECENCY_DECAY_MESSAGES);
    } else if (card.lastSeenAt) {
        const ageHours = Math.max(0, (now - card.lastSeenAt) / (1000 * 60 * 60));
        score += Math.max(0, 3 - ageHours / LEGACY_RECENCY_DECAY_HOURS);
    }

    if (card.type === 'promise' || card.type === 'mystery' || card.type === 'foreshadow') score += 2;
    if (card.type === 'playerCanon') score += 1;

    return score;
}

/** How many journal cadences of silence age a low-salience card out. */
export const DORMANCY_JOURNAL_CYCLES = 3;
/** Long-payoff card types that never decay — their moment may be far away. */
const DORMANCY_EXEMPT_TYPES = new Set(['promise', 'playerCanon']);
/**
 * An ENGINE-minted `wound` card (END_COMBAT, WOW 2026-09-27) is salience 4 and
 * would otherwise never age: a wound heals unless a later scene keeps touching
 * it, so it goes dormant after this many untouched cadences whatever its
 * salience. A Scribe-minted wound (source `scribe`) keeps the general rule.
 */
export const WOUND_DORMANCY_JOURNAL_CYCLES = 6;
function isEngineWound(card) {
    return card?.type === 'wound' && card?.source === 'engine';
}

/**
 * Journal-cadence age-out (IDEAS.md 2026-07-14; 2026-08-06 audit — the pool
 * only ever grew): active salience-1/2 cards untouched across the last
 * DORMANCY_JOURNAL_CYCLES journal entries decay to `dormant` — still in saves,
 * skipped by curation and the RAG seed, and revived automatically if the
 * Scribe re-reports the beat (the ADD_STORY_MEMORY_CARD merge restores
 * `active` — for DORMANT cards only; `resolved` is terminal there, 2026-09-06).
 * "Untouched" compares the card's last birth / merge / use stamp against the
 * journal entry N cycles back, on the CONVERSATIONAL clock since 2026-10-12
 * (story-memory Lap-4 P2: the cutoff used to be the entry's wall-clock
 * `timestamp` while cooldown and recency read message stamps — two clocks on
 * one card): the entry's `messageRange` end against the card's message
 * stamps. A legacy card (no message stamp) or a legacy entry (no range) falls
 * back to the wall-clock pair.
 */
function journalCutoff(entry) {
    const range = entry?.messageRange;
    const message = Array.isArray(range) && Number.isFinite(range[1]) ? range[1] : null;
    const at = Number.isFinite(entry?.timestamp) ? entry.timestamp : null;
    return message === null && at === null ? null : { message, at };
}

function lastTouchMessage(card) {
    const stamps = [card.lastSeenMessage, card.lastUsedMessage, card.firstSeenMessage].filter(Number.isFinite);
    return stamps.length > 0 ? Math.max(...stamps) : null;
}

/** True when the card was touched at or after the cutoff — null when no clock compares. */
function touchedSince(card, cutoff) {
    const touch = lastTouchMessage(card);
    if (touch !== null && cutoff.message !== null) return touch >= cutoff.message;
    if (cutoff.at === null) return null;
    // Belt under the load typing: a non-finite stamp reads as "never", not NaN.
    const lastTouch = Math.max(wallClockStamp(card.lastSeenAt, 0), wallClockStamp(card.lastUsedAt, 0), wallClockStamp(card.firstSeenAt, 0));
    return lastTouch >= cutoff.at;
}

export function applyStoryMemoryDormancy(cards = [], journal = []) {
    const list = Array.isArray(cards) ? cards : [];
    const entries = Array.isArray(journal) ? journal : [];
    if (entries.length < DORMANCY_JOURNAL_CYCLES) return list;
    const cutoff = journalCutoff(entries[entries.length - DORMANCY_JOURNAL_CYCLES]);
    if (!cutoff) return list;
    const woundCutoff = entries.length >= WOUND_DORMANCY_JOURNAL_CYCLES
        ? journalCutoff(entries[entries.length - WOUND_DORMANCY_JOURNAL_CYCLES])
        : null;

    let changed = false;
    const next = list.map(card => {
        if (!card || (card.status || 'active') !== 'active') return card;
        const engineWound = isEngineWound(card);
        if (engineWound && !woundCutoff) return card;
        if (!engineWound && ((card.salience || 0) > 2 || DORMANCY_EXEMPT_TYPES.has(card.type))) return card;
        if (touchedSince(card, engineWound ? woundCutoff : cutoff) !== false) return card;
        changed = true;
        return { ...card, status: 'dormant' };
    });
    return changed ? next : list;
}

/**
 * The curated cards for the block, each carrying its curation `score`, its
 * `ageTurns` (how long since the record last touched it, in turns) and its
 * `speakers` — the card's linked people who are IN the scene, the ones who
 * could say it (WOW 2026-10-14).
 */
export function curateStoryMemory({ memories = [], query = '', location = '', npcs = [], messages = null, messageCount, now = Date.now(), limit = DEFAULT_CARD_LIMIT } = {}) {
    const present = new Set((npcs || []).map(n => String(n?.name || '').toLowerCase()).filter(Boolean));
    return (memories || [])
        .map(card => ({ card, score: scoreStoryMemory(card, { query, location, npcs, messages, messageCount, now }) }))
        .filter(item => item.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, limit)
        .map(item => {
            const seenAge = conversationalAgeSince(item.card.lastSeenMessage, { messages, messageCount });
            const speakers = (Array.isArray(item.card.linkedNpcNames) ? item.card.linkedNpcNames : [])
                .filter(name => present.has(String(name).toLowerCase()));
            return {
                ...item.card,
                score: item.score,
                ageTurns: seenAge === null ? null : Math.ceil(seenAge / 2),
                speakers,
            };
        });
}

/**
 * Did the DM's reply pay off a curated card? Meaning-token containment of the
 * card's text in the narrative at CALLBACK_PAYOFF_CONTAINMENT (WOW 2026-10-14):
 * the engine judges the landing beside the DM's own `memory_updates`, so a
 * callback the DM wove in without marking still rests and still shows.
 */
export function detectCallbackPayoff(curated = [], narrative = '') {
    const reply = meaningTokens(typeof narrative === 'string' ? narrative : '');
    if (reply.size === 0) return [];
    return (Array.isArray(curated) ? curated : []).filter(card => {
        if (!card || typeof card.id !== 'string') return false;
        const tokens = meaningTokens(card.text);
        if (tokens.size < 3) return false;
        let found = 0;
        for (const token of tokens) if (reply.has(token)) found += 1;
        return found / tokens.size >= CALLBACK_PAYOFF_CONTAINMENT;
    });
}

const describeAge = (ageTurns) => (Number.isFinite(ageTurns) ? (ageTurns <= 0 ? 'just now' : `${ageTurns} turn${ageTurns === 1 ? '' : 's'} ago`) : 'long ago');

export function buildStoryMemoryPromptBlock(memories = []) {
    if (!memories.length) return '';
    const lines = memories.slice(0, DEFAULT_CARD_LIMIT).map(m => {
        const subject = m.subject ? ` | subject: ${m.subject}` : '';
        // Array.isArray, not just ?.length — a string value has .length but no .join.
        const npcs = Array.isArray(m.linkedNpcNames) && m.linkedNpcNames.length ? ` | NPCs: ${m.linkedNpcNames.join(', ')}` : '';
        const loc = m.location ? ` | location: ${m.location}` : '';
        // The id is ON the line (2026-10-12 P1): memory_updates addresses a
        // card by `{ "id": … }` and the block used to print none, so the
        // documented update was a silent no-op.
        const id = m.id ? ` | id: ${m.id}` : '';
        // The age and the voice (WOW 2026-10-14): how long ago, and who in
        // the scene could say it — else the hero's own passing thought.
        const speakers = Array.isArray(m.speakers) && m.speakers.length ? m.speakers.join(', ') : 'the hero (a passing thought)';
        return `- ${formatSecrecyTag(m.knownBy)}(${m.type}; salience ${m.salience}/5${id}${subject}${npcs}${loc}) ${m.text} — ${describeAge(m.ageTurns)} · could say it: ${speakers}`;
    }).join('\n');

    return `## DRAMATIC CALLBACK OPPORTUNITIES
Older story memories the scene may have forgotten. Use at most ONE naturally, and only as a character present SAYS it — in their own words, with its particular (the thing, the place, the line) and how long ago it was — or as the hero's own passing thought; never as narrator exposition recalling what is already on the page. Do not force a callback, do not explain this memory system, and do not slow the turn down just to prove you remember something. If you visibly pay off or resolve one, mark it with memory_updates in the JSON, using the id shown on its line. A memory tagged SECRET is known ONLY to the people listed — no other character may reference or act on it.
${lines}`;
}
