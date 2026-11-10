/**
 * IndexedDB plumbing shared by the save store (persistence.js) and the hero
 * roster (rosterStore.js) — split out of persistence.js on 2026-10-06 (the
 * 10-05 "one file as four modules" precedent): the database open + upgrade,
 * the one-close-site transaction runner, the typed reads of a stored record's
 * fields, and the blob-lane helpers both stores run inside their transactions
 * (ensure the blobs a record names, read them back, sweep the orphans).
 */
import { BLOB_LANES, typedLaneRefs } from './portraitStore.js';
import { saneEpochMs } from './handlers/shared.js';

export const DB_NAME = 'rpg-client-saves';
// v3 (2026-08-04): save payloads split out of the metadata records so listing
// saves never materializes full campaign states (multi-MB on mature campaigns).
// v4 (2026-09-21): portrait bytes split out of the payloads into a
// content-addressed `portraits` store (state/portraitStore.js) — they were
// ~96 % of every autosave and never change. No data migration: a payload that
// still carries inline portraits loads as-is and is split on its next save.
// v5 (2026-09-24): chronicle chapter prose split the same way into a
// content-addressed `chronicleChapters` store — chapters are immutable and
// were 23–25 % of every autosave after the portrait split. Same no-migration
// rule: inline chapters load as-is and split on the next save.
export const DB_VERSION = 5;
export const STORE_NAME = 'saves';
export const PAYLOAD_STORE = 'savePayloads';
// The two blob stores are named by their lanes' ids (`BLOB_LANES` in
// portraitStore.js — the one lane table both storage paths read).
export const PORTRAIT_STORE = 'portraits';
export const CHAPTER_STORE = 'chronicleChapters';
export const ROSTER_STORE = 'characters';
/** The one reserved slot the autosave writes (Continue = this device's session). */
export const AUTOSAVE_SLOT = '__autosave__';

/**
 * Every store a transaction must include to sweep orphan PORTRAITS: the slot
 * metadata records, the roster (its rows carry their hero's ref since
 * 2026-09-24 — the roster was the last inline-portrait store, and a hero saved
 * to the roster and to a slot shares ONE blob, so both sides are live sets),
 * and the portraits themselves. Requests run in order, so the sweep's
 * `getAll`s already see the caller's own put/delete, and overlapping
 * readwrite transactions serialize, so a concurrent save can never have its
 * fresh blob swept between its blob put and its metadata put.
 */
export const PORTRAIT_SWEEP_STORES = [STORE_NAME, ROSTER_STORE, PORTRAIT_STORE];

/**
 * Every store a transaction must include to sweep ALL blob stores (a save
 * slot's write/delete can orphan a portrait or a chapter). A transaction that
 * carries only some of them sweeps only those — a roster save's scope is
 * `PORTRAIT_SWEEP_STORES`, and a roster save cannot orphan a chapter.
 */
export const BLOB_SWEEP_STORES = [...PORTRAIT_SWEEP_STORES, CHAPTER_STORE];

/** How long a blocked open may stall before we fail loudly instead of hanging forever. */
const OPEN_BLOCKED_TIMEOUT_MS = 8000;

function openDB() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION);
        // A DB_VERSION bump while another tab holds an older connection fires
        // `blocked` instead of resolving — without this, every save/load (autosave
        // included) awaits forever with no error to surface. Fail loudly instead.
        let blockedTimer = null;
        let gaveUp = false;
        const clearBlocked = () => { if (blockedTimer) { clearTimeout(blockedTimer); blockedTimer = null; } };
        request.onblocked = () => {
            console.error('[Persistence] IndexedDB open is blocked by another tab holding an older connection. Close other Quest Forge tabs.');
            if (!blockedTimer) {
                blockedTimer = setTimeout(() => {
                    gaveUp = true;
                    reject(new Error('Save storage is blocked by another open tab. Close other Quest Forge tabs and try again.'));
                }, OPEN_BLOCKED_TIMEOUT_MS);
            }
        };
        request.onerror = () => { clearBlocked(); reject(request.error); };
        request.onsuccess = () => {
            clearBlocked();
            // A success that lands AFTER the blocked timeout rejected (the other
            // tab closed late) resolves nothing — and the connection it opened
            // would otherwise be held open with no `onversionchange`, exactly
            // the leaked connection that blocks the NEXT version bump
            // (2026-10-18 persistence P2). Close it; the caller already failed.
            if (gaveUp) { request.result?.close?.(); return; }
            resolve(request.result);
        };
        request.onupgradeneeded = (event) => {
            const db = event.target.result;
            if (!db.objectStoreNames.contains(STORE_NAME)) {
                db.createObjectStore(STORE_NAME, { keyPath: 'slotId' });
            }
            if (!db.objectStoreNames.contains(ROSTER_STORE)) {
                db.createObjectStore(ROSTER_STORE, { keyPath: 'id' });
            }
            if (!db.objectStoreNames.contains(PAYLOAD_STORE)) {
                db.createObjectStore(PAYLOAD_STORE, { keyPath: 'slotId' });
                migrateEmbeddedPayloads(event.target.transaction);
            }
            if (!db.objectStoreNames.contains(PORTRAIT_STORE)) {
                // Out-of-line keys: the value IS the data URL string.
                db.createObjectStore(PORTRAIT_STORE);
            }
            if (!db.objectStoreNames.contains(CHAPTER_STORE)) {
                // Out-of-line keys: the value IS the chapter's prose.
                db.createObjectStore(CHAPTER_STORE);
            }
        };
    });
}

/**
 * v2 → v3: move each save's full state payload out of its metadata record,
 * one-time, inside the versionchange transaction (the open blocks until the
 * cursor finishes).
 *
 * Every step is per-record and NON-FATAL (2026-09-02 audit): a failed payload
 * put (quota — peak is ~2× every save inside this one transaction) used to
 * bubble up and abort the whole upgrade, which failed the open, re-ran the
 * upgrade on EVERY later open, and so failed every save/load/autosave forever.
 * Now a failing record simply stays legacy (state still embedded in its
 * metadata record — `loadGame`'s embedded-state fallback reads it, `listSaves`
 * strips it) and the metadata is only stripped AFTER its payload landed, so a
 * record can never lose its state to a put that never happened.
 */
function migrateEmbeddedPayloads(transaction) {
    const saves = transaction.objectStore(STORE_NAME);
    const payloads = transaction.objectStore(PAYLOAD_STORE);
    // Cancel the error's default action (aborting the transaction) and keep it
    // from bubbling to the transaction/database handlers.
    const keepGoing = (label) => (errorEvent) => {
        errorEvent.preventDefault?.();
        errorEvent.stopPropagation?.();
        console.warn(`[Persistence] Save migration: ${label} — the record stays in its legacy layout.`, errorEvent.target?.error);
    };
    const cursorRequest = saves.openCursor();
    cursorRequest.onerror = keepGoing('cursor failed');
    cursorRequest.onsuccess = (cursorEvent) => {
        const cursor = cursorEvent.target.result;
        if (!cursor) return;
        const record = cursor.value;
        if (!record?.state) {
            cursor.continue();
            return;
        }
        let putRequest = null;
        try {
            putRequest = payloads.put({ slotId: record.slotId, state: record.state });
        } catch (e) {
            // A synchronous throw (non-cloneable value) is the same outcome: legacy.
            console.warn('[Persistence] Save migration: payload copy threw — the record stays in its legacy layout.', e);
            cursor.continue();
            return;
        }
        putRequest.onerror = (errorEvent) => {
            keepGoing(`payload copy for "${record.slotId}" failed`)(errorEvent);
            cursor.continue();
        };
        putRequest.onsuccess = () => {
            // Strip the embedded state only now that its copy is in place; the
            // cursor is still positioned on this record (continue() not yet called).
            const { state: _state, ...metadata } = record;
            try {
                const updateRequest = cursor.update(metadata);
                // Both copies exist if this fails — loadGame prefers the payload.
                updateRequest.onerror = keepGoing(`metadata strip for "${record.slotId}" failed`);
            } catch (e) {
                console.warn('[Persistence] Save migration: metadata strip threw — both copies remain.', e);
            }
            cursor.continue();
        };
    };
}

/**
 * Open the database, run `execute(db, resolve, reject)` as a Promise
 * executor, and guarantee the connection is closed however it ends:
 * commit, abort, a request error, OR a synchronous throw inside the executor
 * (`DataCloneError` on a non-cloneable snapshot, `InvalidStateError` while the
 * connection is closing under a cross-tab versionchange, a plain `TypeError`
 * on a bad snapshot). The per-function `db.close()` calls used to live on the
 * complete/abort handlers only, so a sync throw rejected the promise and
 * leaked the connection — and a leaked connection is exactly what blocks
 * another tab's versioned open until the 8s `onblocked` timeout (2026-09-02
 * audit). Closing here is the ONE close site; `close()` on an already-closed
 * connection is a spec no-op, and closing with a transaction still running
 * merely flags close-pending — the transaction finishes first.
 */
export async function withDb(execute) {
    const db = await openDB();
    // Another tab bumping DB_VERSION must not be held up by this connection.
    db.onversionchange = () => db.close();
    try {
        return await new Promise((resolve, reject) => execute(db, resolve, reject));
    } finally {
        db.close();
    }
}

// === Typed reads of a stored record's fields ===
// A stored record is untrusted input (a hand-edited or hostile IndexedDB /
// Firestore row) and the list renderers trust every field as a React child
// (2026-09-10 audit P1): text is string-or-fallback, numbers finite-or-fallback.

const META_TEXT_MAX = 200;
export const metaText = (value, fallback) => {
    if (typeof value !== 'string') return fallback;
    const trimmed = value.trim().slice(0, META_TEXT_MAX);
    return trimmed || fallback;
};
export const metaNumber = (value, fallback) => {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
};
/**
 * A list row's `savedAt` as epoch ms (2026-11-05 strengthening P2): a finite
 * number or a parseable ISO string (the cloud's stamp shape) inside the sane
 * epoch band (`saneEpochMs`), anything else 0 — the renderers show no date
 * for 0. Any string used to ride the save row raw ("Invalid Date"), and a
 * roster row's `1e300` passed `metaNumber`.
 */
export const metaEpochMs = (value) => {
    const ms = typeof value === 'number' ? value : typeof value === 'string' ? Date.parse(value) : NaN;
    if (!Number.isFinite(ms)) return 0;
    return saneEpochMs(ms) === ms ? ms : 0;
};

/**
 * The refs a metadata record lists under one lane's refs field (`portraitRefs`
 * / `chapterRefs`), TYPED through the lane's own `typedLaneRefs` (2026-11-05
 * strengthening P2 — the cloud claim list's rule: well-formed keys, deduped,
 * bounded; this read was untyped and uncapped).
 */
export const metadataRefs = (record, refsField) => {
    const lane = BLOB_LANES.find(candidate => candidate.refsField === refsField);
    return lane ? typedLaneRefs(record?.[refsField], lane) : [];
};

/**
 * A stored record's primary key as a list row may carry it (2026-11-05
 * strengthening P2): the EXACT key — a string as stored (never trimmed or
 * clamped, or the row's load / delete misses), or a finite number — else
 * null. A row listed by any other id is unreachable and undeletable.
 */
export const addressableKey = (key) =>
    ((typeof key === 'string' && key) || (typeof key === 'number' && Number.isFinite(key)) ? key : null);

// === Blob lanes inside a transaction ===

/** Swallow a request error without aborting the transaction (a sweep or a read that may miss). */
const quiet = (event) => { event.preventDefault?.(); event.stopPropagation?.(); };

/**
 * Ensure every blob a lane extracted is on disk: a blob is immutable under
 * its content key, so it is written only when ABSENT (`getKey` reads no
 * bytes) and never when `skip` already names it (a ref the record's previous
 * version listed is on disk and live — the sweep only ever deletes what no
 * record lists, inside serialized transactions — so a steady-state autosave
 * makes zero `getKey` requests). A failed put aborts the transaction: the save
 * fails loudly rather than committing a record whose picture or chapter never
 * landed. ONE loop for the save slot and the roster (2026-10-06 P2).
 */
export function ensureLaneBlobs(tx, lanes, skipFor = () => new Set()) {
    for (const lane of lanes) {
        // A lane with nothing to write never touches its store — the roster's
        // transaction carries the portrait store only, and a sync throw inside
        // an IDB success handler aborts the whole transaction.
        if (lane.blobs.size === 0) continue;
        const skip = skipFor(lane);
        const store = tx.objectStore(lane.id);
        for (const [key, bytes] of lane.blobs) {
            if (skip.has(key)) continue;
            const probe = store.getKey(key);
            probe.onsuccess = () => { if (probe.result === undefined) store.put(bytes, key); };
        }
    }
}

/**
 * Read every blob a stored record names (`wanted` = `collectLaneRefs(state)`,
 * `[{ lane, refs }]`) and hand `done` a `lookup(lane, key)` once the last
 * request has settled. A blob that cannot be read is simply absent from the
 * lookup — a missing picture / a dropped chapter, never a failed load. ONE
 * fan-in for the save slot and the roster (2026-10-06 P2).
 */
export function readLaneBlobs(tx, wanted, done) {
    let pending = wanted.reduce((count, entry) => count + entry.refs.length, 0);
    const found = new Map(wanted.map(({ lane }) => [lane.id, new Map()]));
    const lookup = (lane, key) => found.get(lane.id)?.get(key);
    if (pending === 0) { done(lookup); return; }
    const settle = () => { if (--pending === 0) done(lookup); };
    for (const { lane, refs } of wanted) {
        for (const ref of refs) {
            const blobRequest = tx.objectStore(lane.id).get(ref);
            blobRequest.onsuccess = () => { found.get(lane.id).set(ref, blobRequest.result); settle(); };
            blobRequest.onerror = (event) => { quiet(event); settle(); };
        }
    }
}

/**
 * The refs a stored record keeps live for one lane: the ref list its metadata
 * carries (`refsField`) plus, as the belt, whatever its embedded state still
 * names (a legacy pre-split slot record carrying `state`; a roster row, whose
 * `character` IS its payload). ONE rule for both record kinds (2026-10-06 P2:
 * the roster read was a second copy of the slot read).
 */
const liveRefsOf = (lane, record, embeddedState) => [
    ...metadataRefs(record, lane.refsField),
    ...(embeddedState ? lane.collect(embeddedState) : []),
];

/**
 * The 09-21 portrait sweep, generalized (2026-09-24) to every blob store the
 * transaction has in scope: live sets are read from every slot's metadata
 * record (+ a legacy embedded state) and, for portraits, every roster row.
 */
export function sweepOrphanBlobs(tx) {
    const lanes = BLOB_LANES
        .filter(lane => tx.objectStoreNames.contains(lane.id))
        .map(lane => ({ ...lane, live: new Set() }));
    if (lanes.length === 0) return;
    const sweepStores = () => {
        for (const lane of lanes) {
            // A live set the sweep could not finish reading deletes nothing
            // this time (the orphans wait for the next sweep).
            if (lane.unread) continue;
            const store = tx.objectStore(lane.id);
            const keysRequest = store.getAllKeys();
            keysRequest.onerror = quiet;
            keysRequest.onsuccess = () => {
                for (const key of keysRequest.result || []) {
                    if (!lane.live.has(key)) store.delete(key).onerror = quiet;
                }
            };
        }
    };
    const readRoster = () => {
        const portraitLane = lanes.find(lane => lane.id === PORTRAIT_STORE);
        if (!portraitLane) { sweepStores(); return; }
        const rosterRequest = tx.objectStore(ROSTER_STORE).getAll();
        rosterRequest.onerror = quiet;
        rosterRequest.onsuccess = () => {
            for (const record of rosterRequest.result || []) {
                liveRefsOf(portraitLane, record, { character: record?.character }).forEach(ref => portraitLane.live.add(ref));
            }
            sweepStores();
        };
    };
    const saves = tx.objectStore(STORE_NAME);
    // Keys beside the records (same key order, requests settle in order):
    // the payload belt below reads a record's payload by its KEY.
    const keysRequest = saves.getAllKeys();
    keysRequest.onerror = quiet;
    const allRequest = saves.getAll();
    allRequest.onerror = quiet;
    allRequest.onsuccess = () => {
        const keys = keysRequest.result || [];
        const belt = [];
        (allRequest.result || []).forEach((record, index) => {
            for (const lane of lanes) {
                liveRefsOf(lane, record, record?.state).forEach(ref => lane.live.add(ref));
            }
            // The live set used to be a SHAPE assumption (2026-11-05
            // strengthening P2): a record whose ref list is missing or not a
            // list contributed nothing, so the next release by ANY slot swept
            // that slot's pictures and chapters for good. Its payload is read
            // as the belt — every record this build writes carries both lists,
            // so a steady-state sweep reads no payload.
            if (!record?.state && lanes.some(lane => !Array.isArray(record?.[lane.refsField]))) belt.push(keys[index]);
        });
        readPayloadBelt(tx, lanes, belt, readRoster);
    };
}

/**
 * Add the refs each belt slot's PAYLOAD names to every lane's live set, then
 * `done()`. A transaction without the payload store in scope (a roster save)
 * or a payload read that fails cannot prove those refs dead, so the lanes are
 * marked `unread` and that sweep deletes nothing.
 */
function readPayloadBelt(tx, lanes, keys, done) {
    if (keys.length === 0) { done(); return; }
    const markUnread = () => lanes.forEach(lane => { lane.unread = true; });
    if (!tx.objectStoreNames.contains(PAYLOAD_STORE)) { markUnread(); done(); return; }
    const store = tx.objectStore(PAYLOAD_STORE);
    let pending = keys.length;
    const settle = () => { if (--pending === 0) done(); };
    for (const key of keys) {
        let request = null;
        try {
            request = store.get(key);
        } catch {
            markUnread();
            settle();
            continue;
        }
        request.onsuccess = () => {
            const state = request.result?.state;
            for (const lane of lanes) lane.collect(state).forEach(ref => lane.live.add(ref));
            settle();
        };
        request.onerror = (event) => { quiet(event); markUnread(); settle(); };
    }
}
