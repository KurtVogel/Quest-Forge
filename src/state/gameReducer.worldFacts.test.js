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
