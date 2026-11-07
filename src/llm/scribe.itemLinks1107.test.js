// Identity by reference, lane 5 (2026-11-07): the loot and loss audits read the
// Scribe's link and exact names. The word rule may only send an item to the
// player's card.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { recentArrivalNames, runNarrationAudits } from './scribeAudits.js';

const stateWith = (overrides = {}) => ({
    appliedLootSourceIds: [],
    character: { name: 'Ilse', gold: 1, silver: 0, copper: 0 },
    party: [],
    inventory: [],
    messages: [{ id: 'u', role: 'user', content: 'x' }, { id: 'a', role: 'assistant', content: 'y' }],
    ledger: [{ kind: 'item', status: 'applied', itemsIn: [{ name: 'Brass toll-token', quantity: 1 }], sourceId: 'msg-0', atMessage: 1 }],
    ...overrides,
});

function audit(extraction, { state = stateWith(), appliedEvents = null } = {}) {
    const actions = [];
    runNarrationAudits(
        extraction,
        { lootAudit: { sourceId: 'msg-5:scribe-loot', appliedEvents, getState: () => state } },
        action => actions.push(action),
    );
    return actions;
}

const grants = actions => actions.filter(action => action.type === 'ADD_ITEM').map(action => action.payload.name);
const cards = actions => actions.filter(action => JSON.stringify(action).includes('Narrated, not recorded'));

describe('the loot audit against recent arrivals', () => {
    beforeEach(() => vi.spyOn(console, 'warn').mockImplementation(() => {}));

    it('the Scribe\'s link to a recent arrival grants nothing and asks nothing', () => {
        const actions = audit({ narrated_loot: { items: [{ name: 'heavy stamped disc', recorded_as: 'Brass toll-token' }] } });
        expect(grants(actions)).toEqual([]);
        expect(cards(actions)).toHaveLength(0);
    });

    it('the same name character for character is the same arrival', () => {
        const actions = audit({ narrated_loot: { items: [{ name: 'brass toll token' }] } });
        expect(grants(actions)).toEqual([]);
        expect(cards(actions)).toHaveLength(0);
    });

    it('an unlinked name the words tie to an arrival grants nothing and asks the player', () => {
        const actions = audit({ narrated_loot: { items: [{ name: 'brass token' }] } });
        expect(grants(actions)).toEqual([]);
        expect(cards(actions)).toHaveLength(1);
    });

    it('a link to a name on no list is ignored, and a real find is still granted', () => {
        const actions = audit({ narrated_loot: { items: [{ name: 'bone whistle', recorded_as: 'Silver flute' }] } });
        expect(grants(actions)).toEqual(['bone whistle']);
    });
});

describe('an evented reply', () => {
    const appliedEvents = { itemsFound: [{ name: 'Syndicate cargo manifest' }], purchases: [], sells: [], startingItems: [] };

    it('the link means no card; the same name means no card', () => {
        expect(cards(audit({ narrated_loot: { items: [{ name: 'transit manifest', recorded_as: 'Syndicate cargo manifest' }] } }, { appliedEvents }))).toHaveLength(0);
        expect(cards(audit({ narrated_loot: { items: [{ name: 'Syndicate cargo manifest' }] } }, { appliedEvents }))).toHaveLength(0);
    });

    it('an unlinked drift is a card now, where the word belt hid it: the stated cost', () => {
        const actions = audit({ narrated_loot: { items: [{ name: 'cargo manifest' }] } }, { appliedEvents });
        expect(cards(actions)).toHaveLength(1);
        expect(grants(actions)).toEqual([]);
    });
});

describe('the loss audit', () => {
    const owned = { id: 'r1', name: 'Wax Candles', quantity: 5 };

    it('a row copied as the inventory line prints it removes that row', () => {
        const actions = audit({ narrated_losses: { items: [{ name: 'Wax Candles x5', quantity: 1 }] } }, { state: stateWith({ inventory: [owned], ledger: [] }) });
        expect(actions.find(action => action.type === 'REMOVE_ITEM_BY_NAME').payload.name).toBe('Wax Candles');
    });

    it('a word that misses the row removes nothing', () => {
        const actions = audit({ narrated_losses: { items: [{ name: 'candles' }] } }, { state: stateWith({ inventory: [owned], ledger: [] }) });
        expect(actions.some(action => action.type === 'REMOVE_ITEM_BY_NAME')).toBe(false);
    });
});

describe('recentArrivalNames', () => {
    it('lists moved arrivals newest first, once each, inside the long window', () => {
        const state = stateWith({
            messages: Array.from({ length: 120 }, (_, i) => ({ id: `m${i}`, role: i % 2 ? 'assistant' : 'user', content: 'x' })),
            ledger: [
                { kind: 'item', status: 'applied', itemsIn: [{ name: 'Old key', quantity: 1 }], sourceId: 'm3', atMessage: 3 },
                { kind: 'item', status: 'applied', itemsIn: [{ name: 'Rope', quantity: 1 }], sourceId: 'm100', atMessage: 100 },
                { kind: 'item', status: 'applied', itemsIn: [{ name: 'Lamp', quantity: 1 }], sourceId: 'm110', atMessage: 110 },
                { kind: 'item', status: 'applied', itemsIn: [{ name: 'Rope', quantity: 1 }], sourceId: 'm112', atMessage: 112 },
                { kind: 'item', status: 'ignored', itemsIn: [{ name: 'Ghost', quantity: 1 }], sourceId: 'm114', atMessage: 114 },
            ],
        });
        expect(recentArrivalNames(state)).toEqual(['Rope', 'Lamp']);
    });
});
