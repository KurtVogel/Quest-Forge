/**
 * Hostile-input robustness for the front sanitizers (2026-09-08 hidden-fronts
 * audit, Lap 2): junk means OMIT in normalizeFrontUpdate, type-strict text,
 * and textual clamps in normalizeFront.
 */
import { describe, expect, it } from 'vitest';
import { buildFrontResolutionFact, normalizeFront, normalizeFrontUpdate } from './fronts.js';

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

describe('junk means omit in normalizeFrontUpdate (P1/P2)', () => {
    it('drops a non-numeric clock/stage instead of reading it as 0', () => {
        for (const junk of [null, '', 'unchanged', 'same', 'n/a', {}, [], true]) {
            const update = normalizeFrontUpdate({ id: 'front-a', clock: junk, stage: junk, notes: 'no change' });
            expect(update).not.toHaveProperty('clock');
            expect(update).not.toHaveProperty('stage');
            expect(update.notes).toBe('no change');
        }
        expect(normalizeFrontUpdate({ id: 'front-a', clock: '3', stage: 2 })).toMatchObject({ clock: 3, stage: 2 });
        expect(normalizeFrontUpdate({ id: 'front-a', clock: 0 })).toMatchObject({ clock: 0 });
    });

    it('drops an unknown or null status instead of normalizing it to active', () => {
        for (const junk of [null, '', 'ongoing', 'escalating', 42, {}]) {
            expect(normalizeFrontUpdate({ id: 'front-a', status: junk })).not.toHaveProperty('status');
        }
        expect(normalizeFrontUpdate({ id: 'front-a', status: 'completed' }).status).toBe('resolved');
        expect(normalizeFrontUpdate({ id: 'front-a', status: 'Dormant' }).status).toBe('dormant');
    });

    it('wraps a single string hint, and omits an empty or junk hint list rather than wiping the ledger', () => {
        expect(normalizeFrontUpdate({ id: 'front-a', publicHints: 'Refugees whisper' }).publicHints).toEqual(['Refugees whisper']);
        expect(normalizeFrontUpdate({ id: 'front-a', public_hints: 'Refugees whisper' }).publicHints).toEqual(['Refugees whisper']);
        for (const junk of [[], 42, {}, [null, {}, '']]) {
            expect(normalizeFrontUpdate({ id: 'front-a', publicHints: junk })).not.toHaveProperty('publicHints');
        }
    });

    it('never coerces an object notes/title into "[object Object]"', () => {
        const update = normalizeFrontUpdate({ id: 'front-a', notes: { how: 'burned' }, title: ['x'] });
        expect(update).not.toHaveProperty('notes');
        expect(update).not.toHaveProperty('title');
        expect(normalizeFrontUpdate({ id: { nested: true } })).toBeNull();
        expect(normalizeFrontUpdate(['front-a'])).toBeNull();
        const fact = buildFrontResolutionFact(baseFront(), { how: 'burned' });
        expect(fact).not.toContain('[object Object]');
        expect(fact).toContain('"The Salt Baron"');
    });
});

describe('normalizeFront textual clamps and type strictness (P2)', () => {
    it('clamps id/title/goal/stakes/notes and every hint on load', () => {
        const front = normalizeFront({
            id: 'a'.repeat(1000),
            title: 't'.repeat(20000),
            goal: 'g'.repeat(1000),
            stakes: 's'.repeat(1000),
            notes: 'n'.repeat(1000),
            publicHints: ['h'.repeat(1000)],
            grimPortents: ['p'.repeat(1000), 'q', 'r'],
        });
        expect(front.id).toHaveLength(120);
        expect(front.title).toHaveLength(160);
        expect(front.goal).toHaveLength(400);
        expect(front.stakes).toHaveLength(400);
        expect(front.notes).toHaveLength(500);
        expect(front.publicHints[0]).toHaveLength(240);
        expect(front.grimPortents[0]).toHaveLength(240);
    });

    it('treats object-shaped text fields as absent', () => {
        const front = normalizeFront({ id: 'front-a', title: { x: 1 }, goal: ['g'], notes: { how: 'burned' }, publicHints: [{ a: 1 }, 'real hint'] });
        expect(front.title).toBe('Unnamed Front');
        expect(front.goal).toBe('A hidden threat advances its agenda.');
        expect(front.notes).toBe('');
        expect(front.publicHints).toEqual(['real hint']);
    });
});
