/**
 * Simplified D&D 5e-inspired rules engine.
 * Handles stat calculations, skill checks, and combat math.
 */
import { CLASSES } from '../data/classes.js';

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
        // normalizeItem clamps these at the trust boundary, but saves predating
        // the clamps (LOAD_GAME does not re-normalize inventory) can still carry
        // unbounded non-catalog stats — re-clamp so hero AC has a ceiling on
        // every path. Ceilings mirror plate (18) and +3 magic.
        const baseAC = Number.isFinite(armor.baseAC) ? Math.min(18, armor.baseAC) : armor.baseAC;
        const armorBonus = Math.min(3, armor.acBonus || armor.magicBonus || 0);
        switch (armor.armorType) {
            case 'light':
                ac = baseAC + dexMod + armorBonus;
                break;
            case 'medium':
                ac = baseAC + Math.min(dexMod, 2) + armorBonus;
                break;
            case 'heavy':
                ac = baseAC + armorBonus;
                break;
            default:
                // Unknown armorType but a real baseAC: honor it medium-style so
                // the engine agrees with the [AC N] line the DM prompt shows.
                ac = Number.isFinite(baseAC) ? baseAC + Math.min(dexMod, 2) + armorBonus : 10 + dexMod;
        }
    }

    if (shield) {
        if (typeof shield === 'object') {
            ac += Math.min(3, shield.shieldAC || 2) + Math.min(3, shield.acBonus || shield.magicBonus || 0);
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
    // A corrupted/stale save can carry a non-array inventory; LOAD_GAME does not
    // run the vault sanitizer, so guard here rather than crash the AC recompute.
    const items = Array.isArray(inventory) ? inventory : [];

    const equippedArmor = items.find(i =>
        i.equipped && i.baseAC && !i.isShield && (i.type === 'armor')
    ) || null;

    const equippedShield = items.find(i =>
        i.equipped && (i.type === 'shield' || i.isShield)
    ) || null;

    const styleBonus = character.class === 'fighter'
        && character.fightingStyle === 'defense'
        && equippedArmor
        ? 1
        : 0;

    // Sustained self-buff (Mage Armor / Shield of Faith on self). Computed here so
    // the character sheet, the DM prompt, and enemy attack rolls all see one AC.
    const spellBonus = character.sustainedSpell?.targetType !== 'companion'
        ? (character.sustainedSpell?.acBonus || 0)
        : 0;

    return getArmorClass(dexMod, equippedArmor, equippedShield) + styleBonus + spellBonus;
}

export function getEquippedWeapon(inventory = []) {
    if (!Array.isArray(inventory)) return null;
    return inventory.find(i => i.equipped && i.type === 'weapon') || null;
}

export function getWeaponAbilityModifier(character, weapon = null) {
    const strengthMod = getModifier(character.abilityScores.strength);
    const dexMod = getModifier(character.abilityScores.dexterity);
    if (weapon?.ranged && !weapon?.thrown) return dexMod;
    if (weapon?.finesse) return Math.max(strengthMod, dexMod);
    return strengthMod;
}

/**
 * Whether the character's class is proficient with a given weapon.
 *
 * Class `weaponProficiencies` mix broad category tokens ("simple", "martial") with
 * specific (pluralized) weapon names ("rapiers", "light crossbows"). Catalog weapons
 * carry a `category` (simpleMelee/simpleRanged/martialMelee/martialRanged) and a name.
 * We match either way. Weapons we can't positively place as simple/martial (free-form
 * story weapons with no category) get the benefit of the doubt — no penalty.
 *
 * @param {object} character
 * @param {object|null} weapon - Equipped weapon item, or null for unarmed
 * @returns {boolean}
 */
export function isProficientWithWeapon(character, weapon) {
    if (!weapon || !character) return true;
    const profs = (CLASSES[character.class]?.weaponProficiencies || []).map(p => p.toLowerCase().trim());
    // normalizeItem passes non-catalog names through untouched, so a hand-edited
    // numeric name/category reaches here — coerce instead of crashing.
    const category = String(weapon.category || '').toLowerCase();
    const name = String(weapon.name || '').toLowerCase().replace(/\s*\+\d+\b/g, '').trim();

    // Specific-name proficiency (e.g. wizard "daggers", rogue "rapiers").
    for (const t of profs) {
        const singular = t.endsWith('s') ? t.slice(0, -1) : t;
        if (name && (name === t || name === singular)) return true;
    }

    // Category proficiency.
    const isSimple = category.startsWith('simple');
    const isMartial = category.startsWith('martial');
    if (isSimple && profs.includes('simple')) return true;
    if (isMartial && profs.includes('martial')) return true;

    // Only penalize weapons we can positively categorize as simple/martial.
    if (!isSimple && !isMartial) return true;
    return false;
}

export function getWeaponAttackBonus(character, inventory = []) {
    const weapon = getEquippedWeapon(inventory);
    const abilityMod = getWeaponAbilityModifier(character, weapon);
    const proficient = isProficientWithWeapon(character, weapon);
    const styleBonus = character?.class === 'fighter'
        && character.fightingStyle === 'archery'
        && weapon?.ranged
        ? 2
        : 0;
    return abilityMod
        + (proficient ? getProficiencyBonus(character.level) : 0)
        + Math.min(3, weapon?.attackBonus || weapon?.magicBonus || 0)
        + styleBonus;
}

export function getWeaponDamageNotation(character, inventory = [], fallback = '1d4') {
    const weapon = getEquippedWeapon(inventory);
    const dice = weapon?.damage || fallback;
    const abilityMod = getWeaponAbilityModifier(character, weapon);
    const itemBonus = Math.min(3, weapon?.damageBonus || weapon?.magicBonus || 0);
    const styleBonus = character?.class === 'fighter'
        && character.fightingStyle === 'dueling'
        && weapon
        && !weapon.ranged
        && !weapon.twoHanded
        ? 2
        : 0;
    const modifier = abilityMod + itemBonus + styleBonus;

    if (!/^\d+d\d+/i.test(String(dice))) {
        // Junk damage notation falls back to fists, but keeps the wielder's
        // modifier — a broken weapon should not hit softer than a bare hand.
        return `${fallback}${modifier >= 0 ? '+' : ''}${modifier}`;
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
 * Get the modifier for a saving throw: ability modifier + proficiency when the
 * class grants proficiency in that save (e.g. Fighter: STR/CON).
 * @param {object} character
 * @param {string} ability - Ability name (e.g. 'dexterity')
 * @returns {number}
 */
export function getSavingThrowModifier(character, ability) {
    const score = character?.abilityScores?.[ability];
    if (score == null) return 0;
    const abilityMod = getModifier(score);
    const proficient = character.savingThrowProficiencies?.includes(ability) || false;
    return abilityMod + (proficient ? getProficiencyBonus(character.level) : 0);
}

/**
 * Mechanical effects of conditions, applied automatically by the roll resolver.
 * Keys are lowercase condition names (matched case-insensitively against
 * character.conditions). Effect kinds:
 *   attack          - the afflicted creature's attack rolls
 *   check           - the afflicted creature's ability/skill checks
 *   save            - the afflicted creature's saving throws
 *   incomingAttack  - attack rolls made AGAINST the afflicted creature
 * Values are 'advantage' | 'disadvantage'.
 */
export const CONDITION_EFFECTS = {
    poisoned: { attack: 'disadvantage', check: 'disadvantage' },
    blinded: { attack: 'disadvantage', incomingAttack: 'advantage' },
    frightened: { attack: 'disadvantage', check: 'disadvantage' },
    restrained: { attack: 'disadvantage', save: 'disadvantage', incomingAttack: 'advantage' },
    prone: { attack: 'disadvantage', incomingAttack: 'advantage' },
    invisible: { attack: 'advantage', incomingAttack: 'disadvantage' },
    exhausted: { check: 'disadvantage' },
    exhaustion: { check: 'disadvantage' },
    stunned: { incomingAttack: 'advantage' },
    paralyzed: { incomingAttack: 'advantage' },
    unconscious: { incomingAttack: 'advantage' },
};

/**
 * Conditions that deny a creature its own action entirely. These three carry an
 * incomingAttack advantage in CONDITION_EFFECTS, but their defining effect is that
 * the afflicted creature cannot act — a stunned ogre attacking at full
 * effectiveness on its own turn was a silent half-implementation (2026-07-13 audit).
 */
export const INCAPACITATING_CONDITIONS = ['stunned', 'paralyzed', 'unconscious'];

/** First incapacitating condition on the list, or null when the creature can act. */
export function getIncapacitatingCondition(conditions) {
    for (const raw of conditions || []) {
        const name = String(raw).toLowerCase().trim();
        if (INCAPACITATING_CONDITIONS.includes(name)) return name;
    }
    return null;
}

/**
 * Collect condition-driven advantage/disadvantage for a roll kind.
 * @param {string[]} conditions - Active condition names (any casing)
 * @param {'attack'|'check'|'save'|'incomingAttack'} kind
 * @returns {{ advantage: boolean, disadvantage: boolean, sources: string[] }}
 */
export function getConditionRollEffects(conditions, kind) {
    const result = { advantage: false, disadvantage: false, sources: [] };
    for (const raw of conditions || []) {
        const effect = CONDITION_EFFECTS[String(raw).toLowerCase().trim()]?.[kind];
        if (effect === 'advantage') {
            result.advantage = true;
            result.sources.push(raw);
        } else if (effect === 'disadvantage') {
            result.disadvantage = true;
            result.sources.push(raw);
        }
    }
    return result;
}

/**
 * Combine explicit roll flags with condition effects. 5e rule: any advantage +
 * any disadvantage cancel out to a straight roll, regardless of how many sources.
 * @returns {{ advantage: boolean, disadvantage: boolean, note: string }}
 */
export function combineRollModifiers(rollAdvantage, rollDisadvantage, conditionEffects) {
    const adv = !!rollAdvantage || conditionEffects.advantage;
    const dis = !!rollDisadvantage || conditionEffects.disadvantage;
    const note = conditionEffects.sources.length
        ? ` [${conditionEffects.sources.join(', ').toLowerCase()}]`
        : '';
    if (adv && dis) return { advantage: false, disadvantage: false, note: note ? `${note} (cancelled out)` : '' };
    return { advantage: adv, disadvantage: dis, note };
}

/**
 * Calculate the number of Sneak Attack dice (d6) for a Rogue.
 * @param {object} character
 * @param {object|null} weapon
 * @param {boolean} advantage
 * @param {boolean} disadvantage
 * @param {boolean} hasAlly
 * @returns {number} Number of d6 dice to roll
 */
export function getSneakAttackDice(character, weapon, advantage, disadvantage, hasAlly) {
    if (!character || character.class !== 'rogue') return 0;
    const isFinesseOrRanged = !!(weapon?.finesse || weapon?.ranged);
    if (!isFinesseOrRanged) return 0;
    if (disadvantage) return 0;
    if (advantage || hasAlly) {
        return Math.ceil((character.level || 1) / 2);
    }
    return 0;
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
    if (!classData || !Number.isFinite(classData.hitDie)) return 10 + conMod;

    // Level 1: max hit die + CON mod
    // Subsequent levels: average hit die + CON mod per level.
    // Both terms floor at 1 — matching progression.js's level-up formula — so a
    // very low CON can never produce zero or negative HP growth.
    const hitDie = classData.hitDie;
    const firstLevel = Math.max(1, hitDie + conMod);
    const perLevel = Math.max(1, Math.floor(hitDie / 2) + 1 + conMod);
    return firstLevel + perLevel * (level - 1);
}

// NOTE (2026-07-31 dead-code sweep): the classic 5/10/15/20/25/30 DC_TABLE was
// removed — it had zero consumers AND contradicted the shipped solo-play DC
// ladder (8 easy under pressure / 10 standard / 12 meaningful / 15 strong
// opposition / 18+ exceptional, see promptBuilder's roll rules). A future
// reader wiring "the DC table" into the prompt would have regressed a settled
// design decision.

/**
 * Format a modifier for display (e.g., +3, -1, +0).
 */
export function formatModifier(mod) {
    return mod >= 0 ? `+${mod}` : `${mod}`;
}
