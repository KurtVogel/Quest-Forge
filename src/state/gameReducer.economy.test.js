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

    it('resolves a drifted DM name through the shared ref ladder (2026-08-28)', () => {
        // The old lookup was exact-name-only: "hempen rope" failed against the
        // catalog-cased "Hempen Rope (50 ft)" even though every other item
        // channel resolved it.
        const state = makeState({
            inventory: [{ id: 'rope-1', itemKey: 'ropeHempen', name: 'Hempen Rope (50 ft)', type: 'gear', valueCp: 100, quantity: 1 }],
        });
        const next = gameReducer(state, {
            type: 'SELL_ITEM',
            payload: { name: 'hempen rope' },
        });
        expect(next.inventory.find(i => i.id === 'rope-1')).toBeUndefined();
        expect(next.messages.at(-1).content).toMatch(/Sold Hempen Rope/);
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

    it('a stray repeat word plus a distant pronoun is NOT repeat purchase intent (2026-08-22)', () => {
        const state = makeState();
        const bought = gameReducer(state, {
            type: 'PURCHASE_ITEM',
            payload: { itemKey: 'dagger', _meta: { sourceId: 'msg-buy-1', playerMessage: 'I buy a dagger.' } },
        });
        const nextAssistant = gameReducer(bought, {
            type: 'ADD_MESSAGE',
            payload: { id: 'msg-buy-2', role: 'assistant', content: 'The smith nods.' },
        });
        const replayed = gameReducer(nextAssistant, {
            type: 'PURCHASE_ITEM',
            payload: {
                itemKey: 'dagger',
                // "another" (an idiom) and "them" live in different sentences —
                // the old fallback read this as "buy another one".
                _meta: { sourceId: 'msg-buy-2', playerMessage: 'Another time, maybe. I nod to the guards and walk past them.' },
            },
        });

        expect(replayed.character.gold).toBe(3); // only the first purchase charged
        expect(replayed.inventory.filter(i => i.itemKey === 'dagger')).toHaveLength(1);
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

    it('does NOT treat unrelated "another"+coin co-occurrence as repeat intent (live playtest #10)', () => {
        // 2026-08-22: "Another time, Odo… I count three silver out of my purse"
        // — "another" is an idiom for NOT NOW and the coins flow AWAY from the
        // hero, yet the old co-occurrence test authorized the DM's replayed
        // 200 cp reward. Repeat intent must attach the quantifier to the coin.
        const state = makeState();
        const granted = gameReducer(state, {
            type: 'ADD_COIN_GRANT',
            payload: { silver: 20, _meta: { sourceId: 'msg-reward-1', playerMessage: 'Odo. Job\'s done. Twenty silver, as agreed.' } },
        });
        const later = addMessages(granted, 2);
        const replayed = gameReducer(later, {
            type: 'ADD_COIN_GRANT',
            payload: {
                silver: 20,
                _meta: {
                    sourceId: 'msg-pay-ferry',
                    playerMessage: 'Another time, Odo. Got a debt of my own to square first. I count three silver out of my purse and press them into his hand.',
                },
            },
        });
        const totalCp = c => (c.gold || 0) * 100 + (c.silver || 0) * 10 + (c.copper || 0);
        expect(totalCp(replayed.character)).toBe(totalCp(granted.character));
        expect(replayed.messages.at(-1).content).toMatch(/Duplicate coin grant ignored/);
    });

    it('still allows a repeat when the quantifier attaches to the coins ("pay me the rest")', () => {
        const state = makeState();
        const granted = gameReducer(state, {
            type: 'ADD_COIN_GRANT',
            payload: { gold: 20, _meta: { sourceId: 'msg-reward-1' } },
        });
        const later = addMessages(granted, 2);
        const repeat = gameReducer(later, {
            type: 'ADD_COIN_GRANT',
            payload: { gold: 20, _meta: { sourceId: 'msg-reward-2', playerMessage: 'That was half. Now pay me the rest.' } },
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

    // 2026-08-31 P1 (live merchant-quest double-pay): the reward paid at the
    // handover was re-emitted at quest completion, >4 conversational messages
    // later — travel + report-back routinely burns past the tight window.
    it('suppresses a quest-completion-adjacent re-grant beyond the tight window (P1 2026-08-31)', () => {
        const state = makeState();
        const granted = gameReducer(state, {
            type: 'ADD_COIN_GRANT',
            payload: { gold: 20, _meta: { sourceId: 'msg-handover' } },
        });
        const later = addMessages(granted, 8);
        const replayed = gameReducer(later, {
            type: 'ADD_COIN_GRANT',
            payload: {
                gold: 20,
                _meta: { sourceId: 'msg-completion', questCompletionAdjacent: true, playerMessage: 'The caravan is safe. I report back to the merchant.' },
            },
        });
        expect(replayed.character.gold).toBe(25);
        expect(replayed.messages.at(-1).content).toMatch(/Duplicate coin grant ignored/);
    });

    it('a quest-completion-adjacent grant still pays on explicit repeat phrasing (never refuse to give)', () => {
        const state = makeState();
        const granted = gameReducer(state, {
            type: 'ADD_COIN_GRANT',
            payload: { gold: 20, _meta: { sourceId: 'msg-handover' } },
        });
        const later = addMessages(granted, 8);
        const repeat = gameReducer(later, {
            type: 'ADD_COIN_GRANT',
            payload: {
                gold: 20,
                _meta: { sourceId: 'msg-completion', questCompletionAdjacent: true, playerMessage: 'You promised another 20 gold on completion — pay up.' },
            },
        });
        expect(repeat.character.gold).toBe(45);
    });

    it('suppresses an audit recovery beyond the tight window (audits use the wide horizon)', () => {
        const state = makeState();
        const granted = gameReducer(state, {
            type: 'ADD_COIN_GRANT',
            payload: { gold: 20, _meta: { sourceId: 'msg-handover' } },
        });
        const later = addMessages(granted, 8);
        const audited = gameReducer(later, {
            type: 'ADD_COIN_GRANT',
            payload: { gold: 20, _meta: { sourceId: 'msg-recap:scribe-loot', announce: 'audit', audit: true } },
        });
        expect(audited.character.gold).toBe(25);
        expect(audited.recentCoinGrants.at(-1).status).toBe('ignored');
    });

    it('coin lines are stamped dmVisible so the DM window carries the receipt (P1 root fix)', () => {
        const state = makeState();
        const granted = gameReducer(state, {
            type: 'ADD_COIN_GRANT',
            payload: { gold: 20, _meta: { sourceId: 'msg-reward-1' } },
        });
        const line = granted.messages.at(-1);
        expect(line.role).toBe('system');
        expect(line.content).toMatch(/received — purse:/);
        expect(line.dmVisible).toBe(true);
        const charged = gameReducer(granted, {
            type: 'APPLY_COIN_LOSS',
            payload: { gold: 5, _meta: { sourceId: 'msg-toll' } },
        });
        expect(charged.messages.at(-1).dmVisible).toBe(true);
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

    it('allows a same-value loss when the player message itself makes a purchase (live 2026-08-06)', () => {
        // 1 sp caravan passage, then "I buy a bowl of mutton stew" (also 1 sp)
        // two messages later — the second charge was suppressed even though the
        // player explicitly initiated a new purchase with no coin word in it.
        const state = makeState({ character: { gold: 0, silver: 10, copper: 0 } });
        const paid = gameReducer(state, {
            type: 'APPLY_COIN_LOSS',
            payload: { silver: 1, _meta: { sourceId: 'msg-pay-1', playerMessage: 'I pay for passage with the caravan.' } },
        });
        const later = addMessages(paid, 2);
        const second = gameReducer(later, {
            type: 'APPLY_COIN_LOSS',
            payload: { silver: 1, _meta: { sourceId: 'msg-pay-2', playerMessage: 'I buy a bowl of mutton stew.' } },
        });
        expect(second.character.silver).toBe(8); // both charges land
        expect(second.recentCoinLosses.at(-1).status).toBe('applied');
    });

    it('still suppresses a same-value recap when the message has no purchase phrasing', () => {
        const state = makeState({ character: { gold: 0, silver: 10, copper: 0 } });
        const paid = gameReducer(state, {
            type: 'APPLY_COIN_LOSS',
            payload: { silver: 1, _meta: { sourceId: 'msg-pay-1', playerMessage: 'I pay for passage.' } },
        });
        const later = addMessages(paid, 2);
        const replayed = gameReducer(later, {
            type: 'APPLY_COIN_LOSS',
            payload: { silver: 1, _meta: { sourceId: 'msg-pay-2', playerMessage: 'I climb aboard the wagon.' } },
        });
        expect(replayed.character.silver).toBe(9); // recap eaten
        expect(replayed.recentCoinLosses.at(-1).status).toBe('ignored');
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
        // The spend-side window widened to 12 conversational messages on
        // 2026-08-25 (a payment recapped 3 turns later was still being charged).
        const later = addMessages(paid, 14);
        const second = gameReducer(later, {
            type: 'APPLY_COIN_LOSS',
            payload: { silver: 2, _meta: { sourceId: 'msg-pay-2' } },
        });
        expect(second.character.silver).toBe(6);
    });

    it('reports insufficient funds without paying, and does NOT ledger the unpaid charge', () => {
        // 2026-08-28 P1: an unpayable charge used to be remembered as an APPLIED
        // spend, feeding the covers/strips with a movement that never happened —
        // an exact-price purchase later arrived free, and a legitimate re-charge
        // of the never-paid debt was suppressed as "already paid".
        const state = makeState({ character: { gold: 0, silver: 1, copper: 0 } });
        const next = gameReducer(state, {
            type: 'APPLY_COIN_LOSS',
            payload: { silver: 6, _meta: { sourceId: 'msg-pay-1' } },
        });
        expect(next.character.silver).toBe(1);
        expect(next.messages.at(-1).content).toMatch(/Not enough coin/);
        expect(next.recentCoinLosses).toHaveLength(0);
    });

    it('a never-paid debt can be charged again once the hero can pay (no false "already paid")', () => {
        const state = makeState({ character: { gold: 0, silver: 1, copper: 0 } });
        const failed = gameReducer(state, {
            type: 'APPLY_COIN_LOSS',
            payload: { silver: 6, _meta: { sourceId: 'msg-pay-1' } },
        });
        // The hero earns coin, the DM legitimately re-charges the same debt.
        const funded = { ...failed, character: { ...failed.character, silver: 10 } };
        const recharged = gameReducer(funded, {
            type: 'APPLY_COIN_LOSS',
            payload: { silver: 6, _meta: { sourceId: 'msg-pay-2' } },
        });
        expect(recharged.character.silver).toBe(4);
    });

    it('an unpaid charge cannot cover a later audited payment of the same value', () => {
        const state = makeState({ character: { gold: 1, silver: 0, copper: 0 } });
        const failed = gameReducer(state, {
            type: 'APPLY_COIN_LOSS',
            payload: { gold: 2, _meta: { sourceId: 'msg-pay-1' } },
        });
        expect(failed.character.gold).toBe(1);
        // Later, funded, the Scribe audits a genuine unevented 2 gp payment —
        // the phantom "applied" loss used to satisfy the >=costCp cover and
        // deliver the payment free.
        const funded = { ...failed, character: { ...failed.character, gold: 3 } };
        const audited = gameReducer(funded, {
            type: 'AUDIT_COIN_PAYMENT',
            payload: { gold: 2, _meta: { sourceId: 'msg-audit-1:scribe-loot:payment' } },
        });
        expect(audited.character.gold).toBe(1);
        expect(audited.messages.at(-1).content).toMatch(/Payment settled from narration/);
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

    // 2026-08-28 P1: the ledger must only ever record coin that actually moved.
    it('does not ledger an empty-purse audit at all', () => {
        const state = makeState({ character: { gold: 0, silver: 0, copper: 0 } });
        const next = gameReducer(state, {
            type: 'AUDIT_COIN_PAYMENT',
            payload: { gold: 3, _meta: { sourceId: 'msg-a1:scribe-loot:payment' } },
        });
        expect(next.recentCoinLosses).toHaveLength(0);
    });

    it('a partial settle ledgers the value actually deducted, not the narrated charge', () => {
        const state = makeState({ character: { gold: 1, silver: 0, copper: 0 } });
        const next = gameReducer(state, {
            type: 'AUDIT_COIN_PAYMENT',
            payload: { gold: 5, _meta: { sourceId: 'msg-a2:scribe-loot:payment' } },
        });
        expect(next.character.gold).toBe(0);
        expect(next.recentCoinLosses).toHaveLength(1);
        // 100 cp was all the purse held — that is the movement of record, so a
        // later cover/strip can never pretend the full 500 cp charge happened.
        expect(next.recentCoinLosses[0].priceCp).toBe(100);
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

describe('direction covers (2026-08-20 playtest: reward misread as payment netted the coin to zero)', () => {
    const totalCp = character => (character.gold || 0) * 100 + (character.silver || 0) * 10 + (character.copper || 0);

    function addMessages(state, count, prefix = 'dir-msg') {
        let next = state;
        for (let i = 0; i < count; i++) {
            next = gameReducer(next, {
                type: 'ADD_MESSAGE',
                payload: { id: `${prefix}-${i}`, role: 'assistant', content: `Filler line ${i}.` },
            });
        }
        return next;
    }

    it('ignores an audit payment exactly matching a recent applied coin grant (the same handover read backwards)', () => {
        const state = makeState({ character: { gold: 0, silver: 30, copper: 0 } });
        const rewarded = gameReducer(state, {
            type: 'ADD_COIN_GRANT',
            payload: { silver: 20, _meta: { sourceId: 'msg-reward' } },
        });
        const later = addMessages(rewarded, 1);
        const audited = gameReducer(later, {
            type: 'AUDIT_COIN_PAYMENT',
            payload: { silver: 20, _meta: { sourceId: 'msg-recap:scribe-loot:payment', audit: true } },
        });
        expect(totalCp(audited.character)).toBe(500); // reward kept, nothing deducted
        expect(audited.messages.at(-1).content).toMatch(/Payment report ignored/);
        expect(audited.recentCoinLosses.at(-1).status).toBe('ignored');
    });

    it('still settles a genuine smaller unevented payment right after a windfall (exact-value match only)', () => {
        const state = makeState({ character: { gold: 0, silver: 30, copper: 0 } });
        const rewarded = gameReducer(state, {
            type: 'ADD_COIN_GRANT',
            payload: { silver: 20, _meta: { sourceId: 'msg-reward' } },
        });
        const later = addMessages(rewarded, 1);
        const audited = gameReducer(later, {
            type: 'AUDIT_COIN_PAYMENT',
            payload: { silver: 5, _meta: { sourceId: 'msg-room:scribe-loot:payment', audit: true } },
        });
        expect(totalCp(audited.character)).toBe(450); // +20 reward, −5 room
        expect(audited.messages.at(-1).content).toMatch(/Payment settled from narration/);
    });

    it('charges normally once the grant has aged out of the replay window', () => {
        const state = makeState({ character: { gold: 0, silver: 30, copper: 0 } });
        const rewarded = gameReducer(state, {
            type: 'ADD_COIN_GRANT',
            payload: { silver: 20, _meta: { sourceId: 'msg-reward' } },
        });
        const later = addMessages(rewarded, 14); // past the widened spend window
        const audited = gameReducer(later, {
            type: 'AUDIT_COIN_PAYMENT',
            payload: { silver: 20, _meta: { sourceId: 'msg-late:scribe-loot:payment', audit: true } },
        });
        expect(totalCp(audited.character)).toBe(300); // +20 then −20, both real by then
    });

    it('ignores an audit coin grant exactly matching a recent applied loss (a payment retold as a find)', () => {
        const state = makeState({ character: { gold: 10, silver: 0, copper: 0 } });
        const paid = gameReducer(state, {
            type: 'APPLY_COIN_LOSS',
            payload: { gold: 5, _meta: { sourceId: 'msg-toll' } },
        });
        const later = addMessages(paid, 1);
        const audited = gameReducer(later, {
            type: 'ADD_COIN_GRANT',
            payload: { gold: 5, _meta: { sourceId: 'msg-recap:scribe-loot', announce: 'audit', audit: true } },
        });
        expect(audited.character.gold).toBe(5); // the toll stays paid
        expect(audited.messages.at(-1).content).toMatch(/Coin recovery ignored/);
        expect(audited.recentCoinGrants.at(-1).status).toBe('ignored');
    });

    it('never blocks a DM event-path grant equal to a recent loss — an explicit refund is authoritative', () => {
        const state = makeState({ character: { gold: 10, silver: 0, copper: 0 } });
        const paid = gameReducer(state, {
            type: 'APPLY_COIN_LOSS',
            payload: { gold: 5, _meta: { sourceId: 'msg-toll' } },
        });
        const later = addMessages(paid, 1);
        const refunded = gameReducer(later, {
            type: 'ADD_COIN_GRANT',
            payload: { gold: 5, _meta: { sourceId: 'msg-refund', playerMessage: 'I demand my money back.' } },
        });
        expect(refunded.character.gold).toBe(10); // paid 5, refunded 5
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
        expect(bundled.messages.some(m => /Adjusted a bundled coin charge/.test(m.content))).toBe(true);
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
        const later = addMessages(paid, 14); // past the widened spend window (2026-08-25)
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
        expect(bundled.messages.some(m => /Adjusted a bundled coin grant/.test(m.content))).toBe(true);
    });

    it('suppresses a recap bundle assembled ENTIRELY from split prior grants (live playtest #7: 2 gp leak)', () => {
        // Live repro: a 2 gp grant, then the purse turn's 28 gp adjusted grant,
        // then a pure recap re-emitting the whole 30 gp purse. The single-entry
        // strip matched only the 28 gp piece and paid the 2 gp complement out
        // of thin air — every later recap of a split grant leaks its remainder.
        const state = makeState();
        const first = gameReducer(state, {
            type: 'ADD_COIN_GRANT',
            payload: { gold: 2, _meta: { sourceId: 'msg-vial-turn' } },
        });
        // The purse turn emits the full 30 gp bundle; the guard strips the 2 gp
        // already granted and pays 28 — exactly the live "granted 28 gp" line.
        const second = gameReducer(addMessages(first, 1), {
            type: 'ADD_COIN_GRANT',
            payload: { gold: 25, silver: 50, _meta: { sourceId: 'msg-purse-turn' } },
        });
        expect(second.messages.some(m => /granted 28 gp/.test(m.content))).toBe(true);
        const goldAfterBoth = second.character.gold;
        const silverAfterBoth = second.character.silver;
        const recap = gameReducer(addMessages(second, 1), {
            type: 'ADD_COIN_GRANT',
            payload: { gold: 25, silver: 50, _meta: { sourceId: 'msg-recap-turn', playerMessage: 'I look Jagger in the eye and make the deal.' } },
        });
        expect(recap.character.gold).toBe(goldAfterBoth); // nothing new granted
        expect(recap.character.silver).toBe(silverAfterBoth);
        expect(recap.messages.at(-1).content).toMatch(/Duplicate coin grant ignored/);
        // The recap is remembered as ignored, not as a fresh applied grant.
        expect(recap.recentCoinGrants.at(-1).status).toBe('ignored');
    });

    it('strips MULTIPLE prior payments from one recap charge and charges only the true remainder', () => {
        const state = makeState({ character: { gold: 10, silver: 10, copper: 10 } });
        const first = gameReducer(state, {
            type: 'APPLY_COIN_LOSS',
            payload: { gold: 1, _meta: { sourceId: 'msg-room', playerMessage: 'I pay for the room.' } },
        });
        const second = gameReducer(addMessages(first, 1), {
            type: 'APPLY_COIN_LOSS',
            payload: { silver: 2, _meta: { sourceId: 'msg-meal', playerMessage: 'I pay for the meal.' } },
        });
        // Recap bundles BOTH prior payments plus 5 new coppers.
        const recap = gameReducer(addMessages(second, 1), {
            type: 'APPLY_COIN_LOSS',
            payload: { gold: 1, silver: 2, copper: 5, _meta: { sourceId: 'msg-recap', playerMessage: 'I head upstairs for the night.' } },
        });
        expect(recap.character.gold).toBe(9);   // charged once, not twice
        expect(recap.character.silver).toBe(8); // charged once, not twice
        expect(recap.character.copper).toBe(5); // only the genuinely new part
        expect(recap.messages.some(m => /Adjusted a bundled coin charge/.test(m.content))).toBe(true);
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

describe('playtest #8: audit value drift — a re-narrated reward/payment must not move coin again', () => {
    function addMessages(state, count, prefix = 'drift-msg') {
        let next = state;
        for (let i = 0; i < count; i++) {
            next = gameReducer(next, {
                type: 'ADD_MESSAGE',
                payload: { id: `${prefix}-${i}`, role: 'assistant', content: `Filler line ${i}.` },
            });
        }
        return next;
    }

    it('suppresses an audit grant covered by a larger recent grant (the live 620-after-700 case)', () => {
        // Event path granted 7 gp for the lockbox; the next turn re-narrated the
        // same purse as "five gold and twelve silver" (620 cp) with no events,
        // and the audit re-granted it — value drift defeated the signature.
        const state = makeState();
        const granted = gameReducer(state, {
            type: 'ADD_COIN_GRANT',
            payload: { gold: 7, _meta: { sourceId: 'msg-lockbox' } },
        });
        const later = addMessages(granted, 1);
        const audited = gameReducer(later, {
            type: 'ADD_COIN_GRANT',
            payload: { gold: 6, silver: 2, _meta: { sourceId: 'msg-recap:scribe-loot', announce: 'audit', audit: true } },
        });
        expect(audited.character.gold).toBe(state.character.gold + 7); // the 7 gp, once
        expect(audited.character.silver).toBe(0);
        expect(audited.recentCoinGrants.at(-1).status).toBe('ignored');
        expect(audited.messages.at(-1).content).toMatch(/repeats rewards already received/);
    });

    it('keeps DM event grants uncovered — a genuine smaller follow-up reward still pays', () => {
        const state = makeState();
        const granted = gameReducer(state, {
            type: 'ADD_COIN_GRANT',
            payload: { gold: 7, _meta: { sourceId: 'msg-reward-1' } },
        });
        const later = addMessages(granted, 1);
        const second = gameReducer(later, {
            type: 'ADD_COIN_GRANT',
            payload: { gold: 5, _meta: { sourceId: 'msg-reward-2', playerMessage: 'I thank her and pocket the tip.' } },
        });
        expect(second.character.gold).toBe(state.character.gold + 12);
    });

    it('suppresses an audit payment covered by a larger recent charge', () => {
        const state = makeState({ character: { gold: 10, silver: 0, copper: 0 } });
        const paid = gameReducer(state, {
            type: 'APPLY_COIN_LOSS',
            payload: { gold: 7, _meta: { sourceId: 'msg-toll' } },
        });
        const later = addMessages(paid, 1);
        const audited = gameReducer(later, {
            type: 'AUDIT_COIN_PAYMENT',
            payload: { gold: 6, silver: 2, _meta: { sourceId: 'msg-recap:scribe-loot:payment', audit: true } },
        });
        expect(audited.character.gold).toBe(3); // 10 - 7, once
        expect(audited.messages.at(-1).content).toMatch(/repeats payments already taken/);
    });

    it('strips bundled already-taken pieces from an audit payment and charges only the remainder', () => {
        const state = makeState({ character: { gold: 0, silver: 10, copper: 0 } });
        let next = gameReducer(state, {
            type: 'APPLY_COIN_LOSS',
            payload: { silver: 2, _meta: { sourceId: 'msg-pay-a' } },
        });
        next = addMessages(next, 1, 'strip-a');
        next = gameReducer(next, {
            type: 'APPLY_COIN_LOSS',
            payload: { silver: 3, _meta: { sourceId: 'msg-pay-b' } },
        });
        next = addMessages(next, 1, 'strip-b');
        const audited = gameReducer(next, {
            type: 'AUDIT_COIN_PAYMENT',
            payload: { silver: 6, _meta: { sourceId: 'msg-recap:scribe-loot:payment', audit: true } },
        });
        // 2s + 3s were already taken; only the novel 1s of the recapped 6s is owed.
        expect(audited.character.silver).toBe(10 - 2 - 3 - 1);
        expect(audited.messages.some(m => m.content.includes('Adjusted an audited payment'))).toBe(true);
    });

    it('never strips same-base pieces from a reconciled audit shortfall', () => {
        // scribe.js already subtracted this narration's own applied losses; the
        // dispatched amount IS the genuine shortfall and must charge in full.
        const state = makeState({ character: { gold: 0, silver: 10, copper: 0 } });
        let next = gameReducer(state, {
            type: 'APPLY_COIN_LOSS',
            payload: { silver: 2, _meta: { sourceId: 'msg-A' } },
        });
        next = gameReducer(next, {
            type: 'APPLY_COIN_LOSS',
            payload: { silver: 1, _meta: { sourceId: 'msg-A', playerMessage: 'I pay the porter and the gate fee.' } },
        });
        const audited = gameReducer(next, {
            type: 'AUDIT_COIN_PAYMENT',
            payload: { silver: 5, _meta: { sourceId: 'msg-A:scribe-loot:payment', audit: true } },
        });
        expect(audited.character.silver).toBe(10 - 2 - 1 - 5);
        expect(audited.messages.at(-1).content).toMatch(/Payment settled from narration/);
    });
});

describe('2026-08-25 player report: "money removed multiple turns after I paid, silently"', () => {
    function addMessage(state, message) {
        return gameReducer(state, { type: 'ADD_MESSAGE', payload: message });
    }
    /** Advance the conversation by `turns` ordinary player/DM message pairs. */
    function playTurns(state, turns) {
        let next = state;
        for (let i = 0; i < turns; i++) {
            next = addMessage(next, { id: `u${i}`, role: 'user', content: `Scene beat ${i}.` });
            next = addMessage(next, { id: `a${i}`, role: 'assistant', content: `The story moves on ${i}.` });
        }
        return next;
    }
    const purseCp = state => state.character.gold * 100 + state.character.silver * 10 + (state.character.copper || 0);
    const richState = () => makeState({ character: { gold: 200, silver: 0, copper: 0 } });

    it('a loose coin loss recapping a PURCHASE already paid does not charge again', () => {
        // The hole: the purchase deducted 75 gp and recorded it in recentPurchases,
        // while APPLY_COIN_LOSS only ever consulted recentCoinLosses.
        const bought = gameReducer(richState(), {
            type: 'PURCHASE_ITEM',
            payload: { name: 'Chain Mail', priceCp: 7500, _meta: { sourceId: 'msg-buy', playerMessage: 'I buy the chain mail.' } },
        });
        const afterPurchase = purseCp(bought);

        const recap = gameReducer(playTurns(bought, 1), {
            type: 'APPLY_COIN_LOSS',
            payload: { gold: 75, _meta: { sourceId: 'msg-recap', playerMessage: 'I strap the armor on and head out.' } },
        });

        expect(purseCp(recap)).toBe(afterPurchase);
        expect(recap.messages.at(-1).content).toMatch(/already paid/i);
    });

    it('an audited payment recapping a PURCHASE already paid does not charge again', () => {
        const bought = gameReducer(richState(), {
            type: 'PURCHASE_ITEM',
            payload: { name: 'Chain Mail', priceCp: 7500, _meta: { sourceId: 'msg-buy' } },
        });
        const afterPurchase = purseCp(bought);

        const audited = gameReducer(playTurns(bought, 1), {
            type: 'AUDIT_COIN_PAYMENT',
            payload: { gold: 75, _meta: { sourceId: 'msg-recap:scribe-loot:payment', audit: true } },
        });

        expect(purseCp(audited)).toBe(afterPurchase);
    });

    it('a loose coin gain recapping a SALE already paid out does not credit again', () => {
        const sold = gameReducer(makeState({
            character: { gold: 5 },
            inventory: [{ id: 'i1', name: 'Longsword', itemKey: 'longsword', quantity: 1, valueCp: 1500 }],
        }), { type: 'SELL_ITEM', payload: { itemKey: 'longsword', _meta: { sourceId: 'msg-sell' } } });
        const afterSale = purseCp(sold);

        const recap = gameReducer(playTurns(sold, 1), {
            type: 'ADD_COIN_GRANT',
            payload: { gold: 7, silver: 5, _meta: { sourceId: 'msg-recap', playerMessage: 'I pocket the coin and leave.' } },
        });

        expect(purseCp(recap)).toBe(afterSale);
    });

    it('a payment re-emitted three turns later is still suppressed', () => {
        // The old 4-message window covered ~2 turns; the DM recapping a payment
        // later escaped it entirely and the money vanished with no system line.
        const paid = gameReducer(richState(), {
            type: 'APPLY_COIN_LOSS',
            payload: { gold: 20, _meta: { sourceId: 'msg-pay', playerMessage: 'I pay the smith twenty gold.' } },
        });
        const afterPayment = purseCp(paid);

        const replay = gameReducer(playTurns(paid, 3), {
            type: 'APPLY_COIN_LOSS',
            payload: { gold: 20, _meta: { sourceId: 'msg-later', playerMessage: 'We ride north through the pass.' } },
        });

        expect(purseCp(replay)).toBe(afterPayment);
    });

    it('a player DISPUTING an earlier payment never authorizes a repeat charge', () => {
        // "I already paid" contains a payment verb, so the repeat-phrasing bypass
        // fired on precisely the turns the player was objecting to.
        const paid = gameReducer(richState(), {
            type: 'APPLY_COIN_LOSS',
            payload: { gold: 20, _meta: { sourceId: 'msg-pay', playerMessage: 'I pay the smith twenty gold.' } },
        });
        const afterPayment = purseCp(paid);

        const disputed = gameReducer(addMessage(paid, { id: 'm1', role: 'assistant', content: 'The smith nods.' }), {
            type: 'APPLY_COIN_LOSS',
            payload: { gold: 20, _meta: { sourceId: 'msg-again', playerMessage: 'Wait — I already paid you for that!' } },
        });

        expect(purseCp(disputed)).toBe(afterPayment);
    });

    it.each([
        ['I pay him two silver.', true],
        ['I hand over twenty gold for the room.', true],
        ['I buy another round — two more gold.', true],
        ['I pay the toll again.', true],
        ['Wait — I already paid you for that!', false],
        ["Didn't I pay for this already?", false],
        ['You already took my gold.', false],
        ['I paid earlier, at the gate.', false],
        ['We ride north through the pass.', false],
    ])('repeat-charge phrasing %j authorizes a second identical charge: %s', (playerMessage, authorizes) => {
        const paid = gameReducer(richState(), {
            type: 'APPLY_COIN_LOSS',
            payload: { gold: 20, _meta: { sourceId: 'msg-pay', playerMessage: 'I settle up with the smith.' } },
        });
        const afterPayment = purseCp(paid);

        const second = gameReducer(addMessage(paid, { id: 'm1', role: 'assistant', content: 'The smith nods.' }), {
            type: 'APPLY_COIN_LOSS',
            payload: { gold: 20, _meta: { sourceId: 'msg-second', playerMessage } },
        });

        expect(purseCp(second)).toBe(authorizes ? afterPayment - 2000 : afterPayment);
    });

    it('announces every applied coin loss and gain with the resulting purse', () => {
        const paid = gameReducer(richState(), {
            type: 'APPLY_COIN_LOSS',
            payload: { gold: 20, _meta: { sourceId: 'msg-pay', playerMessage: 'I pay the smith twenty gold.' } },
        });
        expect(paid.messages.at(-1).content).toMatch(/20 gp/);

        const found = gameReducer(richState(), {
            type: 'ADD_COIN_GRANT',
            payload: { gold: 8, _meta: { sourceId: 'msg-loot' } },
        });
        expect(found.messages.at(-1).content).toMatch(/8 gp/);
    });

    it('delivers the item without charging twice when a loose coin loss already paid for it', () => {
        // The mirror sequence: the DM narrates the handover as loose coin on one
        // turn and emits the atomic purchase a turn later. Suppressing the whole
        // purchase would swallow the item, so the goods arrive and the purse
        // stays put.
        const paid = gameReducer(richState(), {
            type: 'APPLY_COIN_LOSS',
            payload: { gold: 75, _meta: { sourceId: 'msg-pay', playerMessage: 'I pay for the chain mail.' } },
        });
        const afterPayment = purseCp(paid);

        const delivered = gameReducer(playTurns(paid, 1), {
            type: 'PURCHASE_ITEM',
            payload: { name: 'Chain Mail', priceCp: 7500, _meta: { sourceId: 'msg-buy', playerMessage: 'I strap it on.' } },
        });

        expect(purseCp(delivered)).toBe(afterPayment);
        expect(delivered.inventory.some(i => i.name === 'Chain Mail')).toBe(true);
        expect(delivered.messages.at(-1).content).toMatch(/already paid/i);
    });

    it('still charges a genuinely new, differently-priced payment right after a purchase', () => {
        const bought = gameReducer(richState(), {
            type: 'PURCHASE_ITEM',
            payload: { name: 'Chain Mail', priceCp: 7500, _meta: { sourceId: 'msg-buy' } },
        });
        const afterPurchase = purseCp(bought);

        const tipped = gameReducer(playTurns(bought, 1), {
            type: 'APPLY_COIN_LOSS',
            payload: { silver: 5, _meta: { sourceId: 'msg-tip', playerMessage: 'I tip the smith five silver for the rush job.' } },
        });

        expect(purseCp(tipped)).toBe(afterPurchase - 50);
    });

    it('still charges an explicit repeat the player asks for', () => {
        const paid = gameReducer(richState(), {
            type: 'APPLY_COIN_LOSS',
            payload: { gold: 2, _meta: { sourceId: 'msg-round-1', playerMessage: 'I buy a round for the table — two gold.' } },
        });
        const afterFirst = purseCp(paid);

        const second = gameReducer(addMessage(paid, { id: 'm1', role: 'assistant', content: 'Cheers go up.' }), {
            type: 'APPLY_COIN_LOSS',
            payload: { gold: 2, _meta: { sourceId: 'msg-round-2', playerMessage: 'Another two gold for a second round!' } },
        });

        expect(purseCp(second)).toBe(afterFirst - 200);
    });
});
