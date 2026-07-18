import { describe, expect, it, vi, beforeEach } from 'vitest';

const { sendMessage } = vi.hoisted(() => ({ sendMessage: vi.fn() }));
vi.mock('../llm/adapter.js', () => ({ sendMessage }));

import { playerAuthorityRollCorrectionPrompt, reviewOutsideCombatRolls, reviewOutsideCombatRollsSync } from './outOfCombatRollPolicy.js';
import { MACHINERY_MODEL } from '../llm/machinery.js';

const SETTINGS = { apiKey: 'test-key', llmProvider: 'gemini', model: 'gemini-2.5-flash' };

describe('outside-combat social roll policy', () => {
    it('rejects a belief check for an explicitly truthful answer', async () => {
        const roll = { type: 'skill_check', skill: 'persuasion', dc: 12, description: 'Convince Galdric of your innocent intentions' };
        const review = await reviewOutsideCombatRolls([roll], 'It was my mother\'s. I tell the truth here.');

        expect(review.acceptedRolls).toEqual([]);
        expect(review.rejectedRolls).toEqual([roll]);
    });

    it('allows a concrete concession even when supported by truth', async () => {
        const roll = { type: 'skill_check', skill: 'persuasion', dc: 10, description: 'Convince Galdric to release me after hearing the truth' };
        const review = await reviewOutsideCombatRolls([roll], 'I honestly explain everything and ask him to release me.');

        expect(review.acceptedRolls).toEqual([roll]);
        expect(review.rejectedRolls).toEqual([]);
    });

    it('does not block ordinary social checks without an explicit truth declaration', async () => {
        const roll = { type: 'skill_check', skill: 'persuasion', dc: 10, description: 'Convince the porter your explanation is honest' };
        const review = await reviewOutsideCombatRolls([roll], 'I offer the porter a plausible explanation.');
        expect(review.acceptedRolls).toEqual([roll]);
    });

    it('rejects a check that overrides the player-authored stoic demeanor', async () => {
        const roll = { type: 'skill_check', skill: 'constitution', dc: 12, description: 'Maintain a stoic, emotionless facade as they strap you down' };
        const review = await reviewOutsideCombatRolls(
            [roll],
            'I use all my strength to remain calm, truthful and stoic. I have no chance against those three men physically, right?'
        );

        expect(review.acceptedRolls).toEqual([]);
        expect(review.rejectedRolls).toEqual([roll]);
    });

    it('does not block genuine saving throws against imposed effects', async () => {
        const roll = { type: 'saving_throw', skill: 'wisdom', dc: 12, description: 'Resist supernatural fear and remain calm' };
        const review = await reviewOutsideCombatRolls([roll], 'I remain calm and stoic before the apparition.');
        expect(review.acceptedRolls).toEqual([roll]);
    });

    it('keeps NPC disbelief available without dice or invented player behavior', () => {
        const prompt = playerAuthorityRollCorrectionPrompt();
        expect(prompt).toContain('NPCs are not forced to believe or admire it');
        expect(prompt).toContain('established motives, knowledge, evidence, prejudice, and suspicions');
        expect(prompt).toContain('do not invent stammering, dishonesty, cowardice, or incompetence');
        expect(prompt).toContain('emit no JSON');
    });

    it('exposes reviewOutsideCombatRollsSync for synchronous checking directly', () => {
        const roll = { type: 'skill_check', skill: 'persuasion', dc: 12, description: 'Convince Galdric of your innocent intentions' };
        const review = reviewOutsideCombatRollsSync([roll], 'It was my mother\'s. I tell the truth here.');

        expect(review.acceptedRolls).toEqual([]);
        expect(review.rejectedRolls).toEqual([roll]);
    });

    it('does not flag a truth declaration against a non-social skill', () => {
        const roll = { type: 'skill_check', skill: 'athletics', dc: 12, description: 'Convince the guard of your innocent intentions' };
        const review = reviewOutsideCombatRollsSync([roll], 'I tell the truth here.');
        expect(review.acceptedRolls).toEqual([roll]);
    });

    it('does not flag a portrayal check when the player message never authors a demeanor', () => {
        const roll = { type: 'skill_check', skill: 'constitution', dc: 12, description: 'Maintain a stoic, emotionless facade under torture' };
        const review = reviewOutsideCombatRollsSync([roll], 'I grit my teeth and endure it.');
        expect(review.acceptedRolls).toEqual([roll]);
    });

    it('does not flag a death save as an authored-portrayal check', () => {
        const roll = { type: 'death_save', description: 'Maintain a calm, stoic composure while dying' };
        const review = reviewOutsideCombatRollsSync([roll], 'I remain calm and stoic.');
        expect(review.acceptedRolls).toEqual([roll]);
    });

    it('partitions a mixed batch of rolls into accepted and rejected', () => {
        const goodRoll = { type: 'skill_check', skill: 'athletics', dc: 12, description: 'Climb the crumbling wall' };
        const badRoll = { type: 'skill_check', skill: 'deception', dc: 12, description: 'Convince the guard your story and intentions are honest' };
        const review = reviewOutsideCombatRollsSync([goodRoll, badRoll], 'I tell the truth here, I promise.');
        expect(review.acceptedRolls).toEqual([goodRoll]);
        expect(review.rejectedRolls).toEqual([badRoll]);
    });
});

describe('reviewOutsideCombatRolls LLM-arbiter path', () => {
    const roll = { type: 'skill_check', skill: 'persuasion', dc: 12, description: 'Convince the merchant to lower the price' };

    beforeEach(() => {
        sendMessage.mockReset();
    });

    it('falls back to the sync regex rules when no API key is configured', async () => {
        const review = await reviewOutsideCombatRolls([roll], 'I make my case.', 'The merchant listens.', null);
        expect(sendMessage).not.toHaveBeenCalled();
        expect(review.acceptedRolls).toEqual([roll]);
    });

    it('falls back to sync rules when the player message is empty', async () => {
        const review = await reviewOutsideCombatRolls([roll], '', 'narrative', SETTINGS);
        expect(sendMessage).not.toHaveBeenCalled();
        expect(review.acceptedRolls).toEqual([roll]);
    });

    it('falls back to sync rules when there are no rolls', async () => {
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

    it('accepts a roll with no matching evaluation entry (defaults to approved)', async () => {
        sendMessage.mockResolvedValue(JSON.stringify({ rolls_evaluation: [], pre_narrated_outcome_detected: false }));
        const review = await reviewOutsideCombatRolls([roll], 'I haggle with the merchant.', 'narrative', SETTINGS);
        expect(review.acceptedRolls).toEqual([roll]);
    });

    it('falls back to sync rules when the response has no extractable JSON', async () => {
        sendMessage.mockResolvedValue('The merchant seems suspicious.');
        const review = await reviewOutsideCombatRolls([roll], 'I make my case.', 'narrative', SETTINGS);
        expect(review.acceptedRolls).toEqual([roll]);
        expect(review.preNarrated).toBeUndefined();
    });

    it('falls back to sync rules when the JSON is malformed', async () => {
        sendMessage.mockResolvedValue('```json\n{ rolls_evaluation: [not valid json] }\n```');
        const review = await reviewOutsideCombatRolls([roll], 'I make my case.', 'narrative', SETTINGS);
        expect(review.acceptedRolls).toEqual([roll]);
    });

    it('falls back to sync rules when rolls_evaluation is not an array', async () => {
        sendMessage.mockResolvedValue(JSON.stringify({ rolls_evaluation: 'nope' }));
        const review = await reviewOutsideCombatRolls([roll], 'I make my case.', 'narrative', SETTINGS);
        expect(review.acceptedRolls).toEqual([roll]);
    });

    it('falls back to sync rules when the provider call throws', async () => {
        sendMessage.mockRejectedValue(new Error('network error'));
        const review = await reviewOutsideCombatRolls([roll], 'I make my case.', 'narrative', SETTINGS);
        expect(review.acceptedRolls).toEqual([roll]);
    });

    it('runs the audit on the Gemini machinery key when the DM provider is not gemini', async () => {
        sendMessage.mockResolvedValue(JSON.stringify({ rolls_evaluation: [{ index: 0, approved: true }] }));
        await reviewOutsideCombatRolls([roll], 'I make my case.', 'narrative', { apiKey: 'k', geminiApiKey: 'gk', llmProvider: 'openai', model: 'gpt-4o-mini' });
        expect(sendMessage).toHaveBeenCalledWith(expect.objectContaining({ provider: 'gemini', apiKey: 'gk', model: MACHINERY_MODEL }));
    });

    it('falls back to sync rules when a non-gemini DM has no Gemini machinery key', async () => {
        const review = await reviewOutsideCombatRolls([roll], 'I make my case.', 'narrative', { apiKey: 'k', llmProvider: 'openai', model: 'gpt-4o-mini' });
        expect(sendMessage).not.toHaveBeenCalled();
        expect(review.acceptedRolls).toEqual([roll]);
    });
});
