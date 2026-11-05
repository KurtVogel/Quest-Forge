/**
 * The 2026-11-05 strengthening queue, roll-resolution (from the 2026-11-01
 * Lap 2 audit, test depth): a stored proposal carries at most six rolls.
 */
import { describe, expect, it } from 'vitest';
import { sanitizePendingRoleplayCheck } from './roleplayCheck.js';

const roll = (i) => ({ type: 'skill_check', skill: 'athletics', dc: 10 + i, description: `Climb pitch ${i}` });

describe('the proposal roll cap (2026-11-05)', () => {
    it('a proposal with 7+ rolls keeps the first six, in order', () => {
        const proposal = sanitizePendingRoleplayCheck({ rolls: Array.from({ length: 9 }, (_, i) => roll(i)), playerAction: 'I climb.' });
        expect(proposal.rolls).toHaveLength(6);
        expect(proposal.rolls.map(r => r.dc)).toEqual([10, 11, 12, 13, 14, 15]);
    });

    it('junk entries count toward nothing before the cap; six valid rolls survive', () => {
        const proposal = sanitizePendingRoleplayCheck({ rolls: [null, 'x', 7, ...Array.from({ length: 7 }, (_, i) => roll(i))] });
        expect(proposal.rolls).toHaveLength(6);
        expect(proposal.rolls[0].dc).toBe(10);
    });
});
