/**
 * MARK_MESSAGES_SUMMARIZED re-mints only the rows it newly covers
 * (2026-10-01 memory-journal P2). The old map cloned every row below the mark
 * — 2,000 of 2,000 when 10 were new — so each already-summarized row changed
 * identity on every cadence and its memoized ChatMessage re-rendered for
 * nothing.
 */
import { describe, expect, it } from 'vitest';
import { gameReducer, initialGameState } from './gameReducer.js';

const makeMessages = (count, summarizedPrefix = 0) => Array.from({ length: count }, (_, i) => ({
    id: `m-${i}`,
    role: i % 2 ? 'assistant' : 'user',
    content: `Line ${i}.`,
    ...(i < summarizedPrefix && { summarized: true }),
}));

describe('MARK_MESSAGES_SUMMARIZED', () => {
    it('flags the rows below the mark and stamps the session counter', () => {
        const state = { ...initialGameState, messages: makeMessages(16) };
        const next = gameReducer(state, { type: 'MARK_MESSAGES_SUMMARIZED', payload: 10 });

        expect(next.messages.map(m => !!m.summarized)).toEqual([
            ...Array(10).fill(true),
            ...Array(6).fill(false),
        ]);
        expect(next.session.prunedMessageCount).toBe(10);
    });

    it('keeps the identity of every row it did not change — already-summarized rows and the kept tail alike', () => {
        const state = { ...initialGameState, messages: makeMessages(26, 10) };
        const next = gameReducer(state, { type: 'MARK_MESSAGES_SUMMARIZED', payload: 20 });

        const reminted = next.messages.filter((m, i) => m !== state.messages[i]);
        expect(reminted).toHaveLength(10);
        for (let i = 0; i < 10; i++) expect(next.messages[i]).toBe(state.messages[i]);
        for (let i = 10; i < 20; i++) expect(next.messages[i]).toEqual({ ...state.messages[i], summarized: true });
        for (let i = 20; i < 26; i++) expect(next.messages[i]).toBe(state.messages[i]);
    });
});
