/**
 * Retraction follows the last witness, not the first message (memory-research
 * M0, 2026-10-28): the pure helpers — the witness list's append and load
 * typing, and THE retraction plan the reducer commits and ChatPanel reads.
 */
import { describe, expect, it } from 'vitest';
import { appendWitness, liveMessageIds, planRetraction, typeWitnesses, WITNESS_CAP } from './retraction.js';

const fact = (id, text, extra = {}) => ({ id, fact: text, category: 'general', knownBy: [], ...extra });
const card = (id, text, extra = {}) => ({ id, type: 'promise', text, status: 'active', ...extra });
const msgs = (...ids) => ids.map((id, i) => ({ id, role: i % 2 ? 'assistant' : 'user', content: 'x' }));

describe('appendWitness', () => {
    it('appends a restating message, dedupes, never the record\'s own source, and returns the same array on a no-op', () => {
        expect(appendWitness(undefined, 'a1', 'a3')).toEqual(['a3']);
        const held = ['a3'];
        expect(appendWitness(held, 'a1', 'a3')).toBe(held);
        expect(appendWitness(held, 'a1', 'a1')).toBe(held);
        expect(appendWitness(held, 'a1', null)).toBe(held);
        expect(appendWitness(held, 'a1', '  ')).toBe(held);
        expect(appendWitness(held, 'a1', 'a5')).toEqual(['a3', 'a5']);
    });
    it(`keeps the newest ${WITNESS_CAP}`, () => {
        let held = [];
        for (const id of ['a1', 'a2', 'a3', 'a4', 'a5', 'a6']) held = appendWitness(held, 's', id);
        expect(held).toEqual(['a3', 'a4', 'a5', 'a6']);
    });
});

describe('typeWitnesses (the load twin)', () => {
    it('keeps string ids the transcript holds, drops junk, the own source and duplicates, caps, and is undefined when nothing remains', () => {
        const ids = liveMessageIds([...msgs('u1', 'a1', 'u2', 'a2'), { id: 'a3', role: 'assistant', content: 'x', deleted: true }, { role: 'user', content: 'no id' }]);
        expect([...ids]).toEqual(['u1', 'a1', 'u2', 'a2']);
        expect(typeWitnesses(['a1', 'a2', 42, null, 'ghost', 'a2', 'a3', ''], { sourceMessage: 'a1', messageIds: ids })).toEqual(['a2']);
        expect(typeWitnesses(['a1'], { sourceMessage: 'a1' })).toBeUndefined();
        expect(typeWitnesses('a2', { sourceMessage: 'a1' })).toBeUndefined();
        expect(typeWitnesses(null)).toBeUndefined();
        // Without a transcript: typed but not pruned.
        expect(typeWitnesses(['x1', 'x2', 'x3', 'x4', 'x5'], { sourceMessage: 's' })).toEqual(['x2', 'x3', 'x4', 'x5']);
    });
});

describe('planRetraction', () => {
    const state = {
        messages: msgs('u1', 'a1', 'u2', 'a2', 'u3', 'a3'),
        worldFacts: [
            fact('f-lone', 'The harbor road is flooded.', { sourceMessage: 'a1' }),
            fact('f-restated', 'Rarg is dead.', { sourceMessage: 'a1', witnesses: ['a2', 'a3'] }),
            fact('f-other', 'Odo owns the ferry.', { sourceMessage: 'a2', witnesses: ['a1'] }),
            fact('f-buried', 'The gate is open.', { sourceMessage: 'a1', supersededBy: 'f-x' }),
            fact('f-unsourced', 'Saltmere lies on the coast.'),
        ],
        storyMemory: [
            card('c-lone', 'The hero swore to bring the ledger back.', { sourceMessage: 'a1' }),
            card('c-restated', 'Orsa warned the hero off the docks.', { sourceMessage: 'a1', witnesses: ['a3'] }),
            card('c-resolved', 'A paid promise.', { sourceMessage: 'a1', status: 'resolved' }),
        ],
    };

    it('removing the SOURCE retracts a record with no surviving witness and KEEPS one restated later — source moved to the newest witness, which leaves the list', () => {
        const plan = planRetraction(state, 'a1');
        expect(plan.retractedFacts.map(f => f.id)).toEqual(['f-lone']);
        expect(plan.keptFacts.map(f => f.id)).toEqual(['f-restated']);
        expect(plan.retractedCards.map(c => c.id)).toEqual(['c-lone']);
        expect(plan.keptCards.map(c => c.id)).toEqual(['c-restated']);
        const byId = Object.fromEntries(plan.worldFacts.map(f => [f.id, f]));
        expect(byId['f-lone'].retractedAtMessage).toBe(6);
        expect(byId['f-restated']).toMatchObject({ sourceMessage: 'a3', witnesses: ['a2'] });
        expect(byId['f-restated'].retractedAtMessage).toBeUndefined();
        // A record that merely WITNESSED a1 loses that witness, nothing more.
        expect(byId['f-other']).toEqual(fact('f-other', 'Odo owns the ferry.', { sourceMessage: 'a2' }));
        expect(byId['f-other'].witnesses).toBeUndefined();
        // Outside the live set: untouched.
        expect(byId['f-buried']).toBe(state.worldFacts[3]);
        expect(byId['f-unsourced']).toBe(state.worldFacts[4]);
        const cards = Object.fromEntries(plan.storyMemory.map(c => [c.id, c]));
        expect(cards['c-lone']).toMatchObject({ status: 'dormant', retractedAtMessage: 6 });
        expect(cards['c-restated']).toMatchObject({ status: 'active', sourceMessage: 'a3' });
        expect(cards['c-restated'].witnesses).toBeUndefined();
        expect(cards['c-resolved']).toBe(state.storyMemory[2]);
        expect(plan.factsChanged).toBe(true);
        expect(plan.cardsChanged).toBe(true);
    });

    it('a witness already DELETED does not survive: with every witness gone the record is retracted', () => {
        const dead = { ...state, messages: state.messages.map(m => (m.id === 'a2' || m.id === 'a3' ? { ...m, deleted: true } : m)) };
        const plan = planRetraction(dead, 'a1');
        expect(plan.retractedFacts.map(f => f.id)).toEqual(['f-lone', 'f-restated']);
        expect(plan.keptFacts).toEqual([]);
        expect(plan.retractedCards.map(c => c.id)).toEqual(['c-lone', 'c-restated']);
    });

    it('removing a WITNESS alone drops it from the list — nothing retracted, nothing kept, the list still changed', () => {
        const plan = planRetraction(state, 'a3');
        expect(plan.retractedFacts).toEqual([]);
        expect(plan.keptFacts).toEqual([]);
        expect(plan.retractedCards).toEqual([]);
        expect(plan.keptCards).toEqual([]);
        expect(plan.factsChanged).toBe(true);
        expect(plan.cardsChanged).toBe(true);
        expect(plan.worldFacts.find(f => f.id === 'f-restated')).toMatchObject({ sourceMessage: 'a1', witnesses: ['a2'] });
        expect(plan.storyMemory.find(c => c.id === 'c-restated').witnesses).toBeUndefined();
        expect(plan.storyMemory.find(c => c.id === 'c-restated').sourceMessage).toBe('a1');
    });

    it('the ChatPanel contract: the retract list carries only the RETRACTED facts, the keep list the kept ones with their new source; junk ids and untouched messages plan nothing', () => {
        const plan = planRetraction(state, 'a1');
        expect(plan.retractedFacts.map(f => f.fact)).toEqual(['The harbor road is flooded.']);
        expect(plan.retractedFacts.map(f => f.fact)).not.toContain('Rarg is dead.');
        expect(plan.keptFacts.map(f => [f.fact, f.sourceMessage])).toEqual([['Rarg is dead.', 'a3']]);
        for (const id of ['u1', 'nope', null, '']) {
            const quiet = planRetraction(state, id);
            expect(quiet.worldFacts).toEqual(state.worldFacts);
            expect(quiet.storyMemory).toEqual(state.storyMemory);
            expect(quiet.factsChanged).toBe(false);
            expect(quiet.cardsChanged).toBe(false);
        }
        // Junk lists are no lists.
        expect(planRetraction({ messages: null, worldFacts: 'x', storyMemory: 7 }, 'a1')).toMatchObject({ worldFacts: [], storyMemory: [], retractedFacts: [] });
    });
});
