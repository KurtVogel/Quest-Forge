/**
 * Character creation utilities and helpers.
 */
import { getModifier, getProficiencyBonus, getMaxHitPoints, getArmorClass } from './rules.js';
import { RACES } from '../data/races.js';
import { CLASSES } from '../data/classes.js';

/**
 * Standard array for ability score assignment.
 */
export const STANDARD_ARRAY = [15, 14, 13, 12, 10, 8];

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
export function createCharacter(name, raceName, className, abilityScores, chosenSkills = []) {
    const race = RACES[raceName];
    const charClass = CLASSES[className];

    if (!race || !charClass) {
        throw new Error(`Invalid race "${raceName}" or class "${className}"`);
    }

    const adjustedScores = applyRacialBonuses(abilityScores, raceName);
    const conMod = getModifier(adjustedScores.constitution);
    const dexMod = getModifier(adjustedScores.dexterity);
    const maxHP = getMaxHitPoints(className, 1, conMod, charClass);

    // Merge racial skill proficiencies with player-chosen skills (deduplicated)
    const racialSkills = race.skillProficiencies || [];
    const allSkills = [...new Set([...racialSkills, ...chosenSkills])];

    return {
        id: `char-${Date.now()}`,
        name,
        race: raceName,
        class: className,
        level: 1,
        experience: 0,
        abilityScores: adjustedScores,
        maxHP,
        currentHP: maxHP,
        tempHP: 0,
        armorClass: getArmorClass(dexMod),
        proficiencyBonus: getProficiencyBonus(1),
        skillProficiencies: allSkills,
        expertiseSkills: [], // Rogues pick these at level 1 (future UI)
        savingThrowProficiencies: [...(charClass.savingThrows || [])],
        speed: race.speed || 30,
        traits: [...(race.traits || [])],
        features: [...(charClass.features?.['1'] || [])],
        classResources: buildClassResources(className, 1),
        hitDice: { total: 1, remaining: 1, die: charClass.hitDie },
        conditions: [],
        notes: '',
        createdAt: Date.now(),
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
