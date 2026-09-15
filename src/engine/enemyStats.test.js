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
    canonicalEnemyId,
    clampEnemyAC,
    clampEnemyCurrentHP,
    clampEnemyHP,
    enemyHealthCondition,
    isDeclaredDowned,
    normalizeEnemyAttackProfile,
    normalizeEnemyConditions,
    sanitizeEnemyDamage,
    sanitizeLoadedEnemy,
    validateEnemyAttackBonus,
    validateEnemySaveBonus,
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

    it('rounds in-band floats, coerces leading-number strings, rejects junk', () => {
        expect(validateEnemyAttackBonus(4.6)).toBe(5);
        // String-typed stats coerce like the coin/XP clamp (2026-09-05 audit):
        // "+4" is the DM writing a bonus the way the prompt example shows it.
        expect(validateEnemyAttackBonus('4')).toBe(4);
        expect(validateEnemyAttackBonus('+4')).toBe(4);
        expect(validateEnemyAttackBonus('+99')).toBeUndefined(); // still rejected, not clamped
        expect(validateEnemyAttackBonus('strong')).toBeUndefined();
        expect(validateEnemyAttackBonus('')).toBeUndefined();
        expect(validateEnemyAttackBonus(NaN)).toBeUndefined();
        expect(validateEnemyAttackBonus(Infinity)).toBeUndefined();
        expect(validateEnemyAttackBonus(undefined)).toBeUndefined();
    });
});

describe('validateEnemySaveBonus (offensive: reject, never clamp — 2026-07-27 audit)', () => {
    it('accepts the exact band edges -5 and 15', () => {
        expect(validateEnemySaveBonus(-5)).toBe(-5);
        expect(validateEnemySaveBonus(15)).toBe(15);
    });

    it('rejects one past each edge instead of clamping', () => {
        expect(validateEnemySaveBonus(-6)).toBeUndefined();
        expect(validateEnemySaveBonus(16)).toBeUndefined();
        expect(validateEnemySaveBonus(99)).toBeUndefined();
    });

    it('rounds in-band floats, coerces leading-number strings, rejects junk', () => {
        expect(validateEnemySaveBonus(4.6)).toBe(5);
        expect(validateEnemySaveBonus('3')).toBe(3);
        expect(validateEnemySaveBonus('junk')).toBeUndefined();
        expect(validateEnemySaveBonus(NaN)).toBeUndefined();
        expect(validateEnemySaveBonus(Infinity)).toBeUndefined();
        expect(validateEnemySaveBonus(undefined)).toBeUndefined();
    });

    it('flows through sanitizeLoadedEnemy: in-band kept, absurd deleted', () => {
        const kept = sanitizeLoadedEnemy({ id: 'e1', name: 'Wight', hp: 10, maxHp: 10, saveBonus: 6 });
        expect(kept.saveBonus).toBe(6);
        const rejected = sanitizeLoadedEnemy({ id: 'e2', name: 'Wight', hp: 10, maxHp: 10, saveBonus: 99 });
        expect(rejected).not.toHaveProperty('saveBonus');
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
        expect(clampEnemyAC('16')).toBe(16);      // string-typed AC coerces (2026-09-05)
        expect(clampEnemyAC('15 AC')).toBe(15);   // leading-number parse, like clamp()
        expect(clampEnemyAC('heavy')).toBe(12);
        expect(clampEnemyHP('22')).toBe(22);
        expect(clampEnemyHP('lots')).toBe(20);
        expect(clampEnemyCurrentHP('9', 30)).toBe(9);
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

    it('bounds a flood by the supported set itself — there is no separate count cap', () => {
        const supported = ['poisoned', 'blinded', 'frightened', 'restrained', 'prone',
            'invisible', 'stunned', 'paralyzed', 'unconscious'];
        // 9 supported conditions duplicated many times still yields the 9 unique ones:
        // the supported-set filter + dedupe IS the bound (the old "caps at 10" pin
        // asserted a cap the code never had — 2026-09-05 audit).
        const flood = [...supported, ...supported, ...supported, 'charmed', 'cursed'];
        expect(normalizeEnemyConditions(flood)).toEqual(supported);
    });

    it('reads a scalar string as a one-item list and every other non-array as empty (2026-09-15 audit P2)', () => {
        // Parity with the exchange's condition lanes, which accepted a scalar
        // while combat_start and the load boundary read it as [].
        expect(normalizeEnemyConditions('prone')).toEqual(['prone']);
        expect(normalizeEnemyConditions(' Blinded ')).toEqual(['blinded']);
        expect(normalizeEnemyConditions('dazzled')).toEqual([]);
        expect(normalizeEnemyConditions(null)).toEqual([]);
        expect(normalizeEnemyConditions(7)).toEqual([]);
        expect(normalizeEnemyConditions({ prone: true })).toEqual([]);
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

    it('drops unknown keys entirely — whitelist projection (2026-08-05 queue P2)', () => {
        // The old {...enemy} spread let a 1 MB junk field on a hostile save
        // survive "sanitization" and re-persist through every autosave.
        const cleaned = sanitizeLoadedEnemy({
            name: 'Ghoul',
            hp: 10,
            maxHp: 10,
            initiative: 14,
            saveBonus: 3,
            junkPayload: 'x'.repeat(1000),
            __proto__injection: { evil: true },
            portraitUrl: 'data:image/png;base64,AAAA',
        });
        expect(cleaned.initiative).toBe(14); // known fields survive
        expect(cleaned.saveBonus).toBe(3);
        expect(cleaned.junkPayload).toBeUndefined();
        expect(cleaned.portraitUrl).toBeUndefined();
        expect(Object.keys(cleaned).sort()).toEqual([
            'ac', 'boss', 'combatStatus', 'condition', 'conditions', 'defending',
            'hp', 'id', 'initiative', 'isUndead', 'maxHp', 'name', 'saveBonus',
        ].sort());
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

describe('canonicalEnemyId (direct — 2026-09-05 audit test-depth item)', () => {
    it('slugs the name under an enemy- prefix', () => {
        expect(canonicalEnemyId({ name: 'Cave Worg!' }, 0, new Set())).toBe('enemy-cave-worg');
    });

    it('is idempotent for an id that already carries the prefix', () => {
        expect(canonicalEnemyId({ id: 'enemy-worg' }, 0, new Set())).toBe('enemy-worg');
        expect(canonicalEnemyId({ id: 'Enemy-Worg' }, 0, new Set())).toBe('enemy-worg');
    });

    it('prefers id over name, and the index over a missing identity', () => {
        expect(canonicalEnemyId({ id: 'worg-alpha', name: 'Cave Worg' }, 0, new Set())).toBe('enemy-worg-alpha');
        expect(canonicalEnemyId({}, 2, new Set())).toBe('enemy-3');
    });

    it('falls back to the index when the name slugs to nothing', () => {
        expect(canonicalEnemyId({ name: '!!! ???' }, 4, new Set())).toBe('enemy-5');
    });

    it('suffixes collisions -2, -3 within one fight and records every id', () => {
        const used = new Set();
        expect(canonicalEnemyId({ name: 'Goblin' }, 0, used)).toBe('enemy-goblin');
        expect(canonicalEnemyId({ name: 'goblin' }, 1, used)).toBe('enemy-goblin-2');
        expect(canonicalEnemyId({ name: 'GOBLIN' }, 2, used)).toBe('enemy-goblin-3');
        expect([...used]).toEqual(['enemy-goblin', 'enemy-goblin-2', 'enemy-goblin-3']);
    });

    it('slices an absurd name to 80 characters before prefixing', () => {
        const id = canonicalEnemyId({ name: 'x'.repeat(500) }, 0, new Set());
        expect(id).toBe(`enemy-${'x'.repeat(80)}`);
    });
});

describe('sanitizeEnemyDamage trailing damage type (2026-09-15 audit P1)', () => {
    it('strips a trailing damage type instead of rejecting the notation to the 1d6 default', () => {
        // An ogre declared at "2d8+4 bludgeoning" swung for 1d6 for the whole
        // fight, silently — the companion twin strips this since 09-09.
        expect(sanitizeEnemyDamage('2d8+4 bludgeoning')).toBe('2d8+4');
        expect(sanitizeEnemyDamage('1d8+2 slashing')).toBe('1d8+2');
        expect(sanitizeEnemyDamage('1d8 + 2 (slashing)')).toBe('1d8+2');
        expect(sanitizeEnemyDamage('1d6 piercing')).toBe('1d6');
        expect(sanitizeEnemyDamage('1d10-1 cold')).toBe('1d10-1');
        expect(sanitizeEnemyDamage('2d6 fire/acid')).toBe('2d6');
    });

    it('still rejects multi-part and count-less notations, and out-of-band values under a type', () => {
        expect(sanitizeEnemyDamage('1d8+2, plus 1d6 poison')).toBeUndefined();
        expect(sanitizeEnemyDamage('d8 slashing')).toBeUndefined();
        expect(sanitizeEnemyDamage('9d8+2 slashing')).toBeUndefined();
        expect(sanitizeEnemyDamage('1d20 psychic')).toBeUndefined();
        expect(sanitizeEnemyDamage('1d8+99 necrotic')).toBeUndefined();
        expect(sanitizeEnemyDamage('slashing 1d8')).toBeUndefined();
    });

    it('keeps the plain notation forms byte-identical', () => {
        expect(sanitizeEnemyDamage('1d8+2')).toBe('1d8+2');
        expect(sanitizeEnemyDamage(' 2 d 6 - 1 ')).toBe('2d6-1');
        expect(sanitizeEnemyDamage('1d6')).toBe('1d6');
    });
});

describe('isDeclaredDowned', () => {
    it('is true only for a finite non-positive HP', () => {
        expect(isDeclaredDowned(0)).toBe(true);
        expect(isDeclaredDowned('0')).toBe(true);
        expect(isDeclaredDowned(-3)).toBe(true);
        expect(isDeclaredDowned(1)).toBe(false);
        expect(isDeclaredDowned(undefined)).toBe(false);
        expect(isDeclaredDowned(true)).toBe(false);
        expect(isDeclaredDowned('lots')).toBe(false);
    });
});

describe('sanitizeLoadedEnemy typed text and flag fields (2026-09-15 audit P2)', () => {
    it('never loads "[object Object]" as a name or id — an untyped id is dropped for re-minting', () => {
        const cleaned = sanitizeLoadedEnemy({ id: { evil: true }, name: { evil: true }, hp: 5, maxHp: 10 });
        expect(cleaned.name).toBe('Enemy');
        expect(cleaned.id).toBeUndefined();
        expect(sanitizeLoadedEnemy({ id: 7, name: 'Wolf', hp: 5 }).id).toBe('7');
        expect(sanitizeLoadedEnemy({ id: 'enemy-wolf', name: '   ', hp: 5 }).name).toBe('Enemy');
    });

    it('reads flag strings through toFlag and case-folds combatStatus', () => {
        const fled = sanitizeLoadedEnemy({ id: 'e1', name: 'Wolf', hp: 5, isUndead: 'false', defending: 'no', combatStatus: 'FLED' });
        expect(fled.isUndead).toBe(false);
        expect(fled.defending).toBe(false);
        expect(fled.combatStatus).toBe('fled');
        const undead = sanitizeLoadedEnemy({ id: 'e2', name: 'Ghoul', hp: 5, isUndead: 'true', combatStatus: ' Surrendered ' });
        expect(undead.isUndead).toBe(true);
        expect(undead.combatStatus).toBe('surrendered');
        expect(sanitizeLoadedEnemy({ id: 'e3', name: 'X', hp: 5, combatStatus: { s: 'fled' } }).combatStatus).toBe('active');
    });

    it('reads a scalar conditions string as a list', () => {
        expect(sanitizeLoadedEnemy({ id: 'e1', name: 'Wolf', hp: 5, conditions: 'prone' }).conditions).toEqual(['prone']);
    });
});
