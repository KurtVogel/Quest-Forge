import { initializeApp, getApps, getApp, deleteApp } from "firebase/app";
import { getAuth, GoogleAuthProvider } from "firebase/auth";
import { getFirestore } from "firebase/firestore";

// The config will be injected into this module by the React context when the user provides it in Settings
export let app = null;
export let auth = null;
export let db = null;
export let googleProvider = null;

export async function initializeFirebase(config) {
    if (!config || !config.apiKey || !config.projectId) {
        return false;
    }

    try {
        if (getApps().length) {
            const existingApp = getApp();
            if (existingApp.options.apiKey === config.apiKey) {
                return true;
            }
            // Destroy the old instance if the key changed
            await deleteApp(existingApp);
        }

        app = initializeApp(config);

        auth = getAuth(app);
        db = getFirestore(app);
        googleProvider = new GoogleAuthProvider();

        console.log("🔥 Firebase initialized successfully.");
        return true;
    } catch (e) {
        console.error("🔥 Firebase initialization failed:", e);
        return false;
    }
}
