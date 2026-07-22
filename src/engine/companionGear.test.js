import { describe, expect, it } from 'vitest';
import { appendKeepsakes, deriveGiftAC, MAX_COMPANION_KEEPSAKES } from './companionGear.js';

describe('deriveGiftAC', () => {
    it('gives light and medium armor a +2 DEX-competence allowance', () => {
        expect(deriveGiftAC({ type: 'armor', armorType: 'light', baseAC: 11 }, 12)).toBe(13);
        expect(deriveGiftAC({ type: 'armor', armorType: 'medium', baseAC: 13 }, 12)).toBe(15);
    });

    it('takes heavy armor at its own number', () => {
        expect(deriveGiftAC({ type: 'armor', armorType: 'heavy', baseAC: 18 }, 12)).toBe(18);
    });

    it('adds magic acBonus on top', () => {
        expect(deriveGiftAC({ type: 'armor', armorType: 'medium', baseAC: 13, acBonus: 1 }, 12)).toBe(16);
    });

    it('stacks a shield onto the companion current AC', () => {
        expect(deriveGiftAC({ type: 'shield', isShield: true, shieldAC: 2 }, 14)).toBe(16);
        expect(deriveGiftAC({ type: 'shield', isShield: true, shieldAC: 2, acBonus: 1 }, 14)).toBe(17);
    });

    it('returns null for items with no derivable protection value', () => {
        expect(deriveGiftAC({ type: 'weapon', name: 'Longsword' }, 12)).toBeNull();
        expect(deriveGiftAC({ type: 'armor', name: 'Ceremonial Robes' }, 12)).toBeNull();
        expect(deriveGiftAC(null, 12)).toBeNull();
    });
});

describe('appendKeepsakes', () => {
    it('appends new keepsakes and preserves the existing list', () => {
        expect(appendKeepsakes(['a carved bone whistle'], ['her mother\'s copper ring']))
            .toEqual(['a carved bone whistle', 'her mother\'s copper ring']);
    });

    it('drops near-duplicate restatements by token containment', () => {
        const next = appendKeepsakes(
            ['the carved bone whistle from the hero'],
            ['carved bone whistle'],
        );
        expect(next).toEqual(['the carved bone whistle from the hero']);
    });

    it('caps the list with the newest keepsakes surviving', () => {
        const existing = ['gift one alpha', 'gift two bravo', 'gift three charlie', 'gift four delta', 'gift five echo'];
        const next = appendKeepsakes(existing, ['gift six foxtrot']);
        expect(next).toHaveLength(MAX_COMPANION_KEEPSAKES);
        expect(next[0]).toBe('gift two bravo');
        expect(next.at(-1)).toBe('gift six foxtrot');
    });

    it('never wholesale replaces: empty additions leave the record intact', () => {
        expect(appendKeepsakes(['a pressed fen-lily'], [])).toEqual(['a pressed fen-lily']);
    });
});
