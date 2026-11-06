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
 *
 * And a third aspect since 2026-10-07 (memory-research M0, Lane A run):
 * - `aspect: 'intent'` — "an intent is not a deed" (AgentMemGate, arXiv
 *   2610.07707: memory writers store an unresolved PLAN as a current fact —
 *   Mem0 35 %, Graphiti 27 % of them — and readers act on it). A fact whose
 *   head clause is a plan, promise, threat, appointment, or forward modal
 *   ("the baron plans to seize the mill", "Tammo swore to return the knife")
 *   is marked `intent` and rendered with its age (`planned (as of N turns
 *   ago): …`), a restatement re-stamps the age, and the DEED closes it: a
 *   lane that read KNOWN OPEN PLANS writes the outcome with `supersedes:
 *   <the plan's id>`, and `findOpenPlan` lets the reducer stamp the plan
 *   `supersededBy` exactly as a FLIP does.
 *
 * Standing truths close by ref too since 2026-11-06 (Vesa, reversing the
 * 10-07 "a standing truth closes by a flip alone"): a flip is a negation, a
 * thing that MOVED is not one, so "the sail is in the net-loft" stayed live
 * canon after the sail went aboard and the DM said so, 3 of 7 Sol runs. The
 * Scribe alone may name a KNOWN FACT its new fact replaces (`standingRefs`);
 * the DM and the journal never see a fact id and keep the plan-only rule. A
 * pinned fact never answers to a ref (`findRetirableFact`), the id compares
 * exactly, and removing the replacing message restores the old fact
 * (`planRetraction`), so nothing is lost to a deleted turn.
 */
import { containment, coverage, tokenSet } from './textMatch.js';
import { conversationalDistance } from './replayLedger.js';
import { normalizeKnownBy } from './storyMemory.js';
import { appendWitness } from './retraction.js';

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
export function classifyFactCandidate(candidate, liveFacts = [], existingSets = null, { exceptId = null } = {}) {
    const tokens = factTokenSet(candidate);
    if (tokens.size === 0) return { kind: 'duplicate', of: null };
    const facts = Array.isArray(liveFacts) ? liveFacts : [];
    for (let i = 0; i < facts.length; i++) {
        const existing = facts[i];
        if (!existing || typeof existing.fact !== 'string') continue;
        // The fact a lane NAMED as replaced is never the candidate's twin
        // (2026-11-06, night): the id is the lane's reading, and the words
        // do not get to overrule it.
        if (exceptId && existing.id === exceptId) continue;
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

// ——— An intent is not a deed (2026-10-07) ———

/** The aspects the record whitelists at load (`state` / `intent`; anything else is a standing truth). */
export const FACT_ASPECTS = Object.freeze(['state', 'intent']);

// A determiner after "to" makes it a destination or an allegiance ("is going
// to the capital", "is sworn to the Pike", "agreed to the terms"), not a plan.
const DETERMINER = '(?:the|a|an|his|her|their|its|our|my|your|that|this|these|those)';
/**
 * A plan, promise, threat, appointment, or expectation: a verb of intention +
 * `to` + a verb, a copula + going / planning / about / due + `to` + a verb, or
 * a forward modal (`will` / `shall` / `might`). `may` / `can` / `could` /
 * `would` stay out — permission, ability, and past habit read the same —
 * and a past-tense "planned to" is history. "promised / swore / vowed /
 * agreed to" are OPEN commitments and count.
 */
const INTENT_RE = new RegExp(
    String.raw`\b(?:plans?|intends?|means|aims?|hopes?|wants?|wishes|expects?|promises?|promised|swears?|swore|sworn|vows?|vowed|threatens?|threatened|offers?|offered|agrees?|agreed|resolves?|resolved|has agreed|have agreed|has promised|have promised|has sworn|have sworn|has vowed|have vowed)\s+to\s+(?!${DETERMINER}\b)\w+`
    + String.raw`|\b(?:is|are)\s+(?:(?:still|now|also)\s+)?(?:going|planning|preparing|intending|meaning|about|poised|due|set|expected|bound|sworn)\s+to\s+(?!${DETERMINER}\b)\w+`
    + String.raw`|\b(?:will|shall|might)\s+(?:not\s+|never\s+|soon\s+)?\w+`,
    'i',
);

/**
 * The live INTENT fact a lane's `supersedes` ref names — the open plan this
 * new fact settles (carried out, failed, or abandoned). Null for a junk ref,
 * an unknown id, a buried fact, or a STANDING truth: those close only by a
 * FLIP, so no lane can retire canon by naming its id.
 */
export function findOpenPlan(liveFacts, ref) {
    if (typeof ref !== 'string' || !ref.trim()) return null;
    const id = ref.trim();
    return (Array.isArray(liveFacts) ? liveFacts : []).find(f => f && f.id === id && f.aspect === 'intent' && isLiveFact(f)) || null;
}

/**
 * The live fact the Scribe's `supersedes` ref names — any aspect, a standing
 * truth included (2026-11-06). Null for a junk ref, an unknown id, a buried
 * fact, or a PINNED one: a fact sworn on the record stays until a flip.
 */
export function findRetirableFact(liveFacts, ref) {
    if (typeof ref !== 'string' || !ref.trim()) return null;
    const id = ref.trim();
    return (Array.isArray(liveFacts) ? liveFacts : []).find(f => f && f.id === id && f.pinned !== true && isLiveFact(f)) || null;
}

/**
 * `'intent'` when the fact is a plan, promise, threat, or expectation not
 * yet carried out; `'state'` when it describes a condition that will pass
 * (a flood, a siege, a fever, a closed gate); `null` for a standing truth
 * (a death, a name, a history, a deed done). Lexical, deliberately small.
 * A death is never a state or an intent; intent is judged before state so
 * "is planning to seize" is a plan, not a progressive.
 */
export function classifyFactAspect(text) {
    const fact = String(text || '');
    if (!fact.trim()) return null;
    if (/\b(?:is|are|was|were)\s+(?:now\s+)?dead\b/i.test(fact)) return null;
    if (INTENT_RE.test(fact)) return 'intent';
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
 * The live readers' tag for an aspected fact: `for now (as of N turns ago): `
 * on a state, `planned (as of N turns ago): ` on an intent — the age in
 * conversational turns from the fact's `atMessage` (re-stamped by every
 * restatement), or the bare word for a legacy row without one. '' for a
 * standing fact.
 */
export function describeStateTag(fact, { messages = null, messageCount } = {}) {
    const aspect = fact?.aspect;
    if (aspect !== 'state' && aspect !== 'intent') return '';
    const word = aspect === 'intent' ? 'planned' : 'for now';
    const turns = turnsSince(fact.atMessage, { messages, messageCount });
    return turns === null ? `${word}: ` : `${word} (as of ${describeTurns(turns)}): `;
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

// ——— The fact payload boundary and THE addition plan (2026-10-11) ———

export const WORLD_FACT_MAX_LENGTH = 400;
const WORLD_FACT_CATEGORY_MAX_LENGTH = 40;

/**
 * A lane's fact payload typed and clamped: fact string-or-drop at
 * WORLD_FACT_MAX_LENGTH, category clamped (default 'general'), knownBy
 * through the epistemics normalizer (DECISIONS.md 2026-08-05 ×2 — always
 * present so a hostile save's junk value is overwritten on load), `pinned`
 * (2026-09-30: an engine-minted commitment the post-journal verifier must
 * find live after every cadence). Null for junk. Moved here from
 * handlers/shared.js so the live embed lanes can read the RECORD's shape.
 */
export function sanitizeWorldFactPayload(payload) {
    if (!payload || typeof payload !== 'object') return null;
    const fact = typeof payload.fact === 'string' ? payload.fact.trim().slice(0, WORLD_FACT_MAX_LENGTH) : '';
    if (!fact) return null;
    const category = (typeof payload.category === 'string' && payload.category.trim())
        ? payload.category.trim().slice(0, WORLD_FACT_CATEGORY_MAX_LENGTH)
        : 'general';
    const pinned = payload.pinned === true || payload.pinned === 'true';
    return { fact, category, knownBy: normalizeKnownBy(payload.knownBy ?? payload.known_by), ...(pinned && { pinned: true }) };
}

/** A fact's text with case, punctuation and spacing folded — an exact compare, never a word match. */
function foldFactText(text) {
    return String(text || '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

function mintFactId() {
    return `fact-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
}

/**
 * THE judgement of a batch of fact candidates against the record (2026-10-11
 * audit P2): the reducer's ADD_WORLD_FACTS is this plan committed, and the
 * live embed lanes (the DM's `world_facts`, the Scribe's) read `added` so a
 * RAG row is composed from the record's own shape — never from the wire.
 * Measured before: a restatement the record REFUSED was embedded anyway (a
 * permanent immutable-category row), `knownBy: "public"` embedded with a
 * SECRET tag the record never carried, an object fact embedded the literal
 * string "undefined", a 900-char fact embedded whole against the record's
 * 400 — four of four live texts absent from the seed's.
 *
 * Per candidate: sanitized; a ≥ 0.9 same-polarity restatement is a
 * `duplicate` (dropped — or, for a STATE / INTENT fact, its age re-stamped);
 * a restatement whose negation differs is a FLIP (stored, superseding its
 * twin); a lane's `supersedes` ref closes a live INTENT fact (`findOpenPlan`),
 * and with `standingRefs` (the Scribe lane) any unpinned live fact
 * (`findRetirableFact`); a new fact is born with its id, `atMessage`, aspect
 * and (when the lane stamped one) `sourceMessage`. Returns the next list, the
 * rows born, and whether anything changed. Pure.
 */
export function planWorldFactAdditions(worldFacts, payload, { messageCount = 0, sourceMessage = null, now = Date.now(), standingRefs = false } = {}) {
    let facts = Array.isArray(worldFacts) ? worldFacts : [];
    let live = liveWorldFacts(facts);
    let liveSets = live.map(f => factTokenSet(f.fact));
    const stamp = typeof sourceMessage === 'string' && sourceMessage ? sourceMessage : null;
    const added = [];
    let changed = false;
    for (const f of (Array.isArray(payload) ? payload : [])) {
        const sanitized = sanitizeWorldFactPayload(f);
        if (!sanitized) continue;
        // The ref is read FIRST (2026-11-06, night). The containment judge
        // used to run before it: "the sail was moved from the net-loft to
        // the foredeck" holds every word of "the sail is in the net-loft",
        // so the new truth was dropped as a restatement of the very fact the
        // Scribe named as replaced, and the old place stayed live. A fact a
        // lane names is set aside from the word judge; only a character-for-
        // character copy of it (a restatement carrying its own id) is still
        // a restatement.
        const named = standingRefs ? findRetirableFact(live, f?.supersedes) : findOpenPlan(live, f?.supersedes);
        const replaced = named && foldFactText(named.fact) !== foldFactText(sanitized.fact) ? named : null;
        const verdict = classifyFactCandidate(sanitized.fact, live, liveSets, { exceptId: replaced?.id || null });
        if (verdict.kind === 'duplicate') {
            // A state is not a fact (M0, 2026-09-30): a restatement of a
            // STATE fact ("the road is still flooded") re-stamps its age
            // instead of being dropped — the DM reads the freshness. An
            // INTENT restated ("he still means to…") re-stamps the same way
            // (2026-10-07). And EVERY aspect's restatement is a WITNESS
            // (memory-research M0, 2026-10-28): the restating message joins
            // the held fact's `witnesses`, so removing the fact's first
            // message retracts it only when nothing later said it too.
            if (verdict.of?.id) {
                const ofId = verdict.of.id;
                const restamp = verdict.of.aspect === 'state' || verdict.of.aspect === 'intent';
                const witnesses = appendWitness(verdict.of.witnesses, verdict.of.sourceMessage, stamp);
                const witnessed = witnesses.length > 0 && witnesses !== verdict.of.witnesses;
                if (restamp || witnessed) {
                    facts = facts.map(existing => (existing.id === ofId
                        ? {
                            ...existing,
                            ...(restamp && { atMessage: messageCount, timestamp: now }),
                            ...(witnessed && { witnesses }),
                        }
                        : existing));
                    live = liveWorldFacts(facts);
                    changed = true;
                }
                // The new truth is already on record under another line: the
                // change still retires what the ref names, onto that line.
                const retired = replaced;
                if (retired && retired.id !== ofId) {
                    facts = facts.map(existing => (existing.id === retired.id
                        ? { ...existing, supersededBy: ofId, supersededAtMessage: messageCount }
                        : existing));
                    live = liveWorldFacts(facts);
                    liveSets = live.map(x => factTokenSet(x.fact));
                    changed = true;
                }
            }
            continue;
        }
        const id = mintFactId();
        const aspect = classifyFactAspect(sanitized.fact);
        const next = {
            id,
            timestamp: now,
            // Birth stamp in messages: the age every state tag and the
            // retraction ledger read (legacy rows simply have none).
            atMessage: messageCount,
            ...sanitized,
            ...(aspect && { aspect }),
            ...(stamp && { sourceMessage: stamp }),
        };
        // An intent is not a deed (memory-research M0, 2026-10-07): a lane
        // that read KNOWN OPEN PLANS names the plan this fact settles
        // (`supersedes: <id>`) and the plan closes exactly as a flipped twin
        // does. The Scribe may also name a standing truth the new fact
        // replaces (2026-11-06, the file header); every other lane reaches
        // intents only. The named fact closes whatever the word judge says
        // of the OTHER facts — a flip of a third line still closes that line
        // too (the retraction restores every row this id buried).
        const buried = new Set();
        if (verdict.kind === 'flip' && verdict.of?.id) buried.add(verdict.of.id);
        if (replaced && replaced.id !== id) buried.add(replaced.id);
        if (buried.size > 0) {
            next.supersedes = replaced && buried.has(replaced.id) ? replaced.id : verdict.of.id;
            facts = facts.map(existing => (buried.has(existing.id)
                ? { ...existing, supersededBy: id, supersededAtMessage: messageCount }
                : existing));
        }
        facts = [...facts, next];
        added.push(next);
        live = liveWorldFacts(facts);
        liveSets = live.map(x => factTokenSet(x.fact));
        changed = true;
    }
    return { worldFacts: facts, added, changed };
}

/**
 * A text that RESTATES a since-flipped fact carries its correction
 * (memory-research 2026-10-28 M0, built 2026-10-30 for the RETRIEVED
 * MEMORIES rows; moved here 2026-11-04 so the DRAMATIC CALLBACKS block
 * judges with the SAME rule — "Obsolete Facts": the newest value present
 * with one obsolete competitor beside it cost a reader 100 → 44.6 %;
 * StateGraph: a belief or plan DERIVED from a changed premise stays accepted
 * unless something says so). A text holding at least STALE_ROW_CONTAINMENT of
 * a superseded fact's meaning tokens — the dedupe's own tokenizer — whose
 * restating clause is not already on the live twin's side of the negation is
 * answered with the live twin's text. Nothing is invalidated: the reader is
 * SHOWN the change and the fiction decides. Zero calls.
 */
export const STALE_ROW_CONTAINMENT = 0.8;
export const STALE_TAG_TWIN_MAX = 160;

/** The superseded facts whose LIVE twin is on record, newest change first, with their token sets. */
export function listStaleFacts(worldFacts) {
    if (!Array.isArray(worldFacts) || worldFacts.length === 0) return [];
    const byId = new Map(worldFacts.filter(f => f && typeof f.id === 'string').map(f => [f.id, f]));
    const stamp = f => (Number.isFinite(f.supersededAtMessage) ? f.supersededAtMessage : -1);
    return worldFacts
        .filter(f => f && typeof f.fact === 'string' && f.supersededBy && !Number.isFinite(f.retractedAtMessage))
        .map(f => {
            // A twin itself superseded (a re-flip) is not the live truth: the
            // fact it replaced may be true again, and its own successor tags.
            const twin = byId.get(f.supersededBy);
            if (!isLiveFact(twin)) return null;
            const tokens = factTokenSet(f.fact);
            if (tokens.size === 0) return null;
            return { stale: f, twin, tokens, flip: hasNegation(f.fact) !== hasNegation(twin.fact) };
        })
        .filter(Boolean)
        .sort((a, b) => stamp(b.stale) - stamp(a.stale));
}

/** The sentence of `text` holding the most of `tokens` — where the text's polarity on THIS claim is judged. */
function restatingClause(text, tokens) {
    const sentences = text.split(/(?<=[.!?])\s+/).filter(Boolean);
    if (sentences.length <= 1) return text;
    let best = sentences[0];
    let bestShare = -1;
    for (const sentence of sentences) {
        const share = coverage(tokens, factTokenSet(sentence));
        if (share > bestShare) {
            best = sentence;
            bestShare = share;
        }
    }
    return best;
}

/** Clip at the last sentence end inside `max` (past its midpoint), else hard. */
function clipTwinText(text, max) {
    const clean = typeof text === 'string' ? text : '';
    if (clean.length <= max) return clean;
    const head = clean.slice(0, max);
    const cut = Math.max(head.lastIndexOf('. '), head.lastIndexOf('! '), head.lastIndexOf('? '), head.lastIndexOf('.\n'));
    if (cut >= max / 2) return `${head.slice(0, cut + 1)} …`;
    return `${head.trimEnd()}…`;
}

/**
 * The live twin a text should be shown beside, or '' — one answer per text,
 * the newest change winning. `staleFacts` is `listStaleFacts(worldFacts)`,
 * computed once per prompt.
 */
export function describeStaleTwin(text, staleFacts) {
    if (!Array.isArray(staleFacts) || staleFacts.length === 0 || typeof text !== 'string') return '';
    const rowTokens = factTokenSet(text);
    if (rowTokens.size === 0) return '';
    for (const { twin, tokens, flip } of staleFacts) {
        if (coverage(tokens, rowTokens) < STALE_ROW_CONTAINMENT) continue;
        // A genuine flip pair: a clause already on the twin's side of the
        // negation states the new truth and needs no tag. A same-polarity
        // close (a plan closed by its deed) is judged on the tokens alone.
        if (flip && hasNegation(restatingClause(text, tokens)) === hasNegation(twin.fact)) continue;
        return clipTwinText(twin.fact, STALE_TAG_TWIN_MAX);
    }
    return '';
}
