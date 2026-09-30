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
 *
 * Two more stamps since 2026-09-30 (memory-research M0 ×2):
 * - `aspect: 'state'` — "a state is not a fact" (LAPSE, arXiv 2609.36457: every
 *   memory writer tested flattened a progressive statement into a timeless
 *   truth, never the reverse, and readers then acted on the expired fact). A
 *   fact whose head clause is a passing STATE ("the harbor road is flooded",
 *   "Tammo is recovering") is marked by a small aspect lexicon and rendered
 *   with its AGE (`for now (N turns ago): …`) so the DM judges whether the
 *   flood is over; a restatement re-stamps the age instead of being dropped.
 *   Nothing expires, nothing is deleted.
 * - `retractedAtMessage` — source-stamped retraction: a fact minted from a
 *   DM message the player later removed (✕, a refusal) leaves the LIVE set
 *   with the message, so scrubbing a refusal scrubs its canon.
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

/** A fact still true as far as the record knows: not superseded by a later flip, not retracted with its message. */
export function isLiveFact(fact) {
    return !!fact && typeof fact === 'object' && typeof fact.fact === 'string'
        && !fact.supersededBy && !Number.isFinite(fact.retractedAtMessage);
}

/** The facts every LIVE reader (prompt, seed, directors, "knows about you") should see. */
export function liveWorldFacts(list) {
    return (Array.isArray(list) ? list : []).filter(isLiveFact);
}

/**
 * How a candidate relates to the LIVE facts: `new` (store), `duplicate` (a
 * same-polarity restatement — reject, or re-stamp when `of` is a state), or
 * `flip` (the same claim with its negation reversed — store, and supersede
 * `of`). `existingSets` may be passed to reuse token sets across a batch.
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

// ——— A state is not a fact (2026-09-30) ———

/** Explicit temporariness markers anywhere in the sentence. */
const STATE_MARKER_RE = /\b(?:for now|for the moment|for the time being|at the moment|at present|currently|right now|tonight|these days|temporarily|for the (?:night|winter|summer|season|week)|this (?:week|month|season|winter|summer|morning|evening|night)|until (?:the|it|they|he|she|further|dawn|morning|spring|winter|summer))\b/i;
// -ing words that are nouns, not progressives.
const NOT_PROGRESSIVE = 'nothing|something|anything|everything|king|ring|thing|wing|spring|string|morning|evening|sibling|darling|building|ceiling|dwelling|cunning|willing|unwilling|lightning|herring|pudding|shilling|farthing|offspring|earring|bring|sting|swing|sling|fling';
/** A copula followed by a progressive or a state predicate: "is flooded", "are recovering", "remains under siege". */
const STATE_PREDICATE_RE = new RegExp(
    String.raw`\b(?:is|are|remains?|stays?|lies?|sits?|stands?)\s+(?:(?:still|currently|now|also|again|being)\s+)?(?:`
    + String.raw`(?!(?:${NOT_PROGRESSIVE})\b)\w+ing\b`
    + String.raw`|(?:under|in)\s+(?:siege|quarantine|lockdown|mourning|hiding|repair|construction|recovery|flood|revolt|uproar|chaos)`
    + String.raw`|flooded|besieged|closed|shut|shuttered|barred|blocked|impassable|cut off|snowed in|occupied|garrisoned|guarded|watched|missing|away|abroad|asleep|abed|bedridden|wounded|injured|sick|ill|feverish|drunk|imprisoned|jailed|captive|held|detained|at large|on the run|in hiding|on fire|crowded|empty|deserted|out of town|overdue|late|delayed|stranded|adrift|becalmed|frozen|iced over|unconscious|unwell|indisposed|in labor|in labour|pregnant|in mourning|in debt|in exile|at war|at sea|underway|afoot`
    + String.raw`)\b`,
    'i',
);

/**
 * `'state'` when the fact describes a condition that will pass (a flood, a
 * siege, a fever, a closed gate), `null` for a standing truth (a death, a
 * name, a history). Lexical, deliberately small: a marker word, or a copula
 * followed by a progressive or a state predicate. A death is never a state.
 */
export function classifyFactAspect(text) {
    const fact = String(text || '');
    if (!fact.trim()) return null;
    if (/\b(?:is|are|was|were)\s+(?:now\s+)?dead\b/i.test(fact)) return null;
    if (STATE_MARKER_RE.test(fact)) return 'state';
    if (STATE_PREDICATE_RE.test(fact)) return 'state';
    return null;
}

function turnsSince(at, { messages = null, messageCount } = {}) {
    if (!Number.isFinite(at)) return null;
    const end = Number.isFinite(messageCount) ? messageCount : (Array.isArray(messages) ? messages.length : null);
    if (end === null) return null;
    const ago = Array.isArray(messages) ? conversationalDistance(messages, at - 1, end - 1) : Math.max(0, end - at);
    return Math.max(0, Math.round(ago / 2));
}

function describeTurns(turns) {
    return turns === 0 ? 'this turn' : `${turns} turn${turns === 1 ? '' : 's'} ago`;
}

/**
 * The live readers' tag for a state fact: `for now (N turns ago): ` — the
 * age in conversational turns from the fact's `atMessage` (re-stamped by
 * every restatement), or `for now: ` for a legacy row without one. '' for a
 * standing fact.
 */
export function describeStateTag(fact, { messages = null, messageCount } = {}) {
    if (!fact || fact.aspect !== 'state') return '';
    const turns = turnsSince(fact.atMessage, { messages, messageCount });
    return turns === null ? 'for now: ' : `for now (as of ${describeTurns(turns)}): `;
}

/**
 * The record lane's tag for a superseded fact: history, never the present.
 * Distance is conversational when the transcript is given, raw otherwise.
 */
export function describeSupersededTag(fact, { messages = null, messageCount } = {}) {
    if (!fact || !fact.supersededBy) return '';
    const turns = turnsSince(fact.supersededAtMessage, { messages, messageCount });
    return turns === null ? '[NO LONGER TRUE] ' : `[NO LONGER TRUE — changed ${describeTurns(turns)}] `;
}

/** The record lane's tag for a retracted fact: it was minted by a message the player removed. */
export function describeRetractedTag(fact) {
    return fact && Number.isFinite(fact.retractedAtMessage) ? '[RETRACTED — its message was removed] ' : '';
}
