/**
 * Direct engine/fronts.js suite (2026-08-24 audit P2: the pacing guards and
 * normalizers were pinned only through the reducer, and only partially).
 */
import { describe, expect, it } from 'vitest';
import {
    applyFrontAdvanceBatch,
    buildFrontResolutionFact,
    createInitialFronts,
    DEFAULT_MAX_CLOCK,
    normalizeEmergentFront,
    normalizeFaction,
    normalizeFront,
    normalizeFrontUpdate,
} from './fronts.js';

const baseFront = (overrides = {}) => normalizeFront({
    id: 'front-a',
    title: 'The Salt Baron',
    goal: 'Corner the fish trade',
    stakes: 'The wharf starves',
    grimPortents: ['Prices rise', 'Boats vanish', 'Open extortion', 'The wharf burns'],
    clock: 2,
    maxClock: 6,
    stage: 1,
    ...overrides,
});

describe('applyFrontAdvanceBatch pacing guards', () => {
    it('allows only ONE clock gain per cadence — the second +1 keeps its symptom but holds the clock', () => {
        const fronts = [baseFront({ id: 'front-a' }), baseFront({ id: 'front-b', title: 'The Grey Choir', clock: 1 })];
        const { fronts: next, appliedCount } = applyFrontAdvanceBatch(fronts, {
            cadenceId: 'cad-1',
            advances: [
                { id: 'front-a', delta: 1, symptom: 'Nets come up cut', reason: 'unchecked' },
                { id: 'front-b', delta: 1, symptom: 'A low humming at night', reason: 'unchecked' },
            ],
        });
        expect(appliedCount).toBe(2);
        expect(next[0].clock).toBe(3);
        expect(next[1].clock).toBe(1); // gain slot spent by front-a
        expect(next[1].publicHints).toContain('A low humming at night'); // symptom still lands
    });

    it('a front that gained clock last cadence sits this one out', () => {
        const front = baseFront({ lastAdvanceId: 'cad-1', lastAdvanceDelta: 1 });
        const { fronts: next } = applyFrontAdvanceBatch([front], {
            cadenceId: 'cad-2',
            previousCadenceId: 'cad-1',
            advances: [{ id: 'front-a', delta: 1, symptom: '', reason: '' }],
        });
        expect(next[0].clock).toBe(2); // unchanged
    });

    it('softening (-1) is never throttled, even after a previous-cadence gain', () => {
        const front = baseFront({ lastAdvanceId: 'cad-1', lastAdvanceDelta: 1, clock: 3 });
        const { fronts: next } = applyFrontAdvanceBatch([front], {
            cadenceId: 'cad-2',
            previousCadenceId: 'cad-1',
            advances: [{ id: 'front-a', delta: -1, symptom: '', reason: 'the hero burned the ledgers' }],
        });
        expect(next[0].clock).toBe(2);
    });

    it('an at-cap gain leaves the cadence gain slot for another front', () => {
        const fronts = [
            baseFront({ id: 'front-a', clock: 6, maxClock: 6 }),
            baseFront({ id: 'front-b', title: 'The Grey Choir', clock: 1 }),
        ];
        const { fronts: next } = applyFrontAdvanceBatch(fronts, {
            cadenceId: 'cad-1',
            advances: [
                { id: 'front-a', delta: 1, symptom: '', reason: '' },
                { id: 'front-b', delta: 1, symptom: '', reason: '' },
            ],
        });
        expect(next[0].clock).toBe(6);
        expect(next[1].clock).toBe(2); // slot handed off
    });

    it('replayed cadence batches are inert per front (lastAdvanceId match)', () => {
        const front = baseFront({ lastAdvanceId: 'cad-1' });
        const { fronts: next, appliedCount } = applyFrontAdvanceBatch([front], {
            cadenceId: 'cad-1',
            advances: [{ id: 'front-a', delta: 1, symptom: 'again', reason: '' }],
        });
        expect(appliedCount).toBe(0);
        expect(next[0]).toBe(front);
    });

    it('skips dormant and resolved fronts', () => {
        const fronts = [baseFront({ status: 'dormant' }), baseFront({ id: 'front-r', status: 'resolved' })];
        const { appliedCount } = applyFrontAdvanceBatch(fronts, {
            cadenceId: 'cad-1',
            advances: [
                { id: 'front-a', delta: 1, symptom: '', reason: '' },
                { id: 'front-r', delta: 1, symptom: '', reason: '' },
            ],
        });
        expect(appliedCount).toBe(0);
    });
});

describe('normalizeEmergentFront (complete-or-nothing)', () => {
    const proposal = {
        title: 'The Drowned Choir',
        goal: 'Claim the tide caves',
        stakes: 'The caves become a shrine of drownings',
        grimPortents: ['Singing from the caves', 'A fisher walks into the sea', 'A festival is claimed'],
        faction: { name: 'The Drowned Choir', goal: 'Grow the congregation' },
    };

    it('accepts a complete proposal, born at clock 0 / stage 0 / active', () => {
        const front = normalizeEmergentFront(proposal);
        expect(front).toMatchObject({ clock: 0, stage: 0, status: 'active', title: 'The Drowned Choir' });
    });

    it.each([
        ['title', { ...proposal, title: '' }],
        ['goal', { ...proposal, goal: '' }],
        ['stakes', { ...proposal, stakes: '' }],
        ['portents < 3', { ...proposal, grimPortents: ['one', 'two'] }],
        ['faction', { ...proposal, faction: null }],
        ['faction goal', { ...proposal, faction: { name: 'X' } }],
    ])('rejects a proposal missing %s', (_label, bad) => {
        expect(normalizeEmergentFront(bad)).toBeNull();
    });

    it('dedupes against existing fronts by title OR faction name', () => {
        const existing = [baseFront({ title: 'The Drowned Choir' })];
        expect(normalizeEmergentFront(proposal, existing)).toBeNull();
        const byFaction = [baseFront({ title: 'Other', faction: { name: 'The Drowned Choir', goal: 'x' } })];
        expect(normalizeEmergentFront(proposal, byFaction)).toBeNull();
    });
});

describe('normalizeFrontUpdate', () => {
    it('needs an id or title and clamps numeric fields', () => {
        expect(normalizeFrontUpdate({})).toBeNull();
        expect(normalizeFrontUpdate({ clock: 5 })).toBeNull();
        const update = normalizeFrontUpdate({ id: 'front-a', clock: 99, stage: -4, notes: 'x'.repeat(600) });
        expect(update.clock).toBe(12);
        expect(update.stage).toBe(0);
        expect(update.notes).toHaveLength(500);
    });

    it('maps completed to resolved', () => {
        expect(normalizeFrontUpdate({ id: 'f', status: 'completed' }).status).toBe('resolved');
    });
});

describe('normalizeFront field persistence', () => {
    it('keeps resolvedAtMessage/resolution and the DM gain stamp across re-normalization (reload path)', () => {
        const front = normalizeFront({
            ...baseFront(),
            status: 'resolved',
            resolvedAtMessage: 42,
            resolution: 'burned to the waterline',
            lastDmClockGainMessage: 37,
        });
        const reloaded = normalizeFront(front);
        expect(reloaded.resolvedAtMessage).toBe(42);
        expect(reloaded.resolution).toBe('burned to the waterline');
        expect(reloaded.lastDmClockGainMessage).toBe(37);
    });
});

describe('normalizeFaction (the ONE faction sanitizer, 2026-08-26)', () => {
    it('caps relationships at 4 and requires only a name', () => {
        const faction = normalizeFaction({
            name: 'The Salt Barons',
            relationships: ['a', 'b', 'c', 'd', 'e', 'f'],
        });
        expect(faction.relationships).toHaveLength(4);
        expect(faction.goal).toBe('');
        expect(normalizeFaction({ goal: 'no name' })).toBeNull();
    });
});

describe('buildFrontResolutionFact / createInitialFronts', () => {
    it('mints the title-revealing canon fact with the note folded in', () => {
        const fact = buildFrontResolutionFact(baseFront(), 'The baron drowned in his own brine vats.');
        expect(fact).toContain('"The Salt Baron"');
        expect(fact).toContain('brine vats');
    });

    it('anchors the fallback front to a premise place, never the hero', () => {
        const [front] = createInitialFronts({
            premise: 'Katla the Red arrives in Brackwater chasing a debt.',
            character: { name: 'Katla the Red' },
        });
        expect(front.title).toContain('Brackwater');
        expect(front.clock).toBe(0);
        expect(front.maxClock).toBe(DEFAULT_MAX_CLOCK);
    });
});
