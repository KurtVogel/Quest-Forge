import { describe, expect, it } from 'vitest';
import { awardExperience, getExperienceThreshold, isMaxLevel, MAX_CHARACTER_LEVEL } from './progression.js';

const character = {
    name: 'Veteran',
    race: 'human',
    class: 'fighter',
    level: 19,
    exp: 0,
    maxHP: 120,
    currentHP: 120,
    abilityScores: {
        strength: 16,
        dexterity: 12,
        constitution: 14,
        intelligence: 10,
        wisdom: 10,
        charisma: 8,
    },
    features: [],
    classResources: {},
    hitDice: { total: 19, remaining: 19, die: 10 },
};

describe('D&D 5e XP progression', () => {
    it('uses D&D 5e per-level XP increments', () => {
        expect(getExperienceThreshold(1)).toBe(300);
        expect(getExperienceThreshold(2)).toBe(600);
        expect(getExperienceThreshold(3)).toBe(1800);
        expect(getExperienceThreshold(19)).toBe(50000);
    });

    it('caps advancement at level 20 and carries excess XP', () => {
        const result = awardExperience(character, 60000);

        expect(result.character.level).toBe(MAX_CHARACTER_LEVEL);
        expect(result.character.exp).toBe(10000);
        expect(result.messages.filter(m => m.content.includes('Level Up'))).toHaveLength(1);
    });

    it('uses fixed average HP plus CON on level-up', () => {
        const result = awardExperience({
            ...character,
            level: 1,
            exp: 0,
            maxHP: 12,
            currentHP: 3,
            hitDice: { total: 1, remaining: 1, die: 10 },
        }, 300);

        expect(result.character.level).toBe(2);
        expect(result.character.maxHP).toBe(20);
        expect(result.character.currentHP).toBe(20);
        expect(result.messages.some(m => m.content.includes('Average HP **6** from d10 + 2 CON = **+8 HP**'))).toBe(true);
    });

    it('does not let milestone level-ups exceed level 20', () => {
        const result = awardExperience({ ...character, level: 20, exp: 0 }, 0, {
            milestoneLevelUp: true,
        });

        expect(result.character.level).toBe(20);
        expect(result.messages.some(m => m.content.includes('Level Up'))).toBe(false);
        expect(isMaxLevel(result.character.level)).toBe(true);
    });
});
