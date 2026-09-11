/**
 * The combat envelope loads TYPED (2026-09-11 combat-exchange audit, Lap 2
 * hostile input): a null turn-order entry used to throw out of every prompt
 * build, out of the exchange commit and the reject inside the reducer, and out
 * of planOpeningExchange — whose belt dispatched a REJECT the OPENING phase
 * guard ignored: a deadlocked campaign. A null stored event/companion threw
 * out of the narration prompt build with no way out of AWAITING_NARRATION;
 * `round: "3"` string-concatenated; `active: "false"` was a live fight;
 * `xpAwarded: "no"` paid 0 XP for slain foes; duplicate enemy ids died together.
 */
import { describe, expect, it } from 'vitest';
import { gameReducer, initialGameState } from './gameReducer.js';
import { buildSystemPrompt } from '../llm/promptBuilder.js';
import { combatNarrationPrompt, planOpeningExchange } from '../engine/combatExchange.js';

const baseCharacter = {
    name: 'Survivor', race: 'human', class: 'fighter', level: 3, exp: 900, currentHP: 20, maxHP: 20, conditions: [],
    abilityScores: { strength: 16, dexterity: 12, constitution: 14, intelligence: 10, wisdom: 10, charisma: 8 },
};

const load = (combat, extra = {}) => gameReducer(initialGameState, {
    type: 'LOAD_GAME',
    payload: { character: { ...baseCharacter }, inventory: [], messages: [], combat, ...extra },
});

const promptOf = (state) => buildSystemPrompt({
    ...state,
    preset: 'classicFantasy',
    ruleset: 'simplified5e',
    customSystemPrompt: '',
    retrievedMemories: [],
});

const worg = { id: 'enemy-worg', name: 'Cave-Worg', hp: 9, maxHp: 32, ac: 14, condition: 'critical', conditions: [], combatStatus: 'active', initiative: 18 };

describe('LOAD_GAME turn order typing (2026-09-11 combat-exchange P1)', () => {
    const hostileTurnOrder = [
        null,
        'string-entry',
        { type: 'enemy', id: 'enemy-worg', name: 'Cave-Worg', initiative: 18 },
        { type: 'ghost', name: 'Nobody', initiative: 30 },
        { type: 'player', name: { first: 'Survivor' }, initiative: '15' },
        { type: 'companion', id: { x: 1 }, name: '', initiative: NaN },
        { type: 'enemy', id: 'enemy-rat', initiative: 2 },
    ];

    it('drops null/string/unknown-type entries and types the survivors', () => {
        const next = load({ active: true, phase: 'awaiting_player', enemies: [worg], turnOrder: hostileTurnOrder, currentTurn: 0, round: 2 });
        expect(next.combat.turnOrder).toEqual([
            { type: 'enemy', id: 'enemy-worg', name: 'Cave-Worg', initiative: 18 },
            { type: 'player', name: 'Player', initiative: 15 },
            { type: 'enemy', id: 'enemy-rat', name: 'enemy-rat', initiative: 2 },
        ]);
        expect(next.combat.currentTurn).toBe(1); // awaiting_player snaps to the player's slot
    });

    it('builds the system prompt, the exchange reject, and the opening plan without throwing', () => {
        const next = load({ active: true, phase: 'opening', enemies: [worg], turnOrder: hostileTurnOrder, openingActorIds: ['enemy-worg', null, 42], currentTurn: 0, round: 1 });
        expect(() => promptOf(next)).not.toThrow();
        expect(promptOf(next)).toContain('Cave-Worg (init: 18)');
        expect(promptOf(next)).not.toContain('[object Object]');
        expect(next.combat.openingActorIds).toEqual(['enemy-worg']);
        expect(() => planOpeningExchange(next)).not.toThrow();
        // The reject path used to throw inside the reducer on the same hole.
        const awaiting = { ...next, combat: { ...next.combat, phase: 'awaiting_player' } };
        expect(() => gameReducer(awaiting, { type: 'REJECT_COMBAT_EXCHANGE', payload: { reason: 'x' } })).not.toThrow();
    });
});

describe('LOAD_GAME stored exchange result typing (2026-09-11 combat-exchange P1)', () => {
    const hostileResult = {
        exchangeId: 'exchange-5',
        kind: 'exchange',
        round: 5,
        terminal: null,
        summary: 'legacy',
        events: [
            null,
            'not an event',
            { type: 'attack', actor: { name: 'X' }, target: 'Cave-Worg', rolled: 'nope', dc: 14, hit: 'true', damage: 'xxxxx', remainingHp: 3, maxHp: 32 },
            { type: 'explode', text: 'unknown type' },
            { type: 'note', text: 'A'.repeat(20000) },
            { type: 'note', text: { evil: true } },
            { type: 'death_save', natural: 20 },
        ],
        postState: {
            player: { name: { first: 'Survivor' }, hp: '12', maxHp: 'nope' },
            enemies: [null, { name: 'Cave-Worg', hp: 3, maxHp: 32, status: 'weird', conditions: [] }],
            companions: [null, 7, { id: 'c1', name: { x: 1 }, hp: 'x', maxHp: 10, status: 'healthy' }],
        },
    };

    it('drops null/unknown events, types the fields, clamps note text, and types the post-state', () => {
        const next = load({ active: true, phase: 'awaiting_narration', enemies: [worg], turnOrder: [{ type: 'player', name: 'Survivor', initiative: 15 }], round: 5, lastExchangeResult: hostileResult });
        const result = next.combat.lastExchangeResult;
        expect(result.events.map(e => e.type)).toEqual(['attack', 'note', 'death_save']);
        expect(result.events[0]).toEqual({ type: 'attack', actor: 'An attacker', target: 'Cave-Worg', dc: 14, hit: true, damage: 0, remainingHp: 3, maxHp: 32 });
        expect(result.events[1].text).toHaveLength(1200);
        expect(result.postState.player).toEqual({ name: 'Player', hp: 12, maxHp: 1 });
        expect(result.postState.enemies).toEqual([{ name: 'Cave-Worg', hp: 3, maxHp: 32, conditions: [], status: 'active' }]);
        expect(result.postState.companions).toEqual([{ id: 'c1', name: 'Companion', hp: 0, maxHp: 10, status: 'healthy' }]);
    });

    it('the narration prompt builds from the healed result with no "[object Object]" and a bounded size', () => {
        const next = load({ active: true, phase: 'awaiting_narration', enemies: [worg], turnOrder: [{ type: 'player', name: 'Survivor', initiative: 15 }], round: 5, lastExchangeResult: hostileResult });
        let prompt;
        expect(() => { prompt = combatNarrationPrompt(next.combat.lastExchangeResult); }).not.toThrow();
        expect(prompt).not.toContain('[object Object]');
        expect(prompt).not.toContain('undefined');
        expect(prompt.length).toBeLessThan(5000);
        expect(next.combat.phase).toBe('awaiting_narration');
    });

    it('caps 100 stored notes of 20k characters to a bounded narration prompt (Lap 3 hiding in Lap 2)', () => {
        const events = Array.from({ length: 150 }, () => ({ type: 'note', text: 'n'.repeat(20000) }));
        const next = load({ active: true, phase: 'awaiting_narration', enemies: [worg], turnOrder: [], round: 1, lastExchangeResult: { ...hostileResult, events } });
        expect(next.combat.lastExchangeResult.events).toHaveLength(100);
        expect(combatNarrationPrompt(next.combat.lastExchangeResult).length).toBeLessThan(130000);
    });
});

describe('LOAD_GAME combat envelope flags and round (2026-09-11 combat-exchange P2)', () => {
    it('integer-clamps round so COMPLETE_COMBAT_NARRATION adds 1 instead of concatenating', () => {
        const next = load({
            active: true, phase: 'awaiting_narration', enemies: [worg], turnOrder: [{ type: 'player', name: 'Survivor', initiative: 15 }],
            round: '3', lastExchangeResult: { exchangeId: 'x-1', kind: 'exchange', round: 3, terminal: null, events: [{ type: 'note', text: 'A blow lands.' }] },
        });
        expect(next.combat.round).toBe(3);
        const completed = gameReducer(next, { type: 'COMPLETE_COMBAT_NARRATION', payload: { exchangeId: 'x-1' } });
        expect(completed.combat.round).toBe(4);
    });

    it('"false" active loads as no fight and junk round/flags fall back', () => {
        const next = load({ active: 'false', phase: 'awaiting_player', enemies: [], turnOrder: [], round: { r: 1 }, xpAwarded: 'no', bonusActionUsed: 'no' });
        expect(next.combat.active).toBe(false);
        expect(next.combat.phase).toBeNull();
        expect(next.combat.round).toBe(1);
        expect(next.combat.xpAwarded).toBe(false);
        expect(next.combat.bonusActionUsed).toBe(false);
        expect(promptOf(next)).not.toContain('## ACTIVE COMBAT');
    });

    it('"no" xpAwarded reads false so END_COMBAT still pays for slain foes', () => {
        const next = load({ active: true, phase: 'awaiting_player', enemies: [{ ...worg, hp: 0, condition: 'dead' }], turnOrder: [{ type: 'player', name: 'Survivor', initiative: 15 }], round: 2, xpAwarded: 'no' });
        const ended = gameReducer(next, { type: 'END_COMBAT', payload: { autoVictory: true } });
        expect(ended.character.exp).toBeGreaterThan(900);
    });

    it('"no" bonusActionUsed reads false so the bonus-action lane is free', () => {
        const next = load({ active: true, phase: 'awaiting_player', enemies: [worg], turnOrder: [], round: 1, bonusActionUsed: 'no' });
        expect(next.combat.bonusActionUsed).toBe(false);
    });

    it('projects the envelope to known keys — unknown keys never re-persist', () => {
        const next = load({ active: true, phase: 'awaiting_player', enemies: [worg], turnOrder: [], round: 1, hostilePayload: 'x'.repeat(50), startedAtMessage: 4 });
        expect(next.combat.hostilePayload).toBeUndefined();
        expect(next.combat.startedAtMessage).toBe(4);
        expect(new Set(Object.keys(next.combat))).toEqual(new Set([...Object.keys(initialGameState.combat), 'startedAtMessage']));
    });
});

describe('LOAD_GAME enemy id uniqueness (2026-09-11 combat-exchange P2, parity with START_COMBAT)', () => {
    it('keeps a valid unique id verbatim and re-mints only absent/duplicate ids', () => {
        const next = load({
            active: true, phase: 'awaiting_player', turnOrder: [], round: 1,
            enemies: [
                { ...worg, id: 'enemy-goblin', name: 'Goblin' },
                { ...worg, id: 'enemy-goblin', name: 'Goblin' },
                { ...worg, id: undefined, name: 'Wolf' },
            ],
        });
        const ids = next.combat.enemies.map(e => e.id);
        expect(ids[0]).toBe('enemy-goblin');
        expect(ids[1]).toBe('enemy-goblin-2');
        expect(ids[2]).toBe('enemy-wolf');
        expect(new Set(ids).size).toBe(3);
        // One UPDATE_ENEMY now kills exactly one goblin.
        const updated = gameReducer(next, { type: 'UPDATE_ENEMY', payload: { id: 'enemy-goblin', hp: 0 } });
        expect(updated.combat.enemies.map(e => e.hp)).toEqual([0, 9, 9]);
        expect(promptOf(next)).not.toContain('(id: undefined)');
    });
});
