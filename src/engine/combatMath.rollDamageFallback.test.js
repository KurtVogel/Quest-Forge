/**
 * rollDamage's 'fallback' mode is the contract every combat caller relies on:
 * a bad notation degrades to 1d4, never throws (2026-09-09 audit P1 — the
 * 400-digit-modifier shape escaped the wrapped parse and threw out of
 * planCombatExchange via a companion's damage string).
 */
import { describe, expect, it } from 'vitest';
import { rollDamage } from './combatMath.js';

const JUNK = [
    `1d6+${'9'.repeat(400)}`,
    '1d6+1000000',
    '1d6-1000000',
    '9999999d6',
    '1d999999999',
    '0d6',
    '1d0',
    '',
    'abc',
    null,
    undefined,
    { count: 1 },
];

describe('rollDamage fallback mode never throws', () => {
    it.each(JUNK.map(n => [n]))('degrades %j to a plain 1d4', (notation) => {
        const result = rollDamage(notation, 'junk damage');
        expect(result.total).toBeGreaterThanOrEqual(1);
        expect(result.total).toBeLessThanOrEqual(4);
        expect(result.notation).toBe('1d4');
        expect(result.roll.rolls).toHaveLength(1);
        expect(result.roll.modifier).toBe(0);
    });

    it('throw mode still propagates for callers whose error path is the contract', () => {
        expect(() => rollDamage(`1d6+${'9'.repeat(400)}`, 'x', { onInvalid: 'throw' })).toThrow(/Invalid dice notation/);
        expect(() => rollDamage('1d6+1000000', 'x', { onInvalid: 'throw' })).toThrow(/Invalid dice notation/);
    });
});
