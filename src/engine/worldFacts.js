/**
 * World facts — the one dedupe rule and the polarity-aware supersession ledger
 * (2026-09-29, the first slice of IDEAS.md "[memory-research] Bi-temporal world
 * facts: a fact can stop being true"; DECISIONS.md 2026-09-29).
 *
 * The dedupe strips stop words before a ≥ 0.9 token containment — right for
 * "Odo is dead" vs "Odo is dead, killed at the docks" (a restatement), wrong
 * for "the bridge is passable" vs "the bridge is NOT passable" (a FLIP), because
 * `not` / `no` / `now` are stop words and the newer truth was rejected as a
 * duplicate of the older one. A flip is now the one case where a near-duplicate
 * is stored: the new fact lands, the old one is marked `supersededBy` and drops
 * out of every LIVE reader (the DM prompt, the RAG seed, the directors' canon
 * lists, "knows about you") while staying on the record for history (the recall
 * dossier shows it tagged). Facts are never deleted, so the ledger is append-only.
 *
 * Deliberately narrow: only a near-duplicate whose NEGATION differs counts as a
 * flip. "The keeper is alive" vs "the keeper is dead" share no negation and
 * few tokens, so both stand — that is the semantic supersession the IDEAS entry
 * leaves for a later slice, not this one.
 */
import { containment, tokenSet } from './textMatch.js';
import { conversationalDistance } from './replayLedger.js';

const FACT_STOP_WORDS = new Set([
    'the', 'a', 'an', 'of', 'to', 'in', 'is', 'are', 'was', 'were', 'and', 'or',
    'that', 'this', 'it', 'its', 'their', 'his', 'her', 'has', 'have', 'had',
    'by', 'for', 'with', 'at', 'on', 'as', 'be', 'been', 'from', 'now', 'not', 'no',
]);

export function factTokenSet(text) {
    return tokenSet(text, { stopWords: FACT_STOP_WORDS });
}

const NEGATION_RE = /\b(?:not|no|never|none|nobody|nothing|nowhere|cannot|without|neither|nor)\b|\w+n't\b/i;
/** Whether a fact is stated in the negative — the polarity the dedupe's stop words erase. */
export function hasNegation(text) {
    return NEGATION_RE.test(String(text || ''));
}

export const NEAR_DUPLICATE_FACT_CONTAINMENT = 0.9;

/** A fact still true as far as the record knows: not superseded by a later flip. */
export function isLiveFact(fact) {
    return !!fact && typeof fact === 'object' && typeof fact.fact === 'string' && !fact.supersededBy;
}

/** The facts every LIVE reader (prompt, seed, directors, "knows about you") should see. */
export function liveWorldFacts(list) {
    return (Array.isArray(list) ? list : []).filter(isLiveFact);
}

/**
 * How a candidate relates to the LIVE facts: `new` (store), `duplicate` (a
 * same-polarity restatement — reject), or `flip` (the same claim with its
 * negation reversed — store, and supersede `of`). `existingSets` may be
 * passed to reuse token sets across a batch.
 */
export function classifyFactCandidate(candidate, liveFacts = [], existingSets = null) {
    const tokens = factTokenSet(candidate);
    if (tokens.size === 0) return { kind: 'duplicate', of: null };
    const facts = Array.isArray(liveFacts) ? liveFacts : [];
    for (let i = 0; i < facts.length; i++) {
        const existing = facts[i];
        if (!existing || typeof existing.fact !== 'string') continue;
        const set = existingSets?.[i] || factTokenSet(existing.fact);
        if (containment(tokens, set) < NEAR_DUPLICATE_FACT_CONTAINMENT) continue;
        return hasNegation(candidate) !== hasNegation(existing.fact)
            ? { kind: 'flip', of: existing }
            : { kind: 'duplicate', of: existing };
    }
    return { kind: 'new', of: null };
}

/**
 * The record lane's tag for a superseded fact: history, never the present.
 * Distance is conversational when the transcript is given, raw otherwise.
 */
export function describeSupersededTag(fact, { messages = null, messageCount } = {}) {
    if (!fact || !fact.supersededBy) return '';
    const at = Number.isFinite(fact.supersededAtMessage) ? fact.supersededAtMessage : null;
    const end = Number.isFinite(messageCount) ? messageCount : (Array.isArray(messages) ? messages.length : null);
    let ago = null;
    if (at !== null && end !== null) {
        ago = Array.isArray(messages) ? conversationalDistance(messages, at - 1, end - 1) : Math.max(0, end - at);
    }
    const turns = ago === null ? null : Math.max(0, Math.round(ago / 2));
    return turns === null ? '[NO LONGER TRUE] ' : `[NO LONGER TRUE — changed ${turns === 0 ? 'this turn' : `${turns} turn${turns === 1 ? '' : 's'} ago`}] `;
}
