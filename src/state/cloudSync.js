import { collection, doc, getDoc, getDocs, runTransaction } from "firebase/firestore";
import { db } from "../config/firebase.js";
import { serializeGameState, buildSaveMetadata } from "./persistence.js";

/**
 * Cloud save layer (bring-your-own Firebase, manual saves only).
 * Mirrors persistence.js: both paths persist the SAME serialized state via
 * serializeGameState(), so a field cannot exist in one save format and not the other.
 */

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

/**
 * Firestore caps a document at 1 MiB, which a "sort of infinite" campaign will
 * eventually exceed no matter what gets trimmed. Payloads larger than one chunk
 * are split across a `chunks` subcollection and reassembled on load, so cloud
 * saves have no practical size ceiling (a whole batched write is capped at
 * 10 MiB by the Firestore API — tens of megabytes of pure JSON text — and can
 * be revisited with multi-batch generations if a campaign ever gets there).
 *
 * 300k JS chars ≤ ~900 KB even if every char encodes to 3 UTF-8 bytes; typical
 * prose is ~1 byte/char, so a chunk usually carries ~300 KB.
 */
const CHUNK_CHAR_LIMIT = 300000;

/** Split without ever cutting a surrogate pair in half (Firestore requires valid UTF-8). */
function splitPayload(payload) {
    const chunks = [];
    let start = 0;
    while (start < payload.length) {
        let end = Math.min(start + CHUNK_CHAR_LIMIT, payload.length);
        const lastCode = payload.charCodeAt(end - 1);
        if (end < payload.length && lastCode >= 0xd800 && lastCode <= 0xdbff) {
            end -= 1; // high surrogate at the boundary — keep the pair together
        }
        chunks.push(payload.slice(start, end));
        start = end;
    }
    return chunks;
}

function chunksCollection(uid, slotId) {
    return collection(db, `users/${uid}/saves/${cloudDocId(slotId)}/chunks`);
}

export async function saveGameToCloud(uid, slotId, gameState) {
    if (!db) return false;
    if (!uid) return false;

    try {
        const userSavesRef = collection(db, `users/${uid}/saves`);
        const saveDocRef = doc(userSavesRef, cloudDocId(slotId));

        // Cloud saves now carry the FULL message history, same as local saves —
        // chunking removed the 1 MiB reason to trim summarized scrollback.
        const messages = gameState.messages || [];
        const prunedMessageCount = messages.filter(m => m.summarized).length;
        const trimmedState = {
            ...serializeGameState(gameState),
            session: { ...gameState.session, prunedMessageCount },
        };

        const metadata = {
            slotId,
            ...buildSaveMetadata(gameState),
            name: gameState.session?.name || 'Auto-Save',
            savedAt: new Date().toISOString(),
            messageCount: messages.length,
            isAuto: slotId === AUTOSAVE_SLOT
        };

        // The state is stored as a stringified JSON blob (avoids Firestore's nested
        // object limits/index explosion) beside the metadata used by the list view.
        const payload = JSON.stringify(trimmedState);
        const inline = payload.length <= CHUNK_CHAR_LIMIT;
        const chunks = inline ? [] : splitPayload(payload);

        // The previous save's chunk count is read INSIDE the transaction: two
        // devices saving the same slot near-simultaneously (Vesa's multi-machine
        // workflow) could otherwise both read a stale payloadChunks and race on
        // which stale chunks get cleared, orphaning a chunk. Firestore re-runs
        // the transaction on contention, so the stale-chunk sweep always matches
        // the state actually being overwritten. (Size-wise a transaction carries
        // the same ~10 MiB request ceiling the previous writeBatch had.)
        await runTransaction(db, async (transaction) => {
            const existingSnap = await transaction.get(saveDocRef);
            const previousChunkCount = existingSnap.exists() ? (existingSnap.data().payloadChunks || 0) : 0;
            transaction.set(saveDocRef, { ...metadata, payload: inline ? payload : null, payloadChunks: chunks.length });
            chunks.forEach((data, index) => {
                transaction.set(doc(chunksCollection(uid, slotId), String(index)), { index, data });
            });
            for (let stale = chunks.length; stale < previousChunkCount; stale++) {
                transaction.delete(doc(chunksCollection(uid, slotId), String(stale)));
            }
        });

        console.log(`Cloud save successful: ${slotId} (${payload.length} chars${payload.length > CHUNK_CHAR_LIMIT ? ', chunked' : ''})`);
        return true;
    } catch (e) {
        console.error("Cloud save failed:", e);
        if (e?.code === 'permission-denied') {
            console.error(
                "Cloud save hint: large saves are stored in a `chunks` subcollection. " +
                "If this campaign recently grew past one document, your Firebase project's " +
                "firestore.rules predate that — redeploy the repo's firestore.rules " +
                "(match /users/{userId}/saves/{saveId}/chunks/{chunkId})."
            );
        }
        return false;
    }
}

export async function loadGameFromCloud(uid, slotId) {
    if (!db || !uid) return null;

    try {
        const userSavesRef = collection(db, `users/${uid}/saves`);
        const saveDocRef = doc(userSavesRef, cloudDocId(slotId));

        const docSnap = await getDoc(saveDocRef);
        if (!docSnap.exists()) return null;
        const data = docSnap.data();

        if (data.payloadChunks > 0) {
            const snapshot = await getDocs(chunksCollection(uid, slotId));
            const chunks = [];
            snapshot.forEach((chunkDoc) => {
                const chunk = chunkDoc.data();
                if (Number.isInteger(chunk?.index) && typeof chunk?.data === 'string') {
                    chunks[chunk.index] = chunk.data;
                }
            });
            for (let i = 0; i < data.payloadChunks; i++) {
                if (typeof chunks[i] !== 'string') {
                    throw new Error(`Cloud save ${slotId} is missing chunk ${i} of ${data.payloadChunks}.`);
                }
            }
            console.log(`Cloud load successful: ${slotId} (${data.payloadChunks} chunks)`);
            return JSON.parse(chunks.slice(0, data.payloadChunks).join(''));
        }

        if (data.payload) {
            console.log(`Cloud load successful: ${slotId}`);
            return JSON.parse(data.payload);
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
            delete data.payloadChunks;
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

        // Deleting a Firestore document does NOT delete its subcollections —
        // orphaned chunks would silently linger (and could corrupt a future save
        // that reuses the slot with a smaller chunk count). Remove them explicitly,
        // reading the chunk count inside the transaction so a concurrent save from
        // another device cannot leave the sweep working from a stale count.
        await runTransaction(db, async (transaction) => {
            const existingSnap = await transaction.get(saveDocRef);
            const chunkCount = existingSnap.exists() ? (existingSnap.data().payloadChunks || 0) : 0;
            for (let i = 0; i < chunkCount; i++) {
                transaction.delete(doc(chunksCollection(uid, slotId), String(i)));
            }
            transaction.delete(saveDocRef);
        });

        console.log(`Cloud delete successful: ${slotId}`);
        return true;
    } catch (e) {
        console.error("Cloud delete failed:", e);
        return false;
    }
}
