/**
 * Restore points — the IndexedDB half (the policy is restorePoints.js).
 * One readwrite transaction decides, copies and rotates, so two overlapping
 * autosaves can never both copy the same stored write.
 *
 * The copy is the STORED record as stored: the autosave's payload object is
 * read and put under the restore slot id, never rebuilt from live state (live
 * state at that moment is exactly what the copy protects against — a migrated
 * load, a different campaign).
 */
import { BLOB_LANES } from './portraitStore.js';
import { AUTOSAVE_SLOT, BLOB_SWEEP_STORES, PAYLOAD_STORE, STORE_NAME, sweepOrphanBlobs, withDb } from './idb.js';
import {
    isRestoreSlot,
    labelRestoreReason,
    nextTakenAt,
    planRestorePoint,
    pruneRestorePoints,
    readRestorePoint,
    readSaveStamp,
    restoreSlotId,
} from './restorePoints.js';

const isPlainObject = (value) => value && typeof value === 'object' && !Array.isArray(value);

/**
 * Copy the stored autosave to a restore point when one is due before
 * `sessionId`'s autosave overwrites it, then rotate. Resolves the reason the
 * copy was taken under, or null when none was due. Rejects on a storage
 * failure — the caller (`autoSave`) logs it and saves anyway: a missed copy
 * must never cost the player's turn.
 */
export function keepRestorePoint({ sessionId = null, afterLoad = false, urgent = false, now = Date.now() } = {}) {
    return withDb((db, resolve, reject) => {
        const tx = db.transaction([PAYLOAD_STORE, ...BLOB_SWEEP_STORES], 'readwrite');
        const saves = tx.objectStore(STORE_NAME);
        const payloads = tx.objectStore(PAYLOAD_STORE);
        let taken = null;

        // Keys beside the records (same key order; requests settle in order).
        const keysRequest = saves.getAllKeys();
        const allRequest = saves.getAll();
        allRequest.onsuccess = () => {
            const keys = keysRequest.result || [];
            let autosave = null;
            const points = [];
            (allRequest.result || []).forEach((record, index) => {
                const key = keys[index];
                if (key === AUTOSAVE_SLOT) autosave = record;
                else if (isRestoreSlot(key)) points.push(readRestorePoint(record, key));
            });
            const plan = planRestorePoint({
                autosave: isPlainObject(autosave) ? readSaveStamp(autosave) : null,
                points,
                nextSessionId: sessionId,
                afterLoad,
                urgent,
            });
            if (!plan) return;

            const payloadRequest = payloads.get(AUTOSAVE_SLOT);
            payloadRequest.onsuccess = () => {
                // A legacy record still carries its state inside the metadata
                // record; the copy is written in the split layout either way.
                const state = payloadRequest.result?.state ?? autosave.state;
                // Nothing a load could open is nothing worth a slot.
                if (!isPlainObject(state)) return;
                const reason = labelRestoreReason(plan.reason, state.saveVersion);
                // Never dated at or before an existing copy (a corrected clock).
                const takenAt = nextTakenAt(now, points);
                const slotId = restoreSlotId(takenAt, points.map(point => point.slotId));
                const { state: _embedded, ...metadata } = autosave;
                saves.put({
                    ...metadata,
                    slotId,
                    // The copy lists its own blob refs (a record without the
                    // lists costs every later sweep a payload read).
                    ...Object.fromEntries(BLOB_LANES.map(lane => [
                        lane.refsField,
                        Array.isArray(autosave[lane.refsField]) ? autosave[lane.refsField] : lane.collect(state),
                    ])),
                    restorePoint: { reason, takenAt },
                });
                payloads.put({ slotId, state });
                taken = reason;

                // The copy this one replaces (the same campaign at the same
                // message count: the policy's `supersedes`), then the rotation.
                const kept = points.filter(point => point.slotId !== plan.supersedes);
                const dropped = [
                    ...points.filter(point => point.slotId === plan.supersedes).map(point => point.slotId),
                    ...pruneRestorePoints([...kept, { slotId, reason, takenAt }]),
                ];
                for (const id of dropped) {
                    saves.delete(id);
                    payloads.delete(id);
                }
                // A dropped copy may have been the last record naming a
                // portrait or a chapter (requests run in order: the sweep
                // already sees the put and the deletes above).
                if (dropped.length > 0) sweepOrphanBlobs(tx);
            };
        };

        // Resolve on COMMIT (see saveGame); any request error aborts.
        tx.oncomplete = () => resolve(taken);
        tx.onabort = () => reject(tx.error || allRequest.error || keysRequest.error);
    });
}

/** Every stored restore point as `{ key, record }` (metadata records only — never a payload). */
export function readRestorePointRecords() {
    return withDb((db, resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readonly');
        const store = tx.objectStore(STORE_NAME);
        const keysRequest = store.getAllKeys();
        const request = store.getAll();
        request.onsuccess = () => {
            const keys = keysRequest.result || [];
            resolve((request.result || [])
                .map((record, index) => ({ record, key: keys[index] }))
                .filter(({ record, key }) => isRestoreSlot(key) && record && typeof record === 'object'));
        };
        request.onerror = () => reject(request.error);
        tx.onabort = () => reject(tx.error || request.error);
    });
}
