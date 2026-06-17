import { beforeEach, describe, expect, it, vi } from 'vitest';
import { runScribe } from './scribe.js';
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
});

