import { describe, expect, it } from 'vitest';
import { gameReducer, initialGameState } from './gameReducer.js';

function stateWithFacts(facts) {
    return {
        ...initialGameState,
        worldFacts: facts.map((fact, i) => ({ id: `fact-${i}`, fact, category: 'event', timestamp: i })),
    };
}

describe('world-fact near-duplicate guard', () => {
    it('adds genuinely new facts in bulk', () => {
        const next = gameReducer(stateWithFacts(['The bandit captain Rarg is dead.']), {
            type: 'ADD_WORLD_FACTS',
            payload: [
                { fact: 'The village of Millhaven burned to the ground.', category: 'location' },
                { fact: 'Serah now leads the dockworkers.', category: 'character' },
            ],
        });
        expect(next.worldFacts).toHaveLength(3);
    });

    it('rejects an exact duplicate regardless of casing and punctuation', () => {
        const state = stateWithFacts(['The bandit captain Rarg is dead.']);
        const next = gameReducer(state, {
            type: 'ADD_WORLD_FACTS',
            payload: [{ fact: 'the bandit captain Rarg is dead' }],
        });
        expect(next).toBe(state);
    });

    it('rejects a restatement whose meaningful tokens are contained in an existing fact', () => {
        const state = stateWithFacts(['Odo Ferrin is dead, killed at the docks during the smuggler raid.']);
        const next = gameReducer(state, {
            type: 'ADD_WORLD_FACTS',
            payload: [{ fact: 'Odo Ferrin was killed at the docks.' }],
        });
        expect(next).toBe(state);
    });

    it('rejects the longer restatement of an existing shorter fact', () => {
        const state = stateWithFacts(['Odo Ferrin is dead.']);
        const next = gameReducer(state, {
            type: 'ADD_WORLD_FACTS',
            payload: [{ fact: 'Odo Ferrin is now dead.' }],
        });
        expect(next).toBe(state);
    });

    it('keeps facts that merely share a subject but state something different', () => {
        const state = stateWithFacts(['Odo Ferrin is dead.']);
        const next = gameReducer(state, {
            type: 'ADD_WORLD_FACTS',
            payload: [{ fact: 'Odo Ferrin secretly owned the Brine Rat tavern.' }],
        });
        expect(next.worldFacts).toHaveLength(2);
    });

    it('dedupes near-identical facts arriving within the same batch', () => {
        const next = gameReducer(stateWithFacts([]), {
            type: 'ADD_WORLD_FACTS',
            payload: [
                { fact: 'The north bridge collapsed into the river.' },
                { fact: 'The north bridge has collapsed into the river.' },
            ],
        });
        expect(next.worldFacts).toHaveLength(1);
    });

    it('applies the same guard to single-fact adds', () => {
        const state = stateWithFacts(['The treaty between Harrowmont and the Guild is broken.']);
        const next = gameReducer(state, {
            type: 'ADD_WORLD_FACT',
            payload: { fact: 'The treaty between Harrowmont and the Guild is now broken!' },
        });
        expect(next).toBe(state);
    });
});

describe('world-fact hostile-input type guard (2026-07-23 audit)', () => {
    it('rejects non-string facts instead of persisting a prompt-crashing record', () => {
        const state = stateWithFacts(['The bandit captain Rarg is dead.']);
        const next = gameReducer(state, {
            type: 'ADD_WORLD_FACTS',
            payload: [
                { fact: 42, category: 'event' },
                { fact: ['an', 'array'], category: 'event' },
                { fact: { nested: 'object' } },
                'not-an-object',
                null,
            ],
        });
        expect(next).toBe(state); // nothing usable — state untouched
    });

    it('coerces a non-string category to general and clamps fact length', () => {
        const next = gameReducer(stateWithFacts([]), {
            type: 'ADD_WORLD_FACTS',
            payload: [{ fact: 'X'.repeat(1000) + ' unique trailing detail', category: { weird: true } }],
        });
        expect(next.worldFacts).toHaveLength(1);
        expect(next.worldFacts[0].category).toBe('general');
        expect(next.worldFacts[0].fact.length).toBeLessThanOrEqual(400);
        expect(() => next.worldFacts[0].fact.toLowerCase()).not.toThrow();
    });

    it('applies the same guard to the singular ADD_WORLD_FACT path', () => {
        const state = stateWithFacts([]);
        expect(gameReducer(state, { type: 'ADD_WORLD_FACT', payload: { fact: 42 } })).toBe(state);
        const next = gameReducer(state, { type: 'ADD_WORLD_FACT', payload: { fact: 'A real fact.', category: 7 } });
        expect(next.worldFacts[0]).toMatchObject({ fact: 'A real fact.', category: 'general' });
    });

    it('LOAD_GAME heals poisoned saves: fixable records re-typed, unfixable dropped', () => {
        const save = {
            ...initialGameState,
            character: { name: 'Hero', race: 'human', class: 'fighter', level: 1, currentHP: 10, maxHP: 10, abilityScores: { strength: 10, dexterity: 10, constitution: 10, intelligence: 10, wisdom: 10, charisma: 10 } },
            worldFacts: [
                { id: 'ok', fact: 'The mill burned down.', category: 'event', timestamp: 1 },
                { id: 'bad-cat', fact: 'Serah leads the dockworkers.', category: 9, timestamp: 2 },
                { id: 'poison', fact: { oops: true }, category: 'event', timestamp: 3 },
            ],
        };
        const loaded = gameReducer(initialGameState, { type: 'LOAD_GAME', payload: save });
        const facts = loaded.worldFacts;
        expect(facts.map(f => f.id)).toEqual(['ok', 'bad-cat']);
        expect(facts[1].category).toBe('general');
        for (const f of facts) expect(typeof f.fact).toBe('string');
    });
});
