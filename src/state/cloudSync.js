import { collection, doc, setDoc, getDoc, getDocs, deleteDoc } from "firebase/firestore";
import { db } from "../config/firebase.js";

/**
 * Interface mapping to existing persistence.js
 * The structure mirroring allows us to easily drop this in alongside IndexedDB.
 */

/** Max roll history entries to persist in cloud saves. */
const MAX_SAVED_ROLLS = 50;

/**
 * Firestore REJECTS document IDs that begin and end with double underscores
 * ("Resource id is invalid because it is reserved"), so the app's local autosave
 * slot name "__autosave__" can't be used as a cloud document ID. Callers keep
 * passing "__autosave__"; we map it to a legal doc ID at this boundary.
 */
const AUTOSAVE_SLOT = '__autosave__';
const CLOUD_AUTOSAVE_DOC_ID = 'autosave';

function cloudDocId(slotId) {
    return slotId === AUTOSAVE_SLOT ? CLOUD_AUTOSAVE_DOC_ID : slotId;
}

export async function saveGameToCloud(uid, slotId, gameState) {
    if (!db) return false;
    if (!uid) return false;

    try {
        const userSavesRef = collection(db, `users/${uid}/saves`);
        const saveDocRef = doc(userSavesRef, cloudDocId(slotId));

        // Cloud saves trim summarized messages to stay under Firestore's ~1MB doc limit
        // (their content lives on in journal entries + world facts). Local saves keep the
        // full history — see persistence.js.
        const trimmedMessages = (gameState.messages || []).filter(m => !m.summarized);
        // Cap: keep only the most recent rolls
        const trimmedRolls = (gameState.rollHistory || []).slice(-MAX_SAVED_ROLLS);
        // prunedMessageCount indexes into the array we actually persist. We just dropped
        // every summarized message, so the boundary resets to what remains (0).
        const prunedMessageCount = trimmedMessages.filter(m => m.summarized).length;

        // Build a trimmed copy of the state for the payload, stripping secrets
        const trimmedState = {
            ...gameState,
            messages: trimmedMessages,
            rollHistory: trimmedRolls,
            session: { ...gameState.session, prunedMessageCount },
            settings: {
                ...gameState.settings,
                apiKey: undefined,
                imageApiKey: undefined,
                firebaseConfig: undefined,
            },
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
            isAuto: slotId === AUTOSAVE_SLOT
        };

        // We store the full state as a stringified JSON blob to avoid Firestore's nested object limits/index explosion
        // and a separate metadata object for fast querying.
        await setDoc(saveDocRef, {
            ...metadata,
            payload: JSON.stringify(trimmedState)
        });

        console.log(`Cloud save successful: ${slotId}`);
        return true;
    } catch (e) {
        console.error("Cloud save failed:", e);
        return false;
    }
}

export async function loadGameFromCloud(uid, slotId) {
    if (!db || !uid) return null;

    try {
        const userSavesRef = collection(db, `users/${uid}/saves`);
        const saveDocRef = doc(userSavesRef, cloudDocId(slotId));

        const docSnap = await getDoc(saveDocRef);
        if (docSnap.exists()) {
            const data = docSnap.data();
            if (data.payload) {
                console.log(`Cloud load successful: ${slotId}`);
                return JSON.parse(data.payload);
            }
        }
        return null;
    } catch (e) {
        console.error("Cloud load failed:", e);
        return null;
    }
}

export async function listCloudSaves(uid) {
    if (!db || !uid) return [];

    try {
        const userSavesRef = collection(db, `users/${uid}/saves`);
        const snapshot = await getDocs(userSavesRef);
        const saves = [];

        snapshot.forEach((doc) => {
            const data = doc.data();
            // Don't include the massive payload string in the list view
            delete data.payload;
            // Exclude the autosave doc from the manual-saves list (match by doc ID too,
            // since the stored slotId field is the legacy "__autosave__" name)
            if (data.slotId !== AUTOSAVE_SLOT && doc.id !== CLOUD_AUTOSAVE_DOC_ID) {
                saves.push(data);
            }
        });

        return saves.sort((a, b) => new Date(b.savedAt || 0) - new Date(a.savedAt || 0));
    } catch (e) {
        console.error("Cloud list failed:", e);
        throw e;
    }
}

export async function deleteGameFromCloud(uid, slotId) {
    if (!db || !uid || !slotId) return false;

    try {
        const userSavesRef = collection(db, `users/${uid}/saves`);
        const saveDocRef = doc(userSavesRef, cloudDocId(slotId));
        await deleteDoc(saveDocRef);
        console.log(`Cloud delete successful: ${slotId}`);
        return true;
    } catch (e) {
        console.error("Cloud delete failed:", e);
        return false;
    }
}

