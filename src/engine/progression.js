import { CLASSES } from '../data/classes.js';
import { rollDie } from './dice.ts';
import { getModifier } from './rules.js';
import { buildClassResources, getFeaturesForLevel } from './characterUtils.js';

export function getExperienceThreshold(level) {
    return Math.max(1, level) * 1000;
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
    const hpRoll = rollDie(hitDie);
    const hpGain = Math.max(1, hpRoll + conMod);
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

    const updatedCharacter = {
        ...character,
        level: newLevel,
        maxHP: newMaxHP,
        currentHP: newMaxHP,
        features: updatedFeatures,
        classResources: buildClassResources(character.class, newLevel),
        hitDice: { ...hitDice, total: newLevel, remaining: newLevel },
    };

    const featureMsg = newFeatures.length > 0
        ? `\nNew features: **${newFeatures.join('**, **')}**`
        : '';
    const milestoneMsg = milestone ? ' Milestone level-up.' : '';

    return {
        character: updatedCharacter,
        message: createSystemMessage(
            'lvl',
            `**Level Up!** You are now **Level ${newLevel}**!${milestoneMsg} Rolled **${hpRoll}** on d${hitDie} + ${conMod} CON = **+${hpGain} HP** (${character.maxHP} → ${newMaxHP}). Fully healed!${featureMsg}`
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
        messages.push(createSystemMessage(
            'xp',
            `**Experience gained:** +${xpAwarded} XP${reason}. Progress: ${updatedCharacter.exp} / ${getExperienceThreshold(updatedCharacter.level)} XP.`
        ));
    }

    if (options.milestoneLevelUp) {
        const leveled = applySingleLevelUp(updatedCharacter, { milestone: true });
        updatedCharacter = leveled.character;
        messages.push(leveled.message);
    }

    while (updatedCharacter.exp >= getExperienceThreshold(updatedCharacter.level)) {
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
