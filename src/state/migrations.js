/**
 * Versioned save-migration pipeline for LOAD_GAME.
 *
 * Every persisted save is stamped with a version (persistence.js /
 * cloudSync.js both stamp CURRENT_SAVE_VERSION via serializeGameState).
 * On load, gameReducer's LOAD_GAME runs validateSaveState (hostile-shape
 * defense) and then `migrateLoadedSave` — this file — over the validated
 * payload.
 *
 * The pipeline is split honestly into two categories:
 *
 *  - UNCONDITIONAL HEALS (`UNCONDITIONAL_HEALS`): run on every load, whatever
 *    the stamped version says. Most "migrations" here double as hostile-input
 *    healing — a cloud save can be hand-edited, so a version stamp is no proof
 *    of shape. Each step carries its own idempotent guard, so on a healthy
 *    current-version save they are no-ops. The win is extraction and naming,
 *    not version-gating.
 *
 *  - VERSIONED MIGRATIONS (`MIGRATIONS`): dated one-time era migrations that
 *    are genuinely safe to skip once the save was written by a current
 *    client, because post-boundary code can never produce the pre-boundary
 *    state again. Ordered by `toVersion`; a save runs every step whose
 *    toVersion is greater than its stamped version. Unknown FUTURE versions
 *    (stamp > CURRENT_SAVE_VERSION) skip all versioned steps.
 *
 * Character field priority (the ONE character-heal path — the old LOAD_GAME
 * healed the character twice through diverging pipelines and discarded one):
 *   raw save character
 *     → backfillCharacterShape   (missing-field defaults + style/archetype/ASI derivation)
 *     → healCharacterCoreFields  (numeric coercion, ability scores, spell-slot minting, AC recompute)
 *     → replayPendingLevelUps    (banked XP under new thresholds)
 *     → healStrandedDyingSolo    (low-level-solo dying → defeat setback)
 *     → versioned migrations     (currently: Fighter level-bonus retirement notice)
 * Later steps always win over earlier ones; validateSaveState never touches
 * the character.
 */
import { computeACFromInventory, normalizeConditionList } from '../engine/rules.js';
import { CLASSES } from '../data/classes.js';
import { normalizeItem } from '../data/items.js';
import {
    ABILITY_NAMES,
    buildClassResources,
    normalizeAbilityScoreImprovementState,
    normalizeFightingStyle,
    normalizeMartialArchetype,
} from '../engine/characterUtils.js';
import { awardExperience, MAX_CHARACTER_LEVEL } from '../engine/progression.js';
import { normalizeEquippedSlots } from '../engine/equipment.js';
import { createInitialFronts } from '../engine/fronts.js';
import { isSpellcaster, sanitizeSpellSlots, sanitizeSustainedSpell } from '../engine/spellcasting.js';
import { initialGameState } from './initialState.js';
import { coverage, tokenSet } from '../engine/textMatch.js';
import { applyEarlyDefeat, isLowLevelSolo, stackIdentity, systemMessage } from './handlers/shared.js';

/**
 * Save-format version stamped into every persisted payload (persistence.js
 * re-exports this as SAVE_VERSION). Bump it when a load-time migration marks a
 * genuine era boundary loaders may branch on. History:
 *   1–2: pre-pipeline stamps, read by nothing.
 *   3:   versioned-migration pipeline introduced (2026-07-31); the Fighter
 *        level-bonus retirement notice became version-gated.
 */
export const CURRENT_SAVE_VERSION = 3;

/** Stamped version of a save payload; pre-versioned or junk stamps read as 0. */
export function getSaveVersion(save) {
    const version = Number(save?.saveVersion);
    return Number.isFinite(version) && version > 0 ? Math.trunc(version) : 0;
}

// --- Unconditional heals (hostile-input defense; self-guarded era backfills) ---

/**
 * Merge duplicate inventory ROWS left by the fixed stale-Scribe re-grant bug
 * (live playtests #7-#8: "Rusted iron keys"×2 case-identical rows, lodestone×2
 * — and the Guild robbery's items_lost then removed only ONE of each twin, so
 * "confiscated" ghosts survived the whole capture arc). Deliberately narrow:
 * only rows whose names match exactly (case-insensitive), every copy
 * unequipped and quantity 1, merge into the first row with quantity = row
 * count. Distinct quantities, equipped copies, and near-name variants
 * ("brick of bog-wax" vs "Brick of raw bog-wax") are left alone — a second
 * rope can be legitimate, and REMOVE_ITEM_BY_NAME's whole-stack semantics
 * mean a merged stack is confiscated in one events pass, which is the point.
 */
function healDuplicateInventoryRows(save) {
    const inventory = save.inventory || [];
    const rowsByName = new Map();
    for (const item of inventory) {
        const name = String(item?.name || '').trim().toLowerCase();
        if (!name) continue;
        if (!rowsByName.has(name)) rowsByName.set(name, []);
        rowsByName.get(name).push(item);
    }
    const mergeNames = new Set();
    for (const [name, rows] of rowsByName) {
        if (rows.length > 1 && rows.every(row => !row.equipped && (row.quantity ?? 1) === 1)) {
            mergeNames.add(name);
        }
    }
    if (mergeNames.size === 0) return save;
    const seen = new Set();
    const healed = [];
    for (const item of inventory) {
        const name = String(item?.name || '').trim().toLowerCase();
        if (!mergeNames.has(name)) {
            healed.push(item);
            continue;
        }
        if (seen.has(name)) continue;
        seen.add(name);
        healed.push({ ...item, quantity: rowsByName.get(name).length });
    }
    console.log(`[Migrations] Merged ${inventory.length - healed.length} duplicate inventory row(s) into stacks.`);
    return { ...save, inventory: healed };
}

const shadowRowTokens = name => tokenSet(String(name || ''), { minLength: 2 });

/**
 * Merge narrated SHADOW rows into their CATALOG twins (live playtest
 * 2026-08-20): the fixed Scribe loot-audit matcher minted lowercase raw-named
 * duplicates of same-turn catalog grants ("hempen rope" beside "Hempen Rope
 * (50 ft)") that the exact-name heal above can never fold. Deliberately
 * narrow: the shadow row must be unequipped, quantity 1, carry NO itemKey,
 * its name tokens must be a subset of EXACTLY ONE catalog-KEYED row's name
 * tokens — two candidate twins means two genuinely distinct stacks. Keyless
 * near-name variants ("brick of bog-wax" vs "Brick of raw bog-wax") stay
 * separate rows, preserving healDuplicateInventoryRows' documented design.
 */
function healShadowInventoryRows(save) {
    const inventory = save.inventory || [];
    if (inventory.length < 2) return save;
    const absorbed = new Map(); // shadow row id → twin row id
    const gained = new Map();   // twin row id → extra quantity
    for (const row of inventory) {
        if (!row?.id || row?.itemKey || row?.equipped || (row?.quantity ?? 1) !== 1) continue;
        const name = String(row?.name || '').trim();
        if (!name) continue;
        const tokens = shadowRowTokens(name);
        if (tokens.size === 0) continue;
        const twins = inventory.filter(other => {
            // Catalog-keyed twins only: the key is the proof both rows mean one
            // canonical item, and its asymmetry (shadows are keyless) makes
            // mutual absorption structurally impossible.
            if (other === row || !other?.id || !other?.itemKey || !other?.name) return false;
            return coverage(tokens, shadowRowTokens(other.name)) >= 0.99;
        });
        if (twins.length !== 1) continue;
        absorbed.set(row.id, twins[0].id);
        gained.set(twins[0].id, (gained.get(twins[0].id) || 0) + (row.quantity ?? 1));
    }
    if (absorbed.size === 0) return save;
    const healed = inventory
        .filter(row => !absorbed.has(row?.id))
        .map(row => (gained.has(row?.id)
            ? { ...row, quantity: (row.quantity ?? 1) + gained.get(row.id) }
            : row));
    console.log(`[Migrations] Merged ${absorbed.size} narrated shadow inventory row(s) into their catalog twins.`);
    return { ...save, inventory: healed };
}

/**
 * Fold same-identity NON-EQUIPMENT rows into one stack (2026-09-03 P2): before
 * ADD_ITEM/PURCHASE_ITEM stacked on add, "buy 2 → buy 3 → find 1" left three
 * Torch rows that the two heals above never touch (they demand quantity 1 or a
 * keyless shadow). Uses the handlers' one `stackIdentity` rule — catalog key
 * or case-folded name, same magic bonus, never weapons/armor/shields, never an
 * equipped row — so load and add agree on what "the same item" is.
 */
function healStackedInventoryRows(save) {
    const inventory = save.inventory || [];
    if (inventory.length < 2) return save;
    const firstByIdentity = new Map();
    const gained = new Map();
    for (const row of inventory) {
        if (!row?.id) continue;
        const identity = stackIdentity(row);
        if (!identity) continue;
        const first = firstByIdentity.get(identity);
        if (!first) {
            firstByIdentity.set(identity, row);
            continue;
        }
        gained.set(first.id, (gained.get(first.id) || 0) + Math.max(1, Math.trunc(row.quantity || 1)));
        gained.set(row.id, null); // marks an absorbed row
    }
    if (gained.size === 0) return save;
    let folded = 0;
    const healed = inventory
        .filter(row => !(row?.id && gained.get(row.id) === null && (folded += 1)))
        .map(row => (row?.id && gained.get(row.id)
            ? { ...row, quantity: Math.max(1, Math.trunc(row.quantity || 1)) + gained.get(row.id) }
            : row));
    console.log(`[Migrations] Folded ${folded} same-identity inventory row(s) into their stacks.`);
    return { ...save, inventory: healed };
}

/**
 * Auto-equip armor/shield when nothing of that type is equipped (fixes old
 * saves and hand-stripped ones), then collapse invalid equipped combinations:
 * one active weapon, one armor, one shield, and no shield while a two-handed
 * weapon is active.
 */
function healEquippedSlots(save) {
    const inventory = (save.inventory || []).map(item => normalizeItem(item));
    const hasEquippedArmor = inventory.some(i => i.equipped && i.type === 'armor' && !i.isShield);
    const hasEquippedShield = inventory.some(i => i.equipped && (i.type === 'shield' || i.isShield));
    if (!hasEquippedArmor || !hasEquippedShield) {
        for (const item of inventory) {
            if (!hasEquippedArmor && item.type === 'armor' && !item.isShield && item.baseAC) {
                item.equipped = true;
                break;
            }
        }
        for (const item of inventory) {
            if (!hasEquippedShield && (item.type === 'shield' || item.isShield)) {
                item.equipped = true;
                break;
            }
        }
    }
    return { ...save, inventory: normalizeEquippedSlots(inventory) };
}

/**
 * Backfill character fields newer than the save (skill/expertise lists, class
 * resources, hit dice) and re-derive normalized progression state (fighting
 * style, martial archetype, pending-ASI accounting = earned − applied, which
 * also grants ASIs the save's era never offered).
 */
function backfillCharacterShape(save) {
    const character = save.character;
    if (!character) return save;
    return {
        ...save,
        character: {
            skillProficiencies: [],
            expertiseSkills: [],
            classResources: character.class ? buildClassResources(character.class, character.level || 1) : {},
            hitDice: {
                total: character.level || 1,
                remaining: character.level || 1,
                die: CLASSES[character.class]?.hitDie || 8,
            },
            ...character,
            fightingStyle: normalizeFightingStyle(character.class, character.fightingStyle),
            martialArchetype: normalizeMartialArchetype(character.class, character.level, character.martialArchetype),
            ...normalizeAbilityScoreImprovementState(character),
        },
    };
}

/**
 * Progression-critical fields must be real numbers: a string level/exp from a
 * corrupted or hand-edited save survives every downstream read until the first
 * XP award string-concatenates ("3" + 1 = "31") and persists the corruption
 * into the next save (2026-07-28 audit). Numeric strings coerce; junk falls
 * back to a sane floor. abilityScores must be a plain object with the six
 * canonical numeric scores — a missing/non-object value throws in
 * buildCharacterBlock's Object.entries on every prompt build (2026-07-29
 * audit). Casters from any-era saves additionally get an authoritative spell
 * slot table and a sane sustained spell.
 */
function healLoadedCharacter(character) {
    if (!character || typeof character !== 'object') return null;
    const toInt = (value, fallback) => {
        const n = Number(value);
        return Number.isFinite(n) ? Math.trunc(n) : fallback;
    };
    const level = Math.min(MAX_CHARACTER_LEVEL, Math.max(1, toInt(character.level, 1)));
    const maxHP = Math.max(1, toInt(character.maxHP, 10));
    const rawScores = character.abilityScores && typeof character.abilityScores === 'object' && !Array.isArray(character.abilityScores)
        ? character.abilityScores
        : {};
    const abilityScores = Object.fromEntries(ABILITY_NAMES.map(name => [name, Math.max(1, toInt(rawScores[name], 10))]));
    // Hit dice are catalog-rebuilt like sustainedSpell (2026-09-01 dice-engine
    // P2): backfillCharacterShape defaults only a MISSING hitDice object, so a
    // partial/hand-edited `{ total, remaining }` (no die, or die "8"/0) reached
    // rollDie(undefined) and threw out of the reducer on the Short Rest button.
    // The die is the class's own — a save can never carry a different one.
    const rawHitDice = character.hitDice && typeof character.hitDice === 'object' && !Array.isArray(character.hitDice)
        ? character.hitDice
        : {};
    const hitDiceTotal = Math.min(level, Math.max(1, toInt(rawHitDice.total, level)));
    const hitDice = {
        total: hitDiceTotal,
        remaining: Math.min(hitDiceTotal, Math.max(0, toInt(rawHitDice.remaining, hitDiceTotal))),
        die: CLASSES[character.class]?.hitDie || 8,
    };
    const healed = {
        ...character,
        level,
        exp: Math.max(0, toInt(character.exp, 0)),
        maxHP,
        currentHP: Math.min(maxHP, Math.max(0, toInt(character.currentHP, maxHP))),
        abilityScores,
        hitDice,
        // Canonical strings only: a hostile/hand-edited object element used to
        // crash every heal path and the sheet render (2026-09-05 audit P1).
        conditions: normalizeConditionList(character.conditions),
    };
    if (!isSpellcaster(healed.class)) return healed;
    return {
        ...healed,
        spellSlots: sanitizeSpellSlots(level, healed.spellSlots),
        // Catalog-rebuilt, never trusted from the save: an in-band poisoned
        // acBonus was a permanent unclamped hero AC (2026-08-29 audit).
        sustainedSpell: sanitizeSustainedSpell(healed.sustainedSpell),
    };
}

/**
 * Numeric/spell-slot heal (healLoadedCharacter) plus an AC recompute against
 * the healed inventory, fixing stale saved armor class. Runs BEFORE pending
 * level-ups, which read those fields.
 */
function healCharacterCoreFields(save) {
    const healed = healLoadedCharacter(save.character);
    if (healed) {
        healed.armorClass = computeACFromInventory(save.inventory || [], healed);
    }
    return { ...save, character: healed };
}

/**
 * Old saves may have banked enough XP under a previous threshold curve. Run
 * the same engine-owned progression pass used by ADD_EXP, but without adding
 * any new XP; level-up messages append to the loaded transcript.
 */
function replayPendingLevelUps(save) {
    if (!save.character) return save;
    const result = awardExperience(save.character, 0);
    return {
        ...save,
        character: result.character,
        messages: [...(save.messages || []), ...result.messages],
    };
}

/**
 * Heal saves stranded by the old reducer/engine low-level-solo divergence: a
 * level<=2 hero left dying OUTSIDE combat with no battle-ready companion was
 * owed the defeat-setback, not an unreachable death-save spiral.
 */
function healStrandedDyingSolo(save) {
    if (!save.character?.dying) return save;
    if (save.combat?.active) return save;
    if (!isLowLevelSolo(save.character, save.party)) return save;
    return { ...save, character: applyEarlyDefeat(save.character) };
}

/**
 * Derive the summarization boundary from the messages actually present
 * (summarized messages are a contiguous prefix). This self-heals a stale index
 * from a trimmed cloud save or an older save format, and fills session
 * defaults for old saves.
 */
function deriveSessionBoundaries(save) {
    return {
        ...save,
        session: {
            ...initialGameState.session,
            ...save.session,
            prunedMessageCount: (save.messages || []).filter(m => m?.summarized).length,
        },
    };
}

/**
 * Heal pre-serializer saves: local saves before 2026-07-03 never persisted
 * fronts, so every reloaded campaign silently lost its hidden world clocks.
 * An established campaign must never run front-less — reseed the deterministic
 * local pressure, and drop the generation/upgrade marker that described the
 * lost front web so Settings → "Upgrade to Dynamic World" becomes available
 * again to rebuild rich fronts from campaign canon. Cadence watermarks
 * (lastCadenceId/lastJournalEnd) are kept so old cadences cannot replay.
 * Deliberately NOT version-gated: "a campaign never runs front-less" is an
 * invariant, and a hand-edited current-version save can violate it too.
 */
function reseedMissingFronts(save) {
    if ((save.fronts || []).length > 0 || !save.character) return save;
    const fronts = createInitialFronts({
        premise: save.session?.premise,
        character: save.character,
        location: save.currentLocation || null,
    });
    let session = save.session;
    if (session?.frontDirector) {
        const { generationVersion: _lostGeneration, source: _lostSource, ...directorRest } = session.frontDirector;
        session = { ...session, frontDirector: directorRest };
    }
    return { ...save, fronts, session };
}

const UNCONDITIONAL_HEALS = [
    healDuplicateInventoryRows,
    healShadowInventoryRows,
    healStackedInventoryRows,
    healEquippedSlots,
    backfillCharacterShape,
    healCharacterCoreFields,
    replayPendingLevelUps,
    healStrandedDyingSolo,
];

// --- Versioned one-time migrations ---

/**
 * One-time notice for pre-2026-07-19 Fighter saves: the legacy flat "level
 * bonus" (+1 hit/damage per level past 1st, cap +3) is retired — Fighting
 * Styles, Champion crits, and Extra Attack carry the martial identity now
 * (DECISIONS.md 2026-07-19). Never ship a mid-campaign nerf silently.
 */
function noticeFighterLevelBonusRetired(save) {
    const character = save.character;
    if (character?.class !== 'fighter'
        || (character.level || 1) < 2
        || character.levelBonusRetired) return save;
    return {
        ...save,
        character: { ...character, levelBonusRetired: true },
        messages: [
            ...(save.messages || []),
            systemMessage(
                'Balance update: the Fighter\'s flat level bonus to hit and damage has been retired. Your edge now comes from your Fighting Style, Champion critical range, Extra Attack, Action Surge, and Second Wind — no other class carried a hidden flat bonus, and now neither does yours.'
            ),
        ],
    };
}

/**
 * Ordered era migrations. A save runs every step whose toVersion exceeds its
 * stamped version. Steps run AFTER the unconditional heals, so they see the
 * fully healed character; each must still be idempotent in its own right
 * (pre-v3 stamps re-enter the gate on every load until re-saved).
 */
export const MIGRATIONS = [
    {
        toVersion: 3,
        description: 'Fighter flat level-bonus retirement notice (DECISIONS.md 2026-07-19). '
            + 'Version-gated: a v3+ save was written after the retirement, so its fighters '
            + 'never had the bonus and must not see a false "retired" notice; the '
            + 'levelBonusRetired flag keeps it one-time for older saves.',
        migrate: noticeFighterLevelBonusRetired,
    },
];

/**
 * Run the full load-time pipeline over a validated save payload and stamp the
 * result with the current version. LOAD_GAME assembles live-session fields
 * (user, settings, ui) and the NPC roster heal on top of this.
 */
export function migrateLoadedSave(validatedSave) {
    const fromVersion = getSaveVersion(validatedSave);
    let save = validatedSave;
    for (const heal of UNCONDITIONAL_HEALS) {
        save = heal(save);
    }
    for (const migration of MIGRATIONS) {
        if (fromVersion < migration.toVersion) {
            save = migration.migrate(save);
        }
    }
    save = deriveSessionBoundaries(save);
    save = reseedMissingFronts(save);
    return { ...save, saveVersion: CURRENT_SAVE_VERSION };
}
