/**
 * 2026-09-25 inventory-economy Lap-3 (performance & token budget) queue sweep —
 * the reducer-side pins:
 *
 *  1. An unrecognized `itemKey` with no `name` no longer buys "Unknown item" at
 *     the DM's price: the inverted-word-order typo (`healingPotion` for
 *     `potionHealing`, `hempenRope` for `ropeHempen`) resolves to the catalog
 *     row, and a key nothing resolves is refused visibly, naming the key.
 *     `items_found` with such a key mints the key's words as the name.
 *  2. Purchase and sale receipts carry the purse like the coin lines do.
 *  3. Receipts from one response fold into ONE DM-window row.
 *  4. The stack has a ceiling: addOrStackItem clamps at MAX_ITEM_QUANTITY, the
 *     discard is visible, and a purchase none of which fits charges nothing.
 */
import { describe, expect, it } from 'vitest';
import { gameReducer, initialGameState } from './gameReducer.js';
import { MAX_ITEM_QUANTITY } from '../data/items.js';
import { buildMessageWindow } from '../components/Chat/turnVisibility.js';

function makeState(overrides = {}) {
    return {
        ...initialGameState,
        character: {
            ...initialGameState.character,
            name: 'Astra',
            race: 'human',
            class: 'fighter',
            level: 1,
            gold: 100,
            silver: 0,
            copper: 0,
            ...overrides.character,
        },
        inventory: overrides.inventory ?? [],
        messages: overrides.messages ?? [],
    };
}

const buy = (state, payload) => gameReducer(state, { type: 'PURCHASE_ITEM', payload });
const last = state => state.messages.at(-1);

describe('an unknown itemKey with no name (2026-09-25 P2, the Lap-2 spill reproduced)', () => {
    it('the inverted-word-order key resolves to the catalog row and is bought as the real item', () => {
        const next = buy(makeState(), { itemKey: 'healingPotion', priceCp: 5000 });
        const potion = next.inventory.find(i => i.itemKey === 'potionHealing');
        expect(potion).toMatchObject({ name: 'Potion of Healing', type: 'consumable', consumableType: 'healing' });
        expect(next.character.gold).toBe(50);
        expect(next.inventory.some(i => i.name === 'Unknown item')).toBe(false);
        expect(last(next).content).toMatch(/^Bought Potion of Healing for 50 gp — purse: 50 gp\.$/);

        const rope = buy(makeState(), { itemKey: 'hempenRope', priceCp: 100 });
        expect(rope.inventory.find(i => i.itemKey === 'ropeHempen')).toMatchObject({ name: 'Hempen Rope (50 ft)' });
        const snake = buy(makeState(), { itemKey: 'potion_healing', priceCp: 5000 });
        expect(snake.inventory.find(i => i.itemKey === 'potionHealing')).toBeTruthy();
    });

    it('a key nothing resolves, with no name, is refused visibly naming the key — nothing charged, nothing minted', () => {
        const state = makeState();
        const next = buy(state, { itemKey: 'elixirOfVigor', priceCp: 10000 });
        expect(next.character.gold).toBe(100);
        expect(next.inventory).toEqual([]);
        expect(next.recentPurchases ?? []).toEqual(state.recentPurchases ?? []);
        expect(last(next).content).toBe('Purchase ignored — "elixirOfVigor" is not a catalog itemKey and no item name was given (100 gp not charged). Use a catalog key or a plain name.');
        expect(last(next).dmVisible).toBe(true);
    });

    it('an unknown key BESIDE a name buys the named thing; a name that is itself a catalog item is looked up even when the key is not', () => {
        const brick = buy(makeState(), { itemKey: 'bogWaxBrick', name: 'Brick of bog-wax', priceCp: 10 });
        expect(brick.inventory).toHaveLength(1);
        expect(brick.inventory[0]).toMatchObject({ name: 'Brick of bog-wax', type: 'gear' });
        expect(brick.character).toMatchObject({ gold: 99, silver: 9, copper: 0 });

        // The 09-25 gap the audit walked past: an unknown key used to block the
        // name from ever being looked up.
        const potion = buy(makeState(), { itemKey: 'healingDraught', name: 'Potion of Healing', priceCp: 5000 });
        expect(potion.inventory[0]).toMatchObject({ itemKey: 'potionHealing', consumableType: 'healing' });
    });

    it('the nameless no-key shape is still refused the old way', () => {
        const next = buy(makeState(), { item: [], priceCp: 300 });
        expect(next.character.gold).toBe(100);
        expect(last(next).content).toMatch(/^Purchase ignored — the DM named no item to buy/);
    });

    it('items_found with an unknown key and no name mints the key\'s words as the name, never "Unknown item"', () => {
        const next = gameReducer(makeState(), { type: 'ADD_ITEM', payload: { itemKey: 'glowingOrb' } });
        expect(next.inventory[0]).toMatchObject({ name: 'Glowing Orb', type: 'gear', quantity: 1 });
        const typo = gameReducer(makeState(), { type: 'ADD_ITEM', payload: { itemKey: 'healingPotion' } });
        expect(typo.inventory[0]).toMatchObject({ itemKey: 'potionHealing', name: 'Potion of Healing' });
    });
});

describe('receipts carry the purse and fold into one window row (2026-09-25 P2)', () => {
    it('Bought and Sold lines end with the purse', () => {
        const bought = buy(makeState(), { itemKey: 'dagger' });
        expect(last(bought).content).toBe('Bought Dagger for 2 gp — purse: 98 gp.');
        const three = buy(makeState({ character: { gold: 1, silver: 0, copper: 0 } }), { itemKey: 'torch', quantity: 3, priceCp: 50 });
        expect(last(three).content).toBe('Bought 3x Torch for 5 sp — purse: 5 sp.');
        const sold = gameReducer(bought, { type: 'SELL_ITEM', payload: { itemKey: 'dagger' } });
        expect(last(sold).content).toBe('Sold Dagger for 1 gp — purse: 99 gp.');
    });

    it('a six-purchase + reward response is ONE row of the DM window, not seven', () => {
        let state = makeState({
            messages: [
                ...Array.from({ length: 16 }, (_, i) => ({ id: `m${i}`, role: i % 2 ? 'assistant' : 'user', content: `fiction-${i}`, timestamp: i })),
                { id: 'u', role: 'user', content: 'I buy the lot.', timestamp: 100 },
                { id: 'a', role: 'assistant', content: 'The merchant tallies it up.', timestamp: 101 },
            ],
        });
        for (const itemKey of ['dagger', 'torch', 'potionHealing', 'rations', 'ropeHempen', 'shortsword']) {
            state = buy(state, { itemKey, _meta: { sourceId: 'resp-1' } });
        }
        state = gameReducer(state, { type: 'ADD_COIN_GRANT', payload: { gold: 5, _meta: { sourceId: 'resp-1' } } });
        const receipts = state.messages.filter(m => m.role === 'system' && m.dmVisible === true);
        expect(receipts).toHaveLength(7);
        expect(receipts.every(r => /purse: /.test(r.content))).toBe(true);

        const window = buildMessageWindow(state.messages, 20);
        const receiptRows = window.filter(row => row.content.includes('purse: '));
        expect(receiptRows).toHaveLength(1);
        expect(receiptRows[0].content.split('\n')).toHaveLength(7);
        expect(receiptRows[0].content.split('\n')[6]).toMatch(/^\*\*\+5 gp\*\* received — purse: /);
        // 17 rows of fiction survive beside the one receipt row (was 13).
        expect(window).toHaveLength(19);
        expect(window.filter(row => row.content.startsWith('fiction-')).length).toBe(16);
    });
});

describe('the stack ceiling (2026-09-25 P2, the Lap-1 spill)', () => {
    const torch = (quantity, id = 'torch-1') => ({ id, itemKey: 'torch', name: 'Torch', type: 'gear', valueCp: 1, quantity });

    it('ADD_ITEM clamps at MAX_ITEM_QUANTITY and says how many did not land, visibly to the DM', () => {
        let state = makeState({ inventory: [torch(999)] });
        state = gameReducer(state, { type: 'ADD_ITEM', payload: { itemKey: 'torch', quantity: 999 } });
        expect(state.inventory).toHaveLength(1);
        expect(state.inventory[0].quantity).toBe(MAX_ITEM_QUANTITY);
        expect(last(state).content).toBe(`Torch stack is full at ${MAX_ITEM_QUANTITY} — 999 could not be carried.`);
        expect(last(state).dmVisible).toBe(true);
        // Twelve grants of 999 never mint 11,988.
        for (let i = 0; i < 11; i += 1) {
            state = gameReducer(state, { type: 'ADD_ITEM', payload: { itemKey: 'torch', quantity: 999 } });
        }
        expect(state.inventory[0].quantity).toBe(MAX_ITEM_QUANTITY);
        expect(state.inventory).toHaveLength(1);
    });

    it('a fitting add posts no ceiling line', () => {
        const next = gameReducer(makeState({ inventory: [torch(5)] }), { type: 'ADD_ITEM', payload: { itemKey: 'torch', quantity: 3 } });
        expect(next.inventory[0].quantity).toBe(8);
        expect(next.messages.some(m => /stack is full/.test(m.content))).toBe(false);
    });

    it('a purchase none of which fits is refused before any coin moves', () => {
        const state = makeState({ inventory: [torch(MAX_ITEM_QUANTITY)] });
        const next = buy(state, { itemKey: 'torch', quantity: 1, priceCp: 1 });
        expect(next.character.gold).toBe(100);
        expect(next.inventory[0].quantity).toBe(MAX_ITEM_QUANTITY);
        expect(next.recentPurchases ?? []).toEqual(state.recentPurchases ?? []);
        expect(last(next).content).toBe(`Cannot buy Torch — the stack is full at ${MAX_ITEM_QUANTITY}; nothing charged.`);
    });

    it('a partly fitting purchase is bought at the DM\'s flat price and the discard is visible', () => {
        const next = buy(makeState({ inventory: [torch(995)] }), { itemKey: 'torch', quantity: 10, priceCp: 10 });
        expect(next.inventory[0].quantity).toBe(MAX_ITEM_QUANTITY);
        expect(next.character).toMatchObject({ gold: 99, silver: 9, copper: 0 });
        expect(next.messages.at(-2).content).toBe('Bought 10x Torch for 1 sp — purse: 99 gp, 9 sp.');
        expect(last(next).content).toBe(`Torch stack is full at ${MAX_ITEM_QUANTITY} — 6 of the 10 bought could not be carried.`);
    });
});
