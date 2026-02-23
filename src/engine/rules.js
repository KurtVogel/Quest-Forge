/**
 * Simplified D&D 5e-inspired rules engine.
 * Handles stat calculations, skill checks, and combat math.
 */

/**
 * Calculate ability modifier from ability score.
 * @param {number} score - Ability score (typically 1-20)
 * @returns {number} Modifier value
 */
export function getModifier(score) {
    return Math.floor((score - 10) / 2);
}

/**
 * Get proficiency bonus based on character level.
 */
export function getProficiencyBonus(level) {
    if (level <= 4) return 2;
    if (level <= 8) return 3;
    if (level <= 12) return 4;
    if (level <= 16) return 5;
    return 6;
}

/**
 * Calculate Armor Class.
 * @param {number} dexMod - Dexterity modifier
 * @param {object|null} armor - Equipped armor object
 * @param {boolean} hasShield - Whether a shield is equipped
 * @returns {number} Armor Class
 */
export function getArmorClass(dexMod, armor = null, hasShield = false) {
    let ac = 10 + dexMod; // Unarmored

    if (armor) {
        switch (armor.armorType) {
            case 'light':
                ac = armor.baseAC + dexMod;
                break;
            case 'medium':
                ac = armor.baseAC + Math.min(dexMod, 2);
                break;
            case 'heavy':
                ac = armor.baseAC;
                break;
            default:
                ac = 10 + dexMod;
        }
    }

    if (hasShield) ac += 2;
    return ac;
}

/**
 * Skill-to-ability mapping.
 */
export const SKILL_ABILITIES = {
    acrobatics: 'dexterity',
    animalHandling: 'wisdom',
    arcana: 'intelligence',
    athletics: 'strength',
    deception: 'charisma',
    history: 'intelligence',
    insight: 'wisdom',
    intimidation: 'charisma',
    investigation: 'intelligence',
    medicine: 'wisdom',
    nature: 'intelligence',
    perception: 'wisdom',
    performance: 'charisma',
    persuasion: 'charisma',
    religion: 'intelligence',
    sleightOfHand: 'dexterity',
    stealth: 'dexterity',
    survival: 'wisdom',
};

/**
 * Get the modifier for a specific skill.
 * @param {object} character - Character object with abilityScores and skillProficiencies
 * @param {string} skill - Skill name (camelCase)
 * @returns {number} Total skill modifier
 */
export function getSkillModifier(character, skill) {
    const ability = SKILL_ABILITIES[skill];
    if (!ability) return 0;

    const abilityMod = getModifier(character.abilityScores[ability]);
    const profBonus = getProficiencyBonus(character.level);
    const isProficient = character.skillProficiencies?.includes(skill) || false;

    return abilityMod + (isProficient ? profBonus : 0);
}

/**
 * Resolve a check against a difficulty class.
 * @param {number} roll - The d20 roll (before modifiers)
 * @param {number} total - Total result (roll + modifiers)
 * @param {number} dc - Difficulty Class
 * @returns {{ success: boolean, critical: boolean, critFail: boolean }}
 */
export function resolveCheck(roll, total, dc) {
    return {
        success: total >= dc,
        critical: roll === 20,
        critFail: roll === 1,
    };
}

/**
 * Calculate max hit points.
 * @param {string} className - Character class name
 * @param {number} level - Character level
 * @param {number} conMod - Constitution modifier
 * @param {object} classData - Class data object with hitDie
 * @returns {number} Maximum HP
 */
export function getMaxHitPoints(className, level, conMod, classData) {
    if (!classData) return 10 + conMod;

    // Level 1: max hit die + CON mod
    // Subsequent levels: average hit die + CON mod per level
    const hitDie = classData.hitDie;
    const firstLevel = hitDie + conMod;
    const perLevel = Math.floor(hitDie / 2) + 1 + conMod;
    return firstLevel + perLevel * (level - 1);
}

/**
 * Difficulty class descriptions for the DM.
 */
export const DC_TABLE = {
    5: 'Very Easy',
    10: 'Easy',
    15: 'Medium',
    20: 'Hard',
    25: 'Very Hard',
    30: 'Nearly Impossible',
};

/**
 * Format a modifier for display (e.g., +3, -1, +0).
 */
export function formatModifier(mod) {
    return mod >= 0 ? `+${mod}` : `${mod}`;
}
