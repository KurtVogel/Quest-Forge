/**
 * 2026-09-25 inventory-economy Lap-3 P2 (the Lap-2 spill): word-order-blind
 * catalog identity and the humanized key. The catalog's keys invert natural
 * word order (`potionHealing`, `ropeHempen`), so the LLM-plausible typo is the
 * same words the other way round.
 */
import { describe, expect, it } from 'vitest';
import { humanizeItemKey, MAX_ITEM_QUANTITY, normalizeItem, normalizeItemKey } from './items.js';

describe('normalizeItemKey — same words, another order (2026-09-25)', () => {
    it('resolves the inverted camelCase / snake_case / spaced key to its catalog row', () => {
        expect(normalizeItemKey('healingPotion')).toBe('potionHealing');
        expect(normalizeItemKey('HealingPotion')).toBe('potionHealing');
        expect(normalizeItemKey('healing_potion')).toBe('potionHealing');
        expect(normalizeItemKey('Healing Potion')).toBe('potionHealing');
        expect(normalizeItemKey('hempenRope')).toBe('ropeHempen');
        expect(normalizeItemKey('rope hempen')).toBe('ropeHempen');
        expect(normalizeItemKey('silkRope')).toBe('ropeSilk');
        expect(normalizeItemKey('armorLeather')).toBe('leatherArmor');
        expect(normalizeItemKey('crossbowLight')).toBe('lightCrossbow');
        expect(normalizeItemKey('mailChain')).toBe('chainMail');
    });

    it('a magic bonus on the inverted name still parses around it', () => {
        expect(normalizeItemKey('armor leather +1')).toBe('leatherArmor');
    });

    it('a name that merely CONTAINS catalog words has a different word set and never matches', () => {
        expect(normalizeItemKey('Scroll of Shield')).toBeNull();
        expect(normalizeItemKey('Ring of the Dagger')).toBeNull();
        expect(normalizeItemKey('Healing Potion Recipe')).toBeNull();
        expect(normalizeItemKey('potionOfGreaterHealing')).toBeNull();
        expect(normalizeItemKey('elixirOfVigor')).toBeNull();
        expect(normalizeItemKey('constructor')).toBeNull();
        expect(normalizeItemKey('__proto__')).toBeNull();
        expect(normalizeItemKey('hasOwnProperty')).toBeNull();
    });

    it('a single-word key still needs an exact catalog identity', () => {
        expect(normalizeItemKey('torch')).toBe('torch');
        expect(normalizeItemKey('torches')).toBe('torch');
        expect(normalizeItemKey('torchlight')).toBeNull();
    });
});

describe('normalizeItem — an unknown key with no name reads as the key\'s words (2026-09-25)', () => {
    it('humanizes the key instead of "Unknown item"', () => {
        expect(humanizeItemKey('glowingOrb')).toBe('Glowing Orb');
        expect(humanizeItemKey('elixir_of_vigor')).toBe('Elixir Of Vigor');
        expect(humanizeItemKey('SIGNET-RING')).toBe('Signet Ring');
        expect(humanizeItemKey('')).toBe('');
        expect(humanizeItemKey(null)).toBe('');
        expect(normalizeItem({ itemKey: 'glowingOrb' })).toMatchObject({ name: 'Glowing Orb', type: 'gear', quantity: 1 });
        expect(normalizeItem({ key: 'signetRing' })).toMatchObject({ name: 'Signet Ring' });
    });

    it('an explicit name still wins over the humanized key; the no-key no-name shape is still "Unknown item"', () => {
        expect(normalizeItem({ itemKey: 'glowingOrb', name: 'The Eye of Ur' }).name).toBe('The Eye of Ur');
        expect(normalizeItem({}).name).toBe('Unknown item');
        expect(normalizeItem({ name: { x: 1 } }).name).toBe('Unknown item');
    });

    it('each reference gets its own lookup: an unknown key beside a catalog name resolves through the name', () => {
        const item = normalizeItem({ itemKey: 'healingDraught', name: 'Potion of Healing' });
        expect(item.itemKey).toBe('potionHealing');
        expect(item.consumableType).toBe('healing');
    });

    it('exports the stack ceiling the reducer and the load heal share', () => {
        expect(MAX_ITEM_QUANTITY).toBe(999);
        expect(normalizeItem({ name: 'Torch', quantity: 5000 }).quantity).toBe(MAX_ITEM_QUANTITY);
    });
});
