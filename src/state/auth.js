import { auth, authSdk, googleProvider } from "../config/firebase.js";

// No static `firebase/auth` import (2026-09-22 audit P2): the SDK is loaded by
// `initializeFirebase` and read through `authSdk`, which is non-null exactly
// when `auth` is — every guard below therefore also guarantees the module.

/**
 * Sign in with Google Popup
 */
export async function signInWithGoogle() {
    if (!auth) throw new Error("Firebase auth not initialized");
    if (!googleProvider) throw new Error("Google auth provider not initialized");
    try {
        const result = await authSdk.signInWithPopup(auth, googleProvider);
        return result.user;
    } catch (error) {
        console.error("Error signing in with Google", error);
        throw error;
    }
}

/**
 * Sign out of Firebase
 */
export async function logOut() {
    if (!auth) return;
    try {
        await authSdk.signOut(auth);
    } catch (error) {
        console.error("Error signing out", error);
        throw error;
    }
}

/**
 * Subscribe to auth state changes
 * @param {Function} callback - Called with the user object or null
 * @returns {Function} Unsubscribe function
 */
export function subscribeToAuth(callback) {
    if (!auth) {
        callback(null);
        return () => { };
    }
    return authSdk.onAuthStateChanged(auth, callback);
}
