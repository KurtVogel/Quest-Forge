import { beforeEach, describe, expect, it, vi } from 'vitest';
import { generateCampaignFronts, sanitizeGeneratedFronts, shouldGenerateCampaignFronts } from './frontDirector.js';
import { sendMessage } from './adapter.js';

vi.mock('./adapter.js', () => ({ sendMessage: vi.fn() }));

function campaign(overrides = {}) {
    return {
        character: { name: 'Astra', race: 'human', class: 'fighter' },
        party: [],
        messages: [{ role: 'system', content: 'The tale begins.' }],
        currentLocation: 'Jewelglade',
        combat: { active: false },
        session: { id: 'fresh', name: 'Rain Road', premise: 'Caravans vanish on the north road.', createdAt: 1 },
        settings: { apiKey: 'test-key', llmProvider: 'gemini', model: 'gemini-test' },
        ...overrides,
    };
}

describe('Fronts v2 campaign generation', () => {
    beforeEach(() => sendMessage.mockReset());

    it('only runs for a fresh, unmigrated campaign', () => {
        expect(shouldGenerateCampaignFronts(campaign())).toBe(true);
        expect(shouldGenerateCampaignFronts(campaign({ messages: [{}, {}, {}] }))).toBe(false);
        expect(shouldGenerateCampaignFronts(campaign({ session: { ...campaign().session, frontDirector: { version: 2 } } }))).toBe(false);
        expect(shouldGenerateCampaignFronts(campaign({ combat: { active: true } }))).toBe(false);
    });

    it('sanitizes factions and strips untrusted mechanical fields', () => {
        const fronts = sanitizeGeneratedFronts([{
            title: 'The Empty Granaries',
            goal: 'Control the road.',
            stakes: 'Jewelglade goes hungry.',
            grimPortents: ['A caravan vanishes.', 'Stores empty.', 'The gates close.'],
            faction: { name: 'Road Wardens', goal: 'Monopolize grain.', stance: 'Dismissive', relationships: ['They owe the millers.'] },
            damage_taken: 999,
            clock: 6,
        }]);
        expect(fronts[0]).toMatchObject({ id: 'front-v2-1', clock: 0, faction: { name: 'Road Wardens' } });
        expect(fronts[0]).not.toHaveProperty('damage_taken');
    });

    it('generates a private multi-front web from campaign canon', async () => {
        sendMessage.mockResolvedValue(JSON.stringify({
            fronts: [
                { title: 'The Empty Granaries', goal: 'Control the road.', stakes: 'Jewelglade goes hungry.', grimPortents: ['A caravan vanishes.', 'Stores empty.', 'The gates close.'], faction: { name: 'Road Wardens', goal: 'Monopolize grain.', stance: 'Dismissive', relationships: ['They distrust the Lantern Guild.'] } },
                { title: 'Lanterns in the Wood', goal: 'Find the vanished pilgrims.', stakes: 'The old paths are lost.', grimPortents: ['Lights appear.', 'A guide disappears.', 'The shrine wakes.'], faction: { name: 'Lantern Guild', goal: 'Recover its guide.', stance: 'Hopeful', relationships: ['They suspect the Road Wardens.'] } },
            ],
        }));

        const fronts = await generateCampaignFronts(campaign());
        expect(fronts).toHaveLength(2);
        expect(fronts[1].faction.relationships[0]).toContain('Road Wardens');
        expect(sendMessage).toHaveBeenCalledWith(expect.objectContaining({ model: 'gemini-test', messageHistory: [] }));
        expect(sendMessage.mock.calls[0][0].systemPrompt).toContain('Do not write an act outline');
    });
});
