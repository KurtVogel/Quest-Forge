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

describe('Scribe loot persistence audit', () => {
    beforeEach(() => {
        sendMessage.mockReset();
    });

    const settings = { apiKey: 'test-key', llmProvider: 'gemini' };

    function scribeResponse(missingLoot) {
        return JSON.stringify({
            world_facts: [],
            npc_updates: [],
            story_memory: [],
            location: null,
            ...(missingLoot !== undefined && { missing_loot: missingLoot }),
        });
    }

    function makeLootAudit(overrides = {}) {
        return {
            sourceId: 'msg-1:scribe-loot',
            appliedEvents: null,
            getState: () => ({ appliedLootSourceIds: [] }),
            ...overrides,
        };
    }

    it('adds the loot-audit task and applied-events summary only when lootAudit is passed', async () => {
        sendMessage.mockResolvedValue(scribeResponse());
        const dispatch = vi.fn();

        await runScribe({
            playerMessage: 'I grab the bling for the wenches',
            dmNarrative: 'You sweep the tomb offerings into your pack: 23 gold pieces.',
            settings,
            dispatch,
            lootAudit: makeLootAudit({
                appliedEvents: { goldFound: 23, itemsFound: [], purchases: [], sells: [], startingItems: [] },
            }),
        });
        expect(sendMessage).toHaveBeenCalledWith(expect.objectContaining({
            systemPrompt: expect.stringContaining('LOOT PERSISTENCE AUDIT'),
            userMessage: expect.stringContaining('EVENTS ALREADY APPLIED BY THE ENGINE THIS TURN'),
        }));
        expect(sendMessage.mock.calls[0][0].userMessage).toContain('gold +23');

        sendMessage.mockClear();
        sendMessage.mockResolvedValue(scribeResponse());
        await runScribe({
            playerMessage: 'Hello',
            dmNarrative: 'The innkeeper nods.',
            settings,
            dispatch,
        });
        expect(sendMessage.mock.calls[0][0].systemPrompt).not.toContain('LOOT PERSISTENCE AUDIT');
    });

    it('grants missing coins and items once, claims the source, and announces it', async () => {
        sendMessage.mockResolvedValue(scribeResponse({
            gold: 23,
            copper: 4,
            items: [{ name: 'Jeweled circlet', quantity: 1 }],
        }));
        const dispatch = vi.fn();

        await runScribe({
            playerMessage: 'I loot the tomb.',
            dmNarrative: 'You pocket 23 gold, 4 coppers, and a jeweled circlet.',
            settings,
            dispatch,
            lootAudit: makeLootAudit(),
        });

        expect(dispatch).toHaveBeenCalledWith({ type: 'CLAIM_LOOT_SOURCE', payload: 'msg-1:scribe-loot' });
        expect(dispatch).toHaveBeenCalledWith({ type: 'ADD_GOLD', payload: 23 });
        expect(dispatch).toHaveBeenCalledWith({ type: 'ADD_COPPER', payload: 4 });
        expect(dispatch).toHaveBeenCalledWith({ type: 'ADD_ITEM', payload: { name: 'Jeweled circlet', quantity: 1 } });
        expect(dispatch).toHaveBeenCalledWith(expect.objectContaining({
            type: 'ADD_MESSAGE',
            payload: expect.objectContaining({
                role: 'system',
                content: expect.stringContaining('Loot recovered from narration'),
            }),
        }));
    });

    it('skips an already-claimed audit source so retries and reloads cannot double-grant', async () => {
        sendMessage.mockResolvedValue(scribeResponse({ gold: 23 }));
        const dispatch = vi.fn();

        await runScribe({
            playerMessage: 'I loot the tomb.',
            dmNarrative: 'You pocket 23 gold.',
            settings,
            dispatch,
            lootAudit: makeLootAudit({ getState: () => ({ appliedLootSourceIds: ['msg-1:scribe-loot'] }) }),
        });

        expect(dispatch).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'ADD_GOLD' }));
        expect(dispatch).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'CLAIM_LOOT_SOURCE' }));
    });

    it('does nothing when the Scribe reports no missing loot', async () => {
        sendMessage.mockResolvedValue(scribeResponse({ gold: 0, silver: 0, copper: 0, items: [] }));
        const dispatch = vi.fn();

        await runScribe({
            playerMessage: 'I inspect the empty alcove.',
            dmNarrative: 'Dust and old bones. Nothing of value.',
            settings,
            dispatch,
            lootAudit: makeLootAudit(),
        });

        expect(dispatch).not.toHaveBeenCalled();
    });

    it('does nothing when missing_loot is absent or malformed', async () => {
        sendMessage.mockResolvedValue(scribeResponse());
        const dispatch = vi.fn();
        await runScribe({
            playerMessage: 'I look around.', dmNarrative: 'A quiet crypt.',
            settings, dispatch, lootAudit: makeLootAudit(),
        });
        expect(dispatch).not.toHaveBeenCalled();

        sendMessage.mockResolvedValue(scribeResponse('lots of gold'));
        await runScribe({
            playerMessage: 'I look around.', dmNarrative: 'A quiet crypt.',
            settings, dispatch, lootAudit: makeLootAudit(),
        });
        expect(dispatch).not.toHaveBeenCalled();
    });

    it('clamps insane audit values and caps items at four', async () => {
        sendMessage.mockResolvedValue(scribeResponse({
            gold: 999999,
            silver: '12',
            copper: -5,
            items: [
                { name: 'A', quantity: 999 }, { name: 'B' }, { name: 'C' },
                { name: 'D' }, { name: 'E' }, { name: '' },
            ],
        }));
        const dispatch = vi.fn();

        await runScribe({
            playerMessage: 'I loot everything.',
            dmNarrative: 'You haul away a fortune.',
            settings,
            dispatch,
            lootAudit: makeLootAudit(),
        });

        expect(dispatch).toHaveBeenCalledWith({ type: 'ADD_GOLD', payload: 10000 });
        expect(dispatch).toHaveBeenCalledWith({ type: 'ADD_SILVER', payload: 12 });
        expect(dispatch).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'ADD_COPPER' }));
        const addItemCalls = dispatch.mock.calls.filter(([action]) => action.type === 'ADD_ITEM');
        expect(addItemCalls).toHaveLength(4);
        expect(addItemCalls[0][0].payload.quantity).toBe(20);
    });

    it('skips the audit entirely when no sourceId is available', async () => {
        sendMessage.mockResolvedValue(scribeResponse({ gold: 23 }));
        const dispatch = vi.fn();

        await runScribe({
            playerMessage: 'I loot the tomb.',
            dmNarrative: 'You pocket 23 gold.',
            settings,
            dispatch,
            lootAudit: makeLootAudit({ sourceId: null }),
        });

        expect(dispatch).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'ADD_GOLD' }));
    });
});
