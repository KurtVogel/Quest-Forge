/**
 * The 2026-10-29 hidden-fronts audit, built 2026-10-30: the DM is a BLIND
 * writer of a front's clock (it sees ids and factions, never a number), so
 * the wire is a direction; the wire's `status` is `resolved` only; the doom's
 * one-window rule is judged over the whole list and the heal skips rather
 * than relabels; a dormant front is invisible on the tempo stub line.
 */
import { describe, expect, it } from 'vitest';
import {
    FRONT_RECORD_KEYS,
    frontUpdateDirection,
    normalizeFront,
    normalizeFrontUpdate,
    openDoomWindow,
} from './fronts.js';
import { buildWorldTempoBlock } from './worldTempo.js';

const full = (id, overrides = {}) => normalizeFront({
    id,
    title: `Front ${id}`,
    goal: 'g',
    stakes: 's',
    grimPortents: ['a', 'b', 'c', 'd'],
    clock: 6,
    maxClock: 6,
    stage: 4,
    status: 'active',
    faction: { name: `${id} faction`, goal: 'x' },
    ...overrides,
});

describe('the DM wire moves a dial by DIRECTION (2026-10-30 P1)', () => {
    it('clock_delta / stage_delta ride as clockDelta / stageDelta clamped to -1..1', () => {
        expect(normalizeFrontUpdate({ id: 'f', clock_delta: -1 })).toMatchObject({ clockDelta: -1 });
        expect(normalizeFrontUpdate({ id: 'f', clock_delta: 5 })).toMatchObject({ clockDelta: 1 });
        expect(normalizeFrontUpdate({ id: 'f', clock_delta: '-3' })).toMatchObject({ clockDelta: -1 });
        expect(normalizeFrontUpdate({ id: 'f', stage_delta: 2 })).toMatchObject({ stageDelta: 1 });
        expect(normalizeFrontUpdate({ id: 'f', clockDelta: 1, stageDelta: -1 })).toMatchObject({ clockDelta: 1, stageDelta: -1 });
    });

    it('a delta WINS over an absolute in the same entry; a junk delta drops its key and lets the legacy absolute ride', () => {
        const both = normalizeFrontUpdate({ id: 'f', clock_delta: -1, clock: 9 });
        expect(both).toMatchObject({ clockDelta: -1 });
        expect(both).not.toHaveProperty('clock');
        for (const junk of [null, 'unchanged', {}, [], true]) {
            const update = normalizeFrontUpdate({ id: 'f', clock_delta: junk, clock: 3 });
            expect(update).not.toHaveProperty('clockDelta');
            expect(update).toMatchObject({ clock: 3 });
        }
    });

    it('frontUpdateDirection reads the delta as given and folds a legacy absolute to the sign against the held value', () => {
        expect(frontUpdateDirection({ clockDelta: -1 }, 'clock', 4)).toBe(-1);
        expect(frontUpdateDirection({ clockDelta: 1 }, 'clock', 4)).toBe(1);
        expect(frontUpdateDirection({ clockDelta: 0 }, 'clock', 4)).toBe(0);
        expect(frontUpdateDirection({ clock: 1 }, 'clock', 4)).toBe(-1);
        expect(frontUpdateDirection({ clock: 6 }, 'clock', 4)).toBe(1);
        expect(frontUpdateDirection({ clock: 4 }, 'clock', 4)).toBe(0);
        expect(frontUpdateDirection({ notes: 'x' }, 'clock', 4)).toBe(0);
        expect(frontUpdateDirection({ stage: 0 }, 'stage', 2)).toBe(-1);
    });

    it('the soften stamp is a record key and survives re-normalization like the gain stamp', () => {
        expect(FRONT_RECORD_KEYS).toContain('lastDmClockSoftenMessage');
        const front = normalizeFront(full('f', { lastDmClockSoftenMessage: 31, lastDmClockGainMessage: 20 }));
        expect(front).toMatchObject({ lastDmClockSoftenMessage: 31, lastDmClockGainMessage: 20 });
        expect(normalizeFront({}, front)).toMatchObject({ lastDmClockSoftenMessage: 31 });
        expect(normalizeFront(full('g', { lastDmClockSoftenMessage: 'soon' })).lastDmClockSoftenMessage).toBeNull();
    });
});

describe('the wire admits no status but resolved (2026-10-30 P2)', () => {
    it('completed, dormant and active are no-ops on the wire — the record keeps its status', () => {
        for (const word of ['completed', 'dormant', 'active', 'Completed', 'DORMANT']) {
            const update = normalizeFrontUpdate({ id: 'f', status: word, notes: 'still here' });
            expect(update).not.toHaveProperty('status');
            expect(update.notes).toBe('still here');
        }
        expect(normalizeFrontUpdate({ id: 'f', status: 'resolved' }).status).toBe('resolved');
    });
});

describe('one doom window over the WHOLE list (2026-10-30 P2)', () => {
    it('a non-active front with an open window occupies the slot; a resolved front\'s stale stamp does not', () => {
        const open = full('left', { status: 'dormant', doomAtMessage: 40 });
        const home = full('home');
        const input = [open, home];
        const blocked = openDoomWindow(input, { messageCount: 50 });
        expect(blocked.opened).toBeNull();
        expect(blocked.fronts).toBe(input);
        // The hero resolved a front INSIDE its window: the stamp stays, the
        // window is over by construction, the next full clock opens.
        const resolved = full('done', { status: 'resolved', doomAtMessage: 40 });
        expect(openDoomWindow([resolved, home], { messageCount: 50 }).opened?.id).toBe('home');
    });

    it('skipIds keeps a front out of the candidate search without touching its status', () => {
        const left = full('left');
        const home = full('home');
        const { fronts, opened } = openDoomWindow([left, home], { messageCount: 50, skipIds: ['left'] });
        expect(opened?.id).toBe('home');
        expect(fronts[0]).toBe(left);
        expect(fronts[0].status).toBe('active');
        expect(fronts[0].doomAtMessage).toBeNull();
        // Only skipped fronts qualify: nothing opens.
        expect(openDoomWindow([left], { messageCount: 50, skipIds: ['left'] }).opened).toBeNull();
    });

    it('a skipped left-behind front with an OPEN window still blocks the home-land open (the heal\'s case)', () => {
        const left = full('left', { doomAtMessage: 40 });
        const home = full('home');
        expect(openDoomWindow([left, home], { messageCount: 50, skipIds: ['left'] }).opened).toBeNull();
    });
});

describe('the tempo stub line lists active fronts only', () => {
    it('a dormant id never reaches the DM; an active one does', () => {
        const block = buildWorldTempoBlock({
            fronts: [
                full('front-awake', { clock: 2, stage: 1 }),
                full('front-asleep', { clock: 2, stage: 1, status: 'dormant' }),
            ],
            messageCount: 10,
        });
        expect(block).toContain('front-awake');
        expect(block).not.toContain('front-asleep');
    });
});
