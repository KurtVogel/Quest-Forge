/**
 * Tests for the pure rules math: modifiers, saving throws, condition effects,
 * skill modifiers, AC, and the Fighter level bonus.
 */
import { describe, it, expect } from 'vitest';
import {
    getModifier,
    getProficiencyBonus,
    getSavingThrowModifier,
    getConditionRollEffects,
    combineRollModifiers,
    getSkillModifier,
    getLevelBonus,
    getArmorClass,
    computeACFromInventory,
} from './rules.js';

const fighter = {
    class: 'fighter',
    level: 3,
    abilityScores: { strength: 16, dexterity: 12, constitution: 14, intelligence: 10, wisdom: 10, charisma: 8 },
    savingThrowProficiencies: ['strength', 'constitution'],
    skillProficiencies: ['athletics', 'intimidation'],
    expertiseSkills: [],
};

describe('getModifier', () => {
    it('follows the 5e table', () => {
        expect(getModifier(10)).toBe(0);
        expect(getModifier(16)).toBe(3);
        expect(getModifier(8)).toBe(-1);
        expect(getModifier(20)).toBe(5);
        expect(getModifier(3)).toBe(-4);
    });
});

describe('getSavingThrowModifier', () => {
    it('adds proficiency for class save proficiencies', () => {
        // STR 16 (+3) + prof (+2 at level 3)
        expect(getSavingThrowModifier(fighter, 'strength')).toBe(5);
        expect(getSavingThrowModifier(fighter, 'constitution')).toBe(4);
    });

    it('uses the plain ability modifier without proficiency', () => {
        expect(getSavingThrowModifier(fighter, 'dexterity')).toBe(1);
        expect(getSavingThrowModifier(fighter, 'charisma')).toBe(-1);
    });

    it('returns 0 for missing data instead of crashing', () => {
        expect(getSavingThrowModifier({}, 'strength')).toBe(0);
        expect(getSavingThrowModifier(null, 'strength')).toBe(0);
        expect(getSavingThrowModifier(fighter, 'nonsense')).toBe(0);
    });
});

describe('getConditionRollEffects', () => {
    it('poisoned imposes disadvantage on attacks and checks but not saves', () => {
        expect(getConditionRollEffects(['Poisoned'], 'attack').disadvantage).toBe(true);
        expect(getConditionRollEffects(['Poisoned'], 'check').disadvantage).toBe(true);
        expect(getConditionRollEffects(['Poisoned'], 'save').disadvantage).toBe(false);
    });

    it('prone/restrained/blinded give attackers advantage against the afflicted', () => {
        for (const cond of ['Prone', 'Restrained', 'Blinded']) {
            expect(getConditionRollEffects([cond], 'incomingAttack').advantage).toBe(true);
        }
    });

    it('invisible flips both ways', () => {
        expect(getConditionRollEffects(['Invisible'], 'attack').advantage).toBe(true);
        expect(getConditionRollEffects(['Invisible'], 'incomingAttack').disadvantage).toBe(true);
    });

    it('is case-insensitive and ignores unknown conditions', () => {
        expect(getConditionRollEffects(['pOiSoNeD'], 'attack').disadvantage).toBe(true);
        const none = getConditionRollEffects(['Inspired', 'Blessed'], 'attack');
        expect(none.advantage).toBe(false);
        expect(none.disadvantage).toBe(false);
        expect(none.sources).toEqual([]);
    });

    it('handles missing condition list', () => {
        expect(getConditionRollEffects(undefined, 'attack').disadvantage).toBe(false);
    });
});

describe('combineRollModifiers', () => {
    it('advantage and disadvantage cancel to a straight roll', () => {
        const combined = combineRollModifiers(true, false, { advantage: false, disadvantage: true, sources: ['Poisoned'] });
        expect(combined.advantage).toBe(false);
        expect(combined.disadvantage).toBe(false);
    });

    it('condition disadvantage applies when no explicit flags', () => {
        const combined = combineRollModifiers(false, false, { advantage: false, disadvantage: true, sources: ['Poisoned'] });
        expect(combined.disadvantage).toBe(true);
        expect(combined.note).toContain('poisoned');
    });

    it('passes explicit flags through when no conditions apply', () => {
        const none = { advantage: false, disadvantage: false, sources: [] };
        expect(combineRollModifiers(true, false, none)).toMatchObject({ advantage: true, disadvantage: false, note: '' });
        expect(combineRollModifiers(false, true, none)).toMatchObject({ advantage: false, disadvantage: true });
    });
});

describe('getSkillModifier', () => {
    it('adds proficiency for proficient skills', () => {
        // athletics: STR +3, prof +2
        expect(getSkillModifier(fighter, 'athletics')).toBe(5);
        // stealth: DEX +1, no prof
        expect(getSkillModifier(fighter, 'stealth')).toBe(1);
    });

    it('doubles proficiency for expertise', () => {
        const rogue = { ...fighter, class: 'rogue', expertiseSkills: ['stealth'], skillProficiencies: ['stealth'] };
        expect(getSkillModifier(rogue, 'stealth')).toBe(1 + 2 * getProficiencyBonus(rogue.level));
    });
});

describe('getLevelBonus', () => {
    it('is fighter-only and capped at +3', () => {
        expect(getLevelBonus({ class: 'fighter', level: 1 })).toBe(0);
        expect(getLevelBonus({ class: 'fighter', level: 3 })).toBe(2);
        expect(getLevelBonus({ class: 'fighter', level: 9 })).toBe(3);
        expect(getLevelBonus({ class: 'wizard', level: 9 })).toBe(0);
        expect(getLevelBonus(null)).toBe(0);
    });
});

describe('armor class', () => {
    it('computes unarmored, armored, and shielded AC', () => {
        expect(getArmorClass(2)).toBe(12); // 10 + DEX
        expect(getArmorClass(2, { armorType: 'heavy', baseAC: 16 })).toBe(16);
        expect(getArmorClass(3, { armorType: 'medium', baseAC: 14 })).toBe(16); // medium caps DEX at +2
        expect(getArmorClass(2, { armorType: 'light', baseAC: 12 }, true)).toBe(16); // 12 + 2 + shield 2
    });

    it('applies magic bonuses', () => {
        expect(getArmorClass(0, { armorType: 'heavy', baseAC: 16, magicBonus: 1 })).toBe(17);
        expect(getArmorClass(0, null, { shieldAC: 2, magicBonus: 2 })).toBe(14);
    });

    it('computes from inventory using equipped items only', () => {
        const inventory = [
            { type: 'armor', baseAC: 16, armorType: 'heavy', equipped: true },
            { type: 'shield', isShield: true, shieldAC: 2, equipped: true },
            { type: 'armor', baseAC: 12, armorType: 'light', equipped: false },
        ];
        expect(computeACFromInventory(inventory, fighter)).toBe(18);
    });
});
