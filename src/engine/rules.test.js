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
    getIncapacitatingCondition,
    combineRollModifiers,
    getSkillModifier,
    getLevelBonus,
    getArmorClass,
    computeACFromInventory,
    getMaxHitPoints,
    getWeaponAttackBonus,
    getWeaponDamageNotation,
    getSneakAttackDice,
    isProficientWithWeapon,
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

    it('applies Defense fighting style only while armor is equipped', () => {
        const armored = [{ type: 'armor', baseAC: 16, armorType: 'heavy', equipped: true }];
        const unarmored = [{ type: 'armor', baseAC: 16, armorType: 'heavy', equipped: false }];
        expect(computeACFromInventory(armored, { ...fighter, fightingStyle: 'defense' })).toBe(17);
        expect(computeACFromInventory(unarmored, { ...fighter, fightingStyle: 'defense' })).toBe(11);
    });
});

describe('fighter fighting styles', () => {
    it('applies Archery to ranged weapon attacks', () => {
        const bow = [{ type: 'weapon', category: 'martialRanged', damage: '1d8', ranged: true, equipped: true }];
        const sword = [{ type: 'weapon', category: 'martialMelee', damage: '1d8', equipped: true }];
        const dexFighter = { ...fighter, fightingStyle: 'archery', abilityScores: { ...fighter.abilityScores, strength: 10, dexterity: 16 } };
        expect(getWeaponAttackBonus(dexFighter, bow)).toBe(9); // DEX + prof + level bonus + style
        expect(getWeaponAttackBonus(dexFighter, sword)).toBe(4); // no Archery bonus
    });

    it('applies Dueling to one-handed melee damage only', () => {
        const sword = [{ type: 'weapon', category: 'martialMelee', damage: '1d8', equipped: true }];
        const bow = [{ type: 'weapon', category: 'martialRanged', damage: '1d8', ranged: true, equipped: true }];
        const greatsword = [{ type: 'weapon', category: 'martialMelee', damage: '2d6', twoHanded: true, equipped: true }];
        expect(getWeaponDamageNotation({ ...fighter, fightingStyle: 'dueling' }, sword)).toBe('1d8+5');
        expect(getWeaponDamageNotation({ ...fighter, fightingStyle: 'dueling' }, bow)).toBe('1d8+1');
        expect(getWeaponDamageNotation({ ...fighter, fightingStyle: 'dueling' }, greatsword)).toBe('2d6+3');
    });
});

describe('getSneakAttackDice', () => {
    const rogueL1 = { class: 'rogue', level: 1 };
    const rogueL3 = { class: 'rogue', level: 3 };
    const rogueL5 = { class: 'rogue', level: 5 };
    const nonRogue = { class: 'cleric', level: 5 };

    const finesseWeapon = { finesse: true };
    const rangedWeapon = { ranged: true };
    const normalWeapon = { name: 'Longsword' };

    it('returns 0 if character is not a rogue', () => {
        expect(getSneakAttackDice(nonRogue, finesseWeapon, true, false, false)).toBe(0);
        expect(getSneakAttackDice(null, finesseWeapon, true, false, false)).toBe(0);
    });

    it('returns 0 if weapon is not finesse or ranged', () => {
        expect(getSneakAttackDice(rogueL1, normalWeapon, true, false, false)).toBe(0);
        expect(getSneakAttackDice(rogueL1, null, true, false, false)).toBe(0);
    });

    it('returns 0 if disadvantage is active', () => {
        expect(getSneakAttackDice(rogueL1, finesseWeapon, true, true, true)).toBe(0);
    });

    it('returns correct dice if advantage is active', () => {
        expect(getSneakAttackDice(rogueL1, finesseWeapon, true, false, false)).toBe(1);
        expect(getSneakAttackDice(rogueL3, finesseWeapon, true, false, false)).toBe(2);
        expect(getSneakAttackDice(rogueL5, finesseWeapon, true, false, false)).toBe(3);
    });

    it('returns correct dice if companion (hasAlly) is active and no disadvantage', () => {
        expect(getSneakAttackDice(rogueL1, rangedWeapon, false, false, true)).toBe(1);
        expect(getSneakAttackDice(rogueL3, rangedWeapon, false, false, true)).toBe(2);
        expect(getSneakAttackDice(rogueL5, rangedWeapon, false, false, true)).toBe(3);
    });

    it('returns 0 if neither advantage nor companion is active', () => {
        expect(getSneakAttackDice(rogueL1, finesseWeapon, false, false, false)).toBe(0);
    });
});

describe('isProficientWithWeapon', () => {
    const wizard = {
        class: 'wizard',
        level: 1,
        abilityScores: { strength: 8, dexterity: 14, constitution: 12, intelligence: 16, wisdom: 10, charisma: 10 },
        skillProficiencies: [],
    };

    it('matches broad category proficiency (fighter: simple + martial)', () => {
        expect(isProficientWithWeapon(fighter, { name: 'Greatsword', category: 'martialMelee' })).toBe(true);
        expect(isProficientWithWeapon(fighter, { name: 'Club', category: 'simpleMelee' })).toBe(true);
    });

    it('matches specific pluralized weapon names singular or plural', () => {
        expect(isProficientWithWeapon(wizard, { name: 'Dagger', category: 'simpleMelee' })).toBe(true);
        expect(isProficientWithWeapon(wizard, { name: 'Light Crossbow', category: 'simpleRanged' })).toBe(true);
        expect(isProficientWithWeapon({ class: 'rogue' }, { name: 'Rapier', category: 'martialMelee' })).toBe(true);
    });

    it('ignores magic-bonus suffixes when matching names', () => {
        expect(isProficientWithWeapon(wizard, { name: 'Dagger +2', category: 'simpleMelee' })).toBe(true);
    });

    it('denies categorized weapons outside the class list', () => {
        expect(isProficientWithWeapon(wizard, { name: 'Longsword', category: 'martialMelee' })).toBe(false);
        expect(isProficientWithWeapon(wizard, { name: 'Mace', category: 'simpleMelee' })).toBe(false);
        expect(isProficientWithWeapon({ class: 'cleric' }, { name: 'Longbow', category: 'martialRanged' })).toBe(false);
    });

    it('gives unarmed and uncategorized story weapons the benefit of the doubt', () => {
        expect(isProficientWithWeapon(wizard, null)).toBe(true);
        expect(isProficientWithWeapon(wizard, { name: 'Shard of the Broken Bell' })).toBe(true);
    });

    it('subtracts proficiency from the attack bonus end-to-end', () => {
        // Wizard with an equipped longsword: STR -1, NO proficiency bonus.
        const longsword = [{ name: 'Longsword', type: 'weapon', category: 'martialMelee', damage: '1d8', equipped: true }];
        expect(getWeaponAttackBonus(wizard, longsword)).toBe(-1);
        // Same wizard with a dagger: finesse takes DEX +2, proficiency +2 applies.
        const dagger = [{ name: 'Dagger', type: 'weapon', category: 'simpleMelee', damage: '1d4', finesse: true, equipped: true }];
        expect(getWeaponAttackBonus(wizard, dagger)).toBe(4);
    });
});

describe('getProficiencyBonus level boundaries', () => {
    it('steps exactly at 5, 9, 13, and 17, capping at +6', () => {
        expect(getProficiencyBonus(1)).toBe(2);
        expect(getProficiencyBonus(4)).toBe(2);
        expect(getProficiencyBonus(5)).toBe(3);
        expect(getProficiencyBonus(8)).toBe(3);
        expect(getProficiencyBonus(9)).toBe(4);
        expect(getProficiencyBonus(12)).toBe(4);
        expect(getProficiencyBonus(13)).toBe(5);
        expect(getProficiencyBonus(16)).toBe(5);
        expect(getProficiencyBonus(17)).toBe(6);
        expect(getProficiencyBonus(20)).toBe(6);
    });
});

describe('getMaxHitPoints', () => {
    it('computes level-1 and multi-level HP for ordinary scores', () => {
        expect(getMaxHitPoints('fighter', 1, 2, { hitDie: 10 })).toBe(12);
        expect(getMaxHitPoints('fighter', 4, 2, { hitDie: 10 })).toBe(36); // 12 + 3×8
    });

    it('floors each level at 1 HP so very low CON never shrinks the pool', () => {
        // CON mod -5 with a d6 hit die: without the floor this would be negative.
        expect(getMaxHitPoints('wizard', 5, -5, { hitDie: 6 })).toBe(5);
        expect(getMaxHitPoints('wizard', 1, -5, { hitDie: 6 })).toBe(1);
    });

    it('falls back gracefully without class data', () => {
        expect(getMaxHitPoints('fighter', 1, 3, null)).toBe(13);
    });
});

describe('getIncapacitatingCondition', () => {
    it('detects the three incapacitating conditions case- and whitespace-insensitively', () => {
        expect(getIncapacitatingCondition(['Stunned '])).toBe('stunned');
        expect(getIncapacitatingCondition(['prone', 'PARALYZED'])).toBe('paralyzed');
        expect(getIncapacitatingCondition(['unconscious'])).toBe('unconscious');
    });

    it('returns null for act-capable creatures', () => {
        expect(getIncapacitatingCondition(['poisoned', 'prone'])).toBe(null);
        expect(getIncapacitatingCondition([])).toBe(null);
        expect(getIncapacitatingCondition(null)).toBe(null);
    });
});
