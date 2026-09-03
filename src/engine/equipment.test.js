import { describe, expect, it } from 'vitest';
import { normalizeEquippedSlots } from './equipment.js';

describe('normalizeEquippedSlots', () => {
    it('keeps one weapon, one armor, and one shield for ordinary loadouts', () => {
        const items = normalizeEquippedSlots([
            { id: 'sword', name: 'Longsword', type: 'weapon', equipped: true },
            { id: 'dagger', name: 'Dagger', type: 'weapon', equipped: true },
            { id: 'armor-1', name: 'Chain Mail', type: 'armor', equipped: true },
            { id: 'armor-2', name: 'Leather Armor', type: 'armor', equipped: true },
            { id: 'shield', name: 'Shield', type: 'shield', isShield: true, equipped: true },
        ]);

        expect(items.filter(i => i.type === 'weapon' && i.equipped).map(i => i.id)).toEqual(['sword']);
        expect(items.filter(i => i.type === 'armor' && i.equipped).map(i => i.id)).toEqual(['armor-1']);
        expect(items.filter(i => (i.type === 'shield' || i.isShield) && i.equipped).map(i => i.id)).toEqual(['shield']);
    });

    it('prefers a newly equipped two-handed weapon over an equipped shield', () => {
        const items = normalizeEquippedSlots([
            { id: 'shield', name: 'Shield', type: 'shield', isShield: true, equipped: true },
            { id: 'greatsword', name: 'Greatsword', type: 'weapon', twoHanded: true, equipped: false },
        ], 'greatsword');

        expect(items.find(i => i.id === 'greatsword').equipped).toBe(true);
        expect(items.find(i => i.id === 'shield').equipped).toBe(false);
    });

    it('prefers a newly equipped shield over an equipped two-handed weapon', () => {
        const items = normalizeEquippedSlots([
            { id: 'greatsword', name: 'Greatsword', type: 'weapon', twoHanded: true, equipped: true },
            { id: 'shield', name: 'Shield', type: 'shield', isShield: true, equipped: false },
        ], 'shield');

        expect(items.find(i => i.id === 'shield').equipped).toBe(true);
        expect(items.find(i => i.id === 'greatsword').equipped).toBe(false);
    });

    it('clears invalid equipped flags from non-equipment', () => {
        const items = normalizeEquippedSlots([
            { id: 'pack', name: "Explorer's Pack", type: 'gear', equipped: true },
            { id: 'sword', name: 'Longsword', type: 'weapon', equipped: true },
        ]);

        expect(items.find(i => i.id === 'pack').equipped).toBe(false);
        expect(items.find(i => i.id === 'sword').equipped).toBe(true);
    });
});

describe('normalizeEquippedSlots preferredItemId swaps (2026-09-03 test depth)', () => {
    it('a newly equipped armor displaces the worn armor, leaving weapon and shield alone', () => {
        const items = normalizeEquippedSlots([
            { id: 'chain', name: 'Chain Mail', type: 'armor', equipped: true },
            { id: 'sword', name: 'Longsword', type: 'weapon', equipped: true },
            { id: 'shield', name: 'Shield', type: 'shield', isShield: true, equipped: true },
            { id: 'plate', name: 'Plate Armor', type: 'armor', equipped: false },
        ], 'plate');

        expect(items.find(i => i.id === 'plate').equipped).toBe(true);
        expect(items.find(i => i.id === 'chain').equipped).toBe(false);
        expect(items.find(i => i.id === 'sword').equipped).toBe(true);
        expect(items.find(i => i.id === 'shield').equipped).toBe(true);
        // Order is preserved: the preferred item does not jump to the front.
        expect(items.map(i => i.id)).toEqual(['chain', 'sword', 'shield', 'plate']);
    });

    it('a newly equipped one-handed weapon displaces the active weapon and keeps the shield', () => {
        const items = normalizeEquippedSlots([
            { id: 'sword', name: 'Longsword', type: 'weapon', equipped: true },
            { id: 'shield', name: 'Shield', type: 'shield', isShield: true, equipped: true },
            { id: 'mace', name: 'Mace', type: 'weapon', equipped: false },
        ], 'mace');

        expect(items.find(i => i.id === 'mace').equipped).toBe(true);
        expect(items.find(i => i.id === 'sword').equipped).toBe(false);
        expect(items.find(i => i.id === 'shield').equipped).toBe(true);
    });

    it('an unknown preferredItemId changes nothing', () => {
        const items = normalizeEquippedSlots([
            { id: 'sword', name: 'Longsword', type: 'weapon', equipped: true },
        ], 'ghost');
        expect(items.find(i => i.id === 'sword').equipped).toBe(true);
    });
});
