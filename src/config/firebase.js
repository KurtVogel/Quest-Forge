import { initializeApp, getApps, getApp, deleteApp } from "firebase/app";
import { getAuth, GoogleAuthProvider } from "firebase/auth";
import { getFirestore } from "firebase/firestore";

// The config will be injected into this module by the React context when the user provides it in Settings
export let app = null;
export let auth = null;
export let db = null;
export let googleProvider = null;

export function getFirebaseConfigError(config) {
    if (!config) return "Firebase config is missing";
    if (!config.apiKey?.trim()) return "Firebase apiKey is required";
    if (!config.authDomain?.trim()) return "Firebase authDomain is required for Google Sign-In";
    if (!config.projectId?.trim()) return "Firebase projectId is required";
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

        console.log("🔥 Firebase initialized successfully.");
        return true;
    } catch (e) {
        console.error("🔥 Firebase initialization failed:", e);
        return false;
    }
}
