/**
 * getFirebaseConfigError is type-strict (2026-09-10 cloud-sync audit P2): a
 * non-string `firebaseConfig.apiKey` in localStorage settings used to throw
 * `config.apiKey?.trim is not a function` OUTSIDE initializeFirebase's try —
 * GameContext.initAuth rejected unhandled and never dispatched SIGNOUT_USER,
 * so the start screen sat on "Checking cloud sync..." forever, and the
 * Settings Connect button threw on click.
 */
import { describe, expect, it, vi } from 'vitest';

vi.mock('firebase/app', () => ({ initializeApp: vi.fn(), getApps: () => [], getApp: vi.fn(), deleteApp: vi.fn() }));
vi.mock('firebase/auth', () => ({ getAuth: vi.fn(), GoogleAuthProvider: class { setCustomParameters() {} } }));
vi.mock('firebase/firestore', () => ({ getFirestore: vi.fn() }));

const { getFirebaseConfigError, initializeFirebase } = await import('./firebase.js');

describe('getFirebaseConfigError', () => {
    it('never throws on a non-string field — it reports the field as missing', () => {
        for (const apiKey of [{ k: 1 }, 42, ['a'], null, true]) {
            expect(() => getFirebaseConfigError({ apiKey, authDomain: 'x.firebaseapp.com', projectId: 'x' })).not.toThrow();
            expect(getFirebaseConfigError({ apiKey, authDomain: 'x.firebaseapp.com', projectId: 'x' })).toMatch(/apiKey is required/);
        }
        expect(getFirebaseConfigError({ apiKey: 'k', authDomain: 7, projectId: 'x' })).toMatch(/authDomain/);
        expect(getFirebaseConfigError({ apiKey: 'k', authDomain: 'd', projectId: {} })).toMatch(/projectId/);
    });

    it('rejects a non-object config outright and accepts an honest one', () => {
        expect(getFirebaseConfigError('junk')).toMatch(/missing/);
        expect(getFirebaseConfigError(null)).toMatch(/missing/);
        expect(getFirebaseConfigError({ apiKey: ' k ', authDomain: 'd', projectId: 'p' })).toBe('');
    });

    it('initializeFirebase resolves false (never rejects) on a junk config', async () => {
        await expect(initializeFirebase({ apiKey: { k: 1 } })).resolves.toBe(false);
    });
});
