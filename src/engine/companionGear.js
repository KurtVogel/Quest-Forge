/**
 * Companion gear helpers — COMPANION_GEAR_SPEC.md follow-ups (IDEAS 2026-07-19).
 * Companion gear stays abstract (one weapon + implied armor through stats); these
 * helpers back the engine-owned Inventory "give gear" path and the structured
 * keepsake list for sentimental gifts.
 */
import { isNearDuplicateText } from './npcRoster.js';
import { isArmorItem, isShieldItem } from './equipment.js';

export const MAX_COMPANION_KEEPSAKES = 5;
const KEEPSAKE_MAX_LENGTH = 100;

/** The magic-weapon ceiling a companion's `weaponBonus` is read under (+1..+3, the item rule). */
export const COMPANION_WEAPON_BONUS_MAX = 3;

/**
 * Companion magic-weapon bonus (COMPANION_GEAR_SPEC.md D4): a flat additive
 * field set by the reducer when a gifted weapon carries +1..+3, consumed at
 * roll time — the spellAcBonus pattern. Absent on pre-gear saves ⇒ 0.
 */
export function companionWeaponBonus(companion) {
    const n = Number(companion?.weaponBonus);
    if (!Number.isFinite(n) || n <= 0) return 0;
    return Math.min(COMPANION_WEAPON_BONUS_MAX, Math.trunc(n));
}

/**
 * THE companion to-hit (2026-10-18 roll-resolution P2): the stat the reducer
 * owns plus the magic-weapon bonus, "applied to hit AND damage at roll time"
 * (DECISIONS 2026-07-19). The exchange composed it privately and the
 * out-of-combat `companion_attack` lane read `attackBonus` alone, so Bram
 * (+4, a +2 blade) swung at +6 in a fight and +4 at a rope. `fallback` is the
 * number a stat-less companion rolls at: 2 in the exchange, the DM's
 * band-checked modifier (or 0) on the resolver. Numeric belt (2026-09-09 P1):
 * a string `attackBonus` from a pre-fix save concatenated and threw.
 */
export function companionAttackBonus(companion, fallback = 2) {
    const base = Number(companion?.attackBonus);
    return (Number.isFinite(base) ? base : fallback) + companionWeaponBonus(companion);
}

/**
 * The AC a companion reaches by taking up a gifted armor or shield, before the
 * reducer's absolute 21 cap. Companions don't model ability scores, so light and
 * medium armor assume a modest +2 DEX competence (matches how DMs have priced
 * gifted armor in play: Chain Shirt 13 → companion AC 15); heavy armor is its
 * own number. Magic `acBonus` rides on top. Returns null when the item carries
 * no derivable protection value (not armor/shield, or a catalog-less curio).
 * A shield is priced onto the AC the caller passes — GIVE_GEAR_TO_COMPANION
 * passes the companion's AC MINUS the shield they already carry
 * (`companion.shieldBonus`, 2026-09-03), so shields replace instead of stack.
 */
export function deriveGiftAC(item, currentAc = 12) {
    if (!item || typeof item !== 'object') return null;
    if (isShieldItem(item)) {
        return (Number.isFinite(currentAc) ? currentAc : 12) + (item.shieldAC || 2) + (item.acBonus || 0);
    }
    if (isArmorItem(item) && Number.isFinite(item.baseAC)) {
        const dexAllowance = item.armorType === 'heavy' ? 0 : 2;
        return item.baseAC + dexAllowance + (item.acBonus || 0);
    }
    return null;
}

/**
 * Append-only capped keepsake list (the bondMoments/callbackHooks pattern):
 * restatements are dropped by token containment, the newest keepsakes survive
 * when the cap trims, and an update can never wholesale replace the list.
 */
export function appendKeepsakes(existing = [], additions = []) {
    const clean = list => (Array.isArray(list) ? list : [])
        // String-or-drop (2026-09-18 P2): an object `text` used to persist as "[object Object]".
        .map(entry => (typeof entry === 'string' ? entry : entry?.text))
        .map(entry => (typeof entry === 'string' ? entry.trim().slice(0, KEEPSAKE_MAX_LENGTH) : ''))
        .filter(Boolean);
    let next = clean(existing);
    for (const keepsake of clean(additions)) {
        if (next.some(known => isNearDuplicateText(keepsake, known))) continue;
        next = [...next, keepsake];
    }
    return next.slice(-MAX_COMPANION_KEEPSAKES);
}
