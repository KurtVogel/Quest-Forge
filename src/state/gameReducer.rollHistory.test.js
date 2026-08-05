/**
 * Live rollHistory bound: only 50 rolls are persisted, 20 render, 5 reach the
 * prompt — but every append site grew the live array unbounded for the whole
 * session (2026-08-01 audit). All six sites route through appendRollHistory.
 */
import { describe, expect, it } from 'vitest';
import { gameReducer, initialGameState } from './gameReducer.js';

const makeRoll = (i) => ({
    id: `roll-${i}`,
    timestamp: i,
    notation: '1d20+0',
    dice: { count: 1, sides: 20 },
    rolls: [10],
    subtotal: 10,
    modifier: 0,
    total: 10,
    description: `Roll ${i}`,
    isCritical: false,
    isCritFail: false,
});

describe('rollHistory cap', () => {
    it('keeps only the newest 50 rolls in live state', () => {
        let state = initialGameState;
        for (let i = 0; i < 60; i++) {
            state = gameReducer(state, { type: 'ADD_ROLL', payload: makeRoll(i) });
        }
        expect(state.rollHistory).toHaveLength(50);
        expect(state.rollHistory[0].id).toBe('roll-10'); // oldest 10 dropped
        expect(state.rollHistory[49].id).toBe('roll-59'); // newest kept
    });
});
