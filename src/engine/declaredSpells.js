/**
 * Declared-spell reconciliation for combat intent (2026-08-07, live playtest #4).
 *
 * The player owns their character's action declaration, but the DM's JSON-only
 * intent translation adapts it silently: "I cast Guiding Bolt" (not in this
 * game's 29-spell catalog) came back as a Sacred Flame cast with no indication,
 * and a declared Healing Word (level 2 here — uncastable at cleric 1) was
 * dropped without a word. The mechanics were legal; the silence was the bug.
 *
 * This engine backstop runs on the intent BEFORE the exchange is planned:
 *  - a castable catalog spell the player named by name is honored — if the DM's
 *    cast slot picked a different spell, the slot is rewritten to the declared
 *    one (the engine still validates and rolls everything downstream);
 *  - a named catalog spell the hero cannot cast yet (or at all) produces a
 *    visible table note explaining why it was not cast;
 *  - a cast request that names no catalog spell at all produces a note naming
 *    what the DM adapted it into.
 * Pure function: returns a new exchange (never mutates the stored intent) plus
 * the notes to surface as system lines.
 */

import { SPELL_LIST } from '../data/spells.js';
import { getKnownSpells, getMaxSpellLevel, isSpellcaster } from './spellcasting.js';

/** Smallest class level whose slot table reaches the spell's level (1..20, or null). */
function minLevelToCast(spell) {
    for (let level = 1; level <= 20; level++) {
        if (getMaxSpellLevel(level) >= spell.level) return level;
    }
    return null;
}

function nameMentioned(text, spellName) {
    const escaped = spellName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`\\b${escaped}\\b`, 'i').test(text);
}

/**
 * @param {string} playerMessage - the player's combat action declaration
 * @param {object} exchange - normalized combat_exchange intent from the DM
 * @param {object} character - live hero
 * @returns {{ exchange: object, notes: string[] }}
 */
export function reconcileDeclaredSpells(playerMessage, exchange, character) {
    const message = String(playerMessage || '');
    const result = { exchange, notes: [] };
    if (!message || !exchange || !Array.isArray(exchange.playerSlots)) return result;
    const castSlots = exchange.playerSlots.filter(slot => slot?.action === 'cast');
    // Only a turn that is actually about casting gets reconciled — a stray spell
    // name in flavor text ("no Healing Word can fix this town") must not nag.
    if (castSlots.length === 0) return result;

    const mentioned = SPELL_LIST.filter(spell => nameMentioned(message, spell.name));
    const knownKeys = new Set(getKnownSpells(character).map(spell => spell.key));

    for (const spell of mentioned) {
        if (knownKeys.has(spell.key)) continue;
        if (isSpellcaster(character?.class) && spell.classes.includes(character.class)) {
            const atLevel = minLevelToCast(spell);
            result.notes.push(`${spell.name} is a level ${spell.level} spell in this game — out of reach until ${character.class} level ${atLevel}; it was not cast.`);
        } else {
            result.notes.push(`${spell.name} is not a spell your class can cast in this game; it was not cast.`);
        }
    }

    if (castSlots.length !== 1) return result;
    const slot = castSlots[0];
    const castable = mentioned.filter(spell => knownKeys.has(spell.key));

    if (mentioned.length === 0 && slot.spell) {
        // Named magic entirely outside the catalog ("Guiding Bolt"): the DM's
        // adaptation stands — the player just gets told it happened.
        result.notes.push(`Resolved as ${slot.spell} — the magic you described isn't a distinct spell in this game's catalog.`);
        return result;
    }

    // Honor an unambiguous declared, castable, action-time spell over the DM's
    // substitute. Two named castable action spells = the player left the choice
    // open; the DM's pick stands.
    const actionCastable = castable.filter(spell => spell.castTime !== 'bonus');
    const slotSpell = String(slot.spell || '').toLowerCase();
    const slotMatchesDeclared = castable.some(spell => {
        const name = spell.name.toLowerCase();
        return slotSpell === name || slotSpell.includes(name) || name.includes(slotSpell);
    });
    if (actionCastable.length === 1 && slotSpell && !slotMatchesDeclared) {
        const declared = actionCastable[0];
        result.exchange = {
            ...exchange,
            playerSlots: exchange.playerSlots.map(candidate => (
                candidate === slot
                    ? { ...candidate, spell: declared.name, slotLevel: null }
                    : candidate
            )),
        };
        result.notes.push(`Cast adjusted to your declared ${declared.name}.`);
    }
    return result;
}
