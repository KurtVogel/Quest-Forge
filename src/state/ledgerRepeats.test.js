import { describe, expect, it } from 'vitest';
import { gameReducer, initialGameState } from './gameReducer.js';
import { itemNounSrc, narrativeCountsAnother } from './handlers/ledger.js';
import { partyRelation } from '../engine/transactionLedger.js';

// Playtest run 6 (2026-11-01, Flash, the economy's opposite failure): the
// judge dropped GENUINE repeats as replays — a second crate's 1 sp wage, a
// second pelt's 5 sp sale — although the DM's own narration counted them
// ("slaps another river-dull silver piece", "five more dull silver coins").
// And a dockmaster's 1 sp, logged before he joined the roster, was stripped
// out of a gambler's 4 sp pot as "the same reward".

const pair = (state, i) => ({
    ...state,
    messages: [...state.messages, { id: `u${i}`, role: 'user', content: `beat ${i}` }, { id: `a${i}`, role: 'assistant', content: `reply ${i}` }],
});
const turns = (state, n) => Array.from({ length: n }).reduce((s, _, i) => pair(s, `${s.messages.length}-${i}`), state);
const purse = (state) => state.character.gold * 100 + state.character.silver * 10 + state.character.copper;
const base = (overrides = {}) => ({
    ...initialGameState,
    character: { ...initialGameState.character, name: 'Brannoc', gold: 27, silver: 0, copper: 0 },
    inventory: [{ id: 'p1', name: 'Wolf pelts', quantity: 4, value: 50 }],
    messages: [],
    npcs: [
        { id: 'npc-hesk', name: 'Hesk Varro', rosterTier: 'character', kind: 'character' },
        { id: 'npc-maud', name: 'Old Maud', rosterTier: 'character', kind: 'character' },
    ],
    ...overrides,
});
const grant = (state, cp, sourceId, meta = {}) => gameReducer(state, { type: 'ADD_COIN_GRANT', payload: { copper: cp, _meta: { sourceId, ...meta } } });
const sell = (state, sourceId, meta = {}) => gameReducer(state, { type: 'SELL_ITEM', payload: { name: 'Wolf pelts', quantity: 1, priceCp: 50, _meta: { sourceId, ...meta } } });

describe('the DM\'s own counting is a new movement, not a replay', () => {
    it('a second crate\'s wage pays when the narration says "another silver"', () => {
        const first = grant(base(), 10, 'msg-3', { party: 'Hesk Varro', playerMessage: 'I shoulder a crate and hold out my hand.' });
        const second = grant(turns(first, 1), 10, 'msg-6', {
            party: 'Hesk Varro',
            playerMessage: 'I heave the next crate up onto my shoulder and set it by the first. Hand out again.',
            narrative: 'The dockmaster presses a second deep notch into his tally-stick before he slaps another river-dull silver piece into your waiting palm.',
        });
        expect(purse(second) - purse(base())).toBe(20);
    });

    it('a re-emitted wage whose narration only retells it still pays once', () => {
        const first = grant(base(), 10, 'msg-3', { party: 'Hesk Varro' });
        const recap = grant(turns(first, 1), 10, 'msg-6', {
            party: 'Hesk Varro',
            playerMessage: 'I look around for Tuva.',
            narrative: 'Varro\'s silver is warm in your fist as you climb the slipway. "Twenty-nine more down in that bilge," he calls after you.',
        });
        expect(purse(recap) - purse(base())).toBe(10);
        expect(recap.messages.at(-1).content).toMatch(/Duplicate coin grant ignored/);
    });

    it('a second pelt sold one at a time pays when the narration counts the coins', () => {
        const first = sell(base(), 'msg-9', { party: 'Old Maud', playerMessage: 'I drop one wolf pelt on her counter.' });
        const second = sell(turns(first, 1), 'msg-12', {
            playerMessage: '"One at a time, Maud." I pull the next pelt out and slap it down where the first one was.',
            narrative: 'Maud turns to an iron pot and pitches five more dull silver coins onto the timber one by one.',
        });
        expect(purse(second) - purse(base())).toBe(100);
        expect(second.inventory[0].quantity).toBe(2);
    });

    it('the third pelt pays too — "another stack of five clipped silver", or the player\'s own "the next pelt"', () => {
        const first = sell(base(), 'msg-49', { party: 'Old Maud' });
        const byNarration = sell(turns(first, 1), 'msg-52', {
            playerMessage: '"Not pillows." I wait.',
            narrative: 'She nods once before sliding another stack of five clipped silver pieces across the tallow-crusted pine.',
        });
        expect(purse(byNarration) - purse(base())).toBe(100);
        const byPlayer = sell(turns(first, 1), 'msg-52', {
            playerMessage: '"Not pillows." I lay the next pelt on the counter beside where the last one was and wait.',
            narrative: 'Maud scoops the pelt into the salt bin behind her.',
        });
        expect(byPlayer.inventory[0].quantity).toBe(2);
        // No counting at all, just the player putting the goods down: a sale.
        const putDown = sell(turns(first, 1), 'msg-55', {
            party: 'Old Maud',
            playerMessage: '"Clear the board." I pull out the last pelt and put it down for her.',
            narrative: 'She digs five clipped silver bits from a dented salt tin and clatters them against the wood into your palm.',
        });
        expect(purse(putDown) - purse(base())).toBe(100);
    });

    it('a sale retold without counting stays a replay', () => {
        const first = sell(base(), 'msg-9', { party: 'Old Maud' });
        const recap = sell(turns(first, 1), 'msg-12', { party: 'Old Maud', narrative: 'Maud slides the wolf skin under her bench.' });
        expect(purse(recap) - purse(base())).toBe(50);
        expect(recap.inventory[0].quantity).toBe(3);
    });

    it('reads narration only: quoted offers and negations do not count', () => {
        const coinNoun = '(?:gold|silver|copper|coins?)';
        expect(narrativeCountsAnother('"Another two silver to see if the sheep still like you?"', coinNoun)).toBe(false);
        expect(narrativeCountsAnother('He won\'t give you another copper for it.', coinNoun)).toBe(false);
        expect(narrativeCountsAnother('You count the same silver again.', coinNoun)).toBe(false);
        expect(narrativeCountsAnother('A second torch gutters out.', itemNounSrc({ name: 'Torch' }))).toBe(true);
        expect(itemNounSrc({ name: 'Hempen Rope (50 ft)' })).toBe('(?:hempen|rope)(?:s|es)?');
    });

    it('the audits never take the narration bypass', () => {
        const first = grant(base(), 10, 'msg-3', { party: 'Hesk Varro' });
        const audit = grant(turns(first, 1), 10, 'msg-6:scribe-loot', {
            audit: true,
            announce: 'audit',
            narrative: 'He slaps another silver piece into your palm.',
        });
        expect(purse(audit) - purse(base())).toBe(10);
    });
});

describe('"Recorded once": the judgment text cannot settle goes to the player', () => {
    const resolve = (state, accept) => {
        const card = state.messages.findLast(message => message.kind === 'recovery');
        return gameReducer(state, { type: 'RESOLVE_RECOVERY', payload: { messageId: card.id, accept } });
    };
    // Run 6's fourth pelt: "the roll of grey fur" — no name, no counting.
    const dropped = () => {
        const first = sell(base(), 'msg-49', { party: 'Old Maud' });
        return sell(turns(first, 1), 'msg-58', {
            party: 'Old Maud',
            playerMessage: 'I dig the roll of grey fur out from under the bedroll.',
            narrative: 'Maud thumps five clipped silver bits onto the greased pine.',
        });
    };

    it('books nothing, and asks', () => {
        const state = dropped();
        expect(purse(state) - purse(base())).toBe(50);
        const card = state.messages.at(-1);
        expect(card).toMatchObject({ kind: 'recovery', dmVisible: true, recovery: { status: 'open', mode: 'repeat', replay: { type: 'SELL_ITEM' } } });
        expect(card.content).toMatch(/^\*\*Recorded once:\*\* Duplicate sale ignored/);
    });

    it('"Record it again" re-runs exactly that sale once; "Same one" changes nothing', () => {
        const accepted = resolve(dropped(), true);
        expect(purse(accepted) - purse(base())).toBe(100);
        expect(accepted.inventory[0].quantity).toBe(2);
        expect(accepted.ledger.at(-1)).toMatchObject({ lane: 'player', kind: 'sale', status: 'applied' });
        expect(resolve(accepted, true)).toBe(accepted);
        const kept = resolve(dropped(), false);
        expect(purse(kept) - purse(base())).toBe(50);
        expect(kept.messages.at(-1).recovery.status).toBe('dismissed');
    });

    it('coin, purchase and item twins ask too; certain replays stay notes', () => {
        const wage = grant(turns(grant(base(), 10, 'msg-3', { party: 'Hesk Varro' }), 1), 10, 'msg-6', { party: 'Hesk Varro' });
        expect(wage.messages.at(-1).recovery?.replay).toEqual({ type: 'ADD_COIN_GRANT', payload: { copper: 10 } });
        expect(purse(resolve(wage, true)) - purse(base())).toBe(20);
        // The same message asking again, and a twin inside one reply: no card.
        const once = grant(base(), 10, 'msg-3', { party: 'Hesk Varro' });
        expect(grant(once, 10, 'msg-3', { party: 'Hesk Varro' }).messages.at(-1).kind).toBeUndefined();
        expect(grant(once, 10, 'msg-3:b', { party: 'Hesk Varro' }).messages.at(-1).kind).toBeUndefined();
        const torch = { ...base(), inventory: [{ id: 't1', name: 'Torch', itemKey: 'torch', quantity: 5 }] };
        const burn = (state, id) => gameReducer(state, { type: 'REMOVE_ITEM_BY_NAME', payload: { name: 'Torch', _meta: { sourceId: id, playerMessage: 'I walk on.' } } });
        const reburned = burn(turns(burn(torch, 'msg-1'), 1), 'msg-2');
        expect(reburned.inventory[0].quantity).toBe(4);
        expect(resolve(reburned, true).inventory[0].quantity).toBe(3);
    });

    it('a saved card is input: only the six movements, only their keys', () => {
        const state = dropped();
        const card = state.messages.at(-1);
        const tampered = {
            ...state,
            messages: state.messages.map(message => (message.id === card.id
                ? { ...message, recovery: { ...message.recovery, replay: { type: 'LEVEL_UP', payload: { bonusExp: 99999 } } } }
                : message)),
        };
        const after = gameReducer(tampered, { type: 'RESOLVE_RECOVERY', payload: { messageId: card.id, accept: true } });
        expect(after.character.exp).toBe(state.character.exp);
        expect(purse(after)).toBe(purse(state));
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
        const resolve = (name) => ({ 'Hesk Varro': 'npc-hesk', 'Tamsin Reed': 'npc-tamsin' }[name] || '');
        expect(partyRelation({ party: 'Hesk Varro' }, { party: 'Tamsin Reed', partyId: 'npc-tamsin' }, resolve)).toBe('different');
        expect(partyRelation({ party: 'Hesk Varro' }, { party: 'Tamsin Reed', partyId: 'npc-tamsin' })).toBe('unknown');
        expect(partyRelation({ party: 'the guard' }, { party: 'Sergeant Holt' }, resolve)).toBe('unknown');
    });
});
