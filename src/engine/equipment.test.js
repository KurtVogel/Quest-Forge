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
