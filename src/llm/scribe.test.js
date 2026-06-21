import { beforeEach, describe, expect, it, vi } from 'vitest';
import { composeScenePrompt, preserveSceneSituation, runNpcFrontReflection, runScribe } from './scribe.js';
import { sendMessage } from './adapter.js';

vi.mock('./adapter.js', () => ({
    sendMessage: vi.fn(),
}));

describe('Scribe story memory extraction', () => {
    beforeEach(() => {
        sendMessage.mockReset();
    });

    it('dispatches player-authored canon, promises, wounds, NPC agendas, and companion hooks', async () => {
        sendMessage.mockResolvedValue(JSON.stringify({
            world_facts: [],
            npc_updates: [{
                name: 'Mira',
                disposition: 'wary',
                agenda: 'Find who marked the well road before the militia does.',
                relationshipTension: 'She owes the hero a warning but does not fully trust them.',
                trust: 42,
                callbackHooks: ['blue ribbon warning', 'old debt at Tanelorn'],
            }],
            story_memory: [
                {
                    type: 'playerCanon',
                    text: 'The hero named Tanelorn as the city that exiled them.',
                    subject: 'Tanelorn exile',
                    tags: ['Tanelorn', 'exile'],
                    salience: 5,
                    emotionalCharge: 4,
                    linkedNpcNames: [],
                    location: 'Tanelorn',
                    source: 'scribe',
                },
                {
                    type: 'promise',
                    text: 'Mira promised to leave a blue ribbon if the well road became unsafe.',
                    subject: 'Mira ribbon',
                    tags: ['promise', 'ribbon'],
                    salience: 4,
                    emotionalCharge: 3,
                    linkedNpcNames: ['Mira'],
                    location: 'Millhaven',
                    source: 'scribe',
                },
                {
                    type: 'wound',
                    text: 'A black-fletched arrow scarred the hero near the ribs.',
                    subject: 'black arrow scar',
                    tags: ['scar', 'arrow'],
                    salience: 3,
                    emotionalCharge: 3,
                    linkedNpcNames: [],
                    location: 'North Road',
                    source: 'scribe',
                },
                {
                    type: 'npcAgenda',
                    text: 'A competent female scout could cross paths through the missing-caravan front as witness, guide, or rival.',
                    subject: 'potential scout companion',
                    tags: ['companion', 'front', 'scout'],
                    salience: 3,
                    emotionalCharge: 2,
                    linkedNpcNames: [],
                    location: 'North Road',
                    source: 'scribe',
                },
            ],
            location: null,
        }));

        const dispatch = vi.fn();
        await runScribe({
            playerMessage: 'I tell Mira I was exiled from Tanelorn.',
            dmNarrative: 'Mira touches a blue ribbon at her sleeve and studies the scar under your ribs.',
            settings: { apiKey: 'test-key', llmProvider: 'gemini' },
            dispatch,
        });

        expect(dispatch).toHaveBeenCalledWith({
            type: 'UPDATE_NPC',
            payload: expect.objectContaining({
                name: 'Mira',
                agenda: expect.stringContaining('well road'),
                relationshipTension: expect.stringContaining('owes'),
                trust: 42,
                callbackHooks: expect.arrayContaining(['blue ribbon warning']),
            }),
        });
        expect(dispatch).toHaveBeenCalledWith({
            type: 'ADD_STORY_MEMORY_CARDS',
            payload: expect.arrayContaining([
                expect.objectContaining({ type: 'playerCanon', subject: 'Tanelorn exile' }),
                expect.objectContaining({ type: 'promise', subject: 'Mira ribbon' }),
                expect.objectContaining({ type: 'wound', subject: 'black arrow scar' }),
                expect.objectContaining({ type: 'npcAgenda', subject: 'potential scout companion' }),
            ]),
        });
    });

    it('instructs the Scribe not to canonize unsupported external player assertions', async () => {
        sendMessage.mockResolvedValue(JSON.stringify({
            world_facts: [],
            npc_updates: [],
            story_memory: [],
            location: null,
        }));

        await runScribe({
            playerMessage: 'A unicorn bursts through the wall and carries me away.',
            dmNarrative: 'Only the goblin camp wall stands before you.',
            settings: { apiKey: 'test-key', llmProvider: 'gemini' },
            dispatch: vi.fn(),
        });

        const request = sendMessage.mock.calls[0][0];
        expect(request.systemPrompt).toContain('A player message is not authoritative evidence about external reality');
        expect(request.systemPrompt).toContain('unless the DM narrative explicitly accepts or establishes them');
    });

    it('filters combat survival claims that contradict authoritative engine state', async () => {
        sendMessage.mockResolvedValue(JSON.stringify({
            world_facts: [{ fact: 'The Cave-Worg is dead.', category: 'event' }],
            npc_updates: [],
            story_memory: [{ type: 'callback', text: 'Vesa killed the Cave-Worg.', subject: 'Cave-Worg' }],
            location: null,
        }));
        const dispatch = vi.fn();

        await runScribe({
            playerMessage: 'Combat exchange',
            dmNarrative: 'The Cave-Worg collapses lifeless.',
            settings: { apiKey: 'test-key', llmProvider: 'gemini' },
            dispatch,
            authoritativeContext: {
                terminal: 'ongoing',
                postState: {
                    enemies: [{ name: 'Cave-Worg', hp: 9, maxHp: 32, status: 'active' }],
                },
            },
        });

        expect(sendMessage.mock.calls[0][0].userMessage).toContain('AUTHORITATIVE ENGINE STATE');
        expect(dispatch).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'ADD_WORLD_FACTS' }));
        expect(dispatch).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'ADD_STORY_MEMORY_CARDS' }));
    });
});

describe('cadenced living-world reflection', () => {
    beforeEach(() => sendMessage.mockReset());

    it('dispatches a single engine-owned front advance batch with the trusted cadence identity', async () => {
        sendMessage.mockResolvedValue(JSON.stringify({
            npc_updates: [],
            front_advances: [{ id: 'front-road', delta: 1, symptom: 'Empty carts creak through the gate.', reason: 'The hero spent a week elsewhere.' }],
            story_memory: [],
        }));
        const dispatch = vi.fn();
        await runNpcFrontReflection({
            state: {
                settings: { apiKey: 'test-key', llmProvider: 'gemini' },
                session: { id: 'campaign' },
                fronts: [{ id: 'front-road', status: 'active' }],
                npcs: [],
                journal: [],
                worldFacts: [],
                party: [],
            },
            dispatch,
            cadence: { id: 'journal-campaign-20', journalEnd: 20, summary: 'A week passed.' },
        });

        expect(dispatch).toHaveBeenCalledWith({
            type: 'APPLY_FRONT_ADVANCE_BATCH',
            payload: {
                cadenceId: 'journal-campaign-20',
                journalEnd: 20,
                advances: [expect.objectContaining({ id: 'front-road', delta: 1 })],
            },
        });
        expect(sendMessage.mock.calls[0][0].systemPrompt).toContain('A journal cadence is not itself a reason');
    });
});

describe('scene-art prompt composition', () => {
    beforeEach(() => {
        sendMessage.mockReset();
    });

    it('preserves both the opening and decisive aftermath of long narration', () => {
        const situation = `Vesa charges Chief Kraul. ${'Clashing steel and cavern detail. '.repeat(100)} Kraul lies dead while two goblins kneel before Vesa.`;
        const preserved = preserveSceneSituation(situation, 500);

        expect(preserved).toContain('Vesa charges Chief Kraul');
        expect(preserved).toContain('Kraul lies dead while two goblins kneel before Vesa');
        expect(preserved).toContain('[Later in the same moment]');
        expect(preserved.length).toBeLessThan(550);
    });

    it('instructs the art director to preserve all supported subjects without generic extras', async () => {
        sendMessage.mockResolvedValue('A finished image prompt');
        const situation = `Vesa raises his bloodied sword over Chief Kraul's corpse. Two sickly goblins kneel in the cavern.`;

        await composeScenePrompt({
            situation,
            character: { name: 'Vesa', race: 'human', class: 'fighter', appearance: 'scarred man in chain mail' },
            currentLocation: 'cavern',
            settings: { apiKey: 'test-key', llmProvider: 'gemini' },
        });

        expect(sendMessage).toHaveBeenCalledWith(expect.objectContaining({
            systemPrompt: expect.stringContaining('Preserve every visually important subject, species, count'),
            userMessage: expect.stringContaining('Two sickly goblins kneel'),
        }));
        expect(sendMessage.mock.calls[0][0].systemPrompt).toContain('Do not add generic party members');
    });
});
