/**
 * The return card's engine side (WOW 2026-09-15, session-return W1):
 * `session.lastPlayedAt` is stamped on every committed TURN (player or DM
 * line, never an engine system line), LOAD_GAME heals a pre-stamp campaign
 * from the payload's save stamp, and the serialized payload carries that
 * stamp so the heal has something to read.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { gameReducer, initialGameState } from './gameReducer.js';
import { serializeGameState } from './persistence.js';

const T0 = 1_800_000_000_000;

describe('ADD_MESSAGE stamps session.lastPlayedAt on turns', () => {
    beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(T0); });
    afterEach(() => { vi.useRealTimers(); });

    const base = { ...initialGameState, messages: [], session: { ...initialGameState.session, id: 's1', lastPlayedAt: 1 } };

    it('a player line and a DM line move the stamp; a system line does not', () => {
        let state = gameReducer(base, { type: 'ADD_MESSAGE', payload: { role: 'user', content: 'I knock.' } });
        expect(state.session.lastPlayedAt).toBe(T0);
        vi.setSystemTime(T0 + 1000);
        state = gameReducer(state, { type: 'ADD_MESSAGE', payload: { role: 'system', content: '+1 gold' } });
        expect(state.session.lastPlayedAt).toBe(T0);
        vi.setSystemTime(T0 + 2000);
        state = gameReducer(state, { type: 'ADD_MESSAGE', payload: { role: 'assistant', content: 'The door opens.' } });
        expect(state.session.lastPlayedAt).toBe(T0 + 2000);
        expect(state.session.id).toBe('s1');
    });
});

describe('LOAD_GAME heals lastPlayedAt', () => {
    const save = (session, extra = {}) => ({
        ...initialGameState,
        character: { ...initialGameState.character, name: 'Aino', race: 'human', class: 'fighter', level: 1, abilityScores: { strength: 14, dexterity: 12, constitution: 13, intelligence: 10, wisdom: 10, charisma: 8 } },
        messages: [{ id: 'u1', role: 'user', content: 'x' }],
        session: { ...initialGameState.session, id: 's1', ...session },
        ...extra,
    });

    it('keeps a finite stamp, heals an absent one from savedAt, and leaves null when neither exists', () => {
        expect(gameReducer(initialGameState, { type: 'LOAD_GAME', payload: save({ lastPlayedAt: T0 }, { savedAt: T0 + 5 }) }).session.lastPlayedAt).toBe(T0);
        expect(gameReducer(initialGameState, { type: 'LOAD_GAME', payload: save({}, { savedAt: T0 + 5 }) }).session.lastPlayedAt).toBe(T0 + 5);
        expect(gameReducer(initialGameState, { type: 'LOAD_GAME', payload: save({ lastPlayedAt: 'yesterday' }) }).session.lastPlayedAt).toBeNull();
    });
});

describe('serializeGameState stamps savedAt on the payload', () => {
    it('so the loaded state (not just the slot metadata) carries the wall-clock time', () => {
        vi.useFakeTimers();
        vi.setSystemTime(T0);
        try {
            const payload = serializeGameState({ ...initialGameState, messages: [] });
            expect(payload.savedAt).toBe(T0);
            expect(payload).not.toHaveProperty('settings');
        } finally {
            vi.useRealTimers();
        }
    });
});
