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
 * and immediately before rolling (defense-in-depth). Also the home of what
 * every lane reads ABOUT an enemy: the health ladder (`healthWord`), the
 * outcome word (`enemyOutcome`) and the engine defaults (`ENEMY_DEFAULT_*`).
 */

import { toFlag } from '../data/items.js';
import { CONDITION_EFFECTS } from './rules.js';

const ATTACK_BONUS_MIN = -5;
const ATTACK_BONUS_MAX = 15;
const DAMAGE_DICE_MAX = 4;
const DAMAGE_SIDES = [4, 6, 8, 10, 12]; // weapon/natural dice only — d20/d100 are not damage dice
const DAMAGE_MOD_MIN = -5;
const DAMAGE_MOD_MAX = 15;
const AC_MIN = 1;
const AC_MAX = 25;
const HP_MAX = 999;
/**
 * The conditions an ENEMY can carry — DERIVED from the hero's CONDITION_EFFECTS
 * table (one vocabulary since 2026-10-10, enemy-stats P2: this was a hand-copied
 * list, the prompt's sentence a third copy, the long-rest list a fourth): a row
 * that touches a die an enemy rolls or suffers (its attacks, its saves, or the
 * attacks against it). `exhausted` (check disadvantage only) is absent BY
 * CONSTRUCTION — enemies never make checks, so a DM's "exhausted ogre" drops
 * the condition (visible on the enemy card as simply not listed) rather than
 * carrying a mechanical no-op through every exchange.
 */
export const SUPPORTED_ENEMY_CONDITIONS = new Set(Object.entries(CONDITION_EFFECTS)
    .filter(([, effect]) => effect.attack || effect.save || effect.incomingAttack)
    .map(([name]) => name));

/** The DM prompt's own sentence, rendered from the Set at module load (prefix-stable). */
export const SUPPORTED_ENEMY_CONDITIONS_SENTENCE = (() => {
    const names = [...SUPPORTED_ENEMY_CONDITIONS];
    return `Supported enemy conditions are ${names.slice(0, -1).join(', ')}, and ${names[names.length - 1]}.`;
})();

/**
 * Canonical `enemy-…` id for a DM-declared foe, unique within one fight via
 * `usedIds`. ONE implementation shared by the parser boundary
 * (validateCombatStart) and the reducer (START_COMBAT) — they were byte-
 * identical duplicates whose suffix/prefix policy could silently drift
 * (2026-08-29 audit).
 */
export function canonicalEnemyId(enemy, index, usedIds) {
    // Type-strict reads (2026-10-10): an object id or name used to mint
    // `enemy-object-object` — the ordinal is the fallback for junk, as for absence.
    const text = value => ((typeof value === 'string' && value.trim()) || (typeof value === 'number' && Number.isFinite(value)) ? String(value) : '');
    const fragment = (text(enemy?.id) || text(enemy?.name) || String(index + 1))
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
    // A scalar `conditions: "prone"` is a one-item list — combat_start and the
    // load boundary read it as `[]` while the exchange's condition lanes
    // already accepted it (2026-09-15 audit P2).
    const list = Array.isArray(value) ? value : (typeof value === 'string' ? [value] : []);
    // No count cap needed: the supported-set filter + dedupe already bounds
    // the result at the set's size.
    return [...new Set(list
        .map(condition => (typeof condition === 'string' ? condition.trim().toLowerCase() : ''))
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
 * A saving-throw bonus: the SAME band and rule as the attack bonus by the
 * spellcasting v1 spec (one flat number per enemy — six per-ability scores
 * are deliberately not modeled), so it IS that validator under the name a
 * call site reads (one body since 2026-10-10, enemy-stats nit).
 */
export const validateEnemySaveBonus = validateEnemyAttackBonus;

/**
 * NdM(±K) with an optional trailing damage TYPE. "2d8+4 bludgeoning" /
 * "1d8 + 2 (slashing)" is how statblocks write damage, not a hallucination —
 * the suffix used to reject the whole notation to the 1d6 default silently
 * for the whole fight (2026-09-15 audit P1; the companion twin
 * boundCompanionDamage strips it since 09-09). The suffix admits no digits,
 * so multi-part damage ("1d8+2, plus 1d6 poison") still rejects: that is not
 * one notation.
 */
const ENEMY_DAMAGE_NOTATION = /^(\d{1,2})\s*d\s*(\d{1,3})\s*(?:([+-])\s*(\d{1,3}))?\s*(\(?[a-z][a-z ,/()-]*)?$/i;

/** A bounded NdM(+/-K) weapon-damage notation, or undefined (→ engine default) if invalid/out-of-range. */
export function sanitizeEnemyDamage(notation) {
    if (typeof notation !== 'string') return undefined;
    const m = notation.trim().match(ENEMY_DAMAGE_NOTATION);
    if (!m) return undefined;
    const count = parseInt(m[1], 10);
    const sides = parseInt(m[2], 10);
    const mod = m[3] ? parseInt(`${m[3]}${m[4]}`, 10) : 0;
    if (count < 1 || count > DAMAGE_DICE_MAX) return undefined;
    if (!DAMAGE_SIDES.includes(sides)) return undefined;
    if (mod < DAMAGE_MOD_MIN || mod > DAMAGE_MOD_MAX) return undefined;
    const cleaned = `${count}d${sides}${mod ? (mod > 0 ? `+${mod}` : `${mod}`) : ''}`;
    if (m[5]) console.warn(`[enemyStats] Dropped trailing damage type from "${notation.trim()}" → ${cleaned}.`);
    return cleaned;
}

/** A DM-declared HP that is finite and non-positive — a foe declared already down. */
export function isDeclaredDowned(hp) {
    const n = toNumber(hp);
    return Number.isFinite(n) && n <= 0;
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

/**
 * THE health ladder (2026-10-05): one combatant's HP as the word the prompt,
 * the cards and the fight tally read. It was three byte-equivalent functions
 * (an enemy's, a companion's in the exchange, a companion's in the reducer)
 * and a fourth bare 0.25 for the fight mark.
 */
export const HEALTH_CRITICAL_RATIO = 0.25;
export const HEALTH_BLOODIED_RATIO = 0.5;

/** The three standing health words, in order; `healthWord` adds the lane's own down word. */
export const HEALTH_WORDS = ['healthy', 'bloodied', 'critical'];

/** `healthy` / `bloodied` (≤ half) / `critical` (≤ a quarter) / `downWord` at 0 HP — an ENEMY's down word is the default `dead`. */
export function healthWord(hp, maxHp, downWord = 'dead') {
    if (!(hp > 0)) return downWord;
    const ratio = maxHp > 0 ? hp / maxHp : 1;
    if (ratio <= HEALTH_CRITICAL_RATIO) return 'critical';
    if (ratio <= HEALTH_BLOODIED_RATIO) return 'bloodied';
    return 'healthy';
}

/**
 * How an enemy stands in the fight — the ONE reading of the `hp` /
 * `condition` / `combatStatus` tuple (it was re-typed at five sites):
 * `defeated` (0 HP or dead), `fled`, `surrendered`, else `active`.
 */
export function enemyOutcome(enemy) {
    if (!((enemy?.hp ?? 0) > 0) || enemy.condition === 'dead') return 'defeated';
    if (enemy.combatStatus === 'fled') return 'fled';
    if (enemy.combatStatus === 'surrendered') return 'surrendered';
    return 'active';
}

/**
 * What an enemy rolls with when its statline omitted (or failed validation on)
 * an offensive stat — the conservative engine defaults every lane reads.
 */
export const ENEMY_DEFAULT_ATTACK_BONUS = 3;
export const ENEMY_DEFAULT_DAMAGE = '1d6';
export const ENEMY_DEFAULT_SAVE_BONUS = 2;

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
 * The TYPED identity, flags and offensive stats of an enemy — ONE composer for
 * the parser (validateCombatStart), START_COMBAT and the load twin
 * (2026-10-09 enemy-stats P2: START_COMBAT's copy wrote `String(name)` and
 * `!!isUndead`, so an object name fielded "[object Object]" as a turnable
 * undead on the reducer lane). Snake- and camel-case keys both read (the
 * wire writes snake, the record camel). Each site adds what only it owns:
 * the id, the HP / AC clamps, initiative, the health word, the status.
 */
export function typeEnemyFields(raw, { fallbackName = 'Enemy' } = {}) {
    const out = {
        name: (typeof raw?.name === 'string' ? raw.name.trim().slice(0, 100) : '') || fallbackName,
        conditions: normalizeEnemyConditions(raw?.conditions),
        isUndead: toFlag(raw?.is_undead ?? raw?.isUndead),
        // Untrusted narrative flag, strict by policy — the XP estimator gates it
        // on the statline before honoring the boss tier.
        boss: raw?.boss === true || raw?.isBoss === true,
    };
    const ab = validateEnemyAttackBonus(raw?.attack_bonus ?? raw?.attackBonus);
    const dmg = sanitizeEnemyDamage(raw?.damage);
    const sb = validateEnemySaveBonus(raw?.save_bonus ?? raw?.saveBonus);
    if (ab !== undefined) out.attackBonus = ab;
    if (dmg !== undefined) out.damage = dmg;
    if (sb !== undefined) out.saveBonus = sb;
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
    // Typed text/flag fields (2026-09-15 audit P2): `String(enemy.name)` loaded
    // an object name as "[object Object]" on the card AND in the combat prompt,
    // a non-string id re-minted to `enemy-object-object`, `isUndead: "false"`
    // was true, and `combatStatus: "FLED"` was a live foe. An untyped id is
    // dropped so assignUniqueEnemyIds re-mints it; `boss` stays strict by policy.
    const status = typeof enemy.combatStatus === 'string' ? enemy.combatStatus.trim().toLowerCase() : '';
    const cleaned = {
        id: typeof enemy.id === 'string' || typeof enemy.id === 'number' ? String(enemy.id).slice(0, 120) : undefined,
        ...typeEnemyFields(enemy),
        hp,
        maxHp,
        ac: clampEnemyAC(enemy.ac),
        condition: healthWord(hp, maxHp),
        combatStatus: ['active', 'fled', 'surrendered'].includes(status) ? status : 'active',
        defending: toFlag(enemy.defending),
    };
    if (typeof enemy.initiative === 'number' && Number.isFinite(enemy.initiative)) {
        cleaned.initiative = enemy.initiative;
    }
    return cleaned;
}
