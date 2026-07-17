/**
 * Spell slots, casting math, and spell-effect notation building.
 *
 * The engine owns everything numeric here: slot bookkeeping, save DCs, attack
 * bonuses, cantrip scaling, and upcast dice. The DM only ever names a spell,
 * its targets, and optionally a slot level — never dice or outcomes.
 */
import { CLASSES } from '../data/classes.js';
import { findSpell, SPELL_LIST } from '../data/spells.js';
import { getModifier, getProficiencyBonus } from './rules.js';

export const MAX_SPELL_LEVEL = 5;

export function isSpellcaster(className) {
    return className === 'wizard' || className === 'cleric';
}

export function getCastingAbility(className) {
    return CLASSES[className]?.primaryAbility || 'intelligence';
}

/**
 * Slots per spell level for a character level. Real 5e numbers for levels 1-10;
 * frozen afterward because RAW growth beyond 10 only feeds the 6th-9th level
 * slots this game deliberately cuts (rpg-balance-master spec 2026-07-17).
 */
export function getSpellSlotTable(level) {
    const l = Math.max(1, Math.min(20, Math.trunc(level || 1)));
    if (l === 1) return { 1: 2 };
    if (l === 2) return { 1: 3 };
    if (l === 3) return { 1: 4, 2: 2 };
    if (l === 4) return { 1: 4, 2: 3 };
    if (l === 5) return { 1: 4, 2: 3, 3: 2 };
    if (l === 6) return { 1: 4, 2: 3, 3: 3 };
    if (l === 7) return { 1: 4, 2: 3, 3: 3, 4: 1 };
    if (l === 8) return { 1: 4, 2: 3, 3: 3, 4: 2 };
    if (l === 9) return { 1: 4, 2: 3, 3: 3, 4: 3, 5: 1 };
    return { 1: 4, 2: 3, 3: 3, 4: 3, 5: 2 };
}

export function getMaxSpellLevel(level) {
    return Math.max(...Object.keys(getSpellSlotTable(level)).map(Number));
}

/**
 * Build the per-level slot state for a character level. When `previous` is
 * given (level-up, save load), spent slots carry over clamped to the new max —
 * gaining a level never silently refills the day's magic.
 */
export function buildSpellSlots(level, previous = null) {
    const table = getSpellSlotTable(level);
    const slots = {};
    for (const [lvl, max] of Object.entries(table)) {
        const prevUsed = previous?.[lvl]?.used;
        slots[lvl] = {
            used: Number.isFinite(prevUsed) ? Math.max(0, Math.min(max, Math.trunc(prevUsed))) : 0,
            max,
        };
    }
    return slots;
}

/** Sanitize a loaded/LLM-supplied slot state against the authoritative table. */
export function sanitizeSpellSlots(level, value) {
    return buildSpellSlots(level, value && typeof value === 'object' ? value : null);
}

export function getSpellSaveDC(character) {
    const ability = getCastingAbility(character?.class);
    return 8 + getProficiencyBonus(character?.level || 1) + getModifier(character?.abilityScores?.[ability] || 10);
}

export function getSpellAttackBonus(character) {
    const ability = getCastingAbility(character?.class);
    return getProficiencyBonus(character?.level || 1) + getModifier(character?.abilityScores?.[ability] || 10);
}

/** All catalog spells this character can know at their level (slots permitting). */
export function getKnownSpells(character) {
    if (!isSpellcaster(character?.class)) return [];
    const maxLevel = getMaxSpellLevel(character.level || 1);
    return SPELL_LIST.filter(spell =>
        spell.classes.includes(character.class) && spell.level <= maxLevel);
}

/** Resolve a DM/player spell reference for this character, or null. */
export function resolveSpellForCharacter(character, ref) {
    const spell = findSpell(ref);
    if (!spell || !isSpellcaster(character?.class)) return null;
    if (!spell.classes.includes(character.class)) return null;
    if (spell.level > getMaxSpellLevel(character.level || 1)) return null;
    return spell;
}

/**
 * Pick the slot level a cast consumes: the requested level when it is legal
 * and available, otherwise the lowest available slot at or above the spell's
 * base level. Cantrips return 0. Returns null when no slot can pay for it.
 */
export function chooseSlotLevel(spellSlots, spell, requestedLevel = null) {
    if (!spell) return null;
    if (spell.level === 0) return 0;
    const available = lvl => {
        const slot = spellSlots?.[lvl];
        return slot && (slot.max - slot.used) > 0;
    };
    const requested = Number.isFinite(requestedLevel) ? Math.trunc(requestedLevel) : null;
    if (requested !== null && requested >= spell.level && requested <= MAX_SPELL_LEVEL && available(requested)) {
        return requested;
    }
    for (let lvl = spell.level; lvl <= MAX_SPELL_LEVEL; lvl++) {
        if (available(lvl)) return lvl;
    }
    return null;
}

export function spendSpellSlot(spellSlots, slotLevel) {
    if (!slotLevel || !spellSlots?.[slotLevel]) return spellSlots;
    const slot = spellSlots[slotLevel];
    return {
        ...spellSlots,
        [slotLevel]: { ...slot, used: Math.min(slot.max, slot.used + 1) },
    };
}

/** Cantrip dice count at a character level: 1/2/3/4 at 1/5/11/17 (5e RAW). */
export function cantripDiceCount(level) {
    const l = level || 1;
    return l >= 17 ? 4 : l >= 11 ? 3 : l >= 5 ? 2 : 1;
}

function parseDiceBlock(dice) {
    const m = String(dice || '').replace(/\s+/g, '').match(/^(\d{1,2})d(\d{1,3})([+-]\d{1,3})?$/i);
    if (!m) return { count: 1, sides: 4, modifier: 0 };
    return { count: parseInt(m[1], 10), sides: parseInt(m[2], 10), modifier: m[3] ? parseInt(m[3], 10) : 0 };
}

function buildNotation(block, character, spell, slotLevel) {
    const parsed = parseDiceBlock(block.dice);
    let count = parsed.count;
    if (block.cantripScaling) {
        count = cantripDiceCount(character?.level);
    } else if (block.upcastPerLevel && slotLevel > spell.level) {
        count += block.upcastPerLevel * (slotLevel - spell.level);
    }
    let modifier = parsed.modifier;
    if (block.addAbilityMod) {
        modifier += getModifier(character?.abilityScores?.[getCastingAbility(character?.class)] || 10);
    }
    return `${count}d${parsed.sides}${modifier ? (modifier > 0 ? `+${modifier}` : `${modifier}`) : ''}`;
}

/** Final damage notation for a cast (cantrip scaling / upcast / ability mod applied). */
export function spellDamageNotation(spell, character, slotLevel) {
    return spell?.damage ? buildNotation(spell.damage, character, spell, slotLevel) : null;
}

/** Final healing notation for a cast. */
export function spellHealingNotation(spell, character, slotLevel) {
    return spell?.healing ? buildNotation(spell.healing, character, spell, slotLevel) : null;
}

/**
 * Wizard Arcane Recovery: once per long-rest cycle, a short rest restores
 * spent slots worth `ceil(level / 2)` slot-levels, best (≤3rd) slots first.
 */
export function applyArcaneRecovery(spellSlots, level) {
    let budget = Math.ceil((level || 1) / 2);
    const next = { ...spellSlots };
    let recovered = 0;
    for (const lvl of [3, 2, 1]) {
        while (budget >= lvl && next[lvl] && next[lvl].used > 0) {
            next[lvl] = { ...next[lvl], used: next[lvl].used - 1 };
            budget -= lvl;
            recovered += lvl;
        }
    }
    return { spellSlots: next, recovered };
}

/** Fully refill every slot level (long rest). */
export function refillSpellSlots(spellSlots) {
    if (!spellSlots) return spellSlots;
    const next = {};
    for (const [lvl, slot] of Object.entries(spellSlots)) {
        next[lvl] = { ...slot, used: 0 };
    }
    return next;
}

/** "L1 2/4 · L2 3/3" — remaining/max per level, for prompts and system lines. */
export function summarizeSpellSlots(spellSlots) {
    if (!spellSlots) return '';
    return Object.entries(spellSlots)
        .map(([lvl, slot]) => `L${lvl} ${Math.max(0, slot.max - slot.used)}/${slot.max}`)
        .join(' · ');
}

/** Compact spell catalog + slot state block for the DM prompt's character section. */
export function describeSpellcastingForPrompt(character) {
    if (!isSpellcaster(character?.class) || !character.spellSlots) return '';
    const known = getKnownSpells(character);
    const lines = known.map(spell => {
        const cost = spell.level === 0 ? 'cantrip, at will' : `level ${spell.level} slot`;
        const timing = spell.castTime === 'bonus' ? ', bonus action' : '';
        const scope = spell.combatAvailable && spell.outOfCombatAvailable
            ? ''
            : spell.combatAvailable ? ' [combat only]' : ' [out of combat only]';
        return `- ${spell.name} (${cost}${timing})${scope}: ${spell.summary}`;
    });
    return [
        `Spell slots remaining: ${summarizeSpellSlots(character.spellSlots)}. Spell save DC ${getSpellSaveDC(character)}, spell attack +${getSpellAttackBonus(character)}.`,
        ...lines,
    ].join('\n');
}
