/**
 * The third notation axis (2026-09-09 audit P1): count and sides were bounded,
 * the modifier was not — "1d6+1000000" parsed and a 400-digit modifier parsed
 * to Infinity, which the 09-01 rollWithModifier guard turned into a THROW that
 * escaped every fallback caller. The bound lives in parseNotation so the
 * failure happens INSIDE rollDamage's wrapped parse.
 */
import { describe, expect, it } from 'vitest';
import { MAX_ROLL_MODIFIER, parseNotation, rollNotation } from './dice.ts';

describe('parseNotation modifier bound', () => {
  it('rejects a 400-digit modifier (parseInt → Infinity) as malformed notation', () => {
    expect(() => parseNotation(`1d6+${'9'.repeat(400)}`)).toThrow(/Invalid dice notation/);
    expect(() => parseNotation(`1d6-${'9'.repeat(400)}`)).toThrow(/Invalid dice notation/);
  });

  it('rejects an absurd finite modifier on either side of zero', () => {
    expect(() => parseNotation('1d6+1000000')).toThrow(/Invalid dice notation/);
    expect(() => parseNotation(`1d6+${MAX_ROLL_MODIFIER + 1}`)).toThrow(/Invalid dice notation/);
    expect(() => parseNotation(`1d6-${MAX_ROLL_MODIFIER + 1}`)).toThrow(/Invalid dice notation/);
  });

  it('keeps every real modifier, including the bound itself', () => {
    expect(parseNotation('1d6+0').modifier).toBe(0);
    expect(parseNotation('2d6+8').modifier).toBe(8);
    expect(parseNotation('1d20-3').modifier).toBe(-3);
    expect(parseNotation(`1d6+${MAX_ROLL_MODIFIER}`).modifier).toBe(MAX_ROLL_MODIFIER);
    expect(parseNotation(`1d6-${MAX_ROLL_MODIFIER}`).modifier).toBe(-MAX_ROLL_MODIFIER);
  });

  it('rollNotation throws the notation error, never "Invalid roll modifier"', () => {
    expect(() => rollNotation(`1d6+${'9'.repeat(400)}`)).toThrow(/Invalid dice notation/);
  });
});
