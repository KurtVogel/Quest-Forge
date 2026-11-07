/**
 * Helpers shared by multiple reducer domains and the save-migration pipeline
 * (migrations.js). Single-domain helpers live in their domain module instead.
 */
import { addConditionCapped, computeACFromInventory, normalizeConditionList } from '../../engine/rules.js';
import { conversationalDistance } from '../../engine/replayLedger.js';
import { nameTokensPresent, textWordSet } from '../../engine/textMatch.js';
import { isArmorItem, isShieldItem, isWeaponItem } from '../../engine/equipment.js';
import { ITEM_CATALOG, clampMagicBonus, normalizeItemKey, parseMagicBonusFromName, MAX_ITEM_QUANTITY } from '../../data/items.js';
import { MAX_CHARACTER_LEVEL, reviveHero } from '../../engine/progression.js';
import { MAX_DICE_COUNT, MAX_DIE_SIDES, MAX_ROLL_MODIFIER } from '../../engine/dice.ts';
import { normalizeDiceNotation } from '../../engine/diceNotation.js';
import { appendKeepsakes } from '../../engine/companionGear.js';
import { CHRONICLE_CHAPTER_TEXT_MAX, CHRONICLE_TITLE_MAX, NPC_DOSSIER_FIELD_MAX, ROLL_HISTORY_CAP } from '../../config/contentLimits.js';
import { COMBAT_PHASES, isLowLevelSolo } from '../../engine/combatPredicates.js';
import { dropCondition } from '../../engine/spellcasting.js';
import { HEALTH_WORDS, healthWord } from '../../engine/enemyStats.js';
import {
    appendBondMoments,
    appendCallbackHooks,
    clampNpcDossierField,
    findNpcByRef,
    normalizeNpcAliases,
    classifyNpcCandidate,
    mergeNpcAppearance,
    mergeNpcCoreText,
    mergeNpcDossierText,
    mergeNpcTies,
    normalizeImpressions,
    normalizeNpcRecord,
    NPC_CORE_TEXT_FIELDS,
    NPC_DURABLE_TEXT_FIELDS,
    sanitizeNpcLanePayload,
} from '../../engine/npcRoster.js';
import { NPC_OPEN_THREAD_MAX } from '../../engine/relationshipArc.js';
import { clampNumber, systemMessage, toFlag } from '../../engine/text.js';

// Re-exported for the ledger's importers; the constant itself lives in
// config/contentLimits.js so persistence.js reads the same one.
export { ROLL_HISTORY_CAP };

/**
 * Append roll(s) to the ledger, keeping only the newest ROLL_HISTORY_CAP.
 *
 * MEMBERSHIP RULE (2026-10-04, stated once): a die the HERO's own action
 * rolled enters the ledger — checks, saves, attacks and their damage,
 * initiative, death saves, Second Wind, a potion (drunk or poured into a
 * companion), an out-of-combat spell heal, a Short Rest's hit dice. Dice other
 * actors rolled (enemy attacks and saves, companion attacks) never do; an
 * exchange ledgers only its `heroRolls`.
 *
 * Every entry is stamped `atMessage` — the transcript length at the moment of
 * the roll — because the product measures time in conversational distance
 * ("N turns ago"), never wall-clock: the recall dossier's DICE row was the one
 * ledger row that could not say when.
 */
export function appendRollHistory(state, rolls) {
    const atMessage = Array.isArray(state?.messages) ? state.messages.length : 0;
    const additions = (Array.isArray(rolls) ? rolls : [rolls])
        .filter(roll => roll && typeof roll === 'object')
        .map(roll => ({ ...roll, atMessage }));
    return [...(state?.rollHistory || []), ...additions].slice(-ROLL_HISTORY_CAP);
}

const ROLL_HISTORY_TEXT_MAX = 120;
// A minted id is unique ACROSS loads (2026-10-17 audit P2): a persisted
// `roll-loaded-1` and a later load's first mint shared one Dice Log key.
const LOADED_ROLL_ID_EPOCH = Date.now().toString(36);
let loadedRollIdCounter = 0;

/**
 * A loaded die face or total: a finite number, or a numeric string (saves
 * hand-edited to `"12"` load). `null` / a boolean / '' are NOT 0 / 1 / 0 —
 * `Number` read them so, and `[null]` loaded as a one-face roll of 0
 * (2026-10-17 audit P2). Faces are bounded by the largest die the engine
 * rolls; a 1e9 face used to render.
 */
function loadedNumber(value) {
    if (typeof value === 'number') return Number.isFinite(value) ? value : null;
    if (typeof value === 'string' && value.trim() !== '') {
        const n = Number(value);
        return Number.isFinite(n) ? n : null;
    }
    return null;
}

/**
 * Type one loaded rollHistory entry (2026-09-09 audit P2): the old guard was
 * `object && Array.isArray(rolls)`, so object faces/total/description rendered
 * "[object Object]" into RECENT DICE ROLLS on every turn and a 5k-char
 * description rode the prompt unclamped. Faces must be finite numbers (at least
 * one), total is recomputed when the stored one is junk, modifier defaults to
 * 0, text fields are string-or-empty and clamped. Returns null to drop.
 * Projected to the keys a ledger CONSUMER reads since 2026-09-21 (audit P2, the
 * 09-16 rule): the old `...entry` spread let any unknown key on a stored roll —
 * a 100 KB `foo` — ride every later save forever. Since 2026-10-04 the
 * projection also drops the three keys no consumer ever read (`timestamp`,
 * `subtotal`, `dice` — live-roll working fields of dice.ts / combatMath) and
 * types `atMessage`, clamped to the transcript like every other message stamp
 * (an OPTIONS OBJECT — never positional, `.map` would pass the index). The id
 * is string-or-mint: `String(object)` gave every such row one shared
 * "[object Object]" React key in the Dice Log.
 */
export function sanitizeRollHistoryEntry(entry, { maxMessageCount = null } = {}) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return null;
    if (!Array.isArray(entry.rolls)) return null;
    // The faces LIST, the modifier and the total are bounded too (2026-11-05
    // strengthening P2, dice-engine 10-31): one 100,000-face row printed
    // 400,189 chars into RECENT DICE ROLLS. A crit doubles a pool of at most
    // MAX_DICE_COUNT, so twice that is every face a real roll carries; the
    // modifier takes parseNotation's band; a total outside what those faces
    // and that modifier can make (or minted from a clamped modifier) is
    // recomputed from them.
    const rolls = entry.rolls.map(loadedNumber)
        .filter(value => value !== null)
        .slice(0, MAX_DICE_COUNT * 2)
        .map(value => Math.max(0, Math.min(MAX_DIE_SIDES, Math.trunc(value))));
    if (rolls.length === 0) return null;
    const storedModifier = loadedNumber(entry.modifier);
    const rawModifier = storedModifier === null ? 0 : Math.trunc(storedModifier);
    const modifier = Math.max(-MAX_ROLL_MODIFIER, Math.min(MAX_ROLL_MODIFIER, rawModifier));
    const subtotal = rolls.reduce((sum, value) => sum + value, 0);
    const storedTotal = loadedNumber(entry.total);
    const totalInBand = storedTotal !== null && modifier === rawModifier
        && Math.abs(storedTotal) <= rolls.length * MAX_DIE_SIDES + MAX_ROLL_MODIFIER;
    const total = totalInBand ? Math.trunc(storedTotal) : subtotal + modifier;
    const text = value => (typeof value === 'string' ? value.trim().slice(0, ROLL_HISTORY_TEXT_MAX) : '');
    // The natural flags are RE-DERIVED from one d20 face, never trusted: a
    // hostile save printed "(natural 20) (natural 1)" on a 2d6 row. A single
    // face on a 1d20 notation (or none) is the only natural; a crit below 20
    // stands only as one of combatMath.stampCriticalRoll's / resolveAttackRoll's
    // attack stamps — the Champion's natural 19, or any hit on a helpless target.
    const notationParts = normalizeDiceNotation(text(entry.notation));
    const face = rolls.length === 1 && (!notationParts || (notationParts.count === 1 && notationParts.sides === 20))
        && rolls[0] >= 1 && rolls[0] <= 20 ? rolls[0] : null;
    const threshold = entry.kind === 'attack' && entry.isCritical === true ? text(entry.criticalThreshold) : '';
    const stampedCrit = face !== null && threshold
        && ((/champion/i.test(threshold) && face === 19) || (/helpless/i.test(threshold) && face > 1));
    const isCritical = face === 20 || !!stampedCrit;
    const id = typeof entry.id === 'string' && entry.id
        ? entry.id.slice(0, 80)
        : typeof entry.id === 'number' && Number.isFinite(entry.id)
            ? String(entry.id)
            : `roll-loaded-${LOADED_ROLL_ID_EPOCH}-${++loadedRollIdCounter}`;
    const stamp = typeof entry.atMessage === 'number' && Number.isFinite(entry.atMessage)
        ? Math.max(0, Math.floor(entry.atMessage))
        : null;
    const atMessage = stamp !== null && Number.isFinite(maxMessageCount) ? Math.min(stamp, maxMessageCount) : stamp;
    return {
        id,
        rolls,
        modifier,
        total,
        description: text(entry.description),
        notation: text(entry.notation),
        isCritical,
        isCritFail: face === 1,
        ...(atMessage !== null ? { atMessage } : {}),
        // combatMath.stampCriticalRoll's two stamps — the prompt's crit label reads `kind`.
        ...(entry.kind === 'attack' ? { kind: 'attack' } : {}),
        ...(stampedCrit ? { criticalThreshold: threshold } : {}),
    };
}

/**
 * The dice faces of one roll as a receipt fragment: "4, 2 (+2)" / "3 (-1)" /
 * "7". One owner for the heal lanes' lines (Second Wind, both potion lanes,
 * the out-of-combat spell heal) — four sites wrote `(+${modifier})`, which
 * rendered "(+-1)" for a WIS 8 cleric's Cure Wounds (2026-10-04 audit).
 */
export function describeFaces(roll) {
    const faces = (Array.isArray(roll?.rolls) ? roll.rolls : []).join(', ');
    const modifier = Number(roll?.modifier) || 0;
    return modifier ? `${faces} (${modifier > 0 ? '+' : ''}${modifier})` : faces;
}

// The system row composer lives on the engine text shelf since 2026-10-14
// (progression Lap-4 P2): the progression receipts and the out-of-combat
// resolver compose the same row; re-exported here for the handlers' import.
export { systemMessage };

/**
 * Heal the hero by an engine-rolled amount: clamp to max HP, revive from 0.
 * One owner for the hero half of every heal lane (Second Wind, a drunk potion,
 * an out-of-combat spell heal) — each used to write its own clamp → gained →
 * revive triple (2026-10-04 audit).
 */
export function healHero(character, amount) {
    const priorHp = Number(character.currentHP) || 0;
    const healed = Math.min(character.maxHP, priorHp + amount);
    const healedCharacter = { ...character, currentHP: healed };
    return {
        healed,
        gained: healed - priorHp,
        character: healed > 0 ? reviveHero(healedCharacter) : healedCharacter,
    };
}

/** Mark a character as dead (3 failed death saves or a fatal narrative event). */
export function applyDeath(character) {
    return { ...character, isDead: true, dying: false, deathSaves: { successes: 0, failures: 0 } };
}

// The low-level-solo predicate is engine-owned (combatExchange.js) so the exchange
// engine, the reducer, applyEvents, and the prompt all ask the SAME function live.
export { isLowLevelSolo };

/**
 * Add one condition through THE capped writer (2026-11-05 strengthening P2:
 * this appended PAST the cap — a defeated hero carried eleven). Its callers
 * add table conditions (`unconscious`, a catalog spell's), which evict the
 * oldest flavour condition and can never be refused: the table has exactly
 * CONDITION_LIST_CAP entries. A refusal would be a flavour name — warned.
 */
export function withCondition(character, condition) {
    const result = addConditionCapped(character.conditions || [], condition);
    if (result.refused) console.warn(`[conditions] "${result.refused}" not recorded — the hero's condition list is full.`);
    if (!result.added) return character;
    return { ...character, conditions: result.conditions };
}

/** Convert an early low-level knockout into a setback instead of campaign-ending death. */
export function applyEarlyDefeat(character) {
    return withCondition({
        ...character,
        currentHP: 0,
        dying: false,
        lowLevelDefeat: true,
        deathSaves: { successes: 0, failures: 0 },
    }, 'Unconscious');
}

/** Bring a dying/stable character back to consciousness (healing or a nat-20 death save). */
/**
 * THE chronicle chapter record — the body of the LOAD heal and of the WRITE
 * (2026-10-08 chronicler Lap-4 P2: the write side had its own composer that
 * dropped a numeric-string index to 0 — a 0/0 span makes the next close
 * re-retell everything from the start — and titled through `String(x)`, the
 * "[object Object]" class; the 09-17 rule is that the load twin IS the
 * normalizer). Born 2026-09-04 as the load heal: the chronicle was the one
 * persisted collection validateSaveState never shape-guarded, while both
 * readers index its last element unguarded — ChronicleTab and
 * writeChronicleChapters — so a null entry crashed the whole Journal panel on
 * open and a string toIndex ("12") string-concatenated the next chapter's
 * fromIndex into "121" (every close said "Not enough new play").
 * Plain objects with text survive; title string-or-empty, clamped; from/toIndex
 * coerced to finite integers and clamped to the live transcript; an absent id
 * or createdAt is minted; junk drops.
 */
/**
 * A wall-clock stamp inside a sane band, else now (2026-10-21 chronicler P2):
 * a finite-but-absurd `createdAt` (1e300) passed `Number.isFinite` and the
 * Journal card and the markdown export both printed "Invalid Date". The band
 * is the project's own lifetime to a day past the reading clock.
 */
const EPOCH_BAND_START_MS = Date.UTC(2025, 0, 1);
const EPOCH_BAND_SLACK_MS = 24 * 60 * 60 * 1000;
export function saneEpochMs(value, now = Date.now()) {
    const n = Number(value);
    return Number.isFinite(n) && n >= EPOCH_BAND_START_MS && n <= now + EPOCH_BAND_SLACK_MS ? n : now;
}

export function normalizeChronicleChapter(entry, { maxMessageCount = Infinity } = {}) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return null;
    const text = typeof entry.text === 'string' ? entry.text.trim().slice(0, CHRONICLE_CHAPTER_TEXT_MAX) : '';
    if (!text) return null;
    // Indexes are clamped to the live transcript like the 09-10 ruling stamps
    // (2026-09-13 audit P2): a future toIndex (1e15) loaded intact and every
    // later close threw "Not enough new play" forever. Known keys only — a
    // junk/nested payload used to round-trip through the spread.
    const ceiling = Number.isFinite(maxMessageCount) ? Math.max(0, Math.trunc(maxMessageCount) - 1) : Infinity;
    const index = (value) => {
        const n = Number(value);
        return Number.isFinite(n) ? Math.min(ceiling, Math.max(0, Math.trunc(n))) : 0;
    };
    return {
        id: typeof entry.id === 'string' && entry.id ? entry.id.slice(0, 80) : `chapter-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        // Whitespace collapsed (2026-11-05 strengthening P2): the input cannot
        // type a newline but a save can — "Ch\n\n# Evil" exported a top-level
        // heading inside the chapter's `##` line.
        title: typeof entry.title === 'string' ? entry.title.replace(/\s+/g, ' ').trim().slice(0, CHRONICLE_TITLE_MAX) : '',
        text,
        fromIndex: index(entry.fromIndex),
        toIndex: index(entry.toIndex),
        createdAt: saneEpochMs(entry.createdAt),
    };
}

/**
 * The live campaign's identity, for async writes that resolve minutes after
 * they were started (2026-09-13 audit P1): a chapter close, a Deepen memory,
 * or a portrait captured campaign A, awaited a long DM-model call, and then
 * dispatched against whatever campaign was LIVE — campaign B, loaded from
 * Settings meanwhile. LOAD_GAME remounts the shell (the closure survives and
 * dispatch is stable), so the reducer is the one place that can tell. Callers
 * stamp `action.meta = campaignStamp(state)` at start; handlers drop a stale
 * action through isStaleCampaignAction.
 */
export function campaignStamp(state) {
    return {
        sessionId: state?.session?.id ?? null,
        loadNonce: Number.isFinite(state?.session?.loadNonce) ? state.session.loadNonce : 0,
    };
}

export function isStaleCampaignAction(state, action) {
    const meta = action?.meta;
    if (!meta || typeof meta !== 'object') return false;
    if (meta.sessionId === undefined && meta.loadNonce === undefined) return false;
    const live = campaignStamp(state);
    if (meta.sessionId !== undefined && meta.sessionId !== live.sessionId) return true;
    return meta.loadNonce !== undefined && meta.loadNonce !== live.loadNonce;
}

// THE revive is `reviveHero` beside `isHeroDown` in engine/progression.js
// since 2026-10-14 (progression Lap-4 P2): the level-up's inline block, the
// exchange's natural-20 projection and the long rest's early-defeat filter
// each carried their own spelling of the Unconscious fold (one threw on a
// non-string condition). The handlers keep the old name.
export { reviveHero as reviveCharacter };

/**
 * Return a new state with inventory updated and AC recalculated if needed.
 * Centralizes the repeated pattern across ADD_ITEM, REMOVE_ITEM, EQUIP_ITEM, etc.
 */
export function withInventoryAndAC(state, newInventory) {
    const ac = state.character
        ? computeACFromInventory(newInventory, state.character)
        : null;
    return {
        ...state,
        inventory: newInventory,
        character: state.character
            ? { ...state.character, armorClass: ac }
            : state.character,
    };
}

export function isPlayerCombatTurn(combat) {
    if (!combat?.active) return false;
    if (combat.phase) return combat.phase === COMBAT_PHASES.AWAITING_PLAYER;
    return combat.turnOrder?.[combat.currentTurn]?.type === 'player';
}

export function normalizeRefToken(value) {
    return String(value || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

// World facts are hostile LLM input persisted forever: a non-string fact/category
// spread raw into the store used to crash buildSystemPrompt on every later turn
// (2026-07-23 audit). Explicit whitelist, typed, clamped — never spread the payload.
// The fact payload boundary lives in engine/worldFacts.js beside the plan
// that judges it (2026-10-11); re-exported for the load heal's import.
export { sanitizeWorldFactPayload } from '../../engine/worldFacts.js';

const RECENT_TRANSACTION_LIMIT = 20;

// The player-phrasing repeat rules that lived here (REPEAT_TRANSACTION_RE,
// REPEAT_QUANTIFIER_SRC, repeatIntentNearNoun, playerMessageSupportsRepeatTransaction)
// are gone (identity by reference, lane 11, 2026-11-08): a same-value twin from
// an earlier message is the repeat judge's question on every lane now (XP, spell
// casts, rests, the payment audit, the bundle strip), never a word rule's.
function sanitizeRecentTransaction(entry) {
    if (!entry || typeof entry !== 'object') return null;
    const signature = String(entry.signature || '').slice(0, 200);
    if (!signature) return null;
    return {
        signature,
        itemKey: String(entry.itemKey || '').slice(0, 100),
        name: String(entry.name || '').slice(0, 160),
        quantity: Number.isFinite(entry.quantity) ? Math.max(1, Math.trunc(entry.quantity)) : 1,
        priceCp: Number.isFinite(entry.priceCp) ? Math.max(0, Math.trunc(entry.priceCp)) : 0,
        sourceId: String(entry.sourceId || '').slice(0, 160),
        messageIndex: Number.isInteger(entry.messageIndex) ? Math.max(0, entry.messageIndex) : 0,
        timestamp: Number.isFinite(entry.timestamp) ? entry.timestamp : Date.now(),
        status: entry.status === 'ignored' ? 'ignored' : 'applied',
    };
}

export function normalizeRecentTransactions(entries) {
    return (Array.isArray(entries) ? entries : [])
        .map(sanitizeRecentTransaction)
        .filter(Boolean)
        .slice(-RECENT_TRANSACTION_LIMIT);
}

export function currentMessageIndex(state) {
    return Math.max(0, (state.messages || []).length - 1);
}

/** Base narration-message id of a compound sourceId ("msg-1:scribe-loot:payment" → "msg-1"). */
export function sourceBaseOf(sourceId) {
    return String(sourceId || '').split(':')[0];
}

export function findRecentTransactionDuplicate(entries, transaction, sourceId, currentIndex, window, messages = null, { excludeSameBase = false } = {}) {
    const base = sourceBaseOf(sourceId);
    return normalizeRecentTransactions(entries)
        .slice()
        .reverse()
        .find(entry => {
            if (entry.signature !== transaction.signature) return false;
            if (sourceId && entry.sourceId === sourceId) return true;
            // Audit dispatches arrive already reconciled against their own narration
            // message's applied events (scribe.js does the subtraction in code), so a
            // same-base entry is the portion the engine already accounted for — not a
            // duplicate of this dispatch. Without this, a genuine engine-computed
            // shortfall that happens to equal the event-path amount would be eaten.
            if (excludeSameBase && base && sourceBaseOf(entry.sourceId) === base) return false;
            const distance = messages
                ? conversationalDistance(messages, entry.messageIndex, currentIndex)
                : currentIndex - entry.messageIndex;
            return distance >= 0 && distance <= window;
        }) || null;
}

export function rememberTransaction(entries, transaction, sourceId, messageIndex, status = 'applied') {
    const record = sanitizeRecentTransaction({
        signature: transaction.signature,
        itemKey: transaction.item.itemKey,
        name: transaction.item.name,
        quantity: transaction.quantity,
        priceCp: transaction.priceCp,
        sourceId,
        messageIndex,
        timestamp: Date.now(),
        status,
    });
    if (!record) return normalizeRecentTransactions(entries);
    const previous = normalizeRecentTransactions(entries)
        .filter(entry => !(entry.signature === record.signature && entry.sourceId === record.sourceId));
    return [...previous, record].slice(-RECENT_TRANSACTION_LIMIT);
}

const NAME_STOPWORDS = new Set(['the', 'and', 'with', 'for', 'from', 'set', 'pair', 'bundle']);

/** The noun alternation an item answers to in prose ("Wolf pelts" → wolf|pelt, each with an optional plural). */
export function itemNounSrc(item) {
    const words = [item?.name, String(item?.itemKey || '').replace(/[_-]+/g, ' ')]
        .join(' ')
        .toLowerCase()
        .split(/[^a-z]+/)
        .filter(word => word.length > 2 && !NAME_STOPWORDS.has(word))
        .map(word => word.replace(/(?:es|s)$/, ''))
        .filter(word => word.length > 2);
    const unique = [...new Set(words)];
    return unique.length ? `(?:${unique.join('|')})(?:s|es)?` : '';
}

/**
 * Build a store-ready inventory item from an untrusted (already-normalized) payload.
 * The engine mints ids and owns equip placement: a DM/Scribe `id` could collide with
 * an existing entry (double-delete on REMOVE_ITEM), and `equipped: true` would
 * displace the hero's active gear (2026-07-28 audit; extended to PURCHASE_ITEM
 * 2026-07-30 — the purchase path spread the payload AFTER its minted defaults).
 * Premise starting items are the one sanctioned equip-on-add channel (`equipOnAdd`).
 */
export function mintOwnedItem(normalizedItem, { equipOnAdd = false, quantity } = {}) {
    const {
        id: _untrustedId,
        equipped: _untrustedEquipped,
        equipOnAdd: _equipFlag,
        ...safe
    } = normalizedItem;
    return {
        id: `item-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        quantity: 1,
        ...safe,
        ...(quantity != null ? { quantity } : {}),
        equipped: equipOnAdd,
    };
}

export const RECENT_SPELL_CAST_LIMIT = 8;

export const RECENT_REST_LIMIT = 8;

/** Decrement a stackable item by `qty`, removing it entirely when the stack is exhausted. */
export function consumeItem(inventory, itemId, qty = 1) {
    return inventory.flatMap(item => {
        if (item.id !== itemId) return [item];
        const remaining = (item.quantity || 1) - qty;
        return remaining > 0 ? [{ ...item, quantity: remaining }] : [];
    });
}

const STACK_EXEMPT_TYPES = new Set(['weapon', 'armor', 'shield']);

/**
 * ONE stacking rule for the pack (2026-09-03): non-equipment with the same
 * identity — catalog key, or the case-folded name when keyless — and the same
 * magic bonus is one stack. Weapons/armor/shields stay one row each (equip
 * flags and slot logic are per row), and an equipped row is never a merge
 * target. Returns null for anything that must stay its own row.
 */
export function stackIdentity(item) {
    if (!item || typeof item !== 'object' || item.equipped) return null;
    if (STACK_EXEMPT_TYPES.has(item.type) || isShieldItem(item)) return null;
    const key = item.itemKey || String(item.name || '').trim().toLowerCase();
    if (!key) return null;
    return `${key}|${Number(item.magicBonus) || 0}`;
}

/**
 * Append `newItem` to the inventory, folding it into an existing same-identity
 * stack when one exists (buy 2 torches, buy 3, find 1 → one row of 6). The
 * existing row keeps its id and fields; only its quantity grows.
 */
export function addOrStackItem(inventory, newItem) {
    const identity = stackIdentity(newItem);
    const target = identity ? inventory.find(row => stackIdentity(row) === identity) : null;
    if (!target) return [...inventory, newItem];
    const added = Math.max(1, Math.trunc(newItem.quantity || 1));
    // The stack has a ceiling (2026-09-25 inventory-economy P2): summing past
    // MAX_ITEM_QUANTITY minted a row of 11,988 torches that the NEXT load's
    // normalizeItem clamped back to 999 — a silent loss in the other direction.
    // Clamp here; callers post the visible line via stackOverflow().
    return inventory.map(row => (row === target
        ? { ...row, quantity: Math.min(MAX_ITEM_QUANTITY, Math.max(1, Math.trunc(row.quantity || 1)) + added) }
        : row));
}

/**
 * How many units of `newItem` addOrStackItem would have to discard because
 * its stack is already at MAX_ITEM_QUANTITY — 0 for a new row or a fitting add.
 */
export function stackOverflow(inventory, newItem) {
    const identity = stackIdentity(newItem);
    const target = identity ? inventory.find(row => stackIdentity(row) === identity) : null;
    if (!target) return 0;
    const held = Math.max(1, Math.trunc(target.quantity || 1));
    const added = Math.max(1, Math.trunc(newItem.quantity || 1));
    return Math.max(0, held + added - MAX_ITEM_QUANTITY);
}

/**
 * End the caster's sustained spell (combat over, rest taken): drop the buff,
 * strip its condition from whoever carried it, and recompute AC without it.
 */
export function clearSustainedSpellState(character, party, inventory) {
    const sustained = character?.sustainedSpell;
    if (!sustained) return { character, party };
    let nextCharacter = { ...character, sustainedSpell: null };
    if (sustained.condition && sustained.targetType !== 'companion') {
        nextCharacter.conditions = dropCondition(nextCharacter.conditions, sustained.condition);
    }
    nextCharacter = { ...nextCharacter, armorClass: computeACFromInventory(inventory || [], nextCharacter) };
    const nextParty = (party || []).map(companion => {
        if (companion.id !== sustained.targetId) return companion;
        const { spellAcBonus: _droppedBonus, ...cleaned } = companion;
        if (sustained.condition) cleaned.conditions = dropCondition(cleaned.conditions, sustained.condition);
        return cleaned;
    });
    return { character: nextCharacter, party: nextParty };
}

function defaultCompanionDamage(weapon = '') {
    const w = String(weapon || '').toLowerCase();
    if (w.includes('great') || w.includes('maul')) return '2d6+2';
    if (w.includes('longsword') || w.includes('battleaxe') || w.includes('warhammer')) return '1d8+2';
    if (w.includes('shortsword') || w.includes('scimitar') || w.includes('mace')) return '1d6+2';
    if (w.includes('dagger')) return '1d4+2';
    if (w.includes('bow') || w.includes('crossbow')) return '1d6+2';
    return '1d4+1';
}

// Companion gear (COMPANION_GEAR_SPEC.md): one abstract weapon expressed through stats.
// On a weapon change the engine rederives damage dice from the catalog (D3/D5) and the
// magic bonus from the name (D4); the flat damage bonus is companion competence, not
// level — preserve the existing trailing +N, default +2 (balance verdict 2026-07-19).
const COMPANION_DAMAGE_DICE = /\d*d\d+/i;
const COMPANION_FLAT_DAMAGE_DEFAULT = 2;

function parseTrailingFlatBonus(damage) {
    const match = String(damage || '').trim().match(/([+-]\d+)\s*$/);
    if (!match) return null;
    const n = Number(match[1]);
    if (!Number.isFinite(n)) return null;
    return Math.max(0, Math.min(8, Math.trunc(n)));
}

// Companion damage bound — the twin of the hero's `boundWeaponDamage`
// (2026-09-09 audit P1: `100d1000+1000000` from the DM lane or a loaded save
// hit once for 1,099,957 and ended the fight). Ceilings mirror the best
// catalog dice a companion can hold (2d6 / 1d12); the flat bonus shares the
// competence cap parseTrailingFlatBonus already enforces (0..8). A trailing
// damage-type word ("1d8+2 slashing") is tolerated and stripped — the DM's
// 20-char slice used to carry it straight into a notation the kernel could
// not parse. Anything else becomes the weapon's own default.
const MAX_COMPANION_DICE_COUNT = 2;
const MAX_COMPANION_DIE_SIDES = 12;

export function boundCompanionDamage(value, weapon = '') {
    const match = String(value ?? '').trim()
        .match(/^(\d{1,3})\s*d\s*(\d{1,4})\s*(?:([+-])\s*(\d{1,4}))?(?:\s+[a-z ,/-]+)?$/i);
    if (!match) return defaultCompanionDamage(weapon);
    const count = Number(match[1]);
    const sides = Number(match[2]);
    if (count < 1 || sides < 1 || count > MAX_COMPANION_DICE_COUNT || sides > MAX_COMPANION_DIE_SIDES) {
        return defaultCompanionDamage(weapon);
    }
    const bonus = match[3] === '-' ? 0 : (parseTrailingFlatBonus(`+${match[4] || 0}`) ?? 0);
    return `${count}d${sides}${bonus > 0 ? `+${bonus}` : ''}`;
}

function deriveCompanionWeaponProfile(weapon, existingDamage, payloadDamage) {
    const weaponBonus = clampMagicBonus(parseMagicBonusFromName(weapon));
    const flatBonus = parseTrailingFlatBonus(existingDamage)
        ?? parseTrailingFlatBonus(payloadDamage)
        ?? COMPANION_FLAT_DAMAGE_DEFAULT;
    const itemKey = normalizeItemKey(weapon);
    const catalog = itemKey ? ITEM_CATALOG[itemKey] : null;
    if (catalog?.type === 'weapon' && COMPANION_DAMAGE_DICE.test(catalog.damage || '')) {
        // Recognized catalog mechanics override LLM-supplied dice (D5). Versatile
        // weapons use the one-handed die — companions don't model hands.
        const damage = flatBonus > 0 ? `${catalog.damage}+${flatBonus}` : catalog.damage;
        return { damage: boundCompanionDamage(damage, weapon), weaponBonus };
    }
    const fallback = (typeof payloadDamage === 'string' && payloadDamage.trim())
        ? boundCompanionDamage(payloadDamage, weapon)
        : defaultCompanionDamage(weapon);
    return { damage: fallback, weaponBonus };
}

function companionText(value, max) {
    return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

/** A companion's health word — THE ladder (`healthWord`), `downed` at 0 HP. */
export function companionStatus(hp, maxHp) {
    return healthWord(hp, maxHp, 'downed');
}

/**
 * The party statuses the engine recognizes — the health ladder's words plus
 * the companion's own down word and the explicit `dead` the DM / END_COMBAT
 * set. Derived from the ladder (2026-10-09 enemy-stats nit: a literal copy in
 * the load heal); anything else on a loaded record re-derives from HP.
 */
export const COMPANION_STATUSES = new Set([...HEALTH_WORDS, 'downed', 'dead']);

export function normalizeCompanion(payload = {}, existing = {}) {
    const merged = { ...existing, ...payload };
    const hasExplicitStatus = Object.prototype.hasOwnProperty.call(payload, 'status');
    const level = clampNumber(merged.level, 1, MAX_CHARACTER_LEVEL, existing.level || 1);
    const maxHp = clampNumber(merged.maxHp ?? merged.maxHP, 1, 999, existing.maxHp || 20);
    const hp = clampNumber(merged.hp, 0, maxHp, existing.hp ?? maxHp);
    // String-or-fallback (2026-09-18 P2): String({ name }) minted an
    // "[object Object]" weapon onto the party line. A { name } object folds to
    // its name, like the location wire.
    const weaponText = (value) => {
        const raw = value && typeof value === 'object' && !Array.isArray(value) ? value.name : value;
        return typeof raw === 'string' ? raw.trim().slice(0, 60) : '';
    };
    const weapon = weaponText(merged.weapon) || weaponText(existing.weapon) || 'Dagger';
    const attackBonus = clampNumber(
        merged.attackBonus ?? merged.modifier,
        -5,
        15,
        existing.attackBonus ?? Math.min(8, 2 + Math.ceil(level / 3))
    );
    // The weapon-rederivation branch fires ONLY when the payload actually changes the
    // weapon — a rest or heal update passing { hp, status } must never touch damage.
    const weaponChanged = typeof payload.weapon === 'string' && payload.weapon.trim() !== ''
        && payload.weapon.trim().toLowerCase() !== String(existing.weapon || '').trim().toLowerCase();
    let damage;
    let weaponBonus;
    if (weaponChanged) {
        const derived = deriveCompanionWeaponProfile(
            weapon,
            existing.damage,
            typeof payload.damage === 'string' ? payload.damage : ''
        );
        damage = derived.damage;
        weaponBonus = derived.weaponBonus;
    } else {
        // Bounded on this branch too: an `add_companions` entry without a
        // weapon, or a loaded save, takes the raw damage field here.
        damage = boundCompanionDamage(merged.damage || existing.damage, weapon);
        weaponBonus = clampMagicBonus(Number(existing.weaponBonus) || 0);
    }

    return {
        id: merged.id || `companion-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
        name: String(merged.name || existing.name || 'Companion').trim().slice(0, 40),
        role: companionText(merged.role, 40) || companionText(existing.role, 40) || 'ally',
        affinity: clampNumber(merged.affinity, 0, 100, existing.affinity ?? 50),
        level,
        maxHp,
        hp,
        // Absolute AC cap 21 (balance verdict 2026-07-19): a maxed hero tops out ~21-23,
        // so a generously geared companion stays at-or-below that ceiling. No per-update
        // delta clamp — "unarmored → plate" is a legitimate +6 jump.
        ac: clampNumber(merged.ac, 1, 21, existing.ac || 12),
        // Shield memory for the engine-owned gift path (2026-09-03 P2): companion
        // gear is abstract, so without it a second gifted shield stacked +2 again.
        // The value the current shield contributes to `ac`; 0 = no shield.
        shieldBonus: clampNumber(merged.shieldBonus, 0, 6, existing.shieldBonus || 0),
        weapon,
        attackBonus,
        damage,
        weaponBonus,
        status: hasExplicitStatus
            ? (merged.status || companionStatus(hp, maxHp))
            : (existing.status === 'dead' ? 'dead' : companionStatus(hp, maxHp)),
        // The hero's canonical form (2026-09-10 audit P2): an object element
        // rendered "[object Object]" in the COMPANIONS prompt block on every turn.
        conditions: normalizeConditionList(Array.isArray(merged.conditions) ? merged.conditions : existing.conditions),
        // Typed text: sceneDirector trims `appearance || notes` and the party
        // prompt block prints them — an object here threw at Scene mode.
        notes: companionText(merged.notes, NPC_DOSSIER_FIELD_MAX) || companionText(existing.notes, NPC_DOSSIER_FIELD_MAX),
        appearance: companionText(merged.appearance, NPC_DOSSIER_FIELD_MAX) || companionText(existing.appearance, NPC_DOSSIER_FIELD_MAX),
        // Sentimental gifts as a durable capped list (never wholesale replaced):
        // per-update `keepsake` beats append; restatements drop by containment.
        keepsakes: appendKeepsakes(existing.keepsakes, [
            ...(Array.isArray(payload.keepsakes) ? payload.keepsakes : []),
            ...(typeof payload.keepsake === 'string' ? [payload.keepsake] : []),
        ]),
    };
}

/**
 * Companion relationship memory lives in the NPC roster ("one system owns all
 * bonds", DECISIONS.md 2026-07-23): the party record keeps combat mechanics and
 * affinity, while the matching roster NPC record carries stanceToPlayer /
 * bondMoments / dossier prose — captured by the Scribe's npc_updates exactly as
 * for any NPC. Joining the party guarantees that record exists; an existing
 * record is left untouched (the Scribe keeps it current, and re-seeding could
 * clobber a richer dossier with defaults).
 */
export function ensureCompanionRosterRecord(npcs = [], companion) {
    const name = String(companion?.name || '').trim();
    if (!name) return npcs;
    if (findNpcByRef(npcs, { name }).npc) return npcs;
    return mergeNpcUpdate(npcs, {
        name,
        kind: 'character',
        rosterEligible: true,
        disposition: 'friendly',
        lastNotes: `Traveling with the hero as a party companion (${companion.role || 'ally'}).`,
        ...(companion.appearance ? { appearance: companion.appearance } : {}),
    });
}

/**
 * Strip blank fields ('', null, undefined) from an NPC payload so a thin update can
 * never erase detail that's already known. Once an NPC's personality, goal, or secret
 * is on record, a later turn that simply omits it leaves it intact — continuity wins
 * over churn.
 */
function pruneBlankFields(payload) {
    const out = {};
    for (const [key, value] of Object.entries(payload)) {
        if (value === '' || value === null || value === undefined) continue;
        out[key] = value;
    }
    return out;
}

/**
 * Upsert an NPC into the tracker — the single source of truth for NPC writes.
 * - Match by id when one is supplied, otherwise (or as a fallback) by case-insensitive
 *   name — the per-turn Scribe and the DM's inline npc_updates only ever know the name.
 * - On a match, merge just the non-blank fields the caller supplied.
 * - With no match and a name to track them by, create a fresh record with defaults.
 * - Every touch stamps lastSeen, so the prompt's "recently active" ordering reflects the
 *   turn the NPC actually appeared rather than the last 10-message journal pass.
 * This is what lets a just-met NPC be created the moment they appear instead of waiting
 * for a journal summary to happen to mention them.
 */
export function mergeNpcUpdate(npcs, payload) {
    return upsertNpc(npcs, payload);
}

/**
 * @param {object[]} npcs
 * @param {object} payload - the update; `_seen: false` marks a lane that is
 *   NOT a sighting (the journal cadence re-mentioning past events, an
 *   absence-drift install for someone the hero never met) so neither
 *   `lastSeen` nor `lastSeenMessage` is stamped (2026-09-06 audit).
 * @param {{ messageCount?: number, messages?: object[] }} [options] - transcript
 *   length for the conversational `lastSeenMessage` stamp the prompt curation's
 *   recency reads, and the transcript itself for the scene clock (the same-scene
 *   fold, the impression graduation, the shared-name resolution — 2026-10-19).
 */
export function upsertNpc(npcs, rawPayload, { messageCount, messages = null, presenceText = '', onAmbiguous = null, lane = 'engine', onHold = null } = {}) {
    // The lane trust boundary (2026-09-16 P1): known keys only, text fields
    // string-or-drop at their clamps, disposition whitelisted — see
    // sanitizeNpcLanePayload. Engine-owned keys (knownFacts, firstMet, portrait*, the stamps) can no
    // longer arrive from a DM or Scribe payload.
    const payload = sanitizeNpcLanePayload(rawPayload);
    if (!payload) return npcs;
    const seen = payload._seen !== false;
    const update = pruneBlankFields({
        ...payload,
        ...(seen && { lastSeen: Date.now() }),
        ...(seen && Number.isFinite(messageCount) && { lastSeenMessage: messageCount }),
    });
    delete update._seen;
    // Payload-trust boundary (2026-09-06 P2): the record id is engine-minted
    // and never overwritten — a DM `npc_updates` entry carrying its own id
    // re-keyed the record, orphaning companion links and portraits-by-id (the
    // id still MATCHES below; it just never writes). `pinned` is the player's
    // write alone (PIN_NPC); `importance` is always recomputed from the
    // dossier; `trust` is clamped 0..100 (999 rendered as "trust: 999/100").
    delete update.id;
    delete update.pinned;
    delete update.importance;
    // The "lately" shelf is engine-written only (mergeNpcCoreText): a lane
    // cannot plant an impression, and cannot graduate one by writing it.
    delete update.recentImpressions;
    // A regrade of existing moments is applied by the UPDATE_NPC handler
    // (gradeBondMoments) — never spread onto the record as a field.
    delete update.gradedMoments;
    if ('trust' in update) {
        const trust = Number(update.trust);
        if (Number.isFinite(trust)) update.trust = Math.max(0, Math.min(100, Math.round(trust)));
        else delete update.trust;
    }
    // appearance / gender / species arrive typed and clamped from
    // sanitizeNpcLanePayload (string-or-drop — never `String(object)`).
    if (update.stanceToPlayer) {
        update.stanceToPlayer = clampNpcDossierField(update.stanceToPlayer);
    }
    // The open thread (2026-09-13): the one thing pending between this NPC
    // and the hero — current-state REPLACE like lastNotes, engine-stamped
    // with the message it was set at, cleared by an explicit
    // `openThreadResolved: true` (pruneBlankFields drops '' so a clear needs
    // its own token). The stamp is never payload-writable.
    delete update.openThreadMessage;
    delete update.openThreadResolvedMessage;
    // A lane flag reads through toFlag (2026-10-22 scribe P2): the Scribe
    // template spells the flag as prose, Flash echoes `"true"`, and `=== true`
    // left the settled thread standing on the record.
    const threadResolved = toFlag(update.openThreadResolved);
    delete update.openThreadResolved;
    if (update.openThread !== undefined) {
        const thread = typeof update.openThread === 'string'
            ? update.openThread.trim().slice(0, NPC_OPEN_THREAD_MAX)
            : '';
        if (thread) {
            update.openThread = thread;
            if (Number.isFinite(messageCount)) update.openThreadMessage = messageCount;
        } else {
            delete update.openThread;
        }
    }
    // A thread is settled in the person's presence (2026-10-31): buying
    // Nib's promised wire a sea away cleared Nib's thread on a turn she was
    // not in. The Scribe's rule asks for presence; the engine can judge only
    // the NAME — a per-turn lane (a sighting) may settle the thread of
    // someone its scene at least names. The cadence's off-screen lanes are
    // unchanged.
    const settledInPresence = !seen || !presenceText || nameTokensPresent(textWordSet(presenceText), payload.name || '') !== false;
    if (threadResolved && !update.openThread && settledInPresence) {
        update.openThread = '';
        update.openThreadMessage = null;
        // Settled, not lost (grand playtest 2026-10-03): the post-journal
        // verifier reads this stamp so a thread the Scribe or the cadence
        // reflection RESOLVED is never reported as a thread the record dropped.
        if (Number.isFinite(messageCount)) update.openThreadResolvedMessage = messageCount;
    }
    // Bond moments are append-only history: a turn's `bondMoment` (or an enrichment
    // batch of `bondMoments`) joins the existing record — it can never replace it.
    const bondAdditions = [];
    if (update.bondMoment) {
        bondAdditions.push(update.bondMoment);
        delete update.bondMoment;
    }
    if (update.bondMoments) {
        if (Array.isArray(update.bondMoments)) bondAdditions.push(...update.bondMoments);
        delete update.bondMoments;
    }
    // Ties merge against the ROSTER (2026-11-04): a lane names another
    // person; the record keeps that person's full name and id, or nothing.
    const tieAdditions = Array.isArray(update.ties) ? update.ties : [];
    delete update.ties;

    // The record is an id, an exact name or an exact alias (identity by
    // reference, lane 6, 2026-11-08; M0's "a shared name is not a person"
    // stands as the alias-held-twice refusal). No word rule, no presence or
    // scene-window tiebreak, no one-letter typo twin (2026-10-31) decides:
    // a DM-lane name the record does not know is HELD for the Scribe to link
    // (`onHold`, the one lane with no ids to copy); a Scribe-lane or engine
    // name the record does not know is a new person.
    const resolved = findNpcByRef(npcs, payload);
    if (resolved.ambiguous.length > 1) {
        onAmbiguous?.(resolved.ambiguous, payload);
        return npcs;
    }
    const idx = resolved.index;
    if (idx === -1 && lane === 'dm' && payload.name && !payload.id && onHold?.(payload) === true) return npcs;

    const existing = idx !== -1 ? npcs[idx] : null;
    // Classified from the sanitized update: a DM-lane `pinned: true` must not
    // buy roster admission or importance the way it did through the raw payload.
    const classified = classifyNpcCandidate(update, existing);

    if (idx !== -1) {
        if (!classified.allowRoster && existing.rosterTier !== 'character' && !existing.pinned) {
            return npcs;
        }
        // Disposition is current mood only; the ARC is derived from the bond
        // moments (deriveRelationshipArc, 2026-10-31), never logged per mood.
        if (bondAdditions.length > 0) {
            update.bondMoments = appendBondMoments(existing.bondMoments, bondAdditions, { messageCount, messages });
        }
        // Durable dossier prose accumulates: a per-turn fragment appends to the
        // record, a restatement is dropped, and only a complete rewrite that carries
        // the known record may replace it. The immediate scene can never erase an
        // NPC's personality, goals, secrets, or their history with the hero.
        // The CORE fields (personality, stance) go further (2026-09-12): a
        // fragment lands on the "lately" shelf and joins the permanent record
        // only when a later scene bears it out — see mergeNpcCoreText.
        let impressions = existing.recentImpressions;
        for (const field of NPC_DURABLE_TEXT_FIELDS) {
            if (!update[field]) continue;
            if (NPC_CORE_TEXT_FIELDS.includes(field)) {
                const merged = mergeNpcCoreText(existing[field], update[field], impressions, { field, messageCount, messages });
                update[field] = merged.text;
                impressions = merged.impressions;
            } else {
                update[field] = mergeNpcDossierText(existing[field], update[field]);
            }
        }
        const liveImpressions = normalizeImpressions(impressions, { messageCount });
        if (liveImpressions.length > 0 || existing.recentImpressions) {
            update.recentImpressions = liveImpressions;
        }
        if (update.callbackHooks) {
            update.callbackHooks = appendCallbackHooks(existing.callbackHooks, update.callbackHooks);
        }
        if (tieAdditions.length > 0) {
            const ties = mergeNpcTies(existing.ties, tieAdditions, { npcs, self: existing, messageCount });
            if (ties.length > 0) update.ties = ties;
        }
        // Appearance stays a rewrite-replaces field, but a FRAGMENT arriving
        // without merge context (the DM lane, or a Scribe turn that only saw a
        // short name) joins the record instead of wiping it (2026-09-06 P1).
        if (update.appearance) {
            update.appearance = mergeNpcAppearance(existing.appearance, update.appearance);
        }
        const nameToKeep = (update.name && update.name.length > (existing.name || '').length) ? update.name : existing.name;
        // Every name the person has answered to stays findable (lane 6): the
        // old name when a longer one takes over, the lane's spelling when it
        // landed by alias or id.
        const aliases = normalizeNpcAliases([...(Array.isArray(existing.aliases) ? existing.aliases : []), existing.name, update.name], nameToKeep);
        const merged = normalizeNpcRecord({
            ...existing,
            ...update,
            name: nameToKeep,
            ...(aliases.length > 0 && { aliases }),
            rosterTier: classified.rosterTier || existing.rosterTier || 'character',
            kind: classified.kind || existing.kind || 'character',
            importance: classified.importance,
            pinned: !!existing.pinned,
        });
        return npcs.map((npc, i) => (i === idx ? merged : npc));
    }

    // No match — only create roster-worthy characters.
    if (!payload.name || !classified.allowRoster) return npcs;
    if (bondAdditions.length > 0) {
        update.bondMoments = appendBondMoments([], bondAdditions, { messageCount, messages });
    }
    if (update.callbackHooks) {
        update.callbackHooks = appendCallbackHooks([], update.callbackHooks);
    }
    if (tieAdditions.length > 0) {
        const ties = mergeNpcTies([], tieAdditions, { npcs, self: { name: payload.name }, messageCount });
        if (ties.length > 0) update.ties = ties;
    }
    return [...npcs, normalizeNpcRecord({
        id: `npc-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
        firstMet: Date.now(),
        disposition: 'unknown',
        personality: '',
        goals: '',
        secrets: '',
        knownFacts: [],
        basedIn: null,
        lastLocation: null,
        agenda: '',
        relationshipTension: '',
        stanceToPlayer: '',
        bondMoments: [],
        trust: null,
        privateNotes: '',
        callbackHooks: [],
        pinned: false,
        ...update,
        rosterTier: classified.rosterTier || 'character',
        kind: classified.kind || 'character',
        importance: classified.importance,
    })];
}

function equipmentKindMatches(item, kind) {
    const k = String(kind || '').toLowerCase();
    if (k === 'armor') return isArmorItem(item);
    if (k === 'shield') return isShieldItem(item);
    if (k === 'weapon') return isWeaponItem(item);
    return false;
}

/**
 * Resolve a DM-supplied item reference (id, catalog key, name, or generic
 * armor/shield/weapon kind) against the live inventory — ONE ladder for the
 * equip/unequip channel, name-referenced removal, and sales, so a name that
 * equips also sells and removes (2026-08-28 audit). Rungs: id → the given
 * catalog key → the exact name (compact token — a row named exactly what
 * was said is the row, before a catalog key that two rows may share) → the
 * name's catalog key → a generic equipment kind. No word rung (2026-11-07,
 * identity by reference, lane 5): the DM sees every carried row by name, so a
 * name that is none of these resolves to nothing and the caller says so.
 * Returns `{ item }`, null when nothing matched.
 */
export function resolveInventoryItemRef(inventory, ref, { preferEquipped = false } = {}) {
    const payload = typeof ref === 'string' ? { name: ref } : (ref || {});
    const candidates = preferEquipped
        ? [...inventory].sort((a, b) => Number(!!b.equipped) - Number(!!a.equipped))
        : inventory;
    const found = (item) => ({ item: item || null });

    const id = payload.itemId || payload.id;
    if (id) {
        const byId = candidates.find(i => i.id === id);
        if (byId) return found(byId);
    }

    const itemKey = normalizeItemKey(payload.itemKey || payload.key || '');
    if (itemKey) {
        const byKey = candidates.find(i => i.itemKey === itemKey);
        if (byKey) return found(byKey);
    }

    const name = payload.name || payload.item || '';
    const nameToken = normalizeRefToken(name);
    if (nameToken) {
        const byName = candidates.find(i =>
            normalizeRefToken(i.name) === nameToken ||
            normalizeRefToken(i.itemKey) === nameToken
        );
        if (byName) return found(byName);
    }

    const nameKey = normalizeItemKey(name);
    if (nameKey) {
        const byNameKey = candidates.find(i => i.itemKey === nameKey);
        if (byNameKey) return found(byNameKey);
    }

    const kind = payload.type || payload.slot || payload.category || name;
    return found(candidates.find(i => equipmentKindMatches(i, kind)));
}

export function findInventoryItemByRef(inventory, ref, options) {
    return resolveInventoryItemRef(inventory, ref, options).item;
}
