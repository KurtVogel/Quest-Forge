/**
 * A loose coin gain riding the same response as an atomic `sell` reaches the
 * reducer instead of being blanket-suppressed in applyEvents: ADD_COIN_GRANT
 * decides by VALUE whether it duplicates this reply's sale proceeds (ignored)
 * or is a separate payment (paid). The 2026-09-03 money-traffic playtest lost
 * a 3 sp bounty paid beside a 5 sp ring sale to the old blanket rule. The
 * purchase/loss side keeps its blanket suppression (never overcharge).
 */
import { describe, expect, it, vi } from 'vitest';
import { applyEvents } from './applyEvents.js';
import { normalizeEvents } from '../llm/eventChannels.js';

const state = {
    character: { level: 1, currentHP: 10, gold: 5, silver: 0, copper: 0, classResources: {}, class: 'fighter' },
    inventory: [{ id: 'i1', name: 'Tarnished silver ring', itemKey: 'tarnishedsilverring', quantity: 1, valueCp: 100 }],
    party: [],
    combat: { active: false },
    messages: [],
};

describe('applyEvents: loose coin beside an atomic transaction', () => {
    it('dispatches BOTH the sale and a same-response loose coin gain (the reducer judges the value)', () => {
        const dispatch = vi.fn();
        const events = normalizeEvents({
            sell: { name: 'Tarnished silver ring', priceCp: 50 },
            silver_found: 3,
        });
        applyEvents(events, dispatch, () => state);
        expect(dispatch).toHaveBeenCalledWith(expect.objectContaining({ type: 'SELL_ITEM' }));
        expect(dispatch).toHaveBeenCalledWith(expect.objectContaining({
            type: 'ADD_COIN_GRANT',
            payload: expect.objectContaining({ silver: 3 }),
        }));
    });

    it('still drops a loose coin LOSS emitted beside an atomic purchase', () => {
        const dispatch = vi.fn();
        const events = normalizeEvents({
            purchase: { name: 'Torch', quantity: 1 },
            copper_lost: 1,
        });
        applyEvents(events, dispatch, () => state);
        expect(dispatch).toHaveBeenCalledWith(expect.objectContaining({ type: 'PURCHASE_ITEM' }));
        expect(dispatch).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'APPLY_COIN_LOSS' }));
    });
});
