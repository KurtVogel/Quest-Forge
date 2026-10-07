export function isShieldItem(item) {
    // Boolean-strict (2026-09-12 P2): a string flag ("no") is truthy and equipped
    // a gear row as a shield; normalizeItem types the flag, this is the belt.
    return item?.type === 'shield' || item?.isShield === true;
}

export function isArmorItem(item) {
    return item?.type === 'armor' && !item?.isShield;
}

export function isWeaponItem(item) {
    return item?.type === 'weapon';
}

export function isEquippableItem(item) {
    return isWeaponItem(item) || isArmorItem(item) || isShieldItem(item);
}

/** Is `item`'s slot (weapon / armor / shield) already held by an equipped row? */
export function isSlotHeld(inventory = [], item) {
    const sameSlot = isWeaponItem(item) ? isWeaponItem : isArmorItem(item) ? isArmorItem : isShieldItem(item) ? isShieldItem : null;
    return !!sameSlot && inventory.some(row => row?.equipped && sameSlot(row));
}

/**
 * ONE auto-equip rule for ADD_ITEM and the load heal (2026-10-07
 * inventory-economy P2 — each had its own copy, and they disagreed: a
 * non-catalog armor with no baseAC auto-equipped on add and came back
 * unequipped after a reload). Armor and shields fill an EMPTY slot of their
 * kind; a shield never joins an active two-handed weapon; a weapon never
 * auto-equips (the premise `equipOnAdd` channel is the one sanctioned path).
 * Armor must carry a baseAC: an "armor" row with no AC is a costume, and it
 * must not take the slot the next real armor would otherwise auto-fill.
 */
export function shouldAutoEquip(inventory = [], item) {
    if (!item || item.equipped || isSlotHeld(inventory, item)) return false;
    if (isArmorItem(item)) return Number.isFinite(item.baseAC) && item.baseAC > 0;
    if (isShieldItem(item)) return !inventory.some(row => row?.equipped && isWeaponItem(row) && row.twoHanded);
    return false;
}

/**
 * Normalize equipped slots while preserving inventory order.
 * - one active weapon
 * - one worn armor
 * - one shield
 * - two-handed weapons and shields are mutually exclusive
 *
 * `preferredItemId` is used after a UI/DM equip action so the newly equipped
 * item wins conflicts against currently equipped gear.
 */
export function normalizeEquippedSlots(inventory = [], preferredItemId = null) {
    const items = inventory.map(item => ({ ...item }));
    const preferred = preferredItemId
        ? items.find(item => item.id === preferredItemId)
        : null;
    if (preferred) preferred.equipped = true;

    const ordered = preferred
        ? [preferred, ...items.filter(item => item.id !== preferred.id)]
        : items;

    let equippedArmor = null;
    let equippedShield = null;
    let equippedWeapon = null;

    for (const item of ordered) {
        if (!item.equipped) continue;

        // Invalid equipped flags can arrive from old saves, imports, or malformed
        // LLM equipment changes. Clear them instead of leaking gear into the slot UI.
        if (!isEquippableItem(item)) {
            item.equipped = false;
            continue;
        }

        if (isArmorItem(item)) {
            if (equippedArmor) item.equipped = false;
            else equippedArmor = item;
            continue;
        }

        if (isShieldItem(item)) {
            if (equippedShield || equippedWeapon?.twoHanded) item.equipped = false;
            else equippedShield = item;
            continue;
        }

        if (isWeaponItem(item)) {
            if (equippedWeapon || (item.twoHanded && equippedShield)) item.equipped = false;
            else equippedWeapon = item;
        }
    }

    return items;
}
