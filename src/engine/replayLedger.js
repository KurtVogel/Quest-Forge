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
    let distance = 0;
    for (let i = Math.max(0, fromIndex + 1); i <= Math.min(toIndex, messages.length - 1); i++) {
        const message = messages[i];
        if (!message || message.role === 'system' || message.hidden || message.deleted) continue;
        distance += 1;
    }
    return distance;
}

/** "sourceId|key|messageIndex" → parts. Legacy two-part entries (pre-index
 * spell casts) parse with messageIndex null; non-strings parse to null. */
export function parseLedgerEntry(entry) {
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
