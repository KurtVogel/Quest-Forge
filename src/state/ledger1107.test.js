// Identity by reference, lane 5 (2026-11-07): items and the ledger. A name that
// is not an exact copy resolves to nothing, words may only ask, and two ids are
// a question for the repeat judge rather than proof of two people.
import { describe, expect, it } from 'vitest';
import { gameReducer, initialGameState } from './gameReducer.js';
import { applyEvents } from './applyEvents.js';
import { parseResponse } from '../llm/responseParser.js';
import { partyRelation } from '../engine/transactionLedger.js';
import { buildRepeatJudgeInput } from '../llm/repeatJudge.js';

const pair = (state, i) => ({
    ...state,
    messages: [...state.messages, { id: `u${i}`, role: 'user', content: `beat ${i}` }, { id: `msg-${i}`, role: 'assistant', content: `reply ${i}` }],
});
const turns = (state, n) => Array.from({ length: n }).reduce((s, _, i) => pair(s, `t${s.messages.length}-${i}`), state);
const purse = (state) => state.character.gold * 100 + state.character.silver * 10 + state.character.copper;
const base = (overrides = {}) => ({
    ...initialGameState,
    character: { ...initialGameState.character, name: 'Ilse', gold: 10, silver: 0, copper: 0 },
    inventory: [],
    messages: [{ id: 'msg-1', role: 'assistant', content: 'The shopkeep sets a coil of rope on the counter.' }],
    npcs: [
        { id: 'npc-tuomas', name: 'Tuomas', rosterTier: 'character', kind: 'character' },
        { id: 'npc-tuomas-2', name: 'Tuomas the furrier', rosterTier: 'character', kind: 'character' },
    ],
    ...overrides,
});
const card = (state) => state.messages.findLast(message => message.kind === 'recovery');
const names = (state) => state.inventory.map(item => item.name);

describe('the deferred counterparty item: two records for one person', () => {
    it('a second same-value payment to the fork pays nothing and posts a card', () => {
        const first = gameReducer(base(), { type: 'APPLY_COIN_LOSS', payload: { copper: 500, _meta: { sourceId: 'msg-1', party: 'Tuomas' } } });
        const second = gameReducer(turns(first, 2), { type: 'APPLY_COIN_LOSS', payload: { copper: 500, _meta: { sourceId: 'msg-2', party: 'Tuomas the furrier' } } });
        expect(purse(second)).toBe(purse(first));
        expect(card(second).recovery.status).toBe('judging');
    });

    it('a second Rope bought from the fork buys nothing yet and posts a card', () => {
        const first = gameReducer(base(), { type: 'PURCHASE_ITEM', payload: { name: 'Rope', priceCp: 100, _meta: { sourceId: 'msg-1', party: 'Tuomas' } } });
        const second = gameReducer(turns(first, 2), { type: 'PURCHASE_ITEM', payload: { name: 'Rope', priceCp: 100, _meta: { sourceId: 'msg-2', party: 'Tuomas the furrier' } } });
        expect(second.inventory.reduce((sum, item) => sum + (item.quantity || 1), 0)).toBe(1);
        expect(card(second).recovery.status).toBe('judging');
    });

    it('past the short window the two ids are two people again', () => {
        const first = gameReducer(base(), { type: 'APPLY_COIN_LOSS', payload: { copper: 500, _meta: { sourceId: 'msg-1', party: 'Tuomas' } } });
        const later = gameReducer(turns(first, 8), { type: 'APPLY_COIN_LOSS', payload: { copper: 500, _meta: { sourceId: 'msg-2', party: 'Tuomas the furrier' } } });
        expect(purse(first) - purse(later)).toBe(500);
    });

    it('the audit lane has no judge, so two ids stay two people there', () => {
        const first = gameReducer(base(), { type: 'ADD_COIN_GRANT', payload: { copper: 100, _meta: { sourceId: 'msg-1', party: 'Tuomas' } } });
        const audit = gameReducer(turns(first, 2), { type: 'ADD_COIN_GRANT', payload: { copper: 100, _meta: { sourceId: 'msg-2:scribe-loot', audit: true, party: 'Tuomas the furrier' } } });
        expect(purse(audit) - purse(first)).toBe(100);
    });

    it('a resolver the caller passes still answers `same` by id', () => {
        const resolve = name => (name.startsWith('Tuomas') ? 'npc-tuomas' : '');
        expect(partyRelation({ party: 'Tuomas' }, { party: 'Tuomas the furrier' }, resolve)).toBe('same');
    });
});

describe('words may only ask, from the same reply too', () => {
    const reply = {
        purchase: { name: 'Hempen rope', priceCp: 100, seller: 'Tuomas' },
        items_found: [{ name: 'hempen rope coil' }],
    };
    const run = () => {
        const state = { current: base() };
        const dispatch = (action) => { state.current = gameReducer(state.current, action); };
        const { events } = parseResponse(`The rope is yours.\n\`\`\`json\n${JSON.stringify(reply)}\n\`\`\``);
        applyEvents(events, dispatch, () => state.current, { lootSourceId: 'msg-1' });
        return state.current;
    };

    it('a found item the words tie to the purchase in that reply: one rope, the price paid, the second rope for the judge', () => {
        const state = run();
        expect(names(state)).toEqual(['hempen rope coil']);
        expect(purse(base()) - purse(state)).toBe(100);
        expect(card(state).recovery).toMatchObject({ status: 'judging', mode: 'repeat' });
        expect(card(state).recovery.replay.type).toBe('ADD_ITEM');
    });

    it('the judge is told both entries are one turn', () => {
        const state = run();
        expect(buildRepeatJudgeInput(state, card(state))).toContain('Both are the SAME turn');
    });

    it('an exact same-reply twin is still a plain note: that one is certain', () => {
        const state = { current: base() };
        const dispatch = (action) => { state.current = gameReducer(state.current, action); };
        const { events } = parseResponse(`The rope is yours.\n\`\`\`json\n${JSON.stringify({ purchase: reply.purchase, items_found: [{ name: 'Hempen rope' }] })}\n\`\`\``);
        applyEvents(events, dispatch, () => state.current, { lootSourceId: 'msg-1' });
        expect(names(state.current)).toEqual(['Hempen Rope (50 ft)']);
        expect(card(state.current)).toBeUndefined();
    });
});

describe('the owned-item ladder has no word rung', () => {
    const owned = (name, extra = {}) => ({ id: 'row-1', name, type: 'gear', quantity: 1, ...extra });

    it('an exact copy removes, in any case', () => {
        const next = gameReducer(base({ inventory: [owned('Wax Candles (x5)')] }), { type: 'REMOVE_ITEM_BY_NAME', payload: 'wax candles (X5)' });
        expect(next.inventory).toEqual([]);
    });

    it('a name that merely holds the words removes nothing, and the DM reads why', () => {
        const next = gameReducer(base({ inventory: [owned('Wax Candles (x5)')] }), { type: 'REMOVE_ITEM_BY_NAME', payload: 'wax candles' });
        expect(names(next)).toEqual(['Wax Candles (x5)']);
        expect(next.messages.at(-1)).toMatchObject({ dmVisible: true });
    });

    it('"Sword" never swallows "Sword of Kel"', () => {
        const next = gameReducer(base({ inventory: [owned('Sword of Kel')] }), { type: 'REMOVE_ITEM_BY_NAME', payload: 'Sword' });
        expect(names(next)).toEqual(['Sword of Kel']);
    });

    it('a catalog name still finds its keyed row', () => {
        const row = owned('Battered old rope', { itemKey: 'ropeHempen' });
        const next = gameReducer(base({ inventory: [row] }), { type: 'REMOVE_ITEM_BY_NAME', payload: 'Hempen Rope (50 ft)' });
        expect(next.inventory).toEqual([]);
    });
});
