import { describe, expect, it, vi } from 'vitest';
import { judgeLatest } from './repeatJudge.testUtils.js';
import { gameReducer, initialGameState } from './gameReducer.js';
import { applyEvents } from './applyEvents.js';
import { parseResponse } from '../llm/responseParser.js';
import { runNarrationAudits } from '../llm/scribeAudits.js';
import { formatLedgerForPrompt, loadLedger, migrateLegacyLedgers, partyRelation } from '../engine/transactionLedger.js';
import { buildSystemPromptParts } from '../llm/promptBuilder.js';

// The one transaction log (2026-11-01): five ledgers and 41 guards became one
// log and one judge, the counterparty became the window key, and the five
// holes the map found (a bought item recapped as found, a re-emitted
// items_lost, a sale beside a loss audit, a catalog purchase counted as
// coin-silent, a gear handoff) close by construction.

const pair = (state, i) => ({
    ...state,
    messages: [...state.messages, { id: `u${i}`, role: 'user', content: `beat ${i}` }, { id: `a${i}`, role: 'assistant', content: `reply ${i}` }],
});
const turns = (state, n) => Array.from({ length: n }).reduce((s, _, i) => pair(s, `${s.messages.length}-${i}`), state);
const purse = (state) => state.character.gold * 100 + state.character.silver * 10 + state.character.copper;
const base = (overrides = {}) => ({
    ...initialGameState,
    character: { ...initialGameState.character, name: 'Ilse', gold: 10, silver: 0, copper: 0 },
    inventory: [],
    messages: [],
    npcs: [
        { id: 'npc-jethro', name: 'Jethro', rosterTier: 'character', kind: 'character' },
        { id: 'npc-marta', name: 'Marta Vell', rosterTier: 'character', kind: 'character' },
        { id: 'npc-branock', name: 'Branock', rosterTier: 'character', kind: 'character' },
    ],
    ...overrides,
});
const coin = (type, state, cp, sourceId, extra = {}) => gameReducer(state, { type, payload: { copper: cp, _meta: { sourceId, ...extra } } });

describe('the counterparty decides the window', () => {
    it('two same-value payments to two recorded people are the repeat judge\'s to read (2026-11-07), in the same reply both charge', () => {
        const first = coin('APPLY_COIN_LOSS', base(), 20, 'msg-1', { party: 'Jethro' });
        const second = coin('APPLY_COIN_LOSS', turns(first, 2), 20, 'msg-2', { party: 'Marta Vell' });
        expect(purse(base()) - purse(second)).toBe(20);
        expect(second.messages.at(-1).recovery).toMatchObject({ status: 'judging', mode: 'repeat', party: 'Marta Vell' });
        expect(second.messages.at(-1).recovery.judge.earlier).toContain('Jethro');
        const sameReply = coin('APPLY_COIN_LOSS', first, 20, 'msg-1:second', { party: 'Marta Vell' });
        expect(purse(base()) - purse(sameReply)).toBe(40);
        // The old rule still holds when nobody is named: a recap.
        const unnamed = coin('APPLY_COIN_LOSS', turns(coin('APPLY_COIN_LOSS', base(), 20, 'msg-1'), 2), 20, 'msg-2');
        expect(purse(base()) - purse(unnamed)).toBe(20);
    });

    it('one person\'s reward recapped twenty messages later pays once — and pays again after a long rest', () => {
        const paid = coin('ADD_COIN_GRANT', base(), 2000, 'msg-1', { party: 'Branock' });
        const later = turns(paid, 10);
        const recap = coin('ADD_COIN_GRANT', later, 2000, 'msg-2', { party: 'Branock' });
        expect(purse(recap)).toBe(purse(paid));
        expect(recap.messages.at(-1).content).toMatch(/already received from Branock/);
        // A new day: wages from the same employer are wages.
        const rested = { ...later, recentRests: [`msg-rest|long|${later.messages.length - 2}`] };
        expect(purse(coin('ADD_COIN_GRANT', rested, 2000, 'msg-2', { party: 'Branock' })) - purse(paid)).toBe(2000);
        // Unknown counterparty: the ordinary twelve-message window has passed.
        const unnamed = coin('ADD_COIN_GRANT', turns(coin('ADD_COIN_GRANT', base(), 2000, 'msg-1'), 10), 2000, 'msg-2');
        expect(purse(unnamed) - purse(base())).toBe(4000);
    });

    it('a name the roster cannot tell apart is never "different"', () => {
        expect(partyRelation({ party: 'the guard' }, { party: 'Sergeant Holt' })).toBe('unknown');
        // Only the roster's ids or the same name can say `same` (2026-11-07).
        expect(partyRelation({ party: 'Nib' }, { party: 'Nib Ashwhistle' })).toBe('unknown');
        expect(partyRelation({ party: 'Nib' }, { party: 'the nib' })).toBe('same');
        expect(partyRelation({ party: 'Jethro', partyId: 'a' }, { party: 'Marta', partyId: 'b' })).toBe('different');
    });
});

describe('the five holes close by construction', () => {
    it('H1: a bought item recapped as found is not granted twice', () => {
        const bought = gameReducer(base(), { type: 'PURCHASE_ITEM', payload: { name: 'Brass Lantern', priceCp: 500, _meta: { sourceId: 'msg-1', playerMessage: 'I buy the lantern.' } } });
        const recap = gameReducer(turns(bought, 2), { type: 'ADD_ITEM', payload: { name: 'brass lantern', _meta: { sourceId: 'msg-2', playerMessage: 'I light it.' } } });
        expect(recap.inventory.filter(item => /lantern/i.test(item.name))).toHaveLength(1);
    });

    it('H2: a re-emitted items_lost takes no second unit; the player burning another still does', () => {
        const stocked = { ...base(), inventory: [{ id: 't1', name: 'Torch', itemKey: 'torch', quantity: 5 }] };
        const burn = (state, id, playerMessage) => gameReducer(state, { type: 'REMOVE_ITEM_BY_NAME', payload: { name: 'Torch', _meta: { sourceId: id, playerMessage } } });
        const first = burn(stocked, 'msg-1', 'I light a torch.');
        const recap = burn(turns(first, 2), 'msg-2', 'I press on down the corridor.');
        expect(recap.inventory[0].quantity).toBe(4);
        expect(recap.messages.at(-1).content).toMatch(/Duplicate item loss ignored/);
        // A second torch is the repeat judge's call (2026-11-01 night), not a phrase rule's.
        const another = judgeLatest(burn(turns(first, 2), 'msg-3', 'The torch gutters, so I light another torch.'));
        expect(another.inventory[0].quantity).toBe(3);
    });

    it('H5: the DM\'s items_lost after an Inventory-panel handoff is that handoff retold', () => {
        const state = {
            ...base(),
            inventory: [{ id: 'd1', name: 'Dagger', itemKey: 'dagger', type: 'weapon', damage: '1d4', quantity: 2 }],
            party: [{ id: 'c-nib', name: 'Nib', hp: 8, maxHp: 8, ac: 12, status: 'active', weapon: 'Club' }],
        };
        const handed = gameReducer(state, { type: 'GIVE_GEAR_TO_COMPANION', payload: { itemId: 'd1', companionId: 'c-nib' } });
        expect(handed.inventory[0].quantity).toBe(1);
        const echoed = gameReducer(turns(handed, 1), { type: 'REMOVE_ITEM_BY_NAME', payload: { name: 'Dagger', _meta: { sourceId: 'msg-9', party: 'Nib', playerMessage: 'Take good care of it.' } } });
        expect(echoed.inventory[0]?.quantity).toBe(1);
    });

    it('a purchase whose goods already arrived as loot charges once and adds nothing', () => {
        const found = gameReducer(base(), { type: 'ADD_ITEM', payload: { name: 'Hempen Rope (50 ft)', itemKey: 'ropeHempen', _meta: { sourceId: 'msg-1' } } });
        const bought = gameReducer(turns(found, 1), { type: 'PURCHASE_ITEM', payload: { itemKey: 'ropeHempen', priceCp: 100, _meta: { sourceId: 'msg-2', playerMessage: 'Fine, I nod.' } } });
        expect(bought.inventory).toHaveLength(1);
        expect(purse(base()) - purse(bought)).toBe(100);
        expect(bought.messages.at(-1).content).toMatch(/already reached your pack/);
    });

    it('a sale whose proceeds already arrived as found coin takes the goods and pays nothing more', () => {
        const stocked = { ...base(), inventory: [{ id: 's1', name: 'Silver Ring', quantity: 1, valueCp: 600 }] };
        const paid = coin('ADD_COIN_GRANT', stocked, 300, 'msg-1');
        const sold = gameReducer(turns(paid, 1), { type: 'SELL_ITEM', payload: { name: 'Silver Ring', priceCp: 300, _meta: { sourceId: 'msg-2', playerMessage: 'Pleasure doing business.' } } });
        expect(sold.inventory).toHaveLength(0);
        expect(purse(sold)).toBe(purse(paid));
    });
});

describe('the audits read the log', () => {
    const audit = (state, appliedEvents, playerMessage = '') => ({
        sourceId: 'msg-20:scribe-loot',
        getState: () => state,
        appliedEvents,
        playerMessage,
    });

    it('H4: a catalog purchase with no priceCp is not a coin-silent reply', () => {
        const dispatch = vi.fn();
        runNarrationAudits({ narrated_payment: { gold: 15 } }, { lootAudit: audit(base(), { purchases: [{ itemKey: 'longsword' }], itemsFound: [], itemsLost: [], sells: [] }) }, dispatch);
        expect(dispatch).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'AUDIT_COIN_PAYMENT' }));
    });

    it('F7: a payment the narration shows beyond what the reply charged becomes a card, never a charge', () => {
        const dispatch = vi.fn();
        runNarrationAudits({ narrated_payment: { gold: 5, silver: 12, to: 'the assayer' } }, {
            lootAudit: audit(base(), { purchases: [{ name: 'Mace', priceCp: 500 }], itemsFound: [], itemsLost: [], sells: [] }),
        }, dispatch);
        expect(dispatch).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'AUDIT_COIN_PAYMENT' }));
        const card = dispatch.mock.calls.map(([action]) => action).find(action => action.payload?.kind === 'recovery');
        expect(card.payload.recovery).toMatchObject({ status: 'open', direction: 'out', coinCp: 120, party: 'the assayer' });
        expect(card.payload.dmVisible).toBeUndefined();
    });

    it('an item the evented reply left out is a card the player can book — once', () => {
        const dispatch = vi.fn();
        runNarrationAudits({ narrated_loot: { items: [{ name: 'Mace', quantity: 1 }, { name: 'Spool of red copper wire', quantity: 1 }] } }, {
            lootAudit: audit(base(), { purchases: [{ name: 'Mace', priceCp: 500 }], itemsFound: [], itemsLost: [], sells: [] }),
        }, dispatch);
        expect(dispatch).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'ADD_ITEM' }));
        const card = dispatch.mock.calls.map(([action]) => action).find(action => action.payload?.kind === 'recovery');
        expect(card.payload.recovery.items).toEqual([{ name: 'Spool of red copper wire', quantity: 1 }]);

        const posted = gameReducer(base(), { type: 'ADD_MESSAGE', payload: card.payload });
        const dismissed = gameReducer(posted, { type: 'RESOLVE_RECOVERY', payload: { messageId: card.payload.id, accept: false } });
        expect(dismissed.inventory).toHaveLength(0);
        expect(dismissed.messages.at(-1).recovery.status).toBe('dismissed');

        const accepted = gameReducer(posted, { type: 'RESOLVE_RECOVERY', payload: { messageId: card.payload.id, accept: true } });
        expect(accepted.inventory.map(item => item.name)).toEqual(['Spool of red copper wire']);
        expect(accepted.ledger.at(-1)).toMatchObject({ lane: 'player', kind: 'item' });
        const again = gameReducer(accepted, { type: 'RESOLVE_RECOVERY', payload: { messageId: card.payload.id, accept: true } });
        expect(again.inventory).toHaveLength(1);
    });

    it('a sold item is never also removed by the loss audit', () => {
        const dispatch = vi.fn();
        const state = { ...base(), inventory: [{ id: 'r1', name: 'Silver Ring', quantity: 1 }] };
        runNarrationAudits({ narrated_losses: { items: [{ name: 'Silver Ring' }] } }, {
            lootAudit: audit(state, { sells: [{ name: 'Silver Ring', priceCp: 300 }], itemsFound: [], itemsLost: [], purchases: [] }),
        }, dispatch);
        expect(dispatch).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'REMOVE_ITEM_BY_NAME' }));
    });
});

describe('the wire, the save and the DM\'s view', () => {
    it('coin_from / coin_to / seller / items "to" reach the judge as the counterparty', () => {
        const fence = (payload) => `The coins change hands.\n\`\`\`json\n${JSON.stringify(payload)}\n\`\`\``;
        const { events } = parseResponse(fence({ silver_lost: 2, coin_to: 'Jethro', gold_found: 1, coin_from: 'Branock', items_lost: [{ name: 'Letter', to: 'Marta Vell' }] }));
        const dispatch = vi.fn();
        applyEvents(events, dispatch, () => ({ character: {}, party: [] }), { lootSourceId: 'msg-5' });
        const metaOf = (type) => dispatch.mock.calls.map(([action]) => action).find(action => action.type === type)?.payload?._meta;
        expect(metaOf('APPLY_COIN_LOSS')).toMatchObject({ sourceId: 'msg-5', party: 'Jethro' });
        expect(metaOf('ADD_COIN_GRANT')).toMatchObject({ party: 'Branock' });

        expect(metaOf('REMOVE_ITEM_BY_NAME')).toMatchObject({ sourceId: 'msg-5', party: 'Marta Vell' });
        // A purchase zeroes the reply's loose losses (its price is the payment), so it rides its own reply.
        const trade = vi.fn();
        applyEvents(parseResponse(fence({ purchase: { name: 'Rope', priceCp: 10, seller: 'Hobb' }, sell: { name: 'Ring', buyer: 'Marta Vell' } })).events, trade, () => ({ character: {}, party: [] }), { lootSourceId: 'msg-6' });
        const tradeMeta = (type) => trade.mock.calls.map(([action]) => action).find(action => action.type === type)?.payload?._meta;
        expect(tradeMeta('PURCHASE_ITEM')).toMatchObject({ party: 'Hobb' });
        expect(tradeMeta('SELL_ITEM')).toMatchObject({ party: 'Marta Vell' });
    });

    it('a save from before 2026-11-01 folds its five ledgers into the log, and LOAD drops them', () => {
        const legacy = {
            recentCoinGrants: [{ signature: 'coins|2000cp', priceCp: 2000, sourceId: 'msg-1', messageIndex: 3, status: 'applied' }],
            recentCoinLosses: [{ signature: 'coin-loss|20cp', priceCp: 20, sourceId: 'msg-4:scribe-loot:payment', messageIndex: 7, status: 'applied' }],
            recentSales: [{ signature: 'ring|1|300', name: 'Silver Ring', priceCp: 300, sourceId: 'msg-6', messageIndex: 9, status: 'ignored' }],
            recentItemGrants: [{ signature: 'item|torch', name: 'Torch', itemKey: 'torch', sourceId: 'msg-2', messageIndex: 5 }],
        };
        const log = migrateLegacyLedgers(legacy);
        expect(log.map(entry => [entry.kind, entry.cp, entry.lane, entry.atMessage])).toEqual([
            ['coin', 2000, 'dm', 3], ['item', 0, 'dm', 5], ['coin', -20, 'audit', 7], ['sale', 300, 'dm', 9],
        ]);
        expect(log[3]).toMatchObject({ status: 'ignored', movedCp: 0, itemsMoved: false });
        expect(loadLedger({ ...legacy, ledger: [] })).toEqual([]);
        const loaded = gameReducer(initialGameState, { type: 'LOAD_GAME', payload: { character: base().character, inventory: [], messages: [], ...legacy } });
        expect(loaded.ledger).toHaveLength(4);
        expect(loaded.recentCoinGrants).toBeUndefined();
    });

    it('RECENT TRANSACTIONS shows the last movements with whom and when — and only in the full prompt', () => {
        let state = coin('APPLY_COIN_LOSS', base(), 40, 'msg-1', { party: 'Darya Kell' });
        state = gameReducer(turns(state, 2), { type: 'PURCHASE_ITEM', payload: { name: 'Brass Lantern', priceCp: 500, _meta: { sourceId: 'msg-2', party: 'Hobb', playerMessage: 'I buy it.' } } });
        state = turns(state, 1);
        const block = formatLedgerForPrompt(state.ledger, state.messages);
        expect(block).toMatch(/^## RECENT TRANSACTIONS/);
        expect(block).toContain('3 turns ago: paid 4 sp to Darya Kell');
        expect(block).toContain('1 turn ago: bought Brass Lantern from Hobb for 5 gp');
        const names = (options) => {
            const parts = buildSystemPromptParts({ character: state.character, inventory: state.inventory, messages: state.messages, messageCount: state.messages.length, ledger: state.ledger, npcs: [], party: [], quests: [], ...options });
            return parts.names || parts.map?.(part => part.name) || [];
        };
        expect(JSON.stringify(names({}))).toContain('ledger');
        expect(JSON.stringify(names({ intentOnly: true }))).not.toContain('ledger');
        expect(formatLedgerForPrompt([], state.messages)).toBe('');
    });
});
