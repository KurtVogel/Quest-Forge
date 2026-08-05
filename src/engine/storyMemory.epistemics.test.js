/**
 * Epistemics layer (DECISIONS.md 2026-08-05 ×2): knownBy/witnessed on story
 * cards, the SECRET tag, and boundary rendering in the callback block.
 */
import { describe, expect, it } from 'vitest';
import {
    buildStoryMemoryPromptBlock,
    formatSecrecyTag,
    normalizeKnownBy,
    normalizeStoryMemoryCard,
} from './storyMemory.js';

describe('normalizeKnownBy', () => {
    it('keeps a bounded knower list and clears any public-style entry', () => {
        expect(normalizeKnownBy(['Marta', 'the hero'])).toEqual(['Marta', 'the hero']);
        expect(normalizeKnownBy(['Marta', 'everyone'])).toEqual([]);
        expect(normalizeKnownBy(['PUBLIC'])).toEqual([]);
        expect(normalizeKnownBy('not-an-array')).toEqual([]);
        expect(normalizeKnownBy(null)).toEqual([]);
    });
});

describe('formatSecrecyTag', () => {
    it('prefixes secrets and stays silent for common knowledge', () => {
        expect(formatSecrecyTag(['Marta', 'the hero'])).toBe('[SECRET — known only to: Marta, the hero] ');
        expect(formatSecrecyTag([])).toBe('');
        expect(formatSecrecyTag(undefined)).toBe('');
    });
});

describe('story card epistemics fields', () => {
    it('carries knownBy and witnessed as conditional keys', () => {
        const secret = normalizeStoryMemoryCard({
            text: 'Confessed the forged deed to Marta in the cellar',
            type: 'promise',
            knownBy: ['Marta', 'the hero'],
        });
        expect(secret.knownBy).toEqual(['Marta', 'the hero']);
        expect(secret.witnessed).toBeUndefined();

        const publicCard = normalizeStoryMemoryCard({
            text: 'Accused the magistrate of theft before the whole market',
            type: 'callback',
            witnessed: true,
        });
        expect(publicCard.witnessed).toBe(true);
        expect(publicCard.knownBy).toBeUndefined();
    });

    it('an update that omits the fields keeps stored values through the merge spread', () => {
        const secret = normalizeStoryMemoryCard({
            text: 'Confessed the forged deed to Marta',
            knownBy: ['Marta'],
            witnessed: false,
            firstSeenMessage: 12,
        });
        const update = normalizeStoryMemoryCard({ text: 'Confessed the forged deed to Marta, twice now' });
        // The reducer merge path: {...existing, ...update} — update has no
        // knownBy/firstSeenMessage keys, so the stored ones survive.
        const merged = normalizeStoryMemoryCard({ ...secret, ...update });
        expect(merged.knownBy).toEqual(['Marta']);
        expect(merged.firstSeenMessage).toBe(12);
    });
});

describe('secret rendering in the callback block', () => {
    it('tags secret cards and states the boundary', () => {
        const block = buildStoryMemoryPromptBlock([
            normalizeStoryMemoryCard({ text: 'Owes the ferryman a favor', type: 'promise', salience: 3 }),
            normalizeStoryMemoryCard({ text: 'Plans to rob the tithe wagon', type: 'playerCanon', salience: 4, knownBy: ['the hero'] }),
        ]);
        expect(block).toContain('[SECRET — known only to: the hero] ');
        expect(block).toContain('known ONLY to the people listed');
        expect(block.indexOf('Owes the ferryman')).toBeGreaterThan(-1);
        expect(block).not.toContain('[SECRET — known only to: ] ');
    });
});
