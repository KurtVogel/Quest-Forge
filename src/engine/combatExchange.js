/**
 * Engine-owned combat exchanges.
 *
 * The DM interprets fiction into a bounded intent envelope (combatWire.js
 * normalizes it). This module validates that envelope against live state,
 * rolls every die, and returns one immutable mechanics plan. The reducer
 * applies that plan in one dispatch; narration happens afterwards from the
 * stored result (llm/combatNarration.js composes its prompt).
 *
 * Until 2026-10-05 this file also held the wire normalization, the three
 * combat predicates, the fight tally / wound / memory family and the
 * narration prompt — four modules whose only coupling was the file. They
 * live in combatWire.js, combatPredicates.js, fightTally.js and
 * llm/combatNarration.js.
 */
import { rollWithModifier } from './dice.ts';
import {
    ABILITY_KEY_SET,
    SKILL_KEY_SET,
    combineRollModifiers,
    computeACFromInventory,
    getConditionRollEffects,
    getIncapacitatingCondition,
    getWeaponAttackBonus,
    getWeaponDamageNotation,
    normalizeDeathSaves,
    resolvePlayerRollModifier,
} from './rules.js';
import { DEATH_SAVE_OUTCOMES, deathSaveLine, judgeDeathSave } from './deathSaves.js';
import {
    applyUncannyDodge,
    conditionAwareAttackModifiers,
    getAttackCount,
    resolveAttackRoll,
    rollD20Kept as rollD20,
    rollDamage,
} from './combatMath.js';
import {
    ENEMY_DEFAULT_ATTACK_BONUS,
    ENEMY_DEFAULT_DAMAGE,
    ENEMY_DEFAULT_SAVE_BONUS,
    enemyHealthCondition,
    enemyOutcome,
    healthWord,
    normalizeEnemyConditions,
    sanitizeEnemyDamage,
    validateEnemyAttackBonus,
    validateEnemySaveBonus,
} from './enemyStats.js';
import { COMBAT_PHASES, isCompanionActive, isEnemyActive, isLowLevelSolo } from './combatPredicates.js';
import {
    chooseSlotLevel,
    getSpellAttackBonus,
    getSpellSaveDC,
    isSpellcaster,
    resolveSpellForCharacter,
    spellDamageNotation,
    spellHealingNotation,
    spendSpellSlot,
    summarizeSpellSlots,
} from './spellcasting.js';

function applyEnemyConditionDelta(enemy, delta, events) {
    if (!enemy || !delta) return;
    const remove = new Set(normalizeEnemyConditions(delta.remove));
    const before = normalizeEnemyConditions(enemy.conditions);
    const after = normalizeEnemyConditions([
        ...before.filter(condition => !remove.has(condition)),
        ...normalizeEnemyConditions(delta.add),
    ]);
    enemy.conditions = after;
    const added = after.filter(condition => !before.includes(condition));
    const removed = before.filter(condition => !after.includes(condition));
    if (added.length > 0) events?.push({ type: 'note', text: `${enemy.name} gains: ${added.join(', ')}.` });
    if (removed.length > 0) events?.push({ type: 'note', text: `${enemy.name} is no longer: ${removed.join(', ')}.` });
}

function rulingFlags(ruling) {
    return {
        advantage: ruling?.mode === 'advantage',
        disadvantage: ruling?.mode === 'disadvantage',
    };
}

// Applied automatically while a flank persists between exchanges; a slot's own
// explicit ruling always replaces it so the DM stays the adjudicator.
const STANDING_FLANK_RULING = Object.freeze({ mode: 'advantage', reason: 'flanking (standing)' });

function isSharedFlankingRuling(ruling) {
    if (ruling?.mode !== 'advantage') return false;
    const reason = String(ruling.reason || '').toLowerCase();
    return /\bflank(?:ed|ing|s)?\b/.test(reason)
        || /\bopposite side\b/.test(reason)
        || /\bopposite sides\b/.test(reason)
        || /\bpincer\b/.test(reason)
        || /\bbetween\b.+\band\b/.test(reason)
        || /\bboxed in\b/.test(reason)
        || /\bsurrounded\b/.test(reason)
        || /\bhemmed in\b/.test(reason);
}

/**
 * An enemy's saving throw against a hero spell, honoring the foe's own
 * conditions the way the hero's saves do: a restrained foe saves at
 * disadvantage (CONDITION_EFFECTS.restrained.save). Before 2026-09-05 both
 * save lanes rolled flat, so the condition's save effect never reached an enemy.
 */
function rollEnemySave(enemy, description) {
    const bonus = validateEnemySaveBonus(enemy.saveBonus) ?? ENEMY_DEFAULT_SAVE_BONUS;
    const conditionEffects = getConditionRollEffects(enemy.conditions, 'save');
    const modifiers = combineRollModifiers(false, false, conditionEffects);
    const save = rollD20(bonus, description, modifiers.advantage, modifiers.disadvantage);
    return { ...save, mode: rollModeLabel(save, modifiers, null) || undefined };
}

function rollModeLabel(roll, modifiers, ruling) {
    const parts = [];
    if (roll.detail) parts.push(roll.detail);
    else if (modifiers.advantage) parts.push('advantage');
    else if (modifiers.disadvantage) parts.push('disadvantage');
    if (ruling) {
        const cancelled = !roll.detail && !modifiers.advantage && !modifiers.disadvantage;
        parts.push(`DM ruling — ${ruling.mode}: ${ruling.reason}${cancelled ? ' (cancelled by an opposing modifier)' : ''}`);
    }
    if (modifiers.note) parts.push(modifiers.note.trim());
    return parts.join('; ');
}

function makeExchangeId(kind, combat) {
    const uuid = globalThis.crypto?.randomUUID?.();
    return uuid ? `${kind}-${uuid}` : `${kind}-${Date.now()}-${combat?.round || 1}`;
}

function eventMessage(event) {
    if (event.type === 'note') return event.text;
    const mode = event.mode ? ` (${event.mode})` : '';
    const roll = event.rolled != null ? ` Rolled **${event.rolled}** vs AC ${event.dc}${mode}` : '';
    if (event.type === 'attack') {
        const intercept = event.intercepted ? ` (guard — ${event.target} intercepts the blow meant for the hero)` : '';
        const verb = event.spellName ? `casts ${event.spellName} at` : 'attacks';
        if (!event.hit) return `**${event.actor} ${verb} ${event.target}**${intercept} —${roll}; **Miss.**`;
        const crit = event.critical ? ' Critical hit.' : '';
        const sa = event.sneakAttackDetail
            ? ` Includes **${event.sneakAttackDetail.total}** Sneak Attack damage (${event.sneakAttackDetail.diceCount}d6: ${event.sneakAttackDetail.rolls.join(', ')}).`
            : '';
        const ud = event.uncannyDodgeApplied ? ' (damage halved by Uncanny Dodge)' : '';
        const survival = event.remainingHp <= 0
            ? ` ${event.target} is down.`
            : ` ${event.target} remains alive at ${event.remainingHp}/${event.maxHp} HP.`;
        return `**${event.actor} ${verb} ${event.target}**${intercept} —${roll}; **Hit for ${event.damage} damage.**${crit}${sa}${ud}${survival}`;
    }
    if (event.type === 'check' || event.type === 'save') {
        const checkMode = event.mode ? ` (${event.mode})` : '';
        const outcome = event.natural === 20
            ? 'Success (Critical Success / Natural 20)'
            : event.success ? 'Success' : 'Failure';
        return `**${event.actor}: ${event.description}** — Rolled **${event.rolled}** vs DC ${event.dc}${checkMode}; **${outcome}.**`;
    }
    if (event.type === 'death_save') {
        // The count is on the page (WOW 2026-09-30): the event carries the
        // engine's judged outcome + tally and renders through THE shared
        // line. An event with no judged outcome (junk a load could not type)
        // keeps the bare line rather than a countdown built on `undefined`.
        if (!DEATH_SAVE_OUTCOMES.includes(event.outcome)) return `**Death Saving Throw:** natural **${event.natural}**.`;
        return deathSaveLine(event, event.actor);
    }
    return event.text || `${event.actor} ${event.type}.`;
}

/**
 * One rendered line per resolved event. The result object stores only the
 * events (single source of truth — DECISIONS.md 2026-08-04); message lines and
 * the narration prompt's RESOLVED EVENTS block are derived at read time.
 * Legacy results persisted before the change carry a `summary` string instead.
 */
export function exchangeEventLines(result) {
    if (Array.isArray(result?.events) && result.events.length > 0) {
        return result.events.map(eventMessage).map(line => String(line || '').trim()).filter(Boolean);
    }
    return String(result?.summary || '').split('\n').map(line => line.trim()).filter(Boolean);
}

function enemySnapshot(enemy) {
    return {
        id: enemy.id,
        name: enemy.name,
        hp: enemy.hp,
        maxHp: enemy.maxHp,
        condition: enemy.condition,
        conditions: normalizeEnemyConditions(enemy.conditions),
        status: enemyOutcome(enemy),
    };
}

/**
 * The stored result: the events (the single source of truth for the chat
 * lines and the narration prompt) plus the authoritative post-exchange
 * snapshot. `player` is `projectPlayerSnapshot`'s reading of the hero — the
 * same one the terminal was judged from.
 */
function makeResult(kind, exchangeId, round, events, terminal, { enemies, companions, character, playerHp, player }) {
    return {
        exchangeId,
        kind,
        round,
        terminal,
        events,
        postState: {
            player: {
                name: character.name || 'Player',
                hp: Number.isFinite(playerHp) ? playerHp : character.currentHP,
                maxHp: character.maxHP,
                // The hero's state after the exchange (WOW 2026-09-30): the
                // narration prompt's PLAYER line and the DIED terminal read it.
                status: player.status,
                deathSaves: player.deathSaves,
            },
            enemies: enemies.map(enemySnapshot),
            companions: companions.map(companion => ({
                id: companion.id,
                name: companion.name,
                hp: companion.hp,
                maxHp: companion.maxHp,
                status: companion.status,
            })),
        },
    };
}

function findByRef(list, value) {
    const normalized = String(value || '').toLowerCase();
    return list.find(item => item.id === value || item.name?.toLowerCase() === normalized) || null;
}

function activeEnemies(enemies) {
    return enemies.filter(isEnemyActive);
}

/** A defensive default: a bare "cast" with no spell name means the class's attack cantrip. */
function resolveCastSpell(character, slot) {
    const fallback = character?.class === 'wizard' ? 'fireBolt' : character?.class === 'cleric' ? 'sacredFlame' : null;
    return resolveSpellForCharacter(character, slot?.spell || fallback);
}

/** An ally target for support spells: the hero ('self'/name/'player') or a living companion. */
function resolveAllyTarget(character, companions, targetRef) {
    const raw = String(targetRef || '').trim().toLowerCase();
    if (!raw || raw === 'self' || raw === 'me' || raw === 'player'
        || raw === String(character?.name || '').trim().toLowerCase()) {
        return { type: 'player' };
    }
    const companion = findByRef(companions, targetRef);
    if (companion && companion.status !== 'dead') return { type: 'companion', companion };
    return null;
}

function isBonusCastSlot(character, slot) {
    if (slot?.action !== 'cast') return false;
    return resolveCastSpell(character, slot)?.castTime === 'bonus';
}

function castTargetRefs(slot, fallback = []) {
    if (slot.targets?.length) return slot.targets;
    return slot.target ? [slot.target] : fallback;
}

/**
 * Turn-level rules: how many slots this hero may declare, which lanes they
 * ride, and what a dying / defeated hero may do at all. Returns the rejection
 * text, or null when the turn's shape is legal.
 */
function validateTurnShape(allSlots, state) {
    // Fighter bonus-action lane (Codex 2026-08-09): a player-invoked Second Wind
    // rides beside the normal action without consuming an action slot — the
    // fighter parallel of the Cleric bonus-cast lane below.
    const secondWindSlots = allSlots.filter(slot => slot.action === 'second_wind');
    const slots = allSlots.filter(slot => slot.action !== 'second_wind');
    if (secondWindSlots.length > 1) return 'Second Wind can be declared at most once per turn.';
    if (secondWindSlots.length === 1) {
        const res = state.character?.classResources?.secondWind;
        if (!res) return 'Second Wind is a Fighter ability this character does not have.';
        if (res.used >= res.max) return 'Second Wind is already spent; it recharges on a rest.';
        if (state.combat?.bonusActionUsed) return 'The bonus action is already used this turn; Second Wind must wait for a later turn.';
    }
    const surge = !!state.character?.pendingActionSurge;
    const isRogue = state.character?.class === 'rogue';
    const hasCunningActionFeature = isRogue && (state.character?.level >= 2);
    // Cleric bonus-spell lane (spellcasting v1): exactly one bonus-time cast may
    // ride alongside one normal action — the caster's "do two things" lever,
    // parallel to Rogue Cunning Action and Fighter Action Surge.
    const bonusCastCount = slots.filter(slot => isBonusCastSlot(state.character, slot)).length;
    if (bonusCastCount > 0 && state.combat?.bonusActionUsed) {
        // Mirror of the Second Wind guard above: a potion already spent the
        // round's one bonus action, so a bonus-time spell cannot ride this turn.
        return 'The bonus action is already used this turn; a bonus-action spell must wait for a later turn.';
    }
    const casterBonusTurn = isSpellcaster(state.character?.class) && bonusCastCount === 1;

    const maxSlots = hasCunningActionFeature || surge || casterBonusTurn ? 2 : 1;

    // A lone second_wind slot is a complete turn (the fighter just catches their
    // breath), so only the fully empty envelope is rejected here.
    if (slots.length > maxSlots || allSlots.length === 0) {
        return hasCunningActionFeature
            ? 'Declare one action slot, or up to two slots if one is a Cunning Action (dash, disengage, or stealth check).'
            : (surge ? 'Action Surge is active: declare exactly two action slots in this turn.' : 'Declare exactly one action slot for this turn.');
    }

    if (slots.length === 2) {
        if (hasCunningActionFeature && !surge) {
            const isCunning = slot => slot.action === 'dash' || slot.action === 'disengage' || (slot.action === 'check' && slot.skill === 'stealth');
            if (slots.filter(isCunning).length < 1) {
                return 'To declare two slots, a Rogue must use one slot for a Cunning Action (dash, disengage, or stealth check).';
            }
            const attacks = slots.filter(s => s.action === 'attack').length;
            const casts = slots.filter(s => s.action === 'cast').length;
            if (attacks > 1 || casts > 1 || (attacks > 0 && casts > 0)) {
                return 'A Rogue cannot declare multiple attack or spellcast actions in a single turn.';
            }
        } else if (!surge && !casterBonusTurn) {
            // (Action Surge: any two actions. A caster's bonus turn: one
            // bonus-time cast + one normal action — bonusCastCount === 1
            // already guarantees the pair cannot be two bonus spells.)
            return 'Declare exactly one action slot for this turn.';
        }
    }

    if (surge && slots.length !== 2) return 'Action Surge is active: declare exactly two action slots in this turn.';
    if (state.character?.isDead || state.character?.lowLevelDefeat) {
        return 'The player cannot commit a combat action while defeated or dead.';
    }
    // Dying checks run over EVERY slot: a dying fighter cannot slip a Second
    // Wind in beside their death save.
    if (state.character?.dying && allSlots.some(slot => slot.action !== 'death_save')) {
        return 'A dying character can only make a death saving throw.';
    }
    if (!state.character?.dying && allSlots.some(slot => slot.action === 'death_save')) {
        return 'A death saving throw is only valid while dying.';
    }
    const fleeIndex = slots.findIndex(slot => slot.action === 'flee');
    if (fleeIndex >= 0 && fleeIndex !== slots.length - 1) return 'Flee must be the final action slot in the exchange.';
    return null;
}

/** A check / save slot names a key the rules know (the wire already canonicalized it). */
function validateCheckSlot(slot, state, living) {
    const isSave = slot.action === 'save';
    if (!slot.skill) return `${isSave ? 'Save' : 'Check'} slots must name an ability or skill.`;
    if (isSave && !ABILITY_KEY_SET.has(slot.skill)) return `Saving throw ability "${slot.skill}" is unsupported.`;
    if (!isSave && !ABILITY_KEY_SET.has(slot.skill) && !SKILL_KEY_SET.has(slot.skill)) {
        return `Check skill or ability "${slot.skill}" is unsupported.`;
    }
    if (!isSave && slot.onSuccess && !findByRef(living, slot.onSuccess.target)) {
        return `Check condition target "${slot.onSuccess.target}" is not an active enemy in this fight.`;
    }
    return null;
}

function validateCastSlot(slot, state, living) {
    const spell = resolveCastSpell(state.character, slot);
    if (!spell) return 'That spell is not on this character\'s engine-owned spell list; choose a known class spell or another action.';
    if (!spell.combatAvailable) return `${spell.name} has no combat effect; it belongs outside battle.`;
    if (spell.level > 0 && chooseSlotLevel(state.character.spellSlots, spell, slot.slotLevel) === null) {
        return `No spell slot remains to cast ${spell.name} (needs a level ${spell.level}+ slot).`;
    }
    // Over-targeting a limited spell is NOT a rejection: the resolvers clamp to
    // the spell's real target count (first named targets win) with a visible
    // note. A hard reject here cost the player a dead turn every time the DM
    // pattern-matched 5e's AoE Sleep onto our single-target version (2026-07-17
    // live playtest — it happened twice in one fight).
    if (spell.targeting.side === 'enemy') {
        const targets = castTargetRefs(slot);
        if (targets.length === 0) return `${spell.name} needs a living enemy target.`;
        const missing = targets.find(target => !findByRef(living, target));
        if (missing) return `Spell target "${missing}" is not an active enemy in this fight.`;
    } else if (spell.targeting.side === 'ally') {
        const missing = castTargetRefs(slot, ['self']).find(target => !resolveAllyTarget(state.character, state.party || [], target));
        if (missing) return `Spell target "${missing}" is not the hero or a living companion.`;
    }
    return null;
}

function validateChannelSlot(slot, state, living) {
    if (state.character?.class !== 'cleric' || (state.character.level || 1) < 2) {
        return 'Channel Divinity requires a Cleric of level 2 or higher.';
    }
    const channel = state.character.classResources?.channelDivinity;
    if (!channel || channel.used >= channel.max) return 'Channel Divinity is already spent; it recharges on a rest.';
    if (!living.some(enemy => enemy.isUndead)) return 'Turn Undead has no undead foes to affect in this fight.';
    return null;
}

function validateAttackSlot(slot, state, living) {
    if (slot.weaponId && !findByRef(state.inventory || [], slot.weaponId)) {
        return `Attack weapon "${slot.weaponId}" is not in the player's inventory.`;
    }
    if (!slot.strikes?.length) return 'Every combat Attack needs a living target.';
    const strikeLimit = getAttackCount(state.character);
    if (slot.strikes.length > strikeLimit) {
        return `One Attack action currently allows ${strikeLimit} strike${strikeLimit === 1 ? '' : 's'}.`;
    }
    const missing = slot.strikes.find(strike => !findByRef(living, strike.target));
    if (missing) return `Attack target "${missing.target}" is not an active enemy in this fight.`;
    return null;
}

/** One validator per slot action that has rules of its own (dodge, dash, flee… have none). */
const SLOT_VALIDATORS = new Map([
    ['check', validateCheckSlot],
    ['save', validateCheckSlot],
    ['cast', validateCastSlot],
    ['channel', validateChannelSlot],
    ['attack', validateAttackSlot],
]);

function validatePlayerSlots(exchange, state) {
    const allSlots = exchange.playerSlots || [];
    const shapeError = validateTurnShape(allSlots, state);
    if (shapeError) return { ok: false, error: shapeError };
    const living = activeEnemies(state.combat?.enemies || []);
    for (const slot of allSlots) {
        const error = SLOT_VALIDATORS.get(slot.action)?.(slot, state, living);
        if (error) return { ok: false, error };
    }
    return { ok: true };
}

/** Resolve an enemy-side spell (attack rolls, engine-rolled saves, auto damage). */
function resolveEnemySpell({ character, enemies, events, rolls }, { spell, slotLevel, slot }) {
    // Dart spells (Magic Missile): 3 darts +1 per upcast level, each dart a
    // legal target — the player's declared split is honored (Codex 2026-08-09
    // P2: a legal two-wisp split was silently dumped into one wisp and the
    // narration invented a magnetic pull to cover it).
    const dartCount = spell.targeting.mode === 'darts'
        ? 3 + Math.max(0, (slotLevel || spell.level) - spell.level)
        : 0;
    const targetLimit = spell.targeting.mode === 'upTo3' ? 3 : (dartCount || 1);
    const named = castTargetRefs(slot)
        .map(target => findByRef(enemies, target))
        .filter(isEnemyActive);
    const uniqueNamed = [...new Map(named.map(enemy => [enemy.id, enemy])).values()];
    const targets = uniqueNamed.slice(0, targetLimit);
    if (targets.length === 0) {
        events.push({ type: 'note', text: `${spell.name} has no valid target and is not redirected.` });
        return;
    }
    if (uniqueNamed.length > targets.length) {
        // The DM over-targeted a limited spell; clamp instead of wasting the turn.
        events.push({ type: 'note', text: `${spell.name} affects ${targetLimit === 1 ? 'only one target' : `up to ${targetLimit} targets`} — resolved against ${targets.map(enemy => enemy.name).join(', ')}; the others are unaffected.` });
    }

    if (spell.resolution === 'attack') {
        for (const enemy of targets) {
            const ruling = rulingFlags(slot.situationalRuling);
            const modifiers = conditionAwareAttackModifiers(character.conditions, enemy.conditions, ruling.advantage, ruling.disadvantage || !!enemy.defending);
            const outcome = resolveAttackRoll({
                attacker: character,
                attackBonus: getSpellAttackBonus(character),
                description: `${character.name || 'Player'} casts ${spell.name} at ${enemy.name}`,
                modifiers,
                targetAc: enemy.ac,
                damage: { notation: spellDamageNotation(spell, character, slotLevel), description: `${spell.name} damage` },
                rolls,
            });
            if (outcome.hit) {
                enemy.hp = Math.max(0, enemy.hp - outcome.damage);
                enemy.condition = enemyHealthCondition(enemy.hp, enemy.maxHp);
                if (spell.condition && isEnemyActive(enemy)) {
                    applyEnemyConditionDelta(enemy, { add: [spell.condition], remove: [] }, events);
                }
            }
            events.push({
                type: 'attack', actor: character.name || 'Player', target: enemy.name,
                // Cantrips spend no slot and get no "casts X" note — without the
                // spell name here the result line reads as a weapon attack and
                // the cast is invisible (playtest #4: Sacred Flame showed as
                // "attacks ... Hit for 2" with nothing naming the spell).
                spellName: spell.name,
                rolled: outcome.attack.roll.total, natural: outcome.natural, dc: enemy.ac,
                mode: rollModeLabel(outcome.attack, modifiers, slot.situationalRuling),
                hit: outcome.hit, critical: outcome.critical, damage: outcome.damage,
                remainingHp: enemy.hp, maxHp: enemy.maxHp,
            });
        }
        return;
    }

    if (spell.resolution === 'save') {
        const dc = getSpellSaveDC(character);
        const notation = spellDamageNotation(spell, character, slotLevel);
        let damageRoll = null;
        if (notation) {
            // One damage roll shared by every target, 5e-style.
            damageRoll = rollDamage(notation, `${spell.name} damage`, {});
            rolls.push(damageRoll.roll);
        }
        for (const enemy of targets) {
            const save = rollEnemySave(enemy, `${enemy.name} saves vs ${spell.name}`);
            rolls.push(save.roll);
            const success = save.roll.total >= dc;
            events.push({
                type: 'save', actor: enemy.name, description: `save vs ${spell.name}`,
                rolled: save.roll.total, natural: save.natural, dc, success, mode: save.mode,
            });
            if (damageRoll) {
                const damage = success
                    ? (spell.saveEffect === 'half' ? Math.floor(damageRoll.total / 2) : 0)
                    : damageRoll.total;
                if (damage > 0) {
                    enemy.hp = Math.max(0, enemy.hp - damage);
                    enemy.condition = enemyHealthCondition(enemy.hp, enemy.maxHp);
                    events.push({
                        type: 'note',
                        text: `**${spell.name}** ${success ? 'grazes' : 'strikes'} ${enemy.name} for **${damage}** damage${success ? ' (half on the save)' : ''}. ${enemy.hp <= 0 ? `${enemy.name} is down.` : `${enemy.name} remains alive at ${enemy.hp}/${enemy.maxHp} HP.`}`,
                    });
                }
            }
            if (!success && spell.condition && isEnemyActive(enemy)) {
                applyEnemyConditionDelta(enemy, { add: [spell.condition], remove: [] }, events);
            }
        }
        return;
    }

    // Dart split: distribute the darts round-robin in DECLARED order (the
    // first-named foe takes any extras), one pooled roll per foe. Magic
    // Missile is the only darts spell — each dart is 1d4+1, so N darts on one
    // foe roll as Nd4+N (a single target gets the classic 3d4+3 unchanged).
    if (dartCount > 0) {
        targets.forEach((enemy, index) => {
            const darts = Math.floor(dartCount / targets.length) + (index < dartCount % targets.length ? 1 : 0);
            const damageRoll = rollDamage(`${darts}d4+${darts}`, `${spell.name} (${darts} dart${darts === 1 ? '' : 's'}) at ${enemy.name}`, {});
            rolls.push(damageRoll.roll);
            enemy.hp = Math.max(0, enemy.hp - damageRoll.total);
            enemy.condition = enemyHealthCondition(enemy.hp, enemy.maxHp);
            events.push({
                type: 'note',
                text: `**${spell.name}** sends ${darts} unerring dart${darts === 1 ? '' : 's'} into ${enemy.name} for **${damageRoll.total}** damage. ${enemy.hp <= 0 ? `${enemy.name} is down.` : `${enemy.name} remains alive at ${enemy.hp}/${enemy.maxHp} HP.`}`,
            });
        });
        return;
    }

    // Auto-hit damage: no roll to hit, only the effect dice.
    for (const enemy of targets) {
        const damageRoll = rollDamage(spellDamageNotation(spell, character, slotLevel), `${spell.name} damage`, {});
        rolls.push(damageRoll.roll);
        enemy.hp = Math.max(0, enemy.hp - damageRoll.total);
        enemy.condition = enemyHealthCondition(enemy.hp, enemy.maxHp);
        events.push({
            type: 'note',
            text: `**${spell.name}** strikes ${enemy.name} unerringly for **${damageRoll.total}** damage. ${enemy.hp <= 0 ? `${enemy.name} is down.` : `${enemy.name} remains alive at ${enemy.hp}/${enemy.maxHp} HP.`}`,
        });
    }
}

function stripConditionList(conditions, toRemove) {
    if (toRemove === 'any') return { kept: [], removed: [...(conditions || [])] };
    const removable = new Set(toRemove.map(condition => condition.toLowerCase()));
    const kept = [];
    const removed = [];
    for (const condition of conditions || []) {
        (removable.has(String(condition).toLowerCase()) ? removed : kept).push(condition);
    }
    return { kept, removed };
}

/**
 * Resolve a self/ally-side spell: healing, stabilizing, condition removal, and
 * sustained buffs. Mutates companion copies in place; player-side changes go
 * through `support.playerHealing` and `support.characterUpdates` so the reducer
 * applies them atomically with the exchange.
 */
function resolveSupportSpell({ character, companions, events, rolls }, support, { spell, slotLevel, slot }) {
    const updates = support.characterUpdates;
    const targetLimit = spell.targeting.mode === 'upTo3' ? 3 : 1;
    const refs = spell.targeting.side === 'self' ? ['self'] : castTargetRefs(slot, ['self']);
    if (refs.length > targetLimit) {
        events.push({ type: 'note', text: `${spell.name} affects ${targetLimit === 1 ? 'only one recipient' : `up to ${targetLimit} recipients`}; extra targets are unaffected.` });
    }
    const resolved = [];
    for (const targetRef of refs.slice(0, targetLimit)) {
        const ally = resolveAllyTarget(character, companions, targetRef);
        if (ally && !resolved.some(existing => existing.type === ally.type && existing.companion?.id === ally.companion?.id)) {
            resolved.push(ally);
        }
    }
    if (resolved.length === 0) {
        events.push({ type: 'note', text: `${spell.name} has no valid recipient.` });
        return;
    }

    for (const ally of resolved) {
        const allyName = ally.type === 'player' ? (character.name || 'the hero') : ally.companion.name;

        if (spell.healing) {
            const healRoll = rollDamage(spellHealingNotation(spell, character, slotLevel), `${spell.name} healing`, {});
            rolls.push(healRoll.roll);
            if (ally.type === 'player') {
                support.playerHealing += healRoll.total;
                const preview = Math.min(character.maxHP, (character.currentHP || 0) + support.playerHealing);
                events.push({ type: 'note', text: `**${spell.name}** — ${allyName} recovers **${healRoll.total}** HP (now ${preview}/${character.maxHP}).` });
            } else {
                const companion = ally.companion;
                const wasDown = (companion.hp ?? 0) <= 0;
                companion.hp = Math.min(companion.maxHp || companion.hp || 1, (companion.hp || 0) + healRoll.total);
                companion.status = healthWord(companion.hp, companion.maxHp, 'downed');
                events.push({ type: 'note', text: `**${spell.name}** — ${allyName} recovers **${healRoll.total}** HP (now ${companion.hp}/${companion.maxHp})${wasDown ? ' and is back on their feet' : ''}.` });
            }
            continue;
        }

        // No `stabilizes` lane here: Spare the Dying is out-of-combat only
        // (DECISIONS.md 2026-09-04) — companions never bleed out, so the old
        // in-combat note was decorative.

        if (spell.removeConditions) {
            if (ally.type === 'player') {
                const { removed } = stripConditionList(character.conditions, spell.removeConditions);
                if (removed.length > 0) {
                    updates.removeConditions = [...(updates.removeConditions || []), ...removed];
                    events.push({ type: 'note', text: `**${spell.name}** — ${allyName} is cleansed of: ${removed.join(', ')}.` });
                } else {
                    events.push({ type: 'note', text: `**${spell.name}** — ${allyName} has no affliction it can lift.` });
                }
            } else {
                const { kept, removed } = stripConditionList(ally.companion.conditions, spell.removeConditions);
                ally.companion.conditions = kept;
                events.push({
                    type: 'note',
                    text: removed.length > 0
                        ? `**${spell.name}** — ${allyName} is cleansed of: ${removed.join(', ')}.`
                        : `**${spell.name}** — ${allyName} has no affliction it can lift.`,
                });
            }
            continue;
        }

        if (spell.sustained) {
            clearPreviousSustained({ character, companions, updates, events });
            const sustained = {
                key: spell.key,
                name: spell.name,
                ...(spell.acBonus && { acBonus: spell.acBonus }),
                ...(spell.condition && { condition: spell.condition }),
                targetType: ally.type === 'player' ? 'self' : 'companion',
                ...(ally.type === 'companion' && { targetId: ally.companion.id, targetName: ally.companion.name }),
            };
            updates.sustainedSpell = sustained;
            if (ally.type === 'companion') {
                if (spell.acBonus) ally.companion.spellAcBonus = spell.acBonus;
                if (spell.condition) {
                    ally.companion.conditions = normalizeEnemyConditions([...(ally.companion.conditions || []), spell.condition]);
                }
            } else if (spell.condition) {
                updates.addConditions = [...(updates.addConditions || []), spell.condition];
            }
            events.push({ type: 'note', text: `**${spell.name}** settles over ${allyName}${spell.acBonus ? ` (+${spell.acBonus} AC)` : ''} — it holds until ${character.name || 'the caster'} sustains something else, rests, or the fight ends.` });
            continue;
        }

        events.push({ type: 'note', text: `**${spell.name}** is cast; its effect plays out in the fiction.` });
    }
}

/** End the caster's previous sustained spell (one sustained effect at a time). */
function clearPreviousSustained({ character, companions, updates, events }) {
    const previous = updates.sustainedSpell !== undefined ? updates.sustainedSpell : character.sustainedSpell;
    if (!previous) return;
    if (previous.targetType === 'companion') {
        const companion = companions.find(c => c.id === previous.targetId);
        if (companion) {
            delete companion.spellAcBonus;
            if (previous.condition) {
                companion.conditions = (companion.conditions || []).filter(c => String(c).toLowerCase() !== String(previous.condition).toLowerCase());
            }
        }
    } else if (previous.condition) {
        updates.removeConditions = [...(updates.removeConditions || []), previous.condition];
    }
    events.push({ type: 'note', text: `${previous.name || previous.key} fades as the new spell takes hold.` });
}

// ─── The player phase: one resolver per slot action ─────────────────────────
// Each takes the exchange context (`ctx`: the live working copies every phase
// shares — character, inventory, party, enemies, companions, events, the
// hero's roll list) and the player's `turn` (what this phase accumulates for
// the commit: dodge / flee flags, the death-save die, healing and character
// updates, the slots a second cast must not double-spend).

function resolveDodgeSlot({ character, events }, turn) {
    turn.dodging = true;
    events.push({ type: 'note', text: `${character.name || 'The player'} takes the Dodge action.` });
}

function resolveFleeSlot({ character, events }, turn) {
    turn.fled = true;
    events.push({ type: 'note', text: `${character.name || 'The player'} escapes the fight.` });
}

function resolveDeathSaveSlot({ character, companions, events, rolls }, turn) {
    // The save is the dying hero's decision point. Low-level solo at
    // this moment (a downed companion counts as solo) means the reducer's
    // DEATH_SAVE_RESULT converts the save into the defeat setback and
    // rolls nothing — so the engine rolls nothing, posts no death-save
    // line, and advances no tally either. Diverging here soft-locked the
    // fight (2026-09-02 audit P1: terminal 'dying' beside a reducer-side
    // lowLevelDefeat hero who could never commit another action).
    if (isLowLevelSolo(character, companions)) {
        turn.deathSaveSkipped = true;
        events.push({ type: 'note', text: `**Death save skipped** — no battle-ready ally stands with ${character.name || 'the player'}; low-level solo protection ends this as a defeat setback, not a death.` });
        return;
    }
    const save = rollWithModifier(1, 20, 0, 'Death Saving Throw');
    rolls.push(save);
    turn.deathSaveNatural = save.rolls[0];
    // The event carries the judged outcome and the post-save tally so
    // the chat line reads as a countdown (WOW 2026-09-30); the reducer's
    // DEATH_SAVE_RESULT judges the same die through the same judge.
    const judged = judgeDeathSave(character.deathSaves, turn.deathSaveNatural);
    events.push({
        type: 'death_save',
        natural: turn.deathSaveNatural,
        actor: character.name || 'The player',
        outcome: judged.outcome,
        successes: judged.successes,
        failures: judged.failures,
    });
}

function resolveSecondWindSlot({ character, events, rolls }, turn) {
    // Player-invoked bonus action, validated upstream; the soft guard here
    // keeps a stale envelope from double-spending (the channel pattern).
    const resources = turn.characterUpdates.classResources || character.classResources || {};
    const res = resources.secondWind;
    if (!res || res.used >= res.max) {
        events.push({ type: 'note', text: 'Second Wind is already spent; nothing happens.' });
        return;
    }
    const heal = rollWithModifier(1, 10, character.level || 1, 'Second Wind (bonus action)');
    rolls.push(heal);
    turn.playerHealing += heal.total;
    turn.characterUpdates.classResources = { ...resources, secondWind: { ...res, used: res.used + 1 } };
    const preview = Math.min(character.maxHP, (character.currentHP || 0) + turn.playerHealing);
    events.push({ type: 'note', text: `**${character.name || 'The player'} catches a Second Wind** *(bonus action)* — recovering **${heal.total} HP** (now ${preview}/${character.maxHP}). Their main action is unaffected.` });
}

function resolveCastSlot(ctx, turn, slot) {
    const { character, events } = ctx;
    const spell = resolveCastSpell(character, slot);
    if (!spell) {
        events.push({ type: 'note', text: `${slot.spell || 'The spell'} is not on the engine-owned spell list; nothing happens.` });
        return;
    }
    let slotLevel = 0;
    if (spell.level > 0) {
        slotLevel = chooseSlotLevel(turn.spellSlots, spell, slot.slotLevel);
        if (slotLevel === null) {
            events.push({ type: 'note', text: `${spell.name} fizzles — no spell slot remains to pay for it.` });
            return;
        }
        turn.spellSlots = spendSpellSlot(turn.spellSlots, slotLevel);
        turn.characterUpdates.spellSlots = turn.spellSlots;
        events.push({
            type: 'note',
            text: `**${character.name || 'Player'} casts ${spell.name}**${slotLevel > spell.level ? ` using a level ${slotLevel} slot` : ''} (slots left: ${summarizeSpellSlots(turn.spellSlots)}).`,
        });
    }
    if (spell.targeting.side === 'enemy') {
        resolveEnemySpell(ctx, { spell, slotLevel, slot });
    } else {
        resolveSupportSpell(ctx, turn, { spell, slotLevel, slot });
    }
}

/** Channel Divinity — Turn Undead (and Destroy Undead from level 5). */
function resolveChannelSlot({ character, enemies, events, rolls }, turn) {
    const channel = character.classResources?.channelDivinity;
    if (!channel || channel.used >= channel.max) {
        events.push({ type: 'note', text: 'Channel Divinity is already spent; nothing happens.' });
        return;
    }
    turn.characterUpdates.classResources = {
        ...character.classResources,
        channelDivinity: { ...channel, used: channel.used + 1 },
    };
    const dc = getSpellSaveDC(character);
    events.push({ type: 'note', text: `**${character.name || 'Player'} presents their holy symbol — Turn Undead** (save DC ${dc}).` });
    for (const enemy of enemies) {
        if (!isEnemyActive(enemy) || !enemy.isUndead) continue;
        const save = rollEnemySave(enemy, `${enemy.name} saves vs Turn Undead`);
        rolls.push(save.roll);
        const success = save.roll.total >= dc;
        events.push({
            type: 'save', actor: enemy.name, description: 'save vs Turn Undead',
            rolled: save.roll.total, natural: save.natural, dc, success, mode: save.mode,
        });
        if (success) continue;
        if ((character.level || 1) >= 5 && (enemy.maxHp || 0) <= 20) {
            enemy.hp = 0;
            enemy.condition = 'dead';
            events.push({ type: 'note', text: `**${enemy.name} is destroyed outright by the divine radiance.**` });
        } else {
            applyEnemyConditionDelta(enemy, { add: ['frightened'], remove: [] }, events);
        }
    }
}

/** A check or a save: the hero's d20 through THE modifier ladder (rules.js). */
function resolveCheckSlot({ character, inventory, enemies, events, rolls }, turn, slot) {
    const isSave = slot.action === 'save';
    // `slot.skill` is already the canonical key (combatWire's slotRollKey) —
    // never lowercase it again: `sleightofhand` is an unknown skill (+0).
    const { modifier, kind } = resolvePlayerRollModifier(character, inventory, {
        type: isSave ? 'saving_throw' : 'skill_check',
        skill: slot.skill,
    });
    const conditionEffects = getConditionRollEffects(character.conditions, kind);
    const ruling = rulingFlags(slot.situationalRuling);
    const modifiers = combineRollModifiers(ruling.advantage, ruling.disadvantage, conditionEffects);
    const description = slot.description || `${slot.skill} ${slot.action}`;
    const roll = rollD20(modifier, description, modifiers.advantage, modifiers.disadvantage);
    rolls.push(roll.roll);
    const success = roll.natural === 20 || roll.roll.total >= slot.dc;
    events.push({
        type: slot.action,
        actor: character.name || 'Player',
        description,
        rolled: roll.roll.total,
        natural: roll.natural,
        dc: slot.dc,
        success,
        mode: rollModeLabel(roll, modifiers, slot.situationalRuling),
    });
    if (success && !isSave && slot.onSuccess) {
        const enemy = findByRef(enemies, slot.onSuccess.target);
        // Same-exchange ordering can down the target before the check
        // resolves — a condition never lands on a dead foe.
        if (isEnemyActive(enemy)) applyEnemyConditionDelta(enemy, slot.onSuccess, events);
    }
}

/** The weapon the slot names counts as the equipped one for this Attack action. */
function attackInventoryFor(inventory, weaponId) {
    if (!weaponId) return inventory;
    const isWeapon = item => item.type === 'weapon' || item.category?.toLowerCase().includes('melee') || item.category?.toLowerCase().includes('ranged');
    return inventory.map(item => ({
        ...item,
        equipped: isWeapon(item)
            ? item.id === weaponId || item.name?.toLowerCase() === weaponId.toLowerCase()
            : item.equipped,
    }));
}

function resolveAttackSlot({ state, character, inventory, enemies, events, rolls, standingFlankIds }, turn, slot) {
    const attackInventory = attackInventoryFor(inventory, slot.weaponId);
    const strikeLimit = getAttackCount(character);
    const strikes = [...slot.strikes];
    while (strikes.length < strikeLimit) strikes.push({ ...strikes[strikes.length - 1] });
    for (const strike of strikes) {
        const enemy = findByRef(enemies, strike.target);
        if (!isEnemyActive(enemy)) {
            events.push({ type: 'note', text: `${enemy?.name || strike.target} has already been overcome; the unused strike does not retarget without player intent.` });
            continue;
        }
        // A standing flank persists between exchanges; a slot's own ruling replaces it.
        const appliedRuling = slot.situationalRuling
            || (standingFlankIds?.has(enemy.id) ? STANDING_FLANK_RULING : null);
        const ruling = rulingFlags(appliedRuling);
        const modifiers = conditionAwareAttackModifiers(character.conditions, enemy.conditions, ruling.advantage, ruling.disadvantage || !!enemy.defending);
        const outcome = resolveAttackRoll({
            attacker: character,
            attackBonus: getWeaponAttackBonus(character, attackInventory),
            description: `${character.name || 'Player'} attacks ${enemy.name}`,
            modifiers,
            targetAc: enemy.ac,
            damage: {
                notation: getWeaponDamageNotation(character, attackInventory, '1d4'),
                description: `Damage to ${enemy.name}`,
                options: {
                    character,
                    inventory: attackInventory,
                    advantage: modifiers.advantage,
                    disadvantage: modifiers.disadvantage,
                    hasAlly: (state.party || []).some(isCompanionActive),
                },
            },
            rolls,
        });
        if (outcome.hit) {
            enemy.hp = Math.max(0, enemy.hp - outcome.damage);
            enemy.condition = enemyHealthCondition(enemy.hp, enemy.maxHp);
        }
        events.push({
            type: 'attack', actor: character.name || 'Player', target: enemy.name,
            rolled: outcome.attack.roll.total, natural: outcome.natural, dc: enemy.ac,
            mode: rollModeLabel(outcome.attack, modifiers, appliedRuling),
            hit: outcome.hit, critical: outcome.critical, damage: outcome.damage,
            remainingHp: enemy.hp, maxHp: enemy.maxHp,
            sneakAttackDetail: outcome.damageRoll?.sneakAttackDetail ?? null,
        });
    }
}

/** Dash, disengage, interact, pass have no dice — they ride the generic note. */
const PLAYER_SLOT_RESOLVERS = new Map([
    ['dodge', resolveDodgeSlot],
    ['flee', resolveFleeSlot],
    ['death_save', resolveDeathSaveSlot],
    ['second_wind', resolveSecondWindSlot],
    ['cast', resolveCastSlot],
    ['channel', resolveChannelSlot],
    ['check', resolveCheckSlot],
    ['save', resolveCheckSlot],
    ['attack', resolveAttackSlot],
]);

function resolvePlayerSlots(ctx) {
    const turn = {
        dodging: false,
        fled: false,
        deathSaveNatural: null,
        deathSaveSkipped: false,
        playerHealing: 0,
        characterUpdates: {},
        spellSlots: ctx.character.spellSlots || null,
    };
    for (const slot of ctx.exchange.playerSlots) {
        const resolve = PLAYER_SLOT_RESOLVERS.get(slot.action);
        if (resolve) resolve(ctx, turn, slot);
        else ctx.events.push({ type: 'note', text: `${ctx.character.name || 'The player'} uses their action to ${slot.action}.` });
    }
    return {
        dodging: turn.dodging,
        fled: turn.fled,
        deathSaveNatural: turn.deathSaveNatural,
        deathSaveSkipped: turn.deathSaveSkipped,
        playerHealing: turn.playerHealing,
        characterUpdates: Object.keys(turn.characterUpdates).length > 0 ? turn.characterUpdates : null,
    };
}

// Companion magic-weapon bonus (COMPANION_GEAR_SPEC.md D4): a flat additive field set by
// the reducer when a gifted weapon carries +1..+3, consumed here at roll time — the
// spellAcBonus pattern. Absent on pre-gear saves ⇒ 0.
function companionWeaponBonus(companion) {
    const n = Number(companion?.weaponBonus);
    if (!Number.isFinite(n) || n <= 0) return 0;
    return Math.min(3, Math.trunc(n));
}

// Fold the magic bonus into the damage notation so the dice log shows the true roll
// ('1d8+2' with a +1 weapon rolls as '1d8+3').
function companionDamageNotation(companion) {
    const notation = String(companion.damage || '1d4+1');
    const bonus = companionWeaponBonus(companion);
    if (!bonus) return notation;
    const match = notation.trim().match(/^(.*?)([+-]\d+)\s*$/);
    if (match) {
        const combined = Number(match[2]) + bonus;
        return combined === 0 ? match[1] : `${match[1]}${combined >= 0 ? '+' : ''}${combined}`;
    }
    return `${notation.trim()}+${bonus}`;
}

function resolveCompanionAttack({ companion, target, events, situationalRuling = null, flankingEnemyIds = null }) {
    const ruling = rulingFlags(situationalRuling);
    // Propagate explicit player flanking only when the companion has no separate ruling.
    const companionFlanking = !situationalRuling && (flankingEnemyIds?.has(target.id) ?? false);
    const effectiveRuling = companionFlanking
        ? { mode: 'advantage', reason: 'flanking' }
        : situationalRuling;
    const modifiers = conditionAwareAttackModifiers(companion.conditions, target.conditions, ruling.advantage || companionFlanking, ruling.disadvantage || !!target.defending);
    // Numeric belt (2026-09-09 audit P1): a string attackBonus from a pre-fix
    // save concatenated ("+4" + 0 → "+40") and threw out of EVERY exchange —
    // a deadlock, since rests and companion removal are refused mid-fight.
    const baseAttackBonus = Number(companion.attackBonus);
    const outcome = resolveAttackRoll({
        attackBonus: (Number.isFinite(baseAttackBonus) ? baseAttackBonus : 2) + companionWeaponBonus(companion),
        description: `${companion.name} attacks ${target.name}`,
        modifiers,
        targetAc: target.ac,
        damage: { notation: companionDamageNotation(companion), description: `${companion.name} damage` },
    });
    if (outcome.hit) {
        target.hp = Math.max(0, target.hp - outcome.damage);
        target.condition = enemyHealthCondition(target.hp, target.maxHp);
    }
    events.push({
        type: 'attack', actor: companion.name, target: target.name, rolled: outcome.attack.roll.total,
        natural: outcome.natural, dc: target.ac, mode: rollModeLabel(outcome.attack, modifiers, effectiveRuling),
        hit: outcome.hit, critical: outcome.critical, damage: outcome.damage,
        remainingHp: target.hp, maxHp: target.maxHp,
    });
}

function resolveCompanions({ exchange, enemies, companions, events }, { onlyIds = null, flankingEnemyIds = null } = {}) {
    const intents = new Map();
    for (const intent of exchange?.companionIntents || []) {
        const companion = findByRef(companions, intent.companionId);
        if (companion && !intents.has(companion.id)) intents.set(companion.id, intent);
    }
    for (const companion of companions) {
        if (!isCompanionActive(companion)) continue;
        if (onlyIds && !onlyIds.has(companion.id)) continue;
        const intent = intents.get(companion.id) || { action: 'attack', target: activeEnemies(enemies)[0]?.id };
        if (intent.action === 'pass') {
            events.push({ type: 'note', text: `${companion.name} holds position.` });
            continue;
        }
        if (intent.action === 'defend') {
            companion.defending = true;
            events.push({ type: 'note', text: `${companion.name} takes a defensive stance.` });
            continue;
        }
        if (intent.action === 'guard') {
            // An incapacitated companion cannot throw themselves in front of anyone.
            const guardBlocked = getIncapacitatingCondition(companion.conditions);
            if (guardBlocked) {
                events.push({ type: 'note', text: `${companion.name} is ${guardBlocked} and cannot guard the hero.` });
                continue;
            }
            companion.guarding = true;
            events.push({ type: 'note', text: `${companion.name} gives up their attack to shield the hero — enemy attacks aimed at the hero this exchange strike ${companion.name} instead.` });
            continue;
        }
        const targets = activeEnemies(enemies);
        let target = intent.target ? findByRef(targets, intent.target) : targets[0];
        if (!target && intent.target && targets.length > 0) {
            target = targets[0];
            events.push({ type: 'note', text: `${companion.name}'s target is down; retargeting to ${target.name}.` });
        }
        if (!target) {
            events.push({ type: 'note', text: `${companion.name} has no valid target and holds position.` });
            continue;
        }
        resolveCompanionAttack({ companion, target, events, situationalRuling: intent.situationalRuling, flankingEnemyIds });
    }
}

function resolveEnemyAttack({ enemy, targetRef, character, playerAc, companions, playerHp, playerDodging, situationalRuling, events, uncannyDodgeState }) {
    let targetType = 'player';
    let target = character;
    let targetName = character.name || 'Player';
    let targetAc = playerAc;
    let targetDisadvantage = playerDodging;
    let targetConditions = character.conditions;
    let intercepted = false;

    const wantsPlayer = !targetRef || targetRef === 'player';
    // A guarding companion bodily screens the hero: attacks aimed at the player are
    // redirected into the guardian, re-checked per attack so a guardian who drops
    // mid-round stops screening and later blows reach the hero again.
    const guardian = wantsPlayer && playerHp > 0 && !character.isDead && !character.lowLevelDefeat
        ? companions.find(companion => isCompanionActive(companion) && companion.guarding) || null
        : null;

    if (!wantsPlayer || guardian) {
        const companion = guardian || findByRef(companions, targetRef);
        if (!isCompanionActive(companion)) {
            events.push({ type: 'note', text: `${enemy.name}'s declared target is unavailable; its action is dropped rather than silently redirected.` });
            return { playerHp, playerDamage: 0 };
        }
        targetType = 'companion';
        target = companion;
        targetName = companion.name;
        targetAc = (companion.ac ?? 10) + (companion.spellAcBonus || 0);
        targetDisadvantage = !!companion.defending;
        targetConditions = companion.conditions;
        intercepted = !!guardian;
    } else if (playerHp <= 0 || character.isDead || character.lowLevelDefeat) {
        events.push({ type: 'note', text: `${enemy.name} does not make another attack against the already-defeated player.` });
        return { playerHp, playerDamage: 0 };
    }

    const ruling = rulingFlags(situationalRuling);
    const modifiers = conditionAwareAttackModifiers(enemy.conditions, targetConditions, ruling.advantage, ruling.disadvantage || targetDisadvantage);
    const outcome = resolveAttackRoll({
        attackBonus: validateEnemyAttackBonus(enemy.attackBonus) ?? ENEMY_DEFAULT_ATTACK_BONUS,
        description: `${enemy.name} attacks ${targetName}`,
        modifiers,
        targetAc,
        damage: { notation: sanitizeEnemyDamage(enemy.damage) || ENEMY_DEFAULT_DAMAGE, description: `${enemy.name} damage` },
    });
    let damage = outcome.damage;
    let uncannyDodgeApplied = false;
    if (outcome.hit) {
        if (targetType === 'player') {
            const dodge = applyUncannyDodge(character, damage, uncannyDodgeState);
            damage = dodge.damage;
            uncannyDodgeApplied = dodge.applied;
            playerHp = Math.max(0, playerHp - damage);
        } else {
            target.hp = Math.max(0, target.hp - damage);
            target.status = healthWord(target.hp, target.maxHp, 'downed');
        }
    }
    events.push({
        type: 'attack', actor: enemy.name, target: targetName, rolled: outcome.attack.roll.total,
        natural: outcome.natural, dc: targetAc,
        mode: rollModeLabel(outcome.attack, modifiers, situationalRuling),
        hit: outcome.hit, critical: outcome.critical, damage,
        remainingHp: targetType === 'player' ? playerHp : target.hp,
        maxHp: targetType === 'player' ? character.maxHP : target.maxHp,
        uncannyDodgeApplied,
        ...(intercepted && { intercepted: true }),
    });
    return { playerHp, playerDamage: targetType === 'player' ? damage : 0 };
}

/**
 * The enemy phase. `character` is the hero AS THE FOES MEET THEM — after this
 * exchange's casts (a new AC, a condition) and after a natural-20 revive.
 */
function resolveEnemies({ exchange, inventory, enemies, companions, events }, { character, playerHp, playerDodging, onlyIds = null, uncannyDodgeState = null }) {
    const intents = new Map();
    for (const intent of exchange?.enemyIntents || []) {
        const enemy = findByRef(enemies, intent.enemyId);
        if (enemy && !intents.has(enemy.id)) intents.set(enemy.id, intent);
    }
    let playerDamage = 0;
    // Uncanny Dodge is once per TURN, not once per resolveEnemies call. Callers that
    // resolve the same turn across multiple calls (planOpeningExchange goes actor by
    // actor) must pass one shared state object for the whole turn.
    uncannyDodgeState = uncannyDodgeState || { used: false };
    // Character and inventory are fixed for the duration of this call, so the
    // hero's AC is computed once instead of per enemy attack.
    const playerAc = computeACFromInventory(inventory, character) ?? character.armorClass ?? 10;
    for (const enemy of enemies) {
        if (!isEnemyActive(enemy)) continue;
        if (onlyIds && !onlyIds.has(enemy.id)) continue;
        const intent = intents.get(enemy.id) || { action: 'attack', target: 'player' };
        if (intent.removeConditions?.length) {
            applyEnemyConditionDelta(enemy, { remove: intent.removeConditions, add: [] }, events);
        }
        // An incapacitated foe loses its action entirely — stunned/paralyzed/
        // unconscious would otherwise attack at full effectiveness. The DM's escape
        // hatch is remove_conditions, applied above, immediately before the action.
        const incapacitated = getIncapacitatingCondition(enemy.conditions);
        if (incapacitated) {
            enemy.defending = false;
            events.push({ type: 'note', text: `${enemy.name} is ${incapacitated} and cannot act.` });
            continue;
        }
        if (intent.action === 'defend') {
            enemy.defending = true;
            events.push({ type: 'note', text: `${enemy.name} defends and gives up its attack.` });
            continue;
        }
        if (intent.action === 'flee') {
            enemy.combatStatus = 'fled';
            enemy.defending = false;
            events.push({ type: 'note', text: `${enemy.name} flees and is overcome as a threat.` });
            continue;
        }
        if (intent.action === 'surrender') {
            enemy.combatStatus = 'surrendered';
            enemy.defending = false;
            events.push({ type: 'note', text: `${enemy.name} surrenders and leaves the fight.` });
            continue;
        }
        const resolved = resolveEnemyAttack({
            enemy,
            targetRef: intent.target,
            character,
            playerAc,
            companions,
            playerHp,
            playerDodging,
            situationalRuling: intent.situationalRuling,
            events,
            uncannyDodgeState,
        });
        playerHp = resolved.playerHp;
        playerDamage += resolved.playerDamage;
    }
    return { playerHp, playerDamage };
}

/** Same-exchange projection of a natural-20 revive (the reducer's reviveCharacter shape). */
function projectRevivedCharacter(character) {
    return {
        ...character,
        currentHP: 1,
        dying: false,
        lowLevelDefeat: false,
        deathSaves: { successes: 0, failures: 0 },
        conditions: (character.conditions || []).filter(condition => String(condition).toLowerCase() !== 'unconscious'),
    };
}

const FRESH_TALLY = Object.freeze({ successes: 0, failures: 0 });

/**
 * The hero's state AFTER the exchange, for `postState.player` (WOW
 * 2026-09-30, death-and-stakes): `status` in PLAYER_SNAPSHOT_STATUSES plus
 * the death-save tally as the reducer will hold it once the commit lands.
 * THE judge of the hero's fate in an exchange — `terminalState` reads its
 * `status`, it never re-derives one. The party is the one that stood at the
 * hero's decision point: a still-dying hero is judged at the death save
 * against the party as it stood (`partyAtSave` — the same one the reducer's
 * DEATH_SAVE_RESULT consults, since it runs before the exchange's party
 * commit); a conscious or just-revived hero dropping to 0 against the
 * post-exchange party (`partyAfter` — the reducer commits the party before
 * TAKE_DAMAGE) — so the snapshot never says `dying` beside a reducer that
 * converted the moment into the low-level defeat setback.
 */
function projectPlayerSnapshot({
    character,
    playerHp = null,
    deathSaveNatural = null,
    deathSaveSkipped = false,
    partyAtSave = [],
    partyAfter = [],
}) {
    const hp = Number.isFinite(playerHp) ? playerHp : (character.currentHP ?? 0);
    const held = normalizeDeathSaves(character.deathSaves);
    if (character.isDead) return { status: 'dead', deathSaves: held };
    if (character.lowLevelDefeat) return { status: 'defeated', deathSaves: held };
    if (character.dying) {
        if (deathSaveSkipped || isLowLevelSolo(character, partyAtSave)) return { status: 'defeated', deathSaves: held };
        const judged = judgeDeathSave(character.deathSaves, deathSaveNatural);
        if (!judged) return { status: 'dying', deathSaves: held };
        const saves = { successes: judged.successes, failures: judged.failures };
        if (judged.outcome === 'dead') return { status: 'dead', deathSaves: saves };
        if (judged.outcome === 'stable') return { status: 'stable', deathSaves: saves };
        if (judged.outcome === 'revived') {
            if (hp > 0) return { status: 'revived', deathSaves: { ...FRESH_TALLY } };
            // Dropped again after the revive — a fresh clock, judged like any
            // conscious hero's drop (the reducer's TAKE_DAMAGE order).
            return isLowLevelSolo(character, partyAfter)
                ? { status: 'defeated', deathSaves: { ...FRESH_TALLY } }
                : { status: 'dying', deathSaves: { ...FRESH_TALLY } };
        }
        return { status: 'dying', deathSaves: saves };
    }
    if (hp > 0) return { status: 'active', deathSaves: { ...FRESH_TALLY } };
    return isLowLevelSolo(character, partyAfter)
        ? { status: 'defeated', deathSaves: { ...FRESH_TALLY } }
        : { status: 'dying', deathSaves: { ...FRESH_TALLY } };
}

/** What the hero's post-exchange status means for the fight. */
const TERMINAL_BY_PLAYER_STATUS = Object.freeze({
    active: null,
    revived: null,
    dying: 'dying',
    // Stable is unconscious at 0 HP with foes still standing: the fight is lost.
    stable: 'defeat',
    defeated: 'defeat',
    dead: 'defeat',
});

/**
 * The exchange's terminal: victory when no foe is left, else whatever the
 * hero's snapshot says. One judge (`projectPlayerSnapshot`), one table —
 * until 2026-10-05 this function re-derived the dying / defeat / revive
 * branches beside a snapshot whose doc promised to "mirror" it.
 */
function terminalState(enemies, playerStatus) {
    if (activeEnemies(enemies).length === 0) return 'victory';
    return TERMINAL_BY_PLAYER_STATUS[playerStatus] ?? null;
}

/**
 * Merge a cast's character updates (spell slots, sustained spell, resources,
 * condition deltas) into a character object. Shared by the exchange planner
 * (same-turn preview so enemy attacks see the new AC/conditions) and the
 * reducer's APPLY_COMBAT_EXCHANGE commit.
 */
export function mergeCharacterUpdates(character, updates) {
    if (!updates) return character;
    const { addConditions = [], removeConditions = [], ...direct } = updates;
    const next = { ...character, ...direct };
    let conditions = next.conditions || [];
    if (removeConditions.length > 0) {
        const removable = new Set(removeConditions.map(c => String(c).toLowerCase()));
        conditions = conditions.filter(c => !removable.has(String(c).toLowerCase()));
    }
    if (addConditions.length > 0) {
        const existing = new Set(conditions.map(c => String(c).toLowerCase()));
        conditions = [...conditions, ...addConditions.filter(c => !existing.has(String(c).toLowerCase()))];
    }
    return { ...next, conditions };
}

// ─── The planners ───────────────────────────────────────────────────────────

/**
 * The exchange context: the working copies ONE exchange resolves against,
 * cloned once and handed to every phase (it used to ride as five loose
 * arguments through three layers). `rolls` collects the HERO's own dice only —
 * the roll ledger is the hero's (2026-09-21), so the companion and enemy
 * phases keep no roll list at all; their dice are on the result lines.
 */
function openExchange(state, exchange) {
    return {
        state,
        exchange,
        character: state.character,
        inventory: state.inventory || [],
        enemies: (state.combat.enemies || []).map(enemy => ({ ...enemy })),
        // Stances are declared per exchange: stale defend / guard flags must
        // not carry over, and a fresh fight starts with none.
        companions: (state.party || []).map(companion => ({ ...companion, defending: false, guarding: false })),
        events: [],
        rolls: [],
        standingFlankIds: null,
    };
}

/** A DM condition sync (never an intent), applied to the working enemy copies. */
function applyConditionSync({ enemies, events }, updates) {
    for (const update of updates || []) {
        const enemy = findByRef(enemies, update.target);
        if (isEnemyActive(enemy)) applyEnemyConditionDelta(enemy, update, events);
    }
}

/**
 * Standing flanks: an accepted flanking ruling persists engine-side between
 * exchanges — the DM kept forgetting to re-emit it each round. The DM ends one
 * with flank_broken when the fiction repositions; enemies leaving the fight,
 * the hero dashing/disengaging away, or the last companion dropping also end it.
 */
function carryStandingFlanks({ state, exchange, enemies, events }) {
    const standing = new Set((state.combat.flankedEnemyIds || [])
        .filter(id => isEnemyActive(enemies.find(enemy => enemy.id === id))));
    for (const target of exchange.flankBroken || []) {
        const enemy = findByRef(enemies, target);
        if (enemy && standing.delete(enemy.id)) {
            events.push({ type: 'note', text: `The flank on ${enemy.name} is broken — the standing advantage ends.` });
        }
    }
    return standing;
}

/**
 * The enemies the player explicitly flanked this exchange, on top of any
 * standing flanks carried over from earlier exchanges. Other situational
 * advantage sources, such as concealment or distraction, stay local to the actor.
 */
function establishFlanks({ exchange, enemies, events, standingFlankIds }) {
    const flanking = new Set(standingFlankIds);
    for (const slot of exchange.playerSlots || []) {
        if (slot.action !== 'attack' || !isSharedFlankingRuling(slot.situationalRuling)) continue;
        const targeted = new Set((slot.strikes || [])
            .map(strike => findByRef(enemies, strike.target)?.id)
            .filter(Boolean));
        if (targeted.size !== 1) continue;
        const targetId = [...targeted][0];
        if (flanking.has(targetId)) continue;
        flanking.add(targetId);
        const flanked = enemies.find(enemy => enemy.id === targetId);
        if (isEnemyActive(flanked)) {
            events.push({ type: 'note', text: `**Flanking established against ${flanked.name}** — the advantage persists until the flank breaks.` });
        }
    }
    return flanking;
}

/**
 * The flanks that stand for the next exchange. Repositioning by the hero
 * (dash/disengage) abandons the pincer; a party whose every companion is down
 * has nobody left to hold the far side (a companionless party keeps a
 * DM-adjudicated flank — the second threat is an untracked NPC — until the DM
 * breaks it). Enemies overcome this exchange fall out of the list.
 */
function persistFlanks({ exchange, enemies, companions }, flankingEnemyIds) {
    const playerLeftMelee = (exchange.playerSlots || []).some(slot => slot.action === 'dash' || slot.action === 'disengage');
    const flankHoldersRemain = companions.length === 0 || companions.some(isCompanionActive);
    if (playerLeftMelee || !flankHoldersRemain) return [];
    return [...flankingEnemyIds].filter(id => isEnemyActive(enemies.find(enemy => enemy.id === id)));
}

/**
 * Close an exchange: judge the hero's post-state ONCE, read the terminal off
 * it, and build the stored result and the reducer's payload. Every plan branch
 * ends here, so every payload carries every key — the literal used to be
 * written out three times, and the opening copy silently omitted five of
 * fourteen. An opening simply takes the defaults (no player phase, no hero
 * dice, no standing flank, nothing spent).
 *
 * `player` is resolvePlayerSlots' result; `terminal` forces one (a fled hero
 * has `escaped`, whatever the field looks like).
 */
function sealExchange(ctx, {
    kind,
    exchangeId,
    playerHp,
    player = null,
    terminal: forcedTerminal = null,
    playerDamage = 0,
    flankedEnemyIds = [],
    bonusActionUsed = false,
    consumeActionSurge = false,
}) {
    const { state, enemies, companions, events } = ctx;
    const snapshot = projectPlayerSnapshot({
        character: state.character,
        playerHp,
        deathSaveNatural: player?.deathSaveNatural ?? null,
        deathSaveSkipped: player?.deathSaveSkipped ?? false,
        partyAtSave: state.party || [],
        partyAfter: companions,
    });
    const terminal = forcedTerminal || terminalState(enemies, snapshot.status);
    const result = makeResult(kind, exchangeId, state.combat.round, events, terminal, {
        enemies,
        companions,
        character: state.character,
        playerHp,
        player: snapshot,
    });
    return {
        ok: true,
        payload: {
            exchangeId,
            enemies,
            party: companions,
            playerDamage,
            playerHealing: player?.playerHealing ?? 0,
            characterUpdates: player?.characterUpdates ?? null,
            deathSaveNatural: player?.deathSaveNatural ?? null,
            deathSaveSkipped: player?.deathSaveSkipped ?? false,
            // The roll LEDGER keeps the hero's own dice only (2026-09-21 audit
            // P2): an exchange rolls ~10 dice (every actor's attack AND
            // damage), so one five-exchange fight evicted every check the
            // campaign ever rolled from the 50-row ledger the recall lane
            // answers "what did I roll to…" from. Every die is on the result lines.
            heroRolls: ctx.rolls,
            result,
            flankedEnemyIds,
            bonusActionUsed,
            consumeActionSurge,
        },
    };
}

/** Validate and resolve a committed player-centered combat exchange. */
export function planCombatExchange(state, exchange) {
    if (!state.combat?.active || ![COMBAT_PHASES.AWAITING_PLAYER, COMBAT_PHASES.AWAITING_INTENT].includes(state.combat.phase)) {
        return { ok: false, error: 'Combat is not waiting for a player action.' };
    }
    // Latent but load-reachable: validatePlayerSlots optional-chains state.character
    // while the resolvers do not — a characterless save with active combat
    // would pass validation and then throw mid-resolve (2026-07-25 audit).
    if (!state.character) return { ok: false, error: 'No active character — the exchange cannot resolve.' };
    if (!exchange) return { ok: false, error: 'The DM did not provide a valid combat exchange.' };
    const validation = validatePlayerSlots(exchange, state);
    if (!validation.ok) return validation;

    const ctx = openExchange(state, exchange);
    const seal = {
        kind: 'exchange',
        exchangeId: makeExchangeId('exchange', state.combat),
        // A bonus-action lane (Second Wind slot, Cleric bonus-time cast) spends the
        // round's one bonus action; the reducer marks combat.bonusActionUsed so the
        // potion button (UI-owned bonus action) can't grant a second one this round
        // (2026-08-27 audit P1 — the guard was one-way before this).
        bonusActionUsed: (exchange.playerSlots || [])
            .some(slot => slot.action === 'second_wind' || isBonusCastSlot(state.character, slot)),
        consumeActionSurge: !!state.character.pendingActionSurge,
    };

    applyConditionSync(ctx, exchange.enemyConditionUpdates);
    ctx.standingFlankIds = carryStandingFlanks(ctx);
    const player = resolvePlayerSlots(ctx);
    const healedBaseHp = player.playerHealing > 0
        ? Math.min(state.character.maxHP, state.character.currentHP + player.playerHealing)
        : state.character.currentHP;

    if (player.fled) {
        return sealExchange(ctx, { ...seal, player, playerHp: healedBaseHp, terminal: 'escaped' });
    }

    const flankingEnemyIds = establishFlanks(ctx);
    resolveCompanions(ctx, { flankingEnemyIds });
    // A defense declared last exchange protects against this exchange's player and companion
    // attacks, then expires before foes choose their new actions.
    for (const enemy of ctx.enemies) enemy.defending = false;
    // Casting changes the character mid-exchange (AC buffs, invisibility, spent
    // slots); enemies acting later in this same exchange must see that state.
    const castCharacter = mergeCharacterUpdates(state.character, player.characterUpdates);
    // A natural-20 death save revives the hero BEFORE the enemy phase: in 5e a
    // revived creature is a valid target for everyone acting after it, and the
    // reducer's own commit order is death save → damage. Foes this exchange
    // see a conscious 1-HP hero and can drop them back to 0 (2026-09-02 audit
    // P2 — the revive used to land after every foe had skipped the
    // "already-defeated player").
    const revived = player.deathSaveNatural === 20;
    const enemyPhase = resolveEnemies(ctx, {
        character: revived ? projectRevivedCharacter(castCharacter) : castCharacter,
        playerHp: revived ? Math.max(1, healedBaseHp) : healedBaseHp,
        playerDodging: player.dodging,
    });

    return sealExchange(ctx, {
        ...seal,
        player,
        playerHp: enemyPhase.playerHp,
        playerDamage: enemyPhase.playerDamage,
        flankedEnemyIds: persistFlanks(ctx, flankingEnemyIds),
    });
}

/** Resolve only the initiative winners who act before the player when combat begins. */
export function planOpeningExchange(state) {
    if (!state.combat?.active || state.combat.phase !== COMBAT_PHASES.OPENING) {
        return { ok: false, error: 'Combat has no pending Opening Initiative.' };
    }
    // Same load-reachable hole planCombatExchange closed 2026-07-25: a
    // characterless save with a pending opening would throw mid-resolve.
    if (!state.character) return { ok: false, error: 'No active character — the opening cannot resolve.' };
    const actorIds = new Set(state.combat.openingActorIds || []);
    const exchangeId = makeExchangeId('opening', state.combat);
    // No intent envelope: the opening's actors take their default actions.
    const ctx = openExchange(state, null);

    // The fight-starting response's enemy_condition_updates ride the QUEUED
    // exchange, which resolves only after the opening — so a foe the DM synced
    // as stunned/prone in that same response used to act unimpaired in its
    // opening slot (the 2026-07-13 incapacitated-foe class, opening lane —
    // 2026-08-29 audit). Apply the condition sync (never the intents) before
    // the initiative winners act; the queued exchange re-applying the same
    // delta later is a no-op, so nothing double-fires.
    applyConditionSync(ctx, state.combat.queuedExchange?.enemyConditionUpdates);

    let playerHp = state.character.currentHP;
    let playerDamage = 0;
    // One Uncanny Dodge for the entire opening round — the per-actor resolveEnemies
    // calls below must not each hand the Rogue a fresh reaction.
    const uncannyDodgeState = { used: false };
    for (const actor of state.combat.turnOrder || []) {
        if (!actor || typeof actor !== 'object') continue;
        const actorId = actor.id || actor.name;
        if (!actorIds.has(actorId)) continue;
        const onlyIds = new Set([actor.id]);
        if (actor.type === 'companion') {
            resolveCompanions(ctx, { onlyIds });
        } else if (actor.type === 'enemy') {
            const resolved = resolveEnemies(ctx, {
                character: state.character,
                playerHp,
                playerDodging: false,
                onlyIds,
                uncannyDodgeState,
            });
            playerHp = resolved.playerHp;
            playerDamage += resolved.playerDamage;
        }
    }
    return sealExchange(ctx, { kind: 'opening', exchangeId, playerHp, playerDamage });
}
