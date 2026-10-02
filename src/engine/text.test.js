import { describe, expect, it } from 'vitest';
import { cleanText, textOr } from './text.js';

describe('engine/text — the one text-typing shelf (2026-10-02)', () => {
    it('collapses whitespace, trims, and clamps', () => {
        expect(cleanText('  the   weir\n wardens\t')).toBe('the weir wardens');
        expect(cleanText('the weir wardens', 8)).toBe('the weir');
        expect(cleanText(42)).toBe('42');
    });

    it.each([null, undefined, {}, ['a', 'b'], true, NaN, Infinity, () => 'x'])('is type-strict: %j carries no text', (junk) => {
        expect(cleanText(junk)).toBe('');
        expect(textOr(junk, 'fallback')).toBe('fallback');
    });

    it('textOr keeps real text and falls back on empty', () => {
        expect(textOr('  Brackwater ', 'the starting region')).toBe('Brackwater');
        expect(textOr('   ', 'the starting region')).toBe('the starting region');
        expect(textOr('')).toBe('');
    });
});
