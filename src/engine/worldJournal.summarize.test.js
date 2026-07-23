/**
 * Tests for maybeAutoSummarize — the async journal pipeline itself (cadence guard,
 * repair-capable JSON parsing, world-facts cap, all-hidden batch guard, dispatch
 * sequence, and index advancement). The pure prompt-formatting helpers are covered
 * in worldJournal.test.js.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { sendMessageMock, backgroundConfigMock, reflectionMock } = vi.hoisted(() => ({
    sendMessageMock: vi.fn(),
    backgroundConfigMock: vi.fn(),
    reflectionMock: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../llm/adapter.js', () => ({ sendMessage: sendMessageMock }));
vi.mock('../llm/machinery.js', () => ({ getBackgroundConfig: backgroundConfigMock }));
vi.mock('../llm/scribe.js', () => ({ runNpcFrontReflection: reflectionMock }));

const { maybeAutoSummarize } = await import('./worldJournal.js');

function makeMessages(count, { hidden = false } = {}) {
    return Array.from({ length: count }, (_, i) => ({
        id: `m-${i}`,
        role: i % 2 === 0 ? 'user' : 'assistant',
        content: `Message ${i}`,
        ...(hidden && { hidden: true }),
    }));
}

function makeState(messages) {
    return {
        messages,
        settings: { apiKey: 'k', llmProvider: 'gemini' },
        currentLocation: 'Brackwater',
        session: { id: 'session-1' },
    };
}

const validSummary = (extra = {}) => JSON.stringify({
    summary: 'The hero reached Brackwater and made enemies at the toll gate.',
    npcs_encountered: [],
    location: 'Brackwater',
    key_decisions: ['Refused to pay the toll'],
    consequences: ['The reeve remembers the insult'],
    world_facts: [],
    ...extra,
});

beforeEach(() => {
    sendMessageMock.mockReset();
    reflectionMock.mockClear();
    backgroundConfigMock.mockReset();
    backgroundConfigMock.mockReturnValue({ apiKey: 'k', provider: 'gemini', model: 'flash' });
});

describe('maybeAutoSummarize', () => {
    it('does nothing before the cadence threshold', async () => {
        const state = makeState(makeMessages(9));
        const dispatch = vi.fn();
        const result = await maybeAutoSummarize(state, dispatch, 0);
        expect(result).toEqual({ index: 0, journalEntry: null });
        expect(sendMessageMock).not.toHaveBeenCalled();
        expect(dispatch).not.toHaveBeenCalled();
    });

    it('skips silently without a machinery key', async () => {
        backgroundConfigMock.mockReturnValue({ apiKey: null });
        const state = makeState(makeMessages(12));
        const dispatch = vi.fn();
        const result = await maybeAutoSummarize(state, dispatch, 0);
        expect(result).toEqual({ index: 0, journalEntry: null });
        expect(sendMessageMock).not.toHaveBeenCalled();
    });

    it('summarizes a batch: journal entry, facts, location, and marks messages summarized', async () => {
        sendMessageMock.mockResolvedValue(validSummary({
            world_facts: Array.from({ length: 7 }, (_, i) => ({ fact: `Fact ${i}`, category: 'event' })),
        }));
        const state = makeState(makeMessages(12));
        const dispatch = vi.fn();

        const result = await maybeAutoSummarize(state, dispatch, 0);

        expect(result.index).toBe(12);
        expect(result.journalEntry.summary).toContain('reached Brackwater');
        expect(result.journalEntry.location).toBe('Brackwater');
        expect(dispatch).toHaveBeenCalledWith(expect.objectContaining({ type: 'ADD_JOURNAL_ENTRY' }));
        expect(dispatch).toHaveBeenCalledWith({ type: 'SET_LOCATION', payload: 'Brackwater' });
        expect(dispatch).toHaveBeenCalledWith({ type: 'MARK_MESSAGES_SUMMARIZED', payload: 12 });
        // World facts are capped per batch so one summary cannot flood the store.
        const factsCall = dispatch.mock.calls.find(([action]) => action.type === 'ADD_WORLD_FACTS');
        expect(factsCall[0].payload).toHaveLength(5);
        expect(reflectionMock).toHaveBeenCalled();
    });

    it('recovers a summary with a trailing comma via the shared repair path', async () => {
        const broken = validSummary().replace('}', ',}');
        sendMessageMock.mockResolvedValue(`Here is the summary:\n${broken}`);
        const state = makeState(makeMessages(10));
        const dispatch = vi.fn();

        const result = await maybeAutoSummarize(state, dispatch, 0);

        expect(result.index).toBe(10);
        expect(dispatch).toHaveBeenCalledWith({ type: 'MARK_MESSAGES_SUMMARIZED', payload: 10 });
    });

    it('does not advance the index when the response has no parseable JSON', async () => {
        sendMessageMock.mockResolvedValue('I cannot summarize right now.');
        const state = makeState(makeMessages(10));
        const dispatch = vi.fn();

        const result = await maybeAutoSummarize(state, dispatch, 0);

        expect(result).toEqual({ index: 0, journalEntry: null });
        expect(dispatch).not.toHaveBeenCalled();
    });

    it('does not advance the index when the LLM call rejects', async () => {
        sendMessageMock.mockRejectedValue(new Error('network down'));
        const state = makeState(makeMessages(10));
        const dispatch = vi.fn();

        const result = await maybeAutoSummarize(state, dispatch, 0);

        expect(result).toEqual({ index: 0, journalEntry: null });
        expect(dispatch).not.toHaveBeenCalled();
    });

    it('defers an all-hidden batch instead of summarizing an empty transcript', async () => {
        const state = makeState(makeMessages(12, { hidden: true }));
        const dispatch = vi.fn();

        const result = await maybeAutoSummarize(state, dispatch, 0);

        expect(result).toEqual({ index: 0, journalEntry: null });
        expect(sendMessageMock).not.toHaveBeenCalled();
        expect(dispatch).not.toHaveBeenCalled();
    });
});

describe('npcs_encountered upsert loop (queue 2026-07-18)', () => {
    it('classifies and upserts named NPCs, skipping nameless entries and combat fodder', async () => {
        sendMessageMock.mockResolvedValue(validSummary({
            npcs_encountered: [
                {
                    name: 'Mother Sorsa',
                    disposition: 'neutral',
                    notes: 'Fenced the ledger without asking questions.',
                    personality: 'Dry, patient, exact about debts.',
                    basedIn: 'Kuusisaari',
                },
                { disposition: 'hostile', notes: 'A nameless entry the loop must skip.' },
                { name: 'Goblin Ambusher 3', notes: 'Combat fodder slain at the reeds.' },
            ],
        }));
        const state = makeState(makeMessages(12));
        const dispatch = vi.fn();

        await maybeAutoSummarize(state, dispatch, 0);

        const updates = dispatch.mock.calls.filter(([action]) => action.type === 'UPDATE_NPC');
        expect(updates).toHaveLength(1);
        expect(updates[0][0].payload).toMatchObject({
            name: 'Mother Sorsa',
            disposition: 'neutral',
            lastNotes: 'Fenced the ledger without asking questions.',
            personality: 'Dry, patient, exact about debts.',
            basedIn: 'Kuusisaari',
        });
        // Optional dossier fields the summary omitted must be absent, not undefined-clobbering.
        expect('goals' in updates[0][0].payload).toBe(false);
        expect('secrets' in updates[0][0].payload).toBe(false);
    });
});
