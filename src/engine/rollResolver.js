/**
 * Roll Resolver — resolves an accepted OUT-OF-COMBAT roll proposal and asks the
 * DM to narrate the outcome.
 *
 * Active combat never reaches this file: `handleRequestedRolls` refuses a
 * batch while `combat.active` (the exchange machine owns every fight), and
 * `combat.enemies` is empty outside one (END_COMBAT resets the envelope). So
 * no roll here has a tracked enemy on either side of it: a hero's or a
 * companion's attack is a to-hit against the DM's stated DC and nothing more,
 * an NPC's attack lands on the hero or a companion, and the only HP this file
 * moves is theirs. The enemy half of the old Phase-2 "batched round" — live
 * enemy AC, inline damage to a foe, the UPDATE_ENEMY flush — was unreachable
 * by construction and kept green only by tests that built `combat.enemies`
 * outside a fight; it was deleted 2026-10-05 (DECISIONS 2026-07-23: delete
 * rather than document).
 */

import { rollWithModifier } from './dice.ts';
import { computeACFromInventory, formatModifier, getConditionRollEffects, combineRollModifiers, resolvePlayerRollModifier } from './rules.js';
import { ENEMY_DEFAULT_DAMAGE, validateEnemyAttackBonus, sanitizeEnemyDamage } from './enemyStats.js';
import { applyUncannyDodge, conditionAwareAttackModifiers, getAttackCount, rollD20Kept, rollDamage, stampCriticalRoll } from './combatMath.js';
import { isCompanionActive, isLowLevelSolo } from './combatPredicates.js';
import { deathSaveLine, judgeDeathSave } from './deathSaves.js';
import { describePendingLoot } from './roleplayCheck.js';

/**
 * Resolve a batch of requested rolls.
 *
 * NPC attacks that carry an inline `damage` notation apply it client-side
 * against working copies of companion / player HP, so a companion dropped
 * earlier in the same batch is honored (React state updates are async and
 * can't be re-read mid-loop).
 *
 * @param {Array} requestedRolls
 * @param {object} ctx - { character, inventory, party, dispatch }
 * @returns {{ results: Array, appliedHp: boolean }}
 */
export function resolveRolls(requestedRolls, { character, inventory, party, dispatch }) {
    const companions = party || [];

    // Working HP copies — mutated as the batch resolves, flushed to state at the end.
    const companionWork = new Map(companions.map(c => [c.id, { ...c }]));
    const playerStartHp = character?.currentHP ?? 0;
    let playerHp = playerStartHp;
    let playerDamageTaken = 0; // raw damage, so hits on an already-downed (0 HP) player still register
    const playerMaxHp = character?.maxHP ?? playerStartHp;

    const findCompanion = (ref) => {
        if (ref == null) return null;
        if (companionWork.has(ref)) return companionWork.get(ref);
        const lower = String(ref).toLowerCase();
        for (const v of companionWork.values()) {
            if (v.name?.toLowerCase() === lower) return v;
        }
        return null;
    };
    // An NPC attack's named target, when it is a companion (else the hero).
    const targetCompanion = (roll) => (roll.type === 'npc_attack' && roll.target && roll.target !== 'player' && roll.target !== 'self'
        ? findCompanion(roll.target)
        : null);

    const results = [];
    let appliedHp = false;
    // Uncanny Dodge (Rogue 5+) — once per roll batch, mirroring the exchange
    // machine's once-per-turn reaction (parity fix: the rogue previously took
    // full damage from every out-of-combat npc_attack).
    const uncannyDodgeState = { used: false };

    for (const roll of requestedRolls) {
        if (roll.type === 'companion_attack') {
            const companion = findCompanion(roll.attackerId || roll.attacker);
            if (!companion) {
                results.push({ type: 'note', text: `${roll.attacker || 'A companion'} is not in the active party and does not act.` });
                continue;
            }
            if (!isCompanionActive(companion)) {
                results.push({ type: 'note', text: `${companion.name} is down and cannot act.` });
                continue;
            }
            // Engine-owned companion stats win over DM-supplied numbers — the DM
            // has no dice/stat authority here any more than in the exchange machine.
            // A DM modifier is only a fallback for a stat-less companion, and even
            // then it passes the enemy-stat band check (a +40 is a hallucination).
            // To-hit only: there is no tracked foe outside a fight to take damage.
            const result = resolveNpcRoll({
                ...roll,
                attacker: companion.name,
                modifier: companion.attackBonus ?? validateEnemyAttackBonus(roll.modifier) ?? 0,
            }, character, dispatch, inventory, roll.dc ?? 10);
            if (result) results.push(result);
        } else if (roll.type === 'npc_attack' || roll.type === 'npc_save') {
            // Resolve the to-hit vs the correct target's AC (companion AC if targeting
            // one) — and the companion's conditions, same target-side treatment every
            // other attack path already gets (2026-08-27 audit).
            const comp = targetCompanion(roll);
            const result = resolveNpcRoll(roll, character, dispatch, inventory, comp?.ac, comp?.conditions);
            if (!result) continue;
            results.push(result);

            // Inline damage on a hit (npc_attack only — saves never deal weapon damage here).
            // DM damage notation passes the enemy-stat band check: a well-formed but
            // absurd "9d12+15" is rejected to the conservative default, same as combat.
            if (result.success && roll.type === 'npc_attack' && roll.damage) {
                const safeDamage = sanitizeEnemyDamage(roll.damage) || ENEMY_DEFAULT_DAMAGE;
                const dmg = rollAndShowDamage(safeDamage, `${roll.attacker || 'Enemy'} damage`, dispatch, { crit: result.critical });
                if (comp) {
                    comp.hp = Math.max(0, (comp.hp ?? 0) - dmg.total);
                    Object.assign(result, { damage: dmg.total, targetName: comp.name, targetHp: comp.hp, targetMaxHp: comp.maxHp });
                } else {
                    // Uncanny Dodge parity: a Rogue 5+ halves one incoming hit per
                    // batch, exactly like the exchange machine's once-per-turn reaction.
                    const dodge = applyUncannyDodge(character, dmg.total, uncannyDodgeState);
                    if (dodge.applied) {
                        dispatch({
                            type: 'ADD_MESSAGE',
                            payload: { role: 'system', content: `**Uncanny Dodge** — ${character?.name || 'The rogue'} twists aside and halves the blow: ${dmg.total} → **${dodge.damage}** damage.` },
                        });
                    }
                    playerHp = Math.max(0, playerHp - dodge.damage);
                    playerDamageTaken += dodge.damage;
                    Object.assign(result, { damage: dodge.damage, targetName: character?.name || 'you', targetHp: playerHp, targetMaxHp: playerMaxHp, targetIsPlayer: true, ...(dodge.applied && { uncannyDodgeApplied: true }) });
                }
                appliedHp = true;
            }
        } else if (roll.type === 'damage_roll') {
            // Standalone damage roll (legacy two-step flow) — rolled, not auto-applied.
            const result = resolveDamageRoll(roll, character, dispatch, inventory);
            if (result) results.push(result);
        } else if (roll.type === 'death_save' && character) {
            // The pre-batch party, deliberately: DEATH_SAVE_RESULT reads the LIVE
            // state.party at dispatch time, and working-copy HP only flushes after
            // this loop — the mirror must see exactly what the reducer will see.
            const result = resolveDeathSave(character, dispatch, companions);
            if (result) results.push(result);
        } else if (roll.skill && character) {
            results.push(...resolvePlayerRoll(roll, character, dispatch, inventory));
        } else if (character) {
            // Belt behind the parser's skill inference (2026-09-10 audit P2): a
            // roll that reaches here without a skill used to vanish silently —
            // no result, no dispatch — and the whole proposal landed on the
            // "none could be resolved" set-aside with nothing to explain why.
            // Deliberately NOT a result: a lone skill-less roll still lands on
            // that set-aside (no outcome call around a roll that never happened).
            const note = `${roll.description || 'A requested roll'} names no skill or ability and could not be rolled.`;
            dispatch({ type: 'ADD_MESSAGE', payload: { role: 'system', content: `**Roll skipped:** ${note}` } });
        }
    }

    // Flush all HP changes to game state in one batch (only if the client applied any).
    if (appliedHp) {
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
    const hpApplied = '(HP applied by the system — do NOT adjust it via damage_taken)';
    return rollResults.map(r => {
        if (r.type === 'note') {
            return `[${r.text}]`;
        }
        if (r.type === 'npc_save') {
            return `[ROLL RESULT: ${r.description || (r.attacker || 'NPC') + ' save'} vs DC ${r.dc}, rolled ${r.rolled} — ${r.success ? 'SUCCESS' : 'FAILURE'}]`;
        }
        if (r.type === 'companion_attack' || r.type === 'npc_attack') {
            const fallbackName = r.type === 'companion_attack' ? 'Companion' : 'Enemy';
            const head = `${r.description || (r.attacker || fallbackName) + ' attack'} vs AC ${r.dc}, rolled ${r.rolled}`;
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
        // (No `initiative` branch: the lane was retired 2026-08-27 — resolvePlayerRoll
        // skips it with a note before any result exists.)
        // skill_check / saving_throw / plain attack_roll
        const isAttack = r.type === 'attack_roll';
        let verb = r.success ? (isAttack ? 'HIT' : 'SUCCESS') : (isAttack ? 'MISS' : 'FAILURE');
        if (!isAttack && r.critical) {
            verb = 'SUCCESS (CRITICAL SUCCESS / NATURAL 20)';
        }
        const dcLabel = isAttack ? `vs AC ${r.dc}` : `DC ${r.dc}`;
        const head = `${r.description || r.skill + ' check'}, ${dcLabel}, rolled ${r.rolled}`;
        if (!isAttack && Number.isFinite(r.margin)) {
            return `[ROLL RESULT: ${head} — ${verb}${formatRollPromise(r)}]`;
        }
        return `[ROLL RESULT: ${head} — ${verb}]`;
    }).join('\n');
}

/** Stakes / objective text as it rides the outcome prompt: one line, bounded. */
const promiseText = (value, max = 300) => (typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, max) : '');

/**
 * The promise in the outcome (WOW 2026-09-16, checks-and-consequence): the
 * card's publicly stated failure stakes / objective and the roll margin ride
 * the [ROLL RESULT] line into the post-roll prompt, so the DM delivers the
 * consequence it committed to before the dice existed — the proposal JSON is
 * withheld from its window, so this line is the one carrier. Margin bands are
 * narration TEXTURE only: pass/fail is decided above and rule (1) "respect the
 * dice exactly" is untouched. A natural 1 is the stakes plus one complication,
 * never incompetence (DECISIONS.md 2026-06-22 stays sovereign).
 */
function formatRollPromise(r) {
    const margin = r.margin;
    const stakes = promiseText(r.failureStakes);
    const objective = promiseText(r.objective || r.description, 200);
    if (r.success) {
        const by = Math.max(0, margin);
        const texture = r.critical ? '' : (by >= 5 ? ' (clean)' : by <= 1 ? ' (narrow — the win holds, but only just)' : '');
        const promise = objective
            ? ` Deliver the win the ruling promised for "${objective}" concretely.`
            : ' Deliver the win the ruling promised concretely.';
        return ` by ${by}${texture}.${promise}`;
    }
    const short = Math.max(1, -margin);
    let texture;
    if (r.naturalOne) {
        texture = ' (NATURAL 1: the stakes plus ONE complication — never incompetence; the hero\'s authored words, confidence, and delivery stand)';
    } else if (short <= 2) {
        texture = ' (near miss: the stated stakes land, but the hero keeps a foothold)';
    } else if (short >= 5) {
        texture = ' (wide miss: the stated stakes in full)';
    } else {
        texture = '';
    }
    const promise = stakes
        ? ` The ruling promised on failure: "${stakes}". Deliver exactly that consequence — one, proportionate — then a live choice.`
        : ' No failure stakes were stated on the ruling — deliver ONE proportionate consequence, then a live choice.';
    return ` by ${short}${texture}.${promise}`;
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
    const listed = describePendingLoot(pendingLoot);
    if (!listed) return '';
    return ` (7) Your withheld setup declared potential loot (${listed}) which was NOT applied. If this outcome genuinely awards any of it, narrate the acquisition and emit the matching items_found/X_found events in THIS response. If the dice deny it, neither narrate nor emit those gains.`;
}

/**
 * The post-roll outcome prompt (the sibling of `buildRoleplayChallengePrompt`):
 * the rules, the dice, and what the DM's own window no longer holds — the
 * withheld setup narration and any loot it declared.
 */
function buildRollOutcomePrompt({ summary, preNarrated = false, setupNarrative = '', appliedHp = false, pendingLoot = null }) {
    const correctionNote = preNarrated
        ? `\n\n[IMPORTANT: Your previous response pre-narrated an outcome before seeing these dice results. The roll result above is the authoritative truth. Narrate the TRUE outcome based solely on these dice — completely discard any outcome you wrote before seeing the roll.]`
        : '';

    // The withheld setup was stripped from both the player's view and your own
    // history window, so any fresh fiction it introduced exists nowhere else —
    // hand it back so the outcome narration can re-establish it.
    const setupText = typeof setupNarrative === 'string' ? setupNarrative.trim().slice(0, 4000) : '';
    const setupNote = setupText
        ? `\n\n[CONTEXT — your own setup narration for this beat, which the player NEVER saw (it was withheld pending these dice): """${setupText}""" Re-establish the scene elements and any new fiction it introduced (arrivals, terrain, discoveries, dialogue) in your outcome narration so nothing is lost — but the ROLL RESULT lines are the sole authority on success or failure.]`
        : '';

    const hpNote = appliedHp
        ? ` Damage and HP for these attacks have ALREADY been applied by the system — narrate the wounds, but do NOT output damage_taken for them.`
        : '';

    return `[SYSTEM: Dice rolled — results below. Narrate the outcome in ONE cohesive, vivid pass that reads naturally on its own. Weave in just enough of the action for context, but do NOT retell at length or repeat beats you have already narrated. RULES: (1) Respect the dice exactly — a roll below the DC is a failure. (2) Do NOT re-request these same rolls. (3) If a result already shows "HIT for N damage", the damage is done — do NOT request a damage roll for it.${hpNote} (4) Never narrate a result that is not supported by the rolls below. (5) If the result starts combat, declare combat_start; active combat actions use combat_exchange rather than requested_rolls. (6) Do NOT re-emit coin, loot, XP, purchase, or rest events that were already applied on this or earlier turns — recapping money or rewards already handled is narration only, never an event.${formatPendingLootNote(pendingLoot)}]${correctionNote}${setupNote}\n\n${summary}`;
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
 * @param {string} [options.setupMessageId] - id of the withheld setup message, so a
 *   proposal whose every roll resolves to nothing can reveal it (never re-established
 *   otherwise — 2026-09-02 audit).
 * @param {function} [options.onFollowUpRejected] - called when the roll arbiter
 *   rejected every check the outcome chained (`{ attackAsCheck }`); the caller owns
 *   the correction response, exactly like the first hop's routing.
 * @returns {Promise<void>} — nothing: the one caller awaits it, and "did dice
 *   land" is read off the roll ledger, never off a return value.
 */
export async function handleRequestedRolls(requestedRolls, {
    getState,
    dispatch,
    sendToLLM,
    preNarrated = false,
    playerAction = '',
    onFollowUpRolls = null,
    onFollowUpRejected = null,
    pendingLoot = null,
    setupNarrative = '',
    setupMessageId = null,
}) {
    const state = getState();
    const character = state.character;
    const inventory = state.inventory || [];
    if (state.combat?.active) {
        console.warn('[RollResolver] Rejected legacy requested_rolls during active combat; combat_exchange is required.');
        return;
    }

    const rolls = Array.isArray(requestedRolls) ? requestedRolls : [];
    console.log(`[RollResolver] Processing ${rolls.length} roll(s)`);

    const { results: rollResults, appliedHp } = resolveRolls(rolls, {
        character,
        inventory,
        party: state.party,
        dispatch,
    });

    // Every proposed roll resolved to nothing (an initiative-only request, a
    // malformed damage-only batch): no dice, so no outcome call. Leave the table
    // sane instead of silently stranding it — the withheld setup would otherwise
    // never be revealed or re-established (the Change-approach REVEAL pattern;
    // a pre-narrated setup stays hidden for the same reason it does there).
    if (rollResults.length === 0) {
        if (setupMessageId && !preNarrated) {
            dispatch({ type: 'REVEAL_MESSAGE', payload: { id: setupMessageId } });
        }
        dispatch({
            type: 'ADD_MESSAGE',
            payload: {
                role: 'system',
                content: 'None of the proposed rolls could be resolved — no dice were rolled and the check is set aside. Describe what you do next.',
            },
        });
        return;
    }

    // Auto follow-up: send roll results back to DM and get outcome narration.
    // The summary rides ONLY the follow-up user message below — the old extra
    // hidden system dispatch was write-only ballast: excluded by every consumer
    // (window, journal, chronicler, priming, fronts) and never rendered, pure
    // per-check save growth (2026-08-03 audit).
    const summary = formatRollSummary(rollResults);

    // Auto-trigger follow-up: DM narrates the outcome
    console.log('[RollResolver] 🔄 Auto-triggering follow-up LLM call with roll results');

    try {
        let followUpNarrative = '';
        // The player's action rides as the runner's second argument (2026-09-02
        // P1): the outcome narration is the consequence beat, and that argument
        // gates memory/dramatic-callback retrieval, semantic text-roll detection,
        // the roll arbiter, and pre-narration detection — the follow-up used to
        // pass `undefined` and was the one narrative call built with none of
        // them. playerActionContext stays for the transaction replay guard.
        const followUpEvents = await sendToLLM(
            buildRollOutcomePrompt({ summary, preNarrated, setupNarrative, appliedHp, pendingLoot }),
            playerAction || undefined,
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
        } else if (followUpEvents?._attackAsCheckRejected || followUpEvents?._playerAuthorityRollRejected) {
            // The arbiter rejected every check the outcome chained. That rejected
            // narration was withheld (setup policy), so without a correction the
            // player sees dice and then silence — same routing as the first hop.
            if (onFollowUpRejected) {
                await onFollowUpRejected({ attackAsCheck: !!followUpEvents._attackAsCheckRejected });
            } else {
                console.warn('[RollResolver] Follow-up check rejected by the roll arbiter — no onFollowUpRejected handler was provided.');
            }
        }
    } catch (e) {
        // A deliberate Stop is not a failure (2026-08-31 P2): the player
        // chose the silence, the roll line above stands, and their next
        // message resumes the scene — an error banner here was pure noise.
        if (e?.name === 'AbortError') {
            console.log('[RollResolver] Follow-up narration stopped by the player; the roll stands.');
            return;
        }
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

// --- Internal Resolution Functions ---

/**
 * Roll ONE d20 with advantage, disadvantage, or plain — returns a
 * rollWithModifier result extended with an `advantageDetail` display string.
 * (The old count/sides params were dead — every call site passed 1, 20 — and
 * any other value would have silently DROPPED advantage instead of failing;
 * 2026-08-20 audit P2.)
 */
function rollWithAdvantage(modifier, description, advantage, disadvantage) {
    if (advantage || disadvantage) {
        // Kernel note: advantage AND disadvantage now cancel to one die (correct
        // 5e; the old copy quietly kept the advantage bias when a DM emitted both).
        const { roll, first, second } = rollD20Kept(modifier, description, advantage, disadvantage, { secondDescription: description });
        roll.advantageDetail = first != null ? ` (d20: ${first}, ${second} → kept ${roll.rolls[0]})` : '';
        return roll;
    }
    const result = rollWithModifier(1, 20, modifier, description);
    result.advantageDetail = '';
    return result;
}

function applyPlayerAttackCritical(character, result) {
    return stampCriticalRoll(character, result, result.rolls?.[0]);
}

/** One chat line for a damage roll, whichever lane rolled it. */
function damageLine({ label, notation, result, crit = false, rerolls = [] }) {
    const mod = result.modifier ? `, mod: ${formatModifier(result.modifier)}` : '';
    const style = rerolls.length > 0
        ? `; Great Weapon Fighting rerolls: ${rerolls.map(r => r.replace('→', '->')).join(', ')}`
        : '';
    return `**${label}**${crit ? ' *(crit — dice doubled)*' : ''} (${notation}): **${result.total}** damage (dice: ${result.rolls.join(', ')}${mod}${style})`;
}

/**
 * An NPC's inline damage on a hit: rolled, surfaced (ADD_ROLL + chat line),
 * doubled on a crit. The notation is already band-checked by the caller; a
 * string the dice parser still refuses rolls the kernel's 1d4.
 * @returns {{ total: number }}
 */
function rollAndShowDamage(notation, label, dispatch, { crit = false } = {}) {
    const out = rollDamage(notation, label, { critical: crit });
    dispatch({ type: 'ADD_ROLL', payload: out.roll });
    dispatch({ type: 'ADD_MESSAGE', payload: { role: 'system', content: damageLine({ label, notation: out.notation, result: out.roll, crit }) } });
    return { total: out.total };
}

/**
 * One formatter for every d20 outcome line this file posts — the hero's check /
 * save / attack and an NPC's or companion's attack / save. The player lanes
 * were folded here on 2026-08-27 (two drifted copies, the Champion-19 label in
 * both); the NPC lane kept hand-building the same shape until 2026-10-05.
 * `versus` is the NPC lane's "vs DC 12" spelling; `note` its target-condition tag.
 */
function d20OutcomeLine({ label, result, dc, isAttack, critical, success, advantage, disadvantage, versus = false, note = '' }) {
    const advLabel = advantage ? ' *(advantage)*' : disadvantage ? ' *(disadvantage)*' : '';
    const hitMiss = isAttack
        ? (success ? '**Hit!**' : '**Miss!**')
        : (success ? '**Success!**' : '**Failure!**');
    const critLabel = critical
        ? (isAttack && result.rolls?.[0] === 19 ? ' Champion critical on natural 19!' : ' Natural 20!')
        : '';
    const dcLabel = isAttack ? `vs AC ${dc}` : `${versus ? 'vs ' : ''}DC ${dc}`;
    return `**${label}**${advLabel}${note} (${dcLabel}): Rolled **${result.total}**${result.advantageDetail} — ${hitMiss}${critLabel}${result.isCritFail ? ' Natural 1!' : ''}`;
}

function resolveNpcRoll(roll, character, dispatch, inventory, targetAC, targetConditions = null) {
    // Same trust boundary as the exchange machine (enemyStats.js): an out-of-band
    // modifier is a hallucination and is REJECTED to the conservative default —
    // this path was the one entry point where a DM "+40" reached the dice raw.
    const npcMod = validateEnemyAttackBonus(roll.modifier) ?? 0;

    // Attacks against the player (targetAC == null means the player is the target)
    // respect the player's conditions: prone/restrained/blinded etc. grant the
    // attacker advantage; an invisible player imposes disadvantage. An attack on
    // a companion gets the same target-side treatment via the shared kernel —
    // parity with the exchange machine (2026-07-30).
    let effAdvantage = roll.advantage;
    let effDisadvantage = roll.disadvantage;
    let condNote = '';
    if (roll.type === 'npc_attack' && targetAC == null && character) {
        const condEffects = getConditionRollEffects(character.conditions, 'incomingAttack');
        const eff = combineRollModifiers(roll.advantage, roll.disadvantage, condEffects);
        effAdvantage = eff.advantage;
        effDisadvantage = eff.disadvantage;
        condNote = eff.note ? ` (target${eff.note})` : '';
    } else if (roll.type === 'npc_attack' && Array.isArray(targetConditions) && targetConditions.length > 0) {
        const eff = conditionAwareAttackModifiers([], targetConditions, roll.advantage, roll.disadvantage);
        effAdvantage = eff.advantage;
        effDisadvantage = eff.disadvantage;
        condNote = eff.note ? ` (target${eff.note})` : '';
    }

    const result = rollWithAdvantage(npcMod, roll.description || `${roll.attacker || 'Enemy'} attack`, effAdvantage, effDisadvantage);
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
    dispatch({
        type: 'ADD_MESSAGE',
        payload: {
            role: 'system',
            content: d20OutcomeLine({
                label: roll.description || label, result, dc, isAttack: !isSave, critical: result.isCritical, success,
                advantage: effAdvantage, disadvantage: effDisadvantage, versus: true, note: condNote,
            }),
        },
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
        // Generic damage rolls never include Sneak Attack — that is an attack
        // rider. A Great Weapon fighter's rerolls still apply (the hero's dice).
        // `onInvalid: 'throw'`: this lane's error path IS the contract — an
        // unparseable notation drops the roll instead of inventing a 1d4.
        const out = rollDamage(roll.notation || '1d4', roll.description || 'Damage Roll', {
            character, inventory, onInvalid: 'throw', includeSneakAttack: false,
        });
        dispatch({ type: 'ADD_ROLL', payload: out.roll });
        dispatch({
            type: 'ADD_MESSAGE',
            payload: { role: 'system', content: damageLine({ label: out.roll.description, notation: roll.notation, result: out.roll, rerolls: out.rerolls }) },
        });

        return {
            type: 'damage_roll',
            notation: roll.notation,
            rolled: out.roll.total,
            description: out.roll.description,
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
 *
 * The low-level solo guard is asked LIVE (`isLowLevelSolo`, the one shared
 * predicate) before any die exists, exactly where the reducer asks it: a dying
 * L1-2 hero whose only companion dropped afterwards used to get a real die and
 * a "your character dies" line while the reducer recorded a non-lethal setback
 * (2026-09-02 audit).
 */
function resolveDeathSave(character, dispatch, party = []) {
    if (!character.dying || character.lowLevelDefeat) {
        return {
            type: 'note',
            text: character.lowLevelDefeat
                ? 'No death saving throw is rolled: early low-level defeat protection converted this into a non-lethal setback.'
                : 'No death saving throw is rolled because the player is not dying.',
        };
    }

    if (isLowLevelSolo(character, party)) {
        // No die, no death line: the reducer converts the save into the early
        // defeat setback and posts its own "Death save skipped" system line.
        dispatch({ type: 'DEATH_SAVE_RESULT', payload: { die: null } });
        return {
            type: 'note',
            text: 'No death saving throw is rolled: low-level solo protection converted this into a non-lethal defeat setback (the player is down, not dead).',
        };
    }

    const result = rollWithModifier(1, 20, 0, 'Death Saving Throw');
    dispatch({ type: 'ADD_ROLL', payload: result });

    const die = result.rolls[0];
    // THE one judge and THE one line (engine/deathSaves.js, WOW 2026-09-30):
    // the same typed tally DEATH_SAVE_RESULT reads, so the chat line and the
    // DM summary can never disagree with the reducer (a string tally used to
    // make both announce a death on the first failed save), and the same
    // wording the combat exchange line uses — the count reads the same on
    // both sides of a fight.
    const judged = judgeDeathSave(character.deathSaves, die);

    // The line lands BEFORE the reducer judges the die (the last chapter,
    // 2026-09-30): a third failure makes DEATH_SAVE_RESULT post the epitaph,
    // which must read below "THE THIRD FAILURE. Astra dies.", not above it.
    // The line is computed from `judged`, never from reducer state.
    dispatch({
        type: 'ADD_MESSAGE',
        payload: { role: 'system', content: deathSaveLine(judged, character.name) },
    });

    dispatch({ type: 'DEATH_SAVE_RESULT', payload: { die } });

    return { type: 'death_save', rolled: die, outcome: judged.outcome, successes: judged.successes, failures: judged.failures };
}

/** One of the hero's attack strikes: its own d20, its own crit, its own line. */
function resolveSinglePlayerAttackRoll(roll, character, dispatch, mod, label) {
    const result = rollWithAdvantage(mod, label, roll.advantage, roll.disadvantage);
    const critical = applyPlayerAttackCritical(character, result);
    dispatch({ type: 'ADD_ROLL', payload: result });

    // The parser's deliberate default is DC 10 (never 15 — the solo-play ladder's
    // own rule); ?? keeps an explicit dc of 0 instead of silently re-pricing it.
    const dc = roll.dc ?? 10;
    const success = critical || result.total >= dc;
    dispatch({
        type: 'ADD_MESSAGE',
        payload: {
            role: 'system',
            content: d20OutcomeLine({ label, result, dc, isAttack: true, critical, success, advantage: roll.advantage, disadvantage: roll.disadvantage }),
        },
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

/**
 * The hero's check / save / attack — always a LIST of results (an Attack with
 * Extra Attack is two; a skipped roll is none).
 *
 * The modifier, the lane (`kind`) and the default label are
 * `resolvePlayerRollModifier`'s — the one ladder the odds line on the proposal
 * card reads too, so the card's number is the die's number, and a canonical
 * camelCase key (`sleightOfHand`) survives instead of lowercasing into an
 * unknown skill (2026-09-16).
 */
function resolvePlayerRoll(roll, character, dispatch, inventory = []) {
    const { key, modifier: mod, kind, source, label: defaultLabel } = resolvePlayerRollModifier(character, inventory, roll);

    // Initiative retired 2026-08-27 (DECISIONS.md): the exchange machine has
    // owned initiative since combat_start rolls it engine-side — a DM-requested
    // initiative roll has no consumer and only ever confused the table.
    if (key === 'initiative') {
        dispatch({
            type: 'ADD_MESSAGE',
            payload: { role: 'system', content: 'Initiative is rolled automatically by the engine when combat starts — the requested roll is skipped.' },
        });
        return [];
    }
    if (source === 'untrained') console.warn('[RollResolver] Unknown skill/ability:', key, '— rolling plain d20');

    // An `attack_roll` (or the `attack` key) resolves on the attack lane: the
    // weapon crit rule, attack condition effects, Extra Attack.
    const isAttack = kind === 'attack';

    // Active conditions impose advantage/disadvantage automatically (engine-owned).
    const condEffects = getConditionRollEffects(character.conditions, kind);
    const eff = combineRollModifiers(roll.advantage, roll.disadvantage, condEffects);
    const label = `${roll.description || defaultLabel}${eff.note || ''}`;
    const effRoll = { ...roll, advantage: eff.advantage, disadvantage: eff.disadvantage };

    if (isAttack && getAttackCount(character) > 1) {
        return [
            resolveSinglePlayerAttackRoll(effRoll, character, dispatch, mod, `${label} (Attack 1)`),
            resolveSinglePlayerAttackRoll(effRoll, character, dispatch, mod, `${label} (Extra Attack)`),
        ];
    }

    const result = rollWithAdvantage(mod, label, effRoll.advantage, effRoll.disadvantage);
    const critical = isAttack ? applyPlayerAttackCritical(character, result) : result.isCritical;
    dispatch({ type: 'ADD_ROLL', payload: result });

    // roll.dc ?? 10 matches the parser's deliberate default (never 15); an
    // explicit dc of 0 stays 0 instead of silently becoming 15 (2026-08-27 audit).
    const dc = roll.dc ?? 10;
    const success = critical || result.isCritical || result.total >= dc;
    dispatch({
        type: 'ADD_MESSAGE',
        payload: {
            role: 'system',
            content: d20OutcomeLine({ label, result, dc, isAttack, critical, success, advantage: effRoll.advantage, disadvantage: effRoll.disadvantage }),
        },
    });

    return [{
        type: roll.type || 'skill_check',
        skill: roll.skill,
        dc,
        rolled: result.total,
        success,
        critical,
        description: roll.description,
        advantage: effRoll.advantage,
        disadvantage: effRoll.disadvantage,
        // The promise in the outcome (2026-09-16): the card's stated stakes,
        // the objective, and the margin ride to formatRollSummary — the DM
        // never sees the withheld proposal, so the result line carries them.
        failureStakes: typeof roll.failureStakes === 'string' ? roll.failureStakes : null,
        objective: roll.description || label,
        margin: result.total - dc,
        naturalOne: !!result.isCritFail,
    }];
}
