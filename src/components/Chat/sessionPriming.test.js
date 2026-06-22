import { describe, expect, it } from 'vitest';
import { buildCampaignOpeningPrompt, shouldPrimeCampaignOpening } from './sessionPriming.js';

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

describe('buildCampaignOpeningPrompt', () => {
    it('reconciles explicit premise possessions without duplicating or inventing mechanics', () => {
        const prompt = buildCampaignOpeningPrompt();

        expect(prompt).toContain('explicitly establishes that the PLAYER CHARACTER already owns');
        expect(prompt).toContain('add it through starting_items only if an equivalent item is not already in INVENTORY');
        expect(prompt).toContain('the engine also rejects exact/catalog duplicates');
        expect(prompt).toContain('Set equipped true only when the premise explicitly says');
        expect(prompt).toContain('NPC, faction, place, shop, inheritance not yet received');
        expect(prompt).toContain('do not invent prices, magic bonuses, attack bonuses, damage, armor values');
        expect(prompt).toContain('Do NOT mention this reconciliation');
    });
});
