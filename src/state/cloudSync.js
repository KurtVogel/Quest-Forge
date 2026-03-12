import { collection, doc, setDoc, getDoc, getDocs, query, orderBy, limit, deleteDoc } from "firebase/firestore";
import { db } from "../config/firebase.js";

/**
 * Interface mapping to existing persistence.js
 * The structure mirroring allows us to easily drop this in alongside IndexedDB.
 */

/** Max roll history entries to persist in cloud saves. */
const MAX_SAVED_ROLLS = 50;

export async function saveGameToCloud(uid, slotId, gameState) {
    if (!db) return false;
    if (!uid) return false;

    try {
        const userSavesRef = collection(db, `users/${uid}/saves`);
        const saveDocRef = doc(userSavesRef, slotId);

        // Trim: drop summarized messages (their content lives in journal entries)
        const trimmedMessages = (gameState.messages || []).filter(m => !m.summarized);
        // Cap: keep only the most recent rolls
        const trimmedRolls = (gameState.rollHistory || []).slice(-MAX_SAVED_ROLLS);

        // Build a trimmed copy of the state for the payload
        const trimmedState = {
            ...gameState,
            messages: trimmedMessages,
            rollHistory: trimmedRolls,
        };

        // Extract metadata for the list view
        const metadata = {
            slotId,
            name: gameState.session?.name || 'Auto-Save',
            savedAt: new Date().toISOString(),
            characterName: gameState.character?.name || 'Unknown Hero',
            characterLevel: gameState.character?.level || 1,
            characterClass: gameState.character?.class || 'Unknown Class',
            characterHP: gameState.character?.currentHP || 0,
            characterMaxHP: gameState.character?.maxHP || 0,
            characterAC: gameState.character?.armorClass || 10,
            gold: gameState.character?.gold || 0,
            silver: gameState.character?.silver || 0,
            copper: gameState.character?.copper || 0,
            inventoryCount: gameState.inventory?.length || 0,
            location: gameState.currentLocation || null,
            questCount: gameState.quests?.filter(q => q.status === 'active')?.length || 0,
            partySize: gameState.party?.length || 0,
            messageCount: trimmedMessages.length,
            isAuto: slotId === '__autosave__'
        };

        // We store the full state as a stringified JSON blob to avoid Firestore's nested object limits/index explosion
        // and a separate metadata object for fast querying.
        await setDoc(saveDocRef, {
            ...metadata,
            payload: JSON.stringify(trimmedState)
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

export async function deleteGameFromCloud(uid, slotId) {
    if (!db || !uid || !slotId) return false;

    try {
        const userSavesRef = collection(db, `users/${uid}/saves`);
        const saveDocRef = doc(userSavesRef, slotId);
        await deleteDoc(saveDocRef);
        console.log(`☁️ Cloud delete successful: ${slotId}`);
        return true;
    } catch (e) {
        console.error("☁️ Cloud delete failed:", e);
        return false;
    }
}

