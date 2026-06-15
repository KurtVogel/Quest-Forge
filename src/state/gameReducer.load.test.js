import { describe, expect, it } from 'vitest';
import { gameReducer, initialGameState } from './gameReducer.js';

const baseCharacter = {
    name: 'Survivor',
    race: 'human',
    class: 'fighter',
    level: 1,
    exp: 350,
    currentHP: 12,
    maxHP: 12,
    abilityScores: {
        strength: 16,
        dexterity: 12,
        constitution: 14,
        intelligence: 10,
        wisdom: 10,
        charisma: 8,
    },
    conditions: [],
};

describe('LOAD_GAME progression migrations', () => {
    it('applies pending level-ups for saves that crossed the new XP threshold', () => {
        const next = gameReducer(initialGameState, {
            type: 'LOAD_GAME',
            payload: {
                character: baseCharacter,
                inventory: [],
                messages: [],
            },
        });

        expect(next.character.level).toBe(2);
        expect(next.character.exp).toBe(50);
        expect(next.character.maxHP).toBeGreaterThan(12);
        expect(next.character.currentHP).toBe(next.character.maxHP);
        expect(next.character.hitDice).toEqual({ total: 2, remaining: 2, die: 10 });
        expect(next.messages.some(m => m.content.includes('Level Up'))).toBe(true);
    });
});
