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

    it('clamps an absurd quantity so a flat priceCp cannot mint an unbounded stack', () => {
        const state = makeState();
        const next = gameReducer(state, {
            type: 'PURCHASE_ITEM',
            payload: { itemKey: 'dagger', quantity: 999999999, priceCp: 1 },
        });
        const dagger = next.inventory.find(i => i.itemKey === 'dagger');
        expect(dagger.quantity).toBe(100);
        expect(next.messages.at(-1).content).toMatch(/Bought 100x/);
    });

    it('treats a negative priceCp as free rather than paying the buyer', () => {
        const state = makeState();
        const next = gameReducer(state, {
            type: 'PURCHASE_ITEM',
            payload: { itemKey: 'dagger', priceCp: -5000 },
        });
        expect(next.character.gold).toBe(5);
        expect(next.character.silver).toBe(0);
        expect(next.character.copper).toBe(0);
        expect(next.inventory.some(i => i.itemKey === 'dagger')).toBe(true);
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

    it('caps the priceCp override at the 10,000 gp coin ceiling', () => {
        const state = makeState({
            inventory: [{ id: 'gem-1', name: 'Kingsgem', type: 'treasure', valueCp: 200, quantity: 1 }],
        });
        const next = gameReducer(state, {
            type: 'SELL_ITEM',
            payload: { itemId: 'gem-1', priceCp: 99999999999 },
        });
        expect(next.character.gold).toBe(10005); // 5gp + capped 1,000,000 cp
    });

    it('caps default half-value proceeds from a legacy item with an unclamped valueCp', () => {
        const state = makeState({
            inventory: [{ id: 'relic-1', name: 'Hoard Relic', type: 'treasure', valueCp: 90000000, quantity: 1 }],
        });
        const next = gameReducer(state, {
            type: 'SELL_ITEM',
            payload: { itemId: 'relic-1' },
        });
        expect(next.character.gold).toBe(10005);
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

describe('ADD_COIN_GRANT', () => {
    function addMessages(state, count, prefix = 'msg') {
        let next = state;
        for (let i = 0; i < count; i++) {
            next = gameReducer(next, {
                type: 'ADD_MESSAGE',
                payload: { id: `${prefix}-${i}`, role: 'assistant', content: `Filler line ${i}.` },
            });
        }
        return next;
    }

    it('applies a coin grant and remembers it in the ledger', () => {
        const state = makeState();
        const next = gameReducer(state, {
            type: 'ADD_COIN_GRANT',
            payload: { gold: 20, silver: 5, _meta: { sourceId: 'msg-reward-1' } },
        });
        expect(next.character.gold).toBe(25);
        expect(next.character.silver).toBe(5);
        expect(next.recentCoinGrants).toHaveLength(1);
        expect(next.recentCoinGrants[0].status).toBe('applied');
    });

    it('suppresses an identical grant re-emitted within the replay window', () => {
        const state = makeState();
        const granted = gameReducer(state, {
            type: 'ADD_COIN_GRANT',
            payload: { gold: 20, _meta: { sourceId: 'msg-reward-1', playerMessage: 'I accept the reward.' } },
        });
        const later = addMessages(granted, 2);
        const replayed = gameReducer(later, {
            type: 'ADD_COIN_GRANT',
            payload: { gold: 20, _meta: { sourceId: 'msg-reward-2', playerMessage: 'I count the coins and split them.' } },
        });
        expect(replayed.character.gold).toBe(25); // 5 base + one 20gp grant, not two
        expect(replayed.messages.at(-1).content).toMatch(/Duplicate coin grant ignored/);
        expect(replayed.recentCoinGrants.at(-1).status).toBe('ignored');
    });

    it('allows the identical grant when the player explicitly asked for more coin', () => {
        const state = makeState();
        const granted = gameReducer(state, {
            type: 'ADD_COIN_GRANT',
            payload: { gold: 20, _meta: { sourceId: 'msg-reward-1' } },
        });
        const later = addMessages(granted, 2);
        const repeat = gameReducer(later, {
            type: 'ADD_COIN_GRANT',
            payload: { gold: 20, _meta: { sourceId: 'msg-reward-2', playerMessage: 'I demand another 20 gold for the second wagon.' } },
        });
        expect(repeat.character.gold).toBe(45);
    });

    it('always suppresses an exact same-source replay, even with repeat phrasing', () => {
        const state = makeState();
        const granted = gameReducer(state, {
            type: 'ADD_COIN_GRANT',
            payload: { gold: 20, _meta: { sourceId: 'msg-reward-1' } },
        });
        const replayed = gameReducer(granted, {
            type: 'ADD_COIN_GRANT',
            payload: { gold: 20, _meta: { sourceId: 'msg-reward-1', playerMessage: 'Give me another 20 gold coins.' } },
        });
        expect(replayed.character.gold).toBe(25);
    });

    it('applies an identical grant again once outside the replay window', () => {
        const state = makeState();
        const granted = gameReducer(state, {
            type: 'ADD_COIN_GRANT',
            payload: { gold: 10, _meta: { sourceId: 'msg-loot-1' } },
        });
        const later = addMessages(granted, 6);
        const second = gameReducer(later, {
            type: 'ADD_COIN_GRANT',
            payload: { gold: 10, _meta: { sourceId: 'msg-loot-2' } },
        });
        expect(second.character.gold).toBe(25);
    });

    it('announces audit-recovered coins with a visible system line', () => {
        const state = makeState();
        const next = gameReducer(state, {
            type: 'ADD_COIN_GRANT',
            payload: { gold: 15, _meta: { sourceId: 'msg-1:scribe-loot', announce: 'audit' } },
        });
        expect(next.character.gold).toBe(20);
        expect(next.messages.at(-1).content).toMatch(/Coins recovered from narration/);
    });

    it('ignores empty and negative grants', () => {
        const state = makeState();
        const next = gameReducer(state, {
            type: 'ADD_COIN_GRANT',
            payload: { gold: -5, silver: 0 },
        });
        expect(next).toBe(state);
    });
});

describe('AUDIT_COIN_PAYMENT', () => {
    it('deducts a narrated payment the engine missed and says so', () => {
        const state = makeState();
        const next = gameReducer(state, {
            type: 'AUDIT_COIN_PAYMENT',
            payload: { gold: 2 },
        });
        expect(next.character.gold).toBe(3);
        expect(next.messages.at(-1).content).toMatch(/Payment settled from narration/);
    });

    it('clamps the deduction to the purse when funds fall short', () => {
        const state = makeState({ character: { gold: 1, silver: 0, copper: 0 } });
        const next = gameReducer(state, {
            type: 'AUDIT_COIN_PAYMENT',
            payload: { gold: 5 },
        });
        expect(next.character.gold).toBe(0);
        expect(next.character.silver).toBe(0);
        expect(next.character.copper).toBe(0);
        expect(next.messages.at(-1).content).toMatch(/purse emptied/);
    });

    it('deducts nothing from an empty purse but leaves a visible note', () => {
        const state = makeState({ character: { gold: 0, silver: 0, copper: 0 } });
        const next = gameReducer(state, {
            type: 'AUDIT_COIN_PAYMENT',
            payload: { gold: 3 },
        });
        expect(next.character.gold).toBe(0);
        expect(next.messages.at(-1).content).toMatch(/purse is empty/);
    });
});
