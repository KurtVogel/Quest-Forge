import { describe, expect, it } from 'vitest';
import { reviewOutsideCombatRolls, truthfulAnswerCorrectionPrompt } from './outOfCombatRollPolicy.js';

describe('outside-combat social roll policy', () => {
    it('rejects a belief check for an explicitly truthful answer', () => {
        const roll = { type: 'skill_check', skill: 'persuasion', dc: 12, description: 'Convince Galdric of your innocent intentions' };
        const review = reviewOutsideCombatRolls([roll], 'It was my mother\'s. I tell the truth here.');

        expect(review.acceptedRolls).toEqual([]);
        expect(review.rejectedRolls).toEqual([roll]);
    });

    it('allows a concrete concession even when supported by truth', () => {
        const roll = { type: 'skill_check', skill: 'persuasion', dc: 10, description: 'Convince Galdric to release me after hearing the truth' };
        const review = reviewOutsideCombatRolls([roll], 'I honestly explain everything and ask him to release me.');

        expect(review.acceptedRolls).toEqual([roll]);
        expect(review.rejectedRolls).toEqual([]);
    });

    it('does not block ordinary social checks without an explicit truth declaration', () => {
        const roll = { type: 'skill_check', skill: 'persuasion', dc: 10, description: 'Convince the porter your explanation is honest' };
        expect(reviewOutsideCombatRolls([roll], 'I offer the porter a plausible explanation.').acceptedRolls).toEqual([roll]);
    });

    it('keeps NPC disbelief available without dice or invented player behavior', () => {
        const prompt = truthfulAnswerCorrectionPrompt();
        expect(prompt).toContain('The NPC is not forced to believe them');
        expect(prompt).toContain('established motives, knowledge, evidence, prejudice, and suspicions');
        expect(prompt).toContain('do not invent stammering, dishonesty, cowardice, or incompetence');
        expect(prompt).toContain('emit no JSON');
    });
});
