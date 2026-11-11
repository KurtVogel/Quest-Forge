import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_DM_MODEL, PROVIDERS, dmThinkingLevelFor } from './modelCatalog.js';
import { dmStreamThinkingLevel } from './machinery.js';
import { streamMessage } from './adapter.js';
import { streamGeminiMessage } from './providers/gemini.js';
import { streamOpenAIMessage } from './providers/openai.js';
import { streamXaiMessage } from './providers/xai.js';
import { gameReducer, initialGameState } from '../state/gameReducer.js';
import { createCharacter } from '../engine/characterUtils.js';
import { createTurnRunner, DM_LANES } from './turnOrchestrator.js';

/**
 * The DM stream's thinking level, end to end: the catalog names a level per
 * model, the lane decides whether the call asks for it, the adapter forwards
 * it, and each provider puts it on the wire under its own field name. A model
 * without a level, and a lane outside the play loop, send nothing.
 */

const ARGS = { apiKey: 'test-key', systemPrompt: 'You are the DM.', messageHistory: [], userMessage: 'I look around.', onChunk: () => {} };

const sse = (events) => new Response(
    events.map(event => `data: ${typeof event === 'string' ? event : JSON.stringify(event)}\n\n`).join(''),
    { status: 200, headers: { 'Content-Type': 'text/event-stream' } },
);
const geminiReply = () => sse([{ candidates: [{ content: { parts: [{ text: 'Ok.' }] }, finishReason: 'STOP' }] }]);
const openaiReply = () => sse([{ choices: [{ delta: { content: 'Ok.' } }] }, { choices: [{ delta: {}, finish_reason: 'stop' }] }, '[DONE]']);
const sentBody = (fetchMock) => JSON.parse(fetchMock.mock.calls[0][1].body);

afterEach(() => {
    vi.unstubAllGlobals();
});

describe('the catalog names a DM thinking level per model', () => {
    it('the two measured rows ask for low; every other row asks for nothing', () => {
        expect(dmThinkingLevelFor('gemini', DEFAULT_DM_MODEL)).toBe('low');
        expect(dmThinkingLevelFor('openai', 'gpt-6.1-sol')).toBe('low');
        const withLevel = Object.entries(PROVIDERS).flatMap(([provider, { models }]) => models.filter(row => row.dmThinking).map(row => `${provider}:${row.id}`));
        expect(withLevel.sort()).toEqual([`gemini:${DEFAULT_DM_MODEL}`, 'openai:gpt-6.1-sol'].sort());
    });

    it('a Flash-Lite row, an xAI row and an unknown id have no level', () => {
        expect(dmThinkingLevelFor('gemini', 'gemini-3.5-flash-lite')).toBeNull();
        expect(dmThinkingLevelFor('xai', 'grok-4.3')).toBeNull();
        expect(dmThinkingLevelFor('gemini', 'not-a-model')).toBeNull();
        expect(dmThinkingLevelFor('nobody', DEFAULT_DM_MODEL)).toBeNull();
    });

    it('dmStreamThinkingLevel reads the player\'s provider and model, and is undefined without a level', () => {
        expect(dmStreamThinkingLevel({ llmProvider: 'gemini', model: DEFAULT_DM_MODEL })).toBe('low');
        expect(dmStreamThinkingLevel({ llmProvider: 'gemini', model: 'gemini-3.1-flash-lite' })).toBeUndefined();
        expect(dmStreamThinkingLevel(null)).toBeUndefined();
    });
});

describe('each provider puts a handed level on the wire under its own name', () => {
    it('Gemini: thinkingConfig.thinkingLevel on the stream body, and no thinkingConfig without a level', async () => {
        const withLevel = vi.fn().mockResolvedValue(geminiReply());
        vi.stubGlobal('fetch', withLevel);
        await streamGeminiMessage({ ...ARGS, model: DEFAULT_DM_MODEL, thinkingLevel: 'low' });
        expect(sentBody(withLevel).generationConfig.thinkingConfig).toEqual({ thinkingLevel: 'low' });

        const without = vi.fn().mockResolvedValue(geminiReply());
        vi.stubGlobal('fetch', without);
        await streamGeminiMessage({ ...ARGS, model: DEFAULT_DM_MODEL });
        expect(sentBody(without).generationConfig).not.toHaveProperty('thinkingConfig');
    });

    it('OpenAI: reasoning_effort on the stream body, and no field without a level', async () => {
        const withLevel = vi.fn().mockResolvedValue(openaiReply());
        vi.stubGlobal('fetch', withLevel);
        await streamOpenAIMessage({ ...ARGS, model: 'gpt-6.1-sol', thinkingLevel: 'low' });
        expect(sentBody(withLevel).reasoning_effort).toBe('low');

        const without = vi.fn().mockResolvedValue(openaiReply());
        vi.stubGlobal('fetch', without);
        await streamOpenAIMessage({ ...ARGS, model: 'gpt-6.1-sol' });
        expect(sentBody(without)).not.toHaveProperty('reasoning_effort');
    });

    it('xAI has no field for it: a handed level is never sent', async () => {
        const fetchMock = vi.fn().mockResolvedValue(openaiReply());
        vi.stubGlobal('fetch', fetchMock);
        await streamXaiMessage({ ...ARGS, model: 'grok-4.3', thinkingLevel: 'low' });
        expect(sentBody(fetchMock)).not.toHaveProperty('reasoning_effort');
    });

    it('the adapter forwards the level to the provider', async () => {
        const fetchMock = vi.fn().mockResolvedValue(geminiReply());
        vi.stubGlobal('fetch', fetchMock);
        await streamMessage({ ...ARGS, provider: 'gemini', model: DEFAULT_DM_MODEL, thinkingLevel: 'low' });
        expect(sentBody(fetchMock).generationConfig.thinkingConfig).toEqual({ thinkingLevel: 'low' });
    });
});

const ABILITY_SCORES = { strength: 15, dexterity: 13, constitution: 14, intelligence: 10, wisdom: 12, charisma: 8 };
const EXCHANGE_REPLY = '```json\n{"combat_exchange": {"player_slots": [{"action": "attack", "strikes": [{"target": "goblin-1"}]}], "enemy_intents": []}}\n```';

function createHarness({ provider = 'openai', model = 'gpt-6.1-sol', inCombat = false, reply }) {
    let state = {
        ...initialGameState,
        character: createCharacter('Testa', 'human', 'fighter', ABILITY_SCORES, ['athletics']),
        settings: { ...initialGameState.settings, llmProvider: provider, apiKey: 'test-key', model },
        session: { ...initialGameState.session, id: 'session-thinking', premise: 'The weirs keep failing.' },
        messages: [
            { id: 'u0', role: 'user', content: 'I greet the reeve.' },
            { id: 'a0', role: 'assistant', content: 'The reeve grunts.' },
        ],
        combat: !inCombat ? initialGameState.combat : {
            ...initialGameState.combat, active: true, phase: 'awaiting_intent', round: 2,
            enemies: [{ id: 'goblin-1', name: 'Goblin', hp: 7, maxHp: 7, ac: 13, condition: 'healthy', conditions: [], combatStatus: 'active' }],
            turnOrder: [{ type: 'player', name: 'Testa', initiative: 15 }],
        },
    };
    const levels = [];
    const stream = vi.fn(async ({ thinkingLevel, onChunk }) => {
        levels.push(thinkingLevel);
        onChunk?.(reply);
        return reply;
    });
    const runner = createTurnRunner({
        getState: () => state,
        dispatch: (action) => { state = gameReducer(state, action); },
        streamMessage: stream,
        sendMessage: vi.fn(async () => '{}'),
    });
    return { runner, levels };
}

const LANE_CASES = [
    { lane: 'standard', reply: 'The reeve spits.', playerLine: 'I greet the reeve.' },
    { lane: 'opening', reply: 'The weir groans.', playerLine: null },
    { lane: 'tableTalk', reply: 'We left off at the gate.', playerLine: 'OOC: where were we?' },
    { lane: 'combatIntent', reply: EXCHANGE_REPLY, playerLine: 'I cut at the goblin.', inCombat: true },
    { lane: 'combatNarration', reply: 'Steel rings.', playerLine: null, inCombat: true },
    { lane: 'narration', reply: 'The ward settles.', playerLine: null },
];

describe('the lane decides whether the DM stream asks for the model\'s level', () => {
    it('the play loop\'s lanes ask; the opening scene and table talk keep the provider default', () => {
        const asking = Object.entries(DM_LANES).filter(([, row]) => row.thinking === 'model').map(([name]) => name);
        expect(asking.sort()).toEqual(['combatIntent', 'combatNarration', 'narration', 'standard']);
        expect(DM_LANES.opening.thinking).toBeNull();
        expect(DM_LANES.tableTalk.thinking).toBeNull();
        expect(LANE_CASES.map(c => c.lane).sort()).toEqual(Object.keys(DM_LANES).sort());
    });

    for (const c of LANE_CASES) {
        it(`${c.lane}: ${DM_LANES[c.lane].thinking === 'model' ? 'hands the stream the model\'s level' : 'hands the stream no level'}`, async () => {
            const info = vi.spyOn(console, 'info').mockImplementation(() => {});
            const h = createHarness({ reply: c.reply, inCombat: !!c.inCombat });
            await h.runner.sendToLLM('[prompt]', c.playerLine, { lane: c.lane });
            expect(h.levels[0]).toBe(DM_LANES[c.lane].thinking === 'model' ? 'low' : undefined);
            info.mockRestore();
        });
    }

    it('a model without a level hands the stream none, on any lane', async () => {
        const info = vi.spyOn(console, 'info').mockImplementation(() => {});
        const astra = createHarness({ model: 'gpt-6-astra', reply: 'The reeve spits.' });
        await astra.runner.sendToLLM('[prompt]', 'I greet the reeve.', { lane: 'standard' });
        expect(astra.levels[0]).toBeUndefined();
        const grok = createHarness({ provider: 'xai', model: 'grok-4.3', reply: 'The reeve spits.' });
        await grok.runner.sendToLLM('[prompt]', 'I greet the reeve.', { lane: 'standard' });
        expect(grok.levels[0]).toBeUndefined();
        info.mockRestore();
    });
});
