/**
 * The 2026-11-05 strengthening queue, dice half: ONE tolerant notation reader
 * (count-less `d8`, a trailing damage word) read by the three notation
 * boundaries before their own bands; `rollWithModifier` bounds the modifier
 * magnitude like `parseNotation`; and a LOADED roll's faces list, modifier,
 * total and natural flags are bounded / re-derived.
 */
import { describe, expect, it } from 'vitest';
import { MAX_DICE_COUNT, MAX_ROLL_MODIFIER, normalizeDiceNotation, parseNotation, rollWithModifier } from './dice.ts';
import { sanitizeEnemyDamage } from './enemyStats.js';
import { boundHealingNotation } from '../data/items.js';
import { sanitizeRollHistoryEntry } from '../state/handlers/shared.js';

describe('one tolerant notation reader, three boundaries (dice-engine 10-31 P2)', () => {
    it('reads the count-less shorthand and drops a trailing damage word', () => {
        expect(normalizeDiceNotation('d8')).toMatchObject({ notation: '1d8', count: 1, sides: 8, modifier: 0, suffix: '' });
        expect(normalizeDiceNotation(' D8 + 2 ')).toMatchObject({ notation: '1d8+2', modifier: 2 });
        expect(normalizeDiceNotation('2d6 + 3 fire')).toMatchObject({ notation: '2d6+3', suffix: 'fire' });
        expect(normalizeDiceNotation('1d8+2, plus 1d6 poison')).toBeNull();
        expect(normalizeDiceNotation('dagger')).toBeNull();
        expect(normalizeDiceNotation(8)).toBeNull();
    });

    it('three-way parity: the enemy lane, the healing lane and parseNotation read the same notation', () => {
        const cases = [
            ['d8', '1d8', { count: 1, sides: 8, modifier: 0 }],
            ['d8+2', '1d8+2', { count: 1, sides: 8, modifier: 2 }],
            ['2d6 + 3 fire', '2d6+3', { count: 2, sides: 6, modifier: 3 }],
            ['2d4+2', '2d4+2', { count: 2, sides: 4, modifier: 2 }],
        ];
        for (const [written, canonical, parsed] of cases) {
            expect(sanitizeEnemyDamage(written), written).toBe(canonical);
            expect(boundHealingNotation(written), written).toBe(canonical);
            expect(parseNotation(written), written).toEqual(parsed);
        }
    });

    it('each boundary keeps its OWN band after the shared read', () => {
        expect(sanitizeEnemyDamage('d20')).toBeUndefined(); // not a damage die
        expect(boundHealingNotation('d20')).toBe('2d4+2'); // over the healing die cap
        expect(parseNotation('d20')).toEqual({ count: 1, sides: 20, modifier: 0 });
        expect(() => parseNotation('9999999d6')).toThrow();
        expect(() => parseNotation(`1d6+${'9'.repeat(400)}`)).toThrow();
        expect(() => parseNotation('0d6')).toThrow();
        expect(boundHealingNotation('2d4-1')).toBe('2d4+2'); // a negative heal bonus still falls back
    });
});

describe('rollWithModifier bounds the modifier magnitude (rules-math 11-04 nit c)', () => {
    it('refuses past MAX_ROLL_MODIFIER exactly as parseNotation does', () => {
        expect(() => rollWithModifier(1, 20, 1e300)).toThrow(/Invalid roll modifier/);
        expect(() => rollWithModifier(1, 20, -(MAX_ROLL_MODIFIER + 1))).toThrow(/Invalid roll modifier/);
        expect(rollWithModifier(1, 20, MAX_ROLL_MODIFIER).modifier).toBe(MAX_ROLL_MODIFIER);
        expect(() => parseNotation(`1d20+${MAX_ROLL_MODIFIER + 1}`)).toThrow();
    });
});

describe('a LOADED roll is bounded and its natural flags re-derived (dice-engine 10-31 P2)', () => {
    it('caps the faces list, clamps the modifier and recomputes an out-of-band total', () => {
        const row = sanitizeRollHistoryEntry({ notation: '2d6', rolls: Array(100000).fill(6), modifier: 1e300, total: 1e300 });
        expect(row.rolls).toHaveLength(MAX_DICE_COUNT * 2);
        expect(row.modifier).toBe(MAX_ROLL_MODIFIER);
        expect(row.total).toBe(6 * MAX_DICE_COUNT * 2 + MAX_ROLL_MODIFIER);
        expect(sanitizeRollHistoryEntry({ notation: '1d20+5', rolls: [12], modifier: 5, total: 1e12 }).total).toBe(17);
        // An in-band stored total is kept as it was.
        expect(sanitizeRollHistoryEntry({ notation: '1d20+5', rolls: [12], modifier: 5, total: 17 }).total).toBe(17);
    });

    it('a 2d6 row is never a natural 20 or a natural 1, whatever its flags say', () => {
        const row = sanitizeRollHistoryEntry({ notation: '2d6', rolls: [6, 6], modifier: 0, total: 12, isCritical: true, isCritFail: true });
        expect(row).toMatchObject({ isCritical: false, isCritFail: false });
        const d6 = sanitizeRollHistoryEntry({ notation: '1d6', rolls: [1], isCritFail: true });
        expect(d6.isCritFail).toBe(false);
    });

    it('a single d20 face derives the flags; the Champion 19 stands only as an attack stamp', () => {
        expect(sanitizeRollHistoryEntry({ notation: '1d20+3', rolls: [20], modifier: 3, isCritical: false })).toMatchObject({ isCritical: true, isCritFail: false });
        expect(sanitizeRollHistoryEntry({ notation: '1d20+3', rolls: [1], modifier: 3 })).toMatchObject({ isCritical: false, isCritFail: true });
        expect(sanitizeRollHistoryEntry({ notation: '1d20+3', rolls: [12], modifier: 3, isCritical: true })).toMatchObject({ isCritical: false });
        const champion = { notation: '1d20+5', rolls: [19], modifier: 5, isCritical: true, kind: 'attack', criticalThreshold: 'Champion 19-20' };
        expect(sanitizeRollHistoryEntry(champion)).toMatchObject({ isCritical: true, kind: 'attack', criticalThreshold: 'Champion 19-20' });
        const checkNineteen = { ...champion, kind: undefined };
        expect(sanitizeRollHistoryEntry(checkNineteen).isCritical).toBe(false);
        expect(sanitizeRollHistoryEntry(checkNineteen).criticalThreshold).toBeUndefined();
        expect(sanitizeRollHistoryEntry({ ...champion, rolls: [17] }).isCritical).toBe(false);
        const helpless = { notation: '1d20+5', rolls: [9], modifier: 5, isCritical: true, kind: 'attack', criticalThreshold: 'helpless target' };
        expect(sanitizeRollHistoryEntry(helpless)).toMatchObject({ isCritical: true, criticalThreshold: 'helpless target' });
    });
});
