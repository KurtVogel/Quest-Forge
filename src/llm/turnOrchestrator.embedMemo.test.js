/**
 * A check turn's query embeds, counted against the REAL retrieveRelevant
 * (2026-09-22 roll-resolution P2 + test depth). The other orchestrator
 * harnesses run without a machinery key, so nothing there ever counted the
 * embeds a check turn makes. This one runs a Gemini DM (the main key doubles
 * as the machinery key) and mocks only the Gemini embed endpoint and the
 * adapter's non-streaming sendMessage — the arbiter, the detector, and the
 * Scribe answer '' and take their offline paths; parser, applyEvents,
 * reducer, rollResolver, and vectorMemory stay real.
 *
 * Hop 1, the challenge, and the accepted outcome hop all pass the proposal's
 * own playerAction, so sendToLLM builds a byte-identical sceneContext three
 * times; before the query-vector memo each hop paid its own blocking round
 * trip for the same vector.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';

const { embedTextMock, embedTextsMock, sendMessageMock } = vi.hoisted(() => ({
    embedTextMock: vi.fn(),
    embedTextsMock: vi.fn(),
    sendMessageMock: vi.fn(async () => ''),
}));

vi.mock('./providers/gemini.js', async (importOriginal) => ({
    ...(await importOriginal()),
    embedText: embedTextMock,
    embedTexts: embedTextsMock,
}));
vi.mock('./adapter.js', async (importOriginal) => ({
    ...(await importOriginal()),
    sendMessage: sendMessageMock,
}));

import { gameReducer, initialGameState } from '../state/gameReducer.js';
import { createCharacter } from '../engine/characterUtils.js';
import { addMemory, clearMemories } from '../engine/vectorMemory.js';
import { createTurnRunner } from './turnOrchestrator.js';

const ABILITY_SCORES = {
    strength: 15, dexterity: 13, constitution: 14,
    intelligence: 10, wisdom: 12, charisma: 8,
};

const MEMORY = 'The sergeant takes bribes at the gatehouse after dark.';
const ACTION = 'I sneak past the sergeant.';
const STEALTH_ROLL = '{"requested_rolls": [{"type": "skill_check", "skill": "stealth", "dc": 12, "description": "Slip past the sergeant"}]}';

function unitVector(index) {
    const vector = Array(768).fill(0);
    vector[index] = 1;
    return vector;
}

function scriptedStream(responses) {
    return vi.fn(async ({ onChunk }) => {
        const text = responses.shift() || '';
        onChunk?.(text);
        return text;
    });
}

function createHarness({ streamMessage }) {
    let state = {
        ...initialGameState,
        character: createCharacter('Testa', 'human', 'fighter', ABILITY_SCORES, ['athletics']),
        settings: { ...initialGameState.settings, llmProvider: 'gemini', apiKey: 'test-key', model: 'test-model' },
        session: { ...initialGameState.session, id: 'session-test' },
        currentLocation: 'The gatehouse',
    };
    const dispatch = (action) => { state = gameReducer(state, action); };
    const runner = createTurnRunner({
        getState: () => state,
        dispatch,
        streamMessage,
        sendMessage: vi.fn(async () => ''),
    });
    return { runner, getState: () => state };
}

const queryEmbeds = () => embedTextMock.mock.calls.filter(call => call[2]?.inputType === 'query');

beforeEach(() => {
    // Same ordering as vectorMemory.test.js: clear against the old factory
    // before swapping in a fresh one.
    clearMemories();
    globalThis.indexedDB = new IDBFactory();
    embedTextMock.mockReset();
    embedTextMock.mockResolvedValue(unitVector(0));
    embedTextsMock.mockReset();
    embedTextsMock.mockImplementation(async (apiKey, texts, options) =>
        Promise.all((texts || []).map(text => embedTextMock(apiKey, text, options))));
    sendMessageMock.mockClear();
});

describe('check turn query embeds (2026-09-22 roll-resolution P2)', () => {
    it('embeds the byte-identical sceneContext ONCE across hop 1, the challenge, and the outcome hop, and every hop still retrieves', async () => {
        await addMemory('test-key', MEMORY, 'world_fact');
        const streamMessage = scriptedStream([
            `The sergeant leans on his spear, half asleep.\n\`\`\`json\n${STEALTH_ROLL}\n\`\`\``, // hop 1: the withheld setup
            `\`\`\`json\n${STEALTH_ROLL}\n\`\`\``, // the challenge: ruling upheld, JSON-only
            'You slip past him and into the yard.', // the accepted outcome
        ]);
        const { runner, getState } = createHarness({ streamMessage });

        const events = await runner.sendToLLM(ACTION, ACTION);
        expect(events.requestedRolls).toHaveLength(1);
        runner.stageRoleplayCheck(events.requestedRolls, ACTION, {
            setupNarrative: runner.getLastCommittedTurn().content,
            setupMessageId: events._setupMessageId,
        });
        expect(queryEmbeds()).toHaveLength(1);

        await runner.challengeRoleplayCheck('He is asleep on his feet; no check is needed.');
        expect(getState().pendingRoleplayCheck?.challengeUsed).toBe(true);
        expect(queryEmbeds()).toHaveLength(1);

        await runner.acceptRoleplayCheck();
        expect(getState().pendingRoleplayCheck).toBeNull();
        expect(streamMessage).toHaveBeenCalledTimes(3);
        expect(queryEmbeds()).toHaveLength(1);
        expect(queryEmbeds()[0][1]).toBe(`${ACTION}. Location: The gatehouse`);

        // The memo skipped the network hop, not retrieval: all three DM
        // prompts carried the memory.
        for (const call of streamMessage.mock.calls) {
            expect(call[0].systemPrompt).toContain('## RETRIEVED MEMORIES');
            expect(call[0].systemPrompt).toContain(MEMORY);
        }
    });

    it('a different player line is a different query and embeds again', async () => {
        await addMemory('test-key', MEMORY, 'world_fact');
        const streamMessage = scriptedStream([
            'The sergeant snores.',
            'The yard is empty.',
        ]);
        const { runner } = createHarness({ streamMessage });

        await runner.sendToLLM(ACTION, ACTION);
        await runner.sendToLLM('I cross the yard.', 'I cross the yard.');

        expect(queryEmbeds()).toHaveLength(2);
    });
});
