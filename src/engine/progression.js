import { CLASSES } from '../data/classes.js';
import { getModifier } from './rules.js';
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
    const hpGain = Math.max(1, averageHp + conMod);
    const newLevel = character.level + 1;
    const newMaxHP = character.maxHP + hpGain;

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
        currentHP: newMaxHP,
        features: updatedFeatures,
        classResources: buildClassResources(character.class, newLevel),
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

    return {
        character: updatedCharacter,
        message: createSystemMessage(
            'lvl',
            `**Level Up!** You are now **Level ${newLevel}**!${milestoneMsg} Average HP **${averageHp}** from d${hitDie} + ${conMod} CON = **+${hpGain} HP** (${character.maxHP} → ${newMaxHP}). Fully healed!${featureMsg}`
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

export function estimateCombatExperience(enemies = []) {
    return enemies.reduce((sum, enemy) => {
        const hp = enemy.maxHp || enemy.hp || 10;
        const ac = enemy.ac || 12;
        const raw = hp * 2 + ac * 3;
        return sum + Math.max(25, Math.min(300, Math.round(raw)));
    }, 0);
}
