import { describe, expect, it } from 'vitest';
import { gameReducer, initialGameState } from './gameReducer.js';
import { partyRelation } from '../engine/transactionLedger.js';
import { judgeLatest } from './repeatJudge.testUtils.js';

// Playtest run 6 (2026-11-01, Flash, the economy's opposite failure): the
// judge dropped GENUINE repeats as replays — a second crate's 1 sp wage, a
// second pelt's 5 sp sale. The phrase rules written for it that night were
// escaped by the next line each time; since 2026-11-01 (night) no rule reads
// the DM lane's words: a twin from an earlier message books nothing and asks
// the repeat judge (llm/repeatJudge.js), which READS the two turns.

const pair = (state, i) => ({
    ...state,
    messages: [...state.messages, { id: `u${i}`, role: 'user', content: `beat ${i}` }, { id: `a${i}`, role: 'assistant', content: `reply ${i}` }],
});
const turns = (state, n) => Array.from({ length: n }).reduce((s, _, i) => pair(s, `${s.messages.length}-${i}`), state);
const purse = (state) => state.character.gold * 100 + state.character.silver * 10 + state.character.copper;
const base = (overrides = {}) => ({
    ...initialGameState,
    character: { ...initialGameState.character, name: 'Brannoc', gold: 27, silver: 0, copper: 0 },
    inventory: [{ id: 'p1', name: 'Wolf pelts', quantity: 4, valueCp: 100 }],
    messages: [],
    npcs: [
        { id: 'npc-hesk', name: 'Hesk Varro', rosterTier: 'character', kind: 'character' },
        { id: 'npc-maud', name: 'Old Maud', rosterTier: 'character', kind: 'character' },
    ],
    ...overrides,
});
const grant = (state, cp, sourceId, meta = {}) => gameReducer(state, { type: 'ADD_COIN_GRANT', payload: { copper: cp, _meta: { sourceId, ...meta } } });
const sell = (state, sourceId, meta = {}) => gameReducer(state, { type: 'SELL_ITEM', payload: { name: 'Wolf pelts', quantity: 1, priceCp: 50, _meta: { sourceId, ...meta } } });
const card = (state) => state.messages.findLast(message => message.kind === 'recovery');
const resolve = (state, accept) => gameReducer(state, { type: 'RESOLVE_RECOVERY', payload: { messageId: card(state).id, accept } });
const undo = (state) => gameReducer(state, { type: 'UNDO_REPEAT', payload: { messageId: card(state).id } });

// Run 6's second crate: "Varro slaps another river-dull silver piece into your palm."
const secondWage = () => grant(turns(grant(base(), 10, 'msg-3', { party: 'Hesk Varro' }), 1), 10, 'msg-6', {
    party: 'Hesk Varro',
    playerMessage: 'I heave the nxet crate up onto my shoulder. Hand out again.',
});
// Run 6's fourth pelt: "the roll of grey fur" — no name, no counting word.
const fourthPelt = () => sell(turns(sell(base(), 'msg-49', { party: 'Old Maud' }), 1), 'msg-58', {
    party: 'Old Maud',
    playerMessage: 'I dig the roll of grey fur out from under the bedroll.',
});

describe('a twin from an earlier message books nothing and asks the repeat judge', () => {
    it('whatever the words: the wage, the sale', () => {
        const wage = secondWage();
        expect(purse(wage) - purse(base())).toBe(10);
        expect(card(wage)).toMatchObject({
            kind: 'recovery',
            dmVisible: true,
            recovery: {
                status: 'judging',
                mode: 'repeat',
                replay: { type: 'ADD_COIN_GRANT', payload: { copper: 10 } },
                party: 'Hesk Varro',
                judge: { sourceId: 'msg-6', twinSourceId: 'msg-3', earlier: 'the hero received 1 sp (Hesk Varro)' },
            },
        });
        const pelt = fourthPelt();
        expect(purse(pelt) - purse(base())).toBe(50);
        expect(pelt.inventory[0].quantity).toBe(3);
        expect(card(pelt).content).toMatch(/^\*\*Recorded once:\*\* Duplicate sale ignored/);
        expect(card(pelt).recovery.judge.earlier).toBe('the hero sold Wolf pelts for 5 sp (Old Maud)');
    });

    it('certain replays stay plain notes: the same message, the same reply', () => {
        const once = grant(base(), 10, 'msg-3', { party: 'Hesk Varro' });
        expect(grant(once, 10, 'msg-3', { party: 'Hesk Varro' }).messages.at(-1).kind).toBeUndefined();
        expect(grant(once, 10, 'msg-3:b', { party: 'Hesk Varro' }).messages.at(-1).kind).toBeUndefined();
    });

    it('the audits never ask: they are reconciled against their own narration', () => {
        const first = grant(base(), 10, 'msg-3', { party: 'Hesk Varro' });
        const audit = grant(turns(first, 1), 10, 'msg-6:scribe-loot', { audit: true, announce: 'audit' });
        expect(purse(audit) - purse(base())).toBe(10);
        expect(card(audit)).toBeUndefined();
    });

    it('a covered component asks too: a price already paid as loose coin', () => {
        const rich = base({ character: { ...base().character, gold: 0, silver: 20 } });
        const paid = gameReducer(rich, { type: 'APPLY_COIN_LOSS', payload: { silver: 1, _meta: { sourceId: 'msg-1', playerMessage: 'I pay for passage.' } } });
        // "I buy a bowl of mutton stew" (live 2026-08-06): also 1 sp.
        const stew = gameReducer(turns(paid, 1), { type: 'PURCHASE_ITEM', payload: { name: 'Mutton stew', priceCp: 10, _meta: { sourceId: 'msg-2', playerMessage: 'I buy a bowl of mutton stew.' } } });
        expect(purse(rich) - purse(stew)).toBe(10);
        expect(stew.inventory.some(item => item.name === 'Mutton stew')).toBe(true);
        expect(card(stew).recovery.replay).toEqual({ type: 'APPLY_COIN_LOSS', payload: { copper: 10 } });
        expect(purse(rich) - purse(judgeLatest(stew))).toBe(20);
    });
});

describe('the verdict', () => {
    it('"new" books exactly the declined movement on the judge lane', () => {
        const booked = judgeLatest(secondWage(), 'new', 'a second crate carried and paid');
        expect(purse(booked) - purse(base())).toBe(20);
        expect(booked.ledger.at(-1)).toMatchObject({ lane: 'judge', kind: 'coin', status: 'applied', party: 'Hesk Varro' });
        expect(card(booked).recovery.status).toBe('booked');
        expect(card(booked).content).toBe('**Checked — a new one:** 1 sp from Hesk Varro (a second crate carried and paid).');
        // A late second verdict, or the player's old buttons, move nothing more.
        expect(judgeLatest(booked)).toBe(booked);
        expect(resolve(booked, true)).toBe(booked);
    });

    it('"same" books nothing, says it was checked, and leaves "Record it again"', () => {
        const kept = judgeLatest(secondWage(), 'same', 'the earlier wage retold');
        expect(purse(kept) - purse(base())).toBe(10);
        expect(card(kept).recovery).toMatchObject({ status: 'open', verdict: 'same' });
        expect(card(kept).content).toBe('**Recorded once:** 1 sp from Hesk Varro matches an earlier turn — checked: the same one (the earlier wage retold). If it was new, record it.');
        expect(purse(resolve(kept, true)) - purse(base())).toBe(20);
    });

    it('"unsure" (or a failed call) leaves the card for the player', () => {
        const unsure = judgeLatest(secondWage(), 'unsure');
        expect(card(unsure).recovery.status).toBe('open');
        expect(purse(unsure) - purse(base())).toBe(10);
    });

    it('the player answering first wins; the late verdict lands nothing', () => {
        const answered = resolve(secondWage(), false);
        expect(card(answered).recovery.status).toBe('dismissed');
        const late = gameReducer(answered, { type: 'JUDGE_REPEAT', payload: { messageId: card(answered).id, verdict: 'new' } });
        expect(late).toBe(answered);
    });

    it('a booking that cannot land (the pelt already gone) leaves the buttons', () => {
        const pelt = fourthPelt();
        const emptied = { ...pelt, inventory: [] };
        const judged = judgeLatest(emptied, 'new');
        expect(card(judged).recovery.status).toBe('open');
        expect(purse(judged)).toBe(purse(pelt));
    });

    it('finds its card by the movement when the row id moved', () => {
        const wage = secondWage();
        const moved = { ...wage, messages: wage.messages.map(message => (message.kind === 'recovery' ? { ...message, id: 'other-id' } : message)) };
        const booked = gameReducer(moved, { type: 'JUDGE_REPEAT', payload: { messageId: 'stale-id', sourceId: 'msg-6', verdict: 'new' } });
        expect(purse(booked) - purse(base())).toBe(20);
    });
});

describe('Undo — same one', () => {
    it('takes a judge-booked wage back out', () => {
        const undone = undo(judgeLatest(secondWage(), 'new'));
        expect(purse(undone) - purse(base())).toBe(10);
        expect(card(undone).recovery.status).toBe('undone');
        expect(undo(undone)).toBe(undone);
    });

    it('takes a judge-booked sale back: the coin out, the pelt back with its value', () => {
        const booked = judgeLatest(fourthPelt(), 'new');
        expect(booked.inventory[0].quantity).toBe(2);
        const undone = undo(booked);
        expect(purse(undone) - purse(base())).toBe(50);
        const pelts = undone.inventory.filter(item => item.name === 'Wolf pelts').reduce((sum, item) => sum + item.quantity, 0);
        expect(pelts).toBe(3);
        expect(undone.inventory.find(item => item.name === 'Wolf pelts').valueCp).toBe(100);
    });

    it('a saved card is input: only the six movements, only their keys', () => {
        const state = secondWage();
        const id = card(state).id;
        const tampered = {
            ...state,
            messages: state.messages.map(message => (message.id === id
                ? { ...message, recovery: { ...message.recovery, replay: { type: 'LEVEL_UP', payload: { bonusExp: 99999 } } } }
                : message)),
        };
        const after = judgeLatest(tampered, 'new');
        expect(after.character.exp).toBe(state.character.exp);
        expect(purse(after)).toBe(purse(state));
        const forged = {
            ...state,
            messages: state.messages.map(message => (message.id === id
                ? { ...message, recovery: { ...message.recovery, status: 'booked', undo: [{ type: 'ADD_COIN_GRANT', payload: { copper: 99999999 } }, { type: 'LEVEL_UP', payload: {} }, { type: 'ADD_COIN_GRANT', payload: { copper: 5 } }] } }
                : message)),
        };
        // Two steps at most, each projected and clamped.
        expect(purse(undo(forged)) - purse(state)).toBe(10_000); // the grant's own MAX_COIN_EVENT
    });
});

describe('a counterparty the roster learned later', () => {
    it('is resolved at judging time, so two known people are never one bundle', () => {
        // The dockmaster's 1 sp was logged before he was on the roster: no id.
        const early = grant({ ...base(), npcs: [] }, 10, 'msg-3', { party: 'Hesk Varro' });
        expect(early.ledger.at(-1).partyId).toBe('');
        const later = { ...turns(early, 9), npcs: [...base().npcs, { id: 'npc-tamsin', name: 'Tamsin Reed', rosterTier: 'character', kind: 'character' }] };
        const pot = grant(later, 40, 'msg-24', { party: 'Tamsin Reed', playerMessage: 'I rattle the cup and throw.' });
        expect(purse(pot) - purse(base())).toBe(50);
        expect(pot.messages.some(message => /bundled coin grant/.test(message.content))).toBe(false);
    });

    it('partyRelation reads a resolver for a missing id', () => {
        const lookup = (name) => ({ 'Hesk Varro': 'npc-hesk', 'Tamsin Reed': 'npc-tamsin' }[name] || '');
        expect(partyRelation({ party: 'Hesk Varro' }, { party: 'Tamsin Reed', partyId: 'npc-tamsin' }, lookup)).toBe('different');
        expect(partyRelation({ party: 'Hesk Varro' }, { party: 'Tamsin Reed', partyId: 'npc-tamsin' })).toBe('unknown');
        expect(partyRelation({ party: 'the guard' }, { party: 'Sergeant Holt' }, lookup)).toBe('unknown');
    });
});
