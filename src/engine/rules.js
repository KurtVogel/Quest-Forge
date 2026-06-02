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
 * @param {object|boolean|null} shield - Equipped shield object, or true for a plain shield
 * @returns {number} Armor Class
 */
export function getArmorClass(dexMod, armor = null, shield = false) {
    let ac = 10 + dexMod; // Unarmored

    if (armor) {
        const armorBonus = armor.acBonus || armor.magicBonus || 0;
        switch (armor.armorType) {
            case 'light':
                ac = armor.baseAC + dexMod + armorBonus;
                break;
            case 'medium':
                ac = armor.baseAC + Math.min(dexMod, 2) + armorBonus;
                break;
            case 'heavy':
                ac = armor.baseAC + armorBonus;
                break;
            default:
                ac = 10 + dexMod;
        }
    }

    if (shield) {
        if (typeof shield === 'object') {
            ac += (shield.shieldAC || 2) + (shield.acBonus || shield.magicBonus || 0);
        } else {
            ac += 2;
        }
    }
    return ac;
}

/**
 * Compute AC from the full inventory + character ability scores.
 * Finds equipped armor and shield, then delegates to getArmorClass().
 * @param {Array} inventory - Full inventory array
 * @param {object} character - Character with abilityScores
 * @returns {number} Computed Armor Class
 */
export function computeACFromInventory(inventory, character) {
    if (!character?.abilityScores) return 10;
    const dexMod = getModifier(character.abilityScores.dexterity);

    const equippedArmor = inventory.find(i =>
        i.equipped && i.baseAC && !i.isShield && (i.type === 'armor')
    ) || null;

    const equippedShield = inventory.find(i =>
        i.equipped && (i.type === 'shield' || i.isShield)
    ) || null;

    return getArmorClass(dexMod, equippedArmor, equippedShield);
}

export function getEquippedWeapon(inventory = []) {
    return inventory.find(i => i.equipped && i.type === 'weapon') || null;
}

export function getWeaponAbilityModifier(character, weapon = null) {
    const strengthMod = getModifier(character.abilityScores.strength);
    const dexMod = getModifier(character.abilityScores.dexterity);
    if (weapon?.ranged && !weapon?.thrown) return dexMod;
    if (weapon?.finesse) return Math.max(strengthMod, dexMod);
    return strengthMod;
}

export function getWeaponAttackBonus(character, inventory = []) {
    const weapon = getEquippedWeapon(inventory);
    const abilityMod = getWeaponAbilityModifier(character, weapon);
    return abilityMod
        + getProficiencyBonus(character.level)
        + getLevelBonus(character)
        + (weapon?.attackBonus || weapon?.magicBonus || 0);
}

export function getWeaponDamageNotation(character, inventory = [], fallback = '1d4') {
    const weapon = getEquippedWeapon(inventory);
    const dice = weapon?.damage || fallback;
    const abilityMod = getWeaponAbilityModifier(character, weapon);
    const itemBonus = weapon?.damageBonus || weapon?.magicBonus || 0;
    const modifier = abilityMod + itemBonus;

    if (!/^\d+d\d+/i.test(String(dice))) {
        return fallback;
    }

    return `${dice}${modifier >= 0 ? '+' : ''}${modifier}`;
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
    const hasExpertise = character.expertiseSkills?.includes(skill) || false;

    const profMultiplier = hasExpertise ? 2 : (isProficient ? 1 : 0);
    return abilityMod + (profBonus * profMultiplier);
}

/**
 * Get full skill data for display: modifier, proficiency, expertise.
 */
export function getAllSkills(character) {
    return Object.entries(SKILL_ABILITIES).map(([skill, ability]) => {
        const abilityMod = getModifier(character.abilityScores[ability]);
        const profBonus = getProficiencyBonus(character.level);
        const isProficient = character.skillProficiencies?.includes(skill) || false;
        const hasExpertise = character.expertiseSkills?.includes(skill) || false;
        const profMultiplier = hasExpertise ? 2 : (isProficient ? 1 : 0);
        const total = abilityMod + (profBonus * profMultiplier);

        return {
            skill,
            ability,
            total,
            isProficient,
            hasExpertise,
        };
    });
}

/**
 * Get the level-based combat bonus for a character.
 * Currently Fighter-only: +1 to hit and damage per level beyond 1st, capped at +3.
 * Abstracts Fighting Style / martial scaling. Extra Attack is handled in rollResolver.js.
 * @param {object} character
 * @returns {number} Bonus (0 at level 1, +1 at level 2, max +3)
 */
export function getLevelBonus(character) {
    if (!character || character.class !== 'fighter') return 0;
    return Math.min(3, Math.max(0, character.level - 1));
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
