/**
 * Identity lock for generated art (2026-09-12): the features image models
 * drift on first — skin tone, hair state (baldness included), build, age —
 * are extracted deterministically from the appearance record and stated in
 * the least ambiguous wording, never inferred. A recorded "black, statuesque,
 * bald woman" was coming back as a pale heavy figure or with cornrows.
 */
import { describe, expect, it } from 'vitest';
import { buildIdentityLockLine, extractIdentityLocks, IDENTITY_LOCK_REMINDER } from './appearanceIdentity.js';

describe('extractIdentityLocks', () => {
    it('reads the reported case: a tall, statuesque Black woman with a shaved head', () => {
        const locks = extractIdentityLocks('A tall, statuesque Black woman with a shaved head and a chipped front tooth, in a salt-stained oilskin.');
        expect(locks.skin).toBe('deep dark brown skin');
        expect(locks.hair).toMatch(/^completely bald/);
        expect(locks.hair).toContain('no cornrows');
        expect(locks.build).toBe('tall, statuesque build');
        expect(locks.age).toBe('');
    });

    it('never reads a hair color as a skin tone', () => {
        expect(extractIdentityLocks('Long black hair, pale grey eyes.').skin).toBe('');
        expect(extractIdentityLocks('White hair cropped short, a weathered face.').skin).toBe('');
        expect(extractIdentityLocks('Long black hair, pale grey eyes.').hair).toBe('long black hair as recorded');
    });

    it('normalizes the skin-tone families and keeps hair phrases with their descriptors', () => {
        expect(extractIdentityLocks('Dark-skinned and lean, with tight grey cornrows.').skin).toBe('deep dark brown skin');
        expect(extractIdentityLocks('Dark-skinned and lean, with tight grey cornrows.').hair).toBe('tight grey cornrows as recorded');
        expect(extractIdentityLocks('Olive-skinned, a scar through one brow.').skin).toBe('olive skin');
        expect(extractIdentityLocks('Pale as milk, freckled, red curls.').skin).toBe('');
        expect(extractIdentityLocks('Pale-skinned, freckled, red curls.').skin).toBe('pale skin');
        expect(extractIdentityLocks('Pale-skinned, freckled, red curls.').hair).toBe('red curls as recorded');
        expect(extractIdentityLocks('Green-skinned goblin, wiry, with a topknot.').skin).toBe('green skin');
    });

    it('bald wins over any hair phrase and balding is its own state', () => {
        expect(extractIdentityLocks('Her head is shaved; a faint stubble of dark hair shows.').hair).toMatch(/^completely bald/);
        expect(extractIdentityLocks('Bald-headed, with a grey beard.').hair).toMatch(/^completely bald/);
        expect(extractIdentityLocks('Balding, thinning hair combed over.').hair).toBe('balding with a receding hairline');
    });

    it('collects up to three build terms and one age band', () => {
        const locks = extractIdentityLocks('A towering, broad-shouldered, muscular, hulking man in his sixties.');
        expect(locks.build).toBe('towering, broad shouldered, muscular build');
        expect(locks.age).toBe('elderly');
        expect(extractIdentityLocks('Middle-aged and stout.').age).toBe('middle-aged');
        expect(extractIdentityLocks('A young woman, slender.').age).toBe('young adult');
    });

    it('never reads a build word that describes something other than the body', () => {
        expect(extractIdentityLocks('Tall and statuesque; a thin scar runs along her jaw.').build).toBe('tall, statuesque build');
        expect(extractIdentityLocks('Short grey hair, a lean smile, a massive sword, thin and stooped.').build).toBe('thin, stooped build');
    });

    it('infers nothing from an empty or non-string record', () => {
        expect(extractIdentityLocks('')).toEqual({ skin: '', hair: '', build: '', age: '' });
        expect(extractIdentityLocks({})).toEqual({ skin: '', hair: '', build: '', age: '' });
        expect(extractIdentityLocks('A quiet clerk in a brown coat.')).toEqual({ skin: '', hair: '', build: '', age: '' });
    });
});

describe('buildIdentityLockLine', () => {
    it('leads with the species/gender tag, then skin, hair, build, age, and the non-negotiable clause', () => {
        const line = buildIdentityLockLine('Orsa Pellwyn', 'A tall, statuesque Black woman with a shaved head.', { species: 'human', gender: 'woman' });
        expect(line).toMatch(/^IDENTITY LOCK — Orsa Pellwyn: human woman; deep dark brown skin; completely bald/);
        expect(line).toContain('tall, statuesque build.');
        expect(line).toContain('Non-negotiable');
        expect(line).toContain('never substitute a different skin tone, hairstyle, body type, age, gender, or species');
    });

    it('is empty when the record states nothing lockable and no tag is registered', () => {
        expect(buildIdentityLockLine('Someone', 'A quiet clerk in a brown coat.')).toBe('');
        expect(buildIdentityLockLine('Someone', '')).toBe('');
    });

    it('still locks the registered tag alone', () => {
        expect(buildIdentityLockLine('Grix', 'Wears a red cap.', { species: 'goblin', gender: 'woman' })).toMatch(/^IDENTITY LOCK — Grix: goblin woman\./);
    });

    it('exports a closing reminder', () => {
        expect(IDENTITY_LOCK_REMINDER).toContain('IDENTITY LOCK');
    });
});
