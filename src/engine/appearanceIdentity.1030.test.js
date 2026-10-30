/**
 * The IDENTITY LOCK locks the PERSON, never the gear (2026-10-29 audit P1):
 * the age rules matched "old" / "aged" / "ancient" / "child" anywhere and the
 * hair rule "bald" anywhere, so "an old leather jerkin" locked elderly, "a
 * child's wooden horse" locked a child, "a bald eagle on his tabard" locked a
 * shaved scalp, and "a massive warhammer" locked the build. Every false
 * positive from the finding is pinned as NO lock; the true positives stay.
 */
import { describe, expect, it } from 'vitest';
import { extractIdentityLocks } from './appearanceIdentity.js';

describe('the age lock needs a person (2026-10-29 P1)', () => {
    it('the finding\'s false positives lock nothing', () => {
        const jerkin = extractIdentityLocks('A wiry young woman in an old leather jerkin, a knife at her hip.');
        expect(jerkin.age).toBe('young adult');
        expect(jerkin.build).toBe('wiry build');
        expect(extractIdentityLocks('She carries a child\'s wooden horse wherever she goes.').age).toBe('');
        expect(extractIdentityLocks('An ancient bronze amulet hangs at her throat.').age).toBe('');
        expect(extractIdentityLocks('A very old sword at his hip, a newer scabbard.').age).toBe('');
        expect(extractIdentityLocks('An old friend of the family.').age).toBe('');
        expect(extractIdentityLocks('An old scar across the knuckles.').age).toBe('');
        expect(extractIdentityLocks('Wears an aged wool coat.').age).toBe('');
    });

    it('child is a head noun only: never the possessive, a compound, or a past self', () => {
        expect(extractIdentityLocks('A child in a grey smock.').age).toBe('a child');
        expect(extractIdentityLocks('A child-sized sword strapped to her back.').age).toBe('');
        expect(extractIdentityLocks('Scarred as a child; now a soldier.').age).toBe('');
        expect(extractIdentityLocks('Lost an eye when she was a child.').age).toBe('');
        expect(extractIdentityLocks('Clutches a children\'s primer.').age).toBe('');
    });

    it('the true positives still lock', () => {
        expect(extractIdentityLocks('An old woman with a crooked back.').age).toBe('elderly');
        expect(extractIdentityLocks('An aged elven woman.').age).toBe('elderly');
        expect(extractIdentityLocks('An old, weathered face under a hood.').age).toBe('elderly');
        expect(extractIdentityLocks('He is old and slow now.').age).toBe('elderly');
        expect(extractIdentityLocks('She looks old beyond her years.').age).toBe('elderly');
        expect(extractIdentityLocks('Grown old in the saddle.').age).toBe('elderly');
        expect(extractIdentityLocks('The old one by the fire, wizened.').age).toBe('elderly');
        expect(extractIdentityLocks('A wizened crone.').age).toBe('elderly');
        expect(extractIdentityLocks('A towering, broad-shouldered, muscular, hulking man in his sixties.').age).toBe('elderly');
        expect(extractIdentityLocks('A wiry young woman.').age).toBe('young adult');
        expect(extractIdentityLocks('Middle-aged and stout.').age).toBe('middle-aged');
    });

    it('a stated count of years lands in its band', () => {
        expect(extractIdentityLocks('Seventy years old, bent.').age).toBe('elderly');
        expect(extractIdentityLocks('Forty-two years old.').age).toBe('middle-aged');
        expect(extractIdentityLocks('Twenty-two years old, freckled.').age).toBe('young adult');
    });
});

describe('the hair lock reads a head, not an eagle (2026-10-29 P1)', () => {
    it('bald before eagle / faced / tire never locks a shaved scalp', () => {
        expect(extractIdentityLocks('A bald eagle embroidered on his tabard; long brown hair.').hair).toBe('long brown hair as recorded');
        expect(extractIdentityLocks('A bald-faced liar.').hair).not.toMatch(/^completely bald/);
        expect(extractIdentityLocks('Rolls a bald tire down the lane.').hair).toBe('');
    });

    it('a bald patch is the balding state, and bald alone still locks', () => {
        expect(extractIdentityLocks('A bald patch on the crown, dark hair around it.').hair).toBe('balding with a receding hairline');
        expect(extractIdentityLocks('Bald, with a grey beard.').hair).toMatch(/^completely bald/);
        expect(extractIdentityLocks('A shaved head and a chipped tooth.').hair).toMatch(/^completely bald/);
    });
});

describe('the build lock skips the gear and the beasts (2026-10-29 P1)', () => {
    it('a massive warhammer, a fat purse, a stout chest, a lean hound lock nothing', () => {
        expect(extractIdentityLocks('A massive warhammer across his back.').build).toBe('');
        expect(extractIdentityLocks('A fat purse at his belt.').build).toBe('');
        expect(extractIdentityLocks('A stout chest of coins by the door.').build).toBe('');
        expect(extractIdentityLocks('A lean hound at her heel; a thin gold ring.').build).toBe('');
        expect(extractIdentityLocks('A short staff and a massive shield.').build).toBe('');
    });

    it('the body still locks beside its gear', () => {
        expect(extractIdentityLocks('A stout dwarf beside a stout chest of coins.').build).toBe('stout build');
        expect(extractIdentityLocks('Statuesque and poised, a massive warhammer on her back.').build).toBe('statuesque build');
        expect(extractIdentityLocks('Tall and statuesque; a thin scar runs along her jaw.').build).toBe('tall, statuesque build');
    });
});
