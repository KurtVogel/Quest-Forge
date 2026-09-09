/**
 * normalizeNpcRecord types the identity/looks fields and routes the portrait
 * through the shared allowlist (2026-09-09 audit P1/P2): an object appearance,
 * an array gender, or a numeric species survived to composeScenePrompt and
 * threw (or joined "[object Object]" into the painter's prompt).
 */
import { describe, expect, it } from 'vitest';
import { normalizeNpcRecord } from './npcRoster.js';
import { sanitizePortraitUrl } from './portraitUrl.js';

describe('normalizeNpcRecord identity typing', () => {
    it('drops non-string appearance/gender/species instead of carrying them', () => {
        const npc = normalizeNpcRecord({ name: 'Maren', rosterTier: 'character', appearance: { look: 'x' }, gender: ['f'], species: 5 });
        expect(npc.appearance).toBeUndefined();
        expect(npc.gender).toBeUndefined();
        expect(npc.species).toBeUndefined();
    });

    it('trims and clamps string fields; the legacy path gets the same treatment', () => {
        const npc = normalizeNpcRecord({ name: 'Maren', appearance: `  ${'a'.repeat(700)} `, gender: ' woman ', species: 'goblin' });
        expect(npc.appearance).toHaveLength(600);
        expect(npc.gender).toBe('woman');
        expect(npc.species).toBe('goblin');
    });

    it('applies the shared portrait allowlist and drops a tracker URL', () => {
        const bad = normalizeNpcRecord({ name: 'Maren', portraitUrl: 'https://tracker.example/pixel.png' });
        expect(bad.portraitUrl).toBeUndefined();
        const good = normalizeNpcRecord({ name: 'Maren', portraitUrl: ' data:image/png;base64,abc== ' });
        expect(good.portraitUrl).toBe('data:image/png;base64,abc==');
    });
});

describe('sanitizePortraitUrl (THE allowlist)', () => {
    it('accepts inline image data URLs and Pollinations prompt URLs only', () => {
        expect(sanitizePortraitUrl('data:image/jpeg;base64,abc123==')).toBe('data:image/jpeg;base64,abc123==');
        expect(sanitizePortraitUrl('https://image.pollinations.ai/prompt/a%20scene?width=768&seed=1')).toContain('pollinations');
        expect(sanitizePortraitUrl('data:text/html;base64,PHNjcmlwdD4=')).toBe('');
        expect(sanitizePortraitUrl('data:image/png;base64,[object Object]')).toBe('');
        expect(sanitizePortraitUrl('https://tracker.example/pixel.png')).toBe('');
        expect(sanitizePortraitUrl('javascript:alert(1)')).toBe('');
        expect(sanitizePortraitUrl({ url: 'data:image/png;base64,abc' })).toBe('');
        expect(sanitizePortraitUrl(`data:image/png;base64,${'a'.repeat(300_001)}`)).toBe('');
    });
});
