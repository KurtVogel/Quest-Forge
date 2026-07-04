/**
 * Tests for reducer actions that atomically move coin: PURCHASE_ITEM, SELL_ITEM,
 * CLAIM_LOOT_SOURCE (dedupe), and LEVEL_UP (milestone XP award).
 */
import { describe, expect, it } from 'vitest';
import { gameReducer, initialGameState } from './gameReducer.js';

function makeState(overrides = {}) {
    return {
        ...initialGameState,
        character: {
            ...initialGameState.character,
            name: 'Astra',
            race: 'human',
            class: 'fighter',
            level: 1,
            gold: 5,
            silver: 0,
            copper: 0,
            ...overrides.character,
        },
        inventory: overrides.inventory ?? initialGameState.inventory,
        messages: [],
    };
}

describe('PURCHASE_ITEM', () => {
    it('deducts price and adds the catalog item to inventory', () => {
        const state = makeState();
        const next = gameReducer(state, {
            type: 'PURCHASE_ITEM',
            payload: { itemKey: 'dagger' },
        });
        expect(next.character.gold).toBe(3); // dagger costs 2gp
        expect(next.inventory.some(i => i.itemKey === 'dagger')).toBe(true);
        expect(next.messages.at(-1).content).toMatch(/Bought Dagger/);
    });

    it('refuses the purchase and leaves state unchanged when funds are insufficient', () => {
        const state = makeState({ character: { gold: 0, silver: 0, copper: 0 } });
        const next = gameReducer(state, {
            type: 'PURCHASE_ITEM',
            payload: { itemKey: 'dagger' },
        });
        expect(next.character.gold).toBe(0);
        expect(next.inventory).toBe(state.inventory);
        expect(next.messages.at(-1).content).toMatch(/Cannot buy/);
    });

    it('supports an explicit priceCp override and quantity', () => {
        const state = makeState({ character: { gold: 1, silver: 0, copper: 0 } });
        const next = gameReducer(state, {
            type: 'PURCHASE_ITEM',
            payload: { itemKey: 'torch', quantity: 3, priceCp: 50 },
        });
        expect(next.character.gold).toBe(0);
        expect(next.character.silver).toBe(5);
        const torch = next.inventory.find(i => i.itemKey === 'torch');
        expect(torch.quantity).toBe(3);
    });

    it('keeps transaction metadata out of inventory and treats nested custom price as per-unit', () => {
        const state = makeState();
        const next = gameReducer(state, {
            type: 'PURCHASE_ITEM',
            payload: {
                item: { name: 'Ink Vial', priceCp: 15 },
                quantity: 2,
                _meta: { sourceId: 'msg-buy-1', playerMessage: 'I buy two ink vials.' },
            },
        });

        expect(next.character.gold).toBe(4);
        expect(next.character.silver).toBe(7);
        const ink = next.inventory.find(i => i.name === 'Ink Vial');
        expect(ink.quantity).toBe(2);
        expect(ink._meta).toBeUndefined();
    });

    it('ignores an identical nearby purchase replay when the player did not ask to buy again', () => {
        const state = makeState();
        const bought = gameReducer(state, {
            type: 'PURCHASE_ITEM',
            payload: {
                itemKey: 'dagger',
                _meta: { sourceId: 'msg-buy-1', playerMessage: 'I buy a dagger.' },
            },
        });
        const nextAssistant = gameReducer(bought, {
            type: 'ADD_MESSAGE',
            payload: { id: 'msg-buy-2', role: 'assistant', content: 'The street opens beyond the shop.' },
        });
        const replayed = gameReducer(nextAssistant, {
            type: 'PURCHASE_ITEM',
            payload: {
                itemKey: 'Dagger',
                _meta: { sourceId: 'msg-buy-2', playerMessage: 'I leave the stall.' },
            },
        });

        expect(replayed.character.gold).toBe(3);
        expect(replayed.inventory.filter(i => i.itemKey === 'dagger')).toHaveLength(1);
        expect(replayed.messages.at(-1).content).toMatch(/Duplicate purchase ignored/);
    });

    it('ignores an exact same-message purchase replay even if metadata is repeated', () => {
        const state = makeState();
        const bought = gameReducer(state, {
            type: 'PURCHASE_ITEM',
            payload: {
                itemKey: 'dagger',
                _meta: { sourceId: 'msg-buy-1', playerMessage: 'I buy a dagger.' },
            },
        });
        const replayed = gameReducer(bought, {
            type: 'PURCHASE_ITEM',
            payload: {
                itemKey: 'dagger',
                _meta: { sourceId: 'msg-buy-1', playerMessage: 'I buy a dagger.' },
            },
        });

        expect(replayed.character.gold).toBe(3);
        expect(replayed.inventory.filter(i => i.itemKey === 'dagger')).toHaveLength(1);
    });

    it('allows a nearby repeat purchase when the player explicitly buys another copy', () => {
        const state = makeState();
        const bought = gameReducer(state, {
            type: 'PURCHASE_ITEM',
            payload: {
                itemKey: 'dagger',
                _meta: { sourceId: 'msg-buy-1', playerMessage: 'I buy a dagger.' },
            },
        });
        const nextAssistant = gameReducer(bought, {
            type: 'ADD_MESSAGE',
            payload: { id: 'msg-buy-2', role: 'assistant', content: 'The merchant waits.' },
        });
        const second = gameReducer(nextAssistant, {
            type: 'PURCHASE_ITEM',
            payload: {
                itemKey: 'dagger',
                _meta: { sourceId: 'msg-buy-2', playerMessage: 'I buy another dagger.' },
            },
        });

        expect(second.character.gold).toBe(1);
        expect(second.inventory.filter(i => i.itemKey === 'dagger')).toHaveLength(2);
    });
});

describe('SELL_ITEM', () => {
    it('sells an inventory item for half catalog value by default', () => {
        const state = makeState({
            inventory: [{ id: 'dagger-1', itemKey: 'dagger', name: 'Dagger', type: 'weapon', valueCp: 200, quantity: 1 }],
        });
        const next = gameReducer(state, {
            type: 'SELL_ITEM',
            payload: { itemId: 'dagger-1' },
        });
        expect(next.character.gold).toBe(6); // 5gp + 1gp (half of 2gp)
        expect(next.inventory.find(i => i.id === 'dagger-1')).toBeUndefined();
        expect(next.messages.at(-1).content).toMatch(/Sold Dagger/);
    });

    it('reports failure without mutating inventory when the item is not found', () => {
        const state = makeState({ inventory: [] });
        const next = gameReducer(state, {
            type: 'SELL_ITEM',
            payload: { itemId: 'missing' },
        });
        expect(next.inventory).toBe(state.inventory);
        expect(next.character.gold).toBe(5);
        expect(next.messages.at(-1).content).toMatch(/Can't sell/);
    });

    it('sells a partial stack and keeps the remainder', () => {
        const state = makeState({
            inventory: [{ id: 'torch-1', itemKey: 'torch', name: 'Torch', type: 'gear', valueCp: 1, quantity: 5 }],
        });
        const next = gameReducer(state, {
            type: 'SELL_ITEM',
            payload: { itemId: 'torch-1', quantity: 2 },
        });
        const torch = next.inventory.find(i => i.id === 'torch-1');
        expect(torch.quantity).toBe(3);
    });

    it('respects an explicit priceCp override for haggling', () => {
        const state = makeState({
            inventory: [{ id: 'dagger-1', itemKey: 'dagger', name: 'Dagger', type: 'weapon', valueCp: 200, quantity: 1 }],
        });
        const next = gameReducer(state, {
            type: 'SELL_ITEM',
            payload: { itemId: 'dagger-1', priceCp: 500 },
        });
        expect(next.character.gold).toBe(10); // 5gp + 5gp override
    });

    it('ignores an identical nearby sale replay when the player did not ask to sell again', () => {
        const twoDaggers = [
            { id: 'd1', itemKey: 'dagger', name: 'Dagger', type: 'weapon', valueCp: 200, quantity: 1 },
            { id: 'd2', itemKey: 'dagger', name: 'Dagger', type: 'weapon', valueCp: 200, quantity: 1 },
        ];
        const state = makeState({ inventory: twoDaggers });
        const sold = gameReducer(state, {
            type: 'SELL_ITEM',
            payload: { itemKey: 'dagger', _meta: { sourceId: 'msg-sell-1', playerMessage: 'I sell my dagger.' } },
        });
        expect(sold.character.gold).toBe(6);
        const nextAssistant = gameReducer(sold, {
            type: 'ADD_MESSAGE',
            payload: { id: 'msg-sell-2', role: 'assistant', content: 'The fence pockets the blade.' },
        });
        const replayed = gameReducer(nextAssistant, {
            type: 'SELL_ITEM',
            payload: { itemKey: 'dagger', _meta: { sourceId: 'msg-sell-2', playerMessage: 'I leave the shop.' } },
        });

        expect(replayed.character.gold).toBe(6); // not paid twice
        expect(replayed.inventory.filter(i => i.itemKey === 'dagger')).toHaveLength(1); // second dagger kept
        expect(replayed.messages.at(-1).content).toMatch(/Duplicate sale ignored/);
    });

    it('allows a nearby repeat sale when the player explicitly sells the other copy', () => {
        const twoDaggers = [
            { id: 'd1', itemKey: 'dagger', name: 'Dagger', type: 'weapon', valueCp: 200, quantity: 1 },
            { id: 'd2', itemKey: 'dagger', name: 'Dagger', type: 'weapon', valueCp: 200, quantity: 1 },
        ];
        const state = makeState({ inventory: twoDaggers });
        const sold = gameReducer(state, {
            type: 'SELL_ITEM',
            payload: { itemKey: 'dagger', _meta: { sourceId: 'msg-sell-1', playerMessage: 'I sell my dagger.' } },
        });
        const nextAssistant = gameReducer(sold, {
            type: 'ADD_MESSAGE',
            payload: { id: 'msg-sell-2', role: 'assistant', content: 'The fence waits.' },
        });
        const second = gameReducer(nextAssistant, {
            type: 'SELL_ITEM',
            payload: { itemKey: 'dagger', _meta: { sourceId: 'msg-sell-2', playerMessage: 'I sell the other dagger too.' } },
        });

        expect(second.character.gold).toBe(7);
        expect(second.inventory.filter(i => i.itemKey === 'dagger')).toHaveLength(0);
    });
});

describe('transaction replay phrasing', () => {
    it('honors quantified repeat phrasing like "a few more of those"', () => {
        const state = makeState();
        const bought = gameReducer(state, {
            type: 'PURCHASE_ITEM',
            payload: { itemKey: 'dagger', _meta: { sourceId: 'msg-buy-1', playerMessage: 'I buy a dagger.' } },
        });
        const nextAssistant = gameReducer(bought, {
            type: 'ADD_MESSAGE',
            payload: { id: 'msg-buy-2', role: 'assistant', content: 'The smith raises an eyebrow.' },
        });
        const second = gameReducer(nextAssistant, {
            type: 'PURCHASE_ITEM',
            payload: { itemKey: 'dagger', _meta: { sourceId: 'msg-buy-2', playerMessage: 'A few more of those, please.' } },
        });

        expect(second.character.gold).toBe(1); // both purchases charged
        expect(second.inventory.filter(i => i.itemKey === 'dagger')).toHaveLength(2);
    });
});

describe('CLAIM_LOOT_SOURCE', () => {
    it('records a source id the first time', () => {
        const state = makeState();
        const next = gameReducer(state, { type: 'CLAIM_LOOT_SOURCE', payload: 'msg-1' });
        expect(next.appliedLootSourceIds).toEqual(['msg-1']);
    });

    it('is a no-op for an already-claimed source id', () => {
        const state = { ...makeState(), appliedLootSourceIds: ['msg-1'] };
        const next = gameReducer(state, { type: 'CLAIM_LOOT_SOURCE', payload: 'msg-1' });
        expect(next).toBe(state);
    });

    it('ignores an empty payload', () => {
        const state = makeState();
        const next = gameReducer(state, { type: 'CLAIM_LOOT_SOURCE', payload: null });
        expect(next).toBe(state);
    });

    it('caps history at the most recent 500 entries', () => {
        const existing = Array.from({ length: 500 }, (_, i) => `msg-${i}`);
        const state = { ...makeState(), appliedLootSourceIds: existing };
        const next = gameReducer(state, { type: 'CLAIM_LOOT_SOURCE', payload: 'msg-new' });
        expect(next.appliedLootSourceIds).toHaveLength(500);
        expect(next.appliedLootSourceIds.at(-1)).toBe('msg-new');
        expect(next.appliedLootSourceIds).not.toContain('msg-0');
    });
});

describe('LEVEL_UP', () => {
    it('awards a milestone level-up and appends narration messages', () => {
        const state = makeState({
            character: {
                level: 1,
                exp: 0,
                currentHP: 12,
                maxHP: 12,
                class: 'fighter',
                abilityScores: {
                    strength: 16, dexterity: 12, constitution: 14,
                    intelligence: 10, wisdom: 10, charisma: 8,
                },
            },
        });
        const next = gameReducer(state, {
            type: 'LEVEL_UP',
            payload: { reason: 'defeated the warlord' },
        });
        expect(next.character.level).toBeGreaterThan(1);
        expect(next.messages.length).toBeGreaterThan(0);
    });

    it('marks xpAwarded on the active combat state', () => {
        const state = {
            ...makeState({
                character: {
                    level: 1,
                    exp: 0,
                    currentHP: 12,
                    maxHP: 12,
                    class: 'fighter',
                    abilityScores: {
                        strength: 16, dexterity: 12, constitution: 14,
                        intelligence: 10, wisdom: 10, charisma: 8,
                    },
                },
            }),
            combat: { ...initialGameState.combat, active: true },
        };
        const next = gameReducer(state, { type: 'LEVEL_UP', payload: {} });
        expect(next.combat.xpAwarded).toBe(true);
    });
});
