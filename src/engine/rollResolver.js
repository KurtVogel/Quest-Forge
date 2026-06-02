/**
 * Roll Resolver — processes dice roll requests from the LLM.
 * Extracted from ChatPanel to keep the component focused on UI.
 *
 * Handles player skill checks, NPC attacks, damage rolls, and
 * auto-triggers follow-up LLM calls so the DM narrates the outcome.
 *
 * Combat (Phase 2 — batched rounds): when an attack carries an inline `damage`
 * notation and a `target`, the client rolls the attack AND (on a hit) the damage,
 * then applies HP itself against working copies. So a whole round resolves in ONE
 * pass, a foe slain earlier in the round can't swing back, the DM never does HP
 * math, and the follow-up narrates the exchange once. Attacks without inline
 * `target`/`damage` fall back to the original two-step flow (DM applies HP).
 */

import { rollWithModifier, rollNotation, parseNotation } from './dice.ts';
import { getSkillModifier, getModifier, getLevelBonus, computeACFromInventory, getWeaponAttackBonus, getWeaponDamageNotation, SKILL_ABILITIES } from './rules.js';

/** Maximum depth for recursive follow-up roll handling. */
const MAX_ROLL_DEPTH = 3;

const ABILITY_NAMES = ['strength', 'dexterity', 'constitution', 'intelligence', 'wisdom', 'charisma'];

/**
 * Resolve a batch of requested rolls.
 *
 * When attacks carry combat fields (`target` + `damage`), damage and HP are applied
 * client-side against working copies of enemy/companion/player HP, so a kill within the
 * same batch is honored (React state updates are async and can't be re-read mid-loop).
 *
 * @param {Array} requestedRolls
 * @param {object} ctx - { character, inventory, combat, party, dispatch }
 * @returns {{ results: Array, appliedHp: boolean }}
 */
export function resolveRolls(requestedRolls, { character, inventory, combat, party, dispatch }) {
    const enemies = combat?.enemies || [];
    const companions = party || [];

    // Working HP copies — mutated as the round resolves, flushed to state at the end.
    const enemyWork = new Map(enemies.map(e => [e.id, { ...e }]));
    const companionWork = new Map(companions.map(c => [c.id, { ...c }]));
    const playerStartHp = character?.currentHP ?? 0;
    let playerHp = playerStartHp;
    const playerMaxHp = character?.maxHP ?? playerStartHp;

    const matchByIdOrName = (work, ref) => {
        if (ref == null) return null;
        if (work.has(ref)) return work.get(ref);
        const lower = String(ref).toLowerCase();
        for (const v of work.values()) {
            if (v.name?.toLowerCase() === lower) return v;
        }
        return null;
    };
    const findEnemy = (ref) => matchByIdOrName(enemyWork, ref);
    const findCompanion = (ref) => matchByIdOrName(companionWork, ref);

    const results = [];
    let appliedHp = false;

    for (const roll of requestedRolls) {
        const isNpcRoll = roll.type === 'npc_attack' || roll.type === 'npc_save';

        if (isNpcRoll) {
            // A foe slain earlier in this same round does not get to act.
            const attacker = findEnemy(roll.attackerId || roll.attacker);
            if (attacker && attacker.hp <= 0) {
                results.push({ type: 'note', text: `${attacker.name} has fallen and does not act.` });
                continue;
            }

            // Resolve the to-hit vs the correct target's AC (companion AC if targeting one).
            let targetAC;
            if (roll.type === 'npc_attack' && roll.target && roll.target !== 'player' && roll.target !== 'self') {
                const comp = findCompanion(roll.target);
                if (comp) targetAC = comp.ac;
            }

            const result = resolveNpcRoll(roll, character, dispatch, inventory, targetAC);
            if (!result) continue;
            results.push(result);

            // Inline damage on a hit (npc_attack only — saves never deal weapon damage here).
            if (result.success && roll.type === 'npc_attack' && roll.damage) {
                const dmg = rollAndShowDamage(roll.damage, `${roll.attacker || 'Enemy'} damage`, dispatch, { crit: result.critical });
                const comp = (roll.target && roll.target !== 'player' && roll.target !== 'self')
                    ? findCompanion(roll.target)
                    : null;
                if (comp) {
                    comp.hp = Math.max(0, (comp.hp ?? 0) - dmg.total);
                    Object.assign(result, { damage: dmg.total, targetName: comp.name, targetHp: comp.hp, targetMaxHp: comp.maxHp });
                } else {
                    playerHp = Math.max(0, playerHp - dmg.total);
                    Object.assign(result, { damage: dmg.total, targetName: character?.name || 'you', targetHp: playerHp, targetMaxHp: playerMaxHp, targetIsPlayer: true });
                }
                appliedHp = true;
            }
        } else if (roll.type === 'damage_roll') {
            // Standalone damage roll (legacy two-step flow) — rolled, not auto-applied.
            const result = resolveDamageRoll(roll, character, dispatch);
            if (result) results.push(result);
        } else if (roll.skill && character) {
            const resolved = resolvePlayerRoll(roll, character, dispatch, inventory);
            const list = Array.isArray(resolved) ? resolved : (resolved ? [resolved] : []);
            const isAttack = roll.type === 'attack_roll' || String(roll.skill).toLowerCase() === 'attack';
            const damageNotation = isAttack
                ? getWeaponDamageNotation(character, inventory, roll.damage || '1d4')
                : roll.damage;

            for (const one of list) {
                results.push(one);
                // Inline damage for a player attack that hit and names an enemy target.
                if (one.success && isAttack && damageNotation && roll.target) {
                    const enemy = findEnemy(roll.target);
                    if (enemy) {
                        const dmg = rollAndShowDamage(damageNotation, `Damage to ${enemy.name}`, dispatch, { crit: one.critical, character });
                        enemy.hp = Math.max(0, (enemy.hp ?? 0) - dmg.total);
                        Object.assign(one, { damage: dmg.total, targetName: enemy.name, targetHp: enemy.hp, targetMaxHp: enemy.maxHp });
                        appliedHp = true;
                    }
                }
            }
        }
    }

    // Flush all HP changes to game state in one batch (only if the client applied any).
    if (appliedHp) {
        for (const e of enemies) {
            const w = enemyWork.get(e.id);
            if (w && w.hp !== e.hp) {
                dispatch({ type: 'UPDATE_ENEMY', payload: { id: e.id, hp: w.hp } });
            }
        }
        for (const c of companions) {
            const w = companionWork.get(c.id);
            if (w && w.hp !== c.hp) {
                dispatch({ type: 'UPDATE_COMPANION', payload: { id: c.id, hp: w.hp } });
            }
        }
        const playerDelta = playerStartHp - playerHp;
        if (playerDelta > 0) {
            dispatch({ type: 'TAKE_DAMAGE', payload: playerDelta });
        }
    }

    return { results, appliedHp };
}

/**
 * Format roll results into a summary string for the LLM follow-up.
 * @param {Array} rollResults - Resolved roll results
 * @returns {string} Formatted summary
 */
export function formatRollSummary(rollResults) {
    const hpApplied = '(HP applied by the system — do NOT adjust it via damage_taken/enemy_updates)';
    return rollResults.map(r => {
        if (r.type === 'note') {
            return `[${r.text}]`;
        }
        if (r.type === 'npc_save') {
            return `[ROLL RESULT: ${r.description || (r.attacker || 'NPC') + ' save'} vs DC ${r.dc}, rolled ${r.rolled} — ${r.success ? 'SUCCESS' : 'FAILURE'}]`;
        }
        if (r.type === 'npc_attack') {
            const head = `${r.description || (r.attacker || 'Enemy') + ' attack'} vs AC ${r.dc}, rolled ${r.rolled}`;
            if (!r.success) return `[ROLL RESULT: ${head} — MISS]`;
            if (r.damage != null) {
                const downed = r.targetHp <= 0 ? (r.targetIsPlayer ? ' — the player is DOWNED (0 HP)' : ` — ${r.targetName} is DOWNED`) : '';
                return `[ROLL RESULT: ${head} — HIT for ${r.damage} damage. ${r.targetName} now ${r.targetHp}/${r.targetMaxHp} HP${downed}. ${hpApplied}]`;
            }
            return `[ROLL RESULT: ${head} — HIT]`;
        }
        if (r.type === 'damage_roll') {
            return `[ROLL RESULT: ${r.description || 'Damage roll'}, ${r.notation}, total damage: ${r.rolled}]`;
        }
        if (r.type === 'initiative') {
            return `[ROLL RESULT: ${r.description || 'Initiative'}, rolled ${r.rolled}]`;
        }
        // Player attack_roll with inline damage already resolved.
        if (r.type === 'attack_roll' && r.success && r.damage != null) {
            const downed = r.targetHp <= 0 ? ` — ${r.targetName} is DOWNED` : '';
            return `[ROLL RESULT: ${r.description || 'Attack'} vs AC ${r.dc}, rolled ${r.rolled} — HIT for ${r.damage} damage. ${r.targetName} now ${r.targetHp}/${r.targetMaxHp} HP${downed}. ${hpApplied}]`;
        }
        // skill_check / saving_throw / plain attack_roll
        const isAttack = r.type === 'attack_roll';
        const verb = r.success ? (isAttack ? 'HIT' : 'SUCCESS') : (isAttack ? 'MISS' : 'FAILURE');
        const dcLabel = isAttack ? `vs AC ${r.dc}` : `DC ${r.dc}`;
        return `[ROLL RESULT: ${r.description || r.skill + ' check'}, ${dcLabel}, rolled ${r.rolled} — ${verb}]`;
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
    const inventory = state.inventory || [];

    console.log(`[RollResolver] 🎲 Processing ${requestedRolls.length} roll(s) at depth ${depth}`);

    const { results: rollResults, appliedHp } = resolveRolls(requestedRolls, {
        character,
        inventory,
        combat: state.combat,
        party: state.party,
        dispatch,
    });

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
            const correctionNote = preNarrated
                ? `\n\n[IMPORTANT: Your previous response pre-narrated an outcome before seeing these dice results. The roll result above is the authoritative truth. Narrate the TRUE outcome based solely on these dice — completely discard any outcome you wrote before seeing the roll.]`
                : '';

            const hpNote = appliedHp
                ? ` Damage and HP for these attacks have ALREADY been applied by the system — narrate the wounds, but do NOT output damage_taken, damage_dealt, or enemy_updates for them.`
                : '';

            const followUpEvents = await sendToLLM(
                `[SYSTEM: Dice rolled — results below. Narrate the outcome in ONE cohesive, vivid pass that reads naturally on its own. Weave in just enough of the action for context, but do NOT retell at length or repeat beats you have already narrated. RULES: (1) Respect the dice exactly — a roll below the DC is a failure. (2) Do NOT re-request these same rolls. (3) If a result already shows "HIT for N damage", the damage is done — do NOT request a damage roll for it.${hpNote} (4) If other enemies or NPCs still must act this round, request their rolls now via JSON — for each, include "attackerId", "target", "modifier", and an inline "damage" notation so the system resolves them in one pass. (5) Never narrate an NPC or enemy result without rolling first.]${correctionNote}\n\n${summary}`,
                undefined,
                { suppressHpEvents: appliedHp }
            );

            // Handle any follow-up rolls (e.g. the next foe acting, or a triggered save)
            if (followUpEvents?.requestedRolls?.length > 0) {
                await handleRequestedRolls(
                    followUpEvents.requestedRolls,
                    { getState, dispatch, sendToLLM, preNarrated: followUpEvents._preNarratedOutcome || false },
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

/**
 * Roll a damage notation and surface it (ADD_ROLL + chat line). Doubles the dice on a
 * crit and adds the player's Fighter level bonus when a player `character` is supplied.
 * @returns {{ total: number }}
 */
function rollAndShowDamage(notation, label, dispatch, { crit = false, character = null } = {}) {
    let result;
    try {
        if (crit) {
            const { count, sides, modifier } = parseNotation(notation);
            result = rollWithModifier(count * 2, sides, modifier, label);
        } else {
            result = rollNotation(notation, label);
        }
    } catch (e) {
        console.error('[RollResolver] Bad damage notation:', notation, e);
        result = rollWithModifier(1, 4, 0, label); // safe fallback
    }

    const baseMod = result.modifier;
    const lvlBonus = character ? getLevelBonus(character) : 0;
    if (lvlBonus > 0) {
        result.total += lvlBonus;
        result.modifier += lvlBonus;
    }

    dispatch({ type: 'ADD_ROLL', payload: result });

    const critLabel = crit ? ' 🌟 *(crit — dice doubled)*' : '';
    const lvlLabel = lvlBonus > 0 ? `, level bonus: +${lvlBonus}` : '';
    dispatch({
        type: 'ADD_MESSAGE',
        payload: {
            role: 'system',
            content: `🎲 **${label}**${critLabel} (${notation}): **${result.total}** damage (dice: ${result.rolls.join(', ')}${baseMod ? `, mod: ${baseMod >= 0 ? '+' : ''}${baseMod}` : ''}${lvlLabel})`,
        },
    });

    return { total: result.total };
}

function resolveNpcRoll(roll, character, dispatch, inventory, targetAC) {
    const npcMod = roll.modifier ?? 0;
    const result = rollWithAdvantage(1, 20, npcMod, roll.description || `${roll.attacker || 'Enemy'} attack`, roll.advantage, roll.disadvantage);
    dispatch({ type: 'ADD_ROLL', payload: result });

    // Determine the DC to beat. Saves use the spell/ability DC; attacks use the target's AC.
    // For attacks on the PLAYER, always compute AC live from inventory — never trust the DM.
    let dc;
    if (roll.type === 'npc_save') {
        dc = roll.dc ?? 12;
    } else if (typeof targetAC === 'number') {
        dc = targetAC;
    } else {
        const liveAC = (character && inventory) ? computeACFromInventory(inventory, character) : null;
        dc = liveAC ?? character?.armorClass ?? roll.dc ?? 12;
        if (roll.dc && roll.dc !== dc) {
            console.warn(`[RollResolver] DM sent dc=${roll.dc} but real player AC is ${dc} — using real AC`);
        }
    }

    const success = result.total >= dc;
    const isSave = roll.type === 'npc_save';
    const label = roll.attacker ? `${roll.attacker}${isSave ? ' save' : "'s attack"}` : (isSave ? 'NPC save' : 'NPC attack');
    const advLabel = roll.advantage ? ' *(advantage)*' : roll.disadvantage ? ' *(disadvantage)*' : '';
    const outcome = isSave
        ? (success ? '✅ **Success!**' : '❌ **Failure!**')
        : (success ? '💥 **Hit!**' : '🛡️ **Miss!**');
    const rollMsg = `🎲 **${roll.description || label}**${advLabel} (vs ${isSave ? 'DC' : 'AC'} ${dc}): Rolled **${result.total}**${result.advantageDetail} — ${outcome}${result.isCritical ? ' 🌟 Natural 20!' : ''}${result.isCritFail ? ' 💀 Natural 1!' : ''}`;

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
        critical: result.isCritical,
        description: roll.description,
    };
}

function resolveDamageRoll(roll, character, dispatch) {
    try {
        const result = rollNotation(roll.notation || '1d4', roll.description || 'Damage Roll');

        // Apply class level bonus to damage (Fighter: +1 per level beyond 1st)
        const lvlBonus = getLevelBonus(character);
        const baseMod = result.modifier; // Original modifier from notation (before level bonus)
        if (lvlBonus > 0) {
            result.total += lvlBonus;
            result.modifier += lvlBonus;
        }

        dispatch({ type: 'ADD_ROLL', payload: result });

        const lvlLabel = lvlBonus > 0 ? `, level bonus: +${lvlBonus}` : '';
        const rollMsg = `🎲 **${result.description}** (${roll.notation}): Rolled **${result.total}** (dice: ${result.rolls.join(', ')}${baseMod ? `, modifier: ${baseMod >= 0 ? '+' : ''}${baseMod}` : ''}${lvlLabel})`;

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

function resolveSinglePlayerAttackRoll(roll, dispatch, mod, label) {
    const result = rollWithAdvantage(1, 20, mod, label, roll.advantage, roll.disadvantage);
    dispatch({ type: 'ADD_ROLL', payload: result });

    const dc = roll.dc || 15;
    const success = result.total >= dc;
    const advLabel = roll.advantage ? ' *(advantage)*' : roll.disadvantage ? ' *(disadvantage)*' : '';
    const hitMiss = success ? '💥 **Hit!**' : '🛡️ **Miss!**';
    const rollMsg = `🎲 **${label}**${advLabel} (vs AC ${dc}): Rolled **${result.total}**${result.advantageDetail} — ${hitMiss}${result.isCritical ? ' 🌟 Natural 20!' : ''}${result.isCritFail ? ' 💀 Natural 1!' : ''}`;

    dispatch({
        type: 'ADD_MESSAGE',
        payload: { role: 'system', content: rollMsg },
    });

    return {
        type: roll.type || 'attack_roll',
        skill: roll.skill,
        dc,
        rolled: result.total,
        success,
        critical: result.isCritical,
        description: label,
    };
}

function resolvePlayerRoll(roll, character, dispatch, inventory = []) {
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
            mod = getWeaponAttackBonus(character, inventory);
            label = roll.description || `${skillName} attack`;
        } else {
            mod = abilityMod;
        }
    } else if (skillName === 'attack') {
        mod = getWeaponAttackBonus(character, inventory);
        label = roll.description || 'Attack roll';
    } else {
        console.warn('[RollResolver] Unknown skill/ability:', skillName, '— rolling plain d20');
        mod = 0;
        label = roll.description || `${skillName} check`;
    }

    const usesAttackResolution = roll.type === 'attack_roll' || skillName === 'attack';
    if (usesAttackResolution && character.class === 'fighter' && character.level >= 5) {
        return [
            resolveSinglePlayerAttackRoll(roll, dispatch, mod, `${label} (Attack 1)`),
            resolveSinglePlayerAttackRoll(roll, dispatch, mod, `${label} (Extra Attack)`),
        ];
    }

    const result = rollWithAdvantage(1, 20, mod, label, roll.advantage, roll.disadvantage);
    dispatch({ type: 'ADD_ROLL', payload: result });

    // Initiative is just a number for turn ordering — no DC or pass/fail
    if (skillName === 'initiative') {
        const advLabel = roll.advantage ? ' *(advantage)*' : roll.disadvantage ? ' *(disadvantage)*' : '';
        const rollMsg = `🎲 **${label}**${advLabel}: Rolled **${result.total}**${result.advantageDetail}`;
        dispatch({
            type: 'ADD_MESSAGE',
            payload: { role: 'system', content: rollMsg },
        });
        return {
            type: 'initiative',
            skill: roll.skill,
            dc: null,
            rolled: result.total,
            success: true,
            description: roll.description,
        };
    }

    const success = result.total >= (roll.dc || 15);
    const advLabel = roll.advantage ? ' *(advantage)*' : roll.disadvantage ? ' *(disadvantage)*' : '';
    const isAttack = roll.type === 'attack_roll' || skillName === 'attack';
    const dcLabel = isAttack ? `vs AC ${roll.dc}` : `DC ${roll.dc}`;
    const hitMiss = isAttack
        ? (success ? '💥 **Hit!**' : '🛡️ **Miss!**')
        : (success ? '✅ **Success!**' : '❌ **Failure!**');
    const rollMsg = `🎲 **${label}**${advLabel} (${dcLabel}): Rolled **${result.total}**${result.advantageDetail} — ${hitMiss}${result.isCritical ? ' 🌟 Natural 20!' : ''}${result.isCritFail ? ' 💀 Natural 1!' : ''}`;

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
        critical: result.isCritical,
        description: roll.description,
    };
}
