/**
 * Retraction follows the last witness, not the first message (memory-research
 * M0, 2026-10-28, D1/D3; built 2026-10-30).
 *
 * A fact or story card is SOURCE-stamped with the DM message the lane read it
 * from (`sourceMessage`, 2026-09-30), and removing that message retracts it.
 * But a restatement is NOT nothing: the Scribe re-reports the same truth from
 * a later turn, the record judges it a duplicate and drops it — and the only
 * source the record knew was the FIRST message. Measured (G1 scratch): a fact
 * minted at message 1 and restated at message 3 died with message 1's ✕,
 * though the fiction had said it twice.
 *
 * Now a duplicate verdict STAMPS A WITNESS: the restating message's id joins
 * the held record's `witnesses` (cap WITNESS_CAP, newest kept, never the
 * record's own source). `planRetraction` is THE judgement DELETE_MESSAGE
 * commits and ChatPanel reads for the RAG store: a record whose source is
 * removed is retracted ONLY when no witness survives; otherwise its source
 * moves to the newest surviving witness and the record is KEPT. Removing a
 * witness message alone just drops it from the list. Pure, no I/O.
 */
import { isLiveFact } from './worldFacts.js';

/** How many restating messages a record remembers (newest kept). */
export const WITNESS_CAP = 4;
const WITNESS_ID_MAX = 80;

function cleanWitnessId(id) {
    return typeof id === 'string' && id.trim() ? id.trim().slice(0, WITNESS_ID_MAX) : null;
}

/**
 * The held record's witness list with `messageId` appended: deduped, the
 * record's own `sourceMessage` never a witness of itself, the newest
 * WITNESS_CAP kept (oldest fall off first). Returns the SAME array when
 * nothing changes so a reducer can tell a no-op from a write.
 */
export function appendWitness(witnesses, sourceMessage, messageId) {
    const held = Array.isArray(witnesses) ? witnesses : [];
    const id = cleanWitnessId(messageId);
    if (!id || id === sourceMessage) return held;
    if (held.includes(id)) return held;
    return [...held, id].slice(-WITNESS_CAP);
}

/**
 * The load twin: string ids only, deduped, the record's own source dropped,
 * capped at WITNESS_CAP (newest kept). When the transcript's ids are given
 * (`messageIds`, a Set — the LIVE rows, a deleted row is no witness), an id
 * the transcript does not hold is dropped. `undefined` when nothing remains,
 * so the key is absent rather than an empty list.
 */
export function typeWitnesses(witnesses, { sourceMessage = null, messageIds = null } = {}) {
    if (!Array.isArray(witnesses)) return undefined;
    const out = [];
    for (const raw of witnesses) {
        const id = cleanWitnessId(raw);
        if (!id || id === sourceMessage || out.includes(id)) continue;
        if (messageIds instanceof Set && !messageIds.has(id)) continue;
        out.push(id);
    }
    return out.length > 0 ? out.slice(-WITNESS_CAP) : undefined;
}

/** The ids of the transcript rows that still stand (not soft-deleted). */
export function liveMessageIds(messages) {
    const ids = new Set();
    for (const msg of (Array.isArray(messages) ? messages : [])) {
        if (msg && typeof msg.id === 'string' && msg.id && !msg.deleted) ids.add(msg.id);
    }
    return ids;
}

/**
 * Retract or re-source ONE record whose `sourceMessage` is being removed.
 * Returns `{ kind: 'retracted' }` when no witness survives, else
 * `{ kind: 'kept', record }` with the source moved to the newest surviving
 * witness (that id leaves `witnesses`; dead witnesses are dropped too).
 */
function resolveSourceLoss(record, survivors) {
    const witnesses = (Array.isArray(record.witnesses) ? record.witnesses : []).filter(id => survivors.has(id));
    if (witnesses.length === 0) return { kind: 'retracted' };
    const sourceMessage = witnesses[witnesses.length - 1];
    const rest = witnesses.slice(0, -1);
    const { witnesses: _old, ...withoutWitnesses } = record;
    return { kind: 'kept', record: { ...withoutWitnesses, sourceMessage, ...(rest.length > 0 && { witnesses: rest }) } };
}

/** A record that merely WITNESSED the removed message loses that witness; same object when untouched. */
function dropWitness(record, messageId) {
    if (!Array.isArray(record.witnesses) || !record.witnesses.includes(messageId)) return record;
    const rest = record.witnesses.filter(id => id !== messageId);
    const { witnesses: _old, ...withoutWitnesses } = record;
    return rest.length > 0 ? { ...withoutWitnesses, witnesses: rest } : withoutWitnesses;
}

/**
 * THE retraction plan for removing `messageId` (pure): the next `worldFacts`
 * and `storyMemory`, the facts / cards RETRACTED (left the live set — the
 * RAG rows ChatPanel removes), the facts / cards KEPT (re-sourced to their
 * newest surviving witness — the RAG rows ChatPanel retags), and whether
 * either list changed at all (a witness-only drop changes the list but
 * retracts and keeps nothing). The reducer commits it; ChatPanel calls it
 * with the SAME pre-delete state, so both read one judgement.
 *
 * A fact already superseded or retracted, and a card not `active`, are
 * outside the live set and untouched — the record is history there.
 */
export function planRetraction(state, messageId) {
    const id = typeof messageId === 'string' && messageId ? messageId : null;
    const facts = Array.isArray(state?.worldFacts) ? state.worldFacts : [];
    const cards = Array.isArray(state?.storyMemory) ? state.storyMemory : [];
    const plan = {
        worldFacts: facts, storyMemory: cards,
        retractedFacts: [], keptFacts: [], retractedCards: [], keptCards: [],
        factsChanged: false, cardsChanged: false,
    };
    if (!id) return plan;
    const messageCount = Array.isArray(state?.messages) ? state.messages.length : 0;
    const survivors = liveMessageIds(state?.messages);
    survivors.delete(id);

    plan.worldFacts = facts.map(fact => {
        if (!fact || typeof fact !== 'object') return fact;
        if (fact.sourceMessage !== id) {
            const next = dropWitness(fact, id);
            if (next !== fact) plan.factsChanged = true;
            return next;
        }
        if (!isLiveFact(fact)) return fact;
        const verdict = resolveSourceLoss(fact, survivors);
        plan.factsChanged = true;
        if (verdict.kind === 'retracted') {
            plan.retractedFacts.push(fact);
            return { ...fact, retractedAtMessage: messageCount };
        }
        plan.keptFacts.push(verdict.record);
        return verdict.record;
    });

    plan.storyMemory = cards.map(card => {
        if (!card || typeof card !== 'object') return card;
        if (card.sourceMessage !== id) {
            const next = dropWitness(card, id);
            if (next !== card) plan.cardsChanged = true;
            return next;
        }
        if ((card.status || 'active') !== 'active') return card;
        const verdict = resolveSourceLoss(card, survivors);
        plan.cardsChanged = true;
        if (verdict.kind === 'retracted') {
            plan.retractedCards.push(card);
            return { ...card, status: 'dormant', retractedAtMessage: messageCount };
        }
        plan.keptCards.push(verdict.record);
        return verdict.record;
    });

    return plan;
}
