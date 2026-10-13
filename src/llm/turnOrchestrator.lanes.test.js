/**
 * The DM call's LANE table (2026-10-13 chat-orchestration Lap 4): the lane
 * matrix is pinned by LANE, not by flag — every row of `DM_LANES` runs through
 * `sendToLLM` here, and the table decides what the test expects: the
 * prompt's projection and mode tail, whether events are discarded, the ONE
 * usage name the usage capture and the timing log share, and that the turn's
 * events carry the ENTRY combat flag. Plus the nudge call's prompt bytes and
 * the Scribe context built from the state the turn LEFT.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    runScribe: vi.fn(async () => {}),
    queueMemory: vi.fn(async () => {}),
    flushMemoryQueue: vi.fn(async () => {}),
    maybeAutoSummarize: vi.fn(async () => ({})),
}));

vi.mock('./scribe.js', async (importOriginal) => ({
    ...(await importOriginal()),
    runScribe: mocks.runScribe,
}));
vi.mock('../engine/vectorMemory.js', async (importOriginal) => ({
    ...(await importOriginal()),
    queueMemoryItem: mocks.queueMemory,
    flushMemoryQueue: mocks.flushMemoryQueue,
    retrieveRelevant: async () => [],
}));
vi.mock('../engine/worldJournal.js', async (importOriginal) => ({
    ...(await importOriginal()),
    maybeAutoSummarize: mocks.maybeAutoSummarize,
}));

const { gameReducer, initialGameState } = await import('../state/gameReducer.js');
const { createCharacter } = await import('../engine/characterUtils.js');
const { createTurnRunner, DM_LANES, dmLane } = await import('./turnOrchestrator.js');
const { COMBAT_INTENT_RESPONSE_MODE, PROMPT_CHAR_BUDGET } = await import('./promptBuilder.js');
const { EPILOGUE_REQUEST_MESSAGE, EPILOGUE_RESPONSE_MODE, TABLE_TALK_RESPONSE_MODE } = await import('./tableTalk.js');
const { getInspectorSnapshot, resetInspector } = await import('../debug/memoryInspectorStore.js');
const { turnFlags } = await import('./turnFlags.js');

const ABILITY_SCORES = { strength: 15, dexterity: 13, constitution: 14, intelligence: 10, wisdom: 12, charisma: 8 };

const JSON_REPLY = '```json\n{"world_facts": [{"fact": "The reeve takes bribes after dark.", "category": "lore"}], "npc_updates": [{"name": "Reeve Holt", "stanceToPlayer": "Thinks the hero is a soft touch and says so to the toll guards."}]}\n```';
const EXCHANGE_REPLY = '```json\n{"combat_exchange": {"player_slots": [{"action": "attack", "strikes": [{"target": "goblin-1"}]}], "enemy_intents": []}}\n```';

function baseState({ inCombat = false } = {}) {
    return {
        ...initialGameState,
        character: createCharacter('Testa', 'human', 'fighter', ABILITY_SCORES, ['athletics']),
        settings: { ...initialGameState.settings, llmProvider: 'openai', apiKey: 'test-key', model: 'test-model' },
        session: { ...initialGameState.session, id: 'session-lanes', premise: 'The weirs keep failing.' },
        inventory: [{ id: 'sword', name: 'Longsword', type: 'weapon', damage: '1d8', equipped: true }],
        quests: [{ id: 'q1', name: 'Find the wardens', status: 'active', description: 'Track the missing weir wardens.' }],
        worldFacts: [{ id: 'f1', fact: 'The Pike buys captives.', category: 'lore', timestamp: 1, atMessage: 1 }],
        journal: [{ id: 'j1', summary: 'The hero reached Brackwater.', keyDecisions: [], consequences: [], messageRange: [0, 2], location: 'Brackwater', timestamp: 1 }],
        npcs: [{ id: 'n1', name: 'Reeve Holt', rosterTier: 'character', disposition: 'wary', lastNotes: 'Keeps the toll gate.', stanceToPlayer: 'Suspects the hero of something.', lastSeenMessage: 2 }],
        party: [{ id: 'c1', name: 'Osma', hp: 9, maxHp: 18, ac: 16, level: 2, affinity: 60 }],
        currentLocation: 'Brackwater',
        messages: [
            { id: 'u0', role: 'user', content: 'I greet Reeve Holt.' },
            { id: 'a0', role: 'assistant', content: 'Reeve Holt grunts.' },
        ],
        combat: !inCombat ? initialGameState.combat : {
            ...initialGameState.combat, active: true, phase: 'awaiting_intent', round: 2,
            enemies: [{ id: 'goblin-1', name: 'Goblin', hp: 7, maxHp: 7, ac: 13, condition: 'healthy', conditions: [], combatStatus: 'active' }],
            turnOrder: [{ type: 'player', name: 'Testa', initiative: 15 }],
        },
    };
}

/** getState lags dispatch by one macrotask — the React shape. */
function createHarness({ reply, inCombat = false, lagging = true } = {}) {
    let state = baseState({ inCombat });
    let visible = state;
    const dispatch = (action) => {
        state = gameReducer(state, action);
        if (lagging) setTimeout(() => { visible = state; }, 0);
        else visible = state;
    };
    const calls = [];
    const streamMessage = vi.fn(async ({ systemPrompt, onChunk, onUsage }) => {
        calls.push({ systemPrompt });
        onUsage?.({ promptTokens: 100, cachedTokens: 50, outputTokens: 10 });
        onChunk?.(reply);
        return reply;
    });
    const sendMessage = vi.fn(async () => '{}');
    const runner = createTurnRunner({ getState: () => visible, dispatch, streamMessage, sendMessage });
    return { runner, calls, streamMessage, sendMessage, getLive: () => state };
}

const macrotask = () => new Promise(resolve => setTimeout(resolve, 0));

/** The table's rows and what each should do on the wire. */
const LANE_CASES = [
    { lane: 'standard', reply: `Reeve Holt spits.\n${JSON_REPLY}`, playerLine: 'I greet Reeve Holt.', events: true, tail: null, skips: [], keeps: ['## ACTIVE QUESTS', '## KNOWN NPCs', '## INVENTORY'] },
    { lane: 'opening', reply: `The weir groans.\n${JSON_REPLY}`, playerLine: null, events: true, tail: null, skips: [], keeps: ['## ACTIVE QUESTS', '## KNOWN NPCs'] },
    { lane: 'tableTalk', reply: `We left off at the gate.\n${JSON_REPLY}`, playerLine: 'OOC: where were we?', events: false, tail: TABLE_TALK_RESPONSE_MODE, skips: [], keeps: ['## ACTIVE QUESTS', '## KNOWN NPCs'] },
    { lane: 'combatIntent', reply: EXCHANGE_REPLY, playerLine: 'I cut at the goblin.', inCombat: true, events: true, tail: COMBAT_INTENT_RESPONSE_MODE, skips: ['## ACTIVE QUESTS', '## KNOWN NPCs', '## WORLD FACTS'], keeps: ['## ACTIVE COMBAT', '## INVENTORY'] },
    { lane: 'combatNarration', reply: `Steel rings.\n${JSON_REPLY}`, playerLine: null, inCombat: true, events: false, tail: null, skips: ['## ACTIVE QUESTS', '## WORLD FACTS', '## INVENTORY'], keeps: ['## ACTIVE COMBAT', '## KNOWN NPCs'] },
    { lane: 'narration', reply: `The ward settles.\n${JSON_REPLY}`, playerLine: null, events: false, tail: null, skips: [], keeps: ['## ACTIVE QUESTS', '## KNOWN NPCs', '## INVENTORY'] },
];

beforeEach(() => {
    resetInspector();
    mocks.runScribe.mockClear();
});

describe('DM_LANES — every row runs through sendToLLM and the table decides what the test expects', () => {
    it('the table names exactly the lanes the call sites use, and an unknown lane throws', () => {
        expect(Object.keys(DM_LANES).sort()).toEqual(['combatIntent', 'combatNarration', 'narration', 'opening', 'standard', 'tableTalk']);
        expect(LANE_CASES.map(c => c.lane).sort()).toEqual(Object.keys(DM_LANES).sort());
        expect(() => dmLane('narrationOnly')).toThrow(/Unknown DM lane/);
        expect(dmLane()).toBe(DM_LANES.standard);
    });

    for (const c of LANE_CASES) {
        it(`${c.lane}: projection, mode tail, event discard, ONE usage name, the entry combat flag`, async () => {
            const h = createHarness({ reply: c.reply, inCombat: !!c.inCombat });
            const info = vi.spyOn(console, 'info').mockImplementation(() => {});
            const events = await h.runner.sendToLLM('[prompt]', c.playerLine, { lane: c.lane });
            const prompt = h.calls[0].systemPrompt;
            for (const heading of c.skips) expect(prompt, `${c.lane} skips ${heading}`).not.toContain(heading);
            for (const heading of c.keeps) expect(prompt, `${c.lane} keeps ${heading}`).toContain(heading);
            // The tail: the mode part when the lane has one, else the reminder.
            if (c.tail) expect(prompt.endsWith(c.tail)).toBe(true);
            else expect(prompt.endsWith('never leave a required event out of the block.')).toBe(true);
            // Discarded events are null; kept events carry the ENTRY combat flag.
            if (c.events) {
                expect(events).toBeTruthy();
                expect(turnFlags(events).combatWasActive).toBe(!!c.inCombat);
            } else {
                expect(events).toBeNull();
            }
            // ONE usage name: the inspector's row and the timing log agree with the table.
            expect(getInspectorSnapshot().lastUsage).toMatchObject({ lane: 'dm', mode: DM_LANES[c.lane].usage });
            expect(info.mock.calls.some(([line]) => String(line).startsWith(`[LLM timing] ${DM_LANES[c.lane].usage}:`))).toBe(true);
            info.mockRestore();
        });
    }

    it('the table-talk lane\'s mode becomes the epilogue on the ending card\'s request', async () => {
        const h = createHarness({ reply: 'Osma buried the axe with the hero.' });
        await h.runner.sendToLLM(EPILOGUE_REQUEST_MESSAGE, EPILOGUE_REQUEST_MESSAGE, { lane: 'tableTalk' });
        expect(h.calls[0].systemPrompt.endsWith(EPILOGUE_RESPONSE_MODE)).toBe(true);
    });

    it('the usage name and the timing name never disagree for any lane (one source)', () => {
        for (const row of Object.values(DM_LANES)) {
            expect(typeof row.usage).toBe('string');
            expect(row.usage).toMatch(/^[a-z-]+$/);
        }
        expect(new Set(Object.values(DM_LANES).map(r => r.usage)).size).toBe(5); // opening shares 'standard'
    });
});

describe('the missing-events nudge builds its own projection (2026-10-13 chat-orchestration P2)', () => {
    it('the nudge call\'s system prompt carries the prefix + character + inventory + quests and stays small', async () => {
        const h = createHarness({ reply: 'He spits in his palm. "It\'s a deal, then. Bring me the ledger by dusk."' });
        await h.runner.sendToLLM('I offer to fetch his ledger.', 'I offer to fetch his ledger.', { lane: 'standard' });
        expect(h.sendMessage).toHaveBeenCalledTimes(1);
        const prompt = h.sendMessage.mock.calls[0][0].systemPrompt;
        const dmPrompt = h.calls[0].systemPrompt;
        for (const heading of ['## CAMPAIGN PREMISE', '## PLAYER CHARACTER', '## INVENTORY', '## ACTIVE QUESTS']) expect(prompt).toContain(heading);
        // The block openers in their exact form — the cached prefix NAMES some
        // of these blocks in its rules, so a bare heading is not a block.
        for (const heading of ['## KNOWN NPCs (keep names', '## WORLD FACTS (canonical', '## SESSION HISTORY (what', '## COMPANIONS (PARTY)\n', '## WORLD TEMPO — PRIVATE']) expect(prompt).not.toContain(heading);
        expect(prompt.length).toBeLessThan(dmPrompt.length);
        // The dynamic half (everything from the live character block on) is a
        // few lines on this fixture; the cached prefix is the rest.
        const dynamicOf = (text) => text.slice(text.indexOf('## PLAYER CHARACTER'));
        expect(dynamicOf(prompt).length).toBeLessThan(dynamicOf(dmPrompt).length / 2);
        expect(dynamicOf(prompt).length).toBeLessThan(PROMPT_CHAR_BUDGET / 40);
    });
});

describe('the Scribe reads the state the turn LEFT (2026-10-13 chat-orchestration P2)', () => {
    it('a stance the DM wrote THIS turn is in the Scribe\'s KNOWN STANCES whether or not the ref has flushed', async () => {
        for (const lagging of [true, false]) {
            mocks.runScribe.mockClear();
            const h = createHarness({ reply: `Reeve Holt spits.\n${JSON_REPLY}`, lagging });
            await h.runner.sendToLLM('I greet Reeve Holt.', 'I greet Reeve Holt.', { lane: 'standard' });
            h.runner.runPostTurnExtraction('I greet Reeve Holt.');
            expect(mocks.runScribe).toHaveBeenCalledTimes(1);
            const args = mocks.runScribe.mock.calls[0][0];
            expect(JSON.stringify(args.knownStances)).toContain('soft touch');
            // The DM's own fact is in the embed judgement's record too.
            expect(args.memoryContext.worldFacts.some(f => /bribes after dark/.test(f.fact))).toBe(true);
            // The turn record carries the projection and the entry flag.
            expect(h.runner.getLastCommittedTurn().combatWasActive).toBe(false);
            // A fragment lands as an unconfirmed impression on the tiered card
            // (2026-09-12); either way the record the Scribe reads carries it.
            expect(JSON.stringify(h.runner.getLastCommittedTurn().stateAfter.npcs)).toContain('soft touch');
            await macrotask();
        }
    });

    it('the projection equals the live store after the flush (the reducer replay is the reducer)', async () => {
        const h = createHarness({ reply: `Reeve Holt spits.\n${JSON_REPLY}`, lagging: true });
        await h.runner.sendToLLM('I greet Reeve Holt.', 'I greet Reeve Holt.', { lane: 'standard' });
        await macrotask();
        const after = h.runner.getLastCommittedTurn().stateAfter;
        const live = h.getLive();
        expect(after.npcs.map(n => n.stanceToPlayer)).toEqual(live.npcs.map(n => n.stanceToPlayer));
        expect(after.worldFacts.map(f => f.fact)).toEqual(live.worldFacts.map(f => f.fact));
        expect(after.messages.map(m => m.content)).toEqual(live.messages.map(m => m.content));
    });
});
