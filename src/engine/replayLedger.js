/**
 * Pipe-string replay ledgers — the cross-message idempotency guard behind the
 * one-shot mechanics invariant (DECISIONS.md 2026-07-21) for channels that
 * track "sourceId|key|messageIndex" strings: spell casts (key = spell key) and
 * rests (key = rest type). The richer structured-transaction ledger
 * (purchases/sales/coin grants/losses) stays in gameReducer, but shares
 * `conversationalDistance` from here so both generations measure replay
 * windows the same way.
 */

/**
 * Conversational distance between two message indexes: system lines and hidden
 * roll-setup messages don't count. A single check turn burns ~5 raw messages
 * (user, hidden setup, two roll system lines, outcome), which silently expired
 * the raw-index coin windows — the DM's "very next turn" re-emission landed 8
 * raw messages later and re-paid a 20 gp fee (live finding 2026-07-22).
 */
/**
 * The wider item-grant replay window (2026-08-31 P1): a reward item granted at
 * the handover is re-emitted at quest completion > 4 conversational messages
 * later. Read by the reducer's grant ledger (quest-completion responses) AND
 * the Scribe loot audit's own dedupe — one constant since 2026-10-10 (scribe
 * P2: the audit kept a private 12 the 10-07 spend-window unification missed).
 * Matches the spend side's RECENT_SPEND_MESSAGE_WINDOW.
 */
export const RECENT_ITEM_GRANT_EXTENDED_WINDOW = 12;

export function conversationalDistance(messages, fromIndex, toIndex) {
    if (!Array.isArray(messages)) return Math.max(0, toIndex - fromIndex);
    const lo = Math.max(0, Math.floor(fromIndex + 1));
    const hi = Math.min(Math.floor(toIndex), messages.length - 1);
    if (!(hi >= lo)) return 0;
    const prefix = narrativePrefixCounts(messages);
    return prefix[hi + 1] - prefix[lo];
}

/**
 * "just now" / "N turns ago" in CONVERSATIONAL distance — one turn is the
 * player's line plus the DM's answer. It used to say "scenes", which the
 * number never measured (2026-09-21: "736 scenes ago" for last night). THE
 * age phrase of every memory line: the recall dossier's rows, the epitaph,
 * and — since 2026-10-21 (memory-research M1) — the RETRIEVED MEMORIES block.
 */
export function describeTurnsAgo(messages, atIndex) {
    if (!Array.isArray(messages) || !Number.isFinite(atIndex)) return '';
    const distance = conversationalDistance(messages, Math.max(0, Math.floor(atIndex)) - 1, messages.length - 1);
    const turns = Math.ceil(distance / 2);
    if (turns <= 0) return 'just now';
    return `${turns} turn${turns === 1 ? '' : 's'} ago`;
}

/**
 * Conversational messages since a stamp written as "the message count at the
 * time", or null when the stamp is missing (a legacy record) or no transcript
 * position is known. With the live transcript the count skips system lines and
 * hidden / deleted rows like every replay ledger; without it the raw gap is the
 * best available. THE one wrapper since 2026-10-12 (story-memory Lap-4 P2):
 * story cards, NPC recency, bonds and hero tells each kept a private copy.
 * (`distanceSince` in worldTempo.js is a different contract — an explicit,
 * inclusive end index — and stays its own function.)
 */
export function conversationalAgeSince(stamp, { messages = null, messageCount } = {}) {
    if (!Number.isFinite(stamp)) return null;
    const end = Number.isFinite(messageCount)
        ? messageCount
        : (Array.isArray(messages) ? messages.length : NaN);
    if (!Number.isFinite(end)) return null;
    if (Array.isArray(messages)) return conversationalDistance(messages, stamp - 1, end - 1);
    return Math.max(0, end - stamp);
}

/**
 * Conversational rows between two "message count at the time" stamps, in
 * either order; the raw gap without a transcript; null for a non-finite stamp.
 * THE scene clock since 2026-10-19 (hero-tells Lap-1 P2): the bond family's
 * same-scene window (`BOND_SCENE_WINDOW_MESSAGES`) was judged on raw rows
 * beside a record whose fade, beat pull and hearsay age were conversational
 * — a habit reported every turn established after 9 dice turns (5 rows each)
 * against 19 plain turns. Measured here, a scene is the same length whatever
 * the dice burned.
 */
export function conversationalGap(a, b, { messages = null } = {}) {
    if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
    const lo = Math.min(a, b);
    const hi = Math.max(a, b);
    if (!Array.isArray(messages)) return hi - lo;
    return conversationalDistance(messages, lo - 1, hi - 1);
}

/**
 * A finite, floored, non-negative message stamp, clamped to the transcript when
 * the caller knows its length; null for junk. THE stamp typer for the load
 * boundaries of the living-world markers and the hero tells (2026-10-12).
 */
export function clampMessageStamp(value, maxMessageCount) {
    const n = Number(value);
    if (!Number.isFinite(n)) return null;
    const floored = Math.max(0, Math.floor(n));
    return Number.isFinite(maxMessageCount) ? Math.min(floored, Math.max(0, Math.floor(maxMessageCount))) : floored;
}

/**
 * Prefix counts of conversational rows, memoized on the transcript array
 * (2026-09-30 story-memory + prompt-building Lap-3 P2). A turn asks for the
 * distance since a stamp K + 2N times — every story card's two stamps, every
 * roster NPC's last-seen and open-thread stamps, every ledger entry — and the
 * transcript never shrinks (summarized rows stay), so the per-call walk was
 * O(transcript) and the per-turn total O(cards × transcript): 5 ms → 25 ms
 * on a desktop at 1,000 cards / 6,000 rows, ×4–5 on a phone, all of it on
 * the main thread between send and stream start. The reducer replaces the
 * `messages` array on every change, so one count per array reference makes
 * every later distance O(1). The length is re-checked as a belt against an
 * in-place push; an in-place flag flip on an existing row (never done by the
 * reducer) would read stale until the next reducer change.
 */
const prefixCache = new WeakMap();

function narrativePrefixCounts(messages) {
    const cached = prefixCache.get(messages);
    if (cached && cached.length === messages.length + 1) return cached;
    const prefix = new Uint32Array(messages.length + 1);
    for (let i = 0; i < messages.length; i++) {
        const message = messages[i];
        const counts = !(!message || message.role === 'system' || message.hidden || message.deleted);
        prefix[i + 1] = prefix[i] + (counts ? 1 : 0);
    }
    prefixCache.set(messages, prefix);
    return prefix;
}

/** "sourceId|key|messageIndex" → parts. Legacy two-part entries (pre-index
 * spell casts) parse with messageIndex null; non-strings parse to null. */
function parseLedgerEntry(entry) {
    if (typeof entry !== 'string') return null;
    const [sourceId = '', key = '', rawIndex] = entry.split('|');
    const messageIndex = Number(rawIndex);
    return { sourceId, key, messageIndex: Number.isFinite(messageIndex) ? messageIndex : null };
}

/** Exact-source short-circuit: the same emission re-parsed (same sourceId
 * prefix) is always a replay, regardless of distance. `prefix` is everything
 * before the messageIndex — "sourceId" for rests, "sourceId|spellKey" for
 * spell casts (a bare-prefix match also catches legacy index-less entries). */
export function findExactSourceReplay(entries, prefix) {
    if (!prefix) return false;
    return (Array.isArray(entries) ? entries : []).some(entry =>
        typeof entry === 'string' && (entry === prefix || entry.startsWith(`${prefix}|`)));
}

/** A different emission with the same key landing within `window`
 * conversational messages is the DM echoing an already-applied event. */
export function findNearbyReplay(entries, { key, messages, currentIndex, window }) {
    return (Array.isArray(entries) ? entries : []).some(entry => {
        const parsed = parseLedgerEntry(entry);
        if (!parsed || parsed.key !== key || parsed.messageIndex === null) return false;
        const distance = conversationalDistance(messages, parsed.messageIndex, currentIndex);
        return distance >= 0 && distance <= window;
    });
}

/** Record (or re-stamp at a new index) a ledger entry; drops non-string
 * entries and an exact duplicate of the new key, oldest fall off at `cap`. */
export function rememberLedgerEntry(entries, { sourceId, key, messageIndex, cap }) {
    const full = `${String(sourceId || '').slice(0, 160)}|${key}|${messageIndex}`;
    const previous = (Array.isArray(entries) ? entries : [])
        .filter(entry => typeof entry === 'string' && entry !== full);
    return [...previous, full].slice(-cap);
}
