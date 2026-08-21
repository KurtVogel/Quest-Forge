/**
 * Core item catalog for common D&D-style equipment.
 *
 * Prices are stored as copper pieces so purchases can be validated atomically.
 * Mechanical bonuses are explicit fields; names like "Longsword +1" are display,
 * not the source of truth.
 */

const MAGIC_BONUS_MAX = 3;

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
    potionHealing: { name: 'Potion of Healing', type: 'consumable', consumableType: 'healing', healing: '2d4+2', actionType: 'bonus', valueCp: 50 * GP, weight: 1 },
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

const CATALOG_NAMES_BY_LENGTH = Object.entries(ITEM_CATALOG)
    .map(([key, item]) => [key, item.name.toLowerCase()])
    .sort((a, b) => b[1].length - a[1].length);

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
    const withoutBonus = lower.replace(/\s*\+[1-3]\b/g, '').trim();
    const compact = withoutBonus.replace(/[^a-z0-9]/g, '');
    if (NAME_TO_KEY[compact]) return NAME_TO_KEY[compact];

    // LLMs commonly add a bounded descriptive prefix to ordinary equipment
    // ("massive warhammer", "weathered leather armor"). Match only a complete
    // catalog-name suffix so unrelated story objects do not become mechanical gear.
    const descriptorMatch = CATALOG_NAMES_BY_LENGTH.find(([, name]) => withoutBonus.endsWith(` ${name}`));
    if (descriptorMatch) return descriptorMatch[0];

    // Plural grants ("Torches", "Healing Potions") resolve to their singular
    // catalog entry — counts parsed out of names arrive pluralized (2026-08-22).
    if (/[a-z]s$/.test(withoutBonus)) {
        for (const singular of new Set([withoutBonus.replace(/es$/, ''), withoutBonus.replace(/s$/, '')])) {
            if (singular && singular !== withoutBonus) {
                const key = normalizeItemKey(singular);
                if (key) return key;
            }
        }
    }
    return null;
}

// Remainders that are measurements, not item counts: "10 foot pole" is one pole.
const COUNT_UNIT_HEAD_RE = /^(?:foot|feet|ft|inch|inches|in|pound|pounds|lb|lbs|yard|yards|meter|meters|metre|metres|gallon|gallons|pint|pints|sided)\b/i;

/**
 * Parse a count the LLM embedded in an item NAME ("3 Torches", "7 days of
 * Trail Rations", "2x Healing Potion", "Torch x3") into { name, quantity } —
 * live 2026-08-22: such grants minted literal rows like `3 Torches ×1` that
 * never stack and cannot decrement. Parenthesized suffixes ("Wax Candles (x5)",
 * "Hempen Rope (50 ft)") are catalog bundle names and are deliberately left
 * alone, as is any raw name the catalog already recognizes.
 * Returns null when there is no embedded count.
 */
export function parseCountedItemName(name = '') {
    const raw = String(name).trim();
    if (!raw) return null;
    // Exact catalog identities pass through untouched. Deliberately NOT the full
    // normalizeItemKey resolution: its plural/suffix fallbacks can resolve
    // "3 Torches" (via "3 torch") and would swallow the count we are here for.
    if (ITEM_CATALOG[raw] || NAME_TO_KEY[raw.toLowerCase()]) return null;
    let count;
    let rest;
    let match = raw.match(/^(\d{1,3})\s*[x×]\s*(.+)$/i)
        || raw.match(/^(\d{1,3})\s+(?:days?|nights?)\s+(?:worth\s+)?of\s+(.+)$/i)
        || raw.match(/^(\d{1,3})\s+(.+)$/);
    if (match) {
        count = Number(match[1]);
        rest = match[2].trim();
    } else {
        match = raw.match(/^(.+?)\s*[x×]\s*(\d{1,3})$/i);
        if (!match) return null;
        rest = match[1].trim();
        count = Number(match[2]);
    }
    if (!rest || COUNT_UNIT_HEAD_RE.test(rest)) return null;
    return {
        name: rest,
        quantity: Math.max(1, Math.min(MAX_ITEM_QUANTITY, Math.trunc(count) || 1)),
    };
}

function applyMagicName(item) {
    const bonus = clampMagicBonus(item.magicBonus || 0);
    if (!bonus) return item;
    const baseName = String(item.name || '').replace(/\s*\+[1-3]\b/g, '');
    return { ...item, name: `${baseName} +${bonus}` };
}

// Hostile-input bounds at the DM-JSON trust boundary: a hallucinated event must not
// mint an absurd stack or a fortune-valued trinket. The value ceiling mirrors the
// coin-grant clamp (10,000 gp) so no single item outweighs the largest legal payout.
const MAX_ITEM_QUANTITY = 999;
const MAX_ITEM_VALUE_CP = 1000000;
// AC/attack stats on non-catalog gear are LLM- or import-authored; the hero is
// the only combatant with no other ceiling (companions clamp at 21, enemies are
// band-validated), so bound them here. Ceilings mirror the best catalog gear:
// plate 18, shield 2 (+1 headroom), magic bonuses ≤ +3.
const MAX_ARMOR_BASE_AC = 18;
const MAX_SHIELD_AC = 3;
const ARMOR_TYPES = ['light', 'medium', 'heavy'];

export function normalizeItem(raw = {}) {
    const source = typeof raw === 'string' ? { name: raw } : { ...raw };
    // A count embedded in the name becomes quantity ("3 Torches" → Torch ×3);
    // an explicit quantity field from the payload still wins when present.
    const counted = parseCountedItemName(source.name);
    if (counted) {
        source.name = counted.name;
        if (!(Number.isFinite(source.quantity) && source.quantity > 1)) {
            source.quantity = counted.quantity;
        }
    }
    const itemKey = normalizeItemKey(source.itemKey || source.key || source.name);
    const base = itemKey ? ITEM_CATALOG[itemKey] : {};
    const parsedBonus = parseMagicBonusFromName(source.name || base.name);
    const magicBonus = clampMagicBonus(source.magicBonus ?? source.enhancement ?? source.bonus ?? parsedBonus);
    const hasExplicitValue = Number.isFinite(source.valueCp) || Number.isFinite(source.priceCp);
    const quantity = Number.isFinite(source.quantity) && source.quantity > 0
        ? Math.min(MAX_ITEM_QUANTITY, Math.trunc(source.quantity))
        : (base.quantity || 1);
    const itemType = base.type || source.type || 'gear';
    const isWeapon = itemType === 'weapon';
    const isArmorLike = itemType === 'armor' || itemType === 'shield' || source.isShield || base.isShield;
    const normalized = {
        ...base,
        ...source,
        // A recognized catalog entry is canonical. The LLM may identify and describe
        // the item, but it cannot override its mechanical type or statistics.
        ...(itemKey ? base : {}),
        itemKey: itemKey || source.itemKey || null,
        name: itemKey ? base.name : (source.name || 'Unknown item'),
        type: itemType,
        weight: itemKey ? (base.weight ?? 1) : (Number.isFinite(source.weight) ? source.weight : 1),
        magicBonus,
        valueCp: hasExplicitValue
            ? (itemKey ? (magicBonus ? MAGIC_ITEM_VALUES[magicBonus] : base.valueCp) : (Number.isFinite(source.valueCp) ? source.valueCp : source.priceCp))
            : (magicBonus ? MAGIC_ITEM_VALUES[magicBonus] : base.valueCp),
        attackBonus: itemKey ? (base.attackBonus || (isWeapon ? magicBonus : 0)) : (Number.isFinite(source.attackBonus) ? source.attackBonus : 0),
        damageBonus: itemKey ? (base.damageBonus || (isWeapon ? magicBonus : 0)) : (Number.isFinite(source.damageBonus) ? source.damageBonus : 0),
        acBonus: itemKey ? (base.acBonus || (isArmorLike ? magicBonus : 0)) : (Number.isFinite(source.acBonus) ? source.acBonus : 0),
        rarity: source.rarity || base.rarity || (magicBonus ? MAGIC_ITEM_RARITY[magicBonus] : undefined),
        quantity,
    };

    // Non-catalog values come straight from the LLM; a sold item pays out half its
    // valueCp, so an unbounded value is an unbounded mint.
    if (Number.isFinite(normalized.valueCp)) {
        normalized.valueCp = Math.max(0, Math.min(MAX_ITEM_VALUE_CP, Math.trunc(normalized.valueCp)));
    }

    normalized.attackBonus = clampMagicBonus(normalized.attackBonus);
    normalized.damageBonus = clampMagicBonus(normalized.damageBonus);
    normalized.acBonus = clampMagicBonus(normalized.acBonus);

    if (normalized.type === 'armor') {
        if (Number.isFinite(normalized.baseAC)) {
            normalized.baseAC = Math.max(0, Math.min(MAX_ARMOR_BASE_AC, Math.trunc(normalized.baseAC)));
            // getArmorClass ignores baseAC without a recognized armorType; infer
            // from the catalog's bands so the AC the DM prompt advertises is the
            // AC the engine computes.
            if (!ARMOR_TYPES.includes(normalized.armorType)) {
                normalized.armorType = normalized.baseAC <= 12 ? 'light' : normalized.baseAC <= 15 ? 'medium' : 'heavy';
            }
        } else {
            delete normalized.baseAC;
        }
    }

    if (normalized.type === 'shield') {
        normalized.isShield = true;
        normalized.shieldAC = Number.isFinite(normalized.shieldAC)
            ? Math.max(0, Math.min(MAX_SHIELD_AC, Math.trunc(normalized.shieldAC)))
            : 2;
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
