import { beforeEach, describe, expect, it, vi } from 'vitest';
import { sanitizeFrontUpgrade, upgradeCampaignFrontsV2 } from './frontUpgrade.js';
import { sendMessage } from './adapter.js';

vi.mock('./adapter.js', () => ({ sendMessage: vi.fn() }));

function vesaCampaign(overrides = {}) {
    return {
        character: { name: 'Vesa', race: 'dwarf', class: 'fighter', level: 3, features: ['Martial Archetype'] },
        inventory: [{ name: 'Warhammer', equipped: true }],
        party: [],
        messages: [{ role: 'assistant', content: 'Vesa drove the goblins from the cavern.' }],
        journal: [{ summary: 'Vesa defeated Chief Kraul and spared two goblins.' }],
        worldFacts: [{ fact: 'Chief Kraul is dead.', category: 'event' }],
        npcs: [],
        quests: [{ name: 'The Alderman’s Bounty', status: 'completed' }],
        storyMemory: [],
        currentLocation: 'Jewelglade',
        fronts: [{ id: 'front-local-pressure', title: 'Trouble near Jewelglade', goal: 'Survivors seek leverage.', stakes: 'The road becomes unsafe.', grimPortents: ['Tracks spread.', 'A guide vanishes.', 'A banner rises.'], clock: 2, maxClock: 6, stage: 1, status: 'active' }],
        combat: { active: false },
        session: { id: 'vesa-campaign', premise: 'Vesa hunts goblins around Jewelglade.' },
        settings: { apiKey: 'test-key', llmProvider: 'gemini', model: 'gemini-test' },
        ...overrides,
    };
}

describe('established campaign Fronts v2 upgrade', () => {
    beforeEach(() => sendMessage.mockReset());

    it('accepts only exact existing IDs and bounded faction/new-front fields', () => {
        const existing = vesaCampaign().fronts;
        const result = sanitizeFrontUpgrade({
            front_enrichments: [
                { id: 'invented', faction: { name: 'Wrong', goal: 'Rewrite history.' } },
                { id: 'front-local-pressure', faction: { name: 'Kraul’s Remnants', goal: 'Choose a successor.', stance: 'Afraid of Vesa', relationships: ['They bargain with the road smugglers.'] }, damage_taken: 99 },
            ],
            new_fronts: [{
                title: 'The Sealed Bounty', goal: 'Suppress what the alderman funded.', stakes: 'Witnesses disappear.',
                grimPortents: ['A witness recants.', 'Records burn.', 'A hunter arrives.'],
                faction: { name: 'The Alderman’s Agents', goal: 'Bury the bargain.', stance: 'Wary', relationships: ['They exploit Kraul’s remnants.'] },
                exp_awarded: 9999,
            }],
        }, existing);

        expect(result.enrichments).toEqual([expect.objectContaining({ id: 'front-local-pressure', faction: expect.objectContaining({ name: 'Kraul’s Remnants' }) })]);
        expect(result.newFronts[0]).toMatchObject({ id: 'front-upgrade-2', clock: 0, faction: { name: 'The Alderman’s Agents' } });
        expect(result.newFronts[0]).not.toHaveProperty('exp_awarded');
    });

    it('builds the upgrade from Vesa’s actual level-3 campaign context', async () => {
        sendMessage.mockResolvedValue(JSON.stringify({
            front_enrichments: [{ id: 'front-local-pressure', faction: { name: 'Kraul’s Remnants', goal: 'Choose a successor.', stance: 'Terrified of Vesa', relationships: ['They seek protection from the road smugglers.'] } }],
            new_fronts: [{ title: 'The Sealed Bounty', goal: 'Suppress the alderman’s bargain.', stakes: 'Witnesses disappear.', grimPortents: ['A witness recants.', 'Records burn.', 'A hunter arrives.'], faction: { name: 'The Alderman’s Agents', goal: 'Bury the bargain.', stance: 'Wary', relationships: ['They may use Kraul’s remnants.'] } }],
        }));

        const result = await upgradeCampaignFrontsV2(vesaCampaign());
        expect(result).toMatchObject({ sessionId: 'vesa-campaign' });
        expect(result.enrichments).toHaveLength(1);
        expect(result.newFronts).toHaveLength(1);
        const request = sendMessage.mock.calls[0][0];
        expect(request.userMessage).toContain('"name": "Vesa"');
        expect(request.userMessage).toContain('"class": "fighter"');
        expect(request.userMessage).toContain('"level": 3');
        expect(request.systemPrompt).toContain('Do not rename, replace, resolve, rewrite, or reset');
    });

    it('rejects incomplete enrichment without changing state', async () => {
        sendMessage.mockResolvedValue(JSON.stringify({ front_enrichments: [], new_fronts: [] }));
        await expect(upgradeCampaignFrontsV2(vesaCampaign())).rejects.toThrow('No campaign state was changed');
    });
});
