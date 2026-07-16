import { describe, expect, it } from 'vitest';
import { normalizeItem, normalizeItemKey } from './items.js';

describe('item catalog normalization', () => {
    it('recognizes a catalog item with a descriptive prefix', () => {
        expect(normalizeItemKey('massive warhammer')).toBe('warhammer');
        expect(normalizeItemKey('weathered leather armor +1')).toBe('leatherArmor');
    });

    it('keeps catalog mechanics authoritative over LLM-supplied fields', () => {
        const item = normalizeItem({
            name: 'massive warhammer',
            type: 'gear',
            damage: '50d100',
            attackBonus: 99,
            damageBonus: 99,
            weight: 1,
            valueCp: 1,
        });

        expect(item).toMatchObject({
            itemKey: 'warhammer',
            name: 'Warhammer',
            type: 'weapon',
            damage: '1d8',
            damageVersatile: '1d10',
            attackBonus: 0,
            damageBonus: 0,
            weight: 2,
            valueCp: 1500,
        });
    });

    it('clamps hostile quantity and valueCp at the normalize boundary', () => {
        const item = normalizeItem({ name: 'Glass Beads', quantity: 999999999, valueCp: 99999999 });
        expect(item.quantity).toBe(999);
        expect(item.valueCp).toBe(1000000);
    });

    it('zeroes a negative valueCp instead of letting it poison price math', () => {
        const item = normalizeItem({ name: 'Debt Token', valueCp: -500 });
        expect(item.valueCp).toBe(0);
    });
});
