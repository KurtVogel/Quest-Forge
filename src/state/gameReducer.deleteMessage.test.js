/**
 * DELETE_MESSAGE — the refusal-scrub affordance (2026-08-28). Soft-delete by
 * design: the row stays in the array so every stored messageIndex keeps
 * pointing at the right slot, but the message leaves the render, the DM
 * window, and conversational-distance counting.
 */
import { describe, expect, it } from 'vitest';
import { gameReducer, initialGameState } from './gameReducer.js';
import { buildMessageWindow } from '../components/Chat/turnVisibility.js';
import { conversationalDistance } from '../engine/replayLedger.js';

const msg = (id, role, content, extra = {}) => ({ id, role, content, timestamp: 1, ...extra });

function withMessages(messages) {
    return { ...initialGameState, messages };
}

describe('DELETE_MESSAGE', () => {
    it('soft-deletes by id — the row stays, flagged, so stored indexes never shift', () => {
        const state = withMessages([
            msg('m1', 'user', 'I kiss her.'),
            msg('m2', 'assistant', "Sorry, I can't continue with this scene."),
            msg('m3', 'user', 'We keep going.'),
        ]);
        const next = gameReducer(state, { type: 'DELETE_MESSAGE', payload: 'm2' });
        expect(next.messages).toHaveLength(3);
        expect(next.messages[1]).toMatchObject({ id: 'm2', deleted: true });
        expect(next.messages[0].deleted).toBeUndefined();
    });

    it('is a no-op for unknown ids and already-deleted messages', () => {
        const state = withMessages([msg('m1', 'user', 'Hello', { deleted: true })]);
        expect(gameReducer(state, { type: 'DELETE_MESSAGE', payload: 'm1' })).toBe(state);
        expect(gameReducer(state, { type: 'DELETE_MESSAGE', payload: 'nope' })).toBe(state);
        expect(gameReducer(state, { type: 'DELETE_MESSAGE', payload: null })).toBe(state);
    });

    it('a deleted message leaves the DM window — the refusal stops priming the next one', () => {
        const window = buildMessageWindow([
            msg('m1', 'user', 'I kiss her.'),
            msg('m2', 'assistant', "Sorry, I can't continue.", { deleted: true }),
            msg('m3', 'user', 'We keep going.'),
        ], 20);
        expect(window.map(m => m.content)).toEqual(['I kiss her.', 'We keep going.']);
    });

    it('deleted messages do not count toward conversational distance (replay windows hold)', () => {
        const messages = [
            msg('m0', 'user', 'buy the rope'),
            msg('m1', 'assistant', 'You buy the rope.'),
            msg('m2', 'assistant', 'refusal', { deleted: true }),
            msg('m3', 'assistant', 'recap', { deleted: true }),
            msg('m4', 'user', 'onward'),
        ];
        expect(conversationalDistance(messages, 1, 4)).toBe(1);
    });
});
