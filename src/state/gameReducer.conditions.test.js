/**
 * Hero condition channel (ADD_CONDITION / REMOVE_CONDITION / load heal) — the
 * enemy channel's twin, hardened 2026-09-05 (audit P1): canonical lowercase
 * strings, case-insensitive add/remove, junk payloads are no-ops, a legacy
 * save's object element can no longer crash every heal path.
 */
import { describe, expect, it } from 'vitest';
import { gameReducer, initialGameState } from './gameReducer.js';

function makeState(conditions = []) {
    return {
        ...initialGameState,
        character: {
            name: 'Testo', race: 'human', class: 'fighter', level: 2,
            currentHP: 12, maxHP: 20, armorClass: 16,
            abilityScores: { strength: 16, dexterity: 12, constitution: 14, intelligence: 10, wisdom: 10, charisma: 8 },
            conditions,
            hitDice: { total: 2, remaining: 2, die: 10 },
            classResources: {},
        },
        inventory: [],
    };
}

describe('ADD_CONDITION / REMOVE_CONDITION', () => {
    it('stores the canonical lowercase form and dedupes casing variants', () => {
        let s = gameReducer(makeState(), { type: 'ADD_CONDITION', payload: ' Poisoned ' });
        s = gameReducer(s, { type: 'ADD_CONDITION', payload: 'POISONED' });
        s = gameReducer(s, { type: 'ADD_CONDITION', payload: 'poisoned' });
        expect(s.character.conditions).toEqual(['poisoned']);
    });

    it('removes a legacy-cased condition case-insensitively ("Poisoned" gained, "poisoned" removed)', () => {
        const s = gameReducer(makeState(['Poisoned', 'Prone']), { type: 'REMOVE_CONDITION', payload: 'poisoned' });
        expect(s.character.conditions).toEqual(['Prone']);
    });

    it('does not stack a canonical add onto a legacy-cased duplicate', () => {
        const s = gameReducer(makeState(['Poisoned']), { type: 'ADD_CONDITION', payload: 'poisoned' });
        expect(s.character.conditions).toEqual(['Poisoned']);
    });

    it('ignores junk payloads (object, number, empty) on both actions', () => {
        const base = makeState(['prone']);
        for (const payload of [{ name: 'blinded' }, 42, '', '   ', null, undefined]) {
            expect(gameReducer(base, { type: 'ADD_CONDITION', payload })).toBe(base);
            expect(gameReducer(base, { type: 'REMOVE_CONDITION', payload })).toBe(base);
        }
    });

    it('bounds the list at ten conditions and the name at forty characters', () => {
        let s = makeState();
        for (let i = 0; i < 14; i++) s = gameReducer(s, { type: 'ADD_CONDITION', payload: `cond-${i}` });
        expect(s.character.conditions).toHaveLength(10);
        const long = gameReducer(makeState(), { type: 'ADD_CONDITION', payload: 'x'.repeat(100) });
        expect(long.character.conditions[0]).toHaveLength(40);
    });
});

describe('LOAD_GAME heals character.conditions', () => {
    const load = (conditions) => gameReducer(initialGameState, {
        type: 'LOAD_GAME',
        payload: {
            character: { ...makeState().character, conditions },
            inventory: [],
            messages: [],
        },
    });

    it('drops non-string elements, lowercases, dedupes, and caps', () => {
        const next = load([' Poisoned ', 'poisoned', { name: 'blinded' }, 7, null, 'Prone']);
        expect(next.character.conditions).toEqual(['poisoned', 'prone']);
        expect(load('not-a-list').character.conditions).toEqual([]);
        expect(load(Array.from({ length: 20 }, (_, i) => `c${i}`)).character.conditions).toHaveLength(10);
    });

    it('a rest after loading a save with an object element no longer throws', () => {
        const next = load([{ name: 'blinded' }, 'Unconscious']);
        expect(() => gameReducer(next, { type: 'TAKE_REST', payload: 'long' })).not.toThrow();
    });
});

describe('LOAD_GAME sanitizes a stored exchange result', () => {
    it('drops junk top-level keys and clamps the shape (2026-09-05 test-depth item)', () => {
        const next = gameReducer(initialGameState, {
            type: 'LOAD_GAME',
            payload: {
                character: makeState().character,
                inventory: [],
                messages: [],
                combat: {
                    active: true,
                    phase: 'awaiting_narration',
                    enemies: [{ id: 'enemy-worg', name: 'Worg', hp: 9, maxHp: 32, ac: 14, condition: 'critical', conditions: [], combatStatus: 'active' }],
                    turnOrder: [{ type: 'player', name: 'Testo', initiative: 15 }],
                    currentTurn: 0,
                    round: 5,
                    lastExchangeResult: {
                        exchangeId: 'exchange-5',
                        kind: 'weird',
                        round: -3,
                        terminal: 'won',
                        summary: 'Worg remains alive.',
                        events: 'not-a-list',
                        hostile: { payload: 'x' },
                        __proto__polluter: true,
                    },
                },
            },
        });
        const stored = next.combat.lastExchangeResult;
        expect(Object.keys(stored).sort()).toEqual(['events', 'exchangeId', 'kind', 'round', 'summary', 'terminal']);
        expect(stored).toMatchObject({ exchangeId: 'exchange-5', kind: 'exchange', round: 1, terminal: null, events: [] });
    });
});
