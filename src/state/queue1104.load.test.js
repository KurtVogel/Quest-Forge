import { describe, expect, it } from 'vitest';
import { gameReducer, initialGameState } from './gameReducer.js';
import { resolvePlayerRollModifier } from '../engine/rules.js';

// 2026-11-04 strengthening (rules-math + the stamp family): a hostile or
// foreign save is input, and the load is never looser than the file importer.

const msgs = (n) => Array.from({ length: n }, (_, i) => ({ id: `m${i}`, role: i % 2 ? 'assistant' : 'user', content: `beat ${i}` }));
const load = (patch) => gameReducer(initialGameState, {
    type: 'LOAD_GAME',
    payload: {
        character: { ...initialGameState.character, name: 'Astra', class: 'fighter', level: 1, ...patch.character },
        inventory: [],
        messages: msgs(4),
        ...patch.rest,
    },
});

describe('ability scores load inside the vault band 1..30', () => {
    it('10,000,000 / 1e300 / "18abc" / -5 load as 30 / 30 / 10 / 1', () => {
        const state = load({ character: { abilityScores: { strength: 10_000_000, dexterity: 1e300, constitution: '18abc', intelligence: -5, wisdom: 31, charisma: 12 } } });
        expect(state.character.abilityScores).toMatchObject({ strength: 30, dexterity: 30, constitution: 10, intelligence: 1, wisdom: 30, charisma: 12 });
        expect(state.character.armorClass).toBeLessThan(40);
    });
});

describe('the bare-ability check reads a missing score as 10', () => {
    it('no strength key → modifier 0, never NaN', () => {
        const character = { ...initialGameState.character, abilityScores: { dexterity: 14 } };
        expect(resolvePlayerRollModifier(character, { skill: 'strength' }).modifier).toBe(0);
    });
});

describe('a ledger stamp past the transcript is clamped at load', () => {
    it('the transaction log: a future atMessage loads at the transcript end', () => {
        const state = load({ rest: { ledger: [{ kind: 'coin', cp: 500, status: 'applied', sourceId: 'msg-x', atMessage: 9999 }] } });
        expect(state.ledger).toHaveLength(1);
        expect(state.ledger[0].atMessage).toBe(3);
    });

    it('spell and rest ledgers: a future messageIndex is re-stamped to the transcript end; a sound one is kept', () => {
        const state = load({ rest: {
            recentSpellCasts: ['x|cureWounds@self|9999', 'y|bless@self|1', 7, 'legacy|shield@self'],
            recentRests: ['r|long|9999'],
        } });
        expect(state.recentSpellCasts).toEqual(['x|cureWounds@self|3', 'y|bless@self|1', 'legacy|shield@self']);
        expect(state.recentRests).toEqual(['r|long|3']);
    });
});
