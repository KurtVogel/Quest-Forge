import { collection, doc, setDoc, getDoc, getDocs, query, orderBy, limit, deleteDoc } from "firebase/firestore";
import { db } from "../config/firebase.js";

/**
 * Interface mapping to existing persistence.js
 * The structure mirroring allows us to easily drop this in alongside IndexedDB.
 */

export async function saveGameToCloud(uid, slotId, gameState) {
    if (!db) return false;
    if (!uid) return false;

    try {
        const userSavesRef = collection(db, `users/${uid}/saves`);
        const saveDocRef = doc(userSavesRef, slotId);

        // Extract metadata for the list view
        const metadata = {
            slotId,
            name: gameState.session?.name || 'Auto-Save',
            savedAt: new Date().toISOString(),
            characterName: gameState.character?.name || 'Unknown Hero',
            characterLevel: gameState.character?.level || 1,
            characterClass: gameState.character?.class || 'Unknown Class',
            messageCount: gameState.messages?.length || 0,
            isAuto: slotId === '__autosave__'
        };

        // We store the full state as a stringified JSON blob to avoid Firestore's nested object limits/index explosion
        // and a separate metadata object for fast querying.
        await setDoc(saveDocRef, {
            ...metadata,
            payload: JSON.stringify(gameState)
        });

        console.log(`☁️ Cloud save successful: ${slotId}`);
        return true;
    } catch (e) {
        console.error("☁️ Cloud save failed:", e);
        return false;
    }
}

export async function loadGameFromCloud(uid, slotId) {
    if (!db || !uid) return null;

    try {
        const userSavesRef = collection(db, `users/${uid}/saves`);
        const saveDocRef = doc(userSavesRef, slotId);

        const docSnap = await getDoc(saveDocRef);
        if (docSnap.exists()) {
            const data = docSnap.data();
            if (data.payload) {
                console.log(`☁️ Cloud load successful: ${slotId}`);
                return JSON.parse(data.payload);
            }
        }
        return null;
    } catch (e) {
        console.error("☁️ Cloud load failed:", e);
        return null;
    }
}

export async function listCloudSaves(uid) {
    if (!db || !uid) return [];

    try {
        const userSavesRef = collection(db, `users/${uid}/saves`);
        // Get all saves except autosave, ordered by newest first
        const q = query(userSavesRef, orderBy("savedAt", "desc"));

        const snapshot = await getDocs(q);
        const saves = [];

        snapshot.forEach((doc) => {
            const data = doc.data();
            // Don't include the massive payload string in the list view
            delete data.payload;
            if (data.slotId !== '__autosave__') {
                saves.push(data);
            }
        });

        return saves;
    } catch (e) {
        console.error("☁️ Cloud list failed:", e);
        return [];
    }
}

