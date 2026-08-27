/**
 * Tests for the auth wrapper (2026-08-27 audit: file was at 0%): the no-auth
 * callback(null) path of subscribeToAuth and both signInWithGoogle throw
 * guards, plus the delegation paths against mocked firebase/auth.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';

beforeEach(() => {
    vi.resetModules();
});

async function importAuth({ auth = null, googleProvider = null } = {}) {
    const onAuthStateChanged = vi.fn(() => () => {});
    const signOut = vi.fn(() => Promise.resolve());
    const signInWithPopup = vi.fn(() => Promise.resolve({ user: { uid: 'u1', email: 'v@example.com' } }));
    vi.doMock('firebase/auth', () => ({ onAuthStateChanged, signOut, signInWithPopup }));
    vi.doMock('../config/firebase.js', () => ({ auth, googleProvider }));
    const mod = await import('./auth.js');
    return { mod, onAuthStateChanged, signOut, signInWithPopup };
}

describe('subscribeToAuth', () => {
    it('with no auth: calls back with null synchronously and returns a working unsubscribe', async () => {
        const { mod, onAuthStateChanged } = await importAuth({ auth: null });
        const callback = vi.fn();
        const unsubscribe = mod.subscribeToAuth(callback);
        expect(callback).toHaveBeenCalledExactlyOnceWith(null);
        expect(typeof unsubscribe).toBe('function');
        expect(() => unsubscribe()).not.toThrow();
        expect(onAuthStateChanged).not.toHaveBeenCalled();
    });

    it('with auth: delegates to onAuthStateChanged and returns its unsubscriber', async () => {
        const authObj = { name: 'auth' };
        const { mod, onAuthStateChanged } = await importAuth({ auth: authObj });
        const unsub = () => {};
        onAuthStateChanged.mockReturnValue(unsub);
        const callback = vi.fn();
        expect(mod.subscribeToAuth(callback)).toBe(unsub);
        expect(onAuthStateChanged).toHaveBeenCalledExactlyOnceWith(authObj, callback);
        expect(callback).not.toHaveBeenCalled();
    });
});

describe('signInWithGoogle guards', () => {
    it('throws when Firebase auth is not initialized', async () => {
        const { mod, signInWithPopup } = await importAuth({ auth: null, googleProvider: {} });
        await expect(mod.signInWithGoogle()).rejects.toThrow('Firebase auth not initialized');
        expect(signInWithPopup).not.toHaveBeenCalled();
    });

    it('throws when the Google provider is not initialized', async () => {
        const { mod, signInWithPopup } = await importAuth({ auth: {}, googleProvider: null });
        await expect(mod.signInWithGoogle()).rejects.toThrow('Google auth provider not initialized');
        expect(signInWithPopup).not.toHaveBeenCalled();
    });

    it('resolves the signed-in user when both are initialized', async () => {
        const { mod } = await importAuth({ auth: {}, googleProvider: {} });
        await expect(mod.signInWithGoogle()).resolves.toEqual({ uid: 'u1', email: 'v@example.com' });
    });
});

describe('logOut', () => {
    it('no-ops without auth', async () => {
        const { mod, signOut } = await importAuth({ auth: null });
        await expect(mod.logOut()).resolves.toBeUndefined();
        expect(signOut).not.toHaveBeenCalled();
    });

    it('delegates to signOut with auth present', async () => {
        const authObj = {};
        const { mod, signOut } = await importAuth({ auth: authObj });
        await mod.logOut();
        expect(signOut).toHaveBeenCalledExactlyOnceWith(authObj);
    });
});
