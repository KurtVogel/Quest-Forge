/**
 * Companion gear helpers — COMPANION_GEAR_SPEC.md follow-ups (IDEAS 2026-07-19).
 * Companion gear stays abstract (one weapon + implied armor through stats); these
 * helpers back the engine-owned Inventory "give gear" path and the structured
 * keepsake list for sentimental gifts.
 */
import { isNearDuplicateText } from './npcRoster.js';

export const MAX_COMPANION_KEEPSAKES = 5;
const KEEPSAKE_MAX_LENGTH = 100;

/**
 * The AC a companion reaches by taking up a gifted armor or shield, before the
 * reducer's absolute 21 cap. Companions don't model ability scores, so light and
 * medium armor assume a modest +2 DEX competence (matches how DMs have priced
 * gifted armor in play: Chain Shirt 13 → companion AC 15); heavy armor is its
 * own number. Magic `acBonus` rides on top. Returns null when the item carries
 * no derivable protection value (not armor/shield, or a catalog-less curio).
 */
export function deriveGiftAC(item, currentAc = 12) {
    if (!item || typeof item !== 'object') return null;
    if (item.type === 'shield' || item.isShield) {
        return (Number.isFinite(currentAc) ? currentAc : 12) + (item.shieldAC || 2) + (item.acBonus || 0);
    }
    if (item.type === 'armor' && Number.isFinite(item.baseAC)) {
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
        .map(entry => String(typeof entry === 'string' ? entry : entry?.text || '').trim().slice(0, KEEPSAKE_MAX_LENGTH))
        .filter(Boolean);
    let next = clean(existing);
    for (const keepsake of clean(additions)) {
        if (next.some(known => isNearDuplicateText(keepsake, known))) continue;
        next = [...next, keepsake];
    }
    return next.slice(-MAX_COMPANION_KEEPSAKES);
}
