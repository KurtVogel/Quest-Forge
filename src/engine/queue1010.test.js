/**
 * The 2026-10-10 strengthening sweep's engine pins (rules-math + enemy-stats
 * Lap-4 findings of 10-09): one AC ceiling shelf, one "worn armor" read, one
 * key per condition, the long rest reads the table, the fighting-style
 * numbers live in one table, one DC clamp, one typed enemy composer, and one
 * condition vocabulary derived from the table.
 */
import { describe, expect, it } from 'vitest';
import {
    CONDITION_EFFECTS,
    LONG_REST_CLEARS,
    computeACFromInventory,
    d20SuccessChance,
    describeArmorAc,
    describeCheckOdds,
    describeShieldAc,
    fightingStyleEffects,
    getEquippedWeapon,
    getSkillModifier,
    normalizeConditionName,
} from './rules.js';
import { MAGIC_BONUS_MAX, MAX_ARMOR_BASE_AC, MAX_SHIELD_AC, clampMagicBonus } from '../data/items.js';
import { CLASSES, FIGHTING_STYLE_EFFECTS } from '../data/classes.js';
import { isWornArmor, shouldAutoEquip } from './equipment.js';
import {
    HEALTH_WORDS,
    SUPPORTED_ENEMY_CONDITIONS,
    SUPPORTED_ENEMY_CONDITIONS_SENTENCE,
    healthWord,
    normalizeEnemyConditions,
    sanitizeLoadedEnemy,
    typeEnemyFields,
    validateEnemyAttackBonus,
    validateEnemySaveBonus,
} from './enemyStats.js';
import { validateCombatStart } from '../llm/eventChannels.js';

const hero = {
    name: 'Vesa', class: 'fighter', level: 3, fightingStyle: 'defense',
    abilityScores: { strength: 16, dexterity: 14, constitution: 14, intelligence: 10, wisdom: 10, charisma: 8 },
    skillProficiencies: ['athletics'], expertiseSkills: [], conditions: [],
};

describe('one AC ceiling shelf (rules-math P2, 2026-10-09)', () => {
    it('the engine reads clamp at the catalog ceilings — plate, the shield band, the magic cap', () => {
        expect(describeArmorAc({ baseAC: 99, armorType: 'heavy' })).toBe(MAX_ARMOR_BASE_AC);
        expect(describeShieldAc({ shieldAC: 99 })).toBe(MAX_SHIELD_AC);
        expect(describeArmorAc({ baseAC: 10, armorType: 'heavy', acBonus: 99 })).toBe(10 + MAGIC_BONUS_MAX);
        expect(describeShieldAc({ shieldAC: 2, magicBonus: 99 })).toBe(2 + MAGIC_BONUS_MAX);
        // The catalog's own clamp reads the same constant.
        expect(clampMagicBonus(99)).toBe(MAGIC_BONUS_MAX);
    });

    it('worn armor is ONE read: a row the AC counts is a row the slot takes, and a costume is neither', () => {
        const stringAc = { id: 'a', name: 'Odd mail', type: 'armor', armorType: 'medium', baseAC: '15', equipped: true };
        const costume = { id: 'b', name: 'Festival robe', type: 'armor', armorType: 'light', equipped: true };
        const real = { id: 'c', name: 'Chain shirt', type: 'armor', armorType: 'medium', baseAC: 13, equipped: true };
        const unarmored = computeACFromInventory([], hero);
        for (const row of [stringAc, costume]) {
            expect(isWornArmor(row)).toBe(false);
            expect(computeACFromInventory([row], hero)).toBe(unarmored);
            expect(shouldAutoEquip([], { ...row, equipped: false })).toBe(false);
        }
        expect(isWornArmor(real)).toBe(true);
        expect(computeACFromInventory([real], hero)).toBe(13 + 2 + 1); // medium: base + min(dex, 2) + Defense
        expect(shouldAutoEquip([], { ...real, equipped: false })).toBe(true);
    });

    it('getEquippedWeapon reads the kind shelf', () => {
        expect(getEquippedWeapon([{ type: 'weapon', equipped: true, name: 'Axe' }])?.name).toBe('Axe');
        expect(getEquippedWeapon([{ type: 'gear', equipped: true, name: 'Rope' }])).toBeNull();
    });
});

describe('one key per condition, and the long rest reads the table (rules-math P2, 2026-10-09)', () => {
    it('`exhaustion` folds to `exhausted` at the canonical form and the table has one key', () => {
        expect(normalizeConditionName('Exhaustion')).toBe('exhausted');
        expect(normalizeConditionName('exhausted')).toBe('exhausted');
        expect(Object.keys(CONDITION_EFFECTS)).not.toContain('exhaustion');
        expect(CONDITION_EFFECTS.exhausted).toEqual({ check: 'disadvantage' });
    });

    it('every table key the long rest clears exists, and the rest list carries the check-only affliction', () => {
        expect(LONG_REST_CLEARS).toContain('exhausted');
        const tableKeys = LONG_REST_CLEARS.filter(name => CONDITION_EFFECTS[name]);
        expect(tableKeys).toEqual(['exhausted', 'poisoned', 'blinded']);
        // `deafened` is prose-only by design (no table row) — stated, not accidental.
        expect(LONG_REST_CLEARS.filter(name => !CONDITION_EFFECTS[name])).toEqual(['deafened']);
    });
});

describe('the fighting-style numbers live in ONE table (rules-math nit, 2026-10-09)', () => {
    it('every style the class offers has an effects row, and only those', () => {
        expect(Object.keys(FIGHTING_STYLE_EFFECTS).sort()).toEqual(Object.keys(CLASSES.fighter.fightingStyles).sort());
    });

    it('fightingStyleEffects answers for a Fighter only', () => {
        expect(fightingStyleEffects({ class: 'fighter', fightingStyle: 'archery' })).toEqual({ attackBonus: 2 });
        expect(fightingStyleEffects({ class: 'rogue', fightingStyle: 'archery' })).toBeNull();
        expect(fightingStyleEffects({ class: 'fighter', fightingStyle: 'nope' })).toBeNull();
    });
});

describe('one DC clamp and a guarded skill read (rules-math nit, 2026-10-09)', () => {
    it('describeCheckOdds and d20SuccessChance agree on an out-of-band DC', () => {
        const odds = describeCheckOdds(hero, [], { type: 'skill_check', skill: 'athletics', dc: 99 });
        expect(odds.dc).toBe(30);
        expect(odds.flatChance).toBe(d20SuccessChance(odds.modifier, 99));
        const low = describeCheckOdds(hero, [], { type: 'skill_check', skill: 'athletics', dc: -4 });
        expect(low.dc).toBe(0);
        expect(low.flatChance).toBe(d20SuccessChance(low.modifier, -4));
    });

    it('getSkillModifier survives a sheet without ability scores', () => {
        expect(getSkillModifier({ level: 1 }, 'athletics')).toBe(0);
        expect(getSkillModifier({ level: 1, abilityScores: {} }, 'stealth')).toBe(0);
    });
});

describe('one typed enemy composer (enemy-stats P2, 2026-10-09)', () => {
    const hostile = { name: { x: 1 }, hp: 12, ac: 11, isUndead: 'false', conditions: 'prone', attack_bonus: '+4', damage: '1d8+2 slashing', save_bonus: '3' };

    it('typeEnemyFields types the name, the flag, the conditions, and the offensive stats from either key spelling', () => {
        expect(typeEnemyFields(hostile)).toEqual({
            name: 'Enemy', conditions: ['prone'], isUndead: false, boss: false,
            attackBonus: 4, damage: '1d8+2', saveBonus: 3,
        });
        expect(typeEnemyFields({ name: ' Ghoul ', is_undead: 'true', attackBonus: 5, saveBonus: '+1' }, { fallbackName: 'Enemy 3' }))
            .toEqual({ name: 'Ghoul', conditions: [], isUndead: true, boss: false, attackBonus: 5, saveBonus: 1 });
        expect(typeEnemyFields({}, { fallbackName: 'Enemy 2' }).name).toBe('Enemy 2');
    });

    it('the parser and the load twin agree on the typed fields', () => {
        const wire = validateCombatStart({ enemies: [{ ...hostile, name: 'Ogre' }] }).enemies[0];
        const loaded = sanitizeLoadedEnemy({ ...hostile, name: 'Ogre', id: 'enemy-ogre' });
        for (const key of ['name', 'conditions', 'isUndead', 'boss', 'attackBonus', 'damage', 'saveBonus']) {
            expect(loaded[key], key).toEqual(wire[key]);
        }
        expect(loaded).toMatchObject({ hp: 12, maxHp: 12, ac: 11, condition: 'healthy', combatStatus: 'active' });
        // A string flag is never true on the load lane either.
        expect(sanitizeLoadedEnemy({ name: 'Wisp', hp: 5, isUndead: 'false' }).isUndead).toBe(false);
    });

    it('two names, one body: the save bonus IS the attack-bonus validator', () => {
        expect(validateEnemySaveBonus).toBe(validateEnemyAttackBonus);
        expect(validateEnemySaveBonus('+4')).toBe(4);
        expect(validateEnemySaveBonus(99)).toBeUndefined();
    });

    it('the enemy down word is healthWord\'s default and the ladder words are the exported list', () => {
        expect(healthWord(0, 10)).toBe('dead');
        expect(healthWord(0, 10, 'downed')).toBe('downed');
        expect(HEALTH_WORDS).toEqual(['healthy', 'bloodied', 'critical']);
        expect(new Set([healthWord(10, 10), healthWord(5, 10), healthWord(2, 10)])).toEqual(new Set(HEALTH_WORDS));
    });
});

describe('one condition vocabulary (enemy-stats P2, 2026-10-09)', () => {
    it('the enemy set is derived from the table: every row that touches an attack, a save, or an incoming attack, and nothing else', () => {
        const expected = Object.entries(CONDITION_EFFECTS)
            .filter(([, effect]) => effect.attack || effect.save || effect.incomingAttack)
            .map(([name]) => name);
        expect([...SUPPORTED_ENEMY_CONDITIONS]).toEqual(expected);
        for (const name of SUPPORTED_ENEMY_CONDITIONS) expect(CONDITION_EFFECTS[name]).toBeTruthy();
        // The check-only affliction is absent by construction.
        expect(SUPPORTED_ENEMY_CONDITIONS.has('exhausted')).toBe(false);
        expect(normalizeEnemyConditions(['exhausted', 'Prone', 'cursed'])).toEqual(['prone']);
    });

    it('the prompt sentence is rendered from the set, byte-stable and in table order', () => {
        expect(SUPPORTED_ENEMY_CONDITIONS_SENTENCE).toBe(
            'Supported enemy conditions are poisoned, blinded, frightened, restrained, prone, invisible, stunned, paralyzed, and unconscious.',
        );
        for (const name of SUPPORTED_ENEMY_CONDITIONS) expect(SUPPORTED_ENEMY_CONDITIONS_SENTENCE).toContain(name);
    });
});
