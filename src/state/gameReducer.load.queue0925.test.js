/**
 * 2026-09-25 inventory-economy Lap-3 P2 (the Lap-1 spill), load side: the
 * stack ceiling is applied VISIBLY at load. Before, a save carrying a row past
 * MAX_ITEM_QUANTITY (written by the unclamped addOrStackItem, or hand-edited)
 * was clamped back to 999 by healEquippedSlots' normalizeItem with no line —
 * a silent loss in the other direction from the silent overflow.
 */
import { describe, expect, it } from 'vitest';
import { migrateLoadedSave } from './migrations.js';
import { gameReducer, initialGameState } from './gameReducer.js';
import { MAX_ITEM_QUANTITY } from '../data/items.js';

const fighterSave = (overrides = {}) => ({
    character: {
        name: 'Veteran', race: 'human', class: 'fighter', level: 4, exp: 0,
        currentHP: 30, maxHP: 30, conditions: [],
        abilityScores: { strength: 16, dexterity: 12, constitution: 14, intelligence: 10, wisdom: 10, charisma: 8 },
    },
    inventory: [],
    messages: [],
    ...overrides,
});

const ceilingLine = save => (save.messages || []).find(m => /Stack ceiling applied on load/.test(m.content || ''));

describe('the stack ceiling at load is visible (2026-09-25)', () => {
    it('clamps an over-full row to MAX_ITEM_QUANTITY and names it in one system line', () => {
        const save = migrateLoadedSave(fighterSave({
            inventory: [
                { id: 't-1', itemKey: 'torch', name: 'Torch', type: 'gear', quantity: 11988 },
                { id: 'r-1', itemKey: 'rations', name: 'Rations (1 day)', type: 'gear', quantity: 12 },
            ],
        }));
        expect(save.inventory.find(i => i.id === 't-1').quantity).toBe(MAX_ITEM_QUANTITY);
        expect(save.inventory.find(i => i.id === 'r-1').quantity).toBe(12);
        const line = ceilingLine(save);
        expect(line).toBeTruthy();
        expect(line.content).toBe(`**Stack ceiling applied on load:** Torch 11988 → ${MAX_ITEM_QUANTITY}. A stack holds at most ${MAX_ITEM_QUANTITY} of one item.`);
        expect(line.role).toBe('system');
    });

    it('the fold heals clamp too: two rows of 600 torches fold to ONE row of 999 with the line, never 1,200', () => {
        const save = migrateLoadedSave(fighterSave({
            inventory: [
                { id: 't-1', itemKey: 'torch', name: 'Torch', type: 'gear', quantity: 600 },
                { id: 't-2', itemKey: 'torch', name: 'Torch', type: 'gear', quantity: 600 },
            ],
        }));
        const torches = save.inventory.filter(i => i.itemKey === 'torch');
        expect(torches).toHaveLength(1);
        expect(torches[0].quantity).toBe(MAX_ITEM_QUANTITY);
        expect(ceilingLine(save).content).toContain(`Torch 1200 → ${MAX_ITEM_QUANTITY}`);
    });

    it('a healthy save posts nothing and keeps every row', () => {
        const save = migrateLoadedSave(fighterSave({
            inventory: [
                { id: 't-1', itemKey: 'torch', name: 'Torch', type: 'gear', quantity: MAX_ITEM_QUANTITY },
                { id: 'x-1', name: 'Odd Coin', quantity: 'many' },
                null,
            ],
        }));
        expect(ceilingLine(save)).toBeUndefined();
        expect(save.inventory.find(i => i?.id === 't-1').quantity).toBe(MAX_ITEM_QUANTITY);
    });

    it('LOAD_GAME end to end: the loaded state carries the clamped row and the line', () => {
        const next = gameReducer(initialGameState, {
            type: 'LOAD_GAME',
            payload: {
                ...initialGameState,
                ...fighterSave({
                    inventory: [{ id: 't-1', itemKey: 'torch', name: 'Torch', type: 'gear', quantity: 5000 }],
                }),
            },
        });
        expect(next.inventory.find(i => i.itemKey === 'torch').quantity).toBe(MAX_ITEM_QUANTITY);
        expect(ceilingLine(next)).toBeTruthy();
    });
});
