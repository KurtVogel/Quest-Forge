/**
 * Core item catalog for common D&D-style equipment.
 *
 * Prices are stored as copper pieces so purchases can be validated atomically.
 * Mechanical bonuses are explicit fields; names like "Longsword +1" are display,
 * not the source of truth.
 */

export const MAGIC_BONUS_MAX = 3;

const GP = 100;
const SP = 10;
const MAGIC_ITEM_VALUES = {
    1: 500 * GP,
    2: 5000 * GP,
    3: 50000 * GP,
};
const MAGIC_ITEM_RARITY = {
    1: 'uncommon',
    2: 'rare',
    3: 'very rare',
};

export const ITEM_CATALOG = {
    // Simple melee weapons
    club: { name: 'Club', type: 'weapon', category: 'simpleMelee', damage: '1d4', damageType: 'bludgeoning', valueCp: 1 * SP, weight: 2 },
    dagger: { name: 'Dagger', type: 'weapon', category: 'simpleMelee', damage: '1d4', damageType: 'piercing', valueCp: 2 * GP, weight: 1, finesse: true, thrown: true },
    greatclub: { name: 'Greatclub', type: 'weapon', category: 'simpleMelee', damage: '1d8', damageType: 'bludgeoning', valueCp: 2 * SP, weight: 10, twoHanded: true },
    handaxe: { name: 'Handaxe', type: 'weapon', category: 'simpleMelee', damage: '1d6', damageType: 'slashing', valueCp: 5 * GP, weight: 2, thrown: true },
    javelin: { name: 'Javelin', type: 'weapon', category: 'simpleMelee', damage: '1d6', damageType: 'piercing', valueCp: 5 * SP, weight: 2, thrown: true },
    lightHammer: { name: 'Light Hammer', type: 'weapon', category: 'simpleMelee', damage: '1d4', damageType: 'bludgeoning', valueCp: 2 * GP, weight: 2, thrown: true },
    mace: { name: 'Mace', type: 'weapon', category: 'simpleMelee', damage: '1d6', damageType: 'bludgeoning', valueCp: 5 * GP, weight: 4 },
    quarterstaff: { name: 'Quarterstaff', type: 'weapon', category: 'simpleMelee', damage: '1d6', damageVersatile: '1d8', damageType: 'bludgeoning', valueCp: 2 * SP, weight: 4, versatile: true },
    sickle: { name: 'Sickle', type: 'weapon', category: 'simpleMelee', damage: '1d4', damageType: 'slashing', valueCp: 1 * GP, weight: 2 },
    spear: { name: 'Spear', type: 'weapon', category: 'simpleMelee', damage: '1d6', damageVersatile: '1d8', damageType: 'piercing', valueCp: 1 * GP, weight: 3, thrown: true, versatile: true },

    // Simple ranged weapons
    lightCrossbow: { name: 'Light Crossbow', type: 'weapon', category: 'simpleRanged', damage: '1d8', damageType: 'piercing', valueCp: 25 * GP, weight: 5, ranged: true, twoHanded: true },
    dart: { name: 'Dart', type: 'weapon', category: 'simpleRanged', damage: '1d4', damageType: 'piercing', valueCp: 5, weight: 0.25, ranged: true, finesse: true },
    shortbow: { name: 'Shortbow', type: 'weapon', category: 'simpleRanged', damage: '1d6', damageType: 'piercing', valueCp: 25 * GP, weight: 2, ranged: true, twoHanded: true },
    sling: { name: 'Sling', type: 'weapon', category: 'simpleRanged', damage: '1d4', damageType: 'bludgeoning', valueCp: 1 * SP, weight: 0, ranged: true },

    // Martial melee weapons
    battleaxe: { name: 'Battleaxe', type: 'weapon', category: 'martialMelee', damage: '1d8', damageVersatile: '1d10', damageType: 'slashing', valueCp: 10 * GP, weight: 4, versatile: true },
    flail: { name: 'Flail', type: 'weapon', category: 'martialMelee', damage: '1d8', damageType: 'bludgeoning', valueCp: 10 * GP, weight: 2 },
    glaive: { name: 'Glaive', type: 'weapon', category: 'martialMelee', damage: '1d10', damageType: 'slashing', valueCp: 20 * GP, weight: 6, twoHanded: true, reach: true },
    greataxe: { name: 'Greataxe', type: 'weapon', category: 'martialMelee', damage: '1d12', damageType: 'slashing', valueCp: 30 * GP, weight: 7, twoHanded: true },
    greatsword: { name: 'Greatsword', type: 'weapon', category: 'martialMelee', damage: '2d6', damageType: 'slashing', valueCp: 50 * GP, weight: 6, twoHanded: true },
    halberd: { name: 'Halberd', type: 'weapon', category: 'martialMelee', damage: '1d10', damageType: 'slashing', valueCp: 20 * GP, weight: 6, twoHanded: true, reach: true },
    lance: { name: 'Lance', type: 'weapon', category: 'martialMelee', damage: '1d12', damageType: 'piercing', valueCp: 10 * GP, weight: 6, reach: true },
    longsword: { name: 'Longsword', type: 'weapon', category: 'martialMelee', damage: '1d8', damageVersatile: '1d10', damageType: 'slashing', valueCp: 15 * GP, weight: 3, versatile: true },
    maul: { name: 'Maul', type: 'weapon', category: 'martialMelee', damage: '2d6', damageType: 'bludgeoning', valueCp: 10 * GP, weight: 10, twoHanded: true },
    morningstar: { name: 'Morningstar', type: 'weapon', category: 'martialMelee', damage: '1d8', damageType: 'piercing', valueCp: 15 * GP, weight: 4 },
    pike: { name: 'Pike', type: 'weapon', category: 'martialMelee', damage: '1d10', damageType: 'piercing', valueCp: 5 * GP, weight: 18, twoHanded: true, reach: true },
    rapier: { name: 'Rapier', type: 'weapon', category: 'martialMelee', damage: '1d8', damageType: 'piercing', valueCp: 25 * GP, weight: 2, finesse: true },
    scimitar: { name: 'Scimitar', type: 'weapon', category: 'martialMelee', damage: '1d6', damageType: 'slashing', valueCp: 25 * GP, weight: 3, finesse: true },
    shortsword: { name: 'Shortsword', type: 'weapon', category: 'martialMelee', damage: '1d6', damageType: 'piercing', valueCp: 10 * GP, weight: 2, finesse: true },
    trident: { name: 'Trident', type: 'weapon', category: 'martialMelee', damage: '1d6', damageVersatile: '1d8', damageType: 'piercing', valueCp: 5 * GP, weight: 4, thrown: true, versatile: true },
    warPick: { name: 'War Pick', type: 'weapon', category: 'martialMelee', damage: '1d8', damageType: 'piercing', valueCp: 5 * GP, weight: 2 },
    warhammer: { name: 'Warhammer', type: 'weapon', category: 'martialMelee', damage: '1d8', damageVersatile: '1d10', damageType: 'bludgeoning', valueCp: 15 * GP, weight: 2, versatile: true },
    whip: { name: 'Whip', type: 'weapon', category: 'martialMelee', damage: '1d4', damageType: 'slashing', valueCp: 2 * GP, weight: 3, finesse: true, reach: true },

    // Martial ranged weapons
    blowgun: { name: 'Blowgun', type: 'weapon', category: 'martialRanged', damage: '1', damageType: 'piercing', valueCp: 10 * GP, weight: 1, ranged: true },
    handCrossbow: { name: 'Hand Crossbow', type: 'weapon', category: 'martialRanged', damage: '1d6', damageType: 'piercing', valueCp: 75 * GP, weight: 3, ranged: true },
    heavyCrossbow: { name: 'Heavy Crossbow', type: 'weapon', category: 'martialRanged', damage: '1d10', damageType: 'piercing', valueCp: 50 * GP, weight: 18, ranged: true, twoHanded: true },
    longbow: { name: 'Longbow', type: 'weapon', category: 'martialRanged', damage: '1d8', damageType: 'piercing', valueCp: 50 * GP, weight: 2, ranged: true, twoHanded: true },
    net: { name: 'Net', type: 'weapon', category: 'martialRanged', damage: '0', damageType: 'restraining', valueCp: 1 * GP, weight: 3, ranged: true },

    // Armor and shields
    paddedArmor: { name: 'Padded Armor', type: 'armor', armorType: 'light', baseAC: 11, valueCp: 5 * GP, weight: 8 },
    leatherArmor: { name: 'Leather Armor', type: 'armor', armorType: 'light', baseAC: 11, valueCp: 10 * GP, weight: 10 },
    studdedLeatherArmor: { name: 'Studded Leather Armor', type: 'armor', armorType: 'light', baseAC: 12, valueCp: 45 * GP, weight: 13 },
    hideArmor: { name: 'Hide Armor', type: 'armor', armorType: 'medium', baseAC: 12, valueCp: 10 * GP, weight: 12 },
    chainShirt: { name: 'Chain Shirt', type: 'armor', armorType: 'medium', baseAC: 13, valueCp: 50 * GP, weight: 20 },
    scaleMail: { name: 'Scale Mail', type: 'armor', armorType: 'medium', baseAC: 14, valueCp: 50 * GP, weight: 45 },
    breastplate: { name: 'Breastplate', type: 'armor', armorType: 'medium', baseAC: 14, valueCp: 400 * GP, weight: 20 },
    halfPlate: { name: 'Half Plate', type: 'armor', armorType: 'medium', baseAC: 15, valueCp: 750 * GP, weight: 40 },
    ringMail: { name: 'Ring Mail', type: 'armor', armorType: 'heavy', baseAC: 14, valueCp: 30 * GP, weight: 40 },
    chainMail: { name: 'Chain Mail', type: 'armor', armorType: 'heavy', baseAC: 16, valueCp: 75 * GP, weight: 55 },
    splintArmor: { name: 'Splint Armor', type: 'armor', armorType: 'heavy', baseAC: 17, valueCp: 200 * GP, weight: 60 },
    plateArmor: { name: 'Plate Armor', type: 'armor', armorType: 'heavy', baseAC: 18, valueCp: 1500 * GP, weight: 65 },
    shield: { name: 'Shield', type: 'shield', isShield: true, shieldAC: 2, valueCp: 10 * GP, weight: 6 },

    // Common gear and consumables
    potionHealing: { name: 'Potion of Healing', type: 'consumable', consumableType: 'healing', healing: '2d4+2', valueCp: 50 * GP, weight: 1 },
    antitoxin: { name: 'Antitoxin', type: 'consumable', consumableType: 'antitoxin', valueCp: 50 * GP, weight: 0 },
    healerKit: { name: "Healer's Kit", type: 'gear', valueCp: 5 * GP, weight: 3, quantity: 1 },
    rations: { name: 'Rations (1 day)', type: 'gear', valueCp: 5 * SP, weight: 2, quantity: 1 },
    torch: { name: 'Torch', type: 'gear', valueCp: 1, weight: 1, quantity: 1 },
    ropeHempen: { name: 'Hempen Rope (50 ft)', type: 'gear', valueCp: 1 * GP, weight: 10 },
    ropeSilk: { name: 'Silk Rope (50 ft)', type: 'gear', valueCp: 10 * GP, weight: 5 },
    thievesTools: { name: "Thieves' Tools", type: 'tool', valueCp: 25 * GP, weight: 1 },
    explorerPack: { name: "Explorer's Pack", type: 'gear', valueCp: 10 * GP, weight: 10 },
    scholarPack: { name: "Scholar's Pack", type: 'gear', valueCp: 40 * GP, weight: 10 },
    componentPouch: { name: 'Component Pouch', type: 'gear', valueCp: 25 * GP, weight: 2 },
};

const NAME_TO_KEY = Object.entries(ITEM_CATALOG).reduce((acc, [key, item]) => {
    acc[item.name.toLowerCase()] = key;
    acc[item.name.toLowerCase().replace(/[^a-z0-9]/g, '')] = key;
    return acc;
}, {});

export function clampMagicBonus(value) {
    if (!Number.isFinite(value)) return 0;
    return Math.max(0, Math.min(MAGIC_BONUS_MAX, Math.trunc(value)));
}

export function parseMagicBonusFromName(name = '') {
    const match = String(name).match(/\+([1-3])\b/);
    return match ? Number(match[1]) : 0;
}

export function normalizeItemKey(value = '') {
    const raw = String(value).trim();
    if (!raw) return null;
    if (ITEM_CATALOG[raw]) return raw;
    const lower = raw.toLowerCase();
    if (NAME_TO_KEY[lower]) return NAME_TO_KEY[lower];
    return NAME_TO_KEY[lower.replace(/\s*\+[1-3]\b/g, '').replace(/[^a-z0-9]/g, '')] || null;
}

function applyMagicName(item) {
    const bonus = clampMagicBonus(item.magicBonus || 0);
    if (!bonus) return item;
    const baseName = String(item.name || '').replace(/\s*\+[1-3]\b/g, '');
    return { ...item, name: `${baseName} +${bonus}` };
}

export function normalizeItem(raw = {}) {
    const source = typeof raw === 'string' ? { name: raw } : { ...raw };
    const itemKey = normalizeItemKey(source.itemKey || source.key || source.name);
    const base = itemKey ? ITEM_CATALOG[itemKey] : {};
    const parsedBonus = parseMagicBonusFromName(source.name || base.name);
    const magicBonus = clampMagicBonus(source.magicBonus ?? source.enhancement ?? source.bonus ?? parsedBonus);
    const hasExplicitValue = Number.isFinite(source.valueCp) || Number.isFinite(source.priceCp);
    const quantity = Number.isFinite(source.quantity) && source.quantity > 0 ? Math.trunc(source.quantity) : (base.quantity || 1);
    const itemType = source.type || base.type || 'gear';
    const isWeapon = itemType === 'weapon';
    const isArmorLike = itemType === 'armor' || itemType === 'shield' || source.isShield || base.isShield;
    const normalized = {
        itemKey: itemKey || source.itemKey || null,
        name: source.name || base.name || 'Unknown item',
        type: itemType,
        weight: Number.isFinite(source.weight) ? source.weight : (base.weight ?? 1),
        ...base,
        ...source,
        magicBonus,
        valueCp: hasExplicitValue
            ? (Number.isFinite(source.valueCp) ? source.valueCp : source.priceCp)
            : (magicBonus ? MAGIC_ITEM_VALUES[magicBonus] : base.valueCp),
        attackBonus: Number.isFinite(source.attackBonus) ? source.attackBonus : (base.attackBonus || (isWeapon ? magicBonus : 0)),
        damageBonus: Number.isFinite(source.damageBonus) ? source.damageBonus : (base.damageBonus || (isWeapon ? magicBonus : 0)),
        acBonus: Number.isFinite(source.acBonus) ? source.acBonus : (base.acBonus || (isArmorLike ? magicBonus : 0)),
        rarity: source.rarity || base.rarity || (magicBonus ? MAGIC_ITEM_RARITY[magicBonus] : undefined),
        quantity,
    };

    if (normalized.type === 'shield') {
        normalized.isShield = true;
        normalized.shieldAC = Number.isFinite(normalized.shieldAC) ? normalized.shieldAC : 2;
    }

    return applyMagicName(normalized);
}

export function describeCatalogForPrompt() {
    const compact = Object.entries(ITEM_CATALOG)
        .filter(([, item]) => ['weapon', 'armor', 'shield', 'consumable'].includes(item.type))
        .map(([key, item]) => `${key}: ${item.name}${item.damage ? ` ${item.damage}` : ''}${item.baseAC ? ` AC ${item.baseAC}` : ''}${item.isShield ? ' +2 AC' : ''}`)
        .join('; ');
    return compact;
}
