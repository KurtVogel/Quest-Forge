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

import { rollWithModifier, parseNotation, rollDice } from './dice.ts';
import { getSkillModifier, getModifier, getSavingThrowModifier, computeACFromInventory, getWeaponAttackBonus, getWeaponDamageNotation, getEquippedWeapon, getConditionRollEffects, combineRollModifiers, SKILL_ABILITIES, getSneakAttackDice } from './rules.js';

const ABILITY_NAMES = ['strength', 'dexterity', 'constitution', 'intelligence', 'wisdom', 'charisma'];

// The Phase-2 batched-combat repair layer (repairCombatRollBatch /
// canonicalizeCombatRollBatch) and the recursive follow-up chain with its
// MAX_ROLL_DEPTH guard were removed 2026-07-23 (DECISIONS.md): active-combat
// requested_rolls are rejected outright (the exchange machine owns combat), so
// the repair plumbing was production-unreachable, and the sole caller stages
// follow-up rolls as new proposals instead of recursing. See git history for
// the legacy implementation.

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
    let playerDamageTaken = 0; // raw damage, so hits on an already-downed (0 HP) player still register
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
        const isCompanionRoll = roll.type === 'companion_attack';

        if (isCompanionRoll) {
            const companion = findCompanion(roll.attackerId || roll.attacker);
            if (!companion) {
                results.push({ type: 'note', text: `${roll.attacker || 'A companion'} is not in the active party and does not act.` });
                continue;
            }
            if ((companion.hp ?? 0) <= 0 || companion.status === 'downed' || companion.status === 'dead') {
                results.push({ type: 'note', text: `${companion.name} is down and cannot act.` });
                continue;
            }

            const enemy = findEnemy(roll.target);
            if (enemy && enemy.hp <= 0) {
                results.push({ type: 'note', text: `${companion.name}'s target, ${enemy.name}, has already fallen.` });
                continue;
            }

            const attackRoll = {
                ...roll,
                attacker: companion.name,
                modifier: roll.modifier ?? companion.attackBonus ?? 0,
                damage: roll.damage || companion.damage,
            };
            const result = resolveNpcRoll(attackRoll, character, dispatch, inventory, enemy?.ac ?? roll.dc);
            if (!result) continue;
            results.push(result);

            if (result.success && attackRoll.damage && enemy) {
                const dmg = rollAndShowDamage(attackRoll.damage, `${companion.name} damage`, dispatch, { crit: result.critical });
                enemy.hp = Math.max(0, (enemy.hp ?? 0) - dmg.total);
                Object.assign(result, { damage: dmg.total, targetName: enemy.name, targetHp: enemy.hp, targetMaxHp: enemy.maxHp });
                appliedHp = true;
            }
        } else if (isNpcRoll) {
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
                    playerDamageTaken += dmg.total;
                    Object.assign(result, { damage: dmg.total, targetName: character?.name || 'you', targetHp: playerHp, targetMaxHp: playerMaxHp, targetIsPlayer: true });
                }
                appliedHp = true;
            }
        } else if (roll.type === 'damage_roll') {
            // Standalone damage roll (legacy two-step flow) — rolled, not auto-applied.
            const result = resolveDamageRoll(roll, character, dispatch, inventory);
            if (result) results.push(result);
        } else if (roll.type === 'death_save' && character) {
            const result = resolveDeathSave(character, dispatch);
            if (result) results.push(result);
        } else if (roll.skill && character) {
            const isAttack = roll.type === 'attack_roll' || String(roll.skill).toLowerCase() === 'attack';
            // Player to-hit is engine-owned: an attack on a tracked enemy resolves against
            // that enemy's LIVE AC, never a DM-supplied dc — mirroring how enemy attacks always
            // use the player's live AC. Falls back to roll.dc only with no tracked target.
            const targetEnemyForAc = isAttack && roll.target ? findEnemy(roll.target) : null;
            const effectiveRoll = (targetEnemyForAc && Number.isFinite(targetEnemyForAc.ac))
                ? { ...roll, dc: targetEnemyForAc.ac }
                : roll;
            const resolved = resolvePlayerRoll(effectiveRoll, character, dispatch, inventory);
            const list = Array.isArray(resolved) ? resolved : (resolved ? [resolved] : []);
            const damageNotation = isAttack
                ? getWeaponDamageNotation(character, inventory, roll.damage || '1d4')
                : roll.damage;

            for (const one of list) {
                results.push(one);
                // Inline damage for a player attack that hit and names an enemy target.
                if (one.success && isAttack && damageNotation && roll.target) {
                    const enemy = findEnemy(roll.target);
                    if (enemy) {
                        const hasAlly = companions.some(c => (c.hp ?? 0) > 0 && c.status !== 'downed' && c.status !== 'dead');
                        const dmg = rollAndShowDamage(damageNotation, `Damage to ${enemy.name}`, dispatch, {
                            crit: one.critical,
                            character,
                            inventory,
                            advantage: one.advantage,
                            disadvantage: one.disadvantage,
                            hasAlly
                        });
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
        if (playerDamageTaken > 0) {
            // Dispatch the raw damage (TAKE_DAMAGE clamps at 0) so damage dealt to a
            // dying player at 0 HP still registers as a death save failure.
            dispatch({ type: 'TAKE_DAMAGE', payload: playerDamageTaken });
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
        if (r.type === 'companion_attack') {
            const head = `${r.description || (r.attacker || 'Companion') + ' attack'} vs AC ${r.dc}, rolled ${r.rolled}`;
            if (!r.success) return `[ROLL RESULT: ${head} — MISS]`;
            if (r.damage != null) {
                const downed = r.targetHp <= 0 ? ` — ${r.targetName} is DOWNED` : '';
                return `[ROLL RESULT: ${head} — HIT for ${r.damage} damage. ${r.targetName} now ${r.targetHp}/${r.targetMaxHp} HP${downed}. ${hpApplied}]`;
            }
            return `[ROLL RESULT: ${head} — HIT]`;
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
        if (r.type === 'death_save') {
            const status = {
                revived: 'NATURAL 20 — the player regains consciousness at 1 HP and can act again',
                stable: 'third success — the player is STABLE: unconscious at 0 HP, no longer dying',
                success: `success (${r.successes}/3) — the player is still dying and unconscious`,
                failure: `failure (${r.failures}/3) — the player is still dying and unconscious`,
                dead: 'third failure — THE PLAYER CHARACTER IS DEAD (the system has recorded it; narrate the death, do not emit player_death)',
            }[r.outcome] || `${r.successes}/3 successes, ${r.failures}/3 failures`;
            return `[ROLL RESULT: Death saving throw, rolled ${r.rolled} — ${status}]`;
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
        let verb = r.success ? (isAttack ? 'HIT' : 'SUCCESS') : (isAttack ? 'MISS' : 'FAILURE');
        if (!isAttack && r.critical) {
            verb = 'SUCCESS (CRITICAL SUCCESS / NATURAL 20)';
        }
        const dcLabel = isAttack ? `vs AC ${r.dc}` : `DC ${r.dc}`;
        return `[ROLL RESULT: ${r.description || r.skill + ' check'}, ${dcLabel}, rolled ${r.rolled} — ${verb}]`;
    }).join('\n');
}

/**
 * A withheld roll-setup response sometimes declared loot alongside the check it
 * proposed. Those events were deliberately dropped (setup mutations defer to the
 * outcome), so the outcome narration gets an explicit reminder to re-emit them —
 * gated on the dice. The engine never grants this loot directly: a failed roll
 * must be able to deny it, and the Scribe loot audit remains the backstop when
 * the DM narrates a grant without emitting the events.
 */
function formatPendingLootNote(pendingLoot) {
    if (!pendingLoot) return '';
    const parts = [
        pendingLoot.goldFound > 0 ? `${pendingLoot.goldFound} gold` : null,
        pendingLoot.silverFound > 0 ? `${pendingLoot.silverFound} silver` : null,
        pendingLoot.copperFound > 0 ? `${pendingLoot.copperFound} copper` : null,
        ...(pendingLoot.itemsFound || []).map(item => {
            if (typeof item === 'string') return item;
            if (!item?.name) return null;
            return item.quantity > 1 ? `${item.quantity}x ${item.name}` : item.name;
        }),
    ].filter(Boolean);
    if (parts.length === 0) return '';
    return ` (7) Your withheld setup declared potential loot (${parts.join(', ')}) which was NOT applied. If this outcome genuinely awards any of it, narrate the acquisition and emit the matching items_found/X_found events in THIS response. If the dice deny it, neither narrate nor emit those gains.`;
}

/**
 * Resolve one out-of-combat roll batch and trigger the outcome narration.
 * Follow-up roll requests in the outcome are handed to `onFollowUpRolls`
 * (re-staged as a fresh proposal by the caller), never resolved recursively.
 * @param {Array} requestedRolls - Roll requests to resolve
 * @param {object} options - Configuration
 * @param {function} options.getState - Returns current game state
 * @param {function} options.dispatch - Game state dispatch
 * @param {function} options.sendToLLM - Function to send follow-up to LLM
 * @returns {Promise<{resolved: boolean, requiresCombatExchange?: boolean}>}
 */
export async function handleRequestedRolls(requestedRolls, {
    getState,
    dispatch,
    sendToLLM,
    preNarrated = false,
    playerAction = '',
    onFollowUpRolls = null,
    pendingLoot = null,
    setupNarrative = '',
}) {
    const state = getState();
    const character = state.character;
    const inventory = state.inventory || [];
    if (state.combat?.active) {
        console.warn('[RollResolver] Rejected legacy requested_rolls during active combat; combat_exchange is required.');
        return { resolved: false, requiresCombatExchange: true };
    }

    const rolls = Array.isArray(requestedRolls) ? requestedRolls : [];
    console.log(`[RollResolver] Processing ${rolls.length} roll(s)`);

    const { results: rollResults, appliedHp } = resolveRolls(rolls, {
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
        console.log('[RollResolver] 🔄 Auto-triggering follow-up LLM call with roll results');

        try {
            const correctionNote = preNarrated
                ? `\n\n[IMPORTANT: Your previous response pre-narrated an outcome before seeing these dice results. The roll result above is the authoritative truth. Narrate the TRUE outcome based solely on these dice — completely discard any outcome you wrote before seeing the roll.]`
                : '';

            // The withheld setup was stripped from both the player's view and your own
            // history window, so any fresh fiction it introduced exists nowhere else —
            // hand it back so the outcome narration can re-establish it.
            const setupText = String(setupNarrative || '').trim().slice(0, 4000);
            const setupNote = setupText
                ? `\n\n[CONTEXT — your own setup narration for this beat, which the player NEVER saw (it was withheld pending these dice): """${setupText}""" Re-establish the scene elements and any new fiction it introduced (arrivals, terrain, discoveries, dialogue) in your outcome narration so nothing is lost — but the ROLL RESULT lines are the sole authority on success or failure.]`
                : '';

            const hpNote = appliedHp
                ? ` Damage and HP for these attacks have ALREADY been applied by the system — narrate the wounds, but do NOT output damage_taken, damage_dealt, or enemy_updates for them.`
                : '';

            const lootNote = formatPendingLootNote(pendingLoot);
            let followUpNarrative = '';
            const followUpEvents = await sendToLLM(
                `[SYSTEM: Dice rolled — results below. Narrate the outcome in ONE cohesive, vivid pass that reads naturally on its own. Weave in just enough of the action for context, but do NOT retell at length or repeat beats you have already narrated. RULES: (1) Respect the dice exactly — a roll below the DC is a failure. (2) Do NOT re-request these same rolls. (3) If a result already shows "HIT for N damage", the damage is done — do NOT request a damage roll for it.${hpNote} (4) Never narrate a result that is not supported by the rolls below. (5) If the result starts combat, declare combat_start; active combat actions use combat_exchange rather than requested_rolls. (6) Do NOT re-emit coin, loot, XP, purchase, or rest events that were already applied on this or earlier turns — recapping money or rewards already handled is narration only, never an event.${lootNote}]${correctionNote}${setupNote}\n\n${summary}`,
                undefined,
                {
                    suppressHpEvents: appliedHp,
                    playerActionContext: playerAction,
                    onNarrative: text => { followUpNarrative = text; },
                }
            );

            // Handle any genuinely new outside-combat follow-up roll (e.g. a triggered save).
            // A follow-up response is itself a withheld setup, so any declared loot is still
            // unapplied — carry the pending-loot reminder until a roll-free outcome lands.
            if (followUpEvents?.requestedRolls?.length > 0) {
                // The follow-up response is itself a withheld setup when hidden — carry
                // its narration forward so chained checks can't erase fiction either.
                const followUpSetup = followUpEvents._setupHidden ? followUpNarrative : '';
                if (onFollowUpRolls) {
                    onFollowUpRolls(followUpEvents.requestedRolls, {
                        playerAction,
                        preNarrated: followUpEvents._preNarratedOutcome || false,
                        pendingLoot,
                        setupNarrative: followUpSetup,
                        setupMessageId: followUpEvents._setupHidden ? followUpEvents._setupMessageId : null,
                    });
                } else {
                    // Follow-up rolls always re-stage as a fresh proposal via the
                    // caller's handler; there is no recursive resolution path anymore.
                    console.warn('[RollResolver] Follow-up rolls dropped — no onFollowUpRolls handler was provided.');
                }
            }
        } catch (e) {
            // The dice landed but the outcome narration didn't. Say so visibly — the
            // exception never escapes to ChatPanel's own error surfacing, so without
            // this line the player just sees a roll followed by silence.
            console.warn('[RollResolver] Follow-up narration failed:', e);
            dispatch({
                type: 'ADD_MESSAGE',
                payload: {
                    role: 'system',
                    content: `**Outcome narration failed:** ${e?.message || 'the DM call did not complete'}. Your roll above stands — send any message (even "continue") and the DM will narrate the outcome from it.`,
                },
            });
        }
    }

    return { resolved: rollResults.length > 0 };
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

function shouldUseGreatWeaponFighting(character, inventory = []) {
    if (character?.class !== 'fighter' || character.fightingStyle !== 'greatWeaponFighting') return false;
    const weapon = getEquippedWeapon(inventory);
    return !!weapon && !weapon.ranged && weapon.twoHanded;
}

function isChampionCritical(character, die) {
    return character?.class === 'fighter'
        && character.level >= 3
        && character.martialArchetype === 'champion'
        && die >= 19;
}

function applyPlayerAttackCritical(character, result) {
    const die = result.rolls?.[0];
    if (isChampionCritical(character, die)) {
        result.isCritical = true;
        result.criticalThreshold = die === 19 ? 'Champion 19-20' : undefined;
    }
    return !!result.isCritical;
}

function rollDamageWithStyle(notation, label, { crit = false, character = null, inventory = [] } = {}) {
    const { count, sides, modifier } = parseNotation(notation);
    const diceCount = crit ? count * 2 : count;
    const result = rollWithModifier(diceCount, sides, modifier, label);

    if (shouldUseGreatWeaponFighting(character, inventory) && sides > 2) {
        const rerolls = [];
        result.rolls = result.rolls.map((roll) => {
            if (roll > 2) return roll;
            const rerolled = rollWithModifier(1, sides, 0, `${label} reroll`);
            const kept = rerolled.rolls[0];
            rerolls.push(`${roll}->${kept}`);
            return kept;
        });
        if (rerolls.length > 0) {
            result.subtotal = result.rolls.reduce((sum, roll) => sum + roll, 0);
            result.total = result.subtotal + result.modifier;
            result.fightingStyleDetail = `; Great Weapon Fighting rerolls: ${rerolls.join(', ')}`;
        }
    }

    return result;
}

/**
 * Roll a damage notation and surface it (ADD_ROLL + chat line). Doubles the dice on a
 * crit; a player `character` also brings Fighting Style and Sneak Attack effects.
 * @returns {{ total: number }}
 */
function rollAndShowDamage(notation, label, dispatch, { crit = false, character = null, inventory = [], advantage = false, disadvantage = false, hasAlly = false } = {}) {
    let result;
    try {
        result = rollDamageWithStyle(notation, label, { crit, character, inventory });
    } catch (e) {
        console.error('[RollResolver] Bad damage notation:', notation, e);
        result = rollWithModifier(1, 4, 0, label); // safe fallback
    }

    const baseMod = result.modifier;

    // Rogue Sneak Attack (out-of-combat)
    let sneakAttackDetail = '';
    if (character && character.class === 'rogue') {
        const weapon = getEquippedWeapon(inventory);
        const sneakAttackDice = getSneakAttackDice(character, weapon, advantage, disadvantage, hasAlly);
        if (sneakAttackDice > 0) {
            const saDiceCount = crit ? sneakAttackDice * 2 : sneakAttackDice;
            const saRolls = rollDice(saDiceCount, 6);
            const saTotal = saRolls.reduce((sum, r) => sum + r, 0);
            result.total += saTotal;
            sneakAttackDetail = `, +**${saTotal}** Sneak Attack (${saDiceCount}d6: ${saRolls.join(', ')})`;
        }
    }

    dispatch({ type: 'ADD_ROLL', payload: result });

    const critLabel = crit ? ' *(crit — dice doubled)*' : '';
    dispatch({
        type: 'ADD_MESSAGE',
        payload: {
            role: 'system',
            content: `**${label}**${critLabel} (${notation}): **${result.total}** damage (dice: ${result.rolls.join(', ')}${baseMod ? `, mod: ${baseMod >= 0 ? '+' : ''}${baseMod}` : ''}${result.fightingStyleDetail || ''}${sneakAttackDetail})`,
        },
    });

    return { total: result.total };
}

function resolveNpcRoll(roll, character, dispatch, inventory, targetAC) {
    const npcMod = roll.modifier ?? 0;

    // Attacks against the player (targetAC == null means the player is the target)
    // respect the player's conditions: prone/restrained/blinded etc. grant the
    // attacker advantage; an invisible player imposes disadvantage.
    let effAdvantage = roll.advantage;
    let effDisadvantage = roll.disadvantage;
    let condNote = '';
    if (roll.type === 'npc_attack' && targetAC == null && character) {
        const condEffects = getConditionRollEffects(character.conditions, 'incomingAttack');
        const eff = combineRollModifiers(roll.advantage, roll.disadvantage, condEffects);
        effAdvantage = eff.advantage;
        effDisadvantage = eff.disadvantage;
        condNote = eff.note ? ` (target${eff.note})` : '';
    }

    const result = rollWithAdvantage(1, 20, npcMod, roll.description || `${roll.attacker || 'Enemy'} attack`, effAdvantage, effDisadvantage);
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
    const advLabel = (effAdvantage ? ' *(advantage)*' : effDisadvantage ? ' *(disadvantage)*' : '') + condNote;
    const outcome = isSave
        ? (success ? '**Success!**' : '**Failure!**')
        : (success ? '**Hit!**' : '**Miss!**');
    const rollMsg = `**${roll.description || label}**${advLabel} (vs ${isSave ? 'DC' : 'AC'} ${dc}): Rolled **${result.total}**${result.advantageDetail} — ${outcome}${result.isCritical ? ' Natural 20!' : ''}${result.isCritFail ? ' Natural 1!' : ''}`;

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

function resolveDamageRoll(roll, character, dispatch, inventory = []) {
    try {
        const result = rollDamageWithStyle(roll.notation || '1d4', roll.description || 'Damage Roll', { character, inventory });
        const baseMod = result.modifier;

        dispatch({ type: 'ADD_ROLL', payload: result });

        const rollMsg = `**${result.description}** (${roll.notation}): Rolled **${result.total}** (dice: ${result.rolls.join(', ')}${baseMod ? `, modifier: ${baseMod >= 0 ? '+' : ''}${baseMod}` : ''}${result.fightingStyleDetail || ''})`;

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

/**
 * Death saving throw — a flat d20, no modifiers, rolled while the player is dying.
 * 10+ = success (3 = stable), 9- = failure (nat 1 = two failures, 3 = dead),
 * nat 20 = back on your feet at 1 HP. State transitions live in the reducer
 * (DEATH_SAVE_RESULT); this mirrors them for the chat line and DM summary.
 */
function resolveDeathSave(character, dispatch) {
    if (!character.dying || character.lowLevelDefeat) {
        return {
            type: 'note',
            text: character.lowLevelDefeat
                ? 'No death saving throw is rolled: early low-level defeat protection converted this into a non-lethal setback.'
                : 'No death saving throw is rolled because the player is not dying.',
        };
    }

    const result = rollWithModifier(1, 20, 0, 'Death Saving Throw');
    dispatch({ type: 'ADD_ROLL', payload: result });

    const die = result.rolls[0];
    const prev = character.deathSaves || { successes: 0, failures: 0 };
    let successes = prev.successes;
    let failures = prev.failures;
    let outcome;
    if (die === 20) {
        outcome = 'revived';
    } else if (die >= 10) {
        successes += 1;
        outcome = successes >= 3 ? 'stable' : 'success';
    } else {
        failures += die === 1 ? 2 : 1;
        outcome = failures >= 3 ? 'dead' : 'failure';
    }

    dispatch({ type: 'DEATH_SAVE_RESULT', payload: { die } });

    const tally = `(successes ${Math.min(successes, 3)}/3, failures ${Math.min(failures, 3)}/3)`;
    const outcomeText = {
        revived: '**Natural 20!** You surge back to consciousness with 1 HP!',
        stable: '**Stabilized.** You are unconscious but no longer dying.',
        success: `**Success.** ${tally}`,
        failure: `${die === 1 ? '**Natural 1 — two failures!**' : '**Failure.**'} ${tally}`,
        dead: '**Third failure. Your character dies.**',
    }[outcome];

    dispatch({
        type: 'ADD_MESSAGE',
        payload: { role: 'system', content: `**Death Saving Throw**: Rolled **${die}** — ${outcomeText}`, isDeathEvent: outcome === 'dead' },
    });

    return { type: 'death_save', rolled: die, outcome, successes: Math.min(successes, 3), failures: Math.min(failures, 3) };
}

function resolveSinglePlayerAttackRoll(roll, character, dispatch, mod, label) {
    const result = rollWithAdvantage(1, 20, mod, label, roll.advantage, roll.disadvantage);
    const critical = applyPlayerAttackCritical(character, result);
    dispatch({ type: 'ADD_ROLL', payload: result });

    const dc = roll.dc || 15;
    const success = critical || result.total >= dc;
    const advLabel = roll.advantage ? ' *(advantage)*' : roll.disadvantage ? ' *(disadvantage)*' : '';
    const hitMiss = success ? '**Hit!**' : '**Miss!**';
    const critLabel = critical
        ? (result.rolls?.[0] === 19 ? ' Champion critical on natural 19!' : ' Natural 20!')
        : '';
    const rollMsg = `**${label}**${advLabel} (vs AC ${dc}): Rolled **${result.total}**${result.advantageDetail} — ${hitMiss}${critLabel}${result.isCritFail ? ' Natural 1!' : ''}`;

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
        critical,
        description: label,
        advantage: roll.advantage,
        disadvantage: roll.disadvantage,
    };
}

function resolvePlayerRoll(roll, character, dispatch, inventory = []) {
    const skillName = roll.skill.toLowerCase();

    const ability = SKILL_ABILITIES[skillName];
    const isAbilityName = ABILITY_NAMES.includes(skillName);
    const isAttackRoll = roll.type === 'attack_roll';
    const isSavingThrow = roll.type === 'saving_throw';

    let mod = 0;
    let label = roll.description || `${skillName} check`;

    if (isAbilityName && isSavingThrow) {
        // Saving throw: ability modifier + proficiency when the class grants it.
        mod = getSavingThrowModifier(character, skillName);
        label = roll.description || `${skillName} saving throw`;
    } else if (ability) {
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

    // Active conditions impose advantage/disadvantage automatically (engine-owned).
    const rollKind = usesAttackResolution ? 'attack' : (isSavingThrow ? 'save' : 'check');
    const condEffects = getConditionRollEffects(character.conditions, rollKind);
    const eff = combineRollModifiers(roll.advantage, roll.disadvantage, condEffects);
    if (eff.note) label += eff.note;
    const effRoll = { ...roll, advantage: eff.advantage, disadvantage: eff.disadvantage };

    if (usesAttackResolution && character.class === 'fighter' && character.level >= 5) {
        return [
            resolveSinglePlayerAttackRoll(effRoll, character, dispatch, mod, `${label} (Attack 1)`),
            resolveSinglePlayerAttackRoll(effRoll, character, dispatch, mod, `${label} (Extra Attack)`),
        ];
    }

    const isAttack = roll.type === 'attack_roll' || skillName === 'attack';
    const result = rollWithAdvantage(1, 20, mod, label, effRoll.advantage, effRoll.disadvantage);
    const critical = isAttack ? applyPlayerAttackCritical(character, result) : result.isCritical;
    dispatch({ type: 'ADD_ROLL', payload: result });

    // Initiative is just a number for turn ordering — no DC or pass/fail
    if (skillName === 'initiative') {
        const advLabel = effRoll.advantage ? ' *(advantage)*' : effRoll.disadvantage ? ' *(disadvantage)*' : '';
        const rollMsg = `**${label}**${advLabel}: Rolled **${result.total}**${result.advantageDetail}`;
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

    const success = (isAttack && critical) || result.isCritical || result.total >= (roll.dc || 15);
    const advLabel = effRoll.advantage ? ' *(advantage)*' : effRoll.disadvantage ? ' *(disadvantage)*' : '';
    const dcLabel = isAttack ? `vs AC ${roll.dc}` : `DC ${roll.dc}`;
    const hitMiss = isAttack
        ? (success ? '**Hit!**' : '**Miss!**')
        : (success ? '**Success!**' : '**Failure!**');
    const critLabel = isAttack && critical
        ? (result.rolls?.[0] === 19 ? ' Champion critical on natural 19!' : ' Natural 20!')
        : (result.isCritical ? ' Natural 20!' : '');
    const rollMsg = `**${label}**${advLabel} (${dcLabel}): Rolled **${result.total}**${result.advantageDetail} — ${hitMiss}${critLabel}${result.isCritFail ? ' Natural 1!' : ''}`;

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
        critical,
        description: roll.description,
        advantage: effRoll.advantage,
        disadvantage: effRoll.disadvantage,
    };
}
