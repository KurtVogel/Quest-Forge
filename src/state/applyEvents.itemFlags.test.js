/**
 * DM item flags reach ADD_ITEM typed (2026-09-12 inventory-economy P2): the
 * old `!!` read a DM `"twoHanded": "false"` as true — the equipped shield was
 * sheathed by a one-handed sword — and a string `isShield: "no"` promoted a
 * gear row to a shield. A prototype-key item name must dispatch as a plain
 * grant instead of throwing after the loot source is claimed.
 */
import { describe, expect, it, vi } from 'vitest';
import { applyEvents } from './applyEvents.js';
import { normalizeEvents } from '../llm/eventChannels.js';
import { gameReducer, initialGameState } from './gameReducer.js';

const state = {
    character: { level: 1, currentHP: 10, gold: 5, silver: 0, copper: 0, classResources: {}, class: 'fighter' },
    inventory: [],
    party: [],
    combat: { active: false },
    messages: [],
};

function addItemPayloads(rawEvents) {
    const dispatch = vi.fn();
    applyEvents(normalizeEvents(rawEvents), dispatch, () => state);
    return dispatch.mock.calls.map(([action]) => action).filter(a => a.type === 'ADD_ITEM').map(a => a.payload);
}

describe('applyEvents: item flag typing', () => {
    it('reads string false-words as false and keeps true flags', () => {
        const [payload] = addItemPayloads({
            items_found: [{ name: 'Bone Cleaver', type: 'weapon', damage: '1d8', twoHanded: 'false', finesse: 'yes', versatile: 'no' }],
        });
        expect(payload.twoHanded).toBe(false);
        expect(payload.finesse).toBe(true);
        expect(payload.versatile).toBe(false);
    });

    it('a string isShield "no" never promotes a gear row to a shield', () => {
        const [payload] = addItemPayloads({ items_found: [{ name: 'Cursed Idol', type: 'gear', isShield: 'no' }] });
        expect(payload.type).toBe('gear');
        expect(payload.isShield).toBeUndefined();
    });

    it('a prototype-key item name is granted as a plain custom row through the reducer', () => {
        const [payload] = addItemPayloads({ items_found: ['Constructor'] });
        let next;
        expect(() => { next = gameReducer({ ...initialGameState, ...state }, { type: 'ADD_ITEM', payload }); }).not.toThrow();
        expect(next.inventory.some(i => i.name === 'Constructor' && i.itemKey === null)).toBe(true);
    });
});
