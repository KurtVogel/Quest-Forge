import { describe, expect, it } from 'vitest';
import { awardExperience, estimateCombatExperience, getExperienceThreshold, getQuestCompletionXp, isMaxLevel, MAX_CHARACTER_LEVEL, QUEST_INSTANT_XP } from './progression.js';
import { normalizeAbilityScoreImprovementState } from './characterUtils.js';

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

    it('grants ONE new hit die on level-up without refilling spent ones', () => {
        const result = awardExperience({
            ...character,
            level: 2,
            exp: 0,
            maxHP: 20,
            currentHP: 20,
            hitDice: { total: 2, remaining: 0, die: 10 }, // both dice spent on short rests
        }, 600);

        expect(result.character.level).toBe(3);
        expect(result.character.hitDice).toEqual({ total: 3, remaining: 1, die: 10 });
    });

    it('keeps hit dice at full when none were spent, including across multi-level jumps', () => {
        const rested = awardExperience({
            ...character,
            level: 1,
            exp: 0,
            maxHP: 12,
            currentHP: 12,
            hitDice: { total: 1, remaining: 1, die: 10 },
        }, 900); // 300 → L2, 600 more → L3

        expect(rested.character.level).toBe(3);
        expect(rested.character.hitDice).toEqual({ total: 3, remaining: 3, die: 10 });
    });

    it('defaults fighters to Champion when Martial Archetype unlocks at level 3', () => {
        const result = awardExperience({
            ...character,
            level: 2,
            exp: 0,
            maxHP: 20,
            currentHP: 20,
            features: ['Second Wind', 'Fighting Style', 'Action Surge'],
            classResources: {},
            hitDice: { total: 2, remaining: 2, die: 10 },
        }, 600);

        expect(result.character.level).toBe(3);
        expect(result.character.martialArchetype).toBe('champion');
        expect(result.character.features).toContain('Martial Archetype');
    });

    it('grants a pending Ability Score Improvement at level 4', () => {
        const result = awardExperience({
            ...character,
            level: 3,
            exp: 0,
            maxHP: 28,
            currentHP: 28,
            features: ['Second Wind', 'Fighting Style', 'Action Surge', 'Martial Archetype'],
            classResources: {},
            hitDice: { total: 3, remaining: 3, die: 10 },
        }, 1800);

        expect(result.character.level).toBe(4);
        expect(result.character.pendingAbilityScoreImprovements).toBe(1);
        expect(result.character.abilityScoreImprovementsApplied).toBe(0);
        expect(result.character.features).toContain('Ability Score Improvement');
    });

    it('grants further pending ASIs at the 5e cadence (8, 12, 16, 19)', () => {
        const result = awardExperience({
            ...character,
            level: 7,
            exp: 0,
            maxHP: 52,
            currentHP: 52,
            abilityScoreImprovementsApplied: 1,
            pendingAbilityScoreImprovements: 0,
            features: [],
            classResources: {},
            hitDice: { total: 7, remaining: 7, die: 10 },
        }, 23000);

        expect(result.character.level).toBe(8);
        expect(result.character.pendingAbilityScoreImprovements).toBe(1);
        expect(result.character.abilityScoreImprovementsApplied).toBe(1);
        expect(result.character.features).toContain('Ability Score Improvement');
    });

    it('backfills every missed ASI for an established high-level character', () => {
        // A level 12 hero from an old save who only ever spent the level-4 ASI
        // should wake up with the level-8 and level-12 improvements pending.
        const state = normalizeAbilityScoreImprovementState({
            level: 12,
            abilityScoreImprovementsApplied: 1,
        });
        expect(state.pendingAbilityScoreImprovements).toBe(2);
        expect(state.abilityScoreImprovementsApplied).toBe(1);
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

describe('estimateCombatExperience (End-Combat XP fallback)', () => {
    it('values an enemy at hp*2 + ac*3', () => {
        expect(estimateCombatExperience([{ maxHp: 20, ac: 14 }])).toBe(82);
    });

    it('floors a trivial enemy at 25 XP', () => {
        expect(estimateCombatExperience([{ maxHp: 1, ac: 5 }])).toBe(25);
    });

    it('caps a boss at 300 XP per enemy', () => {
        expect(estimateCombatExperience([{ maxHp: 200, ac: 20 }])).toBe(300);
    });

    it('defaults missing stats to hp 10 / ac 12', () => {
        expect(estimateCombatExperience([{}])).toBe(56);
    });

    it('values a slain enemy from maxHp, not its 0 current hp', () => {
        expect(estimateCombatExperience([{ maxHp: 20, hp: 0, ac: 10 }])).toBe(70);
    });

    it('sums per-enemy clamped values across the encounter', () => {
        expect(estimateCombatExperience([
            { maxHp: 1, ac: 5 },     // 25 (floored)
            { maxHp: 20, ac: 14 },   // 82
            { maxHp: 200, ac: 20 },  // 300 (capped)
        ])).toBe(407);
    });

    it('returns 0 for an empty encounter', () => {
        expect(estimateCombatExperience([])).toBe(0);
    });
});

describe('quest-completion XP tiers (rpg-balance-master ruling 2026-08-22)', () => {
    it('pays 12.5% of the current level threshold so 8 quests always make a level', () => {
        expect(getQuestCompletionXp(1)).toBe(38); // round(37.5) — rounds UP so 8 quests clear 300
        expect(getQuestCompletionXp(2)).toBe(75);
        expect(getQuestCompletionXp(4)).toBe(475);
        expect(getQuestCompletionXp(5)).toBe(938);
        expect(getQuestCompletionXp(10)).toBe(2625);
        for (const level of [1, 5, 10, 19]) {
            expect(getQuestCompletionXp(level) * 8).toBeGreaterThanOrEqual(getExperienceThreshold(level));
        }
    });

    it('keeps the instant tier flat and near-zero at any level', () => {
        expect(QUEST_INSTANT_XP).toBe(25);
    });

    it('clamps junk levels to level 1', () => {
        expect(getQuestCompletionXp(0)).toBe(38);
        expect(getQuestCompletionXp(NaN)).toBe(38);
        expect(getQuestCompletionXp(undefined)).toBe(38);
    });
});

describe('boss XP (statline-floor gated, rpg-balance-master ruling 2026-08-22)', () => {
    it('ignores the boss flag on a foe below the 300-raw floor — untrusted input pays ordinary XP', () => {
        // raw = 6*2 + 10*3 = 42 — a flagged mook is just a mook.
        expect(estimateCombatExperience([{ maxHp: 6, ac: 10, boss: true }], 5)).toBe(42);
    });

    it('pays raw*2 capped by the quest tier for a floor-qualifying boss', () => {
        // raw = 200*2 + 20*3 = 460 ≥ 300 → boss pays min(920, max(300, 938)) = 920 at L5.
        expect(estimateCombatExperience([{ maxHp: 200, ac: 20, boss: true }], 5)).toBe(920);
    });

    it('degenerates to the ordinary 300 ceiling at low level (quest tier < 300)', () => {
        expect(estimateCombatExperience([{ maxHp: 200, ac: 20, boss: true }], 1)).toBe(300);
        // Never pays LESS than the 300 the boss already had to clear.
        expect(estimateCombatExperience([{ maxHp: 200, ac: 20, boss: true }], 3)).toBe(300);
    });

    it('honors at most two floor-qualifying bosses per fight, in array order', () => {
        const wave = [
            { maxHp: 200, ac: 20, boss: true }, // 920 (boss 1)
            { maxHp: 200, ac: 20, boss: true }, // 920 (boss 2)
            { maxHp: 200, ac: 20, boss: true }, // 300 (excess — ordinary cap)
        ];
        expect(estimateCombatExperience(wave, 5)).toBe(2140);
    });

    it('pays a FLED boss ordinary XP only — the elevated tier needs a kill or surrender', () => {
        expect(estimateCombatExperience([{ maxHp: 200, ac: 20, boss: true, combatStatus: 'fled' }], 5)).toBe(300);
        expect(estimateCombatExperience([{ maxHp: 200, ac: 20, boss: true, combatStatus: 'surrendered' }], 5)).toBe(920);
    });

    it('keeps legacy no-level calls at the ordinary ceiling (backward compatibility)', () => {
        expect(estimateCombatExperience([{ maxHp: 200, ac: 20, boss: true }])).toBe(300);
    });
});

describe('class resources across level-ups (2026-08-08 audit P1)', () => {
    it('carries spent resources forward and unlocks new ones fresh', () => {
        // Fighter 1→2 with Second Wind already spent: XP lands at END_COMBAT, so
        // a mid-day level-up must not hand the day's abilities back for free.
        const result = awardExperience({
            ...character,
            level: 1,
            exp: 0,
            maxHP: 12,
            currentHP: 12,
            classResources: { secondWind: { used: 1, max: 1 } },
            hitDice: { total: 1, remaining: 1, die: 10 },
        }, 300);

        expect(result.character.level).toBe(2);
        expect(result.character.classResources.secondWind).toEqual({ used: 1, max: 1 });
        // Action Surge unlocks at 2 and starts fresh.
        expect(result.character.classResources.actionSurge).toEqual({ used: 0, max: 1 });
    });

    it('keeps resources spent across a multi-level jump', () => {
        const result = awardExperience({
            ...character,
            level: 1,
            exp: 0,
            maxHP: 12,
            currentHP: 12,
            classResources: { secondWind: { used: 1, max: 1 } },
            hitDice: { total: 1, remaining: 1, die: 10 },
        }, 900); // 300 → L2, 600 more → L3

        expect(result.character.level).toBe(3);
        expect(result.character.classResources.secondWind.used).toBe(1);
        expect(result.character.classResources.actionSurge).toEqual({ used: 0, max: 1 });
    });

    it('clamps junk carried used-counts to the resource max', () => {
        const result = awardExperience({
            ...character,
            level: 1,
            exp: 0,
            maxHP: 12,
            currentHP: 12,
            classResources: { secondWind: { used: 7, max: 1 } },
            hitDice: { total: 1, remaining: 1, die: 10 },
        }, 300);

        expect(result.character.classResources.secondWind).toEqual({ used: 1, max: 1 });
    });
});

describe('level-up heal revival semantics (2026-08-30 P1)', () => {
    const dyingHero = {
        ...character,
        level: 1,
        exp: 0,
        maxHP: 12,
        currentHP: 0,
        dying: true,
        deathSaves: { successes: 1, failures: 2 },
        conditions: ['Unconscious', 'Restrained'],
        hitDice: { total: 1, remaining: 1, die: 10 },
    };

    it('revives a dying hero on level-up — full HP with death saves ended, not continued', () => {
        const result = awardExperience(dyingHero, 300);
        expect(result.character.level).toBe(2);
        expect(result.character.currentHP).toBe(result.character.maxHP);
        expect(result.character.dying).toBe(false);
        expect(result.character.deathSaves).toEqual({ successes: 0, failures: 0 });
        expect(result.character.conditions).toEqual(['Restrained']);
        expect(result.messages.some(m => m.content.includes('back on your feet'))).toBe(true);
    });

    it('clears a low-level defeat setback on level-up', () => {
        const result = awardExperience({
            ...dyingHero,
            dying: false,
            lowLevelDefeat: true,
            deathSaves: { successes: 0, failures: 0 },
            conditions: ['Unconscious'],
        }, 300);
        expect(result.character.lowLevelDefeat).toBe(false);
        expect(result.character.currentHP).toBe(result.character.maxHP);
        expect(result.character.conditions).toEqual([]);
    });

    it('never writes currentHP on a dead hero — post-mortem XP grows the sheet, not the corpse', () => {
        const result = awardExperience({
            ...dyingHero,
            dying: false,
            isDead: true,
            deathSaves: { successes: 0, failures: 0 },
        }, 300);
        expect(result.character.level).toBe(2);
        expect(result.character.currentHP).toBe(0);
        expect(result.character.isDead).toBe(true);
        expect(result.messages.some(m => m.content.includes('Fully healed'))).toBe(false);
    });

    it('keeps the plain full-heal line for a conscious hero', () => {
        const result = awardExperience({ ...dyingHero, dying: false, currentHP: 3, deathSaves: undefined, conditions: [] }, 300);
        expect(result.messages.some(m => m.content.includes('Fully healed!'))).toBe(true);
        expect(result.character.dying).toBeFalsy();
    });
});

describe('hostile-input robustness (2026-07-28 audit)', () => {
    it('getExperienceThreshold clamps junk levels to the table bounds', () => {
        expect(getExperienceThreshold(0)).toBe(300);
        expect(getExperienceThreshold(-1)).toBe(300);
        expect(getExperienceThreshold(25)).toBe(50000);
        expect(getExperienceThreshold(NaN)).toBe(50000);
    });

    it('awardExperience tolerates a missing character', () => {
        expect(awardExperience(null, 100)).toEqual({ character: null, messages: [] });
    });

    it('awardExperience treats negative/NaN/non-numeric-string amounts as zero', () => {
        for (const junk of [-500, NaN, 'a heap of XP', {}, null, undefined]) {
            const result = awardExperience({ ...character, level: 1 }, junk);
            expect(result.character.exp).toBe(0);
            expect(result.character.level).toBe(1);
            expect(result.messages).toHaveLength(0);
        }
    });

    it('awardExperience coerces a numeric string amount (corrupted-save shape)', () => {
        const result = awardExperience({ ...character, level: 1 }, '50');
        expect(result.character.exp).toBe(50);
    });

    it('level-up coerces a string level from a corrupted save instead of concatenating', () => {
        const result = awardExperience({
            ...character,
            level: '1',
            exp: 0,
            maxHP: 12,
            currentHP: 12,
            hitDice: { total: 1, remaining: 1, die: 10 },
        }, 300);
        expect(result.character.level).toBe(2); // was "11" with raw `character.level + 1`
    });

    it('level-up falls back to the d8 hit die for an unknown class', () => {
        const bard = { ...character, class: 'bard', level: 1, exp: 0, maxHP: 10, currentHP: 10, hitDice: { total: 1, remaining: 1, die: 8 } };
        const result = awardExperience(bard, 300);
        expect(result.character.level).toBe(2);
        // floor(8/2) + 1 + CON(+2) = 7
        expect(result.character.maxHP).toBe(17);
    });

    it('estimateCombatExperience coerces object-valued stats to defaults instead of a NaN sum', () => {
        expect(estimateCombatExperience([{ maxHp: {}, ac: { armored: true } }])).toBe(56);
        expect(estimateCombatExperience([{ maxHp: '30', ac: '14' }])).toBe(102);
    });

    it('estimateCombatExperience skips junk entries and non-array input', () => {
        expect(estimateCombatExperience([null, 'goblin', 7])).toBe(0);
        expect(estimateCombatExperience('not-an-array')).toBe(0);
        expect(estimateCombatExperience()).toBe(0);
    });
});
