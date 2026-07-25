import { signInWithPopup, signOut, onAuthStateChanged } from "firebase/auth";
import { auth, googleProvider } from "../config/firebase.js";

/**
 * Sign in with Google Popup
 */
export async function signInWithGoogle() {
    if (!auth) throw new Error("Firebase auth not initialized");
    if (!googleProvider) throw new Error("Google auth provider not initialized");
    try {
        const result = await signInWithPopup(auth, googleProvider);
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
        await signOut(auth);
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
    return onAuthStateChanged(auth, callback);
}
