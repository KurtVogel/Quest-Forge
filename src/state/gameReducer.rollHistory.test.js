/**
 * Live rollHistory bound: only 50 rolls are persisted, 20 render, 5 reach the
 * prompt — but every append site grew the live array unbounded for the whole
 * session (2026-08-01 audit). Every site routes through appendRollHistory.
 *
 * The ledger's MEMBERSHIP RULE (2026-10-04 audit): a die the HERO's own action
 * rolled enters the ledger; another actor's die never does. Pinned both ways.
 */
import { describe, expect, it } from 'vitest';
import { gameReducer, initialGameState } from './gameReducer.js';
import { describeFaces } from './handlers/shared.js';
import { serializeGameState } from './persistence.js';
import { ROLL_HISTORY_CAP } from '../config/contentLimits.js';
import { buildSpellSlots } from '../engine/spellcasting.js';
import { buildRecallDossier } from '../engine/recallDossier.js';

const makeRoll = (i) => ({
    id: `roll-${i}`,
    notation: '1d20+0',
    dice: { count: 1, sides: 20 },
    rolls: [10],
    subtotal: 10,
    modifier: 0,
    total: 10,
    description: `Roll ${i}`,
    isCritical: false,
    isCritFail: false,
});

const line = (role, content, i) => ({ id: `m${i}`, role, content, timestamp: i });

function cleric(overrides = {}) {
    return {
        ...initialGameState,
        character: {
            name: 'Maren', race: 'dwarf', class: 'cleric', level: 5, currentHP: 10, maxHP: 30, armorClass: 16,
            abilityScores: { strength: 12, dexterity: 10, constitution: 14, intelligence: 10, wisdom: 16, charisma: 12 },
            conditions: [],
            classResources: { channelDivinity: { used: 0, max: 1 } },
            hitDice: { total: 5, remaining: 5, die: 8 },
            spellSlots: buildSpellSlots(5),
            sustainedSpell: null,
            gold: 0, silver: 0, copper: 0,
            ...overrides,
        },
        messages: [line('user', 'I pray.', 0), line('assistant', 'The candles gutter.', 1)],
    };
}

describe('rollHistory cap', () => {
    it('keeps only the newest 50 rolls in live state', () => {
        let state = initialGameState;
        for (let i = 0; i < 60; i++) {
            state = gameReducer(state, { type: 'ADD_ROLL', payload: makeRoll(i) });
        }
        expect(state.rollHistory).toHaveLength(50);
        expect(state.rollHistory[0].id).toBe('roll-10'); // oldest 10 dropped
        expect(state.rollHistory[49].id).toBe('roll-59'); // newest kept
    });

    it('LOAD_GAME caps a hand-edited unbounded save at the same 50 (2026-08-20 audit)', () => {
        const loaded = gameReducer(initialGameState, {
            type: 'LOAD_GAME',
            payload: {
                messages: [],
                rollHistory: Array.from({ length: 120 }, (_, i) => makeRoll(i)),
            },
        });
        expect(loaded.rollHistory).toHaveLength(50);
        expect(loaded.rollHistory[49].id).toBe('roll-119'); // newest kept
    });

    it('append, load, and serialize read ONE cap constant', () => {
        const overfull = { ...initialGameState, rollHistory: Array.from({ length: ROLL_HISTORY_CAP + 30 }, (_, i) => makeRoll(i)) };
        expect(serializeGameState(overfull).rollHistory).toHaveLength(ROLL_HISTORY_CAP);
        expect(gameReducer(overfull, { type: 'ADD_ROLL', payload: makeRoll(999) }).rollHistory).toHaveLength(ROLL_HISTORY_CAP);
    });
});

describe('ledger membership: a die the hero’s action rolled enters the ledger', () => {
    it('an out-of-combat spell heal reaches the ledger, one entry per recipient', () => {
        const state = {
            ...cleric(),
            party: [
                { id: 'c1', name: 'Tammo', hp: 3, maxHp: 20, ac: 14, status: 'active' },
                { id: 'c2', name: 'Ilse', hp: 5, maxHp: 18, ac: 13, status: 'active' },
            ],
        };
        const healed = gameReducer(state, { type: 'CAST_SPELL', payload: { spell: 'cure wounds', target: 'self', _meta: { sourceId: 'msg-1' } } });
        expect(healed.rollHistory).toHaveLength(1);
        expect(healed.rollHistory[0]).toMatchObject({ description: 'Cure Wounds', atMessage: 2 });

        const mass = gameReducer(state, { type: 'CAST_SPELL', payload: { spell: 'mass healing word', targets: ['Tammo', 'Ilse'], _meta: { sourceId: 'msg-2' } } });
        expect(mass.rollHistory).toHaveLength(2);
    });

    it('a spell with no dice (and a refused cast) ledgers nothing', () => {
        const refused = gameReducer(cleric({ currentHP: 0, dying: true }), { type: 'CAST_SPELL', payload: { spell: 'cure wounds', _meta: { sourceId: 'msg-1' } } });
        expect(refused.rollHistory).toEqual([]);
        const warded = gameReducer(cleric(), { type: 'CAST_SPELL', payload: { spell: 'shield of faith', _meta: { sourceId: 'msg-1' } } });
        expect(warded.rollHistory).toEqual([]);
    });

    it('a Short Rest’s hit dice reach the ledger as ONE entry whose total is the healing rolled', () => {
        const rested = gameReducer(cleric({ currentHP: 4 }), { type: 'TAKE_REST', payload: 'short' });
        expect(rested.rollHistory).toHaveLength(1);
        const [entry] = rested.rollHistory;
        const spent = 5 - rested.character.hitDice.remaining;
        expect(entry.description).toBe('Short Rest hit dice');
        expect(entry.rolls).toHaveLength(spent);
        // CON 14: each d8 heals face + 2.
        expect(entry.total).toBe(entry.rolls.reduce((sum, face) => sum + face + 2, 0));
        expect(rested.character.currentHP).toBe(Math.min(30, 4 + entry.total));
    });

    it('a Short Rest at full health and a Long Rest roll no dice and ledger nothing', () => {
        expect(gameReducer(cleric({ currentHP: 30 }), { type: 'TAKE_REST', payload: 'short' }).rollHistory).toEqual([]);
        expect(gameReducer(cleric({ currentHP: 4 }), { type: 'TAKE_REST', payload: 'long' }).rollHistory).toEqual([]);
    });

    it('an exchange ledgers ONLY its heroRolls — another actor’s dice never enter', () => {
        const active = {
            ...cleric(),
            combat: {
                ...initialGameState.combat,
                active: true,
                phase: 'awaiting_intent',
                round: 1,
                enemies: [{ id: 'e1', name: 'Goblin', hp: 7, maxHp: 7, ac: 12, combatStatus: 'active' }],
                turnOrder: [{ type: 'player', id: 'player', name: 'Maren', initiative: 12 }, { type: 'enemy', id: 'e1', name: 'Goblin', initiative: 8 }],
                currentTurn: 0,
            },
        };
        const payload = (extra) => ({
            exchangeId: 'x1', enemies: active.combat.enemies, party: [], playerDamage: 0, deathSaveNatural: null,
            consumeActionSurge: false,
            result: { exchangeId: 'x1', kind: 'exchange', round: 1, terminal: null, summary: 'Hit.' },
            ...extra,
        });
        const enemyDice = [{ id: 'enemy-attack', total: 9, rolls: [9] }];
        const withoutHero = gameReducer(active, { type: 'APPLY_COMBAT_EXCHANGE', payload: payload({ rolls: enemyDice }) });
        expect(withoutHero.rollHistory).toEqual([]);
        const withHero = gameReducer(active, {
            type: 'APPLY_COMBAT_EXCHANGE',
            payload: payload({ rolls: [...enemyDice, { id: 'hero-attack', total: 17, rolls: [12] }], heroRolls: [{ id: 'hero-attack', total: 17, rolls: [12] }] }),
        });
        expect(withHero.rollHistory.map(r => r.id)).toEqual(['hero-attack']);
        expect(withHero.rollHistory[0].atMessage).toBe(2);
    });
});

describe('ledger time is conversational', () => {
    it('every appended roll is stamped atMessage, and the dossier’s DICE row says how long ago', () => {
        let state = { ...cleric(), messages: [line('user', 'I creep past the gate.', 0), line('assistant', 'A guard yawns.', 1)] };
        state = gameReducer(state, { type: 'ADD_ROLL', payload: { ...makeRoll(1), description: 'Stealth check past the gate', total: 19 } });
        expect(state.rollHistory[0].atMessage).toBe(2);
        for (let i = 2; i < 10; i++) {
            state = gameReducer(state, { type: 'ADD_MESSAGE', payload: line(i % 2 ? 'assistant' : 'user', `turn ${i}`, i) });
        }
        const dossier = buildRecallDossier(state, { subjects: [], queryTokens: ['stealth', 'gate'] });
        const dice = dossier.lines.find(l => l.startsWith('- DICE'));
        expect(dice).toMatch(/^- DICE \(\d+ turns ago\): Stealth check past the gate rolled 19\.$/);
    });

    it('a loaded atMessage clamps to the transcript; the working fields and a wall-clock stamp are dropped', () => {
        const loaded = gameReducer(initialGameState, {
            type: 'LOAD_GAME',
            payload: {
                messages: [line('user', 'a', 0), line('assistant', 'b', 1)],
                rollHistory: [
                    { ...makeRoll(1), atMessage: 9999, timestamp: 1234 },
                    { ...makeRoll(2), atMessage: 'soon' },
                ],
            },
        });
        expect(loaded.rollHistory[0].atMessage).toBe(2);
        expect(loaded.rollHistory[0]).not.toHaveProperty('timestamp');
        expect(loaded.rollHistory[0]).not.toHaveProperty('dice');
        expect(loaded.rollHistory[1]).not.toHaveProperty('atMessage');
    });

    it('an untyped id is minted per row, never one shared "[object Object]" key', () => {
        const loaded = gameReducer(initialGameState, {
            type: 'LOAD_GAME',
            payload: { messages: [], rollHistory: [{ ...makeRoll(1), id: { a: 1 } }, { ...makeRoll(2), id: { a: 1 } }, { ...makeRoll(3), id: 7 }] },
        });
        const ids = loaded.rollHistory.map(r => r.id);
        expect(new Set(ids).size).toBe(3);
        expect(ids.every(id => typeof id === 'string' && !id.includes('object'))).toBe(true);
        expect(ids[2]).toBe('7');
    });
});

describe('describeFaces', () => {
    it('signs the modifier once — a negative healing modifier never renders "(+-1)"', () => {
        expect(describeFaces({ rolls: [4, 2], modifier: 2 })).toBe('4, 2 (+2)');
        expect(describeFaces({ rolls: [3], modifier: -1 })).toBe('3 (-1)');
        expect(describeFaces({ rolls: [7], modifier: 0 })).toBe('7');
    });

    it('a WIS 8 cleric’s Cure Wounds line carries the signed modifier', () => {
        const dim = cleric({ abilityScores: { strength: 12, dexterity: 10, constitution: 14, intelligence: 10, wisdom: 8, charisma: 12 } });
        const next = gameReducer(dim, { type: 'CAST_SPELL', payload: { spell: 'cure wounds', target: 'self', _meta: { sourceId: 'msg-1' } } });
        const receipt = next.messages.at(-1).content;
        expect(receipt).not.toContain('+-');
        expect(receipt).toMatch(/Rolled: \d+ \(-1\)\./);
    });
});
