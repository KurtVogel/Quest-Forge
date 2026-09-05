import { describe, expect, it } from 'vitest';
import { gameReducer, initialGameState } from './gameReducer.js';

function makeState(overrides = {}) {
    return {
        ...initialGameState,
        character: {
            name: 'Astra',
            race: 'human',
            class: 'fighter',
            level: 4,
            currentHP: 20,
            maxHP: 28,
            armorClass: 11,
            abilityScores: {
                strength: 16,
                dexterity: 12,
                constitution: 15,
                intelligence: 10,
                wisdom: 10,
                charisma: 8,
            },
            conditions: [],
            abilityScoreImprovementsApplied: 0,
            pendingAbilityScoreImprovements: 1,
            ...overrides,
        },
        inventory: [],
        messages: [],
    };
}

describe('Ability Score Improvement', () => {
    it('applies exactly two points and updates CON-derived HP', () => {
        const next = gameReducer(makeState(), {
            type: 'APPLY_ABILITY_SCORE_IMPROVEMENT',
            payload: { increases: { strength: 1, constitution: 1 } },
        });

        expect(next.character.abilityScores.strength).toBe(17);
        expect(next.character.abilityScores.constitution).toBe(16);
        expect(next.character.maxHP).toBe(32); // CON mod +1 across 4 levels
        expect(next.character.currentHP).toBe(24);
        expect(next.character.abilityScoreImprovementsApplied).toBe(1);
        expect(next.character.pendingAbilityScoreImprovements).toBe(0);
        expect(next.messages.at(-1).content).toContain('Ability Score Improvement applied');
    });

    it('rejects invalid or over-cap improvements without spending the pending ASI', () => {
        const capped = makeState({
            abilityScores: {
                strength: 20,
                dexterity: 12,
                constitution: 15,
                intelligence: 10,
                wisdom: 10,
                charisma: 8,
            },
        });

        const next = gameReducer(capped, {
            type: 'APPLY_ABILITY_SCORE_IMPROVEMENT',
            payload: { increases: { strength: 1, constitution: 1 } },
        });

        expect(next.character.abilityScores.strength).toBe(20);
        expect(next.character.pendingAbilityScoreImprovements).toBe(1);
        expect(next.messages.at(-1).content).toContain('cannot be raised above 20');
    });
});

describe('ASI CON heal while the hero is down (2026-08-30 audit)', () => {
    it('grows maxHP alone while dying — no HP nudge into a not-dying-yet-not-conscious limbo', () => {
        const next = gameReducer(makeState({
            currentHP: 0,
            dying: true,
            deathSaves: { successes: 1, failures: 1 },
            conditions: ['unconscious'],
        }), {
            type: 'APPLY_ABILITY_SCORE_IMPROVEMENT',
            payload: { increases: { strength: 1, constitution: 1 } },
        });

        expect(next.character.maxHP).toBe(32);
        expect(next.character.currentHP).toBe(0);
        expect(next.character.dying).toBe(true);
        expect(next.character.conditions).toContain('unconscious');
    });

    it('never writes currentHP on a dead hero', () => {
        const next = gameReducer(makeState({ currentHP: 0, isDead: true }), {
            type: 'APPLY_ABILITY_SCORE_IMPROVEMENT',
            payload: { increases: { strength: 1, constitution: 1 } },
        });

        expect(next.character.maxHP).toBe(32);
        expect(next.character.currentHP).toBe(0);
        expect(next.character.isDead).toBe(true);
    });

    it('still raises currentHP alongside maxHP for a hero on their feet', () => {
        const next = gameReducer(makeState(), {
            type: 'APPLY_ABILITY_SCORE_IMPROVEMENT',
            payload: { increases: { constitution: 2 } },
        });

        expect(next.character.maxHP).toBe(32); // CON 15 → 17 is still a +1 mod step
        expect(next.character.currentHP).toBe(24);
    });
});
