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
export function conversationalDistance(messages, fromIndex, toIndex) {
    if (!Array.isArray(messages)) return Math.max(0, toIndex - fromIndex);
    const lo = Math.max(0, Math.floor(fromIndex + 1));
    const hi = Math.min(Math.floor(toIndex), messages.length - 1);
    if (!(hi >= lo)) return 0;
    const prefix = narrativePrefixCounts(messages);
    return prefix[hi + 1] - prefix[lo];
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
