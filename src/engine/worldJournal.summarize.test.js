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

const { maybeAutoSummarize, resetSummarizeFailureTracker } = await import('./worldJournal.js');

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
    resetSummarizeFailureTracker(); // module-level failure streak must not leak between tests
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

    it('defers the whole cadence while combat is active (Codex 2026-08-09: no mid-fight journal)', async () => {
        const state = { ...makeState(makeMessages(14)), combat: { active: true } };
        const dispatch = vi.fn();
        const result = await maybeAutoSummarize(state, dispatch, 0);
        expect(result).toEqual({ index: 0, journalEntry: null });
        expect(sendMessageMock).not.toHaveBeenCalled();
        expect(dispatch).not.toHaveBeenCalled();

        // The same backlog summarizes normally once the fight resolves.
        sendMessageMock.mockResolvedValue(validSummary());
        const after = await maybeAutoSummarize({ ...state, combat: { active: false } }, dispatch, 0);
        expect(after.index).toBe(14);
        expect(after.journalEntry).toBeTruthy();
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
        // fillOnly: a batch summary may fill/re-affirm a location but never
        // relocate the hero past a fresher same-turn Scribe arrival.
        expect(dispatch).toHaveBeenCalledWith({ type: 'SET_LOCATION', payload: { name: 'Brackwater', fillOnly: true } });
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

    it('coerces hostile field shapes: string consequences/key_decisions become arrays, junk location dropped', async () => {
        sendMessageMock.mockResolvedValue(validSummary({
            key_decisions: 'Refused to pay the toll',
            consequences: 'The reeve remembers the insult',
            location: 'null',
        }));
        const state = makeState(makeMessages(12));
        const dispatch = vi.fn();

        const result = await maybeAutoSummarize(state, dispatch, 0);

        expect(result.index).toBe(12);
        expect(result.journalEntry.keyDecisions).toEqual([]);
        expect(result.journalEntry.consequences).toEqual([]);
        // The literal "null" the prompt invites never becomes canonical — falls back to live state.
        expect(result.journalEntry.location).toBe('Brackwater');
        expect(dispatch.mock.calls.some(([action]) => action.type === 'SET_LOCATION')).toBe(false);
        const entryCall = dispatch.mock.calls.find(([action]) => action.type === 'ADD_JOURNAL_ENTRY');
        expect(Array.isArray(entryCall[0].payload.consequences)).toBe(true);
    });

    it('does not advance the index when the parsed summary carries no usable text', async () => {
        sendMessageMock.mockResolvedValue(JSON.stringify({
            summary: { text: 'object-valued summary' },
            npcs_encountered: [],
        }));
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

describe('poison-batch escape hatch + batch bounds (2026-08-18 audit P1)', () => {
    it('archives a persistently failing batch behind a fallback entry on the third consecutive failure', async () => {
        sendMessageMock.mockResolvedValue('I cannot help with that request.'); // e.g. a safety block, every time
        const state = makeState(makeMessages(12));

        for (const attempt of [1, 2]) {
            const dispatch = vi.fn();
            const result = await maybeAutoSummarize(state, dispatch, 0);
            expect(result, `attempt ${attempt} retries silently`).toEqual({ index: 0, journalEntry: null });
            expect(dispatch).not.toHaveBeenCalled();
        }

        const dispatch = vi.fn();
        const result = await maybeAutoSummarize(state, dispatch, 0);

        expect(result.index).toBe(12); // the cadence finally advances
        expect(result.journalEntry.fallback).toBe(true);
        expect(result.journalEntry.summary).toContain('archived without a summary');
        expect(result.journalEntry.messageRange).toEqual([0, 12]);
        expect(dispatch).toHaveBeenCalledWith(expect.objectContaining({ type: 'ADD_JOURNAL_ENTRY' }));
        expect(dispatch).toHaveBeenCalledWith({ type: 'MARK_MESSAGES_SUMMARIZED', payload: 12 });
        // No facts, NPCs, location, or reflection ride a fallback archive.
        expect(dispatch.mock.calls.every(([action]) => ['ADD_JOURNAL_ENTRY', 'MARK_MESSAGES_SUMMARIZED'].includes(action.type))).toBe(true);
        expect(reflectionMock).not.toHaveBeenCalled();
    });

    it('a success resets the failure streak — non-consecutive failures never trigger the hatch', async () => {
        const state = makeState(makeMessages(12));
        sendMessageMock.mockResolvedValue('no json here');
        await maybeAutoSummarize(state, vi.fn(), 0);
        await maybeAutoSummarize(state, vi.fn(), 0); // streak: 2

        sendMessageMock.mockResolvedValue(validSummary());
        const success = await maybeAutoSummarize(state, vi.fn(), 0);
        expect(success.index).toBe(12);

        sendMessageMock.mockResolvedValue('no json here');
        const dispatch = vi.fn();
        const result = await maybeAutoSummarize(state, dispatch, 0); // streak restarted: 1, not 3
        expect(result).toEqual({ index: 0, journalEntry: null });
        expect(dispatch).not.toHaveBeenCalled();
    });

    it('caps a stalled backlog to 40 messages per call and clamps each message to 2000 chars', async () => {
        sendMessageMock.mockResolvedValue(validSummary());
        const messages = makeMessages(60).map(m => ({ ...m, content: `${m.content} ${'y'.repeat(5000)}` }));
        const state = makeState(messages);
        const dispatch = vi.fn();

        const result = await maybeAutoSummarize(state, dispatch, 0);

        // Only the oldest 40 are summarized; the backlog drains next cadence.
        expect(result.index).toBe(40);
        expect(result.journalEntry.messageRange).toEqual([0, 40]);
        expect(dispatch).toHaveBeenCalledWith({ type: 'MARK_MESSAGES_SUMMARIZED', payload: 40 });

        const payload = sendMessageMock.mock.calls[0][0].userMessage;
        const transcriptLines = payload.split('\n\n').filter(line => line.startsWith('['));
        expect(transcriptLines).toHaveLength(40);
        for (const line of transcriptLines) {
            expect(line.length).toBeLessThanOrEqual(2000 + 20); // clamp + role prefix
        }
    });

    it('advances past an all-hidden stretch when more messages wait beyond the cap', async () => {
        const messages = [
            ...makeMessages(41, { hidden: true }),
            { id: 'm-visible', role: 'assistant', content: 'A visible message beyond the cap.' },
        ];
        const state = makeState(messages);
        const dispatch = vi.fn();

        const result = await maybeAutoSummarize(state, dispatch, 0);

        expect(result).toEqual({ index: 40, journalEntry: null });
        expect(sendMessageMock).not.toHaveBeenCalled();
        expect(dispatch).toHaveBeenCalledWith({ type: 'MARK_MESSAGES_SUMMARIZED', payload: 40 });
        expect(dispatch.mock.calls).toHaveLength(1);
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
