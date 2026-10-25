/**
 * Pins for the 2026-10-25 chat-orchestration audit queue (Lap 1), the
 * window half of the P1: a text-less player / DM row never reaches a
 * provider. A block-only reply used to commit `{ role: 'assistant',
 * content: '' }` and the pre-10-25 unfenced lane left blank rows in live
 * saves — Gemini 400s an empty text part, the compat APIs read a blank turn.
 * The filter sits beside `exchangeLine` and covers rows already stored.
 */
import { describe, expect, it } from 'vitest';
import { buildMessageWindow } from './turnVisibility.js';

describe('buildMessageWindow — a text-less player / DM row is not in the window (2026-10-25 P1)', () => {
    it('drops an empty assistant row and a whitespace-only user row, keeps the rows with text', () => {
        const window = buildMessageWindow([
            { id: 'u0', role: 'user', content: 'I search the chest.' },
            { id: 'a0', role: 'assistant', content: '' }, // the block-only commit of a pre-fix turn
            { id: 'u1', role: 'user', content: '   ' },
            { id: 'a1', role: 'assistant', content: 'Dust and a copper coin.' },
        ], 20);
        expect(window).toEqual([
            { role: 'user', content: 'I search the chest.' },
            { role: 'assistant', content: 'Dust and a copper coin.' },
        ]);
    });

    it('a non-string content is no text (the belt behind the load heal)', () => {
        const window = buildMessageWindow([
            { id: 'a0', role: 'assistant', content: null },
            { id: 'a1', role: 'assistant', content: 42 },
            { id: 'a2', role: 'assistant' },
            { id: 'u0', role: 'user', content: 'Hello?' },
        ], 20);
        expect(window).toEqual([{ role: 'user', content: 'Hello?' }]);
    });

    it('a legacy blank assistant row in a live save never reaches the provider, and the rows around it still fold normally', () => {
        const messages = [
            { id: 'u0', role: 'user', content: 'I offer the reeve a coin.' },
            { id: 'a0', role: 'assistant', content: '' },
            { id: 's0', role: 'system', dmVisible: true, content: '−1 gp · purse: 9 gp' },
            { id: 's1', role: 'system', dmVisible: true, content: '+1 Toll token' },
            { id: 'u1', role: 'user', content: 'I walk on.' },
        ];
        const window = buildMessageWindow(messages, 20);
        expect(window.some(m => !m.content.trim())).toBe(false);
        // The receipt run still folds into ONE row; the blank row neither
        // breaks the run nor holds a slot.
        expect(window).toEqual([
            { role: 'user', content: 'I offer the reeve a coin.' },
            { role: 'user', content: '−1 gp · purse: 9 gp\n+1 Toll token' },
            { role: 'user', content: 'I walk on.' },
        ]);
    });

    it('an empty system receipt is a blank row too — the filter is uniform', () => {
        const window = buildMessageWindow([
            { id: 's0', role: 'system', dmVisible: true, content: '' },
            { id: 'u0', role: 'user', content: 'Go on.' },
        ], 20);
        expect(window).toEqual([{ role: 'user', content: 'Go on.' }]);
    });
});
