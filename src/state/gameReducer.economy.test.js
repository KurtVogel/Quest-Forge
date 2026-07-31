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

    it('strips a hostile id and equipped flag from the purchase payload (2026-07-30)', () => {
        // The DM payload spread used to land AFTER the minted defaults, so a
        // supplied id could collide (double-delete class) and equipped: true
        // could displace the hero's active armor without normalizeEquippedSlots.
        const state = makeState({
            inventory: [
                { id: 'armor-1', itemKey: 'leatherArmor', name: 'Leather Armor', type: 'armor', equipped: true },
            ],
        });
        const next = gameReducer(state, {
            type: 'PURCHASE_ITEM',
            payload: { itemKey: 'chainShirt', priceCp: 100, id: 'armor-1', equipped: true },
        });
        const bought = next.inventory.find(i => i.itemKey === 'chainShirt');
        expect(bought).toBeTruthy();
        expect(bought.id).not.toBe('armor-1');
        expect(bought.equipped).toBe(false);
        // The previously equipped armor keeps its slot.
        expect(next.inventory.find(i => i.id === 'armor-1').equipped).toBe(true);
    });

    it('measures the duplicate-purchase window in conversational distance — system lines never age the guard (2026-07-30)', () => {
        const state = makeState();
        const first = gameReducer(state, {
            type: 'PURCHASE_ITEM',
            payload: { itemKey: 'dagger', _meta: { sourceId: 'msg-a' } },
        });
        // A dice-heavy turn: many raw messages, but almost no conversational ones.
        const noisy = {
            ...first,
            messages: [
                ...first.messages,
                { role: 'user', content: 'I try the lock' },
                { role: 'system', content: '**Check** rolled 14' },
                { role: 'system', content: '**XP** +10' },
                { role: 'assistant', content: 'setup', hidden: true },
                { role: 'system', content: 'roll detail' },
                { role: 'system', content: 'roll detail 2' },
                { role: 'assistant', content: 'The lock clicks open.' },
                { role: 'system', content: 'autosave note' },
                { role: 'system', content: 'another system line' },
            ],
        };
        // Raw index distance is ~9 (past the window); conversational distance is 3.
        const next = gameReducer(noisy, {
            type: 'PURCHASE_ITEM',
            payload: { itemKey: 'dagger', _meta: { sourceId: 'msg-b' } },
        });
        expect(next.messages.at(-1).content).toMatch(/Duplicate purchase ignored/);
        expect(next.character.gold).toBe(first.character.gold);
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

describe('APPLY_COIN_LOSS', () => {
    function addMessages(state, count, prefix = 'loss-msg') {
        let next = state;
        for (let i = 0; i < count; i++) {
            next = gameReducer(next, {
                type: 'ADD_MESSAGE',
                payload: { id: `${prefix}-${i}`, role: 'assistant', content: `Filler line ${i}.` },
            });
        }
        return next;
    }

    it('deducts the coins and remembers the loss in the ledger', () => {
        const state = makeState({ character: { gold: 0, silver: 10, copper: 0 } });
        const next = gameReducer(state, {
            type: 'APPLY_COIN_LOSS',
            payload: { silver: 6, _meta: { sourceId: 'msg-pay-1', playerMessage: 'I pay the innkeeper.' } },
        });
        expect(next.character.silver).toBe(4);
        expect(next.recentCoinLosses).toHaveLength(1);
        expect(next.recentCoinLosses[0].status).toBe('applied');
    });

    it('suppresses an identical loss re-emitted on a later turn (the payment echo)', () => {
        const state = makeState({ character: { gold: 0, silver: 10, copper: 0 } });
        const paid = gameReducer(state, {
            type: 'APPLY_COIN_LOSS',
            payload: { silver: 2, _meta: { sourceId: 'msg-pay-1', playerMessage: 'You only took four — the price was six.' } },
        });
        const later = addMessages(paid, 2);
        const replayed = gameReducer(later, {
            type: 'APPLY_COIN_LOSS',
            payload: { silver: 2, _meta: { sourceId: 'msg-pay-2', playerMessage: 'I head for the stables.' } },
        });
        expect(replayed.character.silver).toBe(8); // one 2-silver charge, not two
        expect(replayed.messages.at(-1).content).toMatch(/Duplicate coin charge ignored/);
        expect(replayed.recentCoinLosses.at(-1).status).toBe('ignored');
    });

    it('allows an identical loss when the player initiates a new payment this turn', () => {
        const state = makeState({ character: { gold: 0, silver: 10, copper: 0 } });
        const paid = gameReducer(state, {
            type: 'APPLY_COIN_LOSS',
            payload: { silver: 2, _meta: { sourceId: 'msg-pay-1', playerMessage: 'I tip the barmaid two silver.' } },
        });
        const later = addMessages(paid, 2);
        const second = gameReducer(later, {
            type: 'APPLY_COIN_LOSS',
            payload: { silver: 2, _meta: { sourceId: 'msg-pay-2', playerMessage: 'I tip the stable boy as well.' } },
        });
        expect(second.character.silver).toBe(6);
    });

    it('always suppresses an exact same-source replay, even with payment phrasing', () => {
        const state = makeState({ character: { gold: 0, silver: 10, copper: 0 } });
        const paid = gameReducer(state, {
            type: 'APPLY_COIN_LOSS',
            payload: { silver: 2, _meta: { sourceId: 'msg-pay-1', playerMessage: 'I pay him two silver.' } },
        });
        const replayed = gameReducer(paid, {
            type: 'APPLY_COIN_LOSS',
            payload: { silver: 2, _meta: { sourceId: 'msg-pay-1', playerMessage: 'I pay him two silver.' } },
        });
        expect(replayed.character.silver).toBe(8);
    });

    it('applies an identical loss again once outside the replay window', () => {
        const state = makeState({ character: { gold: 0, silver: 10, copper: 0 } });
        const paid = gameReducer(state, {
            type: 'APPLY_COIN_LOSS',
            payload: { silver: 2, _meta: { sourceId: 'msg-pay-1' } },
        });
        const later = addMessages(paid, 6);
        const second = gameReducer(later, {
            type: 'APPLY_COIN_LOSS',
            payload: { silver: 2, _meta: { sourceId: 'msg-pay-2' } },
        });
        expect(second.character.silver).toBe(6);
    });

    it('reports insufficient funds without paying, and still stamps the ledger', () => {
        const state = makeState({ character: { gold: 0, silver: 1, copper: 0 } });
        const next = gameReducer(state, {
            type: 'APPLY_COIN_LOSS',
            payload: { silver: 6, _meta: { sourceId: 'msg-pay-1' } },
        });
        expect(next.character.silver).toBe(1);
        expect(next.messages.at(-1).content).toMatch(/Not enough coin/);
        expect(next.recentCoinLosses).toHaveLength(1);
    });

    it('ignores empty and negative losses', () => {
        const state = makeState();
        const next = gameReducer(state, {
            type: 'APPLY_COIN_LOSS',
            payload: { gold: -3, silver: 0 },
        });
        expect(next).toBe(state);
    });

    it('blocks the audit backstop from re-charging a payment the DM already evented', () => {
        const state = makeState({ character: { gold: 0, silver: 10, copper: 0 } });
        const paid = gameReducer(state, {
            type: 'APPLY_COIN_LOSS',
            payload: { silver: 6, _meta: { sourceId: 'msg-pay-1' } },
        });
        const later = addMessages(paid, 1);
        const audited = gameReducer(later, {
            type: 'AUDIT_COIN_PAYMENT',
            payload: { silver: 6, _meta: { sourceId: 'msg-pay-2:payment', playerMessage: 'I nod and move on.' } },
        });
        expect(audited.character.silver).toBe(4); // charged once, not twice
        expect(audited.messages.at(-1).content).toMatch(/Duplicate payment ignored/);
    });

    it('blocks a DM coin-loss echo of a payment the audit already settled', () => {
        const state = makeState({ character: { gold: 0, silver: 10, copper: 0 } });
        const audited = gameReducer(state, {
            type: 'AUDIT_COIN_PAYMENT',
            payload: { silver: 6, _meta: { sourceId: 'msg-pay-1:payment' } },
        });
        const later = addMessages(audited, 1);
        const replayed = gameReducer(later, {
            type: 'APPLY_COIN_LOSS',
            payload: { silver: 6, _meta: { sourceId: 'msg-pay-2', playerMessage: 'I keep walking.' } },
        });
        expect(replayed.character.silver).toBe(4);
        expect(replayed.messages.at(-1).content).toMatch(/Duplicate coin charge ignored/);
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

describe('audit ledger policy: no player-phrasing bypass, same-base reconciliation (2026-07-31 double-charge fix)', () => {
    function addMessages(state, count, prefix = 'audit-msg') {
        let next = state;
        for (let i = 0; i < count; i++) {
            next = gameReducer(next, {
                type: 'ADD_MESSAGE',
                payload: { id: `${prefix}-${i}`, role: 'assistant', content: `Filler line ${i}.` },
            });
        }
        return next;
    }

    it('suppresses a cross-message audit duplicate even when the player message initiates a payment', () => {
        // The live bug: "I give 1 gp..." always contains a payment verb, so the old
        // repeat-intent bypass fired on exactly the turns the audit was re-charging.
        const state = makeState({ character: { gold: 0, silver: 10, copper: 0 } });
        const paid = gameReducer(state, {
            type: 'APPLY_COIN_LOSS',
            payload: { silver: 2, _meta: { sourceId: 'msg-pay-1' } },
        });
        const later = addMessages(paid, 1);
        const audited = gameReducer(later, {
            type: 'AUDIT_COIN_PAYMENT',
            payload: { silver: 2, _meta: { sourceId: 'msg-pay-2:scribe-loot:payment', playerMessage: 'I tip her two silver.' } },
        });
        expect(audited.character.silver).toBe(8); // charged once — the audit is a backstop, never a payer of record
        expect(audited.messages.at(-1).content).toMatch(/Duplicate payment ignored/);
    });

    it('lets an engine-reconciled same-message shortfall through despite an equal event-path charge', () => {
        // Event path deducted 2s for msg-A; the narrative showed 4s total, so the
        // reconciled audit legitimately charges the remaining 2s under the same base.
        const state = makeState({ character: { gold: 0, silver: 10, copper: 0 } });
        const paid = gameReducer(state, {
            type: 'APPLY_COIN_LOSS',
            payload: { silver: 2, _meta: { sourceId: 'msg-A' } },
        });
        const audited = gameReducer(paid, {
            type: 'AUDIT_COIN_PAYMENT',
            payload: { silver: 2, _meta: { sourceId: 'msg-A:scribe-loot:payment', audit: true } },
        });
        expect(audited.character.silver).toBe(6);
        expect(audited.messages.at(-1).content).toMatch(/Payment settled from narration/);
    });

    it('audit coin grants get no repeat-phrasing bypass on cross-message duplicates', () => {
        const state = makeState();
        const granted = gameReducer(state, {
            type: 'ADD_COIN_GRANT',
            payload: { gold: 10, _meta: { sourceId: 'msg-r-1' } },
        });
        const later = addMessages(granted, 1);
        const audited = gameReducer(later, {
            type: 'ADD_COIN_GRANT',
            payload: { gold: 10, _meta: { sourceId: 'msg-r-2:scribe-loot', announce: 'audit', audit: true, playerMessage: 'I collect another 10 gold reward.' } },
        });
        expect(audited.character.gold).toBe(state.character.gold + 10); // once, not twice
        expect(audited.recentCoinGrants.at(-1).status).toBe('ignored');
    });

    it('a same-base reconciled audit grant is not eaten by its event-path twin', () => {
        const state = makeState();
        const granted = gameReducer(state, {
            type: 'ADD_COIN_GRANT',
            payload: { gold: 10, _meta: { sourceId: 'msg-A' } },
        });
        const audited = gameReducer(granted, {
            type: 'ADD_COIN_GRANT',
            payload: { gold: 10, _meta: { sourceId: 'msg-A:scribe-loot', announce: 'audit', audit: true } },
        });
        expect(audited.character.gold).toBe(state.character.gold + 20);
    });
});

describe('recap-bundle guard (2026-07-31 playtest: fountain turn charged the beggar\'s gold again)', () => {
    function addMessages(state, count, prefix = 'bundle-msg') {
        let next = state;
        for (let i = 0; i < count; i++) {
            next = gameReducer(next, {
                type: 'ADD_MESSAGE',
                payload: { id: `${prefix}-${i}`, role: 'assistant', content: `Filler line ${i}.` },
            });
        }
        return next;
    }

    it('strips a recent payment bundled into a new coin loss and charges only the remainder', () => {
        // Live repro: gave 1 gp to the beggar (evented), then the fountain response
        // bundled "gold_lost": 1 + "copper_lost": 3 — 103 cp, a novel signature.
        const state = makeState({ character: { gold: 5, silver: 0, copper: 10 } });
        const paid = gameReducer(state, {
            type: 'APPLY_COIN_LOSS',
            payload: { gold: 1, _meta: { sourceId: 'msg-beggar', playerMessage: 'I give 1 gold piece to the beggar.' } },
        });
        const later = addMessages(paid, 1);
        const bundled = gameReducer(later, {
            type: 'APPLY_COIN_LOSS',
            payload: { gold: 1, copper: 3, _meta: { sourceId: 'msg-fountain', playerMessage: 'I toss 3 copper coins into the wishing fountain and make a wish.' } },
        });
        expect(bundled.character.gold).toBe(4); // one gold total, not two
        expect(bundled.character.copper).toBe(7);
        expect(bundled.messages.at(-1).content).toMatch(/Adjusted a bundled coin charge/);
    });

    it('keeps the full charge when the player names the repeated denomination', () => {
        const state = makeState({ character: { gold: 5, silver: 0, copper: 10 } });
        const paid = gameReducer(state, {
            type: 'APPLY_COIN_LOSS',
            payload: { gold: 1, _meta: { sourceId: 'msg-1', playerMessage: 'I pay him a gold piece.' } },
        });
        const later = addMessages(paid, 1);
        const second = gameReducer(later, {
            type: 'APPLY_COIN_LOSS',
            payload: { gold: 1, copper: 3, _meta: { sourceId: 'msg-2', playerMessage: 'I hand her a gold piece and three coppers for the lot.' } },
        });
        expect(second.character.gold).toBe(3); // intentional second gold payment stands
        expect(second.character.copper).toBe(7);
    });

    it('keeps the full charge outside the replay window', () => {
        const state = makeState({ character: { gold: 5, silver: 0, copper: 10 } });
        const paid = gameReducer(state, {
            type: 'APPLY_COIN_LOSS',
            payload: { gold: 1, _meta: { sourceId: 'msg-1' } },
        });
        const later = addMessages(paid, 6);
        const second = gameReducer(later, {
            type: 'APPLY_COIN_LOSS',
            payload: { gold: 1, copper: 3, _meta: { sourceId: 'msg-2', playerMessage: 'I drop the coins in the box.' } },
        });
        expect(second.character.gold).toBe(3);
        expect(second.character.copper).toBe(7);
    });

    it('strips a recent reward bundled into a new coin grant', () => {
        const state = makeState();
        const granted = gameReducer(state, {
            type: 'ADD_COIN_GRANT',
            payload: { gold: 10, _meta: { sourceId: 'msg-reward' } },
        });
        const later = addMessages(granted, 1);
        const bundled = gameReducer(later, {
            type: 'ADD_COIN_GRANT',
            payload: { gold: 10, silver: 5, _meta: { sourceId: 'msg-find', playerMessage: 'I check under the floorboard.' } },
        });
        expect(bundled.character.gold).toBe(state.character.gold + 10); // reward once
        expect(bundled.character.silver).toBe(5);
        expect(bundled.messages.at(-1).content).toMatch(/Adjusted a bundled coin grant/);
    });
});

describe('coin replay guards: denomination drift + conversational window (2026-07-22 live finding)', () => {
    function addMessage(state, message) {
        return gameReducer(state, { type: 'ADD_MESSAGE', payload: message });
    }

    it('suppresses a payment re-emitted with drifted denominations (12 silver recapped as 1 gold 2 silver)', () => {
        const paid = gameReducer(makeState(), {
            type: 'APPLY_COIN_LOSS',
            payload: { silver: 12, _meta: { sourceId: 'msg-pay-1', playerMessage: 'I pay her twelve silver.' } },
        });
        const startCp = paid.character.gold * 100 + paid.character.silver * 10 + (paid.character.copper || 0);

        const replayed = gameReducer(addMessage(paid, { id: 'm1', role: 'assistant', content: 'You walk out.' }), {
            type: 'APPLY_COIN_LOSS',
            payload: { gold: 1, silver: 2, _meta: { sourceId: 'msg-pay-2', playerMessage: 'We head home through the fog.' } },
        });

        const endCp = replayed.character.gold * 100 + replayed.character.silver * 10 + (replayed.character.copper || 0);
        expect(endCp).toBe(startCp); // same 120 cp value — the drifted recap charges nothing
        expect(replayed.recentCoinLosses.at(-1).status).toBe('ignored');
    });

    it('keeps the grant guard alive across a dice turn: system and hidden messages do not age the window', () => {
        const granted = gameReducer(makeState(), {
            type: 'ADD_COIN_GRANT',
            payload: { gold: 20, _meta: { sourceId: 'msg-fee-1', playerMessage: 'I collect the fee.' } },
        });
        // A single check turn burns ~5 raw messages: XP line, user, hidden setup,
        // two roll system lines — plus one visible outcome. Raw distance 7 killed
        // the old window; conversational distance is only 3.
        let state = granted;
        state = addMessage(state, { id: 'm1', role: 'system', content: '**Experience gained:** +100 XP.' });
        state = addMessage(state, { id: 'm2', role: 'user', content: 'I pay Sorsa and we slip home.' });
        state = addMessage(state, { id: 'm3', role: 'assistant', content: 'Setup narration.', hidden: true });
        state = addMessage(state, { id: 'm4', role: 'system', content: 'Check (DC 12): Rolled 23 — Success!' });
        state = addMessage(state, { id: 'm5', role: 'system', content: '[ROLL RESULT: rolled 23 — SUCCESS]', hidden: true });
        state = addMessage(state, { id: 'm6', role: 'assistant', content: 'You ghost home, the fee secure in your pouch.' });

        const replayed = gameReducer(state, {
            type: 'ADD_COIN_GRANT',
            payload: { gold: 20, _meta: { sourceId: 'msg-fee-recap', playerMessage: 'We settle in at the hideout.' } },
        });

        expect(replayed.character.gold).toBe(granted.character.gold); // no second 20 gp
        expect(replayed.recentCoinGrants.at(-1).status).toBe('ignored');
    });

    it('still allows an identical grant once genuine conversation has moved on', () => {
        const granted = gameReducer(makeState(), {
            type: 'ADD_COIN_GRANT',
            payload: { gold: 20, _meta: { sourceId: 'msg-fee-1' } },
        });
        let state = granted;
        for (let i = 0; i < 6; i++) {
            state = addMessage(state, { id: `u${i}`, role: 'user', content: `Later scene beat ${i}.` });
            state = addMessage(state, { id: `a${i}`, role: 'assistant', content: `The story moves on ${i}.` });
        }
        const second = gameReducer(state, {
            type: 'ADD_COIN_GRANT',
            payload: { gold: 20, _meta: { sourceId: 'msg-fee-2' } },
        });
        expect(second.character.gold).toBe(granted.character.gold + 20); // a genuinely new, later 20 gp job
    });
});
