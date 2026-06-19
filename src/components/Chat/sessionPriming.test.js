import { describe, expect, it } from 'vitest';
import { shouldPrimeCampaignOpening } from './sessionPriming.js';

function campaignState(overrides = {}) {
    return {
        character: { name: 'Vesa' },
        settings: { apiKey: 'test-key' },
        session: {
            premise: 'Vesa arrives in the goblin-haunted borderlands.',
            openingScenePending: true,
        },
        messages: [
            { role: 'system', content: 'Your tale begins.' },
        ],
        ...overrides,
    };
}

describe('shouldPrimeCampaignOpening', () => {
    it('opens a newly created premise campaign exactly once', () => {
        expect(shouldPrimeCampaignOpening(campaignState())).toBe(true);
    });

    it('does not generate a turn when continuing an established campaign', () => {
        expect(shouldPrimeCampaignOpening(campaignState({
            session: {
                premise: 'Vesa arrives in the goblin-haunted borderlands.',
                openingScenePending: false,
            },
            journal: [{ summary: 'Vesa slew Chief Kraul.' }],
            worldFacts: [{ fact: 'Chief Kraul is dead.' }],
        }))).toBe(false);
    });

    it('does not mistake pruned DM history for a fresh campaign', () => {
        expect(shouldPrimeCampaignOpening(campaignState({
            session: { premise: 'An old campaign with no migration marker.' },
            messages: [{ role: 'user', content: 'I wait by the fire.', summarized: true }],
            journal: [{ summary: 'Many sessions have passed.' }],
        }))).toBe(false);
    });

    it('does not reopen a scene after the DM has already answered', () => {
        expect(shouldPrimeCampaignOpening(campaignState({
            messages: [{ role: 'assistant', content: 'The road waits. What do you do?' }],
        }))).toBe(false);
    });
});
