/**
 * The purchase↔items_found and sell↔items_lost guards in applyEvents sign with
 * CATALOG IDENTITY, not a compact token (2026-10-07 inventory-economy P1,
 * reproduced by the audit): `purchase: { itemKey: 'potionHealing' }` beside
 * `items_found: ["Healing Potion"]` bought one potion and granted a second —
 * one 50 gp charge, `Potion of Healing ×2`, no suppression line, and the item
 * and purchase ledgers are separate so nothing downstream caught it. The
 * sell twin removed the other unit of a ×2 stack silently.
 */
import { describe, expect, it } from 'vitest';
import { applyEvents } from './applyEvents.js';
import { normalizeEvents } from '../llm/eventChannels.js';
import { gameReducer, initialGameState } from './gameReducer.js';

function makeState(overrides = {}) {
    return {
        ...initialGameState,
        character: { ...initialGameState.character, name: 'Astra', race: 'human', class: 'fighter', level: 1, gold: 60, silver: 0, copper: 0 },
        inventory: overrides.inventory ?? [],
        messages: [{ id: 'dm-1', role: 'assistant', content: 'The apothecary slides a potion over.' }],
    };
}

function run(state, raw, lootSourceId = 'dm-1') {
    let next = state;
    const dispatch = (action) => { next = gameReducer(next, action); };
    applyEvents(normalizeEvents(raw), dispatch, () => next, { lootSourceId });
    return next;
}

describe('applyEvents: a found/lost entry that IS the traded item is dropped by catalog identity', () => {
    it('a keyed purchase beside a named find of the same catalog item grants ONE potion for one charge', () => {
        const next = run(makeState(), {
            purchase: { itemKey: 'potionHealing', priceCp: 5000 },
            items_found: ['Healing Potion'],
        });
        const potions = next.inventory.filter(i => i.itemKey === 'potionHealing');
        expect(potions).toHaveLength(1);
        expect(potions[0].quantity).toBe(1);
        expect(next.character.gold).toBe(10);
    });

    it('a named purchase beside a keyed find is the same pair the other way round', () => {
        const next = run(makeState(), {
            purchase: { name: 'Potion of Healing', priceCp: 5000 },
            items_found: [{ itemKey: 'potionHealing' }],
        });
        expect(next.inventory.filter(i => i.itemKey === 'potionHealing').map(i => i.quantity)).toEqual([1]);
    });

    it('the same-key control still grants one, and a DIFFERENT item beside a purchase is granted', () => {
        const same = run(makeState(), { purchase: { itemKey: 'potionHealing', priceCp: 5000 }, items_found: [{ itemKey: 'potionHealing' }] });
        expect(same.inventory.filter(i => i.itemKey === 'potionHealing').map(i => i.quantity)).toEqual([1]);
        const other = run(makeState(), { purchase: { itemKey: 'potionHealing', priceCp: 5000 }, items_found: ['Torch'] });
        expect(other.inventory.map(i => i.itemKey).sort()).toEqual(['potionHealing', 'torch']);
    });

    it('a sale beside a drifted-name loss of the same item sells one unit and keeps the other', () => {
        const state = makeState({ inventory: [{ id: 'rope-1', itemKey: 'ropeHempen', name: 'Hempen Rope (50 ft)', type: 'gear', quantity: 2, valueCp: 100 }] });
        const next = run(state, {
            sell: { name: 'Hempen Rope (50 ft)', priceCp: 50 },
            items_lost: ['hempen rope'],
        });
        expect(next.inventory.find(i => i.id === 'rope-1').quantity).toBe(1);
        expect(next.character.silver).toBe(5);
    });

    it('two spellings of one find still aggregate into one grant of the summed quantity', () => {
        const next = run(makeState(), { items_found: [{ itemKey: 'potionHealing', quantity: 2 }, 'Healing Potion'] });
        expect(next.inventory.filter(i => i.itemKey === 'potionHealing').map(i => i.quantity)).toEqual([3]);
    });
});
