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

function makePotion(overrides = {}) {
    return {
        id: 'potion-1',
        itemKey: 'potionHealing',
        name: 'Potion of Healing',
        type: 'consumable',
        consumableType: 'healing',
        healing: '2d4+2',
        actionType: 'bonus',
        quantity: 1,
        ...overrides,
    };
}

function withCombat(state, overrides = {}) {
    return {
        ...state,
        combat: {
            active: true,
            enemies: [{ id: 'enemy-1', name: 'Goblin', hp: 7, maxHp: 7, ac: 13, condition: 'healthy' }],
            turnOrder: [{ type: 'player', name: 'Testo', initiative: 12 }],
            currentTurn: 0,
            round: 1,
            xpAwarded: false,
            bonusActionUsed: false,
            ...overrides,
        },
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

    it('equipping a two-handed weapon sheaths the shield and updates AC', () => {
        const start = {
            ...makeState(),
            inventory: [
                ...makeState().inventory,
                {
                    id: 'weapon-2',
                    itemKey: 'greatsword',
                    name: 'Greatsword',
                    type: 'weapon',
                    damage: '2d6',
                    twoHanded: true,
                    equipped: false,
                },
            ],
        };

        const next = gameReducer(start, { type: 'EQUIP_ITEM', payload: 'weapon-2' });

        expect(next.inventory.find(i => i.id === 'weapon-2').equipped).toBe(true);
        expect(next.inventory.find(i => i.id === 'weapon-1').equipped).toBe(false);
        expect(next.inventory.find(i => i.id === 'shield-1').equipped).toBe(false);
        expect(next.character.armorClass).toBe(16);
    });

    it('equipping a shield sheaths an active two-handed weapon and updates AC', () => {
        const start = {
            ...makeState(),
            inventory: [
                makeState().inventory[0],
                { ...makeState().inventory[1], equipped: false },
                {
                    id: 'weapon-2',
                    itemKey: 'greatsword',
                    name: 'Greatsword',
                    type: 'weapon',
                    damage: '2d6',
                    twoHanded: true,
                    equipped: true,
                },
            ],
        };

        const next = gameReducer(start, { type: 'EQUIP_ITEM', payload: 'shield-1' });

        expect(next.inventory.find(i => i.id === 'shield-1').equipped).toBe(true);
        expect(next.inventory.find(i => i.id === 'weapon-2').equipped).toBe(false);
        expect(next.character.armorClass).toBe(18);
    });

    it('does not auto-equip a found shield while a two-handed weapon is active', () => {
        const start = {
            ...makeState(),
            inventory: [
                makeState().inventory[0],
                {
                    id: 'weapon-2',
                    itemKey: 'greatsword',
                    name: 'Greatsword',
                    type: 'weapon',
                    damage: '2d6',
                    twoHanded: true,
                    equipped: true,
                },
            ],
        };

        const next = gameReducer(start, {
            type: 'ADD_ITEM',
            payload: { itemKey: 'shield' },
        });

        const shield = next.inventory.find(i => i.itemKey === 'shield');
        expect(shield.equipped).toBe(false);
        expect(next.inventory.find(i => i.id === 'weapon-2').equipped).toBe(true);
        expect(next.character.armorClass).toBe(16);
    });

    it('refuses to equip non-equipment items', () => {
        const start = {
            ...makeState(),
            inventory: [
                ...makeState().inventory,
                { id: 'pack-1', name: "Explorer's Pack", type: 'gear', equipped: false },
            ],
        };

        const next = gameReducer(start, { type: 'EQUIP_ITEM', payload: 'pack-1' });

        expect(next.inventory.find(i => i.id === 'pack-1').equipped).toBe(false);
    });
});

describe('consumable use', () => {
    it('healing potions revive a dying character and are consumed', () => {
        const state = {
            ...makeState(),
            character: {
                ...makeState().character,
                level: 3,
                currentHP: 0,
                maxHP: 20,
                dying: true,
                deathSaves: { successes: 1, failures: 1 },
                conditions: ['Unconscious'],
            },
            inventory: [
                ...makeState().inventory,
                makePotion(),
            ],
        };

        const next = gameReducer(state, { type: 'USE_ITEM', payload: 'potion-1' });

        expect(next.character.currentHP).toBeGreaterThan(0);
        expect(next.character.dying).toBe(false);
        expect(next.character.deathSaves).toEqual({ successes: 0, failures: 0 });
        expect(next.character.conditions).not.toContain('Unconscious');
        expect(next.inventory.some(i => i.id === 'potion-1')).toBe(false);
        expect(next.rollHistory).toHaveLength(1);
    });

    it('does not consume a healing potion at full health', () => {
        const state = {
            ...makeState(),
            inventory: [
                ...makeState().inventory,
                makePotion(),
            ],
        };

        const next = gameReducer(state, { type: 'USE_ITEM', payload: 'potion-1' });

        expect(next.inventory.some(i => i.id === 'potion-1')).toBe(true);
        expect(next.rollHistory).toHaveLength(0);
        expect(next.messages.at(-1).content).toContain('full health');
    });

    it('healing potions spend the combat bonus action and leave the main action available', () => {
        const state = withCombat({
            ...makeState(),
            character: { ...makeState().character, currentHP: 4, maxHP: 12 },
            inventory: [...makeState().inventory, makePotion({ quantity: 2 })],
        });

        const next = gameReducer(state, { type: 'USE_ITEM', payload: 'potion-1' });

        expect(next.character.currentHP).toBeGreaterThan(4);
        expect(next.combat.bonusActionUsed).toBe(true);
        expect(next.inventory.find(i => i.id === 'potion-1').quantity).toBe(1);
        expect(next.messages.at(-1).content).toContain('bonus action');
        expect(next.messages.at(-1).content).toContain('main action is still available');
        expect(next.messages.at(-1).narrationCue).toMatchObject({
            type: 'player_mechanic',
            mechanic: 'Potion of Healing',
            actionType: 'bonus action',
        });
    });

    it('does not drink a healing potion after the combat bonus action is spent', () => {
        const state = withCombat({
            ...makeState(),
            character: { ...makeState().character, currentHP: 4, maxHP: 12 },
            inventory: [...makeState().inventory, makePotion()],
        }, { bonusActionUsed: true });

        const next = gameReducer(state, { type: 'USE_ITEM', payload: 'potion-1' });

        expect(next.character.currentHP).toBe(4);
        expect(next.inventory.some(i => i.id === 'potion-1')).toBe(true);
        expect(next.rollHistory).toHaveLength(0);
        expect(next.messages.at(-1).content).toContain('Bonus action already used');
    });

    it('does not drink a healing potion off-turn in combat', () => {
        const state = withCombat({
            ...makeState(),
            character: { ...makeState().character, currentHP: 4, maxHP: 12 },
            inventory: [...makeState().inventory, makePotion()],
        }, {
            turnOrder: [
                { type: 'enemy', id: 'enemy-1', name: 'Goblin', initiative: 14 },
                { type: 'player', name: 'Testo', initiative: 12 },
            ],
            currentTurn: 0,
        });

        const next = gameReducer(state, { type: 'USE_ITEM', payload: 'potion-1' });

        expect(next.character.currentHP).toBe(4);
        expect(next.inventory.some(i => i.id === 'potion-1')).toBe(true);
        expect(next.combat.bonusActionUsed).toBe(false);
        expect(next.messages.at(-1).content).toContain('drink it on your turn');
    });
});

describe('administering a healing potion to a companion', () => {
    const downedCompanion = (overrides = {}) => ({
        id: 'tor', name: 'Torvald Ironhand', hp: 0, maxHp: 18, ac: 14,
        attackBonus: 4, damage: '1d8+2', level: 2, status: 'downed', affinity: 60,
        ...overrides,
    });

    it('heals a downed companion back to their feet and consumes the potion', () => {
        const state = { ...makeState(), party: [downedCompanion()], inventory: [...makeState().inventory, makePotion()] };
        const next = gameReducer(state, { type: 'USE_ITEM', payload: { itemId: 'potion-1', targetId: 'tor' } });

        const tor = next.party[0];
        expect(tor.hp).toBeGreaterThan(0);
        expect(tor.status).not.toBe('downed');
        expect(next.inventory.some(i => i.id === 'potion-1')).toBe(false);
        expect(next.character.currentHP).toBe(12); // hero untouched
        expect(next.messages.at(-1).content).toContain('back on their feet');
        expect(next.messages.at(-1).narrationCue).toMatchObject({ type: 'player_mechanic' });
    });

    it('refuses during active combat without consuming anything', () => {
        const state = withCombat({ ...makeState(), party: [downedCompanion()], inventory: [...makeState().inventory, makePotion()] });
        const next = gameReducer(state, { type: 'USE_ITEM', payload: { itemId: 'potion-1', targetId: 'tor' } });

        expect(next.party[0].hp).toBe(0);
        expect(next.inventory.some(i => i.id === 'potion-1')).toBe(true);
        expect(next.messages.at(-1).content).toContain('not supported');
    });

    it('refuses on a dead or full-health companion', () => {
        const dead = { ...makeState(), party: [downedCompanion({ status: 'dead' })], inventory: [...makeState().inventory, makePotion()] };
        const deadNext = gameReducer(dead, { type: 'USE_ITEM', payload: { itemId: 'potion-1', targetId: 'tor' } });
        expect(deadNext.inventory.some(i => i.id === 'potion-1')).toBe(true);
        expect(deadNext.messages.at(-1).content).toContain('cannot help the dead');

        const full = { ...makeState(), party: [downedCompanion({ hp: 18, status: 'healthy' })], inventory: [...makeState().inventory, makePotion()] };
        const fullNext = gameReducer(full, { type: 'USE_ITEM', payload: { itemId: 'potion-1', targetId: 'tor' } });
        expect(fullNext.inventory.some(i => i.id === 'potion-1')).toBe(true);
        expect(fullNext.messages.at(-1).content).toContain('already at full health');
    });
});

describe('END_COMBAT downed-companion messaging', () => {
    it('announces that a downed companion is stable and recoverable', () => {
        const state = withCombat({
            ...makeState(),
            party: [{ id: 'tor', name: 'Torvald Ironhand', hp: 0, maxHp: 18, ac: 14, status: 'downed', level: 2, affinity: 60 }],
        }, { enemies: [{ id: 'enemy-1', name: 'Goblin', hp: 0, maxHp: 7, ac: 13, condition: 'dead' }] });
        const next = gameReducer(state, { type: 'END_COMBAT', payload: { llmAwardedXp: true } });

        expect(next.combat.active).toBe(false);
        expect(next.messages.some(m => m.content.includes('down but stable'))).toBe(true);
    });

    it('stays silent when everyone is on their feet', () => {
        const state = withCombat({
            ...makeState(),
            party: [{ id: 'tor', name: 'Torvald Ironhand', hp: 12, maxHp: 18, ac: 14, status: 'healthy', level: 2, affinity: 60 }],
        }, { enemies: [{ id: 'enemy-1', name: 'Goblin', hp: 0, maxHp: 7, ac: 13, condition: 'dead' }] });
        const next = gameReducer(state, { type: 'END_COMBAT', payload: { llmAwardedXp: true } });

        expect(next.messages.some(m => m.content.includes('down but stable'))).toBe(false);
    });
});
