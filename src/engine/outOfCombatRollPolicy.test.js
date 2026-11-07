import { describe, expect, it, vi, beforeEach } from 'vitest';

const { sendMessage } = vi.hoisted(() => ({ sendMessage: vi.fn() }));
vi.mock('../llm/adapter.js', () => ({ sendMessage }));

import { playerAuthorityRollCorrectionPrompt, reviewOutsideCombatRolls } from './outOfCombatRollPolicy.js';
import { MACHINERY_MODEL } from '../llm/machinery.js';

const SETTINGS = { apiKey: 'test-key', llmProvider: 'gemini', model: 'gemini-3.5-flash-lite' };

// Flipped 2026-11-08 (identity by reference, lane 11): the regex rules that
// decided here without an arbiter (truth / demeanor / attack-as-check word
// lists) are gone. Without an arbiter every proposed roll stands and the
// player's card can Challenge it; the arbiter's verdict is the only reader.
describe('outside-combat roll policy without an arbiter (lane 11)', () => {
    const cases = [
        [{ type: 'skill_check', skill: 'persuasion', dc: 12, description: 'Convince Galdric of your innocent intentions' }, 'It was my mother\'s. I tell the truth here.'],
        [{ type: 'skill_check', skill: 'constitution', dc: 12, description: 'Maintain a stoic, emotionless facade as they strap you down' }, 'I use all my strength to remain calm, truthful and stoic.'],
        [{ type: 'skill_check', skill: 'strength', dc: 12, description: 'Attack the lookout with your longsword' }, 'I attack the lookout with my longsword.'],
        [{ type: 'saving_throw', skill: 'wisdom', dc: 12, description: 'Resist supernatural fear and remain calm' }, 'I remain calm and stoic before the apparition.'],
    ];

    it('every proposed roll stands when no settings carry a key — the three old word rules decide nothing', async () => {
        for (const [roll, line] of cases) {
            const review = await reviewOutsideCombatRolls([roll], line);
            expect(review.acceptedRolls).toEqual([roll]);
            expect(review.rejectedRolls).toEqual([]);
            expect(review.attackAsCheck).toBe(false);
        }
    });

    it('keeps NPC disbelief available without dice or invented player behavior', () => {
        const prompt = playerAuthorityRollCorrectionPrompt();
        expect(prompt).toContain('NPCs are not forced to believe or admire it');
        expect(prompt).toContain('established motives, knowledge, evidence, prejudice, and suspicions');
        expect(prompt).toContain('do not invent stammering, dishonesty, cowardice, or incompetence');
        expect(prompt).toContain('emit no JSON');
    });
});

describe('reviewOutsideCombatRolls LLM-arbiter path', () => {
    const roll = { type: 'skill_check', skill: 'persuasion', dc: 12, description: 'Convince the merchant to lower the price' };

    beforeEach(() => {
        sendMessage.mockReset();
    });

    it('every roll stands when no API key is configured (was: the sync regex rules)', async () => {
        const review = await reviewOutsideCombatRolls([roll], 'I make my case.', 'The merchant listens.', null);
        expect(sendMessage).not.toHaveBeenCalled();
        expect(review.acceptedRolls).toEqual([roll]);
    });

    it('every roll stands when the player message is empty', async () => {
        const review = await reviewOutsideCombatRolls([roll], '', 'narrative', SETTINGS);
        expect(sendMessage).not.toHaveBeenCalled();
        expect(review.acceptedRolls).toEqual([roll]);
    });

    it('no rolls, nothing to review', async () => {
        const review = await reviewOutsideCombatRolls([], 'I make my case.', 'narrative', SETTINGS);
        expect(sendMessage).not.toHaveBeenCalled();
        expect(review.acceptedRolls).toEqual([]);
    });

    it('approves a roll the arbiter approves and reports pre-narration detection', async () => {
        sendMessage.mockResolvedValue(JSON.stringify({
            rolls_evaluation: [{ index: 0, approved: true, reason: 'Genuine haggling under opposition.' }],
            pre_narrated_outcome_detected: true,
        }));
        const review = await reviewOutsideCombatRolls([roll], 'I haggle with the merchant.', 'narrative', SETTINGS);
        expect(review.acceptedRolls).toEqual([roll]);
        expect(review.rejectedRolls).toEqual([]);
        expect(review.preNarrated).toBe(true);
    });

    it('rejects a roll the arbiter rejects', async () => {
        sendMessage.mockResolvedValue(JSON.stringify({
            rolls_evaluation: [{ index: 0, approved: false, reason: 'Belief-only check on a truthful statement.' }],
            pre_narrated_outcome_detected: false,
        }));
        const review = await reviewOutsideCombatRolls([roll], 'I haggle with the merchant.', 'narrative', SETTINGS);
        expect(review.acceptedRolls).toEqual([]);
        expect(review.rejectedRolls).toEqual([roll]);
    });

    it('accepts a roll with no matching evaluation entry — no verdict means the roll stands', async () => {
        sendMessage.mockResolvedValue(JSON.stringify({ rolls_evaluation: [], pre_narrated_outcome_detected: false }));
        const review = await reviewOutsideCombatRolls([roll], 'I haggle with the merchant.', 'narrative', SETTINGS);
        expect(review.acceptedRolls).toEqual([roll]);
    });

    // Revised 2026-11-08 (lane 11): the arbiter's verdict stands; the regex
    // floor of 2026-09-02 is gone. The coercion and tri-state pins hold.
    describe('the arbiter\'s verdict stands, roll by roll (was: the sync rules are the floor, 2026-09-02)', () => {
        const belief = { type: 'skill_check', skill: 'persuasion', dc: 12, description: 'Convince Galdric of your innocent intentions' };
        const truthful = 'It was my mother\'s. I tell the truth here.';

        it('coerces a string index instead of reading it as a missing (approved) entry', async () => {
            sendMessage.mockResolvedValue(JSON.stringify({
                rolls_evaluation: [{ index: '0', approved: false, violation: 'agency', reason: 'Belief-only.' }],
            }));
            const review = await reviewOutsideCombatRolls([roll], 'I haggle with the merchant.', 'narrative', SETTINGS);
            expect(review.rejectedRolls).toEqual([roll]);
            expect(review.acceptedRolls).toEqual([]);
        });

        it('treats approved: "false" (string) as a rejection', async () => {
            sendMessage.mockResolvedValue(JSON.stringify({
                rolls_evaluation: [{ index: 0, approved: 'false', reason: 'Belief-only.' }],
            }));
            const review = await reviewOutsideCombatRolls([roll], 'I haggle with the merchant.', 'narrative', SETTINGS);
            expect(review.rejectedRolls).toEqual([roll]);
        });

        it('a missing entry is no verdict: the roll stands, whatever the old word rules would have said', async () => {
            sendMessage.mockResolvedValue(JSON.stringify({ rolls_evaluation: [] }));
            const review = await reviewOutsideCombatRolls([belief], truthful, 'narrative', SETTINGS);
            expect(review.acceptedRolls).toEqual([belief]);
            expect(review.rejectedRolls).toEqual([]);
        });

        it('an arbiter approve stands even on "I attack the lookout" (the 2026-09-02 floor is gone); an arbiter attack rejection still flags attackAsCheck', async () => {
            const attackCheck = { type: 'skill_check', skill: 'strength', dc: 12, description: 'Strike the lookout down before he shouts' };
            sendMessage.mockResolvedValue(JSON.stringify({
                rolls_evaluation: [{ index: 0, approved: true, reason: 'Looks fine to me.' }],
            }));
            const approved = await reviewOutsideCombatRolls([attackCheck], 'I attack the lookout with my longsword.', 'narrative', SETTINGS);
            expect(approved.acceptedRolls).toEqual([attackCheck]);
            expect(approved.attackAsCheck).toBe(false);

            sendMessage.mockResolvedValue(JSON.stringify({
                rolls_evaluation: [{ index: 0, approved: false, violation: 'attack', reason: 'An overt attack is combat.' }],
            }));
            const rejected = await reviewOutsideCombatRolls([attackCheck], 'I attack the lookout with my longsword.', 'narrative', SETTINGS);
            expect(rejected.rejectedRolls).toEqual([attackCheck]);
            expect(rejected.attackAsCheck).toBe(true);
        });

        it('an arbiter agency rejection lands on its roll alone', async () => {
            sendMessage.mockResolvedValue(JSON.stringify({
                rolls_evaluation: [{ index: 0, approved: false, violation: 'agency', reason: 'Demeanor check.' }, { index: 1, approved: true }],
            }));
            const other = { type: 'skill_check', skill: 'athletics', dc: 10, description: 'Vault the fence' };
            const review = await reviewOutsideCombatRolls([roll, other], 'I haggle, then vault the fence.', 'narrative', SETTINGS);
            expect(review.rejectedRolls).toEqual([roll]);
            expect(review.acceptedRolls).toEqual([other]);
            expect(review.attackAsCheck).toBe(false);
        });
    });

    it('every roll stands when the response has no extractable JSON', async () => {
        sendMessage.mockResolvedValue('The merchant seems suspicious.');
        const review = await reviewOutsideCombatRolls([roll], 'I make my case.', 'narrative', SETTINGS);
        expect(review.acceptedRolls).toEqual([roll]);
        expect(review.preNarrated).toBeUndefined();
    });

    it('every roll stands when the JSON is malformed', async () => {
        sendMessage.mockResolvedValue('```json\n{ rolls_evaluation: [not valid json] }\n```');
        const review = await reviewOutsideCombatRolls([roll], 'I make my case.', 'narrative', SETTINGS);
        expect(review.acceptedRolls).toEqual([roll]);
    });

    it('every roll stands when rolls_evaluation is not an array', async () => {
        sendMessage.mockResolvedValue(JSON.stringify({ rolls_evaluation: 'nope' }));
        const review = await reviewOutsideCombatRolls([roll], 'I make my case.', 'narrative', SETTINGS);
        expect(review.acceptedRolls).toEqual([roll]);
    });

    it('every roll stands when the provider call throws', async () => {
        sendMessage.mockRejectedValue(new Error('network error'));
        const review = await reviewOutsideCombatRolls([roll], 'I make my case.', 'narrative', SETTINGS);
        expect(review.acceptedRolls).toEqual([roll]);
    });

    it('runs the audit on the Gemini machinery key when the DM provider is not gemini', async () => {
        sendMessage.mockResolvedValue(JSON.stringify({ rolls_evaluation: [{ index: 0, approved: true }] }));
        await reviewOutsideCombatRolls([roll], 'I make my case.', 'narrative', { apiKey: 'k', geminiApiKey: 'gk', llmProvider: 'openai', model: 'gpt-4o-mini' });
        expect(sendMessage).toHaveBeenCalledWith(expect.objectContaining({ provider: 'gemini', apiKey: 'gk', model: MACHINERY_MODEL }));
    });

    it('every roll stands when a non-gemini DM has no Gemini machinery key', async () => {
        const review = await reviewOutsideCombatRolls([roll], 'I make my case.', 'narrative', { apiKey: 'k', llmProvider: 'openai', model: 'gpt-4o-mini' });
        expect(sendMessage).not.toHaveBeenCalled();
        expect(review.acceptedRolls).toEqual([roll]);
    });

    it('ships a compact, clamped request payload (2026-08-03 queue P2)', async () => {
        // The arbiter blocks every check turn — the payload must stay bounded
        // (Scribe-family parity, 08-02 pattern) and un-pretty-printed.
        sendMessage.mockResolvedValue(JSON.stringify({ rolls_evaluation: [{ index: 0, approved: true }] }));
        const hugeNarrative = 'n'.repeat(50_000);
        const hugeAction = 'a'.repeat(50_000);
        await reviewOutsideCombatRolls([roll], hugeAction, hugeNarrative, SETTINGS);

        const { userMessage } = sendMessage.mock.calls[0][0];
        expect(userMessage.length).toBeLessThan(6000); // 2k action + 2k narrative + rolls
        expect(userMessage).not.toContain('\n  '); // no pretty-printed JSON indentation
        const rollsJson = userMessage.match(/Proposed rolls: (.*)$/s)?.[1];
        const parsed = JSON.parse(rollsJson);
        expect(Object.keys(parsed[0]).sort()).toEqual(['dc', 'description', 'index', 'skill', 'type'].sort());
    });
});
