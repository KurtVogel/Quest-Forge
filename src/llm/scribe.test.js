import { beforeEach, describe, expect, it, vi } from 'vitest';
import { buildKnownAppearances, buildKnownStances, composeScenePrompt, preserveSceneSituation, runNpcFrontReflection, runScribe } from './scribe.js';
import { sendMessage } from './adapter.js';

vi.mock('./adapter.js', () => ({
    sendMessage: vi.fn(),
}));

describe('Scribe story memory extraction', () => {
    beforeEach(() => {
        sendMessage.mockReset();
    });

    it('dispatches player canon, promises, and wounds while capping cards at the per-turn budget', async () => {
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
        const cardsCall = dispatch.mock.calls.find(([action]) => action.type === 'ADD_STORY_MEMORY_CARDS');
        // Four cards extracted, but the engine budget backstop keeps only the first three.
        expect(cardsCall[0].payload).toHaveLength(3);
        expect(cardsCall[0].payload).toEqual(expect.arrayContaining([
            expect.objectContaining({ type: 'playerCanon', subject: 'Tanelorn exile' }),
            expect.objectContaining({ type: 'promise', subject: 'Mira ribbon' }),
            expect.objectContaining({ type: 'wound', subject: 'black arrow scar' }),
        ]));
    });

    it('feeds known appearances so updates merge with — never clobber — established looks', async () => {
        sendMessage.mockResolvedValue(JSON.stringify({
            world_facts: [], npc_updates: [], story_memory: [], location: null,
        }));

        await runScribe({
            playerMessage: 'I greet Maera at the dock gate.',
            dmNarrative: 'Maera turns; a fresh cut crosses her cheek since you last met.',
            settings: { apiKey: 'test-key', llmProvider: 'gemini' },
            dispatch: vi.fn(),
            knownAppearances: 'Maera: A tall woman with close-cropped white hair and storm-grey eyes.',
        });

        const request = sendMessage.mock.calls[0][0];
        expect(request.userMessage).toContain('KNOWN APPEARANCES');
        expect(request.userMessage).toContain('close-cropped white hair');
        expect(request.systemPrompt).toContain('COMPLETE updated description');
        expect(request.systemPrompt).toContain('This budget NEVER applies to npc_updates');
        // Shame-free capture: proportions and intimate details are canon, and merges
        // may never launder what the record already holds.
        expect(request.systemPrompt).toContain('never sanitize, euphemize');
        expect(request.systemPrompt).toContain('never launder the record');
        expect(request.systemPrompt).toContain('UNVARNISHED');
        // Clinical register: content stays complete, but vocabulary is neutral
        // anatomical wording — crude slang never enters durable records
        // (Gemini machinery safety, DECISIONS.md 2026-07-15).
        expect(request.systemPrompt).toContain('REGISTER');
        expect(request.systemPrompt).toContain('neutral anatomical language');
        expect(request.systemPrompt).toContain('never in profanity or crude slang');
    });

    it('passes personal stance and bond moments through to the NPC record', async () => {
        sendMessage.mockResolvedValue(JSON.stringify({
            world_facts: [],
            npc_updates: [{
                name: 'Maren',
                disposition: 'friendly',
                lastNotes: 'Shared wine with the hero at the Gilded Fern.',
                stanceToPlayer: 'Amused and privately flattered by the hero\'s flirtation, though she keeps him at arm\'s length in public.',
                bondMoment: 'The hero flirted with Maren over wine; she laughed and let her hand linger.',
            }],
            story_memory: [],
            location: null,
        }));
        const dispatch = vi.fn();

        await runScribe({
            playerMessage: 'I lean in and tell Maren her laugh is the best thing in this town.',
            dmNarrative: 'Maren laughs despite herself, and her hand stays on yours a beat longer than it needs to.',
            settings: { apiKey: 'test-key', llmProvider: 'gemini' },
            dispatch,
        });

        expect(dispatch).toHaveBeenCalledWith({
            type: 'UPDATE_NPC',
            payload: expect.objectContaining({
                name: 'Maren',
                stanceToPlayer: expect.stringContaining('privately flattered'),
                bondMoment: expect.stringContaining('hand linger'),
            }),
        });
        const request = sendMessage.mock.calls[0][0];
        expect(request.systemPrompt).toContain('stanceToPlayer');
        expect(request.systemPrompt).toContain('bondMoment');
    });

    it('feeds known stances so relationship updates merge with — never clobber — the record', async () => {
        sendMessage.mockResolvedValue(JSON.stringify({
            world_facts: [], npc_updates: [], story_memory: [], location: null,
        }));

        await runScribe({
            playerMessage: 'I ask Maren about the caravan.',
            dmNarrative: 'Maren answers curtly, distracted by the ledger.',
            settings: { apiKey: 'test-key', llmProvider: 'gemini' },
            dispatch: vi.fn(),
            knownStances: 'Maren: Amused and privately flattered by the hero\'s flirtation.',
        });

        const request = sendMessage.mock.calls[0][0];
        expect(request.userMessage).toContain('KNOWN PLAYER-RELATIONSHIP STANCES');
        expect(request.userMessage).toContain('privately flattered');
        expect(request.systemPrompt).toContain('COMPLETE updated stance');
    });

    it('caps world facts at three per turn no matter how chatty the extraction is', async () => {
        sendMessage.mockResolvedValue(JSON.stringify({
            world_facts: [1, 2, 3, 4, 5, 6].map(i => ({ fact: `Durable truth number ${i}.`, category: 'event' })),
            npc_updates: [],
            story_memory: [],
            location: null,
        }));
        const dispatch = vi.fn();
        await runScribe({
            playerMessage: 'I end the siege.',
            dmNarrative: 'The siege ends; six things change forever.',
            settings: { apiKey: 'test-key', llmProvider: 'gemini' },
            dispatch,
        });
        const factsCall = dispatch.mock.calls.find(([action]) => action.type === 'ADD_WORLD_FACTS');
        expect(factsCall[0].payload).toHaveLength(3);
        expect(sendMessage.mock.calls[0][0].systemPrompt).toContain('HARD EXTRACTION BUDGET');
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

describe('buildKnownAppearances', () => {
    const state = {
        character: { name: 'Vesa', appearance: 'A scarred human fighter with a shaved head and a notched ear.' },
        npcs: [
            { name: 'Maera', appearance: 'Close-cropped white hair, storm-grey eyes.' },
            { name: 'Odo Ferrin', appearance: 'A stooped man with ink-stained fingers.' },
            { name: 'Bran', appearance: '' },
        ],
    };

    it('includes the player and only the NPCs actually named in the turn text', () => {
        const context = buildKnownAppearances(state, 'I ask Maera about the ledger.', 'Maera frowns at the mention.');
        expect(context).toContain('Vesa (PLAYER CHARACTER): A scarred human fighter');
        expect(context).toContain('Maera: Close-cropped white hair');
        expect(context).not.toContain('Odo Ferrin');
    });

    it('matches NPC names case-insensitively and skips NPCs without a recorded look', () => {
        const context = buildKnownAppearances(state, 'BRAN and odo ferrin wait by the gate.');
        expect(context).toContain('Odo Ferrin: A stooped man');
        expect(context).not.toContain('Bran:');
    });

    it('returns null when nobody in the exchange has a recorded appearance', () => {
        expect(buildKnownAppearances({ character: { name: 'Vesa' }, npcs: [] }, 'A quiet road.')).toBeNull();
    });
});

describe('buildKnownStances', () => {
    const state = {
        npcs: [
            { name: 'Maren', stanceToPlayer: 'Amused and privately flattered by the hero\'s flirtation.' },
            { name: 'Odo Ferrin', stanceToPlayer: 'Resents the hero for the ledger incident.' },
            { name: 'Bran', stanceToPlayer: '' },
        ],
    };

    it('includes only NPCs named in the turn text who have a recorded stance', () => {
        const context = buildKnownStances(state, 'I wave to Maren and BRAN across the room.');
        expect(context).toContain('Maren: Amused and privately flattered');
        expect(context).not.toContain('Odo Ferrin');
        expect(context).not.toContain('Bran:');
    });

    it('returns null when nobody in the exchange has a recorded stance', () => {
        expect(buildKnownStances(state, 'A quiet road with strangers.')).toBeNull();
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
        expect(sendMessage.mock.calls[0][0].systemPrompt).toContain('Advance at most ONE front per reflection');
    });

    it('caps reflection story-memory cards at two per cadence', async () => {
        sendMessage.mockResolvedValue(JSON.stringify({
            npc_updates: [],
            front_advances: [],
            story_memory: [1, 2, 3].map(i => ({ type: 'foreshadow', text: `Hook ${i}`, subject: `hook-${i}`, source: 'reflection' })),
        }));
        const dispatch = vi.fn();
        await runNpcFrontReflection({
            state: {
                settings: { apiKey: 'test-key', llmProvider: 'gemini' },
                session: { id: 'campaign' },
                fronts: [{ id: 'front-road', status: 'active' }],
                npcs: [], journal: [], worldFacts: [], party: [],
            },
            dispatch,
            cadence: { id: 'journal-campaign-30', journalEnd: 30, summary: 'Quiet days.' },
        });
        const cardsCall = dispatch.mock.calls.find(([action]) => action.type === 'ADD_STORY_MEMORY_CARDS');
        expect(cardsCall[0].payload).toHaveLength(2);
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
            systemPrompt: expect.stringContaining('LOOT & PAYMENT PERSISTENCE AUDIT'),
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
        expect(sendMessage.mock.calls[0][0].systemPrompt).not.toContain('LOOT & PAYMENT PERSISTENCE AUDIT');
    });

    it('tells the audit what the hero already owns so using gear is never re-granted', async () => {
        sendMessage.mockResolvedValue(scribeResponse());
        const dispatch = vi.fn();

        await runScribe({
            playerMessage: 'I light a fire for the night.',
            dmNarrative: 'You take out your flint and steel and strike a spark into the kindling.',
            settings,
            dispatch,
            lootAudit: makeLootAudit({
                getState: () => ({
                    appliedLootSourceIds: [],
                    inventory: [
                        { name: 'Flint and Steel', quantity: 1 },
                        { name: 'Rations (1 day)', quantity: 3 },
                        { name: '', quantity: 2 },
                    ],
                }),
            }),
        });

        const call = sendMessage.mock.calls[0][0];
        expect(call.systemPrompt).toContain('NOT an acquisition');
        expect(call.userMessage).toContain("HERO'S CURRENT INVENTORY");
        expect(call.userMessage).toContain('Flint and Steel');
        expect(call.userMessage).toContain('Rations (1 day) x3');
    });

    it('omits the inventory line when the hero owns nothing', async () => {
        sendMessage.mockResolvedValue(scribeResponse());
        const dispatch = vi.fn();

        await runScribe({
            playerMessage: 'I search the tomb.',
            dmNarrative: 'Dust and bones.',
            settings,
            dispatch,
            lootAudit: makeLootAudit(),
        });

        expect(sendMessage.mock.calls[0][0].userMessage).not.toContain("HERO'S CURRENT INVENTORY");
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
        expect(dispatch).toHaveBeenCalledWith(expect.objectContaining({
            type: 'ADD_COIN_GRANT',
            payload: expect.objectContaining({
                gold: 23,
                copper: 4,
                _meta: expect.objectContaining({ sourceId: 'msg-1:scribe-loot', announce: 'audit' }),
            }),
        }));
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

        expect(dispatch).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'ADD_COIN_GRANT' }));
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

        expect(dispatch).toHaveBeenCalledWith(expect.objectContaining({
            type: 'ADD_COIN_GRANT',
            payload: expect.objectContaining({ gold: 10000, silver: 12, copper: 0 }),
        }));
        const addItemCalls = dispatch.mock.calls.filter(([action]) => action.type === 'ADD_ITEM');
        expect(addItemCalls).toHaveLength(4);
        expect(addItemCalls[0][0].payload.quantity).toBe(20);
    });

    it('settles a narrated payment via AUDIT_COIN_PAYMENT with its own claimed source', async () => {
        sendMessage.mockResolvedValue(JSON.stringify({
            world_facts: [], npc_updates: [], story_memory: [], location: null,
            missing_payment: { gold: 5 },
        }));
        const dispatch = vi.fn();

        await runScribe({
            playerMessage: 'I pay the ferryman.',
            dmNarrative: 'You count five gold pieces into his palm and he waves you aboard.',
            settings,
            dispatch,
            lootAudit: makeLootAudit(),
        });

        expect(dispatch).toHaveBeenCalledWith({ type: 'CLAIM_LOOT_SOURCE', payload: 'msg-1:scribe-loot:payment' });
        expect(dispatch).toHaveBeenCalledWith({
            type: 'AUDIT_COIN_PAYMENT',
            payload: {
                gold: 5, silver: 0, copper: 0,
                _meta: { sourceId: 'msg-1:scribe-loot:payment', playerMessage: 'I pay the ferryman.' },
            },
        });
    });

    it('skips an already-claimed payment audit so retries cannot double-deduct', async () => {
        sendMessage.mockResolvedValue(JSON.stringify({
            world_facts: [], npc_updates: [], story_memory: [], location: null,
            missing_payment: { gold: 5 },
        }));
        const dispatch = vi.fn();

        await runScribe({
            playerMessage: 'I pay the ferryman.',
            dmNarrative: 'You count five gold pieces into his palm.',
            settings,
            dispatch,
            lootAudit: makeLootAudit({ getState: () => ({ appliedLootSourceIds: ['msg-1:scribe-loot:payment'] }) }),
        });

        expect(dispatch).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'AUDIT_COIN_PAYMENT' }));
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

        expect(dispatch).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'ADD_COIN_GRANT' }));
    });
});

describe('Scribe gear-handoff audit', () => {
    beforeEach(() => {
        sendMessage.mockReset();
    });

    function emptyExtraction(extra = {}) {
        return JSON.stringify({ world_facts: [], npc_updates: [], story_memory: [], location: null, ...extra });
    }

    function auditState(overrides = {}) {
        return {
            party: [{ id: 'c1', name: 'Kaarina Tammi', status: 'healthy', ac: 12, weapon: 'Dagger' }],
            inventory: [{ id: 'i1', name: 'Longsword +1', type: 'weapon' }],
            appliedLootSourceIds: [],
            ...overrides,
        };
    }

    it('routes a narrated weapon handoff through GIVE_GEAR_TO_COMPANION and keepsakes through UPDATE_COMPANION', async () => {
        sendMessage.mockResolvedValue(emptyExtraction({
            missing_gear_handoffs: [
                { companion: 'Kaarina', item: 'Longsword +1', kind: 'weapon' },
                { companion: 'Kaarina', item: 'carved bone whistle', kind: 'keepsake' },
            ],
        }));

        const dispatch = vi.fn();
        await runScribe({
            playerMessage: 'I hand Kaarina my longsword and the whistle.',
            dmNarrative: 'Kaarina straps the longsword to her belt and tucks the whistle away.',
            settings: { apiKey: 'test-key', llmProvider: 'gemini' },
            dispatch,
            lootAudit: { sourceId: 'msg-9:scribe-loot', appliedEvents: null, getState: () => auditState() },
        });

        expect(dispatch).toHaveBeenCalledWith({ type: 'CLAIM_LOOT_SOURCE', payload: 'msg-9:scribe-loot:gear' });
        expect(dispatch).toHaveBeenCalledWith({
            type: 'GIVE_GEAR_TO_COMPANION',
            payload: { itemId: 'i1', companionId: 'c1' },
        });
        expect(dispatch).toHaveBeenCalledWith({
            type: 'UPDATE_COMPANION',
            payload: { id: 'c1', keepsake: 'carved bone whistle' },
        });
    });

    it('falls back to a stats-only weapon update when the narrated item is not in inventory, and skips untracked armor', async () => {
        sendMessage.mockResolvedValue(emptyExtraction({
            missing_gear_handoffs: [
                { companion: 'Kaarina', item: 'Boarding Axe', kind: 'weapon' },
                { companion: 'Kaarina', item: 'salvaged breastplate', kind: 'armor' },
            ],
        }));

        const dispatch = vi.fn();
        await runScribe({
            playerMessage: 'Take the axe and the breastplate.',
            dmNarrative: 'Kaarina hefts the boarding axe and buckles on the breastplate.',
            settings: { apiKey: 'test-key', llmProvider: 'gemini' },
            dispatch,
            lootAudit: { sourceId: 'msg-10:scribe-loot', appliedEvents: null, getState: () => auditState({ inventory: [] }) },
        });

        expect(dispatch).toHaveBeenCalledWith({
            type: 'UPDATE_COMPANION',
            payload: { id: 'c1', weapon: 'Boarding Axe' },
        });
        // Untracked armor has no derivable AC — conservative skip, no companion AC guess.
        expect(dispatch.mock.calls.some(([action]) => action.type === 'GIVE_GEAR_TO_COMPANION')).toBe(false);
        expect(dispatch.mock.calls.filter(([action]) => action.type === 'UPDATE_COMPANION')).toHaveLength(1);
    });

    it('is idempotent per narration: an already-claimed gear sourceId applies nothing', async () => {
        sendMessage.mockResolvedValue(emptyExtraction({
            missing_gear_handoffs: [{ companion: 'Kaarina', item: 'Longsword +1', kind: 'weapon' }],
        }));

        const dispatch = vi.fn();
        await runScribe({
            playerMessage: 'I hand Kaarina my longsword.',
            dmNarrative: 'She straps it on.',
            settings: { apiKey: 'test-key', llmProvider: 'gemini' },
            dispatch,
            lootAudit: {
                sourceId: 'msg-11:scribe-loot',
                appliedEvents: null,
                getState: () => auditState({ appliedLootSourceIds: ['msg-11:scribe-loot:gear'] }),
            },
        });

        expect(dispatch.mock.calls.some(([action]) => ['GIVE_GEAR_TO_COMPANION', 'UPDATE_COMPANION', 'CLAIM_LOOT_SOURCE'].includes(action.type))).toBe(false);
    });
});
