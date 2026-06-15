/**
 * Character vault: hero export/import files and the local character roster's
 * data shape. A vault entry is a HERO (character + inventory), not a campaign —
 * the save system owns campaigns.
 *
 * Import is untrusted input (a hand-editable JSON file), so identity fields are
 * validated and clamped, and every derived field is rebuilt from race/class data
 * instead of trusted — the same "engine owns the math" rule applied to the DM.
 */
import { RACES } from '../data/races.js';
import { CLASSES } from '../data/classes.js';
import { normalizeItem } from '../data/items.js';
import { getModifier, getProficiencyBonus } from './rules.js';
import { ABILITY_NAMES, SKILL_LABELS, buildClassResources, getAllFeaturesUpToLevel } from './characterUtils.js';
import { getExperienceThreshold, MAX_CHARACTER_LEVEL } from './progression.js';

export const EXPORT_FORMAT = 'quest-forge-character';
export const EXPORT_VERSION = 1;

const MAX_COIN = 1_000_000;
const MAX_INVENTORY_ITEMS = 200;
const MAX_APPEARANCE_LENGTH = 2000;
const MAX_PORTRAIT_URL_LENGTH = 2_500_000;

/** Clamp to an integer in [min, max]; non-numeric input yields `fallback`. */
function clampInt(value, min, max, fallback) {
    const n = Number(value);
    if (!Number.isFinite(n)) return fallback;
    return Math.max(min, Math.min(max, Math.trunc(n)));
}

function sanitizeImageUrl(value) {
    const s = String(value || '').trim();
    if (!s || s.length > MAX_PORTRAIT_URL_LENGTH) return '';
    if (/^https:\/\/image\.pollinations\.ai\/prompt\//i.test(s)) return s;
    if (/^data:image\/(png|jpe?g|webp|gif);base64,[a-z0-9+/=]+$/i.test(s)) return s;
    return '';
}

export function buildCharacterExport(character, inventory) {
    return {
        format: EXPORT_FORMAT,
        version: EXPORT_VERSION,
        exportedAt: Date.now(),
        character,
        inventory: inventory || [],
    };
}

export function characterExportFilename(character) {
    const slug = String(character?.name || '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');
    return `questforge-${slug || 'hero'}.json`;
}

/** Trigger a browser download of a hero as a versioned JSON file. */
export function downloadCharacterExport(character, inventory) {
    const data = buildCharacterExport(character, inventory);
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = characterExportFilename(character);
    link.click();
    URL.revokeObjectURL(url);
}

/**
 * Validate and rebuild a character from untrusted data. Returns a clean,
 * rested hero (full HP, no conditions, fresh resources) ready for a new
 * adventure. Throws an Error with a player-readable message when the data
 * can't be salvaged.
 *
 * Trusted-with-clamps: name, level, exp, ability scores, coin, maxHP (rolled
 * per level, so it can only be range-checked). Rebuilt outright: proficiency,
 * saves, speed, traits, features, class resources, hit dice.
 */
export function sanitizeCharacter(raw) {
    if (!raw || typeof raw !== 'object') {
        throw new Error('No character data found in this file.');
    }

    const name = String(raw.name || '').trim().slice(0, 30);
    if (!name) throw new Error('This character has no name.');

    const race = RACES[raw.race];
    const charClass = CLASSES[raw.class];
    if (!race) throw new Error(`Unknown race "${raw.race}" — this hero may come from an older version of the game.`);
    if (!charClass) throw new Error(`Unknown class "${raw.class}" — this hero may come from an older version of the game.`);

    const abilityScores = {};
    for (const ability of ABILITY_NAMES) {
        const score = clampInt(raw.abilityScores?.[ability], 1, 30, null);
        if (score === null) throw new Error(`Missing ability score: ${ability}.`);
        abilityScores[ability] = score;
    }

    const level = clampInt(raw.level, 1, MAX_CHARACTER_LEVEL, 1);
    const exp = clampInt(raw.exp, 0, getExperienceThreshold(level) - 1, 0);

    // maxHP is rolled on level-up and can't be recomputed — clamp to the range
    // actually reachable: L1 is fixed at hitDie+CON, later levels gain 1..(hitDie+CON).
    const conMod = getModifier(abilityScores.constitution);
    const perLevelMax = Math.max(1, charClass.hitDie + conMod);
    const minPossibleHP = perLevelMax + (level - 1);
    const maxPossibleHP = perLevelMax * level;
    const maxHP = clampInt(raw.maxHP, minPossibleHP, maxPossibleHP, minPossibleHP);

    const knownSkills = new Set(Object.keys(SKILL_LABELS));
    const skillProficiencies = [...new Set([
        ...(race.skillProficiencies || []),
        ...(Array.isArray(raw.skillProficiencies) ? raw.skillProficiencies : []),
    ])].filter(s => knownSkills.has(s));
    const expertiseSkills = (Array.isArray(raw.expertiseSkills) ? raw.expertiseSkills : [])
        .filter(s => skillProficiencies.includes(s));

    return {
        id: `char-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        name,
        race: raw.race,
        class: raw.class,
        level,
        exp,
        gold: clampInt(raw.gold, 0, MAX_COIN, 0),
        silver: clampInt(raw.silver, 0, MAX_COIN, 0),
        copper: clampInt(raw.copper, 0, MAX_COIN, 0),
        abilityScores,
        maxHP,
        currentHP: maxHP,
        tempHP: 0,
        proficiencyBonus: getProficiencyBonus(level),
        skillProficiencies,
        expertiseSkills,
        savingThrowProficiencies: [...(charClass.savingThrows || [])],
        speed: race.speed || 30,
        traits: [...(race.traits || [])],
        features: getAllFeaturesUpToLevel(raw.class, level),
        classResources: buildClassResources(raw.class, level),
        hitDice: { total: level, remaining: level, die: charClass.hitDie },
        conditions: [],
        appearance: String(raw.appearance || '').trim().slice(0, MAX_APPEARANCE_LENGTH),
        portraitUrl: sanitizeImageUrl(raw.portraitUrl),
        portraitPrompt: String(raw.portraitPrompt || '').trim().slice(0, MAX_APPEARANCE_LENGTH),
        portraitUpdatedAt: Number.isFinite(raw.portraitUpdatedAt) ? raw.portraitUpdatedAt : null,
        notes: String(raw.notes || '').slice(0, 2000),
        createdAt: Number.isFinite(raw.createdAt) ? raw.createdAt : Date.now(),
    };
}

/**
 * Sanitize an untrusted inventory list. Every item goes through normalizeItem
 * (which clamps magicBonus and fills catalog data); equip flags are limited to
 * one weapon, one armor, and one shield so AC/attack math stays unambiguous.
 */
export function sanitizeInventory(rawInventory) {
    if (!Array.isArray(rawInventory)) return [];
    const equippedSlots = new Set();
    return rawInventory
        .slice(0, MAX_INVENTORY_ITEMS)
        .filter(item => item && (typeof item === 'object' || typeof item === 'string'))
        .map((item, index) => {
            const normalized = normalizeItem(item);
            const slot = normalized.type === 'weapon' ? 'weapon'
                : normalized.type === 'armor' ? 'armor'
                    : (normalized.type === 'shield' || normalized.isShield) ? 'shield'
                        : null;
            const wantsEquip = typeof item === 'object' && item.equipped === true;
            const equipped = wantsEquip && (!slot || !equippedSlots.has(slot));
            if (equipped && slot) equippedSlots.add(slot);
            return {
                ...normalized,
                id: `item-${Date.now()}-${index}-${Math.random().toString(36).slice(2, 7)}`,
                equipped,
            };
        });
}

/**
 * Parse the text of a character export file into a sanitized hero.
 * Throws an Error with a player-readable message on any problem.
 */
export function parseCharacterExport(jsonText) {
    let data;
    try {
        data = JSON.parse(jsonText);
    } catch {
        throw new Error('Not a valid JSON file.');
    }
    if (!data || typeof data !== 'object' || data.format !== EXPORT_FORMAT) {
        throw new Error('Not a Quest Forge character file.');
    }
    if (data.version !== EXPORT_VERSION) {
        throw new Error(`Unsupported character file version (${data.version}) — this build reads version ${EXPORT_VERSION}.`);
    }
    return {
        character: sanitizeCharacter(data.character),
        inventory: sanitizeInventory(data.inventory),
    };
}
