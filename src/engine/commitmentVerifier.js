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

const text = (value) => (typeof value === 'string' ? value.trim() : '');

/** The commitments as they stand now: `{ quests, facts, threads, promises }`, each a Map of id → label. */
export function snapshotCommitments(state = {}) {
    const quests = new Map();
    for (const quest of (Array.isArray(state.quests) ? state.quests : [])) {
        if (quest && typeof quest.id === 'string' && (quest.status || 'active') === 'active') quests.set(quest.id, text(quest.name) || quest.id);
    }
    const facts = new Map();
    for (const fact of (Array.isArray(state.worldFacts) ? state.worldFacts : [])) {
        if (fact && fact.pinned === true && typeof fact.id === 'string' && isLiveFact(fact)) facts.set(fact.id, text(fact.fact).slice(0, 80));
    }
    const threads = new Map();
    for (const npc of (Array.isArray(state.npcs) ? state.npcs : [])) {
        if (npc && typeof npc.id === 'string' && text(npc.openThread)) threads.set(npc.id, text(npc.name) || npc.id);
    }
    const promises = new Map();
    for (const card of (Array.isArray(state.storyMemory) ? state.storyMemory : [])) {
        if (card && card.type === 'promise' && (card.status || 'active') === 'active' && typeof card.id === 'string') {
            promises.set(card.id, text(card.text).slice(0, 80) || card.id);
        }
    }
    return { quests, facts, threads, promises };
}

/**
 * What `before` had that `after` no longer carries: `[{ kind, label }]`.
 * A quest is lost when it is gone or no longer active; a pinned fact when it
 * is no longer live; a thread when the NPC's `openThread` is empty (a
 * REPLACED thread is not a loss — the cadence may move the beat); a promise
 * card when it is no longer active.
 */
export function diffCommitments(before, after) {
    const losses = [];
    for (const [id, label] of before.quests) if (!after.quests.has(id)) losses.push({ kind: 'quest', label });
    for (const [id, label] of before.facts) if (!after.facts.has(id)) losses.push({ kind: 'fact', label });
    for (const [id, label] of before.threads) if (!after.threads.has(id)) losses.push({ kind: 'thread', label });
    for (const [id, label] of before.promises) if (!after.promises.has(id)) losses.push({ kind: 'promise', label });
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
