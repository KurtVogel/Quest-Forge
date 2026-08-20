import { describe, expect, it, vi } from 'vitest';

/**
 * Combat-intent RAG skip (2026-08-06 P1, vector-memory-rag audit): the JSON-only
 * intent-translation call must not pay the blocking retrieval embed, must not
 * curate dramatic callbacks into a prompt that never narrates, and must not
 * clobber the Memory Inspector's last real capture. Partial mocks: only the spy
 * targets are replaced — promptBuilder keeps the real block builders.
 */

const { retrieveRelevantMock, curateStoryMemoryMock, captureInjectionMock } = vi.hoisted(() => ({
    retrieveRelevantMock: vi.fn(async () => []),
    curateStoryMemoryMock: vi.fn(() => []),
    captureInjectionMock: vi.fn(),
}));

vi.mock('../engine/vectorMemory.js', async (importOriginal) => ({
    ...(await importOriginal()),
    retrieveRelevant: retrieveRelevantMock,
    addMemory: vi.fn(async () => {}),
}));
vi.mock('../engine/storyMemory.js', async (importOriginal) => ({
    ...(await importOriginal()),
    curateStoryMemory: curateStoryMemoryMock,
}));
vi.mock('../debug/memoryInspectorStore.js', async (importOriginal) => ({
    ...(await importOriginal()),
    captureInjection: captureInjectionMock,
}));

import { gameReducer, initialGameState } from '../state/gameReducer.js';
import { createCharacter } from '../engine/characterUtils.js';
import { createTurnRunner } from './turnOrchestrator.js';

const ABILITY_SCORES = {
    strength: 15, dexterity: 13, constitution: 14,
    intelligence: 10, wisdom: 12, charisma: 8,
};

function createHarness({ streamMessage, combatActive = false } = {}) {
    let state = {
        ...initialGameState,
        character: createCharacter('Testa', 'human', 'fighter', ABILITY_SCORES, ['athletics']),
        // Gemini DM: the main key doubles as the machinery key, so the RAG
        // retrieval branch is genuinely live in these tests.
        settings: { ...initialGameState.settings, llmProvider: 'gemini', apiKey: 'test-key', model: 'test-model' },
        session: { ...initialGameState.session, id: 'session-test' },
        ...(combatActive && {
            combat: {
                ...initialGameState.combat,
                active: true,
                phase: 'awaiting_intent',
                enemies: [{ id: 'goblin-1', name: 'Goblin', currentHP: 7, maxHP: 7, ac: 13, health: 'healthy' }],
            },
        }),
    };
    const dispatch = (action) => { state = gameReducer(state, action); };
    const runner = createTurnRunner({
        getState: () => state,
        dispatch,
        streamMessage: streamMessage || vi.fn(async () => ''),
        sendMessage: vi.fn(async () => ''),
    });
    return { runner, getState: () => state };
}

describe('turn runner — combat-intent RAG skip', () => {
    it('a combat-intent call performs no retrieval, no curation, and no inspector capture', async () => {
        retrieveRelevantMock.mockClear();
        curateStoryMemoryMock.mockClear();
        captureInjectionMock.mockClear();
        const streamMessage = vi.fn(async ({ onChunk, systemPrompt }) => {
            expect(systemPrompt).toContain('COMBAT INTENT ONLY');
            expect(systemPrompt).not.toContain('RETRIEVED MEMORIES');
            const text = '```json\n{}\n```';
            onChunk?.(text);
            return text;
        });
        const { runner } = createHarness({ streamMessage, combatActive: true });

        await runner.sendToLLM('I attack the goblin.', 'I attack the goblin.', { combatIntentOnly: true });

        expect(streamMessage).toHaveBeenCalledTimes(1);
        expect(retrieveRelevantMock).not.toHaveBeenCalled();
        expect(curateStoryMemoryMock).not.toHaveBeenCalled();
        expect(captureInjectionMock).not.toHaveBeenCalled();
    });

    it('a standard narrative turn still retrieves, curates, and captures', async () => {
        retrieveRelevantMock.mockClear();
        curateStoryMemoryMock.mockClear();
        captureInjectionMock.mockClear();
        const streamMessage = vi.fn(async ({ onChunk }) => {
            const text = 'You enter the tavern.';
            onChunk?.(text);
            return text;
        });
        const { runner } = createHarness({ streamMessage });

        await runner.sendToLLM('I enter the tavern.', 'I enter the tavern.');

        expect(retrieveRelevantMock).toHaveBeenCalledTimes(1);
        expect(curateStoryMemoryMock).toHaveBeenCalledTimes(1);
        expect(captureInjectionMock).toHaveBeenCalledTimes(1);
    });
});

describe('turn runner — empty combat-intent messages (queue 2026-08-09, playtest #8)', () => {
    it('stores no assistant message when the intent translation is pure JSON', async () => {
        const streamMessage = vi.fn(async ({ onChunk }) => {
            const text = '```json\n{}\n```';
            onChunk?.(text);
            return text;
        });
        const { runner, getState } = createHarness({ streamMessage, combatActive: true });

        const events = await runner.sendToLLM('I attack the goblin.', 'I attack the goblin.', { combatIntentOnly: true });

        expect(events).toBeTruthy(); // events still flow to the caller for routing
        expect(getState().messages.filter(m => m.role === 'assistant')).toHaveLength(0);
        expect(runner.getLastCommittedTurn()).toBeNull();
    });

    it('still stores the message when the intent call leaked prose', async () => {
        const streamMessage = vi.fn(async ({ onChunk }) => {
            const text = 'The goblin snarls as you press in.\n```json\n{}\n```';
            onChunk?.(text);
            return text;
        });
        const { runner, getState } = createHarness({ streamMessage, combatActive: true });

        await runner.sendToLLM('I attack the goblin.', 'I attack the goblin.', { combatIntentOnly: true });

        const assistants = getState().messages.filter(m => m.role === 'assistant');
        expect(assistants).toHaveLength(1);
        expect(assistants[0].content).toContain('goblin snarls');
    });
});
