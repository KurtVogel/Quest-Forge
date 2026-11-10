/**
 * Restore points — the POLICY half (2026-11-11, review queue item 1: save
 * safety). The autosave is one record, overwritten ~2 s after every change;
 * a load runs the migrations in memory and the next autosave writes the result
 * over the only copy; a new campaign reuses the slot. A restore point is a
 * stored copy of the autosave record, taken just before an overwrite that
 * could lose something:
 *
 *  - `before-update`: the first autosave after a load, when the stored save
 *    was written by an older save version (the migrations are about to land);
 *  - `previous-campaign`: a different campaign is about to take the slot;
 *  - `load`: the first autosave after any other load (loading an earlier save
 *    over later progress; the start of a play session);
 *  - `interval`: every `RESTORE_INTERVAL_MESSAGES` messages of play.
 *
 * Kept: the newest `before-update`, the newest `previous-campaign`, and the
 * `RESTORE_ROLLING_KEEP` newest of everything else (an older pinned-reason
 * copy joins the rolling pool, so a second update the next day does not erase
 * the first copy at once). Seven records at most.
 *
 * Pure: what is due, how it is labelled, what is dropped. The IndexedDB half
 * is restorePointStore.js. Records live in the existing `saves` /
 * `savePayloads` stores under reserved slot ids (no DB_VERSION bump): the
 * metadata record lists the copy's blob refs like any slot, so the orphan
 * sweep keeps its portraits and chapters alive.
 */
import { CURRENT_SAVE_VERSION } from './migrations.js';
import { metaEpochMs, metaNumber, metaText } from './idb.js';

/** Reserved slot-id prefix of a restore point (`listSaves` excludes it like the autosave slot). */
export const RESTORE_SLOT_PREFIX = '__restore__-';

/** Rolling copies kept beside the two pinned ones. Measured 2026-11-11: the megacampaign's payload is 3.77 MB, so seven copies are ~26 MB of a ~10 GB quota. */
export const RESTORE_ROLLING_KEEP = 5;

/** Messages of play between two rolling copies (raw transcript rows, the count a save row shows). */
export const RESTORE_INTERVAL_MESSAGES = 50;

export const RESTORE_REASONS = Object.freeze({
    BEFORE_UPDATE: 'before-update',
    PREVIOUS_CAMPAIGN: 'previous-campaign',
    LOAD: 'load',
    INTERVAL: 'interval',
});

/** The reasons whose NEWEST copy is kept outside the rolling pool. */
const PINNED_REASONS = [RESTORE_REASONS.BEFORE_UPDATE, RESTORE_REASONS.PREVIOUS_CAMPAIGN];

const REASON_LABELS = {
    [RESTORE_REASONS.BEFORE_UPDATE]: 'Before update',
    [RESTORE_REASONS.PREVIOUS_CAMPAIGN]: 'Previous campaign',
    [RESTORE_REASONS.LOAD]: 'Before a load',
    [RESTORE_REASONS.INTERVAL]: 'During play',
};

export const isRestoreSlot = (key) => typeof key === 'string' && key.startsWith(RESTORE_SLOT_PREFIX);

/** A fresh restore slot id: the wall-clock stamp plus a suffix when that id is taken. */
export function restoreSlotId(takenAt, takenIds = []) {
    const taken = new Set(takenIds);
    let id = `${RESTORE_SLOT_PREFIX}${takenAt}`;
    for (let n = 1; taken.has(id); n++) id = `${RESTORE_SLOT_PREFIX}${takenAt}-${n}`;
    return id;
}

/** Player-facing name of a restore reason (an unknown one reads as a plain copy). */
export const describeRestoreReason = (reason) => REASON_LABELS[reason] || 'Copy';

const knownReason = (reason) => (Object.hasOwn(REASON_LABELS, reason) ? reason : RESTORE_REASONS.LOAD);

/**
 * The stamps the policy reads off a stored metadata record (the autosave's or
 * a restore point's), TYPED — a stored record is untrusted input. `savedAt`
 * is the save's own write stamp (a restore point keeps its source's).
 */
export function readSaveStamp(record) {
    const data = record && typeof record === 'object' ? record : {};
    return {
        sessionId: metaText(data.sessionId, null),
        messageCount: Math.max(0, Math.floor(metaNumber(data.messageCount, 0))),
        savedAt: metaEpochMs(data.savedAt),
    };
}

/** A restore point's own stamps beside its source's: why it was taken and when. */
export function readRestorePoint(record, slotId) {
    const stamp = record?.restorePoint && typeof record.restorePoint === 'object' ? record.restorePoint : {};
    return {
        slotId,
        ...readSaveStamp(record),
        reason: knownReason(stamp.reason),
        takenAt: metaEpochMs(stamp.takenAt),
    };
}

/** Is this stored save version older than the build's (an absent stamp is version 0)? */
const isOlderVersion = (version, currentVersion) => !(Number.isFinite(version) && version >= currentVersion);

/** The most recently taken copy of one campaign. */
function newestPointOf(points, sessionId) {
    return points
        .filter(point => point.sessionId === sessionId)
        .reduce((newest, point) => (!newest || point.takenAt > newest.takenAt ? point : newest), null);
}

/**
 * Is a copy of the stored autosave due before `nextSessionId`'s autosave
 * overwrites it? Returns `{ reason, supersedes }` or null. Reads metadata only.
 * `supersedes` is the slot id of a rolling copy the new one REPLACES (below).
 *
 *  - `autosave`: `readSaveStamp` of the stored autosave record, or null (nothing to copy);
 *  - `points`: `readRestorePoint` of every stored restore point;
 *  - `afterLoad`: this is the first autosave of a newly loaded (or new) timeline;
 *  - `urgent`: the hide / unload flush — an interval copy waits for the next
 *    ordinary autosave (the write that carries the player's last turn must not
 *    queue behind a multi-MB copy while the page is going away).
 *
 * A `load` plan is labelled `before-update` by `labelRestoreReason` once the
 * payload's own version is in hand.
 */
export function planRestorePoint({ autosave, points = [], nextSessionId = null, afterLoad = false, urgent = false } = {}) {
    if (!autosave) return null;
    // This exact stored write is already copied (a repeated call, an autosave
    // that failed after its copy landed).
    if (autosave.savedAt > 0 && points.some(point => point.sessionId === autosave.sessionId
        && point.savedAt === autosave.savedAt && point.messageCount === autosave.messageCount)) return null;
    if (autosave.sessionId && nextSessionId && autosave.sessionId !== nextSessionId) {
        return { reason: RESTORE_REASONS.PREVIOUS_CAMPAIGN, supersedes: null };
    }
    const newest = newestPointOf(points, autosave.sessionId);
    if (afterLoad) {
        // Every load copies the stored record (the label is decided from the
        // payload's version). Reload + Continue with no play in between
        // rewrites the record without moving the story, and five of those
        // must not push out the rolling history: a copy at the SAME message
        // count as this campaign's newest rolling copy takes that copy's
        // place. The stored record is the later write of the same transcript
        // (a level-up, a closed chapter, an edited sheet since that copy), so
        // replacing loses nothing a skip would have kept, and a skip lost
        // exactly those edits when an older save was loaded next.
        const twin = newest && !PINNED_REASONS.includes(newest.reason) && newest.messageCount === autosave.messageCount;
        return { reason: RESTORE_REASONS.LOAD, supersedes: twin ? newest.slotId : null };
    }
    if (urgent) return null;
    // Distance either way: a load of an earlier save drops the count, and the
    // interval restarts from there.
    const since = newest ? Math.abs(autosave.messageCount - newest.messageCount) : autosave.messageCount;
    return since >= RESTORE_INTERVAL_MESSAGES ? { reason: RESTORE_REASONS.INTERVAL, supersedes: null } : null;
}

/**
 * The stamp a new copy is taken under: the wall clock, but never at or before
 * an existing copy's. A device clock that was ahead and then corrected would
 * otherwise date the new copy OLDER than the five it joins: the rotation
 * dropped it in the transaction that wrote it, and the interval rule, still
 * reading the old "newest", copied again on every autosave.
 */
export function nextTakenAt(now, points = []) {
    return points.reduce((stamp, point) => Math.max(stamp, point.takenAt + 1), now);
}

/** The final label of a planned copy, once the stored PAYLOAD's save version is read. */
export function labelRestoreReason(reason, storedSaveVersion, currentVersion = CURRENT_SAVE_VERSION) {
    if (reason === RESTORE_REASONS.LOAD && isOlderVersion(storedSaveVersion, currentVersion)) return RESTORE_REASONS.BEFORE_UPDATE;
    return reason;
}

/**
 * The rotation: which restore points go. Keeps the newest copy of each pinned
 * reason and the `keep` newest of the rest; returns the slot ids to delete.
 */
export function pruneRestorePoints(points, keep = RESTORE_ROLLING_KEEP) {
    const byNewest = [...points].sort((a, b) => b.takenAt - a.takenAt);
    const pinned = new Set();
    for (const reason of PINNED_REASONS) {
        const newest = byNewest.find(point => point.reason === reason);
        if (newest) pinned.add(newest.slotId);
    }
    return byNewest.filter(point => !pinned.has(point.slotId)).slice(Math.max(0, keep)).map(point => point.slotId);
}
