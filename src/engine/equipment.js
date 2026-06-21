export function isShieldItem(item) {
    return item?.type === 'shield' || item?.isShield;
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
