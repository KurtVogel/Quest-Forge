/**
 * The 2026-10-21 rules-math queue: THE grip (a versatile weapon in two hands
 * rolls its versatile die and earns the Great Weapon Fighting reroll; a shield
 * or Dueling keeps the one-handed die — DECISIONS.md 2026-10-21), the crit
 * rule beside the ladder so the odds card and the die agree for a Champion's
 * 19, the four belts, and the proficiency matrix over the whole catalog.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
    computeACFromInventory,
    criticalThreshold,
    d20SuccessChance,
    describeCheckOdds,
    getMaxHitPoints,
    getSkillModifier,
    getWeaponDamageNotation,
    isCriticalNatural,
    isProficientWithWeapon,
    isWieldedTwoHanded,
    perLevelHpGain,
} from './rules.js';
import { isCriticalNatural as kernelCrit, rollDamage } from './combatMath.js';
import { ITEM_CATALOG, normalizeItem } from '../data/items.js';
import { CLASSES } from '../data/classes.js';

const { rollQueue } = vi.hoisted(() => ({ rollQueue: [] }));
vi.mock('./dice.ts', async (importOriginal) => {
    const actual = await importOriginal();
    const draw = () => {
        if (!rollQueue.length) throw new Error('dice queue exhausted');
        return rollQueue.shift();
    };
    return {
        ...actual,
        rollWithModifier: (count, sides, modifier = 0, description = '') => {
            const rolls = Array.from({ length: count }, draw);
            const subtotal = rolls.reduce((a, b) => a + b, 0);
            return { id: `r${Math.random()}`, notation: `${count}d${sides}`, dice: { count, sides }, rolls, subtotal, modifier, total: subtotal + modifier, description, isCritical: false, isCritFail: false };
        },
    };
});

const SCORES = { strength: 16, dexterity: 12, constitution: 14, intelligence: 10, wisdom: 10, charisma: 8 };
const fighter = (fightingStyle, extra = {}) => ({ name: 'Veteran', class: 'fighter', level: 5, fightingStyle, abilityScores: SCORES, conditions: [], ...extra });
const row = (key, extra = {}) => ({ ...normalizeItem({ itemKey: key }), id: key, equipped: true, ...extra });

beforeEach(() => { rollQueue.length = 0; });

describe('THE grip — a versatile weapon in two hands (2026-10-21 P2)', () => {
    it('a GWF fighter with a longsword and no shield swings the versatile 1d10 and rerolls a 1', () => {
        const inventory = [row('longsword')];
        expect(isWieldedTwoHanded(fighter('greatWeaponFighting'), inventory[0], inventory)).toBe(true);
        expect(getWeaponDamageNotation(fighter('greatWeaponFighting'), inventory)).toBe('1d10+3');
        rollQueue.push(1, 7);
        const { rerolls, total } = rollDamage('1d10+3', 'dmg', { character: fighter('greatWeaponFighting'), inventory });
        expect(rerolls).toEqual(['1→7']);
        expect(total).toBe(10);
    });

    it('a shield puts the longsword back in one hand: 1d8, no reroll', () => {
        const inventory = [row('longsword'), row('shield')];
        expect(isWieldedTwoHanded(fighter('greatWeaponFighting'), inventory[0], inventory)).toBe(false);
        expect(getWeaponDamageNotation(fighter('greatWeaponFighting'), inventory)).toBe('1d8+3');
        rollQueue.push(1);
        expect(rollDamage('1d8+3', 'dmg', { character: fighter('greatWeaponFighting'), inventory }).rerolls).toEqual([]);
    });

    it('a Dueling fighter fights one-handed by definition: 1d8 and the +2, even with a free off-hand', () => {
        const inventory = [row('longsword')];
        expect(isWieldedTwoHanded(fighter('dueling'), inventory[0], inventory)).toBe(false);
        expect(getWeaponDamageNotation(fighter('dueling'), inventory)).toBe('1d8+5');
    });

    it('a non-fighter with a free off-hand takes the versatile die too; a greatsword stays two-handed; a dagger never is', () => {
        const rogue = { class: 'rogue', level: 3, abilityScores: SCORES };
        expect(getWeaponDamageNotation(rogue, [row('longsword')])).toBe('1d10+3');
        expect(getWeaponDamageNotation(rogue, [row('longsword'), row('shield')])).toBe('1d8+3');
        expect(isWieldedTwoHanded(rogue, row('greatsword'), [row('greatsword')])).toBe(true);
        expect(isWieldedTwoHanded(rogue, row('dagger'), [row('dagger')])).toBe(false);
        expect(isWieldedTwoHanded(rogue, row('longbow'), [row('longbow')])).toBe(false);
    });

    it('junk in damageVersatile falls back to the one-handed die, never to fists', () => {
        const inventory = [{ id: 'w', type: 'weapon', name: 'Oddblade', damage: '1d8', damageVersatile: 'big', versatile: true, equipped: true }];
        expect(getWeaponDamageNotation(fighter('greatWeaponFighting'), inventory)).toBe('1d8+3');
    });

    it('every catalog versatile weapon carries a readable versatile die', () => {
        const versatile = Object.values(ITEM_CATALOG).filter(item => item.versatile);
        expect(versatile.map(i => i.name).sort()).toEqual(['Battleaxe', 'Longsword', 'Quarterstaff', 'Spear', 'Trident', 'Warhammer']);
        for (const item of versatile) expect(item.damageVersatile).toMatch(/^\dd\d+$/);
    });
});

describe('the crit rule beside the ladder (2026-10-21 P2)', () => {
    const champion = { class: 'fighter', level: 3, martialArchetype: 'champion', abilityScores: SCORES, conditions: [] };
    const plain = { class: 'fighter', level: 3, abilityScores: SCORES, conditions: [] };

    it('criticalThreshold is 19 for a Champion of level 3+, 20 otherwise, and the kernel re-exports the same predicate', () => {
        expect(criticalThreshold(champion)).toBe(19);
        expect(criticalThreshold({ ...champion, level: 2 })).toBe(20);
        expect(criticalThreshold(plain)).toBe(20);
        expect(criticalThreshold(null)).toBe(20);
        expect(isCriticalNatural(champion, 19)).toBe(true);
        expect(isCriticalNatural(plain, 19)).toBe(false);
        expect(isCriticalNatural(plain, 20)).toBe(true);
        expect(isCriticalNatural(champion, NaN)).toBe(false);
        expect(kernelCrit).toBe(isCriticalNatural);
    });

    it('the odds card reads the Champion\'s 19 on an attack: +5 vs DC 25 is 10 %, not 5 %', () => {
        const inventory = [row('longsword')];
        const roll = { type: 'attack_roll', skill: 'attack', dc: 25 };
        const championOdds = describeCheckOdds(champion, inventory, roll);
        const plainOdds = describeCheckOdds(plain, inventory, roll);
        expect(championOdds.modifier).toBe(5);
        expect(championOdds.chance).toBeCloseTo(0.10, 10);
        expect(plainOdds.chance).toBeCloseTo(0.05, 10);
        // A skill check succeeds on the natural 20 alone, Champion or not.
        const check = describeCheckOdds(champion, inventory, { type: 'skill_check', skill: 'athletics', dc: 30 });
        expect(check.chance).toBeCloseTo(0.05, 10);
        expect(d20SuccessChance(5, 25, { critThreshold: 19 })).toBeCloseTo(0.10, 10);
        expect(d20SuccessChance(5, 25, { critThreshold: 19, advantage: true })).toBeCloseTo(1 - 0.9 * 0.9, 10);
    });
});

describe('the belts (2026-10-21 P2)', () => {
    it('a missing dexterity score reads as 10, never NaN AC', () => {
        expect(computeACFromInventory([], { abilityScores: { strength: 10 } })).toBe(10);
        expect(computeACFromInventory([row('chainShirt')], { abilityScores: { strength: 10 } })).toBe(13);
    });

    it('getSkillModifier survives a null character', () => {
        expect(getSkillModifier(null, 'stealth')).toBe(0);
        expect(getSkillModifier(undefined, 'athletics')).toBe(0);
    });

    it('a non-finite CON modifier is +0 in the HP terms', () => {
        expect(perLevelHpGain(10, NaN)).toBe(6);
        expect(perLevelHpGain(10, undefined)).toBe(6);
        expect(getMaxHitPoints('fighter', 3, undefined, { hitDie: 10 })).toBe(10 + 6 * 2);
        expect(Number.isFinite(getMaxHitPoints('fighter', 3, 'x', null))).toBe(true);
    });
});

describe('the proficiency matrix over the whole catalog (2026-10-21 test depth)', () => {
    const weapons = Object.values(ITEM_CATALOG).filter(item => item.type === 'weapon');
    const simple = w => String(w.category).startsWith('simple');
    const EXPECTED = {
        fighter: () => true,
        wizard: w => ['Dagger', 'Dart', 'Sling', 'Quarterstaff', 'Light Crossbow'].includes(w.name),
        rogue: w => simple(w) || ['Hand Crossbow', 'Longsword', 'Rapier', 'Shortsword'].includes(w.name),
        cleric: w => simple(w),
    };

    it('matches the 5e lists class by class, weapon by weapon', () => {
        expect(weapons.length).toBeGreaterThan(30);
        for (const className of Object.keys(CLASSES)) {
            const misses = weapons
                .filter(w => isProficientWithWeapon({ class: className }, w) !== EXPECTED[className](w))
                .map(w => w.name);
            expect({ className, misses }).toEqual({ className, misses: [] });
        }
    });
});
