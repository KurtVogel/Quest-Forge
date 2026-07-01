/**
 * Tests for the SET_USER / SIGNOUT_USER reducer actions.
 */
import { describe, expect, it } from 'vitest';
import { gameReducer, initialGameState } from './gameReducer.js';

describe('SET_USER', () => {
    it('stores the user payload and clears auth-loading state', () => {
        const next = gameReducer(initialGameState, {
            type: 'SET_USER',
            payload: { uid: 'user-1', email: 'hero@example.com', isGuest: false },
        });
        expect(next.user).toEqual({ uid: 'user-1', email: 'hero@example.com', isGuest: false, isAuthLoading: false });
    });

    it('overwrites isAuthLoading even if the payload tries to set it', () => {
        const next = gameReducer(initialGameState, {
            type: 'SET_USER',
            payload: { uid: 'user-1', isAuthLoading: true },
        });
        expect(next.user.isAuthLoading).toBe(false);
    });
});

describe('SIGNOUT_USER', () => {
    it('resets the user to a signed-out, non-guest state', () => {
        const signedIn = {
            ...initialGameState,
            user: { uid: 'user-1', email: 'hero@example.com', isGuest: false, isAuthLoading: false },
        };
        const next = gameReducer(signedIn, { type: 'SIGNOUT_USER' });
        expect(next.user).toEqual({ uid: null, email: null, isGuest: false, isAuthLoading: false });
    });
});
