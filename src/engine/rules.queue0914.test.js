/**
 * rules-math queue sweep 2026-09-14: read-site belts behind the load heal —
 * junk proficiency lists, a NaN level, a missing abilityScores object, and a
 * string/unkeyed sustained AC buff.
 */
import { describe, expect, it } from 'vitest';
import {
    computeACFromInventory,
    getAllSkills,
    getProficiencyBonus,
    getSavingThrowModifier,
    getSkillModifier,
    getWeaponAbilityModifier,
    normalizeProficiencyLists,
    MAX_SUSTAINED_AC_BONUS,
} from './rules.js';

const fighter = {
    class: 'fighter', level: 3,
    abilityScores: { strength: 16, dexterity: 12, constitution: 14, intelligence: 10, wisdom: 10, charisma: 8 },
    skillProficiencies: ['athletics'], expertiseSkills: [], savingThrowProficiencies: ['strength', 'constitution'],
};

describe('proficiency lists (P1 read-site belt)', () => {
    it('a number / string / object list never throws and never grants proficiency', () => {
        for (const junk of [42, 'stealth and perception', { stealth: true }, null, true]) {
            const hero = { ...fighter, skillProficiencies: junk, expertiseSkills: junk, savingThrowProficiencies: junk };
            expect(() => getAllSkills(hero)).not.toThrow();
            expect(getSkillModifier(hero, 'stealth')).toBe(1);
            expect(getSkillModifier(hero, 'perception')).toBe(0);
            expect(getSavingThrowModifier(hero, 'strength')).toBe(3);
            expect(getAllSkills(hero).every(s => !s.isProficient && !s.hasExpertise)).toBe(true);
        }
    });

    it('normalizeProficiencyLists keeps known keys deduped and drops the rest', () => {
        expect(normalizeProficiencyLists({
            skillProficiencies: ['stealth', 'stealth', 'flying', 7, 'perception'],
            expertiseSkills: ['stealth', 'perception', 'arcana'],
            savingThrowProficiencies: ['dexterity', 'luck'],
        })).toEqual({
            skillProficiencies: ['stealth', 'perception'],
            expertiseSkills: ['stealth', 'perception'],
            savingThrowProficiencies: ['dexterity'],
        });
        expect(normalizeProficiencyLists({ skillProficiencies: 'stealth' })).toEqual({
            skillProficiencies: [], expertiseSkills: [], savingThrowProficiencies: [],
        });
    });
});

describe('belts (P2)', () => {
    it('getProficiencyBonus(NaN / undefined) is +2, never the +6 every `<=` fell through to', () => {
        expect(getProficiencyBonus(NaN)).toBe(2);
        expect(getProficiencyBonus(undefined)).toBe(2);
        expect(getProficiencyBonus('7')).toBe(2);
        expect(getProficiencyBonus(17)).toBe(6);
    });

    it('getWeaponAbilityModifier survives a missing abilityScores object', () => {
        expect(() => getWeaponAbilityModifier({}, null)).not.toThrow();
        expect(getWeaponAbilityModifier({}, null)).toBe(0);
        expect(getWeaponAbilityModifier(null, { ranged: true })).toBe(0);
    });
});

describe('sustained AC buff at the read site (P1)', () => {
    it('a string acBonus is coerced and clamped — the AC is a NUMBER, never "115"', () => {
        const ac = computeACFromInventory([], { ...fighter, sustainedSpell: { key: 'mage_armor', acBonus: '5' } });
        expect(typeof ac).toBe('number');
        expect(ac).toBe(11 + MAX_SUSTAINED_AC_BONUS);
    });

    it('an unkeyed { acBonus: 9 } clamps to the catalog ceiling; junk reads as no buff', () => {
        expect(computeACFromInventory([], { ...fighter, sustainedSpell: { acBonus: 9 } })).toBe(11 + MAX_SUSTAINED_AC_BONUS);
        expect(computeACFromInventory([], { ...fighter, sustainedSpell: { acBonus: 'lots' } })).toBe(11);
        expect(computeACFromInventory([], { ...fighter, sustainedSpell: { acBonus: -4 } })).toBe(11);
    });
});
