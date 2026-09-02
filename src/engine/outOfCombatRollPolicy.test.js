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

    it('accepts a roll with no matching evaluation entry when the sync floor has no objection', async () => {
        sendMessage.mockResolvedValue(JSON.stringify({ rolls_evaluation: [], pre_narrated_outcome_detected: false }));
        const review = await reviewOutsideCombatRolls([roll], 'I haggle with the merchant.', 'narrative', SETTINGS);
        expect(review.acceptedRolls).toEqual([roll]);
    });

    describe('fail-closed per roll: the sync rules are the floor (2026-09-02 audit)', () => {
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

        it('a missing entry falls back to the sync verdict for that roll', async () => {
            sendMessage.mockResolvedValue(JSON.stringify({ rolls_evaluation: [] }));
            const review = await reviewOutsideCombatRolls([belief], truthful, 'narrative', SETTINGS);
            expect(review.rejectedRolls).toEqual([belief]);
            expect(review.acceptedRolls).toEqual([]);
        });

        it('a sync attack-as-check rejection survives an arbiter approve and still flags attackAsCheck', async () => {
            const attackCheck = { type: 'skill_check', skill: 'strength', dc: 12, description: 'Strike the lookout down before he shouts' };
            sendMessage.mockResolvedValue(JSON.stringify({
                rolls_evaluation: [{ index: 0, approved: true, reason: 'Looks fine to me.' }],
            }));
            const review = await reviewOutsideCombatRolls([attackCheck], 'I attack the lookout with my longsword.', 'narrative', SETTINGS);
            expect(review.rejectedRolls).toEqual([attackCheck]);
            expect(review.acceptedRolls).toEqual([]);
            expect(review.attackAsCheck).toBe(true);
        });

        it('an arbiter agency rejection still lands when the sync rules see nothing', async () => {
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

describe('attack staged as a check (Codex 2026-08-09)', () => {
    it('sync: rejects a check that resolves a declared weapon attack and flags attackAsCheck', () => {
        const roll = { type: 'skill_check', skill: 'strength', dc: 12, description: 'Attack the lookout with your longsword' };
        const review = reviewOutsideCombatRollsSync([roll], 'I attack the lookout with my longsword.');
        expect(review.rejectedRolls).toEqual([roll]);
        expect(review.attackAsCheck).toBe(true);
    });

    it('sync: an approach check (Stealth) before the attack stays valid', () => {
        const roll = { type: 'skill_check', skill: 'stealth', dc: 12, description: 'Sneak close enough to strike the lookout' };
        const review = reviewOutsideCombatRollsSync([roll], 'I sneak up and attack the lookout.');
        expect(review.acceptedRolls).toEqual([roll]);
        expect(review.attackAsCheck).toBeFalsy();
    });

    it('sync: a non-attack message never trips the attack detector', () => {
        const roll = { type: 'skill_check', skill: 'persuasion', dc: 10, description: 'Convince the lookout to let you pass' };
        const review = reviewOutsideCombatRollsSync([roll], 'I try to talk my way past the lookout.');
        expect(review.acceptedRolls).toEqual([roll]);
        expect(review.attackAsCheck).toBeFalsy();
    });

    it('LLM path: violation "attack" on a rejected roll sets attackAsCheck', async () => {
        sendMessage.mockReset();
        sendMessage.mockResolvedValue(JSON.stringify({
            rolls_evaluation: [{ index: 0, approved: false, violation: 'attack', reason: 'Overt attack staged as a check.' }],
            pre_narrated_outcome_detected: false,
        }));
        const roll = { type: 'skill_check', skill: 'athletics', dc: 12, description: 'Strike down the lookout' };
        const review = await reviewOutsideCombatRolls([roll], 'I attack the lookout.', 'narrative', SETTINGS);
        expect(review.rejectedRolls).toEqual([roll]);
        expect(review.attackAsCheck).toBe(true);
    });

    it('LLM path: an agency rejection does not set attackAsCheck', async () => {
        sendMessage.mockReset();
        sendMessage.mockResolvedValue(JSON.stringify({
            rolls_evaluation: [{ index: 0, approved: false, violation: 'agency', reason: 'Demeanor check.' }],
            pre_narrated_outcome_detected: false,
        }));
        const roll = { type: 'skill_check', skill: 'wisdom', dc: 12, description: 'Stay composed' };
        const review = await reviewOutsideCombatRolls([roll], 'I remain calm.', 'narrative', SETTINGS);
        expect(review.rejectedRolls).toEqual([roll]);
        expect(review.attackAsCheck).toBeFalsy();
    });

    it('attackAsCheckCorrectionPrompt demands combat_start and echoes the player action', async () => {
        const { attackAsCheckCorrectionPrompt } = await import('./outOfCombatRollPolicy.js');
        const prompt = attackAsCheckCorrectionPrompt('I attack the lookout with my longsword.');
        expect(prompt).toContain('combat_start');
        expect(prompt).toContain('combat_exchange');
        expect(prompt).toContain('I attack the lookout');
    });
});
