/**
 * Direct boundary tests for the enemy-stat sanitizers — "the single source of truth"
 * for LLM-hallucinated enemy mechanics (2026-07-13 audit: all prior coverage was
 * incidental via reducer/parser scenarios and never hit the exact edges).
 *
 * Policy under test: OFFENSIVE stats (attack bonus, damage) REJECT to undefined so
 * the engine default applies; DEFENSIVE stats (AC, HP) CLAMP into range.
 */
import { describe, expect, it } from 'vitest';
import {
    clampEnemyAC,
    clampEnemyCurrentHP,
    clampEnemyHP,
    enemyHealthCondition,
    normalizeEnemyAttackProfile,
    normalizeEnemyConditions,
    sanitizeEnemyDamage,
    sanitizeLoadedEnemy,
    validateEnemyAttackBonus,
} from './enemyStats.js';

describe('validateEnemyAttackBonus (offensive: reject, never clamp)', () => {
    it('accepts the exact band edges -5 and 15', () => {
        expect(validateEnemyAttackBonus(-5)).toBe(-5);
        expect(validateEnemyAttackBonus(15)).toBe(15);
    });

    it('rejects one past each edge instead of clamping', () => {
        expect(validateEnemyAttackBonus(-6)).toBeUndefined();
        expect(validateEnemyAttackBonus(16)).toBeUndefined();
        expect(validateEnemyAttackBonus(99)).toBeUndefined();
    });

    it('rounds in-band floats and rejects non-numbers', () => {
        expect(validateEnemyAttackBonus(4.6)).toBe(5);
        expect(validateEnemyAttackBonus('4')).toBeUndefined();
        expect(validateEnemyAttackBonus(NaN)).toBeUndefined();
        expect(validateEnemyAttackBonus(Infinity)).toBeUndefined();
        expect(validateEnemyAttackBonus(undefined)).toBeUndefined();
    });
});

describe('sanitizeEnemyDamage (offensive: reject, never clamp)', () => {
    it('accepts every legal die and the exact count/modifier edges', () => {
        expect(sanitizeEnemyDamage('1d4')).toBe('1d4');
        expect(sanitizeEnemyDamage('4d12+15')).toBe('4d12+15'); // max dice, max mod
        expect(sanitizeEnemyDamage('2d6-5')).toBe('2d6-5'); // min mod
        for (const sides of [4, 6, 8, 10, 12]) {
            expect(sanitizeEnemyDamage(`1d${sides}`)).toBe(`1d${sides}`);
        }
    });

    it('rejects one past each edge: 5 dice, ±1 beyond the modifier band', () => {
        expect(sanitizeEnemyDamage('5d6')).toBeUndefined();
        expect(sanitizeEnemyDamage('0d6')).toBeUndefined();
        expect(sanitizeEnemyDamage('2d6+16')).toBeUndefined();
        expect(sanitizeEnemyDamage('2d6-6')).toBeUndefined();
    });

    it('rejects non-weapon dice (d20/d100/d2) and malformed notation', () => {
        expect(sanitizeEnemyDamage('1d20')).toBeUndefined();
        expect(sanitizeEnemyDamage('1d100')).toBeUndefined();
        expect(sanitizeEnemyDamage('1d2')).toBeUndefined();
        expect(sanitizeEnemyDamage('a lot')).toBeUndefined();
        expect(sanitizeEnemyDamage('d6')).toBeUndefined();
        expect(sanitizeEnemyDamage(8)).toBeUndefined();
        expect(sanitizeEnemyDamage(null)).toBeUndefined();
    });

    it('normalizes case and whitespace into canonical notation', () => {
        expect(sanitizeEnemyDamage(' 2 D 6 + 3 ')).toBe('2d6+3');
        expect(sanitizeEnemyDamage('1D8')).toBe('1d8');
        expect(sanitizeEnemyDamage('2d6+0')).toBe('2d6');
    });
});

describe('clampEnemyAC / clampEnemyHP / clampEnemyCurrentHP (defensive: clamp)', () => {
    it('keeps AC band edges 1 and 25, falls back outside them', () => {
        expect(clampEnemyAC(1)).toBe(1);
        expect(clampEnemyAC(25)).toBe(25);
        expect(clampEnemyAC(0)).toBe(12);
        expect(clampEnemyAC(26)).toBe(12);
        expect(clampEnemyAC('16')).toBe(12);
        expect(clampEnemyAC(17.4, 10)).toBe(17);
        expect(clampEnemyAC(undefined, 14)).toBe(14);
    });

    it('caps max HP at 999 and defaults absurd values', () => {
        expect(clampEnemyHP(999)).toBe(999);
        expect(clampEnemyHP(5000)).toBe(999);
        expect(clampEnemyHP(1)).toBe(1);
        expect(clampEnemyHP(0)).toBe(20);
        expect(clampEnemyHP(-3, 15)).toBe(15);
        expect(clampEnemyHP(NaN)).toBe(20);
    });

    it('current HP may be zero but never negative or above max', () => {
        expect(clampEnemyCurrentHP(0, 30)).toBe(0);
        expect(clampEnemyCurrentHP(-4, 30)).toBe(0);
        expect(clampEnemyCurrentHP(45, 30)).toBe(30);
        expect(clampEnemyCurrentHP('bad', 30)).toBe(30);
        expect(clampEnemyCurrentHP(undefined, 30, 12)).toBe(12);
    });
});

describe('normalizeEnemyConditions', () => {
    it('lowercases, trims, dedupes, and drops unsupported names', () => {
        expect(normalizeEnemyConditions([' Prone ', 'PRONE', 'stunned', 'inspired', 42, null]))
            .toEqual(['prone', 'stunned']);
    });

    it('caps the list at 10 after deduplication', () => {
        const supported = ['poisoned', 'blinded', 'frightened', 'restrained', 'prone',
            'invisible', 'stunned', 'paralyzed', 'unconscious'];
        // 9 supported conditions duplicated many times still yields the 9 unique ones.
        const flood = [...supported, ...supported, ...supported];
        expect(normalizeEnemyConditions(flood)).toEqual(supported);
        expect(normalizeEnemyConditions(flood).length).toBeLessThanOrEqual(10);
    });

    it('returns an empty list for non-arrays', () => {
        expect(normalizeEnemyConditions('prone')).toEqual([]);
        expect(normalizeEnemyConditions(null)).toEqual([]);
    });
});

describe('normalizeEnemyAttackProfile', () => {
    it('keeps only the valid attack fields and omits rejected ones entirely', () => {
        expect(normalizeEnemyAttackProfile({ attackBonus: 4, damage: '1d8+2' }))
            .toEqual({ attackBonus: 4, damage: '1d8+2' });
        expect(normalizeEnemyAttackProfile({ attackBonus: 99, damage: '9d100+50' })).toEqual({});
        expect(normalizeEnemyAttackProfile({ attackBonus: 4, damage: 'nonsense' })).toEqual({ attackBonus: 4 });
        expect(normalizeEnemyAttackProfile(null)).toEqual({});
    });
});

describe('sanitizeLoadedEnemy', () => {
    it('rebounds every field of an untrusted saved enemy', () => {
        const cleaned = sanitizeLoadedEnemy({
            id: 'x'.repeat(200),
            name: `  ${'N'.repeat(150)}  `,
            hp: 5000,
            maxHp: 5000,
            ac: 99,
            attackBonus: 99,
            damage: '9d100+50',
            conditions: ['PRONE', 'prone', 'bogus'],
            combatStatus: 'victorious',
            defending: 'yes',
        });
        expect(cleaned.id).toHaveLength(120);
        expect(cleaned.name).toHaveLength(100);
        expect(cleaned.maxHp).toBe(999);
        expect(cleaned.hp).toBe(999);
        expect(cleaned.ac).toBe(12);
        expect(cleaned.attackBonus).toBeUndefined();
        expect(cleaned.damage).toBeUndefined();
        expect(cleaned.conditions).toEqual(['prone']);
        expect(cleaned.combatStatus).toBe('active');
        expect(cleaned.defending).toBe(true);
    });

    it('keeps a loaded 0-HP enemy dead instead of resurrecting it', () => {
        const cleaned = sanitizeLoadedEnemy({ name: 'Rarg', hp: 0, maxHp: 30, ac: 13 });
        expect(cleaned.hp).toBe(0);
        expect(cleaned.maxHp).toBe(30);
        expect(cleaned.condition).toBe('dead');
    });

    it('derives the health condition from the clamped values', () => {
        expect(sanitizeLoadedEnemy({ name: 'A', hp: 7, maxHp: 30 }).condition).toBe('critical');
        expect(sanitizeLoadedEnemy({ name: 'B', hp: 15, maxHp: 30 }).condition).toBe('bloodied');
        expect(sanitizeLoadedEnemy({ name: 'C', hp: 30, maxHp: 30 }).condition).toBe('healthy');
    });

    it('rejects non-object input outright', () => {
        expect(sanitizeLoadedEnemy(null)).toBe(null);
        expect(sanitizeLoadedEnemy('goblin')).toBe(null);
        expect(sanitizeLoadedEnemy([{ name: 'goblin' }])).toBe(null);
    });
});

describe('enemyHealthCondition thresholds', () => {
    it('switches exactly at 25% and 50%', () => {
        expect(enemyHealthCondition(0, 40)).toBe('dead');
        expect(enemyHealthCondition(10, 40)).toBe('critical'); // exactly 25%
        expect(enemyHealthCondition(11, 40)).toBe('bloodied');
        expect(enemyHealthCondition(20, 40)).toBe('bloodied'); // exactly 50%
        expect(enemyHealthCondition(21, 40)).toBe('healthy');
    });
});
