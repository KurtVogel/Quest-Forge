import { db, firestoreSdk } from "../config/firebase.js";
import { asSaveObject, serializeGameState, buildSaveMetadata, projectSaveMetadata } from "./persistence.js";
import {
    collectChapterRefs, collectPortraitRefs, extractChapters, extractPortraits, restoreChapters, restorePortraits,
} from "./portraitStore.js";

/**
 * Cloud save layer (bring-your-own Firebase, manual saves only).
 * Mirrors persistence.js: both paths persist the SAME serialized state via
 * serializeGameState(), so a field cannot exist in one save format and not the other.
 *
 * No static `firebase/firestore` import (2026-09-22 audit P2): the SDK is
 * loaded by `initializeFirebase` and read through `firestoreSdk`, which is
 * non-null exactly when `db` is — the `!db` guard on every function therefore
 * also guarantees the module is present.
 */

/**
 * Portrait bytes live in their own content-addressed collection,
 * `users/{uid}/portraits/{key}` — the cloud twin of the DB-v4 local split
 * (2026-09-22 audit P2). A manual save used to re-upload every portrait inline
 * on every save (12 NPC portraits = 2.38 MiB per save, 47 % portraits, 9 chunk
 * docs; 100 = over budget and dropped). Now the payload carries `portraitRef`s
 * (`extractPortraits`), the metadata doc lists the slot's `portraitRefs`, a
 * blob doc is written only when NO slot's metadata already claims its key
 * (metadata is what the list reads anyway — a `getDoc` probe would download
 * the blob just to learn it exists), and a load fetches one blob doc per ref
 * (`restorePortraits`). A key released by an overwrite or a delete is swept
 * after the commit when no other slot still claims it. Each blob doc holds one
 * portrait (≤ `MAX_PORTRAIT_URL_LENGTH` 300k ASCII chars), far under the 1 MiB
 * document cap, and blobs ride outside the save transaction so the 9 MiB
 * request ceiling meters the campaign, never its pictures. A missing blob is a
 * missing picture, never a failed load; a pre-split inline payload loads as-is.
 * Chronicle chapters take the same lane since 2026-09-26 (`chronicleChapters`,
 * `chapterRefs`; a chapter is ≤ 60k chars, well under the 1 MiB doc cap).
 */
/**
 * The cloud BLOB LANES — the twin of `BLOB_STORES` in persistence.js
 * (2026-09-26 chronicler Lap-3 P2: the IndexedDB v5 chapter split shipped
 * without its cloud twin, so the chronicle — 18 % of a 1,000-message payload
 * with 3 chapters, immutable by construction — was re-uploaded inline on
 * every manual cloud save and counted against the 9 MiB pre-flight). Each
 * lane: the collection its blob docs live in (`users/{uid}/<collection>/{key}`),
 * the metadata field that lists a slot's refs, the key shape a metadata doc
 * is trusted for, and the extract / collect / restore triple from
 * portraitStore.js. `cloudSync.lanes.test.js` pins that this table and
 * persistence's agree lane for lane.
 */
export const CLOUD_BLOB_LANES = [
    {
        collection: 'portraits',
        refsField: 'portraitRefs',
        keyPattern: /^p-[0-9a-z]{1,8}-[0-9a-z]{1,8}-[0-9a-z]{1,8}$/,
        extract: extractPortraits,
        collect: collectPortraitRefs,
        restore: restorePortraits,
        label: 'portrait',
    },
    {
        collection: 'chronicleChapters',
        refsField: 'chapterRefs',
        keyPattern: /^c-[0-9a-z]{1,8}-[0-9a-z]{1,8}-[0-9a-z]{1,8}$/,
        extract: extractChapters,
        collect: collectChapterRefs,
        restore: restoreChapters,
        label: 'chapter',
    },
];
/** Most refs a metadata doc is trusted for per lane (a save is ≤ ~100 portraits / ~50 chapters in practice). */
const MAX_LANE_REFS = 512;

/** The refs a metadata doc claims for one lane, typed: well-formed keys only, deduped, bounded. */
function typedLaneRefs(value, lane) {
    if (!Array.isArray(value)) return [];
    const refs = new Set();
    for (const ref of value) {
        if (refs.size >= MAX_LANE_REFS) break;
        if (typeof ref === 'string' && lane.keyPattern.test(ref)) refs.add(ref);
    }
    return [...refs];
}

/** `{ [lane.collection]: refs[] }` — every lane's typed refs from one metadata doc. */
function typedRefsByLane(record) {
    const out = {};
    for (const lane of CLOUD_BLOB_LANES) out[lane.collection] = typedLaneRefs(record?.[lane.refsField], lane);
    return out;
}

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
 * Most stale chunks a sweep will ever queue. A save is at most ~32 chunks by
 * the 9 MiB pre-flight (CLOUD_SAVE_BYTE_LIMIT / CHUNK_CHAR_LIMIT), so the
 * stored `payloadChunks` count is trusted only as a bounded integer
 * (2026-09-10 audit P2): a hostile `200000` queued 199,999 deletes into one
 * transaction and `Infinity` never terminated — the slot could be neither
 * overwritten nor deleted from the app.
 */
const MAX_STALE_CHUNK_SWEEP = 64;

function boundedChunkCount(value) {
    return Number.isInteger(value) && value > 0 ? Math.min(MAX_STALE_CHUNK_SWEEP, value) : 0;
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
    "Every save's payload is stored in a `chunks` subcollection, its portraits in a " +
    "`portraits` collection, and its chronicle chapters in a `chronicleChapters` collection. " +
    "If your Firebase project's firestore.rules predate that, redeploy the repo's firestore.rules " +
    "(match /users/{userId}/saves/{saveId}/chunks/{chunkId}, match /users/{userId}/portraits/{portraitId}, " +
    "and match /users/{userId}/chronicleChapters/{chapterId}).";

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
    return firestoreSdk.collection(db, `users/${uid}/saves/${cloudDocId(slotId)}/chunks`);
}

function blobDoc(uid, lane, key) {
    return firestoreSdk.doc(firestoreSdk.collection(db, `users/${uid}/${lane.collection}`), key);
}

/**
 * Every blob key some save slot's metadata still claims, per lane
 * (`{ [collection]: Set }`) — ONE metadata-only read for all lanes.
 */
async function claimedRefsByLane(uid) {
    const { collection, getDocs } = firestoreSdk;
    const snapshot = await getDocs(collection(db, `users/${uid}/saves`));
    const claimed = {};
    for (const lane of CLOUD_BLOB_LANES) claimed[lane.collection] = new Set();
    snapshot.forEach((saveDoc) => {
        const refs = typedRefsByLane(saveDoc.data());
        for (const lane of CLOUD_BLOB_LANES) refs[lane.collection].forEach(ref => claimed[lane.collection].add(ref));
    });
    return claimed;
}

/**
 * Write the blobs no slot's metadata claims yet. Runs BEFORE the save
 * transaction so the metadata never names a blob that is not there; a blob
 * left behind by a failed commit is content-addressed and simply reused.
 * Returns the number of blob docs written.
 */
async function ensureLaneBlobs(uid, lane, blobs, claimed) {
    const { setDoc } = firestoreSdk;
    const missing = [...blobs].filter(([key]) => !claimed.has(key));
    await Promise.all(missing.map(([key, data]) =>
        setDoc(blobDoc(uid, lane, key), { data, chars: data.length, createdAt: new Date().toISOString() })));
    return missing.length;
}

/**
 * Delete the released blobs no slot claims any more, every lane at once.
 * Best-effort and AFTER the commit that released them: a sweep failure
 * leaves an orphan blob (harmless, reused if the picture / chapter returns),
 * never a failed save or delete. Reads metadata only (one read for all
 * lanes). Returns the number of blob docs removed.
 */
async function sweepReleasedBlobs(uid, releasedByLane) {
    const pending = CLOUD_BLOB_LANES.filter(lane => (releasedByLane[lane.collection] || []).length > 0);
    if (pending.length === 0) return 0;
    try {
        const claimed = await claimedRefsByLane(uid);
        let swept = 0;
        for (const lane of pending) {
            const orphans = releasedByLane[lane.collection].filter(ref => !claimed[lane.collection].has(ref));
            await Promise.all(orphans.map(ref => firestoreSdk.deleteDoc(blobDoc(uid, lane, ref))));
            swept += orphans.length;
        }
        return swept;
    } catch (e) {
        console.warn('Cloud blob sweep skipped:', e);
        return 0;
    }
}

/**
 * Result shape: `{ ok: true, portraitsUploaded, chaptersUploaded }` (blob docs
 * written this save per lane — 0 on a steady-state save, since portraits ride
 * their own collection since 2026-09-22 and chapters since 2026-09-26; the
 * 2026-09-21 `droppedPortraits` budget note is retired with the inline
 * portraits it described) or `{ ok: false, reason, message }`, where
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
        const { collection, doc, runTransaction } = firestoreSdk;
        const userSavesRef = collection(db, `users/${uid}/saves`);
        const saveDocRef = doc(userSavesRef, cloudDocId(slotId));

        // Cloud saves now carry the FULL message history, same as local saves —
        // chunking removed the 1 MiB reason to trim summarized scrollback.
        const messages = gameState.messages || [];
        // `m?.` belt: a null entry in live state must not brick every cloud save.
        const prunedMessageCount = messages.filter(m => m?.summarized).length;
        // Portrait bytes (2026-09-22) and chapter prose (2026-09-26) leave the
        // payload here, lane by lane: refs in the state, blobs to their own
        // collections, each lane's ref list on the metadata doc.
        let trimmedState = {
            ...serializeGameState(gameState),
            session: { ...gameState.session, prunedMessageCount },
        };
        const lanes = CLOUD_BLOB_LANES.map(lane => {
            const extracted = lane.extract(trimmedState);
            trimmedState = extracted.state;
            return { ...lane, blobs: extracted.blobs, refs: extracted.refs };
        });

        const metadata = {
            slotId,
            ...buildSaveMetadata(gameState),
            savedAt: new Date().toISOString(),
            messageCount: messages.length,
            ...Object.fromEntries(lanes.map(lane => [lane.refsField, lane.refs])),
        };

        // The state is stored as a stringified JSON blob (avoids Firestore's
        // nested object limits/index explosion), ALWAYS in the `chunks`
        // subcollection — a small save is simply 1 chunk. The parent doc stays
        // metadata-only, so listing saves and the transaction's previous-doc
        // read never download payload bytes (2026-08-04; this also deleted the
        // old inline/chunked dual write path). Legacy inline docs still load
        // via the payload fallback in loadGameFromCloud until re-saved.
        const payload = JSON.stringify(trimmedState);
        const byteLength = payloadByteLength(payload);

        // Pre-flight: refuse before touching Firestore when the campaign has
        // outgrown one transaction request, with a message that says what to do.
        // Portraits no longer count: they ride their own collection.
        if (byteLength > CLOUD_SAVE_BYTE_LIMIT) {
            const message =
                `This campaign's save is ${formatMiB(byteLength)}, above the cloud limit of ` +
                `${formatMiB(CLOUD_SAVE_BYTE_LIMIT)} — it was saved locally only. Local saves have no ` +
                'such limit, so keep playing locally; cloud sync for this campaign needs a larger-save format.';
            console.warn(`Cloud save skipped: ${slotId} (${byteLength} bytes > ${CLOUD_SAVE_BYTE_LIMIT})`);
            return { ok: false, reason: 'too-large', message };
        }

        const chunks = splitPayload(payload);

        // Blobs first, only the ones no slot claims yet (a steady-state save
        // uploads zero portrait or chapter bytes), so the metadata written
        // below never names a blob that is not there. One claimed-refs read
        // serves every lane; a save with nothing to store reads nothing.
        const uploaded = {};
        const claimed = lanes.some(lane => lane.blobs.size > 0) ? await claimedRefsByLane(uid) : null;
        for (const lane of lanes) {
            uploaded[lane.collection] = lane.blobs.size > 0
                ? await ensureLaneBlobs(uid, lane, lane.blobs, claimed[lane.collection])
                : 0;
        }
        const portraitsUploaded = uploaded.portraits;
        const chaptersUploaded = uploaded.chronicleChapters;

        // The previous save's chunk count is read INSIDE the transaction: two
        // devices saving the same slot near-simultaneously (Vesa's multi-machine
        // workflow) could otherwise both read a stale payloadChunks and race on
        // which stale chunks get cleared, orphaning a chunk. Firestore re-runs
        // the transaction on contention, so the stale-chunk sweep always matches
        // the state actually being overwritten. (Size-wise a transaction carries
        // the same ~10 MiB request ceiling the previous writeBatch had.)
        let previousRefs = typedRefsByLane(null);
        await runTransaction(db, async (transaction) => {
            const existingSnap = await transaction.get(saveDocRef);
            const existing = existingSnap.exists() ? existingSnap.data() : null;
            const previousChunkCount = boundedChunkCount(existing?.payloadChunks);
            previousRefs = typedRefsByLane(existing);
            transaction.set(saveDocRef, { ...metadata, payload: null, payloadChunks: chunks.length });
            chunks.forEach((data, index) => {
                transaction.set(doc(chunksCollection(uid, slotId), String(index)), { index, data });
            });
            for (let stale = chunks.length; stale < previousChunkCount; stale++) {
                transaction.delete(doc(chunksCollection(uid, slotId), String(stale)));
            }
        });

        // A ref this slot released (a rerolled or removed portrait, a removed
        // chapter) is swept once nothing else claims it — after the commit,
        // never inside it.
        const released = {};
        for (const lane of lanes) {
            const kept = new Set(lane.refs);
            released[lane.collection] = previousRefs[lane.collection].filter(ref => !kept.has(ref));
        }
        await sweepReleasedBlobs(uid, released);

        console.log(`Cloud save successful: ${slotId} (${payload.length} chars, ${chunks.length} chunk${chunks.length === 1 ? '' : 's'}, ${portraitsUploaded} portrait${portraitsUploaded === 1 ? '' : 's'} + ${chaptersUploaded} chapter${chaptersUploaded === 1 ? '' : 's'} uploaded)`);
        return { ok: true, portraitsUploaded, chaptersUploaded };
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

/**
 * Rehydrate every lane's refs from its blob collection — one `getDoc` per
 * ref, all lanes in parallel — before the state leaves this module, so
 * LOAD_GAME never sees a ref. A blob that is missing or unreadable is a
 * missing picture (`restorePortraits` strips the stamps) or a dropped chapter
 * (`restoreChapters` — its span re-opens for the next close), never a failed
 * load.
 */
async function rehydrateBlobs(uid, state) {
    const wanted = CLOUD_BLOB_LANES.map(lane => ({ lane, refs: lane.collect(state), found: new Map() }))
        .filter(entry => entry.refs.length > 0);
    if (wanted.length === 0) return state;
    await Promise.all(wanted.flatMap(({ lane, refs, found }) => refs.map(async (ref) => {
        try {
            const snap = await firestoreSdk.getDoc(blobDoc(uid, lane, ref));
            const data = snap.exists() ? snap.data()?.data : null;
            if (typeof data === 'string') found.set(ref, data);
        } catch (e) {
            console.warn(`Cloud ${lane.label} ${ref} could not be fetched:`, e);
        }
    })));
    let restored = state;
    for (const { lane, found } of wanted) restored = lane.restore(restored, key => found.get(key));
    return restored;
}

export async function loadGameFromCloud(uid, slotId) {
    if (!db || !uid) return null;

    try {
        const { collection, doc, getDoc, getDocs } = firestoreSdk;
        const userSavesRef = collection(db, `users/${uid}/saves`);
        const saveDocRef = doc(userSavesRef, cloudDocId(slotId));

        const docSnap = await getDoc(saveDocRef);
        if (!docSnap.exists()) return null;
        const data = docSnap.data();

        // Only a plain object is a save (2026-07-25 audit) — the guard is the
        // one persistence.js exports, shared with the local loader since 2026-09-11.
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
            const saved = asSaveObject(JSON.parse(chunks.slice(0, data.payloadChunks).join('')));
            return saved ? rehydrateBlobs(uid, saved) : null;
        }

        if (data.payload) {
            console.log(`Cloud load successful: ${slotId}`);
            const saved = asSaveObject(JSON.parse(data.payload));
            return saved ? rehydrateBlobs(uid, saved) : null;
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
        const { collection, getDocs } = firestoreSdk;
        const userSavesRef = collection(db, `users/${uid}/saves`);
        const snapshot = await getDocs(userSavesRef);
        const saves = [];

        snapshot.forEach((doc) => {
            const data = doc.data();
            // Exclude the autosave doc from the manual-saves list (match by doc ID too,
            // since the stored slotId field is the legacy "__autosave__" name)
            if (data?.slotId === AUTOSAVE_SLOT || doc.id === CLOUD_AUTOSAVE_DOC_ID) return;
            // The typed projection (never the raw doc: it drops the payload
            // fields and types every rendered value); a doc without a slotId
            // field is addressed by its own id — the doc id IS the slot id for
            // every manual save.
            saves.push(projectSaveMetadata(data, doc.id));
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
        const { collection, doc, runTransaction } = firestoreSdk;
        const userSavesRef = collection(db, `users/${uid}/saves`);
        const saveDocRef = doc(userSavesRef, cloudDocId(slotId));

        // Deleting a Firestore document does NOT delete its subcollections —
        // orphaned chunks would silently linger (and could corrupt a future save
        // that reuses the slot with a smaller chunk count). Remove them explicitly,
        // reading the chunk count inside the transaction so a concurrent save from
        // another device cannot leave the sweep working from a stale count.
        let releasedRefs = typedRefsByLane(null);
        await runTransaction(db, async (transaction) => {
            const existingSnap = await transaction.get(saveDocRef);
            const existing = existingSnap.exists() ? existingSnap.data() : null;
            const chunkCount = boundedChunkCount(existing?.payloadChunks);
            releasedRefs = typedRefsByLane(existing);
            for (let i = 0; i < chunkCount; i++) {
                transaction.delete(doc(chunksCollection(uid, slotId), String(i)));
            }
            transaction.delete(saveDocRef);
        });

        // The slot's portraits and chapters go too, unless another slot still claims them.
        const swept = await sweepReleasedBlobs(uid, releasedRefs);

        console.log(`Cloud delete successful: ${slotId}${swept ? ` (${swept} blob${swept === 1 ? '' : 's'} swept)` : ''}`);
        return true;
    } catch (e) {
        console.error("Cloud delete failed:", e);
        return false;
    }
}
