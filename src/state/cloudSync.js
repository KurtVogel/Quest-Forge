import { db, firestoreSdk } from "../config/firebase.js";
import { asSaveObject, prepareSavePayload, projectSaveMetadata } from "./persistence.js";
import { BLOB_LANES, collectLaneRefs, restoreLanes } from "./portraitStore.js";

/**
 * Cloud save layer (bring-your-own Firebase, manual saves only).
 * Mirrors persistence.js: both paths persist the SAME serialized state — one
 * `prepareSavePayload` (persistence.js) is the prologue of both, and one
 * `BLOB_LANES` table (portraitStore.js) lists the blob lanes of both, so a
 * field or a lane cannot exist in one save format and not the other
 * (`cloudSync.lanes.test.js` pins the two stored states equal).
 *
 * ONE result shape for the four exports (2026-10-04 audit): every call resolves
 * `{ ok: true, … }` or `{ ok: false, reason, message }` — `message` is
 * player-readable, `reason` is one of `unavailable` (no Firebase configured) ·
 * `signed-out` · `not-found` · `corrupt` · `too-large` · `permission-denied`
 * (always with the rules hint) · `error`. The save was typed on 2026-09-02;
 * its siblings swallowed every failure to `null` / `false` or rethrew, so a
 * caller could only say "details in the browser console".
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
 * Most refs a metadata doc is trusted for per lane — a hostile-input bound,
 * several times any real save (a mature campaign holds ~40 portraits and ~20
 * chapters), not an expected size.
 */
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

/** `{ [lane.id]: refs[] }` — every lane's typed refs from one metadata doc. */
function typedRefsByLane(record) {
    const out = {};
    for (const lane of BLOB_LANES) out[lane.id] = typedLaneRefs(record?.[lane.refsField], lane);
    return out;
}

/** No doc, no claims — the starting value of every "previous refs" read. */
const NO_REFS = typedRefsByLane(null);

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
 * Most chunks a save is trusted to have. A save is at most ~32 chunks by the
 * 9 MiB pre-flight (CLOUD_SAVE_BYTE_LIMIT / CHUNK_CHAR_LIMIT), so the stored
 * `payloadChunks` count is trusted only as a bounded integer (2026-09-10
 * audit P2): a hostile `200000` queued 199,999 deletes into one transaction
 * and `Infinity` never terminated — the slot could be neither overwritten nor
 * deleted from the app. All three readers apply it since 2026-10-04: the two
 * sweeps clamp, the loader refuses a count past it as a corrupt save.
 */
const MAX_SAVE_CHUNKS = 64;

function boundedChunkCount(value) {
    return Number.isInteger(value) && value > 0 ? Math.min(MAX_SAVE_CHUNKS, value) : 0;
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

/**
 * What a permission-denied means and what to do about it — derived from the
 * lane table, so a new lane is named here by construction (the collection
 * names used to be hand-written a third time).
 */
export const CLOUD_RULES_HINT =
    "Every save's payload is stored in a `chunks` subcollection" +
    BLOB_LANES.map(lane => `, its ${lane.label}s in a \`${lane.id}\` collection`).join('') + ". " +
    "If your Firebase project's firestore.rules predate that, redeploy the repo's firestore.rules " +
    "(match /users/{userId}/saves/{saveId}/chunks/{chunkId}" +
    BLOB_LANES.map(lane => `, match /users/{userId}/${lane.id}/{${lane.label}Id}`).join('') + ").";

const UNAVAILABLE = { ok: false, reason: 'unavailable', message: 'Cloud sync is not configured — connect your Firebase project in Settings → Cloud Sync.' };
const signedOut = (doing) => ({ ok: false, reason: 'signed-out', message: `Sign in with Google before ${doing}.` });

/**
 * The one failure projection for all four exports: a permission-denied always
 * carries the rules hint (only the save's did), anything else carries the
 * provider's own message. `refused` / `failed` word the action.
 */
function cloudFailure(e, { refused, failed }) {
    console.error(`${failed}:`, e);
    if (e?.code === 'permission-denied') {
        console.error(`Cloud sync hint: ${CLOUD_RULES_HINT}`);
        return { ok: false, reason: 'permission-denied', message: `Firestore refused ${refused} (permission denied). ${CLOUD_RULES_HINT}` };
    }
    return {
        ok: false,
        reason: typeof e?.reason === 'string' ? e.reason : 'error',
        message: `${failed}${e?.message ? ` — ${e.message}` : ''} (details in the browser console).`,
    };
}

/** A count of one lane's blobs in player-facing text: "2 portraits", "1 chapter". */
const countOf = (count, label) => `${count} ${label}${count === 1 ? '' : 's'}`;

/**
 * What a successful save uploaded, as a sentence tail (". 2 portraits and 1
 * chapter uploaded") — empty on the steady state, where every blob was already
 * there. Reads the lane table, so a third lane needs no edit here or in the UI.
 */
export function describeCloudUploads(result) {
    const parts = BLOB_LANES
        .map(lane => ({ lane, count: Number(result?.uploaded?.[lane.label]) || 0 }))
        .filter(({ count }) => count > 0)
        .map(({ lane, count }) => countOf(count, lane.label));
    return parts.length > 0 ? `. ${parts.join(' and ')} uploaded` : '';
}

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

function saveDoc(uid, slotId) {
    return firestoreSdk.doc(firestoreSdk.collection(db, `users/${uid}/saves`), cloudDocId(slotId));
}

function chunksCollection(uid, slotId) {
    return firestoreSdk.collection(db, `users/${uid}/saves/${cloudDocId(slotId)}/chunks`);
}

function blobDoc(uid, lane, key) {
    return firestoreSdk.doc(firestoreSdk.collection(db, `users/${uid}/${lane.id}`), key);
}

/**
 * Every blob key some save slot's metadata still claims, per lane
 * (`{ [lane.id]: Set }`) — ONE metadata-only read for all lanes.
 */
async function claimedRefsByLane(uid) {
    const { collection, getDocs } = firestoreSdk;
    const snapshot = await getDocs(collection(db, `users/${uid}/saves`));
    const claimed = {};
    for (const lane of BLOB_LANES) claimed[lane.id] = new Set();
    snapshot.forEach((saveSnap) => {
        const refs = typedRefsByLane(saveSnap.data());
        for (const lane of BLOB_LANES) refs[lane.id].forEach(ref => claimed[lane.id].add(ref));
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
    const pending = BLOB_LANES.filter(lane => (releasedByLane[lane.id] || []).length > 0);
    if (pending.length === 0) return 0;
    try {
        const claimed = await claimedRefsByLane(uid);
        let swept = 0;
        for (const lane of pending) {
            const orphans = releasedByLane[lane.id].filter(ref => !claimed[lane.id].has(ref));
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
 * Result: `{ ok: true, uploaded }` — `uploaded` counts the blob docs written
 * this save per lane label (`{ portrait, chapter }`; all zero on a
 * steady-state save, since blobs ride their own collections) — or the shared
 * failure shape, with `too-large` for the pre-flight (Firestore never called).
 */
export async function saveGameToCloud(uid, slotId, gameState) {
    if (!db) return UNAVAILABLE;
    if (!uid) return signedOut('saving to the cloud');

    try {
        const { doc, runTransaction } = firestoreSdk;
        const saveDocRef = saveDoc(uid, slotId);

        // The shared prologue: the FULL message history (chunking removed the
        // 1 MiB reason to trim summarized scrollback), portrait bytes and
        // chapter prose out of the payload lane by lane, each lane's ref list
        // on the metadata doc.
        const { state: trimmedState, lanes, metadata } = prepareSavePayload(slotId, gameState, new Date().toISOString());

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
            uploaded[lane.label] = lane.blobs.size > 0
                ? await ensureLaneBlobs(uid, lane, lane.blobs, claimed[lane.id])
                : 0;
        }

        // The previous save's chunk count is read INSIDE the transaction: two
        // devices saving the same slot near-simultaneously (Vesa's multi-machine
        // workflow) could otherwise both read a stale payloadChunks and race on
        // which stale chunks get cleared, orphaning a chunk. Firestore re-runs
        // the transaction on contention, so the stale-chunk sweep always matches
        // the state actually being overwritten. (Size-wise a transaction carries
        // the same ~10 MiB request ceiling the previous writeBatch had.)
        let previousRefs = NO_REFS;
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
            released[lane.id] = previousRefs[lane.id].filter(ref => !kept.has(ref));
        }
        await sweepReleasedBlobs(uid, released);

        console.log(`Cloud save successful: ${slotId} (${payload.length} chars, ${countOf(chunks.length, 'chunk')}, ${lanes.map(lane => countOf(uploaded[lane.label], lane.label)).join(' + ')} uploaded)`);
        return { ok: true, uploaded };
    } catch (e) {
        return cloudFailure(e, { refused: 'the write', failed: 'Cloud upload failed' });
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
    const wanted = collectLaneRefs(state);
    if (wanted.length === 0) return state;
    const found = new Map(wanted.map(({ lane }) => [lane.id, new Map()]));
    await Promise.all(wanted.flatMap(({ lane, refs }) => refs.map(async (ref) => {
        try {
            const snap = await firestoreSdk.getDoc(blobDoc(uid, lane, ref));
            const data = snap.exists() ? snap.data()?.data : null;
            if (typeof data === 'string') found.get(lane.id).set(ref, data);
        } catch (e) {
            console.warn(`Cloud ${lane.label} ${ref} could not be fetched:`, e);
        }
    })));
    return restoreLanes(state, (lane, key) => found.get(lane.id)?.get(key));
}

/** A load failure the caller should be able to tell apart: `reason` rides the thrown error into `cloudFailure`. */
function loadError(reason, message) {
    return Object.assign(new Error(message), { reason });
}

/**
 * Result: `{ ok: true, state }` or the shared failure shape — `not-found` (no
 * such save), `corrupt` (a missing chunk, an unparseable or non-object
 * payload), `permission-denied`, `error`. Every one of these was a bare
 * `null` until 2026-10-04.
 */
export async function loadGameFromCloud(uid, slotId) {
    if (!db) return UNAVAILABLE;
    if (!uid) return signedOut('loading a cloud save');

    try {
        const { getDoc, getDocs } = firestoreSdk;
        const docSnap = await getDoc(saveDoc(uid, slotId));
        if (!docSnap.exists()) {
            return { ok: false, reason: 'not-found', message: 'That cloud save no longer exists — it may have been deleted from another device.' };
        }
        const data = docSnap.data();

        let payload = null;
        if (data.payloadChunks > 0) {
            const chunkCount = data.payloadChunks;
            if (!Number.isInteger(chunkCount) || chunkCount > MAX_SAVE_CHUNKS) {
                throw loadError('corrupt', `this save claims an impossible chunk count (${String(chunkCount).slice(0, 20)})`);
            }
            const snapshot = await getDocs(chunksCollection(uid, slotId));
            const chunks = [];
            snapshot.forEach((chunkDoc) => {
                const chunk = chunkDoc.data();
                if (Number.isInteger(chunk?.index) && typeof chunk?.data === 'string') {
                    chunks[chunk.index] = chunk.data;
                }
            });
            for (let i = 0; i < chunkCount; i++) {
                if (typeof chunks[i] !== 'string') {
                    throw loadError('corrupt', `chunk ${i + 1} of ${chunkCount} is missing`);
                }
            }
            payload = chunks.slice(0, chunkCount).join('');
        } else if (typeof data.payload === 'string' && data.payload) {
            payload = data.payload; // legacy inline doc
        }
        if (payload === null) throw loadError('corrupt', 'this save has no stored game state');

        // Only a plain object is a save (2026-07-25 audit) — the guard is the
        // one persistence.js exports, shared with the local loader since 2026-09-11.
        let saved = null;
        try {
            saved = asSaveObject(JSON.parse(payload));
        } catch {
            saved = null;
        }
        if (!saved) throw loadError('corrupt', 'its stored game state is unreadable');

        console.log(`Cloud load successful: ${slotId}`);
        return { ok: true, state: await rehydrateBlobs(uid, saved) };
    } catch (e) {
        return cloudFailure(e, { refused: 'the read', failed: 'Cloud save could not be loaded' });
    }
}

/**
 * Result: `{ ok: true, saves }` (newest first; empty while cloud sync is not
 * configured or nobody is signed in — there is nothing to list, not a failure)
 * or the shared failure shape.
 */
export async function listCloudSaves(uid) {
    if (!db || !uid) return { ok: true, saves: [] };

    try {
        const { collection, getDocs } = firestoreSdk;
        const snapshot = await getDocs(collection(db, `users/${uid}/saves`));
        const saves = [];

        snapshot.forEach((saveSnap) => {
            const data = saveSnap.data();
            // Exclude the autosave doc from the manual-saves list (match by doc ID too,
            // since the stored slotId field is the legacy "__autosave__" name)
            if (data?.slotId === AUTOSAVE_SLOT || saveSnap.id === CLOUD_AUTOSAVE_DOC_ID) return;
            // The typed projection (never the raw doc: it drops the payload
            // fields and types every rendered value); a doc without a slotId
            // field is addressed by its own id — the doc id IS the slot id for
            // every manual save.
            saves.push(projectSaveMetadata(data, saveSnap.id));
        });

        return { ok: true, saves: saves.sort((a, b) => new Date(b.savedAt || 0) - new Date(a.savedAt || 0)) };
    } catch (e) {
        return cloudFailure(e, { refused: 'the read', failed: 'Cloud saves could not be listed' });
    }
}

/** Result: `{ ok: true }` or the shared failure shape. */
export async function deleteGameFromCloud(uid, slotId) {
    if (!db) return UNAVAILABLE;
    if (!uid) return signedOut('deleting a cloud save');
    if (!slotId) return { ok: false, reason: 'not-found', message: 'No cloud save was named to delete.' };

    try {
        const { doc, runTransaction } = firestoreSdk;
        const saveDocRef = saveDoc(uid, slotId);

        // Deleting a Firestore document does NOT delete its subcollections —
        // orphaned chunks would silently linger (and could corrupt a future save
        // that reuses the slot with a smaller chunk count). Remove them explicitly,
        // reading the chunk count inside the transaction so a concurrent save from
        // another device cannot leave the sweep working from a stale count.
        let releasedRefs = NO_REFS;
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

        console.log(`Cloud delete successful: ${slotId}${swept ? ` (${countOf(swept, 'blob')} swept)` : ''}`);
        return { ok: true };
    } catch (e) {
        return cloudFailure(e, { refused: 'the delete', failed: 'Cloud delete failed' });
    }
}
