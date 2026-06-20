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

/** A to-hit bonus within the allowed band, or undefined (→ engine default) if absurd/out-of-range. */
export function validateEnemyAttackBonus(n) {
    if (typeof n !== 'number' || !Number.isFinite(n)) return undefined;
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
export function clampEnemyAC(n, fallback = 12) {
    return (typeof n === 'number' && Number.isFinite(n) && n >= AC_MIN && n <= AC_MAX)
        ? Math.round(n)
        : fallback;
}

/** HP clamped to a positive, bounded value, defaulting when missing/absurd. */
export function clampEnemyHP(n, fallback = 20) {
    return (typeof n === 'number' && Number.isFinite(n) && n >= 1)
        ? Math.min(HP_MAX, Math.round(n))
        : fallback;
}

/** Current HP may legitimately be zero; keep it separate from maximum-HP validation. */
export function clampEnemyCurrentHP(n, maxHp, fallback = maxHp) {
    if (typeof n !== 'number' || !Number.isFinite(n)) return fallback;
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
    const cleaned = {
        ...enemy,
        id: enemy.id == null ? undefined : String(enemy.id).slice(0, 120),
        name: String(enemy.name || 'Enemy').trim().slice(0, 100) || 'Enemy',
        hp,
        maxHp,
        ac: clampEnemyAC(enemy.ac),
        condition: enemyHealthCondition(hp, maxHp),
        combatStatus: ['active', 'fled', 'surrendered'].includes(enemy.combatStatus) ? enemy.combatStatus : 'active',
        defending: !!enemy.defending,
    };
    const ab = validateEnemyAttackBonus(enemy.attackBonus);
    const dmg = sanitizeEnemyDamage(enemy.damage);
    if (ab === undefined) delete cleaned.attackBonus; else cleaned.attackBonus = ab;
    if (dmg === undefined) delete cleaned.damage; else cleaned.damage = dmg;
    return cleaned;
}
