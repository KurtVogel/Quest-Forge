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

import { rollWithModifier, parseNotation } from './dice.ts';
import { getSkillModifier, getModifier, getLevelBonus, getSavingThrowModifier, computeACFromInventory, getWeaponAttackBonus, getWeaponDamageNotation, getEquippedWeapon, getConditionRollEffects, combineRollModifiers, SKILL_ABILITIES } from './rules.js';

/** Maximum depth for recursive follow-up roll handling. */
const MAX_ROLL_DEPTH = 3;

const ABILITY_NAMES = ['strength', 'dexterity', 'constitution', 'intelligence', 'wisdom', 'charisma'];
const NON_PLAYER_ROLL_TYPES = new Set(['npc_attack', 'npc_save', 'companion_attack']);
// Recognize a player's attack intent from prose. This is a SAFETY NET for when the DM
// returns an enemy-only batch despite engine-owned enemy turns — it must be broad, because
// a missed verb silently costs the player their declared attack. Stems cover tense/plural.
const ATTACK_INTENT_RE = /\b(attack|strik|hits?|slash|stab|shoot|shot|fires?|swing|smash|punch|kick|cuts?|hack|chop|cleav|hew|thrust|lunge|jab|bash|slam|drives?|plunge|skewer|carve|guts?|impal|charge|throws?|threw|loose|clubs?|whack|pummel|maul|gores?|bites?|claw|hammer|pierc|sever|behead|decapitat|lash|whips?|headbutt|tackl|smite|sweeps?|run through|bring .{0,20}(?:down|around|to bear))\b/i;


/**
 * Repair the dangerous LLM failure mode where a player declares an attack but the
 * returned combat batch contains only enemy/companion rolls. The engine can safely
 * infer the target when exactly one living enemy remains, or when the player named
 * one of several living enemies. Ambiguous batches are blocked rather than inventing
 * player intent or granting enemies a free exchange.
 */
export function repairCombatRollBatch(requestedRolls, { combat, character, playerAction } = {}) {
    const rolls = Array.isArray(requestedRolls) ? requestedRolls : [];
    const currentFighter = combat?.turnOrder?.[combat.currentTurn];
    const isPlayerTurn = combat?.active && currentFighter?.type === 'player';
    const hasNonPlayerCombatRoll = rolls.some(roll => NON_PLAYER_ROLL_TYPES.has(roll.type));
    const isPlayerAttack = roll => roll?.type === 'attack_roll'
        || String(roll?.skill || '').toLowerCase() === 'attack';
    const playerAttacks = rolls.filter(isPlayerAttack);
    const expectedAttackCount = character?.pendingActionSurge ? 2 : 1;

    if (!isPlayerTurn || !hasNonPlayerCombatRoll || !ATTACK_INTENT_RE.test(playerAction || '')) {
        return { rolls, repaired: false, blocked: false };
    }

    const livingEnemies = (combat.enemies || []).filter(enemy =>
        (enemy.hp ?? 0) > 0 && enemy.condition !== 'dead'
    );
    const actionText = String(playerAction || '').toLowerCase();
    const namedTargets = livingEnemies.filter(enemy =>
        enemy.name && actionText.includes(enemy.name.toLowerCase())
    );
    const inferredTarget = namedTargets.length === 1
        ? namedTargets[0]
        : livingEnemies.length === 1
            ? livingEnemies[0]
            : null;
    const findTarget = ref => {
        if (!ref) return null;
        const normalized = String(ref).toLowerCase();
        return livingEnemies.find(enemy =>
            enemy.id === ref || enemy.name?.toLowerCase() === normalized
        ) || null;
    };
    const existingTarget = playerAttacks.map(roll => findTarget(roll.target)).find(Boolean);
    const target = existingTarget || inferredTarget;
    const needsRepair = playerAttacks.length < expectedAttackCount
        || playerAttacks.some(roll => !roll.skill || !findTarget(roll.target));

    if (!needsRepair) return { rolls, repaired: false, blocked: false };
    if (!target) return { rolls: [], repaired: false, blocked: true };

    const playerName = character?.name || 'Player';
    const normalizedPlayerAttacks = playerAttacks.map(roll => ({
        ...roll,
        type: 'attack_roll',
        skill: 'attack',
        target: findTarget(roll.target)?.id || target.id,
        dc: findTarget(roll.target)?.ac || target.ac,
        description: roll.description || `${playerName} attacks ${target.name}`,
    }));
    const missingAttackCount = Math.max(0, expectedAttackCount - playerAttacks.length);
    const restoredAttacks = Array.from({ length: missingAttackCount }, (_, index) => ({
        type: 'attack_roll',
        skill: 'attack',
        target: target.id,
        dc: target.ac,
        description: expectedAttackCount > 1
            ? `${playerName} attacks ${target.name} (Action ${playerAttacks.length + index + 1})`
            : `${playerName} attacks ${target.name}`,
    }));

    const remainingRolls = rolls.filter(roll => !isPlayerAttack(roll));
    return {
        rolls: [...normalizedPlayerAttacks, ...restoredAttacks, ...remainingRolls],
        repaired: true,
        blocked: false,
    };
}

/**
 * Put a player-turn exchange into engine order and allow each enemy at most one
 * attack across the entire recursive roll chain, regardless of how many player
 * actions or follow-up roll requests occur.
 */
export function canonicalizeCombatRollBatch(requestedRolls, combat, enemyAttackersSeen = new Set()) {
    const rolls = Array.isArray(requestedRolls) ? requestedRolls : [];
    const currentFighter = combat?.turnOrder?.[combat.currentTurn];
    if (!combat?.active || currentFighter?.type !== 'player') {
        return { rolls, droppedEnemyAttacks: 0, enemyAttackersSeen: new Set(enemyAttackersSeen) };
    }

    const seen = new Set(enemyAttackersSeen);
    const enemies = combat.enemies || [];
    const enemyKey = (roll) => {
        const ref = roll.attackerId || roll.attacker;
        const normalized = String(ref || 'unknown').toLowerCase();
        const tracked = enemies.find(enemy =>
            enemy.id === ref || enemy.name?.toLowerCase() === normalized
        );
        return tracked ? `enemy:${tracked.id}` : `actor:${normalized}`;
    };

    const playerRolls = [];
    const companionRolls = [];
    const npcSaves = [];
    const enemyAttacks = [];
    let droppedEnemyAttacks = 0;

    for (const roll of rolls) {
        if (roll.type === 'npc_attack') {
            const key = enemyKey(roll);
            if (seen.has(key)) {
                droppedEnemyAttacks += 1;
                continue;
            }
            seen.add(key);
            enemyAttacks.push(roll);
        } else if (roll.type === 'companion_attack') {
            companionRolls.push(roll);
        } else if (roll.type === 'npc_save') {
            npcSaves.push(roll);
        } else {
            playerRolls.push(roll);
        }
    }

    return {
        rolls: [...playerRolls, ...companionRolls, ...npcSaves, ...enemyAttacks],
        droppedEnemyAttacks,
        enemyAttackersSeen: seen,
    };
}

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
                        const dmg = rollAndShowDamage(damageNotation, `Damage to ${enemy.name}`, dispatch, { crit: one.critical, character, inventory });
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
export async function handleRequestedRolls(requestedRolls, {
    getState,
    dispatch,
    sendToLLM,
    preNarrated = false,
    playerAction = '',
    enemyAttackersSeen = new Set(),
}, depth = 0) {
    if (depth >= MAX_ROLL_DEPTH) {
        console.warn(`[RollResolver] Max roll depth (${MAX_ROLL_DEPTH}) reached — stopping recursive follow-ups.`);
        dispatch({
            type: 'ADD_MESSAGE',
            payload: {
                role: 'system',
                content: `Roll chain limit reached (${MAX_ROLL_DEPTH} levels). The DM will continue from here on your next message.`,
            },
        });
        return { resolved: false };
    }

    const state = getState();
    const character = state.character;
    const inventory = state.inventory || [];
    if (depth === 0 && state.combat?.active) {
        console.warn('[RollResolver] Rejected legacy requested_rolls during active combat; combat_exchange is required.');
        return { resolved: false, requiresCombatExchange: true };
    }
    const repairedBatch = depth === 0
        ? repairCombatRollBatch(requestedRolls, {
            combat: state.combat,
            character,
            playerAction,
        })
        : { rolls: requestedRolls, repaired: false, blocked: false };

    if (repairedBatch.blocked) {
        dispatch({
            type: 'ADD_MESSAGE',
            payload: {
                role: 'system',
                content: '**Combat safeguard:** The DM omitted your declared attack and the engine could not safely infer its target. Enemy actions were not rolled; name your target and try again.',
            },
        });
        return { resolved: false };
    }

    if (repairedBatch.repaired) {
        dispatch({
            type: 'ADD_MESSAGE',
            payload: {
                role: 'system',
                content: '**Combat safeguard:** The DM omitted or malformed your declared attack, so the engine repaired it before resolving enemy actions.',
            },
        });
    }

    const canonicalBatch = canonicalizeCombatRollBatch(
        repairedBatch.rolls,
        state.combat,
        enemyAttackersSeen
    );

    if (canonicalBatch.droppedEnemyAttacks > 0) {
        dispatch({
            type: 'ADD_MESSAGE',
            payload: {
                role: 'system',
                content: `**Combat safeguard:** Removed ${canonicalBatch.droppedEnemyAttacks} duplicate enemy attack${canonicalBatch.droppedEnemyAttacks === 1 ? '' : 's'}. Each enemy can attack at most once in a combat exchange.`,
            },
        });
    }

    if (canonicalBatch.rolls.length === 0 && canonicalBatch.droppedEnemyAttacks > 0) {
        await sendToLLM(
            '[SYSTEM: Combat correction — the enemy attack you just requested was removed because that enemy already acted in this exchange. Narrate the completed exchange now from the existing roll results. Do not request more rolls and do not apply HP again.]',
            undefined,
            { suppressHpEvents: true }
        );
        return { resolved: true };
    }

    console.log(`[RollResolver] Processing ${canonicalBatch.rolls.length} roll(s) at depth ${depth}`);

    const { results: rollResults, appliedHp } = resolveRolls(canonicalBatch.rolls, {
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
                `[SYSTEM: Dice rolled — results below. Narrate the outcome in ONE cohesive, vivid pass that reads naturally on its own. Weave in just enough of the action for context, but do NOT retell at length or repeat beats you have already narrated. RULES: (1) Respect the dice exactly — a roll below the DC is a failure. (2) Do NOT re-request these same rolls. (3) If a result already shows "HIT for N damage", the damage is done — do NOT request a damage roll for it.${hpNote} (4) Never narrate a result that is not supported by the rolls below. (5) If the result starts combat, declare combat_start; active combat actions use combat_exchange rather than requested_rolls.]${correctionNote}\n\n${summary}`,
                undefined,
                { suppressHpEvents: appliedHp }
            );

            // Handle any genuinely new outside-combat follow-up roll (e.g. a triggered save).
            if (followUpEvents?.requestedRolls?.length > 0) {
                await handleRequestedRolls(
                    followUpEvents.requestedRolls,
                    {
                        getState,
                        dispatch,
                        sendToLLM,
                        preNarrated: followUpEvents._preNarratedOutcome || false,
                        enemyAttackersSeen: canonicalBatch.enemyAttackersSeen,
                    },
                    depth + 1
                );
            }
        } catch (e) {
            console.warn('[RollResolver] Follow-up narration failed:', e);
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
 * crit and adds the player's Fighter level bonus when a player `character` is supplied.
 * @returns {{ total: number }}
 */
function rollAndShowDamage(notation, label, dispatch, { crit = false, character = null, inventory = [] } = {}) {
    let result;
    try {
        result = rollDamageWithStyle(notation, label, { crit, character, inventory });
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

    const critLabel = crit ? ' *(crit — dice doubled)*' : '';
    const lvlLabel = lvlBonus > 0 ? `, level bonus: +${lvlBonus}` : '';
    dispatch({
        type: 'ADD_MESSAGE',
        payload: {
            role: 'system',
            content: `**${label}**${critLabel} (${notation}): **${result.total}** damage (dice: ${result.rolls.join(', ')}${baseMod ? `, mod: ${baseMod >= 0 ? '+' : ''}${baseMod}` : ''}${lvlLabel}${result.fightingStyleDetail || ''})`,
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

        // Apply class level bonus to damage (Fighter: +1 per level beyond 1st)
        const lvlBonus = getLevelBonus(character);
        const baseMod = result.modifier; // Original modifier from notation (before level bonus)
        if (lvlBonus > 0) {
            result.total += lvlBonus;
            result.modifier += lvlBonus;
        }

        dispatch({ type: 'ADD_ROLL', payload: result });

        const lvlLabel = lvlBonus > 0 ? `, level bonus: +${lvlBonus}` : '';
        const rollMsg = `**${result.description}** (${roll.notation}): Rolled **${result.total}** (dice: ${result.rolls.join(', ')}${baseMod ? `, modifier: ${baseMod >= 0 ? '+' : ''}${baseMod}` : ''}${lvlLabel}${result.fightingStyleDetail || ''})`;

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

    const success = (isAttack && critical) || result.total >= (roll.dc || 15);
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
    };
}
