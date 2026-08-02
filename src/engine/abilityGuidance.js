/**
 * Ability-score recommendations for character creation.
 *
 * Which ability a class actually cares about is invisible to a player who has
 * never played 5e, and the choice is permanent-ish (ASIs only come at level 4+).
 * `CLASSES[x].abilityGuidance` declares the class's own priority order; this
 * module pairs that order with the standard array so the creation screen can
 * show "put your 15 here, and here's why".
 *
 * Advice only — nothing here constrains what the player may assign.
 */

import { CLASSES } from '../data/classes.js';
import { ABILITY_NAMES, STANDARD_ARRAY } from './characterUtils.js';

/**
 * Recommended ability priority + per-ability reasons for a class.
 * Fighter's advice depends on the fighting style chosen a step earlier.
 * @param {string} charClass - Class key ('fighter', 'wizard', ...)
 * @param {object} [options]
 * @param {string} [options.fightingStyle] - Chosen Fighter fighting style
 * @returns {{priority: string[], notes: Record<string, string>, recommended: Record<string, number>}|null}
 */
export function getAbilityGuidance(charClass, { fightingStyle } = {}) {
    const guidance = CLASSES[charClass]?.abilityGuidance;
    if (!guidance) return null;

    const override = fightingStyle ? guidance.byFightingStyle?.[fightingStyle] : null;
    const priority = normalizePriority(override?.priority || guidance.priority);
    const notes = { ...guidance.notes, ...(override?.notes || {}) };

    // The standard array, best value to the highest-priority ability.
    const recommended = {};
    priority.forEach((ability, index) => {
        if (index < STANDARD_ARRAY.length) recommended[ability] = STANDARD_ARRAY[index];
    });

    return { priority, notes, recommended };
}

/**
 * Guard against a malformed/partial priority list in the data: keep known
 * abilities in declared order, drop duplicates, append anything missing so the
 * result always covers all six.
 */
function normalizePriority(priority) {
    const ordered = [];
    for (const ability of Array.isArray(priority) ? priority : []) {
        if (ABILITY_NAMES.includes(ability) && !ordered.includes(ability)) ordered.push(ability);
    }
    for (const ability of ABILITY_NAMES) {
        if (!ordered.includes(ability)) ordered.push(ability);
    }
    return ordered;
}
