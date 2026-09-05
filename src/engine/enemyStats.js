/**
 * Enemy stat validation — the single source of truth for sanitizing the mechanical
 * values that feed the dice engine for engine-owned enemy turns.
 *
 * Policy (per review): for OFFENSIVE stats (attack bonus, damage) an out-of-range value is
 * REJECTED to the engine's conservative default rather than clamped to the strongest legal
 * value — a "+99" is a hallucination, and clamping it to "+15" would still auto-hit. For
 * DEFENSIVE stats (AC, HP) the bound itself is mechanically safe, so we clamp into range.
 *
 * Used at every enemy-stat entry point: combat_start (parser), START_COMBAT, LOAD_GAME,
 * UPDATE_ENEMY, and immediately before rolling (defense-in-depth).
 */

const ATTACK_BONUS_MIN = -5;
const ATTACK_BONUS_MAX = 15;
const DAMAGE_DICE_MAX = 4;
const DAMAGE_SIDES = [4, 6, 8, 10, 12]; // weapon/natural dice only — d20/d100 are not damage dice
const DAMAGE_MOD_MIN = -5;
const DAMAGE_MOD_MAX = 15;
const AC_MIN = 1;
const AC_MAX = 25;
const HP_MAX = 999;
// NOTE: `exhausted`/`exhaustion` is deliberately absent even though
// CONDITION_EFFECTS defines it — its only effect is check disadvantage and
// enemies never make checks, so a DM's "exhausted ogre" drops the condition
// (visible on the enemy card as simply not listed) rather than carrying a
// mechanical no-op through every exchange.
const SUPPORTED_ENEMY_CONDITIONS = new Set([
    'poisoned', 'blinded', 'frightened', 'restrained', 'prone',
    'invisible', 'stunned', 'paralyzed', 'unconscious',
]);

/**
 * Canonical `enemy-…` id for a DM-declared foe, unique within one fight via
 * `usedIds`. ONE implementation shared by the parser boundary
 * (validateCombatStart) and the reducer (START_COMBAT) — they were byte-
 * identical duplicates whose suffix/prefix policy could silently drift
 * (2026-08-29 audit).
 */
export function canonicalEnemyId(enemy, index, usedIds) {
    const fragment = String(enemy?.id || enemy?.name || index + 1)
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 80) || String(index + 1);
    const base = fragment.startsWith('enemy-') ? fragment : `enemy-${fragment}`;
    let id = base;
    let suffix = 2;
    while (usedIds.has(id)) id = `${base}-${suffix++}`;
    usedIds.add(id);
    return id;
}

/** Bounded, normalized conditions that the combat engine knows how to resolve. */
export function normalizeEnemyConditions(value) {
    if (!Array.isArray(value)) return [];
    // No count cap needed: the supported-set filter + dedupe already bounds
    // the result at the set's size.
    return [...new Set(value
        .map(condition => String(condition || '').trim().toLowerCase())
        .filter(condition => SUPPORTED_ENEMY_CONDITIONS.has(condition)))];
}

/**
 * Leading-number coercion shared by every validator below: LLMs regularly emit
 * numeric stats as strings ("22", "+4", "15 AC"). Before 2026-09-05 those
 * silently fell to the defaults (a "22" hp orc became a 20-hp one) while the
 * coin/XP `clamp()` in eventChannels coerced the identical quirk. Non-numeric
 * input stays NaN so the reject/clamp policy below is unchanged.
 */
function toNumber(value) {
    if (typeof value === 'number') return value;
    if (typeof value !== 'string' || value.trim() === '') return NaN;
    const direct = Number(value);
    return Number.isFinite(direct) ? direct : parseFloat(value);
}

/** A to-hit bonus within the allowed band, or undefined (→ engine default) if absurd/out-of-range. */
export function validateEnemyAttackBonus(value) {
    const n = toNumber(value);
    if (!Number.isFinite(n)) return undefined;
    const r = Math.round(n);
    return (r >= ATTACK_BONUS_MIN && r <= ATTACK_BONUS_MAX) ? r : undefined;
}

/**
 * A saving-throw bonus within the same band as attack bonuses, or undefined
 * (→ engine default +2) when absurd. One flat number per enemy — spell saves
 * deliberately do not model six per-ability scores (spellcasting v1 spec).
 */
export function validateEnemySaveBonus(value) {
    const n = toNumber(value);
    if (!Number.isFinite(n)) return undefined;
    const r = Math.round(n);
    return (r >= ATTACK_BONUS_MIN && r <= ATTACK_BONUS_MAX) ? r : undefined;
}

/** A bounded NdM(+/-K) weapon-damage notation, or undefined (→ engine default) if invalid/out-of-range. */
export function sanitizeEnemyDamage(notation) {
    if (typeof notation !== 'string') return undefined;
    const m = notation.replace(/\s+/g, '').match(/^(\d{1,2})d(\d{1,3})([+-]\d{1,3})?$/i);
    if (!m) return undefined;
    const count = parseInt(m[1], 10);
    const sides = parseInt(m[2], 10);
    const mod = m[3] ? parseInt(m[3], 10) : 0;
    if (count < 1 || count > DAMAGE_DICE_MAX) return undefined;
    if (!DAMAGE_SIDES.includes(sides)) return undefined;
    if (mod < DAMAGE_MOD_MIN || mod > DAMAGE_MOD_MAX) return undefined;
    return `${count}d${sides}${mod ? (mod > 0 ? `+${mod}` : `${mod}`) : ''}`;
}

/** AC clamped into a sane band (the bound is mechanically safe), defaulting when missing/absurd. */
export function clampEnemyAC(value, fallback = 12) {
    const n = toNumber(value);
    return (Number.isFinite(n) && n >= AC_MIN && n <= AC_MAX)
        ? Math.round(n)
        : fallback;
}

/** HP clamped to a positive, bounded value, defaulting when missing/absurd. */
export function clampEnemyHP(value, fallback = 20) {
    const n = toNumber(value);
    return (Number.isFinite(n) && n >= 1)
        ? Math.min(HP_MAX, Math.round(n))
        : fallback;
}

/** Current HP may legitimately be zero; keep it separate from maximum-HP validation. */
export function clampEnemyCurrentHP(value, maxHp, fallback = maxHp) {
    const n = toNumber(value);
    if (!Number.isFinite(n)) return fallback;
    return Math.max(0, Math.min(maxHp, Math.round(n)));
}

export function enemyHealthCondition(hp, maxHp) {
    if (hp <= 0) return 'dead';
    const ratio = maxHp > 0 ? hp / maxHp : 1;
    if (ratio <= 0.25) return 'critical';
    if (ratio <= 0.5) return 'bloodied';
    return 'healthy';
}

/** The sanitized attack-relevant fields of an enemy-like object (omits invalid fields entirely). */
export function normalizeEnemyAttackProfile(enemy) {
    const out = {};
    const ab = validateEnemyAttackBonus(enemy?.attackBonus);
    const dmg = sanitizeEnemyDamage(enemy?.damage);
    if (ab !== undefined) out.attackBonus = ab;
    if (dmg !== undefined) out.damage = dmg;
    return out;
}

/**
 * Sanitize an already-built enemy (e.g. from a loaded save) in place of trusting the stored
 * values: bound HP/AC and drop any out-of-range attack stats so the engine default applies.
 */
export function sanitizeLoadedEnemy(enemy) {
    if (!enemy || typeof enemy !== 'object' || Array.isArray(enemy)) return null;
    const maxHp = clampEnemyHP(enemy.maxHp ?? enemy.hp);
    const hp = clampEnemyCurrentHP(enemy.hp, maxHp);
    // Whitelist projection (the characterVault rebuild policy on the same trust
    // boundary): the old `{...enemy}` spread let arbitrary unknown keys on a
    // hostile/stale save survive "sanitization" unbounded and re-persist through
    // every autosave for the rest of the fight.
    const cleaned = {
        id: enemy.id == null ? undefined : String(enemy.id).slice(0, 120),
        name: String(enemy.name || 'Enemy').trim().slice(0, 100) || 'Enemy',
        hp,
        maxHp,
        ac: clampEnemyAC(enemy.ac),
        condition: enemyHealthCondition(hp, maxHp),
        conditions: normalizeEnemyConditions(enemy.conditions),
        combatStatus: ['active', 'fled', 'surrendered'].includes(enemy.combatStatus) ? enemy.combatStatus : 'active',
        defending: !!enemy.defending,
        isUndead: !!enemy.isUndead,
        boss: enemy.boss === true,
    };
    if (typeof enemy.initiative === 'number' && Number.isFinite(enemy.initiative)) {
        cleaned.initiative = enemy.initiative;
    }
    const ab = validateEnemyAttackBonus(enemy.attackBonus);
    const dmg = sanitizeEnemyDamage(enemy.damage);
    const sb = validateEnemySaveBonus(enemy.saveBonus);
    if (ab !== undefined) cleaned.attackBonus = ab;
    if (dmg !== undefined) cleaned.damage = dmg;
    if (sb !== undefined) cleaned.saveBonus = sb;
    return cleaned;
}
