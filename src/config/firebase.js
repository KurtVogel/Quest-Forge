import { initializeApp, getApps, getApp, deleteApp } from "firebase/app";
import { getAuth, GoogleAuthProvider } from "firebase/auth";
import { getFirestore } from "firebase/firestore";

// The config will be injected into this module by the React context when the user provides it in Settings
export let app = null;
export let auth = null;
export let db = null;
export let googleProvider = null;

// Type-strict, never `x?.trim()` (2026-09-10 audit P2): a non-string apiKey in
// localStorage settings threw OUTSIDE initializeFirebase's try, so
// GameContext.initAuth rejected unhandled, never dispatched SIGNOUT_USER, and
// the start screen sat on "Checking cloud sync..." forever.
const configText = (value) => (typeof value === 'string' ? value.trim() : '');

export function getFirebaseConfigError(config) {
    if (!config || typeof config !== 'object') return "Firebase config is missing";
    if (!configText(config.apiKey)) return "Firebase apiKey is required";
    if (!configText(config.authDomain)) return "Firebase authDomain is required for Google Sign-In";
    if (!configText(config.projectId)) return "Firebase projectId is required";
    return "";
}

function setFirebaseServices(firebaseApp) {
    app = firebaseApp;
    auth = getAuth(firebaseApp);
    db = getFirestore(firebaseApp);
    googleProvider = new GoogleAuthProvider();
    googleProvider.setCustomParameters({ prompt: "select_account" });
}

export async function initializeFirebase(config) {
    if (getFirebaseConfigError(config)) {
        return false;
    }

    try {
        if (getApps().length) {
            const existingApp = getApp();
            const isSameConfig = existingApp.options.apiKey === config.apiKey
                && existingApp.options.authDomain === config.authDomain
                && existingApp.options.projectId === config.projectId;
            if (isSameConfig) {
                setFirebaseServices(existingApp);
                return true;
            }
            // Destroy the old instance if the key changed
            await deleteApp(existingApp);
        }

        setFirebaseServices(initializeApp(config));

        console.log("Firebase initialized successfully.");
        return true;
    } catch (e) {
        console.error("Firebase initialization failed:", e);
        return false;
    }
}
