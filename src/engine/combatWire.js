/**
 * The combat wire — the DM's `combat_exchange` intent envelope, normalized
 * without consulting mutable game state, and the one reconciliation a
 * fight-starting response needs (its intent names foes that had no engine id
 * yet). `eventChannels.js` is the importer: this is the DM boundary of the
 * exchange machine, split out of combatExchange.js on 2026-10-05.
 */
import { toFiniteNumber } from '../data/items.js';
import { MAX_ROLL_DC } from '../config/contentLimits.js';
import { canonicalRollKey, findSkillInText } from './rules.js';
import { normalizeEnemyConditions } from './enemyStats.js';
import { cleanText } from './text.js';
import { isEnemyActive } from './combatPredicates.js';
import { dedupeCastTargets } from './spellcasting.js';

const PLAYER_ACTIONS = new Set(['attack', 'cast', 'channel', 'check', 'save', 'dodge', 'dash', 'disengage', 'flee', 'interact', 'pass', 'death_save', 'second_wind']);
const ENEMY_ACTIONS = new Set(['attack', 'defend', 'flee', 'surrender']);
const COMPANION_ACTIONS = new Set(['attack', 'defend', 'guard', 'pass']);

// Type-strict (engine/text.js): `String(value || '')` turned an object target
// ref into "[object Object]" — an alias key `object-object` in the reconciler.
const text = (value, max = 120) => cleanText(value, max);
const ref = value => text(value, 100) || null;

/**
 * A check / save slot's key in the form rules.js reads — the SAME lookup the
 * out-of-combat lane uses (`findSkillInText` at the parser, `canonicalRollKey`
 * at the resolver): "Sleight of Hand", `sleight_of_hand`, `sleightofhand` and
 * the HERO SHEET's own `sleightOfHand` are all `sleightOfHand`. Until
 * 2026-10-05 this lane kept a private lowercase-first fold that knew only two
 * spaced spellings: the camelCase key was REJECTED as unsupported (a dead
 * turn) and the spaced one validated, then lowercased again at roll time into
 * an unknown skill — a Rogue's expertise rolled `1d20+0` in every fight.
 * Unknown text passes through lowercased so validation can name it.
 */
function slotRollKey(value) {
    const raw = text(value, 50).replace(/_+/g, ' ');
    return findSkillInText(raw) || canonicalRollKey(raw) || '';
}

function normalizeStrikes(slot) {
    const raw = Array.isArray(slot?.strikes)
        ? slot.strikes
        : (slot?.target ? [{ target: slot.target }] : []);
    return raw.slice(0, 4).map(strike => ({ target: ref(strike?.target || strike) })).filter(s => s.target);
}

/**
 * Deduped target refs for a cast slot ("targets" array or single "target").
 * Dedupe BEFORE the cap (2026-09-26): the old `slice(0, 3)` ran first, so a
 * repeated name or a junk entry among the first three ate a legitimate
 * recipient's slot — `["self", "Jorun", "Jorun", "Mika"]` on Mass Healing
 * Word healed two and dropped Mika without a word, and a level-2 Magic
 * Missile (4 darts) could never name its fourth foe. The rule itself lives
 * in engine/spellcasting.js since 2026-10-08, shared with the out-of-combat
 * `spell_cast` wire.
 */
function normalizeCastTargets(slot) {
    const raw = Array.isArray(slot?.targets)
        ? slot.targets
        : (slot?.target != null ? [slot.target] : []);
    return dedupeCastTargets(raw, value => ref(value?.target ?? value));
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
    // Cap 3: up to two action slots (Action Surge / Cunning Action / bonus-cast
    // lane) plus one bonus-action second_wind slot. validatePlayerSlots owns the
    // real per-lane rules.
    const playerSlots = Array.isArray(rawPlayerSlots)
        ? rawPlayerSlots.slice(0, 3).map((slot, index) => {
            // "Second Wind"/"secondWind" spellings fold into the documented key.
            const action = text(slot?.action, 30).toLowerCase().replace(/[\s-]+/g, '_').replace(/^secondwind$/, 'second_wind');
            if (!PLAYER_ACTIONS.has(action)) return null;
            const situationalRuling = normalizeSituationalRuling(slot);
            // Normalized ONCE (2026-09-27 audit nit): the truthiness-then-value spread re-ran it.
            const onSuccess = action === 'check' ? normalizeConditionDelta(slot.on_success || slot.onSuccess) : null;
            return {
                id: ref(slot.id) || `player-slot-${index + 1}`,
                action,
                description: text(slot.description, 180),
                ...(action === 'attack' && { strikes: normalizeStrikes(slot), weaponId: ref(slot.weapon_id || slot.weaponId) }),
                ...(action === 'cast' && {
                    target: ref(slot.target),
                    targets: normalizeCastTargets(slot),
                    spell: ref(slot.spell),
                    // Numeric-string parity with the out-of-combat lane (2026-09-13 audit P2).
                    slotLevel: Number.isFinite(toFiniteNumber(slot.slot_level ?? slot.slotLevel))
                        ? Math.max(1, Math.min(5, Math.round(toFiniteNumber(slot.slot_level ?? slot.slotLevel))))
                        : null,
                }),
                ...((action === 'check' || action === 'save') && {
                    skill: slotRollKey(slot.skill || slot.ability),
                    // Missing DC defaults to 10 — the out-of-combat channel's
                    // default (eventChannels.js): the solo-play ladder is 8/10/12/15/18+
                    // and "never default DC 15" (2026-09-02 audit P2).
                    // Coerced first ("15" was DC 10 — 2026-09-15 audit P2), the
                    // slot_level / out-of-combat dc parity.
                    dc: Number.isFinite(toFiniteNumber(slot.dc)) ? Math.max(5, Math.min(MAX_ROLL_DC, Math.round(toFiniteNumber(slot.dc)))) : 10,
                }),
                ...(onSuccess && { onSuccess }),
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

    const rawFlankBroken = raw.flank_broken || raw.flankBroken;
    const flankBroken = Array.isArray(rawFlankBroken)
        ? [...new Set(rawFlankBroken.slice(0, 30).map(value => ref(value?.target ?? value)).filter(Boolean))]
        : [];

    return {
        playerSlots,
        enemyIntents,
        companionIntents,
        ...(enemyConditionUpdates.length > 0 && { enemyConditionUpdates }),
        ...(flankBroken.length > 0 && { flankBroken }),
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

