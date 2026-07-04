/**
 * Character creation utilities and helpers.
 */
import { getModifier, getProficiencyBonus, getMaxHitPoints, computeACFromInventory } from './rules.js';
import { rollDice } from './dice.ts';
import { RACES } from '../data/races.js';
import { CLASSES } from '../data/classes.js';
import { normalizeItem } from '../data/items.js';

/**
 * Standard array for ability score assignment.
 */
export const STANDARD_ARRAY = [15, 14, 13, 12, 10, 8];

const STARTING_GOLD_DICE = { count: 2, sides: 20 };
// Standard 5e ASI cadence, uniform across classes — no feats by design, and no
// Fighter bonus ASIs (Fighter identity already comes from the level bonus,
// Fighting Styles, Champion crits, Extra Attack, and Action Surge).
const ABILITY_SCORE_IMPROVEMENT_LEVELS = [4, 8, 12, 16, 19];

/**
 * Ability score names in standard order.
 */
export const ABILITY_NAMES = ['strength', 'dexterity', 'constitution', 'intelligence', 'wisdom', 'charisma'];

/**
 * Short labels for abilities.
 */
export const ABILITY_SHORT = {
    strength: 'STR',
    dexterity: 'DEX',
    constitution: 'CON',
    intelligence: 'INT',
    wisdom: 'WIS',
    charisma: 'CHA',
};

export const DEFAULT_FIGHTER_FIGHTING_STYLE = 'defense';
export const DEFAULT_FIGHTER_MARTIAL_ARCHETYPE = 'champion';

/**
 * Human-readable skill labels.
 */
export const SKILL_LABELS = {
    acrobatics: 'Acrobatics',
    animalHandling: 'Animal Handling',
    arcana: 'Arcana',
    athletics: 'Athletics',
    deception: 'Deception',
    history: 'History',
    insight: 'Insight',
    intimidation: 'Intimidation',
    investigation: 'Investigation',
    medicine: 'Medicine',
    nature: 'Nature',
    perception: 'Perception',
    performance: 'Performance',
    persuasion: 'Persuasion',
    religion: 'Religion',
    sleightOfHand: 'Sleight of Hand',
    stealth: 'Stealth',
    survival: 'Survival',
};

/**
 * Apply racial ability score bonuses.
 */
export function applyRacialBonuses(abilityScores, raceName) {
    const race = RACES[raceName];
    if (!race?.abilityBonuses) return { ...abilityScores };

    const result = { ...abilityScores };
    for (const [ability, bonus] of Object.entries(race.abilityBonuses)) {
        if (result[ability] !== undefined) {
            result[ability] += bonus;
        }
    }
    return result;
}

/**
 * Build the initial classResources object for a character.
 * Each resource tracks `used` count vs `max` uses.
 */
export function buildClassResources(className, level) {
    const charClass = CLASSES[className];
    if (!charClass?.resources) return {};

    const resources = {};
    for (const [key, def] of Object.entries(charClass.resources)) {
        if (level >= (def.minLevel || 1)) {
            resources[key] = { used: 0, max: def.max };
        }
    }
    return resources;
}

export function normalizeFightingStyle(className, value) {
    const styles = CLASSES[className]?.fightingStyles;
    if (!styles) return null;
    return styles[value] ? value : DEFAULT_FIGHTER_FIGHTING_STYLE;
}

export function getFightingStyleLabel(className, value) {
    const style = normalizeFightingStyle(className, value);
    return style ? CLASSES[className]?.fightingStyles?.[style]?.label || style : null;
}

export function normalizeMartialArchetype(className, level, value) {
    const archetypes = CLASSES[className]?.martialArchetypes;
    if (!archetypes || (Number(level) || 1) < 3) return null;
    return archetypes[value] ? value : DEFAULT_FIGHTER_MARTIAL_ARCHETYPE;
}

export function getMartialArchetypeLabel(className, level, value) {
    const archetype = normalizeMartialArchetype(className, level, value);
    return archetype ? CLASSES[className]?.martialArchetypes?.[archetype]?.label || archetype : null;
}

export function getAbilityScoreImprovementCount(level) {
    const n = Number(level) || 1;
    return ABILITY_SCORE_IMPROVEMENT_LEVELS.filter(l => n >= l).length;
}

export function normalizeAbilityScoreImprovementState(character = {}) {
    const earned = getAbilityScoreImprovementCount(character.level);
    const rawApplied = Number(character.abilityScoreImprovementsApplied);
    const applied = Number.isFinite(rawApplied)
        ? Math.max(0, Math.min(earned, Math.trunc(rawApplied)))
        : 0;

    // Pending is DERIVED, never trusted: there is no way to decline an ASI, so
    // applied + pending must always equal earned. This is also the migration
    // path — old saves stored pending 0 after spending the level-4 ASI, and a
    // stored zero must not swallow improvements added to the cadence later.
    return {
        abilityScoreImprovementsApplied: applied,
        pendingAbilityScoreImprovements: Math.max(0, earned - applied),
    };
}

/**
 * Get features unlocked at a specific level for a class.
 */
export function getFeaturesForLevel(className, level) {
    const charClass = CLASSES[className];
    if (!charClass?.features) return [];
    return charClass.features[level] || [];
}

/**
 * Get all features unlocked up to and including a given level.
 */
export function getAllFeaturesUpToLevel(className, level) {
    const charClass = CLASSES[className];
    if (!charClass?.features) return [];
    const features = [];
    for (let l = 1; l <= level; l++) {
        if (charClass.features[l]) {
            features.push(...charClass.features[l]);
        }
    }
    return features;
}

/**
 * Create a new character object.
 * @param {string} name
 * @param {string} raceName
 * @param {string} className
 * @param {object} abilityScores - Base ability scores before racial bonuses
 * @param {string[]} chosenSkills - Skills chosen by the player during creation
 */
export function createCharacter(name, raceName, className, abilityScores, chosenSkills = [], options = {}) {
    const race = RACES[raceName];
    const charClass = CLASSES[className];

    if (!race || !charClass) {
        throw new Error(`Invalid race "${raceName}" or class "${className}"`);
    }

    const adjustedScores = applyRacialBonuses(abilityScores, raceName);
    const conMod = getModifier(adjustedScores.constitution);
    const maxHP = getMaxHitPoints(className, 1, conMod, charClass);
    const inventory = createStartingInventory(className);
    const startingGoldRolls = rollDice(STARTING_GOLD_DICE.count, STARTING_GOLD_DICE.sides);
    const startingGold = startingGoldRolls.reduce((sum, roll) => sum + roll, 0);

    // Merge racial skill proficiencies with player-chosen skills (deduplicated)
    const racialSkills = race.skillProficiencies || [];
    const allSkills = [...new Set([...racialSkills, ...chosenSkills])];

    const character = {
        id: `char-${Date.now()}`,
        name,
        race: raceName,
        class: className,
        level: 1,
        exp: 0,
        gold: startingGold,
        silver: 0,
        copper: 0,
        abilityScores: adjustedScores,
        maxHP,
        currentHP: maxHP,
        tempHP: 0,
        proficiencyBonus: getProficiencyBonus(1),
        skillProficiencies: allSkills,
        expertiseSkills: className === 'rogue' ? (options.expertiseSkills || []) : [],
        savingThrowProficiencies: [...(charClass.savingThrows || [])],
        fightingStyle: normalizeFightingStyle(className, options.fightingStyle),
        martialArchetype: normalizeMartialArchetype(className, 1, options.martialArchetype),
        abilityScoreImprovementsApplied: 0,
        pendingAbilityScoreImprovements: 0,
        speed: race.speed || 30,
        traits: [...(race.traits || [])],
        features: [...(charClass.features?.['1'] || [])],
        classResources: buildClassResources(className, 1),
        hitDice: { total: 1, remaining: 1, die: charClass.hitDie },
        conditions: [],
        notes: '',
        createdAt: Date.now(),
        startingGoldRolls,
    };

    return {
        ...character,
        armorClass: computeACFromInventory(inventory, character),
    };
}

/**
 * Calculate derived stats for display.
 */
export function getDerivedStats(character) {
    const modifiers = {};
    for (const ability of ABILITY_NAMES) {
        modifiers[ability] = getModifier(character.abilityScores[ability]);
    }

    return {
        modifiers,
        proficiencyBonus: getProficiencyBonus(character.level),
        initiative: modifiers.dexterity,
        passivePerception: 10 + getModifier(character.abilityScores.wisdom) +
            (character.skillProficiencies?.includes('perception') ? getProficiencyBonus(character.level) : 0),
    };
}

/**
 * Get starting equipment for a class.
 */
export function getStartingEquipment(className) {
    const charClass = CLASSES[className];
    return charClass?.startingEquipment || [];
}

/**
 * Build equipped starting inventory for a new character.
 */
export function createStartingInventory(className) {
    let weaponEquipped = false; // Only the first weapon starts as the active weapon.
    return getStartingEquipment(className).map((item, index) => {
        const equipWeapon = item.type === 'weapon' && !weaponEquipped;
        if (equipWeapon) weaponEquipped = true;
        return {
            id: `item-${Date.now()}-${index}-${Math.random().toString(36).slice(2, 7)}`,
            quantity: 1,
            equipped: item.type === 'armor' || item.type === 'shield' || item.isShield || equipWeapon,
            ...normalizeItem(item),
        };
    });
}
