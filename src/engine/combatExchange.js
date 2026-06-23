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
    getLevelBonus,
    getModifier,
    getProficiencyBonus,
    getSavingThrowModifier,
    getSkillModifier,
    getWeaponAttackBonus,
    getWeaponDamageNotation,
    getSneakAttackDice,
} from './rules.js';
import { sanitizeEnemyDamage, validateEnemyAttackBonus, enemyHealthCondition, normalizeEnemyConditions } from './enemyStats.js';

export const COMBAT_PHASES = Object.freeze({
    OPENING: 'opening',
    AWAITING_PLAYER: 'awaiting_player',
    AWAITING_INTENT: 'awaiting_intent',
    AWAITING_NARRATION: 'awaiting_narration',
});

const PLAYER_ACTIONS = new Set(['attack', 'cast', 'check', 'save', 'dodge', 'dash', 'disengage', 'flee', 'interact', 'pass', 'death_save']);
const ENEMY_ACTIONS = new Set(['attack', 'defend', 'flee', 'surrender']);
const COMPANION_ACTIONS = new Set(['attack', 'defend', 'pass']);
const ABILITIES = new Set(['strength', 'dexterity', 'constitution', 'intelligence', 'wisdom', 'charisma']);
const SKILLS = new Set([
    'acrobatics', 'animalHandling', 'arcana', 'athletics', 'deception', 'history', 'insight',
    'intimidation', 'investigation', 'medicine', 'nature', 'perception', 'performance',
    'persuasion', 'religion', 'sleightOfHand', 'stealth', 'survival',
]);
const DEFAULT_ENEMY_ATTACK_BONUS = 3;
const DEFAULT_ENEMY_DAMAGE = '1d6';

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
                ...(action === 'cast' && { target: ref(slot.target), spell: ref(slot.spell) }),
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
            ...(slot.action === 'cast' && { target: resolveEnemy(slot.target) }),
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

function isCompanionActive(companion) {
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
        if (!event.hit) return `**${event.actor} attacks ${event.target}** —${roll}; **Miss.**`;
        const crit = event.critical ? ' Critical hit.' : '';
        const sa = event.sneakAttackDetail
            ? ` Includes **${event.sneakAttackDetail.total}** Sneak Attack damage (${event.sneakAttackDetail.diceCount}d6: ${event.sneakAttackDetail.rolls.join(', ')}).`
            : '';
        const ud = event.uncannyDodgeApplied ? ' (damage halved by Uncanny Dodge)' : '';
        const survival = event.remainingHp <= 0
            ? ` ${event.target} is down.`
            : ` ${event.target} remains alive at ${event.remainingHp}/${event.maxHp} HP.`;
        return `**${event.actor} attacks ${event.target}** —${roll}; **Hit for ${event.damage} damage.**${crit}${sa}${ud}${survival}`;
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

function basicSpellProfile(character, spellRef) {
    const level = character?.level || 1;
    const dice = level >= 17 ? 4 : level >= 11 ? 3 : level >= 5 ? 2 : 1;
    const requested = String(spellRef || '').toLowerCase().replace(/[^a-z]/g, '');
    if (character?.class === 'wizard' && (!requested || ['arcanebolt', 'firebolt', 'rayoffrost'].includes(requested))) {
        return { name: spellRef || 'Arcane Bolt', ability: 'intelligence', damage: `${dice}d10` };
    }
    if (character?.class === 'cleric' && (!requested || ['divinebolt', 'sacredflame', 'radiantbolt'].includes(requested))) {
        return { name: spellRef || 'Divine Bolt', ability: 'wisdom', damage: `${dice}d8` };
    }
    return null;
}

function validatePlayerSlots(exchange, state) {
    const slots = exchange.playerSlots || [];
    const surge = !!state.character?.pendingActionSurge;
    const isRogue = state.character?.class === 'rogue';
    const hasCunningActionFeature = isRogue && (state.character?.level >= 2);

    const maxSlots = hasCunningActionFeature ? 2 : (surge ? 2 : 1);

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
            if (!basicSpellProfile(state.character, slot.spell)) {
                return { ok: false, error: 'That spell has no engine-owned combat profile yet; choose a basic class attack spell or another action.' };
            }
            if (!findByRef(living, slot.target)) {
                return { ok: false, error: `Spell target "${slot.target || ''}" is not an active enemy in this fight.` };
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

function resolvePlayerSlots({ state, exchange, enemies, events, rolls }) {
    const character = state.character;
    const inventory = state.inventory || [];
    let dodging = false;
    let fled = false;
    let deathSaveNatural = null;
    const strikeLimit = expectedStrikes(character);

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
            const enemy = findByRef(enemies, slot.target);
            const profile = basicSpellProfile(character, slot.spell);
            if (!profile || !isEnemyActive(enemy)) {
                events.push({ type: 'note', text: `${slot.spell || 'The spell'} has no valid target and is not redirected.` });
                continue;
            }
            const ruling = rulingFlags(slot.situationalRuling);
            const modifiers = conditionAwareAttackModifiers(character.conditions, enemy.conditions, ruling.advantage, ruling.disadvantage || !!enemy.defending);
            const spellMod = getModifier(character.abilityScores?.[profile.ability] || 10) + getProficiencyBonus(character.level || 1);
            const attack = rollD20(spellMod, `${character.name || 'Player'} casts ${profile.name} at ${enemy.name}`, modifiers.advantage, modifiers.disadvantage);
            rolls.push(attack.roll);
            const critical = attack.natural === 20;
            const hit = attack.natural !== 1 && (critical || attack.roll.total >= enemy.ac);
            let damage = 0;
            if (hit) {
                const damageRoll = rollDamage(profile.damage, `${profile.name} damage`, { critical });
                rolls.push(damageRoll.roll);
                damage = damageRoll.total;
                enemy.hp = Math.max(0, enemy.hp - damage);
                enemy.condition = enemyHealthCondition(enemy.hp, enemy.maxHp);
            }
            events.push({
                type: 'attack', actor: character.name || 'Player', target: enemy.name,
                rolled: attack.roll.total, natural: attack.natural, dc: enemy.ac,
                mode: rollModeLabel(attack, modifiers, slot.situationalRuling),
                hit, critical, damage, remainingHp: enemy.hp, maxHp: enemy.maxHp,
            });
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
    return { dodging, fled, deathSaveNatural };
}

function resolveCompanionAttack(companion, target, events, rolls, situationalRuling = null) {
    const ruling = rulingFlags(situationalRuling);
    const modifiers = conditionAwareAttackModifiers(companion.conditions, target.conditions, ruling.advantage, ruling.disadvantage || !!target.defending);
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
        natural: attack.natural, dc: target.ac, mode: rollModeLabel(attack, modifiers, situationalRuling), hit, critical, damage,
        remainingHp: target.hp, maxHp: target.maxHp,
    });
}

function resolveCompanions({ exchange, enemies, companions, events, rolls, onlyIds = null }) {
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
        const targets = activeEnemies(enemies);
        const target = intent.target ? findByRef(targets, intent.target) : targets[0];
        if (!target) {
            events.push({ type: 'note', text: `${companion.name}'s declared target is unavailable; the action is dropped rather than redirected.` });
            continue;
        }
        resolveCompanionAttack(companion, target, events, rolls, intent.situationalRuling);
    }
}

function resolveEnemyAttack({ enemy, targetRef, character, inventory, companions, playerHp, playerDodging, situationalRuling, events, rolls, uncannyDodgeState }) {
    let targetType = 'player';
    let target = character;
    let targetName = character.name || 'Player';
    let targetAc = computeACFromInventory(inventory, character) ?? character.armorClass ?? 10;
    let targetDisadvantage = playerDodging;
    let targetConditions = character.conditions;

    if (targetRef && targetRef !== 'player') {
        const companion = findByRef(companions, targetRef);
        if (!isCompanionActive(companion)) {
            events.push({ type: 'note', text: `${enemy.name}'s declared target is unavailable; its action is dropped rather than silently redirected.` });
            return { playerHp, playerDamage: 0 };
        }
        targetType = 'companion';
        target = companion;
        targetName = companion.name;
        targetAc = companion.ac ?? 10;
        targetDisadvantage = !!companion.defending;
        targetConditions = companion.conditions;
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
    });
    return { playerHp, playerDamage: targetType === 'player' ? damage : 0 };
}

function resolveEnemies({ state, exchange, enemies, companions, playerHp, playerDodging, events, rolls, onlyIds = null }) {
    const intents = new Map();
    for (const intent of exchange?.enemyIntents || []) {
        const enemy = findByRef(enemies, intent.enemyId);
        if (enemy && !intents.has(enemy.id)) intents.set(enemy.id, intent);
    }
    let playerDamage = 0;
    const uncannyDodgeState = { used: false };
    for (const enemy of enemies) {
        if (!isEnemyActive(enemy)) continue;
        if (onlyIds && !onlyIds.has(enemy.id)) continue;
        const intent = intents.get(enemy.id) || { action: 'attack', target: 'player' };
        if (intent.removeConditions?.length) {
            applyEnemyConditionDelta(enemy, { remove: intent.removeConditions, add: [] }, events);
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
    const companions = (state.party || []).map(companion => ({ ...companion, defending: false }));
    const events = [];
    const rolls = [];
    for (const update of exchange.enemyConditionUpdates || []) {
        const enemy = findByRef(enemies, update.target);
        if (isEnemyActive(enemy)) applyEnemyConditionDelta(enemy, update, events);
    }
    const player = resolvePlayerSlots({ state, exchange, enemies, events, rolls });

    if (player.fled) {
        const result = makeResult('exchange', exchangeId, state.combat.round, events, 'escaped', {
            enemies,
            companions,
            character: state.character,
            playerHp: state.character.currentHP,
        });
        return {
            ok: true,
            payload: {
                exchangeId,
                enemies,
                party: companions,
                playerDamage: 0,
                deathSaveNatural: player.deathSaveNatural,
                rolls,
                result,
                consumeActionSurge: !!state.character.pendingActionSurge,
            },
        };
    }

    resolveCompanions({ state, exchange, enemies, companions, events, rolls });
    // A defense declared last exchange protects against this exchange's player and companion
    // attacks, then expires before foes choose their new actions.
    for (const enemy of enemies) enemy.defending = false;
    const enemyResult = resolveEnemies({
        state, exchange, enemies, companions,
        playerHp: state.character.currentHP,
        playerDodging: player.dodging,
        events, rolls,
    });
    const terminal = terminalState(enemies, enemyResult.playerHp, state.character, player.deathSaveNatural, companions);
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
    const companions = (state.party || []).map(companion => ({ ...companion }));
    const events = [];
    const rolls = [];

    let playerHp = state.character.currentHP;
    let playerDamage = 0;
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
    const postState = [playerState, ...enemyStates].filter(Boolean).join('\n');
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
