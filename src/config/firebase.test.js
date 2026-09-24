/**
 * getFirebaseConfigError is type-strict (2026-09-10 cloud-sync audit P2): a
 * non-string `firebaseConfig.apiKey` in localStorage settings used to throw
 * `config.apiKey?.trim is not a function` OUTSIDE initializeFirebase's try —
 * GameContext.initAuth rejected unhandled and never dispatched SIGNOUT_USER,
 * so the start screen sat on "Checking cloud sync..." forever, and the
 * Settings Connect button threw on click.
 */
import { describe, expect, it, vi } from 'vitest';

// Each SDK mock factory records when it first runs — a vi.mock factory is
// evaluated on the module's FIRST import, so the flags say whether importing
// firebase.js alone pulls the SDK in (2026-09-22 audit P2: it must not).
const sdkLoaded = vi.hoisted(() => ({ app: false, auth: false, firestore: false }));
vi.mock('firebase/app', () => { sdkLoaded.app = true; return { initializeApp: vi.fn(() => ({ options: {} })), getApps: () => [], getApp: vi.fn(), deleteApp: vi.fn() }; });
vi.mock('firebase/auth', () => { sdkLoaded.auth = true; return { getAuth: vi.fn(() => ({ name: 'auth' })), GoogleAuthProvider: class { setCustomParameters() {} }, signInWithPopup: vi.fn(), signOut: vi.fn(), onAuthStateChanged: vi.fn() }; });
vi.mock('firebase/firestore', () => { sdkLoaded.firestore = true; return { getFirestore: vi.fn(() => ({ name: 'db' })), collection: vi.fn(), doc: vi.fn(), getDoc: vi.fn(), getDocs: vi.fn(), setDoc: vi.fn(), deleteDoc: vi.fn(), runTransaction: vi.fn() }; });

const firebase = await import('./firebase.js');
const { getFirebaseConfigError, initializeFirebase } = firebase;

describe('the Firebase SDK loads on demand, never with the module (2026-09-22 audit P2)', () => {
    it('importing firebase.js and rejecting a junk config pull in NO SDK module', async () => {
        expect(sdkLoaded).toEqual({ app: false, auth: false, firestore: false });
        await expect(initializeFirebase({ apiKey: { k: 1 } })).resolves.toBe(false);
        await expect(initializeFirebase(null)).resolves.toBe(false);
        expect(sdkLoaded).toEqual({ app: false, auth: false, firestore: false });
        expect(firebase.db).toBeNull();
        expect(firebase.authSdk).toBeNull();
        expect(firebase.firestoreSdk).toBeNull();
    });

    it('a valid config loads the SDK and publishes the modules beside the services, so auth.js / cloudSync.js never run ahead of the import', async () => {
        await expect(initializeFirebase({ apiKey: 'k', authDomain: 'd', projectId: 'p' })).resolves.toBe(true);
        expect(sdkLoaded).toEqual({ app: true, auth: true, firestore: true });
        expect(firebase.db).toEqual({ name: 'db' });
        expect(firebase.auth).toEqual({ name: 'auth' });
        // The curated function sets the two consumers read (tree-shaken: the
        // chunk carries these, not the whole SDK namespaces).
        for (const name of ['collection', 'doc', 'getDoc', 'getDocs', 'setDoc', 'deleteDoc', 'runTransaction']) {
            expect(typeof firebase.firestoreSdk[name]).toBe('function');
        }
        for (const name of ['signInWithPopup', 'signOut', 'onAuthStateChanged']) {
            expect(typeof firebase.authSdk[name]).toBe('function');
        }
    });
});

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
