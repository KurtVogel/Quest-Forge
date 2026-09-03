import { describe, expect, it } from 'vitest';
import { boundWeaponDamage, normalizeItem, normalizeItemKey, parseCountedItemName } from './items.js';

describe('item catalog normalization', () => {
    it('recognizes a catalog item with a descriptive prefix', () => {
        expect(normalizeItemKey('massive warhammer')).toBe('warhammer');
        expect(normalizeItemKey('weathered leather armor +1')).toBe('leatherArmor');
    });

    it('resolves plural grants to their singular catalog entry (2026-08-22)', () => {
        expect(normalizeItemKey('Torches')).toBe('torch');
        expect(normalizeItemKey('Daggers')).toBe('dagger');
        expect(normalizeItemKey('shortswords')).toBe('shortsword');
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

    it('parses counts embedded in grant names into quantity (live playtest #10)', () => {
        // "3 Torches" and "7 days of Trail Rations" arrived as literal row names.
        expect(parseCountedItemName('3 Torches')).toEqual({ name: 'Torches', quantity: 3 });
        expect(parseCountedItemName('7 days of Trail Rations')).toEqual({ name: 'Trail Rations', quantity: 7 });
        expect(parseCountedItemName('2x Healing Potion')).toEqual({ name: 'Healing Potion', quantity: 2 });
        expect(parseCountedItemName('Torch x3')).toEqual({ name: 'Torch', quantity: 3 });
    });

    it('leaves measurements, catalog bundle names, and plain names un-parsed', () => {
        expect(parseCountedItemName('10 foot pole')).toBeNull();
        expect(parseCountedItemName('Wax Candles (x5)')).toBeNull();
        expect(parseCountedItemName('Hempen Rope (50 ft)')).toBeNull();
        expect(parseCountedItemName('Lodestone')).toBeNull();
    });

    it('normalizeItem turns "3 Torches" into a catalog Torch stack of three', () => {
        const item = normalizeItem({ name: '3 Torches' });
        expect(item.itemKey).toBe('torch');
        expect(item.name).toBe('Torch');
        expect(item.quantity).toBe(3);
    });

    it('normalizeItem keeps an explicit quantity field over the name count', () => {
        const item = normalizeItem({ name: '3 Torches', quantity: 5 });
        expect(item.itemKey).toBe('torch');
        expect(item.quantity).toBe(5);
    });

    it('normalizeItem gives non-catalog counted names a clean custom row', () => {
        const item = normalizeItem({ name: '7 days of Trail Rations' });
        expect(item.itemKey).toBeNull();
        expect(item.name).toBe('Trail Rations');
        expect(item.quantity).toBe(7);
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

    it('clamps non-catalog armor stats so the hero cannot equip AC 40', () => {
        const item = normalizeItem({
            name: 'Godplate of the Ancients',
            type: 'armor',
            armorType: 'heavy',
            baseAC: 30,
            acBonus: 10,
        });
        expect(item.baseAC).toBe(18); // plate ceiling
        expect(item.acBonus).toBe(3); // magic ceiling
    });

    it('infers armorType from baseAC so the engine honors non-catalog armor', () => {
        expect(normalizeItem({ name: 'Padded Vest', type: 'armor', baseAC: 12 }).armorType).toBe('light');
        expect(normalizeItem({ name: 'Bone Harness', type: 'armor', baseAC: 14 }).armorType).toBe('medium');
        expect(normalizeItem({ name: 'Dread Carapace', type: 'armor', baseAC: 17 }).armorType).toBe('heavy');
        // Junk baseAC is dropped entirely rather than kept as NaN.
        expect(normalizeItem({ name: 'Mist Cloak', type: 'armor', baseAC: 'lots' }).baseAC).toBeUndefined();
    });

    it('clamps non-catalog shield and weapon bonuses at the normalize boundary', () => {
        const shield = normalizeItem({ name: 'Tower of Heaven', type: 'shield', shieldAC: 9, acBonus: 8 });
        expect(shield.shieldAC).toBe(3);
        expect(shield.acBonus).toBe(3);
        const blade = normalizeItem({ name: 'Kingslayer Edge', type: 'weapon', damage: '1d8', attackBonus: 20, damageBonus: -5 });
        expect(blade.attackBonus).toBe(3);
        expect(blade.damageBonus).toBe(0); // negative junk zeroed
    });
});

describe('genitive prefixes never become catalog gear (2026-09-03 P1)', () => {
    it('rejects "X of <catalog name>" story objects', () => {
        expect(normalizeItemKey('Scroll of Shield')).toBeNull();
        expect(normalizeItemKey('Ring of the Dagger')).toBeNull();
        expect(normalizeItemKey('Scrolls of Shield')).toBeNull();
        expect(normalizeItemKey('Amulet for the Longsword')).toBeNull();
        expect(normalizeItemKey('Letter from the Warhammer')).toBeNull();
    });

    it('still accepts unit/container heads and plain descriptors', () => {
        expect(normalizeItemKey('suit of chain mail')).toBe('chainMail');
        expect(normalizeItemKey('a battered suit of Chain Mail')).toBe('chainMail');
        expect(normalizeItemKey('pair of daggers')).toBe('dagger');
        expect(normalizeItemKey('coil of hempen rope (50 ft)')).toBe('ropeHempen');
        expect(normalizeItemKey('vial of antitoxin')).toBe('antitoxin');
        expect(normalizeItemKey('massive warhammer')).toBe('warhammer');
        expect(normalizeItemKey('Potion of Healing')).toBe('potionHealing');
    });

    it('normalizeItem keeps a genitive story object as its own custom row', () => {
        const scroll = normalizeItem({ name: 'Scroll of Shield', type: 'consumable' });
        expect(scroll.itemKey).toBeNull();
        expect(scroll.name).toBe('Scroll of Shield');
        expect(scroll.type).toBe('consumable');
        expect(scroll.isShield).toBeUndefined();
    });
});

describe('non-catalog weapon damage is bounded (2026-09-03 P1)', () => {
    it('caps dice at the best catalog die and falls back to 1d6 beyond it', () => {
        expect(boundWeaponDamage('99d12')).toBe('1d6');
        expect(boundWeaponDamage('1d999')).toBe('1d6');
        expect(boundWeaponDamage('3d6')).toBe('1d6');
        expect(boundWeaponDamage('0d6')).toBe('1d6');
        expect(boundWeaponDamage('lots')).toBe('1d6');
        expect(boundWeaponDamage('')).toBe('1d6');
        expect(boundWeaponDamage('2d6')).toBe('2d6');
        expect(boundWeaponDamage('1d12')).toBe('1d12');
        expect(boundWeaponDamage('1d8 slashing')).toBe('1d8');
        expect(boundWeaponDamage('1d6+2')).toBe('1d6+2');
        expect(boundWeaponDamage('1d6+9')).toBe('1d6+3');
    });

    it('normalizeItem bounds a DM/import weapon but leaves catalog dice alone', () => {
        const doom = normalizeItem({ name: 'Doom Blade', type: 'weapon', damage: '99d12', damageVersatile: '99d20' });
        expect(doom.damage).toBe('1d6');
        expect(doom.damageVersatile).toBe('1d6');
        const bespoke = normalizeItem({ name: 'Whalebone Harpoon', type: 'weapon', damage: '1d8 piercing' });
        expect(bespoke.damage).toBe('1d8');
        expect(normalizeItem({ name: 'Greatsword', damage: '99d12' }).damage).toBe('2d6');
        // No damage field stays absent (fists fallback lives in getWeaponDamageNotation).
        expect(normalizeItem({ name: 'Odd Cudgel', type: 'weapon' }).damage).toBeUndefined();
    });
});

describe('parseCountedItemName corner cases (2026-09-03 P2)', () => {
    it('reads "3 days rations" without the "of"', () => {
        expect(parseCountedItemName('3 days rations')).toEqual({ name: 'rations', quantity: 3 });
        expect(parseCountedItemName('2 nights worth of firewood')).toEqual({ name: 'firewood', quantity: 2 });
    });

    it('does not read "2 Handed Sword" as two swords', () => {
        expect(parseCountedItemName('2 Handed Sword')).toBeNull();
        expect(normalizeItem({ name: '2 Handed Sword', type: 'weapon', damage: '2d6' })).toMatchObject({ name: '2 Handed Sword', quantity: 1 });
    });
});
