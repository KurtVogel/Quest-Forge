import { describe, expect, it } from 'vitest';
import { gameReducer, initialGameState } from './gameReducer.js';

describe('pending roleplay check state', () => {
    const proposal = {
        rolls: [{ type: 'skill_check', skill: 'insight', dc: 10, description: 'Read the envoy' }],
        playerAction: 'I watch the envoy carefully.',
        challengeUsed: false,
    };

    it('stores and clears a proposal without rolling', () => {
        const proposed = gameReducer(initialGameState, { type: 'PROPOSE_ROLEPLAY_CHECK', payload: proposal });
        expect(proposed.pendingRoleplayCheck).toMatchObject(proposal);
        expect(proposed.rollHistory).toEqual([]);

        const cleared = gameReducer(proposed, { type: 'CLEAR_ROLEPLAY_CHECK' });
        expect(cleared.pendingRoleplayCheck).toBeNull();
    });

    it('does not create a roleplay proposal during active combat', () => {
        const combatState = { ...initialGameState, combat: { ...initialGameState.combat, active: true } };
        expect(gameReducer(combatState, { type: 'PROPOSE_ROLEPLAY_CHECK', payload: proposal })).toBe(combatState);
    });
});
