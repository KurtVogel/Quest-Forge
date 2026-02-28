/**
 * Roll Resolver — processes dice roll requests from the LLM.
 * Extracted from ChatPanel to keep the component focused on UI.
 *
 * Handles player skill checks, NPC attacks, damage rolls, and
 * auto-triggers follow-up LLM calls so the DM narrates the outcome.
 */

import { rollWithModifier, rollNotation } from './dice.js';
import { getSkillModifier, getModifier, getProficiencyBonus, SKILL_ABILITIES } from './rules.js';

/** Maximum depth for recursive follow-up roll handling. */
const MAX_ROLL_DEPTH = 3;

const ABILITY_NAMES = ['strength', 'dexterity', 'constitution', 'intelligence', 'wisdom', 'charisma'];

/**
 * Process all requested rolls and return structured results.
 * @param {Array} requestedRolls - Roll requests from the LLM
 * @param {object} character - Current character state
 * @param {function} dispatch - Game state dispatch
 * @returns {Array} Roll result summaries
 */
export function resolveRolls(requestedRolls, character, dispatch) {
    const rollResults = [];

    for (const roll of requestedRolls) {
        const isNpcRoll = roll.type === 'npc_attack' || roll.type === 'npc_save';

        if (isNpcRoll) {
            const result = resolveNpcRoll(roll, character, dispatch);
            if (result) rollResults.push(result);
        } else if (roll.type === 'damage_roll') {
            const result = resolveDamageRoll(roll, dispatch);
            if (result) rollResults.push(result);
        } else if (roll.skill && character) {
            const result = resolvePlayerRoll(roll, character, dispatch);
            if (result) rollResults.push(result);
        }
    }

    return rollResults;
}

/**
 * Format roll results into a summary string for the LLM follow-up.
 * @param {Array} rollResults - Resolved roll results
 * @returns {string} Formatted summary
 */
export function formatRollSummary(rollResults) {
    return rollResults.map(r => {
        if (r.type === 'npc_attack' || r.type === 'npc_save') {
            return `[ROLL RESULT: ${r.description || r.attacker + ' attack'}, vs AC ${r.dc}, rolled ${r.rolled} — ${r.success ? 'HIT' : 'MISS'}]`;
        }
        if (r.type === 'damage_roll') {
            return `[ROLL RESULT: ${r.description || 'Damage roll'}, ${r.notation}, total damage: ${r.rolled}]`;
        }
        return `[ROLL RESULT: ${r.description || r.skill + ' check'}, DC ${r.dc}, rolled ${r.rolled} — ${r.success ? 'SUCCESS' : 'FAILURE'}]`;
    }).join('\n');
}

/**
 * Handle the full roll → follow-up → recursive roll cycle with depth limiting.
 * @param {Array} requestedRolls - Initial roll requests
 * @param {object} options - Configuration
 * @param {function} options.getState - Returns current game state
 * @param {function} options.dispatch - Game state dispatch
 * @param {function} options.sendToLLM - Function to send follow-up to LLM
 * @param {number} [depth=0] - Current recursion depth (internal)
 * @returns {Promise<void>}
 */
export async function handleRequestedRolls(requestedRolls, { getState, dispatch, sendToLLM, preNarrated = false }, depth = 0) {
    if (depth >= MAX_ROLL_DEPTH) {
        console.warn(`[RollResolver] ⚠️ Max roll depth (${MAX_ROLL_DEPTH}) reached — stopping recursive follow-ups.`);
        dispatch({
            type: 'ADD_MESSAGE',
            payload: {
                role: 'system',
                content: `⚠️ Roll chain limit reached (${MAX_ROLL_DEPTH} levels). The DM will continue from here on your next message.`,
            },
        });
        return;
    }

    const state = getState();
    const character = state.character;

    console.log(`[RollResolver] 🎲 Processing ${requestedRolls.length} roll(s) at depth ${depth}`);

    const rollResults = resolveRolls(requestedRolls, character, dispatch);

    // Auto follow-up: send roll results back to DM and get outcome narration
    if (rollResults.length > 0) {
        const summary = formatRollSummary(rollResults);

        // Add as a hidden system message for context
        dispatch({
            type: 'ADD_MESSAGE',
            payload: { role: 'system', content: summary, hidden: true },
        });

        // Auto-trigger follow-up: DM narrates the outcome
        console.log(`[RollResolver] 🔄 Auto-triggering follow-up LLM call (depth ${depth}) with roll results`);

        try {
            const correctionNote = (depth === 0 && preNarrated)
                ? `\n\n[IMPORTANT: Your previous response pre-narrated an outcome before seeing these dice results. The roll result above is the authoritative truth. Narrate the TRUE outcome based solely on these dice — completely discard any outcome you wrote before seeing the roll.]`
                : '';

            const followUpEvents = await sendToLLM(
                `[SYSTEM: Dice rolled. Results below. RULES: (1) Narrate the outcome based EXACTLY on these results — do not override, soften, or ignore them. A roll of 3 vs DC 15 is a failure, narrate it as such. (2) Do NOT re-request the same rolls. (3) If an attack hit, request a damage roll via JSON before narrating the damage amount. (4) If enemies or NPCs retaliate or act, request their attack/action rolls via JSON. (5) Never narrate NPC or enemy outcomes without rolling first.]${correctionNote}\n\n${summary}`
            );

            // Handle any follow-up rolls (e.g. DM requests damage rolls after a hit)
            if (followUpEvents?.requestedRolls?.length > 0) {
                await handleRequestedRolls(
                    followUpEvents.requestedRolls,
                    { getState, dispatch, sendToLLM },
                    depth + 1
                );
            }
        } catch (e) {
            console.warn('[RollResolver] Follow-up narration failed:', e);
        }
    }
}

// --- Internal Resolution Functions ---

/**
 * Roll a d20 with advantage, disadvantage, or plain — returns a rollWithModifier result
 * extended with an `advantageDetail` string for display.
 */
function rollWithAdvantage(count, sides, modifier, description, advantage, disadvantage) {
    if ((advantage || disadvantage) && count === 1 && sides === 20) {
        const r1 = rollWithModifier(1, 20, modifier, description);
        const r2 = rollWithModifier(1, 20, modifier, description);
        const useFirst = advantage ? r1.rolls[0] >= r2.rolls[0] : r1.rolls[0] <= r2.rolls[0];
        const kept = useFirst ? r1 : r2;
        kept.advantageDetail = ` (d20: ${r1.rolls[0]}, ${r2.rolls[0]} → kept ${kept.rolls[0]})`;
        return kept;
    }
    const result = rollWithModifier(count, sides, modifier, description);
    result.advantageDetail = '';
    return result;
}

function resolveNpcRoll(roll, character, dispatch) {
    const npcMod = roll.modifier ?? Math.floor(Math.random() * 3) + 2;
    const result = rollWithAdvantage(1, 20, npcMod, roll.description || `${roll.attacker || 'Enemy'} attack`, roll.advantage, roll.disadvantage);
    dispatch({ type: 'ADD_ROLL', payload: result });

    const dc = character?.armorClass || roll.dc || 12;
    const success = result.total >= dc;
    const label = roll.attacker ? `${roll.attacker}'s attack` : 'NPC attack';
    const advLabel = roll.advantage ? ' *(advantage)*' : roll.disadvantage ? ' *(disadvantage)*' : '';
    const rollMsg = `🎲 **${roll.description || label}**${advLabel} (vs AC ${dc}): Rolled **${result.total}**${result.advantageDetail} — ${success ? '💥 **Hit!**' : '🛡️ **Miss!**'}${result.isCritical ? ' 🌟 Natural 20!' : ''}${result.isCritFail ? ' 💀 Natural 1!' : ''}`;

    dispatch({
        type: 'ADD_MESSAGE',
        payload: { role: 'system', content: rollMsg },
    });

    return {
        type: roll.type,
        attacker: roll.attacker || 'Enemy',
        dc,
        rolled: result.total,
        success,
        description: roll.description,
    };
}

function resolveDamageRoll(roll, dispatch) {
    try {
        const result = rollNotation(roll.notation || '1d4', roll.description || 'Damage Roll');
        dispatch({ type: 'ADD_ROLL', payload: result });

        const rollMsg = `🎲 **${result.description}** (${roll.notation}): Rolled **${result.total}** (dice: ${result.rolls.join(', ')}${result.modifier ? `, modifier: ${result.modifier >= 0 ? '+' : ''}${result.modifier}` : ''})`;

        dispatch({
            type: 'ADD_MESSAGE',
            payload: { role: 'system', content: rollMsg },
        });

        return {
            type: 'damage_roll',
            notation: roll.notation,
            rolled: result.total,
            description: result.description,
            success: true,
        };
    } catch (e) {
        console.error('[RollResolver] Error parsing damage roll notation:', e);
        return null;
    }
}

function resolvePlayerRoll(roll, character, dispatch) {
    const skillName = roll.skill.toLowerCase();

    const ability = SKILL_ABILITIES[skillName];
    const isAbilityName = ABILITY_NAMES.includes(skillName);
    const isAttackRoll = roll.type === 'attack_roll';

    let mod = 0;
    let label = roll.description || `${skillName} check`;

    if (ability) {
        mod = getSkillModifier(character, skillName);
    } else if (isAbilityName) {
        const abilityMod = getModifier(character.abilityScores[skillName]);
        if (isAttackRoll) {
            mod = abilityMod + getProficiencyBonus(character.level);
            label = roll.description || `${skillName} attack`;
        } else {
            mod = abilityMod;
        }
    } else if (skillName === 'attack') {
        const strMod = getModifier(character.abilityScores.strength);
        const dexMod = getModifier(character.abilityScores.dexterity);
        mod = Math.max(strMod, dexMod) + getProficiencyBonus(character.level);
        label = roll.description || 'Attack roll';
    } else {
        console.warn('[RollResolver] Unknown skill/ability:', skillName, '— rolling plain d20');
        mod = 0;
        label = roll.description || `${skillName} check`;
    }

    const result = rollWithAdvantage(1, 20, mod, label, roll.advantage, roll.disadvantage);
    dispatch({ type: 'ADD_ROLL', payload: result });

    const success = result.total >= (roll.dc || 15);
    const advLabel = roll.advantage ? ' *(advantage)*' : roll.disadvantage ? ' *(disadvantage)*' : '';
    const rollMsg = `🎲 **${label}**${advLabel} (DC ${roll.dc}): Rolled **${result.total}**${result.advantageDetail} — ${success ? '✅ **Success!**' : '❌ **Failure!**'}${result.isCritical ? ' 🌟 Natural 20!' : ''}${result.isCritFail ? ' 💀 Natural 1!' : ''}`;

    dispatch({
        type: 'ADD_MESSAGE',
        payload: { role: 'system', content: rollMsg },
    });

    return {
        type: roll.type || 'skill_check',
        skill: roll.skill,
        dc: roll.dc,
        rolled: result.total,
        success,
        description: roll.description,
    };
}
