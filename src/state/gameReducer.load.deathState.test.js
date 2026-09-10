/**
 * The hero's death state loads TYPED (2026-09-10 audit P1). Before the fix
 * `healLoadedCharacter` spread `dying`/`deathSaves`/`lowLevelDefeat`/`isDead`
 * raw and `DEATH_SAVE_RESULT` did `prev.failures + 1` on whatever loaded:
 * `failures: "1"` + a die of 5 → "11" >= 3 → isDead on the FIRST failed save
 * (the one irreversible outcome in the game); `failures: -1000` → five
 * natural 1s and the hero never dies; `dying: "false"` read truthy everywhere.
 */
import { describe, expect, it } from 'vitest';
import { gameReducer, initialGameState } from './gameReducer.js';
import { normalizeDeathSaves } from '../engine/rules.js';

const hero = (overrides = {}) => ({
    name: 'Vesa', race: 'human', class: 'fighter', level: 5, exp: 0, currentHP: 0, maxHP: 40, armorClass: 16,
    abilityScores: { strength: 16, dexterity: 12, constitution: 14, intelligence: 10, wisdom: 10, charisma: 8 },
    skillProficiencies: [], conditions: ['unconscious'],
    ...overrides,
});

const load = (character) => gameReducer(initialGameState, {
    type: 'LOAD_GAME',
    payload: { character, inventory: [], messages: [], party: [] },
});

describe('LOAD_GAME death-state typing', () => {
    it('integer-clamps string tallies 0..3 and boolean-coerces the flags', () => {
        const next = load(hero({ dying: 'true', isDead: 'false', lowLevelDefeat: 0, deathSaves: { successes: '2', failures: '1' } }));
        expect(next.character.deathSaves).toEqual({ successes: 2, failures: 1 });
        expect(next.character.dying).toBe(true);
        expect(next.character.isDead).toBe(false);
        expect(next.character.lowLevelDefeat).toBe(false);
    });

    it('a negative or absurd tally clamps into the band; junk becomes zero', () => {
        expect(load(hero({ dying: true, deathSaves: { successes: -1000, failures: 1e9 } })).character.deathSaves)
            .toEqual({ successes: 0, failures: 3 });
        expect(load(hero({ dying: true, deathSaves: 'two' })).character.deathSaves).toEqual({ successes: 0, failures: 0 });
        expect(load(hero({ dying: true, deathSaves: [1, 2] })).character.deathSaves).toEqual({ successes: 0, failures: 0 });
    });

    it('does not mint death keys a save never carried', () => {
        const next = load(hero({ currentHP: 20, conditions: [] }));
        expect('dying' in next.character).toBe(false);
        expect('isDead' in next.character).toBe(false);
        expect('deathSaves' in next.character).toBe(false);
    });
});

describe('DEATH_SAVE_RESULT reads a typed tally (belt behind the load heal)', () => {
    const dyingState = (deathSaves) => ({
        ...initialGameState,
        character: hero({ dying: true, isDead: false, deathSaves }),
        party: [],
        messages: [],
    });

    it('a string failure tally + one failed save is ONE failure, not death', () => {
        const next = gameReducer(dyingState({ successes: '2', failures: '1' }), { type: 'DEATH_SAVE_RESULT', payload: { die: 5 } });
        expect(next.character.isDead).toBe(false);
        expect(next.character.dying).toBe(true);
        expect(next.character.deathSaves).toEqual({ successes: 2, failures: 2 });
    });

    it('a string success tally + a 12 stabilizes at the third success', () => {
        const next = gameReducer(dyingState({ successes: '2', failures: '0' }), { type: 'DEATH_SAVE_RESULT', payload: { die: 12 } });
        expect(next.character.dying).toBe(false);
        expect(next.character.isDead).toBe(false);
    });

    it('a negative failure tally cannot make the hero unkillable', () => {
        let state = dyingState({ successes: 0, failures: -1000 });
        state = gameReducer(state, { type: 'DEATH_SAVE_RESULT', payload: { die: 1 } }); // two failures
        expect(state.character.isDead).toBe(false);
        state = gameReducer(state, { type: 'DEATH_SAVE_RESULT', payload: { die: 1 } }); // third+
        expect(state.character.isDead).toBe(true);
    });
});

describe('normalizeDeathSaves', () => {
    it('is the one canonical form: integers 0..3, junk → 0', () => {
        expect(normalizeDeathSaves(undefined)).toEqual({ successes: 0, failures: 0 });
        expect(normalizeDeathSaves({ successes: '3', failures: 2.9 })).toEqual({ successes: 3, failures: 2 });
        expect(normalizeDeathSaves({ successes: Infinity, failures: NaN })).toEqual({ successes: 0, failures: 0 });
    });
});
