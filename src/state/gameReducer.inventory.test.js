import { describe, it, expect } from 'vitest';
import { gameReducer, initialGameState } from './gameReducer.js';

function makeState() {
    return {
        ...initialGameState,
        character: {
            name: 'Testo',
            race: 'human',
            class: 'fighter',
            level: 1,
            currentHP: 12,
            maxHP: 12,
            armorClass: 18,
            abilityScores: {
                strength: 16,
                dexterity: 12,
                constitution: 14,
                intelligence: 10,
                wisdom: 10,
                charisma: 8,
            },
            conditions: [],
        },
        inventory: [
            {
                id: 'armor-1',
                itemKey: 'chainMail',
                name: 'Chain Mail',
                type: 'armor',
                armorType: 'heavy',
                baseAC: 16,
                equipped: true,
            },
            {
                id: 'shield-1',
                itemKey: 'shield',
                name: 'Shield',
                type: 'shield',
                isShield: true,
                shieldAC: 2,
                equipped: true,
            },
            {
                id: 'weapon-1',
                itemKey: 'longsword',
                name: 'Longsword',
                type: 'weapon',
                damage: '1d8',
                equipped: true,
            },
        ],
        messages: [],
    };
}

describe('equipment changes', () => {
    it('unequips worn armor by generic type and recalculates AC', () => {
        const next = gameReducer(makeState(), {
            type: 'UNEQUIP_ITEM_BY_REF',
            payload: { type: 'armor' },
        });

        expect(next.inventory.find(i => i.id === 'armor-1').equipped).toBe(false);
        expect(next.inventory.find(i => i.id === 'shield-1').equipped).toBe(true);
        expect(next.character.armorClass).toBe(13); // 10 + DEX 1 + shield 2
    });

    it('equips armor by item key and replaces the previous armor', () => {
        const start = {
            ...makeState(),
            inventory: [
                ...makeState().inventory,
                {
                    id: 'armor-2',
                    itemKey: 'leatherArmor',
                    name: 'Leather Armor',
                    type: 'armor',
                    armorType: 'light',
                    baseAC: 11,
                    equipped: false,
                },
            ],
        };

        const next = gameReducer(start, {
            type: 'EQUIP_ITEM_BY_REF',
            payload: { itemKey: 'leatherArmor' },
        });

        expect(next.inventory.find(i => i.id === 'armor-1').equipped).toBe(false);
        expect(next.inventory.find(i => i.id === 'armor-2').equipped).toBe(true);
        expect(next.character.armorClass).toBe(14); // leather 11 + DEX 1 + shield 2
    });

    it('unequips a shield by name and recalculates AC', () => {
        const next = gameReducer(makeState(), {
            type: 'UNEQUIP_ITEM_BY_REF',
            payload: { name: 'Shield' },
        });

        expect(next.inventory.find(i => i.id === 'shield-1').equipped).toBe(false);
        expect(next.character.armorClass).toBe(16);
    });
});
