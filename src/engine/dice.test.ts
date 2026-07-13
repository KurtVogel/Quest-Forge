/**
 * Direct tests for the real crypto-dice engine — the project's "the LLM can't
 * cheat the dice" guarantee. Every other combat/roll test file mocks this module
 * away, so these are the only tests exercising the actual implementation.
 */
import { describe, expect, it } from 'vitest';
import {
    DIE_TYPES,
    parseNotation,
    rollDie,
    rollDice,
    rollNotation,
    rollSavingThrow,
    rollSkillCheck,
    rollWithModifier,
} from './dice.ts';

describe('rollDie', () => {
    it('stays within [1, sides] for every standard die over many rolls', () => {
        for (const sides of DIE_TYPES) {
            for (let i = 0; i < 200; i++) {
                const roll = rollDie(sides);
                expect(Number.isInteger(roll)).toBe(true);
                expect(roll).toBeGreaterThanOrEqual(1);
                expect(roll).toBeLessThanOrEqual(sides);
            }
        }
    });

    it('covers the full face range of a small die', () => {
        const seen = new Set<number>();
        for (let i = 0; i < 500; i++) seen.add(rollDie(4));
        expect([...seen].sort()).toEqual([1, 2, 3, 4]);
    });

    it('throws on zero, negative, and non-integer sides instead of yielding NaN', () => {
        expect(() => rollDie(0)).toThrow(/Invalid die/);
        expect(() => rollDie(-6)).toThrow(/Invalid die/);
        expect(() => rollDie(2.5)).toThrow(/Invalid die/);
        expect(() => rollDie(NaN)).toThrow(/Invalid die/);
    });
});

describe('rollDice / rollWithModifier', () => {
    it('rolls the requested number of dice and sums them with the modifier', () => {
        const result = rollWithModifier(3, 6, 2, 'test');
        expect(result.rolls).toHaveLength(3);
        expect(result.subtotal).toBe(result.rolls.reduce((a, b) => a + b, 0));
        expect(result.total).toBe(result.subtotal + 2);
        expect(result.notation).toBe('3d6+2');
        expect(Number.isFinite(result.total)).toBe(true);
    });

    it('formats negative modifiers into the notation', () => {
        const result = rollWithModifier(1, 8, -1);
        expect(result.notation).toBe('1d8-1');
        expect(result.total).toBe(result.rolls[0] - 1);
    });

    it('flags critical and crit-fail only on a single d20', () => {
        // Roll until both extremes have been observed (bounded to keep the test fast).
        let sawCrit = false;
        let sawCritFail = false;
        for (let i = 0; i < 2000 && !(sawCrit && sawCritFail); i++) {
            const result = rollWithModifier(1, 20, 0);
            if (result.rolls[0] === 20) {
                expect(result.isCritical).toBe(true);
                sawCrit = true;
            }
            if (result.rolls[0] === 1) {
                expect(result.isCritFail).toBe(true);
                sawCritFail = true;
            }
            if (result.rolls[0] !== 20) expect(result.isCritical).toBe(false);
            if (result.rolls[0] !== 1) expect(result.isCritFail).toBe(false);
        }
        expect(sawCrit && sawCritFail).toBe(true);
    });

    it('never flags crits on multi-die or non-d20 rolls', () => {
        const twoD20 = rollWithModifier(2, 20, 0);
        expect(twoD20.isCritical).toBe(false);
        expect(twoD20.isCritFail).toBe(false);
        const d12 = rollWithModifier(1, 12, 0);
        expect(d12.isCritical).toBe(false);
        expect(d12.isCritFail).toBe(false);
    });

    it('assigns unique roll ids', () => {
        const a = rollWithModifier(1, 6);
        const b = rollWithModifier(1, 6);
        expect(a.id).not.toBe(b.id);
    });
});

describe('parseNotation', () => {
    it('parses count, sides, and signed modifiers', () => {
        expect(parseNotation('2d6+3')).toEqual({ count: 2, sides: 6, modifier: 3 });
        expect(parseNotation('1d20')).toEqual({ count: 1, sides: 20, modifier: 0 });
        expect(parseNotation('3d8-1')).toEqual({ count: 3, sides: 8, modifier: -1 });
    });

    it('tolerates whitespace and uppercase', () => {
        expect(parseNotation(' 2 D 6 + 3 ')).toEqual({ count: 2, sides: 6, modifier: 3 });
        expect(parseNotation('1D12')).toEqual({ count: 1, sides: 12, modifier: 0 });
    });

    it('rejects malformed notations', () => {
        for (const bad of ['d20', '2d', 'abc', '', '2d6+', '1d6+2d4', '-1d6']) {
            expect(() => parseNotation(bad)).toThrow(/Invalid dice notation/);
        }
    });

    it('rejects zero-sided and zero-count notations instead of yielding NaN rolls', () => {
        expect(() => parseNotation('1d0')).toThrow(/Invalid dice notation/);
        expect(() => parseNotation('0d6')).toThrow(/Invalid dice notation/);
        expect(() => parseNotation('0d0')).toThrow(/Invalid dice notation/);
    });
});

describe('rollNotation', () => {
    it('rolls end-to-end from a notation string with finite results', () => {
        const result = rollNotation('2d6+3', 'Greatsword damage');
        expect(result.rolls).toHaveLength(2);
        expect(result.modifier).toBe(3);
        expect(result.total).toBeGreaterThanOrEqual(5); // 1+1+3
        expect(result.total).toBeLessThanOrEqual(15);   // 6+6+3
        expect(result.description).toBe('Greatsword damage');
    });

    it('propagates notation validation', () => {
        expect(() => rollNotation('1d0')).toThrow(/Invalid dice notation/);
    });
});

describe('check helpers', () => {
    it('applies proficiency only when proficient', () => {
        const proficient = rollSkillCheck(3, 2, true);
        expect(proficient.modifier).toBe(5);
        const notProficient = rollSkillCheck(3, 2, false);
        expect(notProficient.modifier).toBe(3);
        const save = rollSavingThrow(1, 2, true);
        expect(save.modifier).toBe(3);
    });

    it('rollDice returns exactly count results in range', () => {
        const rolls = rollDice(10, 8);
        expect(rolls).toHaveLength(10);
        for (const roll of rolls) {
            expect(roll).toBeGreaterThanOrEqual(1);
            expect(roll).toBeLessThanOrEqual(8);
        }
    });
});
