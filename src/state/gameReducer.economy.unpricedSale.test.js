/**
 * Grand playtest 2026-10-02 (docs/GRAND_PLAYTEST_2026-10-02.md): an off-catalog
 * "Claw Hammer" bought for coin was sold back with no `priceCp` — the sale paid
 * 0 cp and took the hammer while the narration counted out four silver, and
 * the Scribe audit is told sales are the engine's to price.
 *
 *  1. A purchase of an off-catalog item at a stated price stamps its unit
 *     value on the row, so a later unpriced sale pays half of it.
 *  2. A sale the engine cannot value at all (no catalog value, no priceCp) is
 *     refused visibly and the item kept — never a silent 0 cp sale.
 */
import { describe, expect, it } from 'vitest';
import { gameReducer, initialGameState } from './gameReducer.js';

const makeState = (inventory = []) => ({
    ...initialGameState,
    character: { ...initialGameState.character, name: 'Aino', race: 'human', class: 'fighter', level: 1, gold: 10, silver: 0, copper: 0 },
    inventory,
    messages: [],
});
const purse = s => s.character.gold * 100 + s.character.silver * 10 + s.character.copper;

describe('selling an off-catalog item (grand playtest 2026-10-02)', () => {
    it('a priced purchase remembers its unit value, and the unpriced sale pays half of it', () => {
        const bought = gameReducer(makeState(), { type: 'PURCHASE_ITEM', payload: { name: 'Claw Hammer', priceCp: 80 } });
        const row = bought.inventory.find(i => i.name === 'Claw Hammer');
        expect(row.valueCp).toBe(80);
        expect(purse(bought)).toBe(1000 - 80);
        const sold = gameReducer(bought, { type: 'SELL_ITEM', payload: { name: 'claw hammer' } });
        expect(sold.inventory.find(i => i.name === 'Claw Hammer')).toBeUndefined();
        expect(purse(sold)).toBe(1000 - 80 + 40);
    });

    it('a sale the engine cannot value is refused with the item kept and a visible receipt', () => {
        const state = makeState([{ id: 'h1', name: 'Claw Hammer', type: 'gear', quantity: 1 }]);
        const next = gameReducer(state, { type: 'SELL_ITEM', payload: { name: 'Claw Hammer' } });
        expect(next.inventory).toHaveLength(1);
        expect(purse(next)).toBe(1000);
        expect(next.messages.at(-1).content).toMatch(/Claw Hammer not sold — the engine has no price for it/);
        expect(next.messages.at(-1).dmVisible).toBe(true);
    });

    it('an explicit priceCp still sells an unvalued item at that price, and catalog items keep half value', () => {
        const state = makeState([{ id: 'h1', name: 'Claw Hammer', type: 'gear', quantity: 1 }, { id: 'd1', name: 'Dagger', itemKey: 'dagger', type: 'weapon', quantity: 1, valueCp: 200 }]);
        const priced = gameReducer(state, { type: 'SELL_ITEM', payload: { name: 'Claw Hammer', priceCp: 40 } });
        expect(purse(priced)).toBe(1040);
        const dagger = gameReducer(state, { type: 'SELL_ITEM', payload: { itemKey: 'dagger' } });
        expect(purse(dagger)).toBe(1100);
    });
});
