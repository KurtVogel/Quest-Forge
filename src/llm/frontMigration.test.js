import { beforeEach, describe, expect, it, vi } from 'vitest';
import { sendMessage } from './adapter.js';
import { buildFrontMigrationContext, generateContextualFronts, sanitizeMigratedFronts } from './frontMigration.js';

vi.mock('./adapter.js', () => ({ sendMessage: vi.fn() }));

function campaign(overrides = {}) {
    return {
        character: { name: 'Vesa', race: 'human', class: 'fighter', level: 2, appearance: 'scarred warrior in chain mail' },
        session: { id: 'vesa-campaign', premise: 'Vesa was exiled from Tanelorn and seeks a name in the borderlands.' },
        currentLocation: 'Kraul’s cavern',
        fronts: [],
        party: [],
        combat: { active: false },
        worldFacts: [
            { category: 'death', fact: 'Chief Kraul is dead, slain by Vesa.' },
            { category: 'reputation', fact: 'Two surviving goblins call Vesa the new chief.' },
        ],
        journal: [{ title: 'The cavern', summary: 'Vesa defeated Kraul after a brutal duel.' }],
        npcs: [{ name: 'Mira', disposition: 'wary', agenda: 'Learn who now controls the goblin tunnels.' }],
        storyMemory: [{ status: 'active', type: 'playerCanon', subject: 'Goblin Slayer', text: 'Vesa claimed the title Goblin Slayer.' }],
        quests: [{ name: 'Goblin chief', description: 'End Kraul’s raids.', status: 'completed' }],
        inventory: [{ name: 'Longsword', equipped: true }],
        messages: [
            { role: 'user', content: 'I declare myself the new chief.' },
            { role: 'assistant', content: 'The two sickly goblins kneel beside Kraul’s corpse.' },
        ],
        settings: { apiKey: 'test-key', llmProvider: 'gemini', model: 'gemini-test' },
        ...overrides,
    };
}

describe('contextual front migration', () => {
    beforeEach(() => sendMessage.mockReset());

    it('builds private context from established canon, NPCs, memories, quests, and recent events', () => {
        const { context, counts } = buildFrontMigrationContext(campaign());

        expect(context.campaignPremise).toContain('Tanelorn');
        expect(context.canonicalWorldFacts).toEqual(expect.arrayContaining([
            expect.objectContaining({ fact: expect.stringContaining('Kraul is dead') }),
        ]));
        expect(context.knownNpcs[0]).toMatchObject({ name: 'Mira', agenda: expect.stringContaining('goblin tunnels') });
        expect(context.dramaticMemory[0].text).toContain('Goblin Slayer');
        expect(context.quests[0]).toMatchObject({ name: 'Goblin chief', status: 'completed' });
        expect(context.recentEvents).toHaveLength(2);
        expect(counts).toMatchObject({ facts: 2, journalEntries: 1, npcs: 1, memories: 1, recentEvents: 2 });
    });

    it('sanitizes, caps, and privately identifies generated fronts', () => {
        const fronts = sanitizeMigratedFronts([{
            id: 'untrusted-id',
            title: 'The Empty Throne',
            goal: 'Kraul’s surviving lieutenants race to control the tunnels.',
            stakes: 'The border villages face a new wave of raids.',
            grimPortents: ['A lieutenant gathers survivors.', 'A village scout vanishes.', 'The tunnels unite under a crueler chief.'],
            clock: 99,
            stage: 99,
            publicHints: ['Goblin tracks split in two directions.'],
            notes: 'Kraul remains dead; this is the consequence of his defeat.',
            damage_taken: 999,
        }]);

        expect(fronts).toHaveLength(1);
        expect(fronts[0]).toMatchObject({
            id: 'front-migrated-1',
            title: 'The Empty Throne',
            clock: 2,
            stage: 2,
            status: 'active',
        });
        expect(fronts[0]).not.toHaveProperty('damage_taken');
    });

    it('generates validated fronts without exposing mechanical mutations', async () => {
        sendMessage.mockResolvedValue(`\`\`\`json
        {"fronts":[
          {"title":"The Empty Throne","goal":"Kraul's survivors seek a new leader.","stakes":"The tunnels become more dangerous.","grimPortents":["A survivor recruits raiders.","A guide disappears.","A new banner rises."],"clock":0,"stage":0,"publicHints":["Fresh tracks leave the cavern."],"notes":"Kraul stays dead."},
          {"title":"Tanelorn's Long Reach","goal":"An exile hunter follows Vesa's growing reputation.","stakes":"Vesa's new allies become leverage.","grimPortents":["Questions spread along the road.","A witness is pressured.","The hunter reaches the borderlands."],"clock":1,"stage":1,"publicHints":[],"notes":"Rooted in Vesa's exile."}
        ]}
        \`\`\``);

        const result = await generateContextualFronts(campaign());

        expect(result.fronts).toHaveLength(2);
        expect(result.fronts[0].notes).toContain('Kraul stays dead');
        expect(sendMessage).toHaveBeenCalledWith(expect.objectContaining({
            provider: 'gemini',
            model: 'gemini-test',
            systemPrompt: expect.stringContaining('Dead characters remain dead'),
            userMessage: expect.stringContaining('Chief Kraul is dead'),
        }));
    });

    it('preserves an existing basic front as private migration context', async () => {
        sendMessage.mockResolvedValue('{"fronts":[{"title":"A Distinct Pressure","goal":"A rival follows Vesa.","stakes":"His reputation draws danger.","grimPortents":["Questions spread.","A witness is found.","The rival arrives."]}]}');
        const existing = { id: 'front-local-pressure', title: 'Trouble around the cavern', goal: 'Old pressure', stakes: 'Old stakes', grimPortents: ['One', 'Two', 'Three'] };

        const result = await generateContextualFronts(campaign({ fronts: [existing] }));

        expect(result.fronts).toHaveLength(1);
        expect(sendMessage.mock.calls[0][0].userMessage).toContain('Trouble around the cavern');
    });

    it('refuses to run during combat or repeat contextual enrichment', async () => {
        await expect(generateContextualFronts(campaign({ combat: { active: true } })))
            .rejects.toThrow('Finish the current combat');
        await expect(generateContextualFronts(campaign({ session: { id: 'vesa-campaign', frontMigration: { version: 1 } } })))
            .rejects.toThrow('already contextually enriched');
        expect(sendMessage).not.toHaveBeenCalled();
    });
});
