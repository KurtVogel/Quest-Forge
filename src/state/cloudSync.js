import { collection, doc, getDoc, getDocs, runTransaction } from "firebase/firestore";
import { db } from "../config/firebase.js";
import { serializeGameState, buildSaveMetadata } from "./persistence.js";

/**
 * Cloud save layer (bring-your-own Firebase, manual saves only).
 * Mirrors persistence.js: both paths persist the SAME serialized state via
 * serializeGameState(), so a field cannot exist in one save format and not the other.
 */

/**
 * LEGACY-DATA GUARDS. Nothing writes the autosave slot to the cloud anymore
 * (cloud sync carries manual saves only), but old accounts may still hold an
 * autosave doc from the era when it did. `cloudDocId` keeps the mapping so a
 * legacy doc stays addressable (Firestore REJECTS IDs that begin and end with
 * double underscores — "Resource id is invalid because it is reserved"), and
 * `listCloudSaves` keeps excluding it from the manual-saves list. Do not grow
 * these into a write path (2026-08-27 audit: the write-side vestiges were
 * dropped).
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

/**
 * Pre-flight ceiling for one cloud save. Firestore caps a single transaction /
 * batched-write REQUEST at 10 MiB, and a whole campaign's payload rides one
 * transaction; a mature full-history campaign that crosses it would otherwise
 * fail on every save with an opaque error forever (2026-09-02 audit). 9 MiB
 * leaves headroom for the metadata doc and per-chunk envelope. Multi-batch
 * generations (several transactions + a generation stamp) would lift this.
 */
export const CLOUD_SAVE_BYTE_LIMIT = 9 * 1024 * 1024;

const CLOUD_RULES_HINT =
    "Every save's payload is stored in a `chunks` subcollection. If your Firebase " +
    "project's firestore.rules predate that, redeploy the repo's firestore.rules " +
    "(match /users/{userId}/saves/{saveId}/chunks/{chunkId}).";

const formatMiB = (bytes) => `${(bytes / (1024 * 1024)).toFixed(1)} MB`;

/** UTF-8 byte length — what Firestore actually meters, not JS char count. */
function payloadByteLength(payload) {
    return new TextEncoder().encode(payload).length;
}

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

/**
 * Result shape: `{ ok: true }` or `{ ok: false, reason, message }`, where
 * `message` is player-readable and `reason` is one of
 * `unavailable` (no Firebase configured) · `signed-out` · `too-large`
 * (pre-flight, Firestore never called) · `permission-denied` · `error`.
 * Every failure was a bare `false` until 2026-09-02; the two classes that need
 * DIFFERENT player actions (redeploy rules vs. the campaign outgrew one cloud
 * request) were indistinguishable in the UI.
 */
export async function saveGameToCloud(uid, slotId, gameState) {
    if (!db) return { ok: false, reason: 'unavailable', message: 'Cloud sync is not configured — connect your Firebase project in Settings → Cloud Sync.' };
    if (!uid) return { ok: false, reason: 'signed-out', message: 'Sign in with Google before saving to the cloud.' };

    try {
        const userSavesRef = collection(db, `users/${uid}/saves`);
        const saveDocRef = doc(userSavesRef, cloudDocId(slotId));

        // Cloud saves now carry the FULL message history, same as local saves —
        // chunking removed the 1 MiB reason to trim summarized scrollback.
        const messages = gameState.messages || [];
        // `m?.` belt: a null entry in live state must not brick every cloud save.
        const prunedMessageCount = messages.filter(m => m?.summarized).length;
        const trimmedState = {
            ...serializeGameState(gameState),
            session: { ...gameState.session, prunedMessageCount },
        };

        const metadata = {
            slotId,
            ...buildSaveMetadata(gameState),
            savedAt: new Date().toISOString(),
            messageCount: messages.length,
        };

        // The state is stored as a stringified JSON blob (avoids Firestore's
        // nested object limits/index explosion), ALWAYS in the `chunks`
        // subcollection — a small save is simply 1 chunk. The parent doc stays
        // metadata-only, so listing saves and the transaction's previous-doc
        // read never download payload bytes (2026-08-04; this also deleted the
        // old inline/chunked dual write path). Legacy inline docs still load
        // via the payload fallback in loadGameFromCloud until re-saved.
        const payload = JSON.stringify(trimmedState);

        // Pre-flight: refuse before touching Firestore when the campaign has
        // outgrown one transaction request, with a message that says what to do.
        const byteLength = payloadByteLength(payload);
        if (byteLength > CLOUD_SAVE_BYTE_LIMIT) {
            const message =
                `This campaign's save is ${formatMiB(byteLength)}, above the cloud limit of ` +
                `${formatMiB(CLOUD_SAVE_BYTE_LIMIT)} — it was saved locally only. Local saves have no ` +
                'such limit, so keep playing locally; cloud sync for this campaign needs a larger-save format.';
            console.warn(`Cloud save skipped: ${slotId} (${byteLength} bytes > ${CLOUD_SAVE_BYTE_LIMIT})`);
            return { ok: false, reason: 'too-large', message };
        }

        const chunks = splitPayload(payload);

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
            transaction.set(saveDocRef, { ...metadata, payload: null, payloadChunks: chunks.length });
            chunks.forEach((data, index) => {
                transaction.set(doc(chunksCollection(uid, slotId), String(index)), { index, data });
            });
            for (let stale = chunks.length; stale < previousChunkCount; stale++) {
                transaction.delete(doc(chunksCollection(uid, slotId), String(stale)));
            }
        });

        console.log(`Cloud save successful: ${slotId} (${payload.length} chars, ${chunks.length} chunk${chunks.length === 1 ? '' : 's'})`);
        return { ok: true };
    } catch (e) {
        console.error("Cloud save failed:", e);
        if (e?.code === 'permission-denied') {
            console.error(`Cloud save hint: ${CLOUD_RULES_HINT}`);
            return {
                ok: false,
                reason: 'permission-denied',
                message: `Firestore refused the write (permission denied). ${CLOUD_RULES_HINT}`,
            };
        }
        return {
            ok: false,
            reason: 'error',
            message: `Cloud upload failed${e?.message ? ` — ${e.message}` : ''} (details in the browser console).`,
        };
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

        // A corrupted payload parsing to a number/string/array passes callers'
        // truthy checks and reaches LOAD_GAME as a primitive — only a plain
        // object is a save (2026-07-25 audit).
        const asSaveObject = (parsed) => (
            parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null
        );

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
            return asSaveObject(JSON.parse(chunks.slice(0, data.payloadChunks).join('')));
        }

        if (data.payload) {
            console.log(`Cloud load successful: ${slotId}`);
            return asSaveObject(JSON.parse(data.payload));
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
