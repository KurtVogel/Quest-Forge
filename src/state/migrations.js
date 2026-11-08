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
import { computeACFromInventory, normalizeConditionList, normalizeDeathSaves, normalizeProficiencyLists } from '../engine/rules.js';
import { CLASSES } from '../data/classes.js';
import { RACES } from '../data/races.js';
import { MAX_ITEM_QUANTITY, normalizeItem } from '../data/items.js';
import {
    ABILITY_NAMES,
    buildClassResources,
    buildDerivedCharacterFields,
    getAllFeaturesUpToLevel,
    isKnownClass,
    isKnownRace,
    isSaneHeroId,
    mintHeroId,
    normalizeAbilityScoreImprovementState,
    normalizeFightingStyle,
    normalizeMartialArchetype,
} from '../engine/characterUtils.js';
import { foldExperience, isHeroDown, MAX_CHARACTER_LEVEL } from '../engine/progression.js';
import { normalizeEquippedSlots, shouldAutoEquip } from '../engine/equipment.js';
import { createInitialFronts, openDoomWindow } from '../engine/fronts.js';
import { isSpellcaster, sanitizeSpellSlots, sanitizeSustainedSpell } from '../engine/spellcasting.js';
import { initialGameState } from './initialState.js';
import { coverage, tokenSet } from '../engine/textMatch.js';
import { sanitizePortraitUrl } from '../engine/portraitUrl.js';
import { cleanTextField, HERO_TEXT_LIMITS, MAX_COIN_HELD } from '../config/contentLimits.js';
import { applyEarlyDefeat, isLowLevelSolo, stackIdentity, systemMessage } from './handlers/shared.js';
import { strictFlag } from '../engine/text.js';
import { listFrontsLeftBehind } from '../engine/regionProfile.js';
import { applyStoryMemoryDormancy } from '../engine/storyMemory.js';
import { migrateLegacyNpc, normalizeNpcAliases } from '../engine/npcRoster.js';
import { heroNameForms } from '../engine/textMatch.js';
import { legacyFoldForkedNpcs, legacyNamesMatch, legacyPeopleNamesInSave, legacyRecordedDead } from './legacyNpcIdentity.js';
import { legacyFindLocationRecord, legacyPlaceNamesInSave } from './legacyPlaceIdentity.js';
import { findLocationRecord, normalizeLocationRecord, placeRootId } from '../engine/locationRegistry.js';

/**
 * Save-format version stamped into every persisted payload (persistence.js
 * re-exports this as SAVE_VERSION). Bump it when a load-time migration marks a
 * genuine era boundary loaders may branch on. History:
 *   1–2: pre-pipeline stamps, read by nothing.
 *   3:   versioned-migration pipeline introduced (2026-07-31); the Fighter
 *        level-bonus retirement notice became version-gated.
 *   4:   identity by reference, lane 6 (2026-11-08): the roster's forks are
 *        folded ONCE with the frozen fuzzy matcher and every people-name the
 *        save holds outside the roster is seeded as an alias of the record
 *        it resolved to; the live roster compares exactly from then on.
 *   5:   lane 6C (2026-11-08): a person's death is the record's own `dead`
 *        flag; the old reading of `lastNotes` runs once more, frozen, to
 *        seed it.
 */
export const CURRENT_SAVE_VERSION = 7;

/** Stamped version of a save payload; pre-versioned or junk stamps read as 0. */
export function getSaveVersion(save) {
    const version = Number(save?.saveVersion);
    return Number.isFinite(version) && version > 0 ? Math.trunc(version) : 0;
}

// --- Unconditional heals (hostile-input defense; self-guarded era backfills) ---

// The exact-name duplicate-row heal (live playtests #7-#8: "Rusted iron
// keys"×2 case-identical rows) was retired 2026-10-07 (inventory-economy P2):
// it predated `stackIdentity` and still folded WEAPONS and armor, which the
// live stacking rule exempts by design (equip flags are per row) — two Dagger
// grants were two rows live and `Dagger ×2` after a reload. Its non-equipment
// half is `healStackedInventoryRows` below, under the one identity rule.

const shadowRowTokens = name => tokenSet(String(name || ''), { minLength: 2 });

/**
 * Merge narrated SHADOW rows into their CATALOG twins (live playtest
 * 2026-08-20): the fixed Scribe loot-audit matcher minted lowercase raw-named
 * duplicates of same-turn catalog grants ("hempen rope" beside "Hempen Rope
 * (50 ft)") that no exact-identity fold can reach. Deliberately narrow: the
 * shadow row must be unequipped, quantity 1, carry NO itemKey, its name
 * tokens must be a subset of EXACTLY ONE catalog-KEYED row's name tokens —
 * two candidate twins means two genuinely distinct stacks. Keyless near-name
 * variants ("brick of bog-wax" vs "Brick of raw bog-wax") stay separate rows.
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
 * Torch rows that the shadow heal above never touches (it demands a keyless
 * shadow). Uses the handlers' one `stackIdentity` rule — catalog key or
 * case-folded name, same magic bonus, never weapons/armor/shields, never an
 * equipped row — so load and add agree on what "the same item" is: the ONE
 * fold on the load path since 2026-10-07.
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
 * saves and hand-stripped ones) through ADD_ITEM's own rule (`shouldAutoEquip`,
 * one function since 2026-10-07), then collapse invalid equipped combinations:
 * one active weapon, one armor, one shield, and no shield while a two-handed
 * weapon is active.
 */
function healEquippedSlots(save) {
    const inventory = (save.inventory || []).map(item => normalizeItem(item));
    for (const item of inventory) {
        // Only a row that was NEVER placed is healed (2026-10-20 inventory-
        // economy P1): every engine-minted row carries `equipped` (mintOwnedItem
        // writes it), so a stored `false` is a decision — the player's "I take
        // off my armor" / the DM's `equipment_changes: unequip` — and the heal
        // used to reverse it on every Continue (shield AC 14 → 17, no line). A
        // row lacking the key is the legacy / hand-stripped shape this heal
        // was written for.
        if (item.equipped === undefined && shouldAutoEquip(inventory, item)) item.equipped = true;
    }
    return { ...save, inventory: normalizeEquippedSlots(inventory) };
}

const FALLBACK_CLASS = 'fighter';
const FALLBACK_RACE = 'human';

/**
 * Class and race are whitelisted against the live catalogs (2026-09-11
 * persistence P1) — every rules lookup keys on them, and the vault's
 * sanitizeCharacter THROWS on an unknown value while the live-save heal never
 * looked: `class: {}` printed "[object Object]" into the prompt, collapsed
 * classResources to `{}`, and threw as a React child on the sheet; the
 * plausible stale shape — a pre-balance-overhaul hero of a CUT class or race
 * (paladin, halfling: the 8-race/6-class era) — loaded featureless on a d8
 * with no notice. Unknown values fall back to Fighter / Human, the class- and
 * race-derived fields (features, saves, resources, traits, speed, spell
 * slots) are rebuilt from the catalogs, and a one-time visible system line
 * mirrors the vault's message. Runs FIRST: backfillCharacterShape reads
 * `character.class` for its own defaults. Idempotent by construction — once
 * the value is known the heal is a no-op.
 */
function healUnknownClassRace(save) {
    const character = save.character;
    if (!character || typeof character !== 'object') return save;
    // Own-key gate shared with the vault (2026-09-12 P1): `class: 'constructor'`
    // passed the old truthiness test and round-tripped as class "constructor".
    const classKnown = isKnownClass(character.class);
    const raceKnown = isKnownRace(character.race);
    if (classKnown && raceKnown) return save;
    const charClass = classKnown ? character.class : FALLBACK_CLASS;
    const race = raceKnown ? character.race : FALLBACK_RACE;
    const levelNumber = Number(character.level);
    const level = Math.min(MAX_CHARACTER_LEVEL, Math.max(1, Number.isFinite(levelNumber) ? Math.trunc(levelNumber) : 1));
    // Everything derived from the OLD class/race is stale; the catalog rebuild
    // owns it. Conditions and hit-dice spend are campaign state and stay (the
    // die itself is re-derived by healLoadedCharacter from the new class).
    const { conditions: _conditions, hitDice: _hitDice, ...derived } = buildDerivedCharacterFields(race, charClass, level);
    const {
        classResources: _oldResources, features: _oldFeatures, spellSlots: _oldSlots, sustainedSpell: _oldSustained,
        fightingStyle: _oldStyle, martialArchetype: _oldArchetype, ...rest
    } = character;
    const label = (value, fallback) => cleanTextField(value, 40) || fallback;
    const changes = [];
    if (!classKnown) changes.push(`class "${label(character.class, 'unknown')}" → ${CLASSES[charClass].name}`);
    if (!raceKnown) changes.push(`race "${label(character.race, 'unknown')}" → ${RACES[race].name}`);
    return {
        ...save,
        character: { ...rest, ...derived, race, class: charClass },
        messages: [
            ...(save.messages || []),
            systemMessage(
                `**Hero updated for this version of the game:** ${changes.join('; ')}. `
                + 'This hero came from an older version whose options are no longer part of the core set '
                + '(Human, Elf, Dwarf, Half-Orc; Fighter, Wizard, Rogue, Cleric). Features, saving throws, class resources, '
                + 'traits, and hit die were rebuilt from the new option; name, level, XP, ability scores, gear, and story are untouched.'
            ),
        ],
    };
}

/**
 * Backfill character fields newer than the save (skill/expertise lists, class
 * resources, hit dice) and re-derive normalized progression state (fighting
 * style, martial archetype, pending-ASI accounting = earned − applied, which
 * also grants ASIs the save's era never offered).
 */
const DISPLAY_LIST_MAX_ITEMS = 40;
const DISPLAY_LIST_ITEM_MAX = 120;
/** A hero display list (traits/features): string elements, clamped, capped; a non-list rebuilds. */
function typeDisplayList(value, rebuild) {
    const source = Array.isArray(value) ? value : rebuild();
    return (Array.isArray(source) ? source : [])
        .map(item => cleanTextField(item, DISPLAY_LIST_ITEM_MAX))
        .filter(Boolean)
        .slice(0, DISPLAY_LIST_MAX_ITEMS);
}

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
/** The hero's death state, typed — only the keys the save actually carries. */
function typedDeathState(character) {
    const typed = {};
    for (const flag of ['dying', 'isDead', 'lowLevelDefeat']) {
        if (character[flag] !== undefined) typed[flag] = strictFlag(character[flag]);
    }
    if (character.deathSaves !== undefined) typed.deathSaves = normalizeDeathSaves(character.deathSaves);
    return typed;
}

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
    // The vault's 1..30 band (2026-11-04 rules-math P2): the load floored at 1
    // and had no ceiling, so a hand-edited "strength: 10,000,000" stamped AC
    // 5,000,005 into the save; the load is never looser than the file importer.
    const abilityScores = Object.fromEntries(ABILITY_NAMES.map(name => [name, Math.min(30, Math.max(1, toInt(rawScores[name], 10)))]));
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
    // Identity fields are string-or-empty with the ONE hero text table
    // (HERO_TEXT_LIMITS — shared with createCharacter and the vault's
    // sanitizeCharacter since 2026-10-06; 2026-09-09 audit P1: `gender: {}`
    // threw `.trim is not a function` out of buildSystemPrompt on EVERY turn
    // and out of the Character Sheet render; `appearance: {}` made Scene mode
    // reject). The hero portrait gets the shared allowlist (P2) — see
    // engine/portraitUrl.js.
    const name = cleanTextField(character.name, HERO_TEXT_LIMITS.name) || 'Adventurer';
    // The portrait PROMPT is never read anywhere (2026-09-21 audit P2) — up to
    // 2,000 chars of write-only ballast on every autosave; stripped at load.
    const { portraitPrompt: _portraitPrompt, ...kept } = character;
    const healed = {
        ...kept,
        // The hero id is the roster's own key and is typed like every other
        // identity field (2026-10-19 character-vault P2): string-or-mint. A
        // non-string id (`42`, `{}`) rode the spread, `toHeroTemplate` kept a
        // string id only, and the sheet's adoption guard (`!character.id`)
        // was false for it — every Save to Roster minted a fresh row.
        // Since 2026-11-05 (strengthening P2) also BOUNDED: an over-long or
        // odd-charset id is the roster's key too, so it mints fresh.
        id: isSaneHeroId(character.id) ? character.id : mintHeroId(),
        name,
        gender: cleanTextField(character.gender, HERO_TEXT_LIMITS.gender),
        appearance: cleanTextField(character.appearance, HERO_TEXT_LIMITS.appearance),
        background: cleanTextField(character.background, HERO_TEXT_LIMITS.background),
        notes: cleanTextField(character.notes, HERO_TEXT_LIMITS.notes),
        portraitUrl: sanitizePortraitUrl(character.portraitUrl),
        portraitProvider: cleanTextField(character.portraitProvider, HERO_TEXT_LIMITS.portraitProvider),
        // The race/class display lists and speed are typed too (2026-09-18 P1):
        // a STRING `traits` passed `?.length` and threw `.join is not a
        // function` out of every prompt build; an object element printed
        // "[object Object]" and a 50k element rode whole. A non-list rebuilds
        // from the catalogs, exactly as healUnknownClassRace would.
        traits: typeDisplayList(character.traits, () => RACES[character.race]?.traits || []),
        features: typeDisplayList(character.features, () => getAllFeaturesUpToLevel(character.class, level)),
        speed: (() => {
            const speed = Number(character.speed);
            return Number.isFinite(speed) && speed >= 0 && speed <= 120 ? Math.trunc(speed) : (RACES[character.race]?.speed || 30);
        })(),
        level,
        exp: Math.max(0, toInt(character.exp, 0)),
        // The purse is typed like every other numeric field (2026-09-11
        // persistence P1): `gold: {}` beside 40 sp 5 cp made toCopper NaN, so
        // the first "+1 gp" grant fromCopper'd the WHOLE purse to zero and the
        // receipt line printed "purse: 0 cp" as if correct. The vault's own
        // clamp band (0..MAX_COIN_HELD) applies; a numeric string coerces.
        gold: Math.min(MAX_COIN_HELD, Math.max(0, toInt(character.gold, 0))),
        silver: Math.min(MAX_COIN_HELD, Math.max(0, toInt(character.silver, 0))),
        copper: Math.min(MAX_COIN_HELD, Math.max(0, toInt(character.copper, 0))),
        maxHP,
        currentHP: Math.min(maxHP, Math.max(0, toInt(character.currentHP, maxHP))),
        abilityScores,
        hitDice,
        // Canonical strings only: a hostile/hand-edited object element used to
        // crash every heal path and the sheet render (2026-09-05 audit P1).
        conditions: normalizeConditionList(character.conditions),
        // The death state is typed like everything above (2026-09-10 audit P1):
        // a string tally string-concatenated in DEATH_SAVE_RESULT ("1" + 1 =
        // "11" >= 3) and KILLED the hero on the first failed save; a negative
        // tally made them unkillable; `dying: "false"` read truthy everywhere.
        // Only keys the save carries are typed — a fresh character never gets
        // explicit false flags minted onto it.
        ...typedDeathState(character),
        // The three proficiency lists are typed against the catalogs
        // (2026-09-14 audit P1): backfillCharacterShape defaults only a MISSING
        // list, so a number/string/object value rode the spread and threw out
        // of every skill roll, the sheet, and buildSystemPrompt — every turn.
        ...normalizeProficiencyLists(character),
        // Class resources are rebuilt from the class definition with the spent
        // tally carried over (2026-09-13 audit P2): a string `used: "0"` on
        // Arcane Recovery read `=== 0` false, so a wizard's short rest silently
        // skipped the recovery and never re-typed the field.
        classResources: buildClassResources(character.class, level, character.classResources),
    };
    if (!isSpellcaster(healed.class)) {
        // A NON-caster carries no spell state at all (2026-09-13 audit P1):
        // the two fields used to ride the spread untyped, and a Fighter save
        // with `spellSlots: { 1: null }` crashed the Combat panel's boundary on
        // EVERY fight (the panel gated on truthiness). Strip, like
        // healUnknownClassRace already does for an unknown class.
        const { spellSlots: _slots, sustainedSpell: _sustained, ...rest } = healed;
        return rest;
    }
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
    // The one award with no downed judgement until 2026-10-14 (progression
    // P2, measured): a DYING hero with banked XP past the threshold stood up
    // on Continue at full HP with the death-save clock wiped — and this runs
    // BEFORE healStrandedDyingSolo. The sheet grows; the hero stays where the
    // save left them.
    return foldExperience(save, 0, { keepDowned: isHeroDown(save.character) });
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
    const session = {
        ...initialGameState.session,
        ...save.session,
        prunedMessageCount: (save.messages || []).filter(m => m?.summarized).length,
    };
    // A campaign without a session id (pre-id saves, hand-edited cloud saves)
    // could never cache its embeddings — the RAG store is keyed by campaign,
    // so every Continue re-embedded the whole corpus (2026-09-06 audit). The
    // id is otherwise minted only at character creation; mint it here for an
    // established campaign so the next autosave makes it permanent.
    if (save.character && (typeof session.id !== 'string' || !session.id)) {
        session.id = `session-${Date.now()}`;
    }
    return { ...save, session };
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
        const { generationVersion: _lostGeneration, ...directorRest } = session.frontDirector;
        session = { ...session, frontDirector: directorRest };
    }
    return { ...save, fronts, session };
}

/**
 * The stack ceiling at load, visibly (2026-09-25 inventory-economy P2): the
 * three folds above sum quantities, and a pre-ceiling save (or a hand-edited
 * one) can carry a row past MAX_ITEM_QUANTITY. healEquippedSlots' normalizeItem
 * then clamped it back to 999 SILENTLY — the loss the player never learned of.
 * Runs after the folds so their sums are clamped too, and posts one line
 * naming every row it cut. addOrStackItem now clamps on the way in, so this is
 * the belt for saves written before that.
 */
function healOverfullStacks(save) {
    const inventory = save.inventory || [];
    const cut = [];
    const healed = inventory.map(row => {
        const quantity = Number(row?.quantity);
        if (!row || typeof row !== 'object' || !Number.isFinite(quantity) || quantity <= MAX_ITEM_QUANTITY) return row;
        cut.push(`${String(row.name || 'item')} ${Math.trunc(quantity)} → ${MAX_ITEM_QUANTITY}`);
        return { ...row, quantity: MAX_ITEM_QUANTITY };
    });
    if (cut.length === 0) return save;
    console.log(`[Migrations] Clamped ${cut.length} over-full inventory stack(s) to ${MAX_ITEM_QUANTITY}.`);
    return {
        ...save,
        inventory: healed,
        messages: [
            ...(save.messages || []),
            systemMessage(`**Stack ceiling applied on load:** ${cut.join('; ')}. A stack holds at most ${MAX_ITEM_QUANTITY} of one item.`),
        ],
    };
}

/**
 * Legacy records learn WHEN they happened (2026-10-28, Vesa's megacampaign:
 * 1,805 of 1,813 world facts, 677 of 948 story cards and every NPC sighting
 * predated the conversational stamps, so every age-aware reader — WORLD
 * FACTS' recency, the callback scorer, DM REMINDERS, KNOWN NPCs — read them
 * as ageless). Each carries a wall-clock stamp and every transcript row does
 * too, so the stamp maps to the transcript length at that moment: the count
 * of rows whose `timestamp` is at or before it. Only a monotonic, fully
 * stamped transcript is read; only a missing message stamp is filled.
 */
function healLegacyMessageClock(save) {
    const messages = Array.isArray(save.messages) ? save.messages : [];
    if (messages.length === 0) return save;
    const clock = messages.map(m => Number(m?.timestamp));
    for (let i = 0; i < clock.length; i += 1) {
        if (!Number.isFinite(clock[i]) || (i > 0 && clock[i] < clock[i - 1])) return save;
    }
    const countAt = (wallClock) => {
        const at = Number(wallClock);
        if (!Number.isFinite(at) || at <= 0) return null;
        let lo = 0;
        let hi = clock.length;
        while (lo < hi) {
            const mid = (lo + hi) >> 1;
            if (clock[mid] <= at) lo = mid + 1;
            else hi = mid;
        }
        return lo;
    };
    const fill = (record, pairs) => {
        let next = record;
        for (const [messageKey, wallKey] of pairs) {
            if (Number.isFinite(next?.[messageKey])) continue;
            const count = countAt(next?.[wallKey]);
            if (count === null) continue;
            if (next === record) next = { ...record };
            next[messageKey] = count;
        }
        return next;
    };
    const mapAll = (list, pairs) => {
        if (!Array.isArray(list)) return list;
        let changed = false;
        const out = list.map(entry => {
            if (!entry || typeof entry !== 'object') return entry;
            const next = fill(entry, pairs);
            if (next !== entry) changed = true;
            return next;
        });
        return changed ? out : list;
    };
    const worldFacts = mapAll(save.worldFacts, [['atMessage', 'timestamp']]);
    const storyMemory = mapAll(save.storyMemory, [['firstSeenMessage', 'firstSeenAt'], ['lastSeenMessage', 'lastSeenAt'], ['lastUsedMessage', 'lastUsedAt']]);
    const npcs = mapAll(save.npcs, [['lastSeenMessage', 'lastSeen']]);
    if (worldFacts === save.worldFacts && storyMemory === save.storyMemory && npcs === save.npcs) return save;
    return { ...save, worldFacts, storyMemory, npcs };
}

/**
 * A full clock that never got its doom window (2026-10-28): the window opens
 * only when a clock MOVES, so a front that filled before the doom feature
 * (2026-10-22) — or a second full clock that waited behind the first — sat
 * at 6/6 forever (Vesa's "Trouble around Vault"). The load opens the one
 * window `openDoomWindow` allows, at once; every rule after that is the
 * live one (the card, the settle on the player's row, the landing director).
 */
function healUnopenedDooms(save) {
    if (!Array.isArray(save.fronts) || save.fronts.length === 0) return save;
    // Never for a front whose every theater lies in another land than the
    // hero's (measured on the healed megacampaign, 2026-10-28: the card said
    // the doom "arrives as NEWS" a sea away, and Flash marched the old land's
    // spear-hunters onto the new land's causeway). A front left behind waits
    // for the hero's return; the live clock lanes judge it there.
    // The left-behind fronts are SKIPPED, never relabeled (2026-10-30 P2): a
    // relabel hid a left-behind front's OPEN window from openDoomWindow's
    // one-window check, and a home-land full clock opened a second one.
    const skipIds = listFrontsLeftBehind(save.fronts, save.locations, save.currentLocation);
    const { opened } = openDoomWindow(save.fronts, { messageCount: Array.isArray(save.messages) ? save.messages.length : 0, skipIds });
    if (!opened) return save;
    return { ...save, fronts: save.fronts.map(front => (front?.id === opened.id ? opened : front)) };
}

/**
 * The story-card age-out, once at load (2026-10-31): a long-running campaign
 * carries cards whose silence already crossed LONG_DORMANCY_JOURNAL_CYCLES
 * before that rule existed (the megacampaign's first callback was a delivery
 * finished 204 turns earlier) — the cadence would sleep them on its next
 * tick; the load does it now. Dormant is not deleted; a re-report revives.
 */
function healStaleStoryCards(save) {
    if (!Array.isArray(save.storyMemory) || !Array.isArray(save.journal)) return save;
    const storyMemory = applyStoryMemoryDormancy(save.storyMemory, save.journal);
    return storyMemory === save.storyMemory ? save : { ...save, storyMemory };
}

const UNCONDITIONAL_HEALS = [
    healLegacyMessageClock,
    healStaleStoryCards,
    healUnknownClassRace,
    healShadowInventoryRows,
    healStackedInventoryRows,
    healOverfullStacks,
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
/**
 * Save version 4 (identity by reference, lane 6, 2026-11-08; DECISIONS.md
 * decision 4): the one and only run of the fuzzy name identity over an old
 * save. (1) Forked records fold as LOAD_GAME used to fold them on every load
 * (`legacyFoldForkedNpcs`, the frozen `dedupeNpcRoster`), the folded name
 * kept as an alias. (2) Every people-name the save holds outside the roster
 * (quest patrons, card links, tell witnesses and voices, ledger
 * counterparties, ties, private-fact knowers) that today's matcher resolved
 * to exactly ONE record — and no record answers to exactly — becomes that
 * record's alias, so the exact lookups that replace the matcher still find
 * it. The hero's own name forms are never aliases. Idempotent: a second run
 * finds every name already answered to.
 */
function seedNpcAliasesAndFoldForks(save) {
    if (!Array.isArray(save?.npcs) || save.npcs.length === 0) return save;
    // Typed before and after the fold, so a second run finds nothing to change.
    const folded = legacyFoldForkedNpcs(save.npcs.filter(npc => npc && typeof npc === 'object').map(npc => migrateLegacyNpc(npc))).map(npc => migrateLegacyNpc(npc));
    const hero = heroNameForms(save.character?.name || '');
    const answersTo = (npc, folded) => (typeof npc?.name === 'string' && npc.name.trim().toLowerCase() === folded)
        || (Array.isArray(npc?.aliases) && npc.aliases.some(alias => typeof alias === 'string' && alias.trim().toLowerCase() === folded));
    let npcs = folded;
    for (const said of legacyPeopleNamesInSave({ ...save, npcs })) {
        const key = said.toLowerCase();
        if (hero.has(key)) continue;
        if (npcs.some(npc => answersTo(npc, key))) continue;
        const candidates = npcs.filter(npc => typeof npc?.name === 'string' && legacyNamesMatch(npc.name, said));
        if (candidates.length !== 1) continue;
        const target = candidates[0];
        npcs = npcs.map(npc => (npc === target
            ? { ...npc, aliases: normalizeNpcAliases([...(Array.isArray(npc.aliases) ? npc.aliases : []), said], npc.name) }
            : npc));
    }
    return { ...save, npcs };
}

/**
 * Save version 5 (lane 6C, 2026-11-08): `isRecordedDead` used to read the
 * record's latest note through a regex on every turn; now it reads
 * `npc.dead`, which the Scribe's `died: true` writes. The regex runs ONCE
 * more here, frozen, over an old save's notes. Idempotent.
 */
function seedNpcDeathFlags(save) {
    if (!Array.isArray(save?.npcs) || save.npcs.length === 0) return save;
    let changed = false;
    const npcs = save.npcs.map(npc => {
        if (!npc || typeof npc !== 'object' || npc.dead === true || !legacyRecordedDead(npc)) return npc;
        changed = true;
        return { ...npc, dead: true };
    });
    return changed ? { ...save, npcs } : save;
}

/**
 * Save version 6 (identity by reference, lane 9A, 2026-11-08): the one and
 * only run of the fuzzy place identity over an old save. Every place string
 * the save holds outside the registry (the hero's place, each person's last
 * location and base, card and journal stamps, directive theaters) that no
 * record answers to exactly, and that the frozen containment rung resolved to
 * a record, becomes that record's alias — so the exact lookups that replace
 * the rung still find it. Nothing is folded: the megacampaign export showed
 * the rung's folds were the damage (a tavern into its town, two cabins a sea
 * apart into one record). Visit stamps are untouched. Idempotent.
 */
function seedPlaceAliases(save) {
    if (!Array.isArray(save?.locations) || save.locations.length === 0) return save;
    let locations = save.locations.filter(record => record && typeof record === 'object');
    let changed = false;
    for (const said of legacyPlaceNamesInSave(save)) {
        if (findLocationRecord(locations, said) !== -1) continue;
        const idx = legacyFindLocationRecord(locations, said);
        if (idx === -1) continue;
        const target = locations[idx];
        locations = locations.map(record => (record === target
            ? normalizeLocationRecord({ aliases: [said], lastVisitedAt: record.lastVisitedAt }, record)
            : record));
        changed = true;
    }
    return changed ? { ...save, locations } : save;
}

/**
 * Save version 7 (identity by reference, lane 9B, 2026-11-08; Vesa's answer
 * 4 to the lane 9 review): `within` is seeded from the one shape the old
 * kinship rule read right — "<place>, <town>" where the town IS a record by
 * exact name or alias — and from nothing else; the Scribe states the rest at
 * mint. Never itself, never a cycle, never over a value already held.
 * Idempotent.
 */
function seedPlaceWithin(save) {
    if (!Array.isArray(save?.locations) || save.locations.length === 0) return save;
    let locations = save.locations.filter(record => record && typeof record === 'object');
    let changed = false;
    for (const record of [...locations]) {
        if (typeof record.name !== 'string' || record.within) continue;
        const comma = record.name.lastIndexOf(',');
        if (comma <= 0) continue;
        const tail = record.name.slice(comma + 1).trim();
        const parentIdx = findLocationRecord(locations, tail);
        if (parentIdx === -1) continue;
        const parent = locations[parentIdx];
        if (parent.id === record.id || placeRootId(locations, parent) === record.id) continue;
        locations = locations.map(entry => (entry === record ? { ...entry, within: parent.id } : entry));
        changed = true;
    }
    return changed ? { ...save, locations } : save;
}

export const MIGRATIONS = [
    {
        toVersion: 3,
        description: 'Fighter flat level-bonus retirement notice (DECISIONS.md 2026-07-19). '
            + 'Version-gated: a v3+ save was written after the retirement, so its fighters '
            + 'never had the bonus and must not see a false "retired" notice; the '
            + 'levelBonusRetired flag keeps it one-time for older saves.',
        migrate: noticeFighterLevelBonusRetired,
    },
    {
        toVersion: 4,
        description: 'Identity by reference, lane 6 (DECISIONS.md 2026-11-08): forked roster records '
            + 'folded once with the frozen fuzzy matcher, and every people-name the save holds outside '
            + 'the roster seeded as an alias of the one record it resolved to. The live roster compares '
            + 'ids, exact names and exact aliases from this version on.',
        migrate: seedNpcAliasesAndFoldForks,
    },
    {
        toVersion: 5,
        description: 'Identity by reference, lane 6C (DECISIONS.md 2026-11-08): a person\'s death is the record\'s '
            + 'own dead flag, seeded once from the frozen notes regex.',
        migrate: seedNpcDeathFlags,
    },
    {
        toVersion: 6,
        description: 'Identity by reference, lane 9A (DECISIONS.md 2026-11-08): a place is an id, an exact name or an exact '
            + 'alias; every stored place string the frozen containment rung resolved to a record is seeded as that '
            + 'record\'s alias, once. Nothing is folded.',
        migrate: seedPlaceAliases,
    },
    {
        toVersion: 7,
        description: 'Identity by reference, lane 9B (DECISIONS.md 2026-11-08): a place\'s `within` is seeded once from the '
            + '"<place>, <town>" shape where the town is a record; the cluster rule reads the within chain from this version on.',
        migrate: seedPlaceWithin,
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
    save = healUnopenedDooms(save);
    return { ...save, saveVersion: CURRENT_SAVE_VERSION };
}
