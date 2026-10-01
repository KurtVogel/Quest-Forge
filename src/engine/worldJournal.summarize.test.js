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

const { KEEP_TAIL, maybeAutoSummarize, resetSummarizeFailureTracker } = await import('./worldJournal.js');

function makeMessages(count, { hidden = false } = {}) {
    return Array.from({ length: count }, (_, i) => ({
        id: `m-${i}`,
        role: i % 2 === 0 ? 'user' : 'assistant',
        content: `Message ${i}`,
        ...(hidden && { hidden: true }),
    }));
}

/** The newest player/DM rows a cadence never summarizes (KEEP_TAIL, 2026-10-01). */
function makeTail() {
    return Array.from({ length: KEEP_TAIL }, (_, i) => ({
        id: `tail-${i}`,
        role: i % 2 === 0 ? 'user' : 'assistant',
        content: `Tail ${i}`,
    }));
}

/** `count` summarizable rows followed by the kept tail: the batch is rows [0, count). */
function makeBacklog(count) {
    return [...makeMessages(count), ...makeTail()];
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
        // Nine rows before the tail: one short of SUMMARIZE_EVERY.
        const state = makeState(makeBacklog(9));
        const dispatch = vi.fn();
        const result = await maybeAutoSummarize(state, dispatch, 0);
        expect(result).toEqual({ index: 0, journalEntry: null });
        expect(sendMessageMock).not.toHaveBeenCalled();
        expect(dispatch).not.toHaveBeenCalled();
    });

    it('defers the whole cadence while combat is active (Codex 2026-08-09: no mid-fight journal)', async () => {
        const state = { ...makeState(makeBacklog(14)), combat: { active: true } };
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
        const state = makeState(makeBacklog(12));
        const dispatch = vi.fn();
        const result = await maybeAutoSummarize(state, dispatch, 0);
        expect(result).toEqual({ index: 0, journalEntry: null });
        expect(sendMessageMock).not.toHaveBeenCalled();
    });

    it('summarizes a batch: journal entry, facts, location, and marks messages summarized', async () => {
        sendMessageMock.mockResolvedValue(validSummary({
            world_facts: Array.from({ length: 7 }, (_, i) => ({ fact: `Fact ${i}`, category: 'event' })),
        }));
        const state = makeState(makeBacklog(12));
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
        const state = makeState(makeBacklog(10));
        const dispatch = vi.fn();

        const result = await maybeAutoSummarize(state, dispatch, 0);

        expect(result.index).toBe(10);
        expect(dispatch).toHaveBeenCalledWith({ type: 'MARK_MESSAGES_SUMMARIZED', payload: 10 });
    });

    it('does not advance the index when the response has no parseable JSON', async () => {
        sendMessageMock.mockResolvedValue('I cannot summarize right now.');
        const state = makeState(makeBacklog(10));
        const dispatch = vi.fn();

        const result = await maybeAutoSummarize(state, dispatch, 0);

        expect(result).toEqual({ index: 0, journalEntry: null });
        expect(dispatch).not.toHaveBeenCalled();
    });

    it('does not advance the index when the LLM call rejects', async () => {
        sendMessageMock.mockRejectedValue(new Error('network down'));
        const state = makeState(makeBacklog(10));
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
        const state = makeState(makeBacklog(12));
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
        const state = makeState(makeBacklog(10));
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
        const state = makeState(makeBacklog(12));

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
        const state = makeState(makeBacklog(12));
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

describe('the cadence keeps a tail (2026-10-01 P1: every cadence used to EMPTY the DM window)', () => {
    it('fires at SUMMARIZE_EVERY rows before the tail and never marks the newest KEEP_TAIL player/DM rows', async () => {
        sendMessageMock.mockResolvedValue(validSummary());
        // 15 rows: 9 before the tail — one short.
        const short = await maybeAutoSummarize(makeState(makeBacklog(9)), vi.fn(), 0);
        expect(short).toEqual({ index: 0, journalEntry: null });
        expect(sendMessageMock).not.toHaveBeenCalled();

        const messages = makeBacklog(10);
        const dispatch = vi.fn();
        const result = await maybeAutoSummarize(makeState(messages), dispatch, 0);

        expect(result.index).toBe(10);
        expect(result.index).toBe(messages.length - KEEP_TAIL);
        expect(result.journalEntry.messageRange).toEqual([0, 10]);
        expect(dispatch).toHaveBeenCalledWith({ type: 'MARK_MESSAGES_SUMMARIZED', payload: 10 });
        // The tail never reaches the summarizer: it is still the DM's verbatim window.
        const payload = sendMessageMock.mock.calls[0][0].userMessage;
        expect(payload).toContain('Message 9');
        expect(payload).not.toContain('Tail 0');
    });

    it('counts the tail in player/DM rows — engine lines among them stay with it', async () => {
        sendMessageMock.mockResolvedValue(validSummary());
        const messages = [
            ...makeMessages(10),
            { id: 't-u1', role: 'user', content: 'I try the lock.' },
            { id: 't-roll', role: 'system', content: 'Astra rolled **17** on Sleight of Hand.' },
            { id: 't-a1', role: 'assistant', content: 'The lock gives.' },
            { id: 't-u2', role: 'user', content: 'I pay the fence.' },
            { id: 't-receipt', role: 'system', dmVisible: true, content: '−5 gp · purse: 12 gp' },
            { id: 't-a2', role: 'assistant', content: 'She counts it twice.' },
            { id: 't-u3', role: 'user', content: 'I ask about the ledger.' },
            { id: 't-a3', role: 'assistant', content: 'She shrugs.' },
        ];
        const dispatch = vi.fn();

        const result = await maybeAutoSummarize(makeState(messages), dispatch, 0);

        // Six player/DM rows = three exchanges; the roll line and the receipt ride with them.
        expect(result.index).toBe(10);
        const payload = sendMessageMock.mock.calls[0][0].userMessage;
        expect(payload).not.toContain('rolled **17**');
        expect(payload).not.toContain('I try the lock.');
    });

    it('the tail opens on the player\'s line — the batch never ends on an action without its outcome', async () => {
        sendMessageMock.mockResolvedValue(validSummary());
        // The shape the cadence usually sees: the newest DM row has not
        // reached the ref yet, so the six newest rows START on a DM row.
        const messages = [
            ...makeMessages(11), // ends on the player's "Message 10"
            { id: 'k-0', role: 'assistant', content: 'Kept 0' },
            { id: 'k-1', role: 'user', content: 'Kept 1' },
            { id: 'k-2', role: 'assistant', content: 'Kept 2' },
            { id: 'k-3', role: 'user', content: 'Kept 3' },
            { id: 'k-4', role: 'assistant', content: 'Kept 4' },
            { id: 'k-5', role: 'user', content: 'Kept 5' },
        ];
        const result = await maybeAutoSummarize(makeState(messages), vi.fn(), 0);

        // "Message 10" (the line "Kept 0" answers) stays with its answer.
        expect(result.index).toBe(10);
        const payload = sendMessageMock.mock.calls[0][0].userMessage;
        expect(payload).toContain('Message 9');
        expect(payload).not.toContain('Message 10');
    });

    it('a second cadence needs SUMMARIZE_EVERY new rows before the tail again — the boundary advances by the batch, not to the end', async () => {
        sendMessageMock.mockResolvedValue(validSummary());
        const messages = makeBacklog(10);
        const first = await maybeAutoSummarize(makeState(messages), vi.fn(), 0);
        expect(first.index).toBe(10);

        // The old tail is now the oldest unsummarized stretch; 8 new rows → 8 before the new tail.
        const more = [...messages, ...makeMessages(8).map((m, i) => ({ ...m, id: `n-${i}`, content: `Later ${i}` }))];
        const waiting = await maybeAutoSummarize(makeState(more), vi.fn(), first.index);
        expect(waiting).toEqual({ index: 10, journalEntry: null });

        const enough = [...more, { id: 'n-8', role: 'user', content: 'Later 8' }, { id: 'n-9', role: 'assistant', content: 'Later 9' }];
        const second = await maybeAutoSummarize(makeState(enough), vi.fn(), first.index);
        expect(second.index).toBe(20);
        expect(second.journalEntry.messageRange).toEqual([10, 20]);
        expect(sendMessageMock).toHaveBeenCalledTimes(2);
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
        const state = makeState(makeBacklog(12));
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

describe('the journal batch is narrative-eligible play only (2026-09-06 memory-journal audit)', () => {
    it('excludes infrastructure error lines and OOC table-talk pairs from the transcript, keeps roll-result lines', async () => {
        sendMessageMock.mockResolvedValue(validSummary());
        const messages = [
            ...makeMessages(10),
            { id: 'err', role: 'system', kind: 'error', content: 'Error resolving check: Failed to fetch' },
            { id: 'roll', role: 'system', content: 'Astra rolled **17** on Stealth.' },
            { id: 'ooc', role: 'user', content: 'OOC: can we slow the pacing down?' },
            { id: 'ooc-reply', role: 'assistant', content: 'At the table: sure, slower from here.' },
            ...makeTail(),
        ];
        const dispatch = vi.fn();

        await maybeAutoSummarize(makeState(messages), dispatch, 0);

        const payload = sendMessageMock.mock.calls[0][0].userMessage;
        expect(payload).not.toContain('Failed to fetch');
        expect(payload).not.toContain('slow the pacing');
        expect(payload).not.toContain('slower from here');
        expect(payload).toContain('rolled **17**');
        expect(payload).toContain('Message 9');
        // The excluded rows are still archived behind the boundary like any summarized stretch.
        expect(dispatch).toHaveBeenCalledWith({ type: 'MARK_MESSAGES_SUMMARIZED', payload: 14 });
    });

    it('counts the cadence in narrative-eligible messages, not raw rows (a dice turn burns ~5 raw rows)', async () => {
        // 10 raw rows, 6 narrative: the audit's reproduced "fired at 10 raw / 6 visible".
        const messages = makeMessages(10).map((m, i) => (i % 5 >= 3 ? { ...m, hidden: true } : m));
        const dispatch = vi.fn();

        const result = await maybeAutoSummarize(makeState([...messages, ...makeTail()]), dispatch, 0);
        expect(result).toEqual({ index: 0, journalEntry: null });
        expect(sendMessageMock).not.toHaveBeenCalled();

        // The same stretch fires once ten narrative messages lie before the tail.
        sendMessageMock.mockResolvedValue(validSummary());
        const more = [...messages, ...makeMessages(4).map((m, i) => ({ ...m, id: `x-${i}` })), ...makeTail()];
        const fired = await maybeAutoSummarize(makeState(more), dispatch, 0);
        expect(fired.index).toBe(14);
        expect(sendMessageMock).toHaveBeenCalledTimes(1);
    });
});

describe('combat-exchange dice lines are weightless to the cadence (2026-09-23 combat-exchange P1)', () => {
    const diceLine = (i) => ({
        id: `dice-${i}`,
        role: 'system',
        exchangeLine: true,
        content: `**Oda attacks Marsh bandit ${(i % 4) + 1}** — Rolled **${10 + (i % 9)}** vs AC 13; **Hit for 7 damage.**`,
    });

    it('64 exchange lines neither count as narrative nor trip the raw backlog escape', async () => {
        const messages = [...makeMessages(6), ...Array.from({ length: 64 }, (_, i) => diceLine(i))];
        const dispatch = vi.fn();

        const result = await maybeAutoSummarize(makeState(messages), dispatch, 0);

        expect(result).toEqual({ index: 0, journalEntry: null });
        expect(sendMessageMock).not.toHaveBeenCalled();
        expect(dispatch).not.toHaveBeenCalled();
    });

    it('a fight whose raw rows exceed the batch cap summarizes in ONE batch — dice lines archived behind the boundary, out of the payload', async () => {
        sendMessageMock.mockResolvedValue(validSummary());
        // 12 prose rows interleaved with 63 dice lines plus one engine status
        // line: 76 raw rows, past MAX_BATCH_MESSAGES — the raw cap used to cut
        // this into two batches (two Flash calls, two journal entries, one fight).
        const prose = makeMessages(12);
        const messages = [];
        prose.forEach((m, i) => {
            messages.push(m);
            if (i >= 2 && i < 11) {
                for (let k = 0; k < 7; k++) messages.push(diceLine(i * 7 + k));
            }
        });
        messages.push({ id: 'status', role: 'system', content: '**Marsh bandit 4** is defeated.' });
        expect(messages).toHaveLength(76);
        const fightEnd = messages.length;
        const dispatch = vi.fn();

        // Right after the fight the tail's cut would land BETWEEN two rounds:
        // the fight is never split — it waits whole (2026-10-01).
        const early = await maybeAutoSummarize(makeState(messages), dispatch, 0);
        expect(early).toEqual({ index: 0, journalEntry: null });
        expect(sendMessageMock).not.toHaveBeenCalled();

        // Three exchanges later the tail has moved past it: one batch, the whole fight.
        messages.push(...makeTail());
        const first = await maybeAutoSummarize(makeState(messages), dispatch, 0);

        expect(sendMessageMock).toHaveBeenCalledTimes(1);
        expect(first.index).toBe(fightEnd);
        expect(first.journalEntry.messageRange).toEqual([0, fightEnd]);
        expect(dispatch).toHaveBeenCalledWith({ type: 'MARK_MESSAGES_SUMMARIZED', payload: fightEnd });
        const payload = sendMessageMock.mock.calls[0][0].userMessage;
        expect(payload).not.toContain('Rolled **');
        expect(payload).toContain('Message 11');
        expect(payload).toContain('is defeated');

        // Nothing is left for a second cadence.
        const second = await maybeAutoSummarize(makeState(messages), dispatch, first.index);
        expect(second).toEqual({ index: first.index, journalEntry: null });
        expect(sendMessageMock).toHaveBeenCalledTimes(1);
    });

    it('the batch cap still counts every non-exchange row, so a stalled prose backlog drains cap-by-cap', async () => {
        sendMessageMock.mockResolvedValue(validSummary());
        const messages = [...makeMessages(60), ...Array.from({ length: 5 }, (_, i) => diceLine(i))];
        const dispatch = vi.fn();

        const result = await maybeAutoSummarize(makeState(messages), dispatch, 0);

        expect(result.index).toBe(40);
        expect(result.journalEntry.messageRange).toEqual([0, 40]);
    });
});
