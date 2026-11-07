/**
 * The 2026-11-05 strengthening queue, roll-resolution (from the 2026-11-01
 * Lap 2 audit): the arbiter's `approved` and `pre_narrated_outcome_detected`
 * are TRI-STATE — true / 'true' approves (or flags), false / 'false' rejects,
 * omitted or junk is NO verdict: the sync floor decides the roll, and the
 * orchestrator's regex belt decides the pre-narration.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { sendMessage } = vi.hoisted(() => ({ sendMessage: vi.fn() }));
vi.mock('../llm/adapter.js', () => ({ sendMessage }));

import { reviewOutsideCombatRolls } from './outOfCombatRollPolicy.js';
import { triFlag } from './text.js';

const SETTINGS = { apiKey: 'test-key', llmProvider: 'gemini', model: 'gemini-3.5-flash-lite' };
const haggle = { type: 'skill_check', skill: 'persuasion', dc: 12, description: 'Talk the merchant down on the price' };
const belief = { type: 'skill_check', skill: 'persuasion', dc: 12, description: 'Convince Galdric of your innocent intentions' };
const truthful = 'It was my mother\'s. I tell the truth here.';

function arbiter(body) {
    sendMessage.mockResolvedValue(JSON.stringify(body));
}

describe('arbiter verdict tri-state (2026-11-05)', () => {
    beforeEach(() => sendMessage.mockReset());

    it('triFlag: true / false words, undefined for absence and junk', () => {
        for (const v of [true, 'true', ' TRUE ', 'yes', 1]) expect(triFlag(v)).toBe(true);
        for (const v of [false, 'false', 'no', 0, '0']) expect(triFlag(v)).toBe(false);
        for (const v of [undefined, null, '', '  ', 'maybe', 'approved', 2, {}, [], 'none']) expect(triFlag(v)).toBeUndefined();
    });

    it('approved omitted → no verdict: the sync floor approves an ordinary check', async () => {
        arbiter({ rolls_evaluation: [{ index: 0, reason: 'Genuine haggling.' }], pre_narrated_outcome_detected: false });
        const review = await reviewOutsideCombatRolls([haggle], 'I haggle with the merchant.', 'narrative', SETTINGS);
        expect(review.acceptedRolls).toEqual([haggle]);
        expect(review.rejectedRolls).toEqual([]);
    });

    // Flipped 2026-11-08 (identity by reference, lane 11): the regex floor is
    // gone — no verdict means the roll stands, even on a line the old word
    // rules would have read as a belief check.
    it('approved omitted → no verdict: the roll stands (was: the sync floor still rejects)', async () => {
        arbiter({ rolls_evaluation: [{ index: 0 }] });
        const review = await reviewOutsideCombatRolls([belief], truthful, 'narrative', SETTINGS);
        expect(review.acceptedRolls).toEqual([belief]);
        expect(review.rejectedRolls).toEqual([]);
    });

    it("approved: 'yes' approves; junk ('maybe') is no verdict; 'false' still rejects", async () => {
        arbiter({ rolls_evaluation: [{ index: 0, approved: 'yes' }] });
        expect((await reviewOutsideCombatRolls([haggle], 'I haggle.', 'narrative', SETTINGS)).acceptedRolls).toEqual([haggle]);
        arbiter({ rolls_evaluation: [{ index: 0, approved: 'maybe' }] });
        expect((await reviewOutsideCombatRolls([haggle], 'I haggle.', 'narrative', SETTINGS)).acceptedRolls).toEqual([haggle]);
        arbiter({ rolls_evaluation: [{ index: 0, approved: 'false' }] });
        expect((await reviewOutsideCombatRolls([haggle], 'I haggle.', 'narrative', SETTINGS)).rejectedRolls).toEqual([haggle]);
    });

    it("pre_narrated_outcome_detected: the string 'true' is true; 'false' is false", async () => {
        arbiter({ rolls_evaluation: [{ index: 0, approved: true }], pre_narrated_outcome_detected: 'true' });
        expect((await reviewOutsideCombatRolls([haggle], 'I haggle.', 'narrative', SETTINGS)).preNarrated).toBe(true);
        arbiter({ rolls_evaluation: [{ index: 0, approved: true }], pre_narrated_outcome_detected: 'false' });
        expect((await reviewOutsideCombatRolls([haggle], 'I haggle.', 'narrative', SETTINGS)).preNarrated).toBe(false);
    });

    it('pre_narrated_outcome_detected omitted or junk → undefined, so the regex belt runs', async () => {
        arbiter({ rolls_evaluation: [{ index: 0, approved: true }] });
        expect((await reviewOutsideCombatRolls([haggle], 'I haggle.', 'narrative', SETTINGS)).preNarrated).toBeUndefined();
        arbiter({ rolls_evaluation: [{ index: 0, approved: true }], pre_narrated_outcome_detected: 'unclear' });
        expect((await reviewOutsideCombatRolls([haggle], 'I haggle.', 'narrative', SETTINGS)).preNarrated).toBeUndefined();
    });
});
