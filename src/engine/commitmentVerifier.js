/**
 * The post-journal verifier (memory-research Adoption Queue M1, built
 * 2026-09-30; doctrine claim D2 — the summary is lossy, commitments live in
 * structured state). After every journal cadence the engine asks, with zero
 * tokens, whether each COMMITMENT the DM must keep finding is still on the
 * record outside the summary: every active quest, every pinned fact (a
 * front's resolution epitaph), every NPC's open thread, every active promise
 * card. The cadence's own writes are the only thing that could have moved
 * them — the summary's facts (a flip), the reflection's NPC updates (a thread
 * "settled"), its cards — and the reflection is FORBIDDEN from resolving
 * anything, so a loss here is a lane doing what it may not. One visible
 * infrastructure line names what went; nothing is restored automatically
 * (restoring would make the verifier a survival rule, which it is not).
 */
import { isLiveFact } from './worldFacts.js';
import { containment, tokenSet } from './textMatch.js';

const text = (value) => (typeof value === 'string' ? value.trim() : '');

/**
 * A promise is still CARRIED when another live record says the same thing
 * (grand playtest 2026-10-02): the per-turn Scribe runs beside the cadence and
 * re-mints / rewords a promise as a new card or as the NPC's open thread, and
 * the id-keyed diff read "Dunstan agreed to join Aino…" as lost while two
 * active cards and Dunstan's open thread all held it.
 */
const CARRIED_CONTAINMENT = 0.5;
const CARRY_STOP_WORDS = new Set(['the', 'and', 'for', 'with', 'that', 'this', 'from', 'into', 'their', 'her', 'his', 'them', 'they', 'was', 'were', 'has', 'have', 'had', 'will', 'would', 'agreed', 'promised', 'swore']);
const carryTokens = (value) => tokenSet(value, { stopWords: CARRY_STOP_WORDS, minLength: 3, foldPossessives: true });

/**
 * The commitments as they stand now: `{ quests, facts, threads, promises }`,
 * each a Map of id → label, plus `carriers` (the full texts of every active
 * promise and open thread), `promiseTexts` (id → full text), the three SETTLED
 * maps — `resolvedThreads` (NPC id → the message the thread was settled at,
 * the reducer's `openThreadResolvedMessage` stamp), `closedQuests` (quest id
 * → `closedAtMessage`, stamped by COMPLETE_QUEST / FAIL_QUEST) and
 * `settledFacts` (fact id → `supersededAtMessage` / `retractedAtMessage`) —
 * and `messageCount` (the transcript length at the snapshot).
 */
export function snapshotCommitments(state = {}) {
    const quests = new Map();
    const closedQuests = new Map();
    for (const quest of (Array.isArray(state.quests) ? state.quests : [])) {
        if (!quest || typeof quest.id !== 'string') continue;
        if ((quest.status || 'active') === 'active') quests.set(quest.id, text(quest.name) || quest.id);
        else if (Number.isFinite(quest.closedAtMessage)) closedQuests.set(quest.id, quest.closedAtMessage);
    }
    const facts = new Map();
    const settledFacts = new Map();
    for (const fact of (Array.isArray(state.worldFacts) ? state.worldFacts : [])) {
        if (!fact || typeof fact.id !== 'string') continue;
        if (fact.pinned === true && isLiveFact(fact)) facts.set(fact.id, text(fact.fact).slice(0, 80));
        else if (Number.isFinite(fact.retractedAtMessage)) settledFacts.set(fact.id, fact.retractedAtMessage);
        else if (Number.isFinite(fact.supersededAtMessage)) settledFacts.set(fact.id, fact.supersededAtMessage);
    }
    const threads = new Map();
    const resolvedThreads = new Map();
    const carriers = [];
    for (const npc of (Array.isArray(state.npcs) ? state.npcs : [])) {
        if (!npc || typeof npc.id !== 'string') continue;
        if (text(npc.openThread)) {
            threads.set(npc.id, text(npc.name) || npc.id);
            carriers.push(text(npc.openThread));
        } else if (Number.isFinite(npc.openThreadResolvedMessage)) {
            resolvedThreads.set(npc.id, npc.openThreadResolvedMessage);
        }
    }
    const messageCount = Array.isArray(state.messages) ? state.messages.length : 0;
    const promises = new Map();
    const promiseTexts = new Map();
    for (const card of (Array.isArray(state.storyMemory) ? state.storyMemory : [])) {
        if (card && card.type === 'promise' && (card.status || 'active') === 'active' && typeof card.id === 'string') {
            promises.set(card.id, text(card.text).slice(0, 80) || card.id);
            promiseTexts.set(card.id, text(card.text));
            if (text(card.text)) carriers.push(text(card.text));
        }
    }
    return { quests, facts, threads, promises, promiseTexts, carriers, resolvedThreads, closedQuests, settledFacts, messageCount };
}

/**
 * What `before` had that `after` no longer carries: `[{ kind, label }]`.
 * A quest is lost when it is gone or no longer active; a pinned fact when it
 * is no longer live; a thread when the NPC's `openThread` is empty (a
 * REPLACED thread is not a loss — the cadence may move the beat); a promise
 * card when it is no longer active AND no other active promise or open
 * thread still says it (a reworded successor is not a loss).
 *
 * THE SETTLED RULE, for all three stamped kinds: a commitment a lane settled
 * AT OR AFTER the snapshot is not a loss — the verifier runs after two Flash
 * calls against the LIVE state while play continues. Threads since
 * 2026-10-03 (`openThreadResolved: true` stamps `openThreadResolvedMessage`;
 * the Sol run's 📓 line reported a serving woman's thread the Scribe had just
 * closed); quests and facts since 2026-10-14 (memory-journal P1, measured:
 * the DM's next reply COMPLETED the quest, +38 XP, and the line said the
 * record no longer carried it — COMPLETE_QUEST stamps `closedAtMessage`, a
 * flip or a retraction stamps the fact).
 */
export function diffCommitments(before, after) {
    const losses = [];
    const snapshotAt = before.messageCount ?? 0;
    const settledSince = (stamp) => Number.isFinite(stamp) && stamp >= snapshotAt;
    for (const [id, label] of before.quests) {
        if (after.quests.has(id) || settledSince(after.closedQuests?.get(id))) continue;
        losses.push({ kind: 'quest', label });
    }
    for (const [id, label] of before.facts) {
        if (after.facts.has(id) || settledSince(after.settledFacts?.get(id))) continue;
        losses.push({ kind: 'fact', label });
    }
    for (const [id, label] of before.threads) {
        if (after.threads.has(id) || settledSince(after.resolvedThreads?.get(id))) continue;
        losses.push({ kind: 'thread', label });
    }
    const carriers = (after.carriers || []).map(carryTokens).filter(set => set.size > 0);
    for (const [id, label] of before.promises) {
        if (after.promises.has(id)) continue;
        const lost = carryTokens(before.promiseTexts?.get(id) || label);
        if (lost.size > 0 && carriers.some(set => containment(lost, set) >= CARRIED_CONTAINMENT)) continue;
        losses.push({ kind: 'promise', label });
    }
    return losses;
}

const KIND_LABEL = {
    quest: 'the quest',
    fact: 'the pinned fact',
    thread: 'the open thread with',
    promise: 'the promise',
};

/** One line, or '' when nothing was lost. */
export function describeCommitmentLosses(losses) {
    if (!Array.isArray(losses) || losses.length === 0) return '';
    const items = losses.slice(0, 6).map(loss => `${KIND_LABEL[loss.kind] || loss.kind} "${loss.label}"`);
    const more = losses.length > 6 ? ` and ${losses.length - 6} more` : '';
    return `📓 Journal check — after this chapter summary the record no longer carries ${items.join('; ')}${more}. The DM will not see ${losses.length === 1 ? 'it' : 'them'} unless the fiction restores ${losses.length === 1 ? 'it' : 'them'}.`;
}

/**
 * Run the verifier against the live state once the cadence's writes have
 * landed; dispatches ONE `kind: 'error'` system line on a loss (an
 * infrastructure line — never retold as saga). Returns the losses.
 */
export function verifyCommitmentsAfterCadence(before, stateAfter, dispatch) {
    if (!before || !stateAfter) return [];
    const losses = diffCommitments(before, snapshotCommitments(stateAfter));
    const line = describeCommitmentLosses(losses);
    if (line && typeof dispatch === 'function') {
        dispatch({ type: 'ADD_MESSAGE', payload: { role: 'system', kind: 'error', content: line } });
    }
    return losses;
}
