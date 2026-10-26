/**
 * Journal boundary derivation (2026-08-31 P1): the turn runner used to mirror
 * lastSummarizedIndex in a closure variable seeded once at mount. A same-session
 * LOAD_GAME swaps the whole timeline under the SAME runner (AppShell now
 * remounts via the load nonce, but the boundary must be load-safe on its own):
 * an earlier save left a stretch permanently unjournaled, a later/cloud save
 * re-summarized already-summarized messages and duplicated journal entries.
 * These tests pin that the boundary is derived FRESH from the live state's
 * summarized flags on every cadence.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { maybeAutoSummarizeMock } = vi.hoisted(() => ({
    maybeAutoSummarizeMock: vi.fn(async (state, dispatch, boundary) => ({ index: boundary, journalEntry: null })),
}));

vi.mock('../engine/worldJournal.js', async (importOriginal) => ({
    ...(await importOriginal()),
    maybeAutoSummarize: maybeAutoSummarizeMock,
}));

import { initialGameState } from '../state/gameReducer.js';
import { createTurnRunner } from './turnOrchestrator.js';

function makeMessages(count, summarizedPrefix) {
    return Array.from({ length: count }, (_, i) => ({
        id: `msg-${i}`,
        role: i % 2 ? 'assistant' : 'user',
        content: `Line ${i}.`,
        ...(i < summarizedPrefix && { summarized: true }),
    }));
}

function makeState({ messageCount, summarizedPrefix, prunedMessageCount }) {
    return {
        ...initialGameState,
        messages: makeMessages(messageCount, summarizedPrefix),
        session: { ...initialGameState.session, id: 'session-test', prunedMessageCount },
    };
}

beforeEach(() => {
    maybeAutoSummarizeMock.mockClear();
});

describe('turn runner — journal boundary survives a same-session load (P1 2026-08-31)', () => {
    it('derives the boundary from the CURRENT state, not a mount-time mirror', async () => {
        let state = makeState({ messageCount: 10, summarizedPrefix: 4, prunedMessageCount: 4 });
        const runner = createTurnRunner({
            getState: () => state,
            dispatch: () => {},
            streamMessage: vi.fn(async () => ''),
            sendMessage: vi.fn(async () => ''),
        });

        await runner.runAutoSummarize();
        expect(maybeAutoSummarizeMock).toHaveBeenLastCalledWith(expect.anything(), expect.anything(), 4);

        // Simulate LOAD_GAME of an EARLIER save of the same campaign swapping
        // the timeline under the same runner: only 2 messages are summarized
        // there. The old mirror would have kept passing 4, permanently skipping
        // messages 2–3 from the journal.
        state = makeState({ messageCount: 6, summarizedPrefix: 2, prunedMessageCount: 2 });
        await runner.runAutoSummarize();
        expect(maybeAutoSummarizeMock).toHaveBeenLastCalledWith(expect.anything(), expect.anything(), 2);
    });

    it('trusts the summarized flags when the session counter is missing or stale', async () => {
        // Legacy save: flags present, counter absent.
        let state = makeState({ messageCount: 8, summarizedPrefix: 5, prunedMessageCount: undefined });
        const runner = createTurnRunner({
            getState: () => state,
            dispatch: () => {},
            streamMessage: vi.fn(async () => ''),
            sendMessage: vi.fn(async () => ''),
        });
        await runner.runAutoSummarize();
        expect(maybeAutoSummarizeMock).toHaveBeenLastCalledWith(expect.anything(), expect.anything(), 5);

        // Corrupt/stale counter ahead of the flags: the flags win, so the
        // unsummarized stretch is never silently skipped.
        state = makeState({ messageCount: 8, summarizedPrefix: 3, prunedMessageCount: 6 });
        await runner.runAutoSummarize();
        expect(maybeAutoSummarizeMock).toHaveBeenLastCalledWith(expect.anything(), expect.anything(), 3);
    });
});
