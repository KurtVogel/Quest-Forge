/**
 * Restore points — the policy (2026-11-11, review queue item 1): what is due
 * before the autosave slot is overwritten, how it is labelled, and what the
 * rotation drops. The IndexedDB half is restorePointStore.test.js.
 */
import { describe, expect, it } from 'vitest';
import {
    RESTORE_INTERVAL_MESSAGES,
    RESTORE_REASONS,
    RESTORE_ROLLING_KEEP,
    RESTORE_SLOT_PREFIX,
    describeRestoreReason,
    isRestoreSlot,
    labelRestoreReason,
    nextTakenAt,
    planRestorePoint,
    pruneRestorePoints,
    readRestorePoint,
    readSaveStamp,
    restoreSlotId,
} from './restorePoints.js';

const CURRENT = 7;
const T0 = 1_790_000_000_000;

const autosave = (overrides = {}) => ({ sessionId: 'camp-a', messageCount: 200, savedAt: T0, ...overrides });
const point = (overrides = {}) => ({ slotId: `${RESTORE_SLOT_PREFIX}${overrides.takenAt ?? T0}`, sessionId: 'camp-a', messageCount: 200, savedAt: T0 - 1000, reason: RESTORE_REASONS.LOAD, takenAt: T0 - 500, ...overrides });
const planFull = (input) => planRestorePoint({ nextSessionId: 'camp-a', ...input });
/** The planned reason alone (`supersedes` has its own tests). */
const plan = (input) => { const planned = planFull(input); return planned && { reason: planned.reason }; };

describe('planRestorePoint — is a copy due before the overwrite?', () => {
    it('nothing stored is nothing to copy', () => {
        expect(plan({ autosave: null, afterLoad: true })).toBeNull();
    });

    it('a different campaign about to take the slot is a previous-campaign copy, load or not', () => {
        expect(plan({ autosave: autosave({ sessionId: 'camp-b' }), afterLoad: true })).toEqual({ reason: RESTORE_REASONS.PREVIOUS_CAMPAIGN });
        expect(plan({ autosave: autosave({ sessionId: 'camp-b' }), afterLoad: false })).toEqual({ reason: RESTORE_REASONS.PREVIOUS_CAMPAIGN });
        // …even on the hide flush: the slot is about to lose a whole campaign.
        expect(plan({ autosave: autosave({ sessionId: 'camp-b' }), urgent: true })).toEqual({ reason: RESTORE_REASONS.PREVIOUS_CAMPAIGN });
    });

    it('an unstamped stored campaign is not called "another campaign" — it is covered as a load', () => {
        expect(plan({ autosave: autosave({ sessionId: null }), afterLoad: true })).toEqual({ reason: RESTORE_REASONS.LOAD });
    });

    it('the first autosave after a load copies the stored record', () => {
        expect(plan({ autosave: autosave(), afterLoad: true })).toEqual({ reason: RESTORE_REASONS.LOAD });
    });

    it('EVERY load copies the stored record — also at the message count of the newest copy (a level-up, a closed chapter, an edited sheet since then)', () => {
        expect(plan({ autosave: autosave(), points: [point({ messageCount: 200 })], afterLoad: true })).toEqual({ reason: RESTORE_REASONS.LOAD });
        expect(plan({ autosave: autosave({ messageCount: 212 }), points: [point({ messageCount: 200 })], afterLoad: true })).toEqual({ reason: RESTORE_REASONS.LOAD });
    });

    it('reload + Continue with no play does not spend another slot: the copy REPLACES the newest rolling copy at the same count', () => {
        const twin = point({ slotId: 'twin', messageCount: 200 });
        expect(planFull({ autosave: autosave(), points: [twin], afterLoad: true })).toEqual({ reason: RESTORE_REASONS.LOAD, supersedes: 'twin' });
        expect(planFull({ autosave: autosave(), points: [{ ...twin, reason: RESTORE_REASONS.INTERVAL }], afterLoad: true }).supersedes).toBe('twin');
        // Play since the newest copy: nothing is replaced.
        expect(planFull({ autosave: autosave({ messageCount: 212 }), points: [twin], afterLoad: true }).supersedes).toBeNull();
        expect(planFull({ autosave: autosave(), afterLoad: true }).supersedes).toBeNull();
    });

    it('a pinned copy is never replaced, and only THIS campaign\'s NEWEST copy can be', () => {
        for (const reason of [RESTORE_REASONS.BEFORE_UPDATE, RESTORE_REASONS.PREVIOUS_CAMPAIGN]) {
            expect(planFull({ autosave: autosave(), points: [point({ slotId: 'pinned', reason, messageCount: 200 })], afterLoad: true }).supersedes).toBeNull();
        }
        const points = [
            point({ slotId: 'old', messageCount: 200, takenAt: T0 - 9000 }),
            point({ slotId: 'new', messageCount: 180, takenAt: T0 - 100 }),
            point({ slotId: 'other', sessionId: 'camp-b', messageCount: 200, takenAt: T0 - 50 }),
        ];
        expect(planFull({ autosave: autosave(), points, afterLoad: true })).toEqual({ reason: RESTORE_REASONS.LOAD, supersedes: null });
    });

    it('a previous-campaign and an interval copy replace nothing', () => {
        const points = [point({ slotId: 'twin', sessionId: 'camp-b', messageCount: 200 })];
        expect(planFull({ autosave: autosave({ sessionId: 'camp-b' }), points, afterLoad: true })).toEqual({ reason: RESTORE_REASONS.PREVIOUS_CAMPAIGN, supersedes: null });
        expect(planFull({ autosave: autosave({ messageCount: 250 }), points: [point({ messageCount: 200 })] })).toEqual({ reason: RESTORE_REASONS.INTERVAL, supersedes: null });
    });

    it('the exact stored write is never copied twice', () => {
        const points = [point({ savedAt: T0 })];
        expect(plan({ autosave: autosave(), points, afterLoad: true })).toBeNull();
        expect(plan({ autosave: autosave({ sessionId: 'camp-b' }), points: [point({ sessionId: 'camp-b', savedAt: T0 })] })).toBeNull();
        // The same stamp on a different transcript is a different write.
        expect(plan({ autosave: autosave({ sessionId: 'camp-b', messageCount: 201 }), points: [point({ sessionId: 'camp-b', savedAt: T0 })] }))
            .toEqual({ reason: RESTORE_REASONS.PREVIOUS_CAMPAIGN });
    });

    it(`play copies every ${RESTORE_INTERVAL_MESSAGES} messages, measured from the newest copy`, () => {
        const points = [point({ messageCount: 200 })];
        expect(plan({ autosave: autosave({ messageCount: 249 }), points })).toBeNull();
        expect(plan({ autosave: autosave({ messageCount: 250 }), points })).toEqual({ reason: RESTORE_REASONS.INTERVAL });
    });

    it('a campaign with no copy yet gets its first at the interval', () => {
        expect(plan({ autosave: autosave({ messageCount: 49 }) })).toBeNull();
        expect(plan({ autosave: autosave({ messageCount: 50 }) })).toEqual({ reason: RESTORE_REASONS.INTERVAL });
    });

    it('the interval counts distance either way (an earlier save was loaded over later progress)', () => {
        expect(plan({ autosave: autosave({ messageCount: 120 }), points: [point({ messageCount: 400 })] })).toEqual({ reason: RESTORE_REASONS.INTERVAL });
    });

    it('the hide flush defers an interval copy but not the one a load owes', () => {
        const points = [point({ messageCount: 100 })];
        expect(plan({ autosave: autosave({ messageCount: 300 }), points, urgent: true })).toBeNull();
        expect(plan({ autosave: autosave({ messageCount: 300 }), points, urgent: true, afterLoad: true })).toEqual({ reason: RESTORE_REASONS.LOAD });
    });
});

describe('labelRestoreReason — "before update" is decided by the stored payload\'s own version', () => {
    it('a load copy of an older or unstamped payload is a before-update copy', () => {
        expect(labelRestoreReason(RESTORE_REASONS.LOAD, CURRENT - 1, CURRENT)).toBe(RESTORE_REASONS.BEFORE_UPDATE);
        expect(labelRestoreReason(RESTORE_REASONS.LOAD, undefined, CURRENT)).toBe(RESTORE_REASONS.BEFORE_UPDATE);
        expect(labelRestoreReason(RESTORE_REASONS.LOAD, 'junk', CURRENT)).toBe(RESTORE_REASONS.BEFORE_UPDATE);
    });

    it('a current (or newer) payload keeps its label, and no other reason is relabelled', () => {
        expect(labelRestoreReason(RESTORE_REASONS.LOAD, CURRENT, CURRENT)).toBe(RESTORE_REASONS.LOAD);
        expect(labelRestoreReason(RESTORE_REASONS.LOAD, CURRENT + 1, CURRENT)).toBe(RESTORE_REASONS.LOAD);
        expect(labelRestoreReason(RESTORE_REASONS.PREVIOUS_CAMPAIGN, 1, CURRENT)).toBe(RESTORE_REASONS.PREVIOUS_CAMPAIGN);
        expect(labelRestoreReason(RESTORE_REASONS.INTERVAL, 1, CURRENT)).toBe(RESTORE_REASONS.INTERVAL);
    });
});

describe('nextTakenAt — a copy is never dated at or before an existing one', () => {
    it('is the wall clock while the clock moves forward', () => {
        expect(nextTakenAt(T0)).toBe(T0);
        expect(nextTakenAt(T0, [{ takenAt: T0 - 5 }, { takenAt: T0 - 9000 }])).toBe(T0);
    });

    it('steps past the newest existing copy when the device clock went backwards', () => {
        expect(nextTakenAt(T0 - 1000, [{ takenAt: T0 + 3 }, { takenAt: T0 + 5 }])).toBe(T0 + 6);
        expect(nextTakenAt(T0, [{ takenAt: T0 }])).toBe(T0 + 1);
    });
});

describe('pruneRestorePoints — the rotation', () => {
    const rolling = (n, reason = RESTORE_REASONS.INTERVAL) => ({ slotId: `r${n}`, reason, takenAt: T0 + n });

    it(`keeps the ${RESTORE_ROLLING_KEEP} newest rolling copies and drops the older ones`, () => {
        const points = [1, 2, 3, 4, 5, 6, 7, 8].map(n => rolling(n));
        expect(pruneRestorePoints(points).sort()).toEqual(['r1', 'r2', 'r3']);
        expect(pruneRestorePoints(points.slice(0, 5))).toEqual([]);
    });

    it('load and interval copies share the one rolling pool', () => {
        const points = [1, 2, 3, 4, 5, 6].map(n => rolling(n, n % 2 ? RESTORE_REASONS.LOAD : RESTORE_REASONS.INTERVAL));
        expect(pruneRestorePoints(points)).toEqual(['r1']);
    });

    it('the newest before-update and the newest previous-campaign are kept OUTSIDE the pool, however old', () => {
        const points = [
            { slotId: 'update', reason: RESTORE_REASONS.BEFORE_UPDATE, takenAt: T0 - 9000 },
            { slotId: 'campaign', reason: RESTORE_REASONS.PREVIOUS_CAMPAIGN, takenAt: T0 - 8000 },
            ...[1, 2, 3, 4, 5, 6].map(n => rolling(n)),
        ];
        expect(pruneRestorePoints(points)).toEqual(['r1']);
        // Seven records is the ceiling.
        expect(points.length - pruneRestorePoints(points).length).toBe(RESTORE_ROLLING_KEEP + 2);
    });

    it('an older pinned-reason copy joins the rolling pool instead of vanishing at once', () => {
        const points = [
            { slotId: 'update-old', reason: RESTORE_REASONS.BEFORE_UPDATE, takenAt: T0 + 1 },
            { slotId: 'update-new', reason: RESTORE_REASONS.BEFORE_UPDATE, takenAt: T0 + 2 },
            rolling(3),
        ];
        expect(pruneRestorePoints(points)).toEqual([]);
        // …and rotates out like any rolling copy once five newer ones exist.
        const crowded = [...points, ...[4, 5, 6, 7].map(n => rolling(n))];
        expect(pruneRestorePoints(crowded)).toEqual(['update-old']);
    });

    it('does not mutate its input and tolerates an empty list', () => {
        const points = [rolling(2), rolling(1)];
        pruneRestorePoints(points, 1);
        expect(points.map(p => p.slotId)).toEqual(['r2', 'r1']);
        expect(pruneRestorePoints([])).toEqual([]);
    });
});

describe('reserved slot ids and typed stamps', () => {
    it('recognises a restore slot by its reserved prefix only', () => {
        expect(isRestoreSlot(`${RESTORE_SLOT_PREFIX}1790000000000`)).toBe(true);
        expect(isRestoreSlot('save-1790000000000')).toBe(false);
        expect(isRestoreSlot('__autosave__')).toBe(false);
        expect(isRestoreSlot(42)).toBe(false);
        expect(isRestoreSlot(null)).toBe(false);
    });

    it('mints a fresh id, suffixed when that millisecond is taken', () => {
        const first = restoreSlotId(T0);
        expect(first).toBe(`${RESTORE_SLOT_PREFIX}${T0}`);
        expect(restoreSlotId(T0, [first])).toBe(`${first}-1`);
        expect(restoreSlotId(T0, [first, `${first}-1`])).toBe(`${first}-2`);
    });

    it('types a stored record\'s stamps (a stored record is untrusted input)', () => {
        expect(readSaveStamp({ sessionId: ' camp-a ', messageCount: '12.7', savedAt: T0 }))
            .toEqual({ sessionId: 'camp-a', messageCount: 12, savedAt: T0 });
        expect(readSaveStamp({ sessionId: {}, messageCount: -5, savedAt: 'junk' }))
            .toEqual({ sessionId: null, messageCount: 0, savedAt: 0 });
        expect(readSaveStamp(null)).toEqual({ sessionId: null, messageCount: 0, savedAt: 0 });
    });

    it('reads a restore point\'s reason and time, an unknown reason as a plain rolling copy', () => {
        const record = { sessionId: 'camp-a', messageCount: 9, savedAt: T0, restorePoint: { reason: RESTORE_REASONS.BEFORE_UPDATE, takenAt: T0 + 5 } };
        expect(readRestorePoint(record, 'slot-x')).toMatchObject({ slotId: 'slot-x', reason: RESTORE_REASONS.BEFORE_UPDATE, takenAt: T0 + 5, messageCount: 9 });
        expect(readRestorePoint({ restorePoint: { reason: 'constructor', takenAt: {} } }, 'slot-y')).toMatchObject({ reason: RESTORE_REASONS.LOAD, takenAt: 0 });
        expect(readRestorePoint({}, 'slot-z')).toMatchObject({ reason: RESTORE_REASONS.LOAD, takenAt: 0 });
    });

    it('names every reason for the saves dialog', () => {
        expect(describeRestoreReason(RESTORE_REASONS.BEFORE_UPDATE)).toBe('Before update');
        expect(describeRestoreReason(RESTORE_REASONS.PREVIOUS_CAMPAIGN)).toBe('Previous campaign');
        expect(describeRestoreReason(RESTORE_REASONS.LOAD)).toBe('Before a load');
        expect(describeRestoreReason(RESTORE_REASONS.INTERVAL)).toBe('During play');
        expect(describeRestoreReason('nonsense')).toBe('Copy');
    });
});
