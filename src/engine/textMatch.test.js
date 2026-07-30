import { describe, it, expect } from 'vitest';
import { containment, coverage, overlapCount, tokenSet } from './textMatch.js';

describe('tokenSet', () => {
    it('keeps non-ASCII tokens intact (the old story-memory tokenizer dropped them)', () => {
        const tokens = tokenSet('Virtapää owes Jyrki a blood-debt', { minLength: 3 });
        expect(tokens.has('virtapää')).toBe(true);
        expect(tokens.has('jyrki')).toBe(true);
        expect(tokens.has('blood')).toBe(true);
        expect(tokens.has('debt')).toBe(true);
    });

    it('folds possessives so "Jack\'s promise" matches "Jack, the promise"', () => {
        const a = tokenSet("Jack's promise", { minLength: 3, foldPossessives: true });
        const b = tokenSet('Jack, the promise', { minLength: 3, foldPossessives: true });
        expect(a.has('jack')).toBe(true);
        expect(containment(a, b)).toBe(1);
        // Curly apostrophe folds the same way.
        expect(tokenSet('Virtapää’s oath', { foldPossessives: true }).has('virtapää')).toBe(true);
    });

    it('applies stop words and minimum length per caller', () => {
        const stopWords = new Set(['the', 'of']);
        const tokens = tokenSet('the Gate of Ash', { stopWords, minLength: 3 });
        expect([...tokens].sort()).toEqual(['ash', 'gate']);
    });
});

describe('containment / coverage', () => {
    it('scores the smaller set against the larger, restatement-style', () => {
        const small = tokenSet('Odo is dead');
        const large = tokenSet('Odo is dead, killed at the docks');
        expect(containment(small, large)).toBe(1);
        expect(containment(large, small)).toBe(1); // symmetric
        expect(coverage(large, small)).toBeLessThan(1); // directional
    });

    it('returns 0 for empty sets so callers own their empty-set policy', () => {
        expect(containment(new Set(), tokenSet('anything'))).toBe(0);
        expect(coverage(new Set(), tokenSet('anything'))).toBe(0);
        expect(overlapCount(new Set(), new Set(['a']))).toBe(0);
    });
});
