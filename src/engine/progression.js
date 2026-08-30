import { CLASSES } from '../data/classes.js';
import { getModifier, perLevelHpGain } from './rules.js';
import { buildClassResources, getFeaturesForLevel, normalizeAbilityScoreImprovementState, normalizeMartialArchetype } from './characterUtils.js';
import { buildSpellSlots, isSpellcaster } from './spellcasting.js';

export const MAX_CHARACTER_LEVEL = 20;

// XP needed to advance from each level to the next, derived from the D&D 5e
// (PHB) cumulative XP-to-level table: 0, 300, 900, 2700, 6500, 14000, 23000,
// 34000, 48000, 64000, 85000, 100000, 120000, 140000, 165000, 195000, 225000,
// 265000, 305000, 355000 — each entry here is the difference between
// consecutive cumulative values (index 0 = level 1 -> 2, ... index 18 =
// level 19 -> 20). Level 20 is 5e's cap; level 20+ reuses the final value
// only for progress display/import clamps, not for further advancement.
const XP_THRESHOLDS = [
    300, 600, 1800, 3800, 7500, 9000, 11000, 14000, 16000,
    21000, 15000, 20000, 20000, 25000, 30000, 30000, 40000, 40000, 50000,
];

export function getExperienceThreshold(level) {
    const idx = Math.max(1, level) - 1;
    return XP_THRESHOLDS[idx] ?? XP_THRESHOLDS[XP_THRESHOLDS.length - 1];
}

export function isMaxLevel(level) {
    return Math.max(1, Number(level) || 1) >= MAX_CHARACTER_LEVEL;
}

/*
 * THE THREE LEVEL-SCALED REWARD TIERS (rpg-balance-master rulings 2026-08-05
 * and 2026-08-22): front resolution (50% of the current level's threshold) >
 * quest completion ≈ boss kill (12.5%, i.e. exactly 1/4 of a front — so 4
 * quests = 1 front = half a level, 8 quests = 1 level, at ANY level) >
 * ordinary combat (flat 25–300 per enemy clamp, deliberately non-scaling).
 * All three are engine-computed only — never routed through the LLM-declared
 * exp_awarded channel, which is reserved for small freeform bonuses.
 */

/**
 * Milestone XP for decisively ending a hidden campaign front (DECISIONS.md
 * 2026-08-05 ×2, rpg-balance-master ruling): half the XP gap from the
 * character's current level to the next, so two resolutions with no other XP
 * are exactly one level-up at any level 1–19. Scales with the non-flat
 * threshold table where any flat number would be trivial at L15 and a full
 * level dump at L1; always outsizes a single fight (combat XP clamps at
 * 25–300 per enemy). Engine-computed only — never routed through the
 * LLM-declared exp_awarded channel.
 */
export function getFrontResolutionMilestoneXp(level) {
    return Math.round(0.5 * getExperienceThreshold(Math.max(1, Number(level) || 1)));
}

// Flat award for a quest opened and resolved inside a single DM response (or
// recorded terminal via the never-tracked fallback insert): deliberately
// near-zero at high level so same-turn quest minting can never be farmed.
export const QUEST_INSTANT_XP = 25;

/**
 * Engine-owned XP for completing a tracked quest (rpg-balance-master ruling
 * 2026-08-22): 12.5% of the current level's threshold — exactly 1/4 of a front
 * resolution, so the "8 completed quests = 1 level" invariant holds at every
 * level. Chosen over the LLM's exp_awarded channel on live evidence: for the
 * identical scripted quest, gpt-5.6 awarded +75 XP and gemini-3.1-pro-preview
 * awarded 0.
 */
export function getQuestCompletionXp(level) {
    return Math.round(0.125 * getExperienceThreshold(Math.max(1, Number(level) || 1)));
}

function createSystemMessage(kind, content) {
    return {
        id: `msg-${Date.now()}-${kind}-${Math.random().toString(36).slice(2, 7)}`,
        timestamp: Date.now(),
        role: 'system',
        content,
    };
}

function applySingleLevelUp(character, { milestone = false } = {}) {
    const classData = CLASSES[character.class];
    const hitDie = classData?.hitDie || 8;
    const conMod = getModifier(character.abilityScores?.constitution || 10);
    const averageHp = Math.floor(hitDie / 2) + 1;
    const hpGain = perLevelHpGain(hitDie, conMod);
    const newLevel = (Number(character.level) || 1) + 1;
    const newMaxHP = character.maxHP + hpGain;

    // Death is permanent (resurrection is deliberately cut): a level crossed by
    // post-mortem XP (a slainXpOnly loss paying for foes killed before the end)
    // grows the sheet but must never write currentHP — no "Fully healed!" on a
    // corpse. And the full heal has REVIVE semantics ("heals revive dying"): a
    // hero who levels while dying or defeated stands back up — death saves
    // cannot continue at full HP. Mirrors reviveCharacter in
    // state/handlers/shared.js (kept inline: importing it here would cycle
    // progression ⇄ handlers/shared).
    const isDead = !!character.isDead;
    const revived = !isDead && (!!character.dying || !!character.lowLevelDefeat);

    const newFeatures = getFeaturesForLevel(character.class, newLevel);
    const existingFeatures = character.features || [];
    const updatedFeatures = [
        ...existingFeatures,
        ...newFeatures.filter(f => !existingFeatures.includes(f)),
    ];

    const hitDice = character.hitDice || {
        total: character.level,
        remaining: character.level,
        die: hitDie,
    };

    const updatedCharacterBase = {
        ...character,
        level: newLevel,
        maxHP: newMaxHP,
        currentHP: isDead ? character.currentHP : newMaxHP,
        ...(revived && {
            dying: false,
            lowLevelDefeat: false,
            deathSaves: { successes: 0, failures: 0 },
            conditions: (character.conditions || []).filter(c => String(c).toLowerCase() !== 'unconscious'),
        }),
        features: updatedFeatures,
        // Spent uses carry over — newly unlocked resources start fresh, but a
        // level-up mid-day never hands back the day's spent abilities.
        classResources: buildClassResources(character.class, newLevel, character.classResources),
        // Spent slots carry over — a level-up mid-day grows the slot table but
        // never silently refills the day's magic.
        ...(isSpellcaster(character.class) && { spellSlots: buildSpellSlots(newLevel, character.spellSlots) }),
        martialArchetype: normalizeMartialArchetype(character.class, newLevel, character.martialArchetype),
        // The new level grants ONE new hit die; already-spent dice stay spent — like
        // spell slots above, leveling mid-day never refills the day's rest resources.
        hitDice: {
            ...hitDice,
            total: newLevel,
            remaining: Math.min(newLevel, Math.max(0, hitDice.remaining ?? hitDice.total ?? character.level) + 1),
        },
    };
    const updatedCharacter = {
        ...updatedCharacterBase,
        ...normalizeAbilityScoreImprovementState(updatedCharacterBase),
    };

    const featureMsg = newFeatures.length > 0
        ? `\nNew features: **${newFeatures.join('**, **')}**`
        : '';
    const milestoneMsg = milestone ? ' Milestone level-up.' : '';
    const healMsg = isDead
        ? ''
        : (revived ? ' Fully healed — back on your feet, no longer dying!' : ' Fully healed!');

    return {
        character: updatedCharacter,
        message: createSystemMessage(
            'lvl',
            `**Level Up!** You are now **Level ${newLevel}**!${milestoneMsg} Average HP **${averageHp}** from d${hitDie} + ${conMod} CON = **+${hpGain} HP** (${character.maxHP} → ${newMaxHP}).${healMsg}${featureMsg}`
        ),
    };
}

export function awardExperience(character, amount = 0, options = {}) {
    if (!character) return { character, messages: [] };

    const xpAwarded = Math.max(0, Math.floor(Number(amount) || 0));
    const messages = [];
    let updatedCharacter = {
        ...character,
        exp: (character.exp || 0) + xpAwarded,
    };

    if (xpAwarded > 0) {
        const reason = options.reason ? ` (${options.reason})` : '';
        const progress = isMaxLevel(updatedCharacter.level)
            ? `${updatedCharacter.exp} XP. Max level reached.`
            : `${updatedCharacter.exp} / ${getExperienceThreshold(updatedCharacter.level)} XP.`;
        messages.push(createSystemMessage(
            'xp',
            `**Experience gained:** +${xpAwarded} XP${reason}. Progress: ${progress}`
        ));
    }

    if (options.milestoneLevelUp && !isMaxLevel(updatedCharacter.level)) {
        const leveled = applySingleLevelUp(updatedCharacter, { milestone: true });
        updatedCharacter = leveled.character;
        messages.push(leveled.message);
    }

    while (!isMaxLevel(updatedCharacter.level) && updatedCharacter.exp >= getExperienceThreshold(updatedCharacter.level)) {
        const threshold = getExperienceThreshold(updatedCharacter.level);
        updatedCharacter = {
            ...updatedCharacter,
            exp: updatedCharacter.exp - threshold,
        };
        const leveled = applySingleLevelUp(updatedCharacter);
        updatedCharacter = leveled.character;
        messages.push(leveled.message);
    }

    return { character: updatedCharacter, messages };
}

// A boss flag only pays boss XP when the statline was already going to max out
// the ordinary per-enemy clamp anyway — the flag is untrusted LLM input, the
// raw score is engine-verifiable (rpg-balance-master ruling 2026-08-22).
const BOSS_RAW_FLOOR = 300;
// Even floor-qualifying bosses are honored at most twice per fight: flagging a
// whole wave of elites must not turn one encounter into a front-scale payday.
const MAX_BOSS_AWARDS_PER_FIGHT = 2;

export function estimateCombatExperience(enemies = [], level = 1) {
    // Fallback-estimator inputs come straight from LLM-authored enemy records —
    // an object-valued stat would poison the whole sum with NaN (Math.max(25, NaN)
    // is NaN), so coerce each stat and skip junk entries entirely.
    const positive = (value) => {
        const n = Number(value);
        return Number.isFinite(n) && n > 0 ? n : 0;
    };
    let bossAwards = 0;
    return (Array.isArray(enemies) ? enemies : []).reduce((sum, enemy) => {
        if (!enemy || typeof enemy !== 'object') return sum;
        const hp = positive(enemy.maxHp) || positive(enemy.hp) || 10;
        const ac = positive(enemy.ac) || 12;
        const raw = hp * 2 + ac * 3;
        // Boss tier: kill or surrender only — a fled boss can narratively return,
        // and with no persistent boss-identity ledger the elevated tier would
        // double-dip on every reappearance. Fled bosses pay ordinary flee-XP.
        const qualifiesAsBoss = enemy.boss === true
            && raw >= BOSS_RAW_FLOOR
            && enemy.combatStatus !== 'fled'
            && bossAwards < MAX_BOSS_AWARDS_PER_FIGHT;
        if (qualifiesAsBoss) {
            bossAwards += 1;
            // Ceiling pinned to the quest tier so a single fight, however dramatic,
            // never rivals a front resolution; never below the ordinary 300 clamp
            // the boss already had to clear (at L1–3 the quest tier is under 300,
            // where boss XP deliberately degenerates to the ordinary ceiling).
            const ceiling = Math.max(BOSS_RAW_FLOOR, getQuestCompletionXp(level));
            return sum + Math.max(BOSS_RAW_FLOOR, Math.min(Math.round(raw * 2), ceiling));
        }
        return sum + Math.max(25, Math.min(300, Math.round(raw)));
    }, 0);
}
