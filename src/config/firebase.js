// The Firebase SDK is loaded ON DEMAND, never statically (2026-09-22 audit
// P2): the three static importers put `vendor-firebase` (330 KB / 102.5 KB
// gzip, 23 % of all shipped JS) in every player's `modulepreload` list, while
// cloud sync is bring-your-own and the default player never configures it.
// `initializeFirebase` is the ONLY place the SDK is imported; `auth.js` and
// `cloudSync.js` read the loaded modules through `authSdk` / `firestoreSdk`,
// which are non-null exactly when `auth` / `db` are — so no caller ever runs
// ahead of the import. `scripts/check-dist-preload.mjs` fails the build if the
// chunk is ever preloaded again.

// The config will be injected into this module by the React context when the user provides it in Settings
export let app = null;
export let auth = null;
export let db = null;
export let googleProvider = null;
/** The `firebase/auth` functions auth.js uses, loaded by `initializeFirebase`; null until then. */
export let authSdk = null;
/** The `firebase/firestore` functions cloudSync.js uses, loaded by `initializeFirebase`; null until then. */
export let firestoreSdk = null;

/**
 * Destructured directly on each `await import()` on purpose: that is the one
 * shape Rollup tree-shakes a dynamic import in (not through `Promise.all`),
 * so the on-demand chunk carries only these functions — the same set the
 * static named imports used to keep — instead of the whole namespaces
 * (516 KB vs. 330 KB). The three modules share one chunk, so the sequential
 * awaits cost one network fetch. Add a function here when auth.js /
 * cloudSync.js need a new one.
 */
async function loadFirebaseSdk() {
    const { initializeApp, getApps, getApp, deleteApp } = await import("firebase/app");
    const { getAuth, GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged } = await import("firebase/auth");
    const { getFirestore, collection, doc, getDoc, getDocs, setDoc, deleteDoc, runTransaction } = await import("firebase/firestore");
    return {
        appModule: { initializeApp, getApps, getApp, deleteApp },
        authModule: { getAuth, GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged },
        firestoreModule: { getFirestore, collection, doc, getDoc, getDocs, setDoc, deleteDoc, runTransaction },
    };
}

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

function setFirebaseServices(firebaseApp, { authModule, firestoreModule }) {
    app = firebaseApp;
    auth = authModule.getAuth(firebaseApp);
    db = firestoreModule.getFirestore(firebaseApp);
    googleProvider = new authModule.GoogleAuthProvider();
    googleProvider.setCustomParameters({ prompt: "select_account" });
    authSdk = authModule;
    firestoreSdk = firestoreModule;
}

export async function initializeFirebase(config) {
    if (getFirebaseConfigError(config)) {
        return false;
    }

    try {
        const sdk = await loadFirebaseSdk();
        const { initializeApp, getApps, getApp, deleteApp } = sdk.appModule;
        if (getApps().length) {
            const existingApp = getApp();
            const isSameConfig = existingApp.options.apiKey === config.apiKey
                && existingApp.options.authDomain === config.authDomain
                && existingApp.options.projectId === config.projectId;
            if (isSameConfig) {
                setFirebaseServices(existingApp, sdk);
                return true;
            }
            // Destroy the old instance if the key changed
            await deleteApp(existingApp);
        }

        setFirebaseServices(initializeApp(config), sdk);

        console.log("Firebase initialized successfully.");
        return true;
    } catch (e) {
        console.error("Firebase initialization failed:", e);
        return false;
    }
}
