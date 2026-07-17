/**
 * Engine-owned combat exchanges.
 *
 * The DM interprets fiction into a bounded intent envelope. This module validates that
 * envelope, rolls every die, and returns one immutable mechanics plan. The reducer applies
 * that plan in one dispatch; narration happens afterwards from the stored result.
 */
import { parseNotation, rollWithModifier } from './dice.ts';
import {
    combineRollModifiers,
    computeACFromInventory,
    getConditionRollEffects,
    getEquippedWeapon,
    getIncapacitatingCondition,
    getLevelBonus,
    getModifier,
    getSavingThrowModifier,
    getSkillModifier,
    getWeaponAttackBonus,
    getWeaponDamageNotation,
    getSneakAttackDice,
} from './rules.js';
import { sanitizeEnemyDamage, validateEnemyAttackBonus, validateEnemySaveBonus, enemyHealthCondition, normalizeEnemyConditions } from './enemyStats.js';
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

export const COMBAT_PHASES = Object.freeze({
    OPENING: 'opening',
    AWAITING_PLAYER: 'awaiting_player',
    AWAITING_INTENT: 'awaiting_intent',
    AWAITING_NARRATION: 'awaiting_narration',
});

const PLAYER_ACTIONS = new Set(['attack', 'cast', 'channel', 'check', 'save', 'dodge', 'dash', 'disengage', 'flee', 'interact', 'pass', 'death_save']);
const ENEMY_ACTIONS = new Set(['attack', 'defend', 'flee', 'surrender']);
const COMPANION_ACTIONS = new Set(['attack', 'defend', 'guard', 'pass']);
const ABILITIES = new Set(['strength', 'dexterity', 'constitution', 'intelligence', 'wisdom', 'charisma']);
const SKILLS = new Set([
    'acrobatics', 'animalHandling', 'arcana', 'athletics', 'deception', 'history', 'insight',
    'intimidation', 'investigation', 'medicine', 'nature', 'perception', 'performance',
    'persuasion', 'religion', 'sleightOfHand', 'stealth', 'survival',
]);
const DEFAULT_ENEMY_ATTACK_BONUS = 3;
const DEFAULT_ENEMY_DAMAGE = '1d6';
const DEFAULT_ENEMY_SAVE_BONUS = 2;

const text = (value, max = 120) => String(value || '').trim().slice(0, max);
const ref = value => text(value, 100) || null;
const normalizeSkillRef = value => {
    const raw = text(value, 50).toLowerCase();
    if (raw === 'animal handling') return 'animalHandling';
    if (raw === 'sleight of hand') return 'sleightOfHand';
    return raw;
};

function normalizeStrikes(slot) {
    const raw = Array.isArray(slot?.strikes)
        ? slot.strikes
        : (slot?.target ? [{ target: slot.target }] : []);
    return raw.slice(0, 4).map(strike => ({ target: ref(strike?.target || strike) })).filter(s => s.target);
}

/** Up to 3 deduped target refs for a cast slot ("targets" array or single "target"). */
function normalizeCastTargets(slot) {
    const raw = Array.isArray(slot?.targets)
        ? slot.targets
        : (slot?.target != null ? [slot.target] : []);
    return [...new Set(raw.slice(0, 3)
        .map(value => ref(value?.target ?? value))
        .filter(Boolean))];
}

function normalizeConditionDelta(raw, targetValue) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
    const target = ref(targetValue || raw.target || raw.enemy_id || raw.enemyId);
    if (!target) return null;
    const asList = value => Array.isArray(value) ? value : [value];
    const add = normalizeEnemyConditions(asList(raw.add_conditions || raw.addConditions || raw.add || raw.add_condition || raw.addCondition));
    const remove = normalizeEnemyConditions(asList(raw.remove_conditions || raw.removeConditions || raw.remove || raw.remove_condition || raw.removeCondition));
    if (add.length === 0 && remove.length === 0) return null;
    return { target, add, remove };
}

function normalizeSituationalRuling(raw) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
    const source = raw.situational_ruling || raw.situationalRuling || raw;
    if (!source || typeof source !== 'object' || Array.isArray(source)) return null;
    const mode = text(source.roll_mode || source.rollMode || source.mode, 20).toLowerCase();
    const reason = text(source.roll_reason || source.rollReason || source.reason, 180);
    if (!['advantage', 'disadvantage'].includes(mode) || !reason) return null;
    return { mode, reason };
}

/** Normalize an LLM-authored intent envelope without consulting mutable game state. */
export function normalizeCombatExchange(raw) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
    const rawPlayerSlots = raw.player_slots || raw.playerSlots;
    const rawEnemyIntents = raw.enemy_intents || raw.enemyIntents;
    const rawCompanionIntents = raw.companion_intents || raw.companionIntents;
    const rawEnemyConditionUpdates = raw.enemy_condition_updates || raw.enemyConditionUpdates;
    const playerSlots = Array.isArray(rawPlayerSlots)
        ? rawPlayerSlots.slice(0, 2).map((slot, index) => {
            const action = text(slot?.action, 30).toLowerCase();
            if (!PLAYER_ACTIONS.has(action)) return null;
            const situationalRuling = normalizeSituationalRuling(slot);
            return {
                id: ref(slot.id) || `player-slot-${index + 1}`,
                action,
                description: text(slot.description, 180),
                ...(action === 'attack' && { strikes: normalizeStrikes(slot), weaponId: ref(slot.weapon_id || slot.weaponId) }),
                ...(action === 'cast' && {
                    target: ref(slot.target),
                    targets: normalizeCastTargets(slot),
                    spell: ref(slot.spell),
                    slotLevel: Number.isFinite(slot.slot_level ?? slot.slotLevel)
                        ? Math.max(1, Math.min(5, Math.round(slot.slot_level ?? slot.slotLevel)))
                        : null,
                }),
                ...((action === 'check' || action === 'save') && {
                    skill: normalizeSkillRef(slot.skill || slot.ability),
                    dc: Number.isFinite(slot.dc) ? Math.max(5, Math.min(30, Math.round(slot.dc))) : 15,
                }),
                ...(action === 'check' && normalizeConditionDelta(slot.on_success || slot.onSuccess) && {
                    onSuccess: normalizeConditionDelta(slot.on_success || slot.onSuccess),
                }),
                ...(situationalRuling && { situationalRuling }),
            };
        }).filter(Boolean)
        : [];
    if (playerSlots.length === 0) return null;

    const enemyIntents = Array.isArray(rawEnemyIntents)
        ? rawEnemyIntents.slice(0, 30).map(intent => {
            const action = text(intent?.action, 30).toLowerCase();
            const enemyId = ref(intent?.enemy_id || intent?.enemyId);
            if (!enemyId || !ENEMY_ACTIONS.has(action)) return null;
            const rawRemoveConditions = intent.remove_conditions || intent.removeConditions;
            const situationalRuling = normalizeSituationalRuling(intent);
            const removeConditions = normalizeEnemyConditions(
                Array.isArray(rawRemoveConditions) ? rawRemoveConditions : [rawRemoveConditions]
            );
            return {
                enemyId,
                action,
                target: ref(intent.target) || 'player',
                description: text(intent.description, 180),
                ...(removeConditions.length > 0 && { removeConditions }),
                ...(situationalRuling && { situationalRuling }),
            };
        }).filter(Boolean)
        : [];

    const companionIntents = Array.isArray(rawCompanionIntents)
        ? rawCompanionIntents.slice(0, 4).map(intent => {
            const action = text(intent?.action, 30).toLowerCase();
            const companionId = ref(intent?.companion_id || intent?.companionId);
            if (!companionId || !COMPANION_ACTIONS.has(action)) return null;
            const situationalRuling = normalizeSituationalRuling(intent);
            return {
                companionId,
                action,
                target: ref(intent.target),
                description: text(intent.description, 180),
                ...(situationalRuling && { situationalRuling }),
            };
        }).filter(Boolean)
        : [];

    const enemyConditionUpdates = Array.isArray(rawEnemyConditionUpdates)
        ? rawEnemyConditionUpdates.slice(0, 30)
            .map(update => normalizeConditionDelta(update, update?.enemy_id || update?.enemyId))
            .filter(Boolean)
        : [];

    return {
        playerSlots,
        enemyIntents,
        companionIntents,
        ...(enemyConditionUpdates.length > 0 && { enemyConditionUpdates }),
    };
}

const combatRefKey = value => text(value, 100)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

/**
 * Link a combat-start response's intent references to the engine's canonical enemy ids.
 * The model sometimes invents a readable slug ("goblin-duelist") while combat_start only
 * supplied the foe's name. A unique id/name/slug match is safe; a single-foe encounter is
 * unambiguous. Multi-foe unresolved references remain untouched so normal validation blocks
 * them instead of silently retargeting the player.
 */
export function reconcileStartingCombatExchange(rawExchange, enemies = []) {
    const exchange = normalizeCombatExchange(rawExchange);
    if (!exchange) return null;

    const livingEnemies = enemies.filter(isEnemyActive);
    const aliases = new Map();
    const addAlias = (alias, enemyId) => {
        const key = combatRefKey(alias);
        if (!key) return;
        const ids = aliases.get(key) || new Set();
        ids.add(enemyId);
        aliases.set(key, ids);
    };
    for (const enemy of livingEnemies) {
        addAlias(enemy.id, enemy.id);
        addAlias(String(enemy.id || '').replace(/^enemy-/, ''), enemy.id);
        addAlias(enemy.name, enemy.id);
    }
    const resolveEnemy = target => {
        const ids = aliases.get(combatRefKey(target));
        if (ids?.size === 1) return [...ids][0];
        if (livingEnemies.length === 1) return livingEnemies[0].id;
        return target;
    };

    return {
        playerSlots: exchange.playerSlots.map(slot => ({
            ...slot,
            ...(slot.action === 'attack' && {
                strikes: slot.strikes.map(strike => ({ ...strike, target: resolveEnemy(strike.target) })),
            }),
            ...(slot.action === 'cast' && {
                target: slot.target ? resolveEnemy(slot.target) : slot.target,
                targets: (slot.targets || []).map(resolveEnemy),
            }),
            ...(slot.onSuccess && {
                onSuccess: { ...slot.onSuccess, target: resolveEnemy(slot.onSuccess.target) },
            }),
        })),
        enemyIntents: exchange.enemyIntents.map(intent => ({
            ...intent,
            enemyId: resolveEnemy(intent.enemyId),
        })),
        ...((exchange.enemyConditionUpdates || []).length > 0 && {
            enemyConditionUpdates: exchange.enemyConditionUpdates.map(update => ({
                ...update,
                target: resolveEnemy(update.target),
            })),
        }),
        companionIntents: exchange.companionIntents.map(intent => ({
            ...intent,
            ...(intent.target && { target: resolveEnemy(intent.target) }),
        })),
    };
}

export function isEnemyActive(enemy) {
    return !!enemy
        && (enemy.hp ?? 0) > 0
        && enemy.condition !== 'dead'
        && enemy.combatStatus !== 'fled'
        && enemy.combatStatus !== 'surrendered';
}

export function isCompanionActive(companion) {
    return !!companion
        && (companion.hp ?? 0) > 0
        && companion.status !== 'downed'
        && companion.status !== 'dead';
}

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

function conditionAwareAttackModifiers(attackerConditions, targetConditions, baseAdvantage = false, baseDisadvantage = false) {
    const attacker = getConditionRollEffects(attackerConditions, 'attack');
    const target = getConditionRollEffects(targetConditions, 'incomingAttack');
    return combineRollModifiers(baseAdvantage, baseDisadvantage, {
        advantage: attacker.advantage || target.advantage,
        disadvantage: attacker.disadvantage || target.disadvantage,
        sources: [...attacker.sources, ...target.sources],
    });
}

function rulingFlags(ruling) {
    return {
        advantage: ruling?.mode === 'advantage',
        disadvantage: ruling?.mode === 'disadvantage',
    };
}

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

function companionHealthStatus(companion) {
    if ((companion.hp ?? 0) <= 0) return 'downed';
    const ratio = companion.maxHp > 0 ? companion.hp / companion.maxHp : 1;
    if (ratio <= 0.25) return 'critical';
    if (ratio <= 0.5) return 'bloodied';
    return 'healthy';
}

function makeExchangeId(kind, combat) {
    const uuid = globalThis.crypto?.randomUUID?.();
    return uuid ? `${kind}-${uuid}` : `${kind}-${Date.now()}-${combat?.round || 1}`;
}

function rollD20(modifier, description, advantage = false, disadvantage = false) {
    if (advantage && disadvantage) {
        advantage = false;
        disadvantage = false;
    }
    if (!advantage && !disadvantage) {
        const roll = rollWithModifier(1, 20, modifier, description);
        return { roll, natural: roll.rolls[0], detail: '' };
    }
    const first = rollWithModifier(1, 20, modifier, description);
    const second = rollWithModifier(1, 20, modifier, `${description} (second die)`);
    const useFirst = advantage ? first.rolls[0] >= second.rolls[0] : first.rolls[0] <= second.rolls[0];
    const kept = useFirst ? first : second;
    return {
        roll: kept,
        natural: kept.rolls[0],
        detail: `d20 ${first.rolls[0]}, ${second.rolls[0]} → ${kept.rolls[0]}`,
    };
}

function shouldUseGreatWeaponFighting(character, inventory) {
    if (character?.class !== 'fighter' || character.fightingStyle !== 'greatWeaponFighting') return false;
    const weapon = getEquippedWeapon(inventory);
    return !!weapon && !weapon.ranged && weapon.twoHanded;
}

function rollDamage(notation, description, { critical = false, character = null, inventory = [], advantage = false, disadvantage = false, hasAlly = false } = {}) {
    let parsed;
    try {
        parsed = parseNotation(notation);
    } catch {
        parsed = { count: 1, sides: 4, modifier: 0 };
        notation = '1d4';
    }
    const roll = rollWithModifier(critical ? parsed.count * 2 : parsed.count, parsed.sides, parsed.modifier, description);
    const rerolls = [];
    if (character && shouldUseGreatWeaponFighting(character, inventory) && parsed.sides > 2) {
        roll.rolls = roll.rolls.map(value => {
            if (value > 2) return value;
            const replacement = rollWithModifier(1, parsed.sides, 0, `${description} reroll`).rolls[0];
            rerolls.push(`${value}→${replacement}`);
            return replacement;
        });
        roll.subtotal = roll.rolls.reduce((sum, value) => sum + value, 0);
        roll.total = roll.subtotal + parsed.modifier;
    }
    const levelBonus = character ? getLevelBonus(character) : 0;
    roll.total += levelBonus;
    roll.modifier += levelBonus;

    // Rogue Sneak Attack (in-combat)
    let sneakAttackDetail = null;
    if (character && character.class === 'rogue') {
        const weapon = getEquippedWeapon(inventory);
        const sneakAttackDice = getSneakAttackDice(character, weapon, advantage, disadvantage, hasAlly);
        if (sneakAttackDice > 0) {
            const saDiceCount = critical ? sneakAttackDice * 2 : sneakAttackDice;
            const saRolls = [];
            let saTotal = 0;
            for (let i = 0; i < saDiceCount; i++) {
                const r = rollWithModifier(1, 6, 0, 'Sneak Attack').rolls[0];
                saRolls.push(r);
                saTotal += r;
            }
            roll.total += saTotal;
            sneakAttackDetail = {
                diceCount: saDiceCount,
                rolls: saRolls,
                total: saTotal,
            };
        }
    }

    return { roll, total: Math.max(0, roll.total), notation, rerolls, sneakAttackDetail };
}

function championCritical(character, natural) {
    return natural === 20 || (
        natural === 19
        && character?.class === 'fighter'
        && (character.level || 1) >= 3
        && character.martialArchetype === 'champion'
    );
}

function eventMessage(event) {
    if (event.type === 'note') return event.text;
    const mode = event.mode ? ` (${event.mode})` : '';
    const roll = event.rolled != null ? ` Rolled **${event.rolled}** vs AC ${event.dc}${mode}` : '';
    if (event.type === 'attack') {
        const intercept = event.intercepted ? ` (guard — ${event.target} intercepts the blow meant for the hero)` : '';
        if (!event.hit) return `**${event.actor} attacks ${event.target}**${intercept} —${roll}; **Miss.**`;
        const crit = event.critical ? ' Critical hit.' : '';
        const sa = event.sneakAttackDetail
            ? ` Includes **${event.sneakAttackDetail.total}** Sneak Attack damage (${event.sneakAttackDetail.diceCount}d6: ${event.sneakAttackDetail.rolls.join(', ')}).`
            : '';
        const ud = event.uncannyDodgeApplied ? ' (damage halved by Uncanny Dodge)' : '';
        const survival = event.remainingHp <= 0
            ? ` ${event.target} is down.`
            : ` ${event.target} remains alive at ${event.remainingHp}/${event.maxHp} HP.`;
        return `**${event.actor} attacks ${event.target}**${intercept} —${roll}; **Hit for ${event.damage} damage.**${crit}${sa}${ud}${survival}`;
    }
    if (event.type === 'check' || event.type === 'save') {
        const checkMode = event.mode ? ` (${event.mode})` : '';
        const outcome = event.natural === 20
            ? 'Success (Critical Success / Natural 20)'
            : event.success ? 'Success' : 'Failure';
        return `**${event.actor}: ${event.description}** — Rolled **${event.rolled}** vs DC ${event.dc}${checkMode}; **${outcome}.**`;
    }
    if (event.type === 'death_save') return `**Death Saving Throw:** natural **${event.natural}**.`;
    return event.text || `${event.actor} ${event.type}.`;
}

function enemySnapshot(enemy) {
    const status = (enemy.hp ?? 0) <= 0 || enemy.condition === 'dead'
        ? 'defeated'
        : enemy.combatStatus === 'fled'
            ? 'fled'
            : enemy.combatStatus === 'surrendered'
                ? 'surrendered'
                : 'active';
    return {
        id: enemy.id,
        name: enemy.name,
        hp: enemy.hp,
        maxHp: enemy.maxHp,
        condition: enemy.condition,
        conditions: normalizeEnemyConditions(enemy.conditions),
        status,
    };
}

function makeResult(kind, exchangeId, round, events, terminal, {
    enemies = [],
    companions = [],
    character = null,
    playerHp = null,
} = {}) {
    return {
        exchangeId,
        kind,
        round,
        terminal,
        events,
        summary: events.map(eventMessage).join('\n'),
        postState: {
            player: character ? {
                name: character.name || 'Player',
                hp: Number.isFinite(playerHp) ? playerHp : character.currentHP,
                maxHp: character.maxHP,
            } : null,
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

function expectedStrikes(character) {
    return character?.class === 'fighter' && (character.level || 1) >= 5 ? 2 : 1;
}

/** Backward compatibility: a bare "cast" with no spell name means the class's attack cantrip. */
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

function validatePlayerSlots(exchange, state) {
    const slots = exchange.playerSlots || [];
    const surge = !!state.character?.pendingActionSurge;
    const isRogue = state.character?.class === 'rogue';
    const hasCunningActionFeature = isRogue && (state.character?.level >= 2);
    // Cleric bonus-spell lane (spellcasting v1): exactly one bonus-time cast may
    // ride alongside one normal action — the caster's "do two things" lever,
    // parallel to Rogue Cunning Action and Fighter Action Surge.
    const bonusCastCount = slots.filter(slot => isBonusCastSlot(state.character, slot)).length;
    const casterBonusTurn = isSpellcaster(state.character?.class) && bonusCastCount === 1;

    const maxSlots = hasCunningActionFeature || surge || casterBonusTurn ? 2 : 1;

    if (slots.length > maxSlots || slots.length === 0) {
        return {
            ok: false,
            error: hasCunningActionFeature
                ? 'Declare one action slot, or up to two slots if one is a Cunning Action (dash, disengage, or stealth check).'
                : (surge ? 'Action Surge is active: declare exactly two action slots in this turn.' : 'Declare exactly one action slot for this turn.'),
        };
    }

    if (slots.length === 2) {
        if (hasCunningActionFeature && !surge) {
            const isCunning = slot => slot.action === 'dash' || slot.action === 'disengage' || (slot.action === 'check' && slot.skill === 'stealth');
            const cunningCount = slots.filter(isCunning).length;
            if (cunningCount < 1) {
                return {
                    ok: false,
                    error: 'To declare two slots, a Rogue must use one slot for a Cunning Action (dash, disengage, or stealth check).',
                };
            }
            const attacks = slots.filter(s => s.action === 'attack').length;
            const casts = slots.filter(s => s.action === 'cast').length;
            if (attacks > 1 || casts > 1 || (attacks > 0 && casts > 0)) {
                return {
                    ok: false,
                    error: 'A Rogue cannot declare multiple attack or spellcast actions in a single turn.',
                };
            }
        } else if (surge) {
            // Fighter Action Surge
        } else if (casterBonusTurn) {
            // One bonus-time cast + one normal action; bonusCastCount === 1
            // already guarantees the pair cannot be two bonus spells.
        } else {
            return {
                ok: false,
                error: 'Declare exactly one action slot for this turn.',
            };
        }
    }

    if (surge && slots.length === 1) {
        return {
            ok: false,
            error: 'Action Surge is active: declare exactly two action slots in this turn.',
        };
    }
    if (state.character?.isDead || state.character?.lowLevelDefeat) {
        return { ok: false, error: 'The player cannot commit a combat action while defeated or dead.' };
    }
    if (state.character?.dying && slots.some(slot => slot.action !== 'death_save')) {
        return { ok: false, error: 'A dying character can only make a death saving throw.' };
    }
    if (!state.character?.dying && slots.some(slot => slot.action === 'death_save')) {
        return { ok: false, error: 'A death saving throw is only valid while dying.' };
    }
    const fleeIndex = slots.findIndex(slot => slot.action === 'flee');
    if (fleeIndex >= 0 && fleeIndex !== slots.length - 1) {
        return { ok: false, error: 'Flee must be the final action slot in the exchange.' };
    }

    const living = activeEnemies(state.combat?.enemies || []);
    const strikeLimit = expectedStrikes(state.character);
    for (const slot of slots) {
        if ((slot.action === 'check' || slot.action === 'save') && !slot.skill) {
            return { ok: false, error: `${slot.action === 'save' ? 'Save' : 'Check'} slots must name an ability or skill.` };
        }
        if (slot.action === 'save' && !ABILITIES.has(slot.skill)) {
            return { ok: false, error: `Saving throw ability "${slot.skill}" is unsupported.` };
        }
        if (slot.action === 'check' && !ABILITIES.has(slot.skill) && !SKILLS.has(slot.skill)) {
            return { ok: false, error: `Check skill or ability "${slot.skill}" is unsupported.` };
        }
        if (slot.action === 'check' && slot.onSuccess && !findByRef(living, slot.onSuccess.target)) {
            return { ok: false, error: `Check condition target "${slot.onSuccess.target}" is not an active enemy in this fight.` };
        }
        if (slot.action === 'cast') {
            const spell = resolveCastSpell(state.character, slot);
            if (!spell) {
                return { ok: false, error: 'That spell is not on this character\'s engine-owned spell list; choose a known class spell or another action.' };
            }
            if (!spell.combatAvailable) {
                return { ok: false, error: `${spell.name} has no combat effect; it belongs outside battle.` };
            }
            if (spell.level > 0 && chooseSlotLevel(state.character.spellSlots, spell, slot.slotLevel) === null) {
                return { ok: false, error: `No spell slot remains to cast ${spell.name} (needs a level ${spell.level}+ slot).` };
            }
            // Over-targeting a limited spell is NOT a rejection: the resolvers clamp to
            // the spell's real target count (first named targets win) with a visible
            // note. A hard reject here cost the player a dead turn every time the DM
            // pattern-matched 5e's AoE Sleep onto our single-target version (2026-07-17
            // live playtest — it happened twice in one fight).
            if (spell.targeting.side === 'enemy') {
                const targets = castTargetRefs(slot);
                if (targets.length === 0) return { ok: false, error: `${spell.name} needs a living enemy target.` };
                for (const target of targets) {
                    if (!findByRef(living, target)) {
                        return { ok: false, error: `Spell target "${target}" is not an active enemy in this fight.` };
                    }
                }
            } else if (spell.targeting.side === 'ally') {
                const targets = castTargetRefs(slot, ['self']);
                for (const target of targets) {
                    if (!resolveAllyTarget(state.character, state.party || [], target)) {
                        return { ok: false, error: `Spell target "${target}" is not the hero or a living companion.` };
                    }
                }
            }
            continue;
        }
        if (slot.action === 'channel') {
            if (state.character?.class !== 'cleric' || (state.character.level || 1) < 2) {
                return { ok: false, error: 'Channel Divinity requires a Cleric of level 2 or higher.' };
            }
            const channel = state.character.classResources?.channelDivinity;
            if (!channel || channel.used >= channel.max) {
                return { ok: false, error: 'Channel Divinity is already spent; it recharges on a rest.' };
            }
            if (!living.some(enemy => enemy.isUndead)) {
                return { ok: false, error: 'Turn Undead has no undead foes to affect in this fight.' };
            }
            continue;
        }
        if (slot.action !== 'attack') continue;
        if (slot.weaponId && !findByRef(state.inventory || [], slot.weaponId)) {
            return { ok: false, error: `Attack weapon "${slot.weaponId}" is not in the player's inventory.` };
        }
        if (!slot.strikes?.length) return { ok: false, error: 'Every combat Attack needs a living target.' };
        if (slot.strikes.length > strikeLimit) {
            return { ok: false, error: `One Attack action currently allows ${strikeLimit} strike${strikeLimit === 1 ? '' : 's'}.` };
        }
        for (const strike of slot.strikes) {
            if (!findByRef(living, strike.target)) {
                return { ok: false, error: `Attack target "${strike.target}" is not an active enemy in this fight.` };
            }
        }
    }
    return { ok: true };
}

/** Resolve an enemy-side spell (attack rolls, engine-rolled saves, auto damage). */
function resolveEnemySpell({ spell, slotLevel, slot, character, enemies, events, rolls }) {
    const targetLimit = spell.targeting.mode === 'upTo3' ? 3 : 1;
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
            const attack = rollD20(getSpellAttackBonus(character), `${character.name || 'Player'} casts ${spell.name} at ${enemy.name}`, modifiers.advantage, modifiers.disadvantage);
            rolls.push(attack.roll);
            const critical = attack.natural === 20;
            const hit = attack.natural !== 1 && (critical || attack.roll.total >= enemy.ac);
            let damage = 0;
            if (hit) {
                const damageRoll = rollDamage(spellDamageNotation(spell, character, slotLevel), `${spell.name} damage`, { critical });
                rolls.push(damageRoll.roll);
                damage = damageRoll.total;
                enemy.hp = Math.max(0, enemy.hp - damage);
                enemy.condition = enemyHealthCondition(enemy.hp, enemy.maxHp);
                if (spell.condition && isEnemyActive(enemy)) {
                    applyEnemyConditionDelta(enemy, { add: [spell.condition], remove: [] }, events);
                }
            }
            events.push({
                type: 'attack', actor: character.name || 'Player', target: enemy.name,
                rolled: attack.roll.total, natural: attack.natural, dc: enemy.ac,
                mode: rollModeLabel(attack, modifiers, slot.situationalRuling),
                hit, critical, damage, remainingHp: enemy.hp, maxHp: enemy.maxHp,
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
            const save = rollD20(validateEnemySaveBonus(enemy.saveBonus) ?? DEFAULT_ENEMY_SAVE_BONUS, `${enemy.name} saves vs ${spell.name}`);
            rolls.push(save.roll);
            const success = save.roll.total >= dc;
            events.push({
                type: 'save', actor: enemy.name, description: `save vs ${spell.name}`,
                rolled: save.roll.total, natural: save.natural, dc, success,
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

    // Auto-hit damage (Magic Missile): no roll to hit, only the effect dice.
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
function resolveSupportSpell({ spell, slotLevel, slot, character, companions, events, rolls, support }) {
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
                companion.status = companionHealthStatus(companion);
                events.push({ type: 'note', text: `**${spell.name}** — ${allyName} recovers **${healRoll.total}** HP (now ${companion.hp}/${companion.maxHp})${wasDown ? ' and is back on their feet' : ''}.` });
            }
            continue;
        }

        if (spell.stabilizes) {
            if (ally.type === 'companion' && (ally.companion.hp ?? 0) <= 0) {
                events.push({ type: 'note', text: `**${spell.name}** — ${allyName} is stabilized at death's door (no HP restored).` });
            } else {
                events.push({ type: 'note', text: `**${spell.name}** — ${allyName} is not dying; the spell has no effect.` });
            }
            continue;
        }

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

function resolvePlayerSlots({ state, exchange, enemies, companions, events, rolls }) {
    const character = state.character;
    const inventory = state.inventory || [];
    let dodging = false;
    let fled = false;
    let deathSaveNatural = null;
    const strikeLimit = expectedStrikes(character);
    const support = { playerHealing: 0, characterUpdates: {} };
    let workingSlots = character.spellSlots || null;

    for (const slot of exchange.playerSlots) {
        if (slot.action === 'dodge') {
            dodging = true;
            events.push({ type: 'note', text: `${character.name || 'The player'} takes the Dodge action.` });
            continue;
        }
        if (slot.action === 'flee') {
            fled = true;
            events.push({ type: 'note', text: `${character.name || 'The player'} escapes the fight.` });
            continue;
        }
        if (slot.action === 'death_save') {
            const save = rollWithModifier(1, 20, 0, 'Death Saving Throw');
            rolls.push(save);
            deathSaveNatural = save.rolls[0];
            events.push({ type: 'death_save', natural: deathSaveNatural });
            continue;
        }
        if (slot.action === 'cast') {
            const spell = resolveCastSpell(character, slot);
            if (!spell) {
                events.push({ type: 'note', text: `${slot.spell || 'The spell'} is not on the engine-owned spell list; nothing happens.` });
                continue;
            }
            let slotLevel = 0;
            if (spell.level > 0) {
                slotLevel = chooseSlotLevel(workingSlots, spell, slot.slotLevel);
                if (slotLevel === null) {
                    events.push({ type: 'note', text: `${spell.name} fizzles — no spell slot remains to pay for it.` });
                    continue;
                }
                workingSlots = spendSpellSlot(workingSlots, slotLevel);
                support.characterUpdates.spellSlots = workingSlots;
                events.push({
                    type: 'note',
                    text: `**${character.name || 'Player'} casts ${spell.name}**${slotLevel > spell.level ? ` using a level ${slotLevel} slot` : ''} (slots left: ${summarizeSpellSlots(workingSlots)}).`,
                });
            }
            if (spell.targeting.side === 'enemy') {
                resolveEnemySpell({ spell, slotLevel, slot, character, enemies, events, rolls });
            } else {
                resolveSupportSpell({ spell, slotLevel, slot, character, companions, events, rolls, support });
            }
            continue;
        }
        if (slot.action === 'channel') {
            const channel = character.classResources?.channelDivinity;
            if (!channel || channel.used >= channel.max) {
                events.push({ type: 'note', text: 'Channel Divinity is already spent; nothing happens.' });
                continue;
            }
            support.characterUpdates.classResources = {
                ...character.classResources,
                channelDivinity: { ...channel, used: channel.used + 1 },
            };
            const dc = getSpellSaveDC(character);
            events.push({ type: 'note', text: `**${character.name || 'Player'} presents their holy symbol — Turn Undead** (save DC ${dc}).` });
            for (const enemy of enemies) {
                if (!isEnemyActive(enemy) || !enemy.isUndead) continue;
                const save = rollD20(validateEnemySaveBonus(enemy.saveBonus) ?? DEFAULT_ENEMY_SAVE_BONUS, `${enemy.name} saves vs Turn Undead`);
                rolls.push(save.roll);
                const success = save.roll.total >= dc;
                events.push({
                    type: 'save', actor: enemy.name, description: 'save vs Turn Undead',
                    rolled: save.roll.total, natural: save.natural, dc, success,
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
            continue;
        }
        if (slot.action === 'check' || slot.action === 'save') {
            const skill = String(slot.skill || '').toLowerCase();
            const modifier = slot.action === 'save'
                ? getSavingThrowModifier(character, skill)
                : character.abilityScores?.[skill] != null
                    ? getModifier(character.abilityScores[skill])
                    : getSkillModifier(character, skill);
            const conditionEffects = getConditionRollEffects(character.conditions, slot.action === 'save' ? 'save' : 'check');
            const ruling = rulingFlags(slot.situationalRuling);
            const modifiers = combineRollModifiers(ruling.advantage, ruling.disadvantage, conditionEffects);
            const roll = rollD20(modifier, slot.description || `${skill} ${slot.action}`, modifiers.advantage, modifiers.disadvantage);
            rolls.push(roll.roll);
            const success = roll.natural === 20 || roll.roll.total >= slot.dc;
            events.push({
                type: slot.action,
                actor: character.name || 'Player',
                description: slot.description || `${skill} ${slot.action}`,
                rolled: roll.roll.total,
                natural: roll.natural,
                dc: slot.dc,
                success,
                mode: rollModeLabel(roll, modifiers, slot.situationalRuling),
            });
            if (success && slot.action === 'check' && slot.onSuccess) {
                const enemy = findByRef(enemies, slot.onSuccess.target);
                applyEnemyConditionDelta(enemy, slot.onSuccess, events);
            }
            continue;
        }
        if (slot.action !== 'attack') {
            events.push({ type: 'note', text: `${character.name || 'The player'} uses their action to ${slot.action}.` });
            continue;
        }

        const attackInventory = slot.weaponId
            ? inventory.map(item => ({
                ...item,
                equipped: item.type === 'weapon' || item.category?.toLowerCase().includes('melee') || item.category?.toLowerCase().includes('ranged')
                    ? item.id === slot.weaponId || item.name?.toLowerCase() === slot.weaponId.toLowerCase()
                    : item.equipped,
            }))
            : inventory;
        const declared = slot.strikes;
        const strikes = [...declared];
        while (strikes.length < strikeLimit) strikes.push({ ...strikes[strikes.length - 1] });
        for (const strike of strikes) {
            const enemy = findByRef(enemies, strike.target);
            if (!isEnemyActive(enemy)) {
                events.push({ type: 'note', text: `${enemy?.name || strike.target} has already been overcome; the unused strike does not retarget without player intent.` });
                continue;
            }
            const ruling = rulingFlags(slot.situationalRuling);
            const modifiers = conditionAwareAttackModifiers(character.conditions, enemy.conditions, ruling.advantage, ruling.disadvantage || !!enemy.defending);
            const attack = rollD20(
                getWeaponAttackBonus(character, attackInventory),
                `${character.name || 'Player'} attacks ${enemy.name}`,
                modifiers.advantage,
                modifiers.disadvantage
            );
            rolls.push(attack.roll);
            const critical = championCritical(character, attack.natural);
            const hit = attack.natural !== 1 && (critical || attack.roll.total >= enemy.ac);
            let damage = 0;
            let sneakAttackDetail = null;
            if (hit) {
                const hasAlly = (state.party || []).some(isCompanionActive);
                const damageRoll = rollDamage(
                    getWeaponDamageNotation(character, attackInventory, '1d4'),
                    `Damage to ${enemy.name}`,
                    {
                        critical,
                        character,
                        inventory: attackInventory,
                        advantage: modifiers.advantage,
                        disadvantage: modifiers.disadvantage,
                        hasAlly,
                    }
                );
                rolls.push(damageRoll.roll);
                damage = damageRoll.total;
                sneakAttackDetail = damageRoll.sneakAttackDetail;
                enemy.hp = Math.max(0, enemy.hp - damage);
                enemy.condition = enemyHealthCondition(enemy.hp, enemy.maxHp);
            }
            events.push({
                type: 'attack', actor: character.name || 'Player', target: enemy.name,
                rolled: attack.roll.total, natural: attack.natural, dc: enemy.ac,
                mode: rollModeLabel(attack, modifiers, slot.situationalRuling),
                hit, critical, damage, remainingHp: enemy.hp, maxHp: enemy.maxHp,
                sneakAttackDetail,
            });
        }
    }
    const hasCharacterUpdates = Object.keys(support.characterUpdates).length > 0;
    return {
        dodging,
        fled,
        deathSaveNatural,
        playerHealing: support.playerHealing,
        characterUpdates: hasCharacterUpdates ? support.characterUpdates : null,
    };
}

function resolveCompanionAttack(companion, target, events, rolls, situationalRuling = null, flankingEnemyIds = null) {
    const ruling = rulingFlags(situationalRuling);
    // Propagate explicit player flanking only when the companion has no separate ruling.
    const companionFlanking = !situationalRuling && (flankingEnemyIds?.has(target.id) ?? false);
    const effectiveRuling = companionFlanking
        ? { mode: 'advantage', reason: 'flanking' }
        : situationalRuling;
    const modifiers = conditionAwareAttackModifiers(companion.conditions, target.conditions, ruling.advantage || companionFlanking, ruling.disadvantage || !!target.defending);
    const attack = rollD20(
        companion.attackBonus ?? 2,
        `${companion.name} attacks ${target.name}`,
        modifiers.advantage,
        modifiers.disadvantage
    );
    rolls.push(attack.roll);
    const critical = attack.natural === 20;
    const hit = attack.natural !== 1 && (critical || attack.roll.total >= target.ac);
    let damage = 0;
    if (hit) {
        const damageRoll = rollDamage(companion.damage || '1d4+1', `${companion.name} damage`, { critical });
        rolls.push(damageRoll.roll);
        damage = damageRoll.total;
        target.hp = Math.max(0, target.hp - damage);
        target.condition = enemyHealthCondition(target.hp, target.maxHp);
    }
    events.push({
        type: 'attack', actor: companion.name, target: target.name, rolled: attack.roll.total,
        natural: attack.natural, dc: target.ac, mode: rollModeLabel(attack, modifiers, effectiveRuling), hit, critical, damage,
        remainingHp: target.hp, maxHp: target.maxHp,
    });
}

function resolveCompanions({ exchange, enemies, companions, events, rolls, onlyIds = null, flankingEnemyIds = null }) {
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
        resolveCompanionAttack(companion, target, events, rolls, intent.situationalRuling, flankingEnemyIds);
    }
}

function resolveEnemyAttack({ enemy, targetRef, character, inventory, companions, playerHp, playerDodging, situationalRuling, events, rolls, uncannyDodgeState }) {
    let targetType = 'player';
    let target = character;
    let targetName = character.name || 'Player';
    let targetAc = computeACFromInventory(inventory, character) ?? character.armorClass ?? 10;
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
    const attackBonus = validateEnemyAttackBonus(enemy.attackBonus) ?? DEFAULT_ENEMY_ATTACK_BONUS;
    const attack = rollD20(attackBonus, `${enemy.name} attacks ${targetName}`, modifiers.advantage, modifiers.disadvantage);
    rolls.push(attack.roll);
    const critical = attack.natural === 20;
    const hit = attack.natural !== 1 && (critical || attack.roll.total >= targetAc);
    let damage = 0;
    let uncannyDodgeApplied = false;
    if (hit) {
        const notation = sanitizeEnemyDamage(enemy.damage) || DEFAULT_ENEMY_DAMAGE;
        const damageRoll = rollDamage(notation, `${enemy.name} damage`, { critical });
        rolls.push(damageRoll.roll);
        damage = damageRoll.total;
        
        if (targetType === 'player' && character?.class === 'rogue' && (character?.level >= 5) && damage > 0 && uncannyDodgeState && !uncannyDodgeState.used) {
            damage = Math.floor(damage / 2);
            uncannyDodgeState.used = true;
            uncannyDodgeApplied = true;
        }

        if (targetType === 'player') {
            playerHp = Math.max(0, playerHp - damage);
        } else {
            target.hp = Math.max(0, target.hp - damage);
            target.status = companionHealthStatus(target);
        }
    }
    events.push({
        type: 'attack', actor: enemy.name, target: targetName, rolled: attack.roll.total,
        natural: attack.natural, dc: targetAc,
        mode: rollModeLabel(attack, modifiers, situationalRuling),
        hit, critical, damage,
        remainingHp: targetType === 'player' ? playerHp : target.hp,
        maxHp: targetType === 'player' ? character.maxHP : target.maxHp,
        uncannyDodgeApplied,
        ...(intercepted && { intercepted: true }),
    });
    return { playerHp, playerDamage: targetType === 'player' ? damage : 0 };
}

function resolveEnemies({ state, exchange, enemies, companions, playerHp, playerDodging, events, rolls, onlyIds = null, uncannyDodgeState = null }) {
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
            character: state.character,
            inventory: state.inventory || [],
            companions,
            playerHp,
            playerDodging,
            situationalRuling: intent.situationalRuling,
            events,
            rolls,
            uncannyDodgeState,
        });
        playerHp = resolved.playerHp;
        playerDamage += resolved.playerDamage;
    }
    return { playerHp, playerDamage };
}

function projectedDeathSaveState(character, natural) {
    if (!Number.isInteger(natural)) return 'dying';
    if (natural === 20) return 'revived';
    const saves = character.deathSaves || { successes: 0, failures: 0 };
    if (natural >= 10) return (saves.successes || 0) + 1 >= 3 ? 'stable' : 'dying';
    const failures = (saves.failures || 0) + (natural === 1 ? 2 : 1);
    return failures >= 3 ? 'dead' : 'dying';
}

function terminalState(enemies, playerHp, character, deathSaveNatural = null, party = []) {
    if (activeEnemies(enemies).length === 0) return 'victory';
    if (character.isDead || character.lowLevelDefeat) return 'defeat';
    if (playerHp > 0) return null;
    if (character.dying) {
        const projected = projectedDeathSaveState(character, deathSaveNatural);
        if (projected === 'revived') return null;
        if (projected === 'stable' || projected === 'dead') return 'defeat';
        return 'dying';
    }
    const lowLevelSolo = (character.level || 1) <= 2 && !party.some(isCompanionActive);
    return lowLevelSolo ? 'defeat' : 'dying';
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

/** Validate and resolve a committed player-centered combat exchange. */
export function planCombatExchange(state, exchange) {
    if (!state.combat?.active || ![COMBAT_PHASES.AWAITING_PLAYER, COMBAT_PHASES.AWAITING_INTENT].includes(state.combat.phase)) {
        return { ok: false, error: 'Combat is not waiting for a player action.' };
    }
    if (!exchange) return { ok: false, error: 'The DM did not provide a valid combat exchange.' };
    const validation = validatePlayerSlots(exchange, state);
    if (!validation.ok) return validation;

    const exchangeId = makeExchangeId('exchange', state.combat);
    const enemies = (state.combat.enemies || []).map(enemy => ({ ...enemy }));
    // Stances are declared per exchange; stale defend/guard flags must not carry over.
    const companions = (state.party || []).map(companion => ({ ...companion, defending: false, guarding: false }));
    const events = [];
    const rolls = [];
    for (const update of exchange.enemyConditionUpdates || []) {
        const enemy = findByRef(enemies, update.target);
        if (isEnemyActive(enemy)) applyEnemyConditionDelta(enemy, update, events);
    }
    const player = resolvePlayerSlots({ state, exchange, enemies, companions, events, rolls });
    // Casting changes the character mid-exchange (AC buffs, invisibility, spent
    // slots); enemies acting later in this same exchange must see that state.
    const castCharacter = mergeCharacterUpdates(state.character, player.characterUpdates);
    const healedBaseHp = player.playerHealing > 0
        ? Math.min(state.character.maxHP, state.character.currentHP + player.playerHealing)
        : state.character.currentHP;

    if (player.fled) {
        const result = makeResult('exchange', exchangeId, state.combat.round, events, 'escaped', {
            enemies,
            companions,
            character: state.character,
            playerHp: healedBaseHp,
        });
        return {
            ok: true,
            payload: {
                exchangeId,
                enemies,
                party: companions,
                playerDamage: 0,
                playerHealing: player.playerHealing,
                characterUpdates: player.characterUpdates,
                deathSaveNatural: player.deathSaveNatural,
                rolls,
                result,
                consumeActionSurge: !!state.character.pendingActionSurge,
            },
        };
    }

    // Collect enemies the player explicitly flanked this exchange. Other situational
    // advantage sources, such as concealment or distraction, stay local to the actor.
    const flankingEnemyIds = new Set();
    for (const slot of exchange.playerSlots || []) {
        if (!isSharedFlankingRuling(slot.situationalRuling)) continue;
        if (slot.action === 'attack') {
            const targetedEnemies = new Set((slot.strikes || [])
                .map(strike => findByRef(enemies, strike.target)?.id)
                .filter(Boolean));
            if (targetedEnemies.size === 1) flankingEnemyIds.add([...targetedEnemies][0]);
        }
    }

    resolveCompanions({ state, exchange, enemies, companions, events, rolls, flankingEnemyIds });
    // A defense declared last exchange protects against this exchange's player and companion
    // attacks, then expires before foes choose their new actions.
    for (const enemy of enemies) enemy.defending = false;
    const enemyResult = resolveEnemies({
        state: castCharacter === state.character ? state : { ...state, character: castCharacter },
        exchange, enemies, companions,
        playerHp: healedBaseHp,
        playerDodging: player.dodging,
        events, rolls,
    });
    const terminal = terminalState(enemies, enemyResult.playerHp, castCharacter, player.deathSaveNatural, companions);
    const playerHp = player.deathSaveNatural === 20 ? Math.max(1, enemyResult.playerHp) : enemyResult.playerHp;
    const result = makeResult('exchange', exchangeId, state.combat.round, events, terminal, {
        enemies,
        companions,
        character: state.character,
        playerHp,
    });

    return {
        ok: true,
        payload: {
            exchangeId,
            enemies,
            party: companions,
            playerDamage: enemyResult.playerDamage,
            playerHealing: player.playerHealing,
            characterUpdates: player.characterUpdates,
            deathSaveNatural: player.deathSaveNatural,
            rolls,
            result,
            consumeActionSurge: !!state.character.pendingActionSurge,
        },
    };
}

/** Resolve only the initiative winners who act before the player when combat begins. */
export function planOpeningExchange(state) {
    if (!state.combat?.active || state.combat.phase !== COMBAT_PHASES.OPENING) {
        return { ok: false, error: 'Combat has no pending Opening Initiative.' };
    }
    const actorIds = new Set(state.combat.openingActorIds || []);
    const exchangeId = makeExchangeId('opening', state.combat);
    const enemies = (state.combat.enemies || []).map(enemy => ({ ...enemy }));
    // A fresh fight starts with no stances; clear any flags persisted from a previous combat.
    const companions = (state.party || []).map(companion => ({ ...companion, defending: false, guarding: false }));
    const events = [];
    const rolls = [];

    let playerHp = state.character.currentHP;
    let playerDamage = 0;
    // One Uncanny Dodge for the entire opening round — the per-actor resolveEnemies
    // calls below must not each hand the Rogue a fresh reaction.
    const uncannyDodgeState = { used: false };
    for (const actor of state.combat.turnOrder || []) {
        const actorId = actor.id || actor.name;
        if (!actorIds.has(actorId)) continue;
        if (actor.type === 'companion') {
            resolveCompanions({
                exchange: null, enemies, companions, events, rolls,
                onlyIds: new Set([actor.id]),
            });
        } else if (actor.type === 'enemy') {
            const resolved = resolveEnemies({
                state, exchange: null, enemies, companions,
                playerHp,
                playerDodging: false,
                events, rolls,
                onlyIds: new Set([actor.id]),
                uncannyDodgeState,
            });
            playerHp = resolved.playerHp;
            playerDamage += resolved.playerDamage;
        }
    }
    const terminal = terminalState(enemies, playerHp, state.character, null, companions);
    const result = makeResult('opening', exchangeId, state.combat.round, events, terminal, {
        enemies,
        companions,
        character: state.character,
        playerHp,
    });
    return {
        ok: true,
        payload: {
            exchangeId,
            enemies,
            party: companions,
            playerDamage,
            deathSaveNatural: null,
            rolls,
            result,
            consumeActionSurge: false,
        },
    };
}

export function combatNarrationPrompt(result) {
    const ending = result.terminal === 'victory'
        ? 'The fight is mechanically won. Narrate the victory and its immediate fictional consequences.'
        : result.terminal === 'defeat'
            ? 'The player is mechanically defeated. Narrate the setback or collapse without adding more damage.'
            : result.terminal === 'escaped'
                ? 'The player has mechanically escaped combat. Narrate the retreat without adding pursuit attacks or XP.'
            : result.terminal === 'dying'
                ? 'The player remains unconscious and dying. Narrate the danger briefly; do not end combat or invent another attack.'
            : 'COMBAT IS STILL ACTIVE. End with the situation returned to the player for their next decision. Do not narrate victory or the end of the fight.';
    const enemyStates = result.postState?.enemies?.length
        ? result.postState.enemies.map(enemy => {
            if (enemy.status === 'defeated') return `- DEFEATED: ${enemy.name} — 0/${enemy.maxHp} HP.`;
            if (enemy.status === 'fled') return `- ALIVE, FLED: ${enemy.name} — ${enemy.hp}/${enemy.maxHp} HP.`;
            if (enemy.status === 'surrendered') return `- ALIVE, SURRENDERED: ${enemy.name} — ${enemy.hp}/${enemy.maxHp} HP.`;
            const conditions = enemy.conditions?.length ? `; conditions: ${enemy.conditions.join(', ')}` : '';
            return `- ALIVE AND ACTIVE: ${enemy.name} — ${enemy.hp}/${enemy.maxHp} HP (${enemy.condition || 'wounded'}${conditions}).`;
        })
        : result.events
            .filter(event => event.type === 'attack' && Number.isFinite(event.remainingHp))
            .map(event => event.remainingHp <= 0
                ? `- DEFEATED: ${event.target} — 0/${event.maxHp} HP.`
                : `- ALIVE AND ACTIVE: ${event.target} — ${event.remainingHp}/${event.maxHp} HP.`);
    const playerState = result.postState?.player
        ? `- PLAYER: ${result.postState.player.name} — ${result.postState.player.hp}/${result.postState.player.maxHp} HP.`
        : null;
    const companionStates = (result.postState?.companions || []).map(companion => (companion.hp ?? 0) <= 0
        ? `- COMPANION DOWN: ${companion.name} — 0/${companion.maxHp} HP (unconscious, not dead unless an event says so).`
        : `- COMPANION ALIVE: ${companion.name} — ${companion.hp}/${companion.maxHp} HP.`);
    const postState = [playerState, ...companionStates, ...enemyStates].filter(Boolean).join('\n');
    return [
        `[SYSTEM: Combat exchange ${result.exchangeId} has already been resolved completely by the engine.`,
        'Narrate these exact results once in one cohesive, vivid but concise passage.',
        'Do not roll, request rolls, change HP, add attacks, repeat actions, or emit JSON.',
        'Never turn a miss into a hit or invent a counterattack.',
        `The terminal state is mechanically authoritative: ${result.terminal || 'ongoing'}.`,
        'The POST-EXCHANGE STATE is absolute. Never describe an ALIVE AND ACTIVE combatant as dead, defeated, lifeless, finished, going slack, or collapsing permanently. Fled and surrendered foes may be overcome, but remain alive. Do not quote HP numbers in the prose.',
        'Do not introduce, remove, or imply a mechanical condition unless it appears in the POST-EXCHANGE STATE or resolved events.',
        ending,
        '',
        'POST-EXCHANGE STATE (AUTHORITATIVE):',
        postState || '- No combatant snapshot available; obey each event\'s remaining-HP statement exactly.',
        '',
        'RESOLVED EVENTS:',
        result.summary,
        ']'
    ].join('\n');
}
