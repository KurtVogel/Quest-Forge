/**
 * runPostTurnExtraction reads the COMMITTED turn, not same-task state
 * (2026-09-07 audit P2). The harness here deliberately defers state visibility
 * by one macrotask — the React shape the module header documents — because a
 * synchronous getState structurally hides the whole staleness class: a travel
 * turn embedded the ARRIVAL prose under the departure place, and a post-roll
 * outcome that started combat ran the Scribe, loot audit, embed, and
 * auto-summarize on the fight-start narration (everything handleSend skips).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    runScribe: vi.fn(async () => {}),
    addMemory: vi.fn(async () => {}),
    maybeAutoSummarize: vi.fn(async () => ({})),
}));

vi.mock('./scribe.js', async (importOriginal) => ({
    ...(await importOriginal()),
    runScribe: mocks.runScribe,
}));
vi.mock('../engine/vectorMemory.js', async (importOriginal) => ({
    ...(await importOriginal()),
    addMemory: mocks.addMemory,
    retrieveRelevant: async () => [],
}));
vi.mock('../engine/worldJournal.js', async (importOriginal) => ({
    ...(await importOriginal()),
    maybeAutoSummarize: mocks.maybeAutoSummarize,
}));

const { gameReducer, initialGameState } = await import('../state/gameReducer.js');
const { createCharacter } = await import('../engine/characterUtils.js');
const { createTurnRunner } = await import('./turnOrchestrator.js');

const ABILITY_SCORES = { strength: 15, dexterity: 13, constitution: 14, intelligence: 10, wisdom: 12, charisma: 8 };

function scriptedStream(responses) {
    return vi.fn(async ({ onChunk }) => {
        const text = responses.shift() || '';
        onChunk?.(text);
        return text;
    });
}

/** getState lags dispatch by one macrotask — the React render-flush shape. */
function createLaggingHarness({ streamMessage }) {
    let state = {
        ...initialGameState,
        character: createCharacter('Testa', 'human', 'fighter', ABILITY_SCORES, ['athletics']),
        currentLocation: 'Greyfell',
        settings: { ...initialGameState.settings, llmProvider: 'openai', apiKey: 'test-key', model: 'test-model', geminiApiKey: 'machinery-key' },
        session: { ...initialGameState.session, id: 'session-test' },
    };
    let visible = state;
    const dispatch = (action) => {
        state = gameReducer(state, action);
        setTimeout(() => { visible = state; }, 0);
    };
    const runner = createTurnRunner({
        getState: () => visible,
        dispatch,
        streamMessage,
        sendMessage: vi.fn(async () => ''),
    });
    return { runner, getLiveState: () => state };
}

beforeEach(() => {
    mocks.runScribe.mockClear();
    mocks.addMemory.mockClear();
    mocks.maybeAutoSummarize.mockClear();
});

describe('runPostTurnExtraction — committed-record reads (2026-09-07 P2)', () => {
    it('a travel turn embeds and extracts under the ARRIVAL location, not the departure', async () => {
        const response = 'The road bends and Ashford rises from the marsh mist, its gate lamps already lit.\n'
            + '```json\n{"location": "Ashford"}\n```';
        const { runner, getLiveState } = createLaggingHarness({ streamMessage: scriptedStream([response]) });

        await runner.sendToLLM('I walk on to Ashford.', 'I walk on to Ashford.');
        expect(getLiveState().currentLocation).toBe('Ashford');
        // Same task: the visible state still says Greyfell — the trap.
        expect(runner.runPostTurnExtraction('I walk on to Ashford.')).toBe(true);

        expect(mocks.runScribe).toHaveBeenCalledTimes(1);
        expect(mocks.runScribe.mock.calls[0][0].dmLocationEvent).toBe('Ashford');
        const narrativeEmbeds = mocks.addMemory.mock.calls.filter(call => call[2] === 'narrative');
        expect(narrativeEmbeds).toHaveLength(1);
        expect(narrativeEmbeds[0][1]).toMatch(/^\[Location: Ashford\]/);
        expect(narrativeEmbeds[0][3]).toBe('Ashford');
    });

    it('a fight-starting narration is never extracted, embedded, or summarized', async () => {
        const response = 'Steel rasps from the hedgerow — two bandits step onto the road, blades bare.\n'
            + '```json\n{"combat_start": {"enemies": [{"id": "bandit-1", "name": "Bandit", "hp": 9, "ac": 12, "attack_bonus": 3, "damage": "1d6"}]}}\n```';
        const { runner, getLiveState } = createLaggingHarness({ streamMessage: scriptedStream([response]) });

        await runner.sendToLLM('I keep walking.', 'I keep walking.');
        expect(getLiveState().combat.active).toBe(true);
        expect(runner.getLastCommittedTurn().hidden).toBe(false);

        runner.finalizeRoleplayTurn('I keep walking.');

        expect(mocks.runScribe).not.toHaveBeenCalled();
        expect(mocks.addMemory.mock.calls.filter(call => call[2] === 'narrative')).toHaveLength(0);
        expect(mocks.maybeAutoSummarize).not.toHaveBeenCalled();
    });

    it('an ordinary outcome still extracts and summarizes through finalizeRoleplayTurn', async () => {
        const response = 'The lock gives with a soft click and the strongroom breathes cold air at you.';
        const { runner } = createLaggingHarness({ streamMessage: scriptedStream([response]) });

        await runner.sendToLLM('I pick the lock.', 'I pick the lock.');
        runner.finalizeRoleplayTurn('I pick the lock.');

        expect(mocks.runScribe).toHaveBeenCalledTimes(1);
        expect(mocks.maybeAutoSummarize).toHaveBeenCalledTimes(1);
    });
});
