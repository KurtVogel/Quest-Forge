/**
 * Scene-driven callback curation + the fallback-entry embed skip (2026-09-06
 * memory-journal / story-memory queue sweep).
 *
 * Both curateStoryMemory call sites used to hand the WHOLE roster to the
 * scorer, so the "+5 linked NPC present" bonus fired for every card whose
 * person existed anywhere in the campaign; and a `fallback` journal entry
 * ("Auto-summary was unavailable…") was embedded into RAG like any summary.
 * Partial mocks: only the spy targets are replaced.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { maybeAutoSummarizeMock, addMemoryMock, queueMemoryMock, flushMemoryQueueMock, curateStoryMemoryMock, retrieveRelevantMock } = vi.hoisted(() => ({
    queueMemoryMock: vi.fn(async () => {}),
    flushMemoryQueueMock: vi.fn(async () => {}),
    maybeAutoSummarizeMock: vi.fn(async (state, dispatch, boundary) => ({ index: boundary, journalEntry: null })),
    addMemoryMock: vi.fn(async () => {}),
    curateStoryMemoryMock: vi.fn(() => []),
    retrieveRelevantMock: vi.fn(async () => []),
}));

vi.mock('../engine/worldJournal.js', async (importOriginal) => ({
    ...(await importOriginal()),
    maybeAutoSummarize: maybeAutoSummarizeMock,
}));
vi.mock('../engine/vectorMemory.js', async (importOriginal) => ({
    ...(await importOriginal()),
    retrieveRelevant: retrieveRelevantMock,
    addMemory: addMemoryMock,
    queueMemory: queueMemoryMock,
    flushMemoryQueue: flushMemoryQueueMock,
}));
vi.mock('../engine/storyMemory.js', async (importOriginal) => ({
    ...(await importOriginal()),
    curateStoryMemory: curateStoryMemoryMock,
}));

import { gameReducer, initialGameState } from '../state/gameReducer.js';
import { createCharacter } from '../engine/characterUtils.js';
import { createTurnRunner, findPresentNpcs } from './turnOrchestrator.js';

const ABILITY_SCORES = {
    strength: 15, dexterity: 13, constitution: 14,
    intelligence: 10, wisdom: 12, charisma: 8,
};

const ROSTER = [
    { name: 'Celeste', disposition: 'guarded', lastNotes: 'Keeps the parlour ledger.' },
    { name: 'Vasko', disposition: 'hostile', lastNotes: 'Runs contraband past the toll gate.' },
    { name: 'Ketta', disposition: 'loyal', lastNotes: 'Travels with the hero.' },
];

function makeState(overrides = {}) {
    return {
        ...initialGameState,
        character: createCharacter('Testa', 'human', 'fighter', ABILITY_SCORES, ['athletics']),
        // Gemini DM: the main key doubles as the machinery key, so the
        // retrieval + embed branches are genuinely live here.
        settings: { ...initialGameState.settings, llmProvider: 'gemini', apiKey: 'test-key', model: 'test-model' },
        session: { ...initialGameState.session, id: 'session-test' },
        npcs: ROSTER,
        party: [{ id: 'ketta', name: 'Ketta' }],
        messages: [
            { id: 'u1', role: 'user', content: 'I step into the parlour.' },
            { id: 'a1', role: 'assistant', content: 'Celeste looks up from the ledger as you enter.' },
        ],
        ...overrides,
    };
}

function createHarness(overrides) {
    let state = makeState(overrides);
    const dispatch = (action) => { state = gameReducer(state, action); };
    const runner = createTurnRunner({
        getState: () => state,
        dispatch,
        streamMessage: vi.fn(async ({ onChunk }) => { onChunk?.('She nods slowly.'); return 'She nods slowly.'; }),
        sendMessage: vi.fn(async () => ''),
    });
    return { runner, getState: () => state };
}

beforeEach(() => {
    maybeAutoSummarizeMock.mockClear();
    addMemoryMock.mockClear();
    queueMemoryMock.mockClear();
    flushMemoryQueueMock.mockClear();
    curateStoryMemoryMock.mockClear();
    retrieveRelevantMock.mockClear();
});

describe('findPresentNpcs — the scene, not the roster (2026-09-06 P1)', () => {
    it('returns the roster records named in the player line or recent narration, plus party companions', () => {
        // The player's line never names Celeste; the DM's last narration does.
        const present = findPresentNpcs(makeState(), 'What do you know about the ledger?');
        expect(present.map(n => n.name)).toEqual(['Celeste', 'Ketta']);
    });

    it('the player line counts as presence too', () => {
        const present = findPresentNpcs(makeState(), 'Where is Vasko hiding?');
        expect(present.map(n => n.name)).toEqual(['Celeste', 'Vasko', 'Ketta']);
    });

    it('is empty for an empty roster and never reads hidden lines as presence', () => {
        expect(findPresentNpcs({ npcs: [], messages: [] }, 'Vasko!')).toEqual([]);
        const state = makeState({ messages: [{ id: 'h', role: 'assistant', content: 'Vasko sneers.', hidden: true }] });
        expect(findPresentNpcs(state, 'I look around.').map(n => n.name)).toEqual(['Ketta']);
    });
});

describe('sendToLLM curates dramatic callbacks from the scene', () => {
    it('hands curateStoryMemory the present NPCs and the live transcript, never the whole roster', async () => {
        const { runner } = createHarness();

        await runner.sendToLLM('What do you know about the ledger?', 'What do you know about the ledger?');

        expect(curateStoryMemoryMock).toHaveBeenCalledTimes(1);
        const args = curateStoryMemoryMock.mock.calls[0][0];
        expect(args.npcs.map(n => n.name)).toEqual(['Celeste', 'Ketta']);
        expect(Array.isArray(args.messages)).toBe(true);
        expect(args.messages.length).toBeGreaterThanOrEqual(2);
        expect(args.location).toBe('');
    });
});

describe('runAutoSummarize never embeds a fallback journal entry (2026-09-06 P2)', () => {
    it('never carries a fallback entry; a real summary rides the NEXT turn\'s batch, not a request of its own (2026-10-01 P2)', async () => {
        const { runner } = createHarness();

        maybeAutoSummarizeMock.mockResolvedValueOnce({
            index: 10,
            journalEntry: {
                summary: '(Auto-summary was unavailable for a stretch of 10 messages; the events of that stretch are archived without a summary.)',
                fallback: true,
                location: null,
            },
        });
        await runner.runAutoSummarize();

        maybeAutoSummarizeMock.mockResolvedValueOnce({
            index: 20,
            journalEntry: { summary: 'Celeste showed the hero the ledger.', location: 'Parlour' },
        });
        await runner.runAutoSummarize();
        // The cadence itself embeds NOTHING: the turn's batch already flushed,
        // so an embed here was a third request on every cadence turn.
        expect(addMemoryMock).not.toHaveBeenCalled();
        expect(queueMemoryMock).not.toHaveBeenCalled();

        // The next turn's extraction carries the row in its one batch.
        await runner.sendToLLM('I ask about the ledger.', 'I ask about the ledger.');
        expect(runner.runPostTurnExtraction('I ask about the ledger.')).toBe(true);
        const journalRows = queueMemoryMock.mock.calls.filter(call => call[2] === 'journal');
        expect(journalRows).toHaveLength(1);
        expect(journalRows[0][1]).toBe('Celeste showed the hero the ledger.');
        expect(journalRows[0][3]).toBe('Parlour');
        expect(journalRows[0][4]).toEqual(['Celeste']);
        expect(queueMemoryMock.mock.calls.some(call => /unavailable/.test(call[1]))).toBe(false);
        expect(flushMemoryQueueMock).toHaveBeenCalledTimes(1);
        expect(addMemoryMock).not.toHaveBeenCalled();

        // Carried once: the turn after that queues only its own narrative.
        queueMemoryMock.mockClear();
        await runner.sendToLLM('I leave the parlour.', 'I leave the parlour.');
        runner.runPostTurnExtraction('I leave the parlour.');
        expect(queueMemoryMock.mock.calls.filter(call => call[2] === 'journal')).toHaveLength(0);
    });
});
