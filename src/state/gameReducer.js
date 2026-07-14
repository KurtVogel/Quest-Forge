/**
 * Game state reducer — all game state mutations happen through dispatched actions.
 */
import { computeACFromInventory, getModifier } from '../engine/rules.js';
import { CLASSES } from '../data/classes.js';
import { normalizeItem, normalizeItemKey } from '../data/items.js';
import { rollDie, rollNotation, rollWithModifier } from '../engine/dice.ts';
import { ABILITY_NAMES, buildClassResources, normalizeAbilityScoreImprovementState, normalizeFightingStyle, normalizeMartialArchetype } from '../engine/characterUtils.js';
import { awardExperience, estimateCombatExperience, MAX_CHARACTER_LEVEL } from '../engine/progression.js';
import { addCurrency, spendCurrency, formatCurrency } from '../engine/currency.js';
import { isEquippableItem, normalizeEquippedSlots } from '../engine/equipment.js';
import { applyFrontAdvanceBatch, createInitialFronts, FRONTS_VERSION, normalizeFront, normalizeFrontUpdate } from '../engine/fronts.js';
import { findStoryMemoryMatch, normalizeStoryMemoryCard, normalizeStoryMemoryUpdate, pickMergedCardText } from '../engine/storyMemory.js';
import {
    appendBondMoments,
    appendCallbackHooks,
    buildStoryMemoryPromotion,
    clampNpcDossierField,
    classifyNpcCandidate,
    listArchivableFodder,
    mergeNpcDossierText,
    migrateLegacyNpc,
    normalizeNpcRecord,
    namesMatch,
    NPC_DURABLE_TEXT_FIELDS,
} from '../engine/npcRoster.js';
import { clampEnemyAC, clampEnemyCurrentHP, clampEnemyHP, enemyHealthCondition, normalizeEnemyAttackProfile, normalizeEnemyConditions, sanitizeLoadedEnemy } from '../engine/enemyStats.js';
import { COMBAT_PHASES, isEnemyActive, normalizeCombatExchange, reconcileStartingCombatExchange } from '../engine/combatExchange.js';
import { normalizeRollRuling, RECENT_RULING_LIMIT, sanitizePendingRoleplayCheck } from '../engine/roleplayCheck.js';

function sanitizeStoredExchangeResult(result) {
    if (!result || typeof result !== 'object' || Array.isArray(result)) return null;
    const exchangeId = String(result.exchangeId || '').slice(0, 160);
    if (!exchangeId) return null;
    const kind = result.kind === 'opening' ? 'opening' : 'exchange';
    const terminal = ['victory', 'defeat', 'dying', 'escaped'].includes(result.terminal) ? result.terminal : null;
    const postState = result.postState && typeof result.postState === 'object'
        ? {
            player: result.postState.player && typeof result.postState.player === 'object'
                ? { ...result.postState.player }
                : null,
            enemies: Array.isArray(result.postState.enemies)
                ? result.postState.enemies.slice(0, 30).map(enemy => ({
                    ...enemy,
                    conditions: normalizeEnemyConditions(enemy?.conditions),
                }))
                : [],
            companions: Array.isArray(result.postState.companions)
                ? result.postState.companions.slice(0, 4)
                : [],
        }
        : undefined;
    return {
        exchangeId,
        kind,
        round: Number.isInteger(result.round) ? Math.max(1, result.round) : 1,
        terminal,
        summary: String(result.summary || '').slice(0, 12000),
        events: Array.isArray(result.events) ? result.events.slice(0, 100) : [],
        ...(postState && { postState }),
    };
}

/**
 * Validate and sanitize a loaded save state, filling in missing fields with safe defaults.
 * Protects against corrupted or old-format saves.
 */
function validateSaveState(payload) {
    return {
        ...payload,
        character: payload.character || null,
        inventory: Array.isArray(payload.inventory) ? payload.inventory : [],
        // narrationCue is an ephemeral request created by a player-triggered mechanic
        // (Second Wind / healing potion). Its visible system result belongs in the save,
        // but replaying the cue after Continue/Load would create an unsolicited DM turn.
        // A loaded transcript is history, so every restored cue is already consumed.
        messages: Array.isArray(payload.messages)
            ? payload.messages.map(message => {
                if (!message || typeof message !== 'object' || !message.narrationCue) return message;
                const { narrationCue: _consumedCue, ...restoredMessage } = message;
                return restoredMessage;
            })
            : [],
        rollHistory: Array.isArray(payload.rollHistory) ? payload.rollHistory : [],
        quests: Array.isArray(payload.quests) ? payload.quests : [],
        journal: Array.isArray(payload.journal) ? payload.journal : [],
        npcs: Array.isArray(payload.npcs) ? payload.npcs : [],
        worldFacts: Array.isArray(payload.worldFacts) ? payload.worldFacts : [],
        storyMemory: Array.isArray(payload.storyMemory)
            ? payload.storyMemory.map(m => normalizeStoryMemoryCard(m)).filter(Boolean)
            : [],
        fronts: Array.isArray(payload.fronts) ? payload.fronts.map(f => normalizeFront(f)) : [],
        party: Array.isArray(payload.party) ? payload.party : [],
        currentLocation: payload.currentLocation || null,
        pendingRoleplayCheck: sanitizePendingRoleplayCheck(payload.pendingRoleplayCheck),
        appliedLootSourceIds: Array.isArray(payload.appliedLootSourceIds) ? payload.appliedLootSourceIds : [],
        recentPurchases: normalizeRecentTransactions(payload.recentPurchases),
        recentSales: normalizeRecentTransactions(payload.recentSales),
        recentCoinGrants: normalizeRecentTransactions(payload.recentCoinGrants),
        recentRulings: (Array.isArray(payload.recentRulings) ? payload.recentRulings : [])
            .map(normalizeRollRuling).filter(Boolean).slice(-RECENT_RULING_LIMIT),
        combat: (() => {
            const savedCombat = payload.combat && typeof payload.combat === 'object' && !Array.isArray(payload.combat)
                ? payload.combat
                : {};
            const merged = { ...initialGameState.combat, ...savedCombat };
            // Loaded saves are untrusted input: re-validate enemy stats so a tampered or
            // legacy save can't reintroduce an absurd attackBonus/damage/AC/HP after load.
            const enemies = Array.isArray(merged.enemies)
                ? merged.enemies.map(sanitizeLoadedEnemy).filter(Boolean)
                : [];
            const knownPhases = new Set(Object.values(COMBAT_PHASES));
            let phase = merged.active && knownPhases.has(merged.phase)
                ? merged.phase
                : (merged.active ? COMBAT_PHASES.AWAITING_PLAYER : null);
            // A saved in-flight LLM request cannot be resumed after reload. Return control to
            // the player; no mechanics had committed yet.
            if (phase === COMBAT_PHASES.AWAITING_INTENT) phase = COMBAT_PHASES.AWAITING_PLAYER;
            const lastExchangeResult = sanitizeStoredExchangeResult(merged.lastExchangeResult);
            if (phase === COMBAT_PHASES.AWAITING_NARRATION && !lastExchangeResult?.exchangeId) {
                phase = COMBAT_PHASES.AWAITING_PLAYER;
            }
            const turnOrder = Array.isArray(merged.turnOrder) ? merged.turnOrder : [];
            const playerIdx = turnOrder.findIndex(actor => actor?.type === 'player');
            const currentTurn = phase === COMBAT_PHASES.AWAITING_PLAYER && playerIdx >= 0
                ? playerIdx
                : Math.max(0, Math.min(turnOrder.length - 1, Number.isInteger(merged.currentTurn) ? merged.currentTurn : 0));
            return {
                ...merged,
                enemies,
                turnOrder,
                currentTurn,
                phase,
                openingActorIds: Array.isArray(merged.openingActorIds) ? merged.openingActorIds.map(String) : [],
                resolvedExchangeIds: Array.isArray(merged.resolvedExchangeIds) ? merged.resolvedExchangeIds.slice(-20) : [],
                surprise: ['player', 'enemies'].includes(merged.surprise) ? merged.surprise : 'none',
                queuedExchange: normalizeCombatExchange(merged.queuedExchange),
                lastExchangeResult,
            };
        })(),
        session: payload.session || initialGameState.session,
    };
}

/**
 * Return a new state with inventory updated and AC recalculated if needed.
 * Centralizes the repeated pattern across ADD_ITEM, REMOVE_ITEM, EQUIP_ITEM, etc.
 */
function withInventoryAndAC(state, newInventory) {
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

function systemMessage(content, extra = {}) {
    return {
        id: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        timestamp: Date.now(),
        role: 'system',
        content,
        ...extra,
    };
}

function isPlayerCombatTurn(combat) {
    if (!combat?.active) return false;
    if (combat.phase) return combat.phase === COMBAT_PHASES.AWAITING_PLAYER;
    return combat.turnOrder?.[combat.currentTurn]?.type === 'player';
}

function isBonusActionConsumable(item) {
    return item?.actionType === 'bonus' || item?.consumableType === 'healing';
}

function normalizeInventory(inventory = []) {
    return inventory.map(item => normalizeItem(item));
}

function normalizeRefToken(value) {
    return String(value || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

// --- World-fact near-duplicate detection (Scribe over-extraction guard) ---
const FACT_STOP_WORDS = new Set([
    'the', 'a', 'an', 'of', 'to', 'in', 'is', 'are', 'was', 'were', 'and', 'or',
    'that', 'this', 'it', 'its', 'their', 'his', 'her', 'has', 'have', 'had',
    'by', 'for', 'with', 'at', 'on', 'as', 'be', 'been', 'from', 'now', 'not', 'no',
]);

function factTokenSet(text) {
    const normalized = String(text || '')
        .toLowerCase()
        .replace(/[^\p{L}\p{N}\s]/gu, ' ')
        .replace(/\s+/g, ' ')
        .trim();
    return new Set(normalized.split(' ').filter(token => token && !FACT_STOP_WORDS.has(token)));
}

// A fact whose meaningful tokens are ~all contained in an existing fact (or vice
// versa) is a restatement — "Odo is dead" vs "Odo is dead, killed at the docks".
function isNearDuplicateFact(candidate, existingSets) {
    const tokens = factTokenSet(candidate);
    if (tokens.size === 0) return true;
    for (const existing of existingSets) {
        if (existing.size === 0) continue;
        const small = tokens.size <= existing.size ? tokens : existing;
        const large = tokens.size <= existing.size ? existing : tokens;
        let overlap = 0;
        for (const token of small) {
            if (large.has(token)) overlap += 1;
        }
        if (overlap / small.size >= 0.9) return true;
    }
    return false;
}

const RECENT_TRANSACTION_LIMIT = 20;
const RECENT_TRANSACTION_MESSAGE_WINDOW = 8;
const PURCHASE_VERB_RE = /\b(buy|buys|buying|bought|purchase|purchases|purchasing|purchased|pay|pays|paying|paid|order|orders|ordering|ordered|take|takes|taking|grab|grabs|grabbing|get|gets|getting)\b/i;
const SALE_VERB_RE = /\b(sell|sells|selling|sold|pawn|pawns|pawning|pawned|trade|trades|trading|traded|offer|offers|offering|offered|unload|unloads|unloading|fence|fences|fencing|fenced)\b/i;
// Explicit repeat-intent phrasing: "another", "one/two/a few more", "more of those", etc.
const REPEAT_TRANSACTION_RE = /\b(another|second|same|again|(?:one|two|three|four|five|six|a couple(?: of)?|a few|several|some)\s+more|more of (?:those|these|them))\b/i;

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

function normalizeRecentTransactions(entries) {
    return (Array.isArray(entries) ? entries : [])
        .map(sanitizeRecentTransaction)
        .filter(Boolean)
        .slice(-RECENT_TRANSACTION_LIMIT);
}

function buildPurchaseTransaction(payload = {}) {
    const root = payload && typeof payload === 'object'
        ? payload
        : { name: String(payload || '') };
    const rawWithMeta = root.item && typeof root.item === 'object'
        ? { ...root.item }
        : root.item
            ? { name: String(root.item) }
            : { ...root };
    const { _meta: _rawMeta, ...raw } = rawWithMeta;
    const item = normalizeItem({
        ...raw,
        itemKey: raw.itemKey || root.itemKey || raw.key || root.key,
        name: raw.name || root.name,
        quantity: root.quantity || raw.quantity || 1,
    });
    const quantity = item.quantity || 1;
    const priceCp = Number.isFinite(root.priceCp)
        ? root.priceCp
        : Number.isFinite(item.valueCp)
            ? item.valueCp * quantity
            : 0;
    const identity = normalizeItemKey(item.itemKey || item.key || item.name)
        || normalizeRefToken(item.itemKey || item.name);
    return {
        item,
        quantity,
        priceCp,
        signature: `${identity || normalizeRefToken(item.name)}|${quantity}|${Math.max(0, Math.trunc(priceCp))}`,
    };
}

function currentMessageIndex(state) {
    return Math.max(0, (state.messages || []).length - 1);
}

function findRecentTransactionDuplicate(entries, transaction, sourceId, currentIndex, window = RECENT_TRANSACTION_MESSAGE_WINDOW) {
    return normalizeRecentTransactions(entries)
        .slice()
        .reverse()
        .find(entry => {
            if (entry.signature !== transaction.signature) return false;
            if (sourceId && entry.sourceId === sourceId) return true;
            const distance = currentIndex - entry.messageIndex;
            return distance >= 0 && distance <= window;
        }) || null;
}

function rememberTransaction(entries, transaction, sourceId, messageIndex, status = 'applied') {
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

// Coin grants replay in a tighter window than purchases: the observed failure is the DM
// re-emitting a reward on the very next turn while narrating the pouch being counted or
// split. Two identical legitimate finds four+ messages apart stay untouched.
const RECENT_COIN_GRANT_MESSAGE_WINDOW = 4;
const COIN_WORD_RE = /\b(gold|silver|copper|coins?|gp|sp|cp|payment|reward|wages?|bounty|purse)\b/i;

function clampCoinAmount(value) {
    return Number.isFinite(value) ? Math.max(0, Math.min(10000, Math.trunc(value))) : 0;
}

function buildCoinGrantTransaction(gold, silver, copper) {
    const totalCp = gold * 100 + silver * 10 + copper;
    return {
        signature: `coins|${gold}g|${silver}s|${copper}c`,
        item: { itemKey: 'coin-grant', name: formatCurrency(totalCp) },
        quantity: 1,
        priceCp: totalCp,
    };
}

function playerMessageSupportsRepeatCoinGrant(playerMessage) {
    const text = String(playerMessage || '');
    if (!text.trim()) return false;
    // "another 20 gold", "the rest of my payment" — explicit repeat intent naming coin.
    return REPEAT_TRANSACTION_RE.test(text) && COIN_WORD_RE.test(text);
}

function playerMessageSupportsRepeatTransaction(item, playerMessage, verbRe) {
    const text = String(playerMessage || '');
    if (!text.trim()) return false;
    if (!verbRe.test(text) && !REPEAT_TRANSACTION_RE.test(text)) return false;

    const compactText = normalizeRefToken(text);
    const tokens = [item.itemKey, item.name]
        .filter(Boolean)
        .map(normalizeRefToken)
        .filter(Boolean);
    if (tokens.some(token => compactText.includes(token))) return true;

    const nameWords = String(item.name || '').toLowerCase().split(/[^a-z0-9]+/).filter(word => word.length > 2);
    if (nameWords.length > 0 && nameWords.every(word => text.toLowerCase().includes(word))) return true;

    return REPEAT_TRANSACTION_RE.test(text) && /\b(one|it|that|those|these|them|same)\b/i.test(text);
}

function equipmentKindMatches(item, kind) {
    const k = String(kind || '').toLowerCase();
    if (!k) return false;
    if (k === 'armor') return item.type === 'armor' && !item.isShield;
    if (k === 'shield') return item.type === 'shield' || item.isShield;
    if (k === 'weapon') return item.type === 'weapon';
    return false;
}

function findInventoryItemByRef(inventory, ref, { preferEquipped = false } = {}) {
    const payload = typeof ref === 'string' ? { name: ref } : (ref || {});
    const candidates = preferEquipped
        ? [...inventory].sort((a, b) => Number(!!b.equipped) - Number(!!a.equipped))
        : inventory;

    const id = payload.itemId || payload.id;
    if (id) {
        const byId = candidates.find(i => i.id === id);
        if (byId) return byId;
    }

    const itemKey = normalizeItemKey(payload.itemKey || payload.key || '');
    if (itemKey) {
        const byKey = candidates.find(i => i.itemKey === itemKey);
        if (byKey) return byKey;
    }

    const name = payload.name || payload.item || '';
    const nameKey = normalizeItemKey(name);
    if (nameKey) {
        const byNameKey = candidates.find(i => i.itemKey === nameKey);
        if (byNameKey) return byNameKey;
    }

    const nameToken = normalizeRefToken(name);
    if (nameToken) {
        const byName = candidates.find(i =>
            normalizeRefToken(i.name) === nameToken ||
            normalizeRefToken(i.itemKey) === nameToken
        );
        if (byName) return byName;
    }

    const kind = payload.type || payload.slot || payload.category || name;
    return candidates.find(i => equipmentKindMatches(i, kind)) || null;
}

function applyPendingLevelUpsOnLoad(character) {
    if (!character) return { character, messages: [] };

    // Old saves may have banked enough XP under a previous threshold curve.
    // Run the same engine-owned progression pass used by ADD_EXP, but only
    // on load and without adding any new XP.
    return awardExperience(character, 0);
}

/** Decrement a stackable item by `qty`, removing it entirely when the stack is exhausted. */
function consumeItem(inventory, itemId, qty = 1) {
    return inventory.flatMap(item => {
        if (item.id !== itemId) return [item];
        const remaining = (item.quantity || 1) - qty;
        return remaining > 0 ? [{ ...item, quantity: remaining }] : [];
    });
}

function canonicalCombatEnemyId(enemy, index, usedIds) {
    const fragment = String(enemy?.id || enemy?.name || index + 1)
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

function normalizeCombatEnemy(enemy, index, usedIds) {
    const hp = clampEnemyHP(enemy?.hp);
    const ac = clampEnemyAC(enemy?.ac);
    const initiative = rollDie(20);
    // Engine-owned enemy turns need canonical attack stats. Accept them from the DM's
    // combat_start when given (validated through the shared sanitizer — defense-in-depth even
    // though the parser already ran); otherwise the roll resolver fills flat defaults at roll
    // time, so older saves whose enemies lack these fields still work.
    const attackProfile = normalizeEnemyAttackProfile(enemy);
    // Drop the raw attackBonus/damage before spreading so an out-of-range value can't survive
    // when the validated profile omits it; re-add only the sanitized fields.
    const { attackBonus: _rawAb, damage: _rawDmg, ...rest } = enemy || {};

    return {
        ...rest,
        id: canonicalCombatEnemyId(enemy, index, usedIds),
        name: String(enemy?.name || `Enemy ${index + 1}`).trim().slice(0, 100) || `Enemy ${index + 1}`,
        maxHp: hp,
        hp,
        ac,
        ...attackProfile,
        initiative,
        condition: enemyHealthCondition(hp, hp),
        conditions: normalizeEnemyConditions(enemy?.conditions),
        combatStatus: 'active',
        defending: false,
    };
}

/** Mark a character as dead (3 failed death saves or a fatal narrative event). */
function applyDeath(character) {
    return { ...character, isDead: true, dying: false, deathSaves: { successes: 0, failures: 0 } };
}

function isLowLevelSolo(character, party = []) {
    return !!character && (character.level ?? 1) <= 2 && (!party || party.length === 0);
}

function withCondition(character, condition) {
    const conditions = character.conditions || [];
    if (conditions.some(c => c.toLowerCase() === condition.toLowerCase())) return character;
    return { ...character, conditions: [...conditions, condition] };
}

/** Convert an early low-level knockout into a setback instead of campaign-ending death. */
function applyEarlyDefeat(character) {
    return withCondition({
        ...character,
        currentHP: 0,
        dying: false,
        lowLevelDefeat: true,
        deathSaves: { successes: 0, failures: 0 },
    }, 'Unconscious');
}

/** Bring a dying/stable character back to consciousness (healing or a nat-20 death save). */
function reviveCharacter(character) {
    return {
        ...character,
        dying: false,
        lowLevelDefeat: false,
        deathSaves: { successes: 0, failures: 0 },
        conditions: (character.conditions || []).filter(c => c.toLowerCase() !== 'unconscious'),
    };
}

export const initialGameState = {
    character: null, // Should include gold: 0, silver: 0, copper: 0
    inventory: [],
    messages: [],
    rollHistory: [],
    quests: [],
    journal: [],
    npcs: [],
    worldFacts: [], // Canonical world facts that never get compressed — [{id, fact, category, timestamp}]
    storyMemory: [], // Compact dramatic callback cards — narrative-only memory, never mechanics
    fronts: [], // Hidden campaign clocks/threats — injected into the DM prompt, never shown directly to the player
    party: [], // Companions currently traveling with the player
    currentLocation: null,
    pendingRoleplayCheck: null, // Reload-safe out-of-combat check proposal; no dice exist yet
    appliedLootSourceIds: [], // Message IDs whose gold/item loot has already been applied — prevents double-grant
    recentPurchases: [], // Recent one-shot purchase signatures — prevents cross-turn LLM replays from double-charging
    recentSales: [], // Sale twin of recentPurchases — prevents replayed sells from double-removing/double-paying
    recentCoinGrants: [], // Coin twin of recentPurchases — prevents a reward re-emitted on a later turn from paying twice
    recentRulings: [], // Roleplay-check rulings that ended without dice — injected so the DM cannot re-propose overruled/set-aside checks from scratch
    combat: {
        active: false,
        enemies: [],
        turnOrder: [],
        currentTurn: 0,
        round: 1,
        xpAwarded: false, // true once any XP is earned during a fight (gates the End-Combat fallback)
        bonusActionUsed: false,
        phase: null,
        openingActorIds: [],
        queuedExchange: null,
        lastExchangeResult: null,
        resolvedExchangeIds: [],
        surprise: 'none',
    },
    session: {
        id: null,
        name: '',
        createdAt: null,
        lastSaved: null,
        prunedMessageCount: 0, // How many messages have been summarized and excluded from LLM history
    },

    user: {
        uid: null,
        email: null,
        isGuest: false,
        isAuthLoading: true, // Start true while Firebase checks token
    },
    settings: {
        llmProvider: 'gemini',
        apiKey: '',
        geminiApiKey: '', // Gemini machinery key (RAG/Scribe/journal) — required when the DM provider is not Gemini
        imageApiKey: '', // xAI (Grok) key for scene-art image generation — separate from the chat key
        model: 'gemini-3.1-pro-preview',
        preset: 'classicFantasy',
        ruleset: 'simplified5e',
        customSystemPrompt: `
Run a gritty, mature, low-fantasy RPG for an adult player with adult tastes. The world is dangerous, morally complex, and grounded. Use vivid, sensory narration for violence, fear, injury, intimacy, poverty, power, and consequence. Prioritize the narrative's depth over conventional social pleasantries or emotional comfort.

ONLY call for a roll when the action is meaningfully uncertain, difficult, opposed, or dangerous, and when both success and failure would change the situation. If the outcome is obvious, low-stakes, mostly flavor, or you are unsure whether a roll is warranted, narrate the natural result instead of rolling. Do NOT stack the odds of every action against the player by rolling everything.

Player agency is strict: never dictate the player character’s words, thoughts, feelings, or actions. Narrate the world and consequences, usually in 1-2 short paragraphs. Use 3 only for major openings, big consequences, intimate/important NPC moments, or climactic outcomes. Then ask “What do you do?” when the scene needs the player’s next move.

Reward clever plans with advantage, easier stakes, or automatic success when appropriate.

Adult themes, romance, sexuality, cruelty, corruption, and dark humor may appear when they arise naturally from character dynamics and player choices. Treat NPCs as people with independent motives, desires and agendas.

Adult sensuality and explicit sex are part of the world, but they must emerge from scene logic, character dynamics, tension, attraction, privacy, opportunity, and player choices. Sexualize ONLY when appropriate, NOT by default.

When and if intimate and sexual situations genuinely arise, describe them with explicitness and raw detail, including the dialogue. Savor these moments fully. Do not fade to black, let user act within the scene in every turn. Use all the c, f, p, t, a, etc. words.`,
    },
    ui: {
        isSettingsOpen: false,
        isCharacterCreationOpen: false,
        isSaveLoadOpen: false,
    },
};

/** How many disposition shifts to keep per NPC — enough to show an arc, bounded for state size. */
const MAX_NPC_HISTORY = 10;
const MAX_PARTY_SIZE = 4;

function clampNumber(value, min, max, fallback) {
    const n = Number(value);
    if (!Number.isFinite(n)) return fallback;
    return Math.max(min, Math.min(max, Math.trunc(n)));
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

function companionStatus(hp, maxHp) {
    if (hp <= 0) return 'downed';
    const pct = maxHp > 0 ? hp / maxHp : 1;
    if (pct <= 0.25) return 'critical';
    if (pct <= 0.5) return 'bloodied';
    return 'healthy';
}

function normalizeCompanion(payload = {}, existing = {}) {
    const merged = { ...existing, ...payload };
    const hasExplicitStatus = Object.prototype.hasOwnProperty.call(payload, 'status');
    const level = clampNumber(merged.level, 1, MAX_CHARACTER_LEVEL, existing.level || 1);
    const maxHp = clampNumber(merged.maxHp ?? merged.maxHP, 1, 999, existing.maxHp || 20);
    const hp = clampNumber(merged.hp, 0, maxHp, existing.hp ?? maxHp);
    const weapon = merged.weapon || existing.weapon || 'Dagger';
    const attackBonus = clampNumber(
        merged.attackBonus ?? merged.modifier,
        -5,
        15,
        existing.attackBonus ?? Math.min(8, 2 + Math.ceil(level / 3))
    );
    const damage = merged.damage || existing.damage || defaultCompanionDamage(weapon);

    return {
        id: merged.id || `companion-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
        name: String(merged.name || existing.name || 'Companion').trim().slice(0, 40),
        role: merged.role || existing.role || 'ally',
        affinity: clampNumber(merged.affinity, 0, 100, existing.affinity ?? 50),
        level,
        maxHp,
        hp,
        ac: clampNumber(merged.ac, 1, 30, existing.ac || 12),
        weapon,
        attackBonus,
        damage,
        status: hasExplicitStatus
            ? (merged.status || companionStatus(hp, maxHp))
            : (existing.status === 'dead' ? 'dead' : companionStatus(hp, maxHp)),
        conditions: Array.isArray(merged.conditions) ? merged.conditions : (existing.conditions || []),
        notes: merged.notes || existing.notes || '',
        appearance: merged.appearance || existing.appearance || '',
    };
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

export function archiveNpcBulk(npcs = [], ids = []) {
    const idSet = new Set((ids || []).filter(Boolean));
    if (idSet.size === 0) return npcs;
    return npcs.map(npc => (
        idSet.has(npc.id)
            ? normalizeNpcRecord({ ...npc, rosterTier: 'archived_creature', kind: 'creature', pinned: false })
            : npc
    ));
}

function upsertNpc(npcs, payload) {
    if (!payload || (!payload.id && !payload.name)) return npcs;
    const update = pruneBlankFields({ ...payload, lastSeen: Date.now() });
    if (update.appearance) {
        update.appearance = String(update.appearance).trim().slice(0, 600);
    }
    if (update.stanceToPlayer) {
        update.stanceToPlayer = clampNpcDossierField(update.stanceToPlayer);
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

    const idx = npcs.findIndex(n =>
        (payload.id && n.id === payload.id) ||
        (payload.name && namesMatch(n.name, payload.name))
    );

    const existing = idx !== -1 ? npcs[idx] : null;
    const classified = classifyNpcCandidate(payload, existing);

    if (idx !== -1) {
        if (!classified.allowRoster && existing.rosterTier !== 'character' && !existing.pinned) {
            return npcs;
        }
        // Record a genuine disposition shift between known stances (skip the initial
        // 'unknown' → X establishment) so the relationship's arc is preserved. A friend
        // turning hostile — or an enemy won over — is exactly the beat the DM and player
        // should remember.
        if (update.disposition && existing.disposition &&
            existing.disposition !== 'unknown' &&
            update.disposition !== existing.disposition) {
            const history = Array.isArray(existing.relationshipHistory) ? existing.relationshipHistory : [];
            update.relationshipHistory = [
                ...history,
                { from: existing.disposition, to: update.disposition, at: Date.now(), note: update.lastNotes || '' },
            ].slice(-MAX_NPC_HISTORY);
        }
        if (bondAdditions.length > 0) {
            update.bondMoments = appendBondMoments(existing.bondMoments, bondAdditions);
        }
        // Durable dossier prose accumulates: a per-turn fragment appends to the
        // record, a restatement is dropped, and only a complete rewrite that carries
        // the known record may replace it. The immediate scene can never erase an
        // NPC's personality, goals, secrets, or their history with the hero.
        for (const field of NPC_DURABLE_TEXT_FIELDS) {
            if (update[field]) {
                update[field] = mergeNpcDossierText(existing[field], update[field]);
            }
        }
        if (update.callbackHooks) {
            update.callbackHooks = appendCallbackHooks(existing.callbackHooks, update.callbackHooks);
        }
        const nameToKeep = (update.name && update.name.length > (existing.name || '').length) ? update.name : existing.name;
        const merged = normalizeNpcRecord({
            ...existing,
            ...update,
            name: nameToKeep,
            rosterTier: classified.rosterTier || existing.rosterTier || 'character',
            kind: classified.kind || existing.kind || 'character',
            importance: classified.importance,
            pinned: update.pinned ?? existing.pinned,
        });
        return npcs.map((npc, i) => (i === idx ? merged : npc));
    }

    // No match — only create roster-worthy characters.
    if (!payload.name || !classified.allowRoster) return npcs;
    if (bondAdditions.length > 0) {
        update.bondMoments = appendBondMoments([], bondAdditions);
    }
    if (update.callbackHooks) {
        update.callbackHooks = appendCallbackHooks([], update.callbackHooks);
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
        relationshipHistory: [],
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

function findTouchedNpc(after = [], payload = {}) {
    const id = payload.id;
    const name = payload.name;
    return after.find(npc =>
        (id && npc.id === id)
        || (name && namesMatch(npc.name, name))
    ) || null;
}

export function gameReducer(state, action) {
    switch (action.type) {
        case 'SET_CHARACTER':
            // Ensure all dynamic properties are initialized if missing
            return {
                ...state,
                character: {
                    gold: 0, silver: 0, copper: 0,
                    exp: 0,
                    conditions: [],
                    ...action.payload,
                    fightingStyle: normalizeFightingStyle(action.payload?.class, action.payload?.fightingStyle),
                    martialArchetype: normalizeMartialArchetype(action.payload?.class, action.payload?.level, action.payload?.martialArchetype),
                    ...normalizeAbilityScoreImprovementState(action.payload),
                }
            };

        case 'START_CHARACTER': {
            const inventory = Array.isArray(action.payload.inventory) ? action.payload.inventory : [];
            const character = {
                gold: 0, silver: 0, copper: 0,
                exp: 0,
                conditions: [],
                ...action.payload.character,
                fightingStyle: normalizeFightingStyle(action.payload.character?.class, action.payload.character?.fightingStyle),
                martialArchetype: normalizeMartialArchetype(action.payload.character?.class, action.payload.character?.level, action.payload.character?.martialArchetype),
                ...normalizeAbilityScoreImprovementState(action.payload.character),
            };
            return {
                ...state,
                character: {
                    ...character,
                    armorClass: computeACFromInventory(inventory, character),
                },
                inventory,
            };
        }

        case 'UPDATE_CHARACTER':
            return { ...state, character: { ...state.character, ...action.payload } };

        case 'APPLY_ABILITY_SCORE_IMPROVEMENT': {
            if (!state.character?.pendingAbilityScoreImprovements) return state;
            const increases = action.payload?.increases || {};
            const entries = Object.entries(increases)
                .filter(([ability, value]) => ABILITY_NAMES.includes(ability) && Number.isInteger(value) && value > 0);
            const total = entries.reduce((sum, [, value]) => sum + value, 0);
            if (total !== 2 || entries.some(([, value]) => value > 2)) {
                return {
                    ...state,
                    messages: [...state.messages, systemMessage('Ability Score Improvement must assign exactly two ability points.')],
                };
            }

            const abilityScores = { ...state.character.abilityScores };
            for (const [ability, value] of entries) {
                if ((abilityScores[ability] || 0) + value > 20) {
                    return {
                        ...state,
                        messages: [...state.messages, systemMessage('Ability scores cannot be raised above 20 with this improvement.')],
                    };
                }
                abilityScores[ability] += value;
            }

            const oldConMod = getModifier(state.character.abilityScores.constitution || 10);
            const newConMod = getModifier(abilityScores.constitution || 10);
            const hpGain = Math.max(0, newConMod - oldConMod) * (state.character.level || 1);
            const improvedCharacter = {
                ...state.character,
                abilityScores,
                maxHP: state.character.maxHP + hpGain,
                currentHP: Math.min(state.character.maxHP + hpGain, state.character.currentHP + hpGain),
                abilityScoreImprovementsApplied: (state.character.abilityScoreImprovementsApplied || 0) + 1,
                pendingAbilityScoreImprovements: Math.max(0, (state.character.pendingAbilityScoreImprovements || 0) - 1),
            };
            const improvedState = withInventoryAndAC({ ...state, character: improvedCharacter }, state.inventory);
            const summary = entries.map(([ability, value]) => `${ability.slice(0, 3).toUpperCase()} +${value}`).join(', ');
            return {
                ...improvedState,
                messages: [
                    ...improvedState.messages,
                    systemMessage(`**Ability Score Improvement applied:** ${summary}.${hpGain > 0 ? ` Constitution increased maximum HP by ${hpGain}.` : ''}`),
                ],
            };
        }

        case 'ADD_GOLD':
            return {
                ...state,
                character: addCurrency(state.character, { gold: action.payload }),
            };

        case 'REMOVE_GOLD': {
            const result = spendCurrency(state.character, { gold: action.payload });
            if (!result.paid) {
                return { ...state, messages: [...state.messages, systemMessage(`Not enough coin — missing ${formatCurrency(result.missingCp)}.`)] };
            }
            return {
                ...state,
                character: result.character,
            };
        }

        case 'ADD_SILVER':
            return {
                ...state,
                character: addCurrency(state.character, { silver: action.payload }),
            };

        case 'REMOVE_SILVER': {
            const result = spendCurrency(state.character, { silver: action.payload });
            if (!result.paid) {
                return { ...state, messages: [...state.messages, systemMessage(`Not enough coin — missing ${formatCurrency(result.missingCp)}.`)] };
            }
            return {
                ...state,
                character: result.character,
            };
        }

        case 'ADD_COPPER':
            return {
                ...state,
                character: addCurrency(state.character, { copper: action.payload }),
            };

        case 'REMOVE_COPPER': {
            const result = spendCurrency(state.character, { copper: action.payload });
            if (!result.paid) {
                return { ...state, messages: [...state.messages, systemMessage(`Not enough coin — missing ${formatCurrency(result.missingCp)}.`)] };
            }
            return {
                ...state,
                character: result.character,
            };
        }

        // One narrative coin grant (found/received coins) as a single replay-guarded unit.
        // The DM sometimes re-emits an already-paid reward on a later turn while narrating
        // the pouch being counted or split — the recentCoinGrants ledger suppresses an
        // identical grant inside a short message window unless the player explicitly asked
        // for more coin. The Scribe loot audit routes its coin recoveries through here too,
        // so a re-narrated reward cannot sneak back in through the audit backstop.
        case 'ADD_COIN_GRANT': {
            const meta = action.payload?._meta || {};
            const gold = clampCoinAmount(action.payload?.gold);
            const silver = clampCoinAmount(action.payload?.silver);
            const copper = clampCoinAmount(action.payload?.copper);
            if (gold <= 0 && silver <= 0 && copper <= 0) return state;
            const transaction = buildCoinGrantTransaction(gold, silver, copper);
            const sourceId = String(meta.sourceId || '').slice(0, 160);
            const messageIndex = currentMessageIndex(state);
            const duplicate = findRecentTransactionDuplicate(
                state.recentCoinGrants, transaction, sourceId, messageIndex, RECENT_COIN_GRANT_MESSAGE_WINDOW
            );
            const exactSourceReplay = !!sourceId && duplicate?.sourceId === sourceId;
            if (duplicate && (exactSourceReplay || !playerMessageSupportsRepeatCoinGrant(meta.playerMessage))) {
                return {
                    ...state,
                    recentCoinGrants: rememberTransaction(state.recentCoinGrants, transaction, sourceId, messageIndex, 'ignored'),
                    messages: [
                        ...state.messages,
                        systemMessage(`Duplicate coin grant ignored — ${transaction.item.name} was already received moments ago.`),
                    ],
                };
            }
            const messages = meta.announce === 'audit'
                ? [...state.messages, systemMessage(`**Coins recovered from narration:** ${transaction.item.name} added to your purse.`)]
                : state.messages;
            return {
                ...state,
                character: addCurrency(state.character, { gold, silver, copper }),
                recentCoinGrants: rememberTransaction(state.recentCoinGrants, transaction, sourceId, messageIndex),
                messages,
            };
        }

        // Scribe payment audit: the narrative showed the hero completing a payment that the
        // DM never emitted as a coin-loss event. Deduct it, clamped to the purse — never
        // below zero — and say so visibly. Idempotency is owned by the caller via a
        // CLAIM_LOOT_SOURCE-claimed sourceId, mirroring the loot-recovery path.
        case 'AUDIT_COIN_PAYMENT': {
            const gold = clampCoinAmount(action.payload?.gold);
            const silver = clampCoinAmount(action.payload?.silver);
            const copper = clampCoinAmount(action.payload?.copper);
            const costCp = gold * 100 + silver * 10 + copper;
            if (costCp <= 0) return state;
            const result = spendCurrency(state.character, { gold, silver, copper });
            if (result.paid) {
                return {
                    ...state,
                    character: result.character,
                    messages: [
                        ...state.messages,
                        systemMessage(`**Payment settled from narration:** ${formatCurrency(costCp)} deducted from your purse.`),
                    ],
                };
            }
            const availableCp = costCp - result.missingCp;
            if (availableCp <= 0) {
                return {
                    ...state,
                    messages: [
                        ...state.messages,
                        systemMessage(`**Payment noted from narration:** ${formatCurrency(costCp)} was owed, but your purse is empty — nothing deducted.`),
                    ],
                };
            }
            const partial = spendCurrency(state.character, { copper: availableCp });
            return {
                ...state,
                character: partial.character,
                messages: [
                    ...state.messages,
                    systemMessage(`**Payment settled from narration:** ${formatCurrency(availableCp)} deducted (purse emptied; ${formatCurrency(result.missingCp)} short of the narrated ${formatCurrency(costCp)}).`),
                ],
            };
        }

        case 'TAKE_DAMAGE': {
            const prevHP = state.character.currentHP;
            const newHP = Math.max(0, prevHP - action.payload);
            let character = { ...state.character, currentHP: newHP };
            const messages = [...state.messages];
            const earlyDefeatProtected = isLowLevelSolo(state.character, state.party);

            if (newHP === 0 && prevHP > 0 && !character.isDead) {
                if (earlyDefeatProtected) {
                    character = applyEarlyDefeat(character);
                    messages.push(systemMessage(`**${character.name} is defeated.** At level ${character.level}, this is a severe setback, not a campaign-ending death: the enemy may capture, rob, spare, bind, abandon, or bargain with you, but the story continues.`));
                } else {
                    // Dropped to 0: the character falls unconscious and starts dying.
                    character.dying = true;
                    character.deathSaves = { successes: 0, failures: 0 };
                    character = withCondition(character, 'Unconscious');
                    messages.push(systemMessage(`💔 **${character.name} falls!** You are unconscious at 0 HP and DYING. Each round, a death saving throw decides your fate — three successes stabilize you, three failures end your story.`));
                }
            } else if (prevHP === 0 && character.dying && action.payload > 0) {
                if (earlyDefeatProtected) {
                    character = applyEarlyDefeat(character);
                    messages.push(systemMessage('**Defeat deepens.** The hit worsens the setback, but low-level solo protection prevents a death-save spiral. The DM should turn this into capture, loss, leverage, or a narrow escape.'));
                    return { ...state, character, messages };
                }
                // Taking damage while dying counts as a death save failure.
                const failures = (character.deathSaves?.failures || 0) + 1;
                character.deathSaves = { ...(character.deathSaves || { successes: 0 }), failures };
                if (failures >= 3) {
                    character = applyDeath(character);
                    messages.push(systemMessage('**The blow proves fatal. Your character dies.**'));
                } else {
                    messages.push(systemMessage(`💔 **Struck while dying!** That counts as a death save failure (${failures}/3).`));
                }
            }

            return { ...state, character, messages };
        }

        case 'HEAL': {
            if (action.payload <= 0 || state.character.isDead) return state;
            const healed = Math.min(
                state.character.maxHP,
                Math.max(0, state.character.currentHP) + action.payload
            );
            let character = { ...state.character, currentHP: healed };
            const messages = [...state.messages];
            if (character.dying) {
                // Any healing brings a dying character back to consciousness.
                character = reviveCharacter(character);
                messages.push(systemMessage(`**${character.name} regains consciousness!** Healing pulls you back from the brink (${healed} HP).`));
            } else if (character.lowLevelDefeat && healed > 0) {
                character = reviveCharacter(character);
                messages.push(systemMessage(`**${character.name} comes around.** You are hurt, but the early defeat setback is over (${healed} HP).`));
            }
            return { ...state, character, messages };
        }

        case 'DEATH_SAVE_RESULT': {
            const character = state.character;
            if (!character?.dying || character.isDead) return state;
            if (isLowLevelSolo(character, state.party)) {
                return {
                    ...state,
                    character: applyEarlyDefeat(character),
                    messages: [
                        ...state.messages,
                        systemMessage('**Death save skipped.** Low-level solo protection converts this into a defeat setback instead of permanent death.'),
                    ],
                };
            }
            const die = action.payload.die;
            const prev = character.deathSaves || { successes: 0, failures: 0 };

            if (die === 20) {
                // Natural 20: back on your feet with 1 HP.
                const revived = reviveCharacter({ ...character, currentHP: 1 });
                return { ...state, character: revived };
            }
            if (die >= 10) {
                const successes = prev.successes + 1;
                if (successes >= 3) {
                    // Stable: unconscious at 0 HP, but no longer dying.
                    const stable = { ...character, dying: false, deathSaves: { successes: 0, failures: 0 } };
                    return { ...state, character: stable };
                }
                return { ...state, character: { ...character, deathSaves: { ...prev, successes } } };
            }
            const failures = prev.failures + (die === 1 ? 2 : 1);
            if (failures >= 3) {
                return { ...state, character: applyDeath(character) };
            }
            return { ...state, character: { ...character, deathSaves: { ...prev, failures } } };
        }

        case 'PLAYER_DEFEAT': {
            if (!state.character || state.character.isDead) return state;
            if (!isLowLevelSolo(state.character, state.party)) return state;
            const character = applyEarlyDefeat(state.character);
            const description = action.payload?.description
                || `${character.name} is defeated, but the story continues.`;
            return {
                ...state,
                character,
                messages: [
                    ...state.messages,
                    systemMessage(`**${description}**\n\nAt level ${character.level}, defeat becomes a story setback instead of permanent death. Expect capture, loss, bargaining, rescue, or a grim escape route.`),
                ],
            };
        }

        case 'TAKE_REST': {
            if (state.character.isDead) {
                return {
                    ...state,
                    messages: [...state.messages, systemMessage('The dead cannot recover by resting.')],
                };
            }
            if (state.combat.active) {
                return {
                    ...state,
                    messages: [...state.messages, systemMessage('You cannot take a short or long rest during active combat.')],
                };
            }

            const isLong = action.payload === 'long';
            const charClass = CLASSES[state.character.class];
            const conMod = getModifier(state.character.abilityScores?.constitution || 10);
            const hitDice = state.character.hitDice || { total: state.character.level, remaining: state.character.level, die: charClass?.hitDie || 8 };

            let healAmount;
            let newHitDice = { ...hitDice };

            if (isLong) {
                // Long rest: full HP restore, recover half hit dice (minimum 1)
                healAmount = state.character.maxHP;
                const recover = Math.max(1, Math.floor(hitDice.total / 2));
                newHitDice.remaining = Math.min(hitDice.total, hitDice.remaining + recover);
            } else {
                // Short rest: spend available hit dice to heal (auto-spend up to full)
                const canSpend = Math.min(newHitDice.remaining, Math.ceil((state.character.maxHP - state.character.currentHP) / ((hitDice.die / 2) + 1 + conMod || 1)));
                let rolled = 0;
                for (let i = 0; i < canSpend; i++) {
                    rolled += Math.max(1, rollDie(hitDice.die) + conMod);
                    newHitDice.remaining--;
                }
                healAmount = rolled;
            }

            const healed = Math.min(state.character.maxHP, state.character.currentHP + healAmount);

            // Reset class resources based on rest type
            const currentResources = state.character.classResources || {};
            const resourceDefs = charClass?.resources || {};
            const newResources = { ...currentResources };
            for (const [key, def] of Object.entries(resourceDefs)) {
                if (currentResources[key] && (isLong || def.resetOn === 'short')) {
                    newResources[key] = { ...currentResources[key], used: 0 };
                }
            }

            // Long Rests clear common minor conditions
            let currentConditions = state.character.conditions || [];
            if (isLong) {
                currentConditions = currentConditions.filter(c =>
                    !['exhausted', 'poisoned', 'blinded', 'deafened'].includes(c.toLowerCase())
                );
            }
            const clearsEarlyDefeat = state.character.lowLevelDefeat && healed > 0;
            if (clearsEarlyDefeat) {
                currentConditions = currentConditions.filter(c => c.toLowerCase() !== 'unconscious');
            }

            // Build rest message
            const healedAmount = healed - state.character.currentHP;
            const restMsg = {
                id: `msg-${Date.now()}-rest`,
                timestamp: Date.now(),
                role: 'system',
                content: isLong
                    ? `**Long Rest** — Fully restored to ${healed} HP. Hit dice recovered. All abilities recharged.${currentConditions.length < (state.character.conditions || []).length ? ' Conditions cleared.' : ''}`
                    : `**Short Rest** — Recovered ${healedAmount} HP (now ${healed}/${state.character.maxHP}). Short-rest abilities recharged. Hit dice remaining: ${newHitDice.remaining}/${newHitDice.total}.`,
                ...(action.meta?.narrate && {
                    narrationCue: {
                        type: 'player_mechanic',
                        mechanic: isLong ? 'Long Rest' : 'Short Rest',
                        actionType: 'rest',
                        effect: isLong
                            ? `${state.character.name} completes a long rest, recovers fully, and recharges their abilities`
                            : `${state.character.name} completes a short rest, regains ${healedAmount} HP, and recharges short-rest abilities`,
                    },
                }),
            };

            return {
                ...state,
                character: healed > 0 ? reviveCharacter({
                    ...state.character,
                    currentHP: healed,
                    lowLevelDefeat: clearsEarlyDefeat ? false : state.character.lowLevelDefeat,
                    deathSaves: clearsEarlyDefeat ? { successes: 0, failures: 0 } : state.character.deathSaves,
                    conditions: currentConditions,
                    classResources: newResources,
                    hitDice: newHitDice,
                    pendingActionSurge: false,
                }) : {
                    ...state.character,
                    currentHP: healed,
                    conditions: currentConditions,
                    classResources: newResources,
                    hitDice: newHitDice,
                    pendingActionSurge: false,
                },
                party: (state.party || []).map(companion => {
                    if (companion.status === 'dead') return companion;
                    const maxHp = companion.maxHp || companion.hp || 1;
                    const companionHp = isLong
                        ? maxHp
                        : Math.min(maxHp, (companion.hp || 0) + Math.max(1, Math.ceil(maxHp * 0.25)));
                    return normalizeCompanion({
                        hp: companionHp,
                        conditions: isLong ? [] : companion.conditions,
                        status: companionStatus(companionHp, maxHp),
                    }, companion);
                }),
                messages: [...state.messages, restMsg],
            };
        }

        case 'ADD_EXP': {
            const result = awardExperience(state.character, action.payload, {
                reason: action.reason,
            });
            return {
                ...state,
                character: result.character,
                messages: [...state.messages, ...result.messages],
                // Remember XP was earned mid-fight so the manual End-Combat fallback won't re-award.
                combat: state.combat.active ? { ...state.combat, xpAwarded: true } : state.combat,
            };
        }


        case 'ADD_CONDITION': {
            const existing = state.character.conditions || [];
            if (existing.includes(action.payload)) return state;
            return {
                ...state,
                character: { ...state.character, conditions: [...existing, action.payload] },
            };
        }

        case 'REMOVE_CONDITION': {
            const existing = state.character.conditions || [];
            return {
                ...state,
                character: { ...state.character, conditions: existing.filter(c => c !== action.payload) },
            };
        }

        case 'USE_RESOURCE': {
            // action.payload = resource key (e.g. 'secondWind', 'actionSurge')
            const resKey = action.payload;
            const resources = state.character.classResources || {};
            const res = resources[resKey];
            if (!res || res.used >= res.max) {
                const label = res?.label || resKey;
                return {
                    ...state,
                    messages: [
                        ...state.messages,
                        {
                            id: `msg-${Date.now()}-resource-unavailable`,
                            timestamp: Date.now(),
                            role: 'system',
                            content: `**${label} unavailable** — it has already been used and must be recharged by rest.`,
                        },
                    ],
                };
            }

            const label = res.label || resKey;

            return {
                ...state,
                character: {
                    ...state.character,
                    classResources: {
                        ...resources,
                        [resKey]: { ...res, used: res.used + 1 },
                    },
                },
                messages: [
                    ...state.messages,
                    {
                        id: `msg-${Date.now()}-resource-used`,
                        timestamp: Date.now(),
                        role: 'system',
                        content: `**${label} used** — ${res.max - res.used - 1}/${res.max} remaining until rest.`,
                    },
                ],
            };
        }

        case 'ACTIVATE_RESOURCE': {
            // Player-initiated class ability. The engine marks it spent and applies any
            // mechanical effect (rolling real dice). The system message informs the DM,
            // which then narrates the moment without emitting resources_used itself.
            const resKey = action.payload;
            const charClass = CLASSES[state.character.class];
            const def = charClass?.resources?.[resKey];
            const resources = state.character.classResources || {};
            const res = resources[resKey];
            if (!def || !res) return state;

            if (resKey === 'actionSurge') {
                const unableToAct = state.character.isDead
                    || state.character.dying
                    || state.character.lowLevelDefeat
                    || (state.character.currentHP ?? 0) <= 0;
                if (!state.combat.active || !isPlayerCombatTurn(state.combat) || unableToAct) {
                    return {
                        ...state,
                        messages: [...state.messages, systemMessage(`**${def.label}** can only be activated while you can act on your combat turn.`)],
                    };
                }
                if (state.character.pendingActionSurge) {
                    return {
                        ...state,
                        messages: [...state.messages, systemMessage(`**${def.label}** is already active. Commit both action slots before trying to use it again.`)],
                    };
                }
            }

            const usesBonusAction = def.actionType === 'bonus';
            if (usesBonusAction && state.combat.active && !isPlayerCombatTurn(state.combat)) {
                return {
                    ...state,
                    messages: [...state.messages, systemMessage(`**${def.label}** is a bonus action — use it on your turn.`)],
                };
            }
            if (usesBonusAction && state.combat.active && state.combat.bonusActionUsed) {
                return {
                    ...state,
                    messages: [...state.messages, systemMessage(`**Bonus action already used** — ${def.label} can wait until your next turn.`)],
                };
            }

            if (res.used >= res.max) {
                return {
                    ...state,
                    messages: [...state.messages, systemMessage(`**${def.label}** is spent — recharge it on a ${def.resetOn} rest.`)],
                };
            }

            const remaining = res.max - res.used - 1;
            const spentResources = { ...resources, [resKey]: { ...res, used: res.used + 1 } };
            const tail = `${remaining}/${res.max} left until ${def.resetOn} rest.`;

            // Resource with a mechanical heal (Fighter's Second Wind): roll real dice and heal.
            if (def.effect?.kind === 'heal') {
                const roll = rollNotation(def.effect.dice || '1d10', def.label);
                const bonus = def.effect.addLevel ? (state.character.level || 0) : 0;
                const healed = Math.min(state.character.maxHP, state.character.currentHP + roll.total + bonus);
                const gained = healed - state.character.currentHP;
                const healedCharacter = healed > 0
                    ? reviveCharacter({ ...state.character, currentHP: healed, classResources: spentResources })
                    : { ...state.character, currentHP: healed, classResources: spentResources };
                return {
                    ...state,
                    character: healedCharacter,
                    combat: usesBonusAction && state.combat.active
                        ? { ...state.combat, bonusActionUsed: true }
                        : state.combat,
                    rollHistory: [...state.rollHistory, roll],
                    messages: [
                        ...state.messages,
                        systemMessage(
                            `**${def.label}**${usesBonusAction ? ' *(bonus action)*' : ''} — you recover **${gained} HP** (now ${healed}/${state.character.maxHP}). ${usesBonusAction && state.combat.active ? 'Your main action is still available. ' : ''}${tail} ${def.effect.dice}${bonus ? `+${bonus}` : ''}: ${roll.rolls.join(', ')}`,
                            {
                                narrationCue: {
                                    type: 'player_mechanic',
                                    mechanic: def.label,
                                    effect: `recovered ${gained} HP`,
                                    actionType: usesBonusAction ? 'bonus action' : 'action',
                                },
                            }
                        ),
                    ],
                };
            }

            // Narrative resource (Action Surge, Channel Divinity, Arcane Recovery): mark
            // it spent, describe it, and let the DM narrate the effect.
            const pendingPayload = resKey === 'actionSurge' ? { pendingActionSurge: true } : {};
            return {
                ...state,
                character: { ...state.character, classResources: spentResources, ...pendingPayload },
                combat: usesBonusAction && state.combat.active
                    ? { ...state.combat, bonusActionUsed: true }
                    : state.combat,
                messages: [...state.messages, systemMessage(`**${def.label}** — ${def.description}. ${tail}`)],
            };
        }

        case 'LEVEL_UP': {
            const result = awardExperience(state.character, action.payload?.bonusExp || 0, {
                milestoneLevelUp: true,
                reason: action.payload?.reason || 'milestone',
            });
            return {
                ...state,
                character: result.character,
                messages: [...state.messages, ...result.messages],
                combat: state.combat.active ? { ...state.combat, xpAwarded: true } : state.combat,
            };
        }


        // --- Inventory ---
        case 'ADD_ITEM': {
            const newItem = {
                id: `item-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
                equipped: false,
                quantity: 1,
                ...normalizeItem(action.payload),
            };
            // Auto-equip armor/shields if no other of that type is currently equipped
            if (!newItem.equipped) {
                const isArmor = newItem.type === 'armor' && !newItem.isShield;
                const isShield = newItem.type === 'shield' || newItem.isShield;
                const hasEquippedTwoHandedWeapon = state.inventory.some(i => i.equipped && i.type === 'weapon' && i.twoHanded);
                if (isArmor && !state.inventory.some(i => i.equipped && i.type === 'armor' && !i.isShield)) {
                    newItem.equipped = true;
                }
                if (isShield && !hasEquippedTwoHandedWeapon && !state.inventory.some(i => i.equipped && (i.type === 'shield' || i.isShield))) {
                    newItem.equipped = true;
                }
            }
            return withInventoryAndAC(state, normalizeEquippedSlots([...state.inventory, newItem], newItem.equipped ? newItem.id : null));
        }

        case 'PURCHASE_ITEM': {
            const transaction = buildPurchaseTransaction(action.payload);
            const { item, quantity, priceCp } = transaction;
            const meta = action.payload?._meta || {};
            const sourceId = String(meta.sourceId || '').slice(0, 160);
            const duplicate = findRecentTransactionDuplicate(state.recentPurchases, transaction, sourceId, currentMessageIndex(state));
            const exactSourceReplay = !!sourceId && duplicate?.sourceId === sourceId;
            if (duplicate && (exactSourceReplay || !playerMessageSupportsRepeatTransaction(item, meta.playerMessage, PURCHASE_VERB_RE))) {
                return {
                    ...state,
                    recentPurchases: rememberTransaction(state.recentPurchases, transaction, sourceId, currentMessageIndex(state), 'ignored'),
                    messages: [
                        ...state.messages,
                        systemMessage(`Duplicate purchase ignored — ${item.name} was already bought recently.`),
                    ],
                };
            }
            const payment = spendCurrency(state.character, priceCp);
            if (!payment.paid) {
                return {
                    ...state,
                    messages: [
                        ...state.messages,
                        systemMessage(`Cannot buy ${item.name} — price is ${formatCurrency(priceCp)}, missing ${formatCurrency(payment.missingCp)}.`),
                    ],
                };
            }

            const newItem = {
                id: `item-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
                equipped: false,
                ...item,
                quantity,
            };

            const nextState = {
                ...state,
                character: payment.character,
                recentPurchases: rememberTransaction(state.recentPurchases, transaction, sourceId, currentMessageIndex(state)),
                messages: [
                    ...state.messages,
                    systemMessage(`Bought ${quantity > 1 ? `${quantity}x ` : ''}${item.name} for ${formatCurrency(priceCp)}.`),
                ],
            };
            return withInventoryAndAC(nextState, [...state.inventory, newItem]);
        }

        case 'USE_ITEM': {
            // Player-initiated consumable use. The engine owns the dice and HP; the
            // resulting system message also informs the DM (it enters the LLM history),
            // so the DM narrates the act on its next turn without re-applying anything.
            const item = state.inventory.find(i => i.id === action.payload);
            if (!item) return state;
            const usesBonusAction = isBonusActionConsumable(item);

            // Healing consumables resolve fully client-side with real dice.
            if (item.consumableType === 'healing' && item.healing) {
                if (state.character.isDead) {
                    return {
                        ...state,
                        messages: [...state.messages, systemMessage(`The ${item.name} cannot help the dead.`)],
                    };
                }
                if (state.character.currentHP >= state.character.maxHP) {
                    return {
                        ...state,
                        messages: [...state.messages, systemMessage(`You're already at full health — you keep the ${item.name}.`)],
                    };
                }
                if (usesBonusAction && state.combat.active && !isPlayerCombatTurn(state.combat)) {
                    return {
                        ...state,
                        messages: [...state.messages, systemMessage(`**${item.name}** is a bonus action — drink it on your turn.`)],
                    };
                }
                if (usesBonusAction && state.combat.active && state.combat.bonusActionUsed) {
                    return {
                        ...state,
                        messages: [...state.messages, systemMessage(`**Bonus action already used** — ${item.name} can wait until your next turn.`)],
                    };
                }
                const roll = rollNotation(item.healing, item.name);
                const healed = Math.min(state.character.maxHP, state.character.currentHP + roll.total);
                const gained = healed - state.character.currentHP;
                const healedCharacter = healed > 0
                    ? reviveCharacter({ ...state.character, currentHP: healed })
                    : { ...state.character, currentHP: healed };
                return {
                    ...state,
                    character: healedCharacter,
                    combat: usesBonusAction && state.combat.active
                        ? { ...state.combat, bonusActionUsed: true }
                        : state.combat,
                    inventory: consumeItem(state.inventory, item.id),
                    rollHistory: [...state.rollHistory, roll],
                    messages: [
                        ...state.messages,
                        systemMessage(
                            `You drink a **${item.name}**${usesBonusAction ? ' *(bonus action)*' : ''} and recover **${gained} HP** (now ${healed}/${state.character.maxHP}). ${usesBonusAction && state.combat.active ? 'Your main action is still available. ' : ''}${item.healing}: ${roll.rolls.join(', ')}${roll.modifier ? ` (+${roll.modifier})` : ''}`,
                            {
                                narrationCue: {
                                    type: 'player_mechanic',
                                    mechanic: item.name,
                                    effect: `recovered ${gained} HP`,
                                    actionType: usesBonusAction ? 'bonus action' : 'action',
                                },
                            }
                        ),
                    ],
                };
            }

            // Other consumables have narrative effects — consume one and let the DM react.
            if (item.type === 'consumable') {
                return {
                    ...state,
                    inventory: consumeItem(state.inventory, item.id),
                    messages: [...state.messages, systemMessage(`🧴 You use a **${item.name}**.`)],
                };
            }

            return state;
        }

        case 'SELL_ITEM': {
            // Atomic sale (DM-driven, at a merchant). Find the item, remove the sold
            // quantity, and add the proceeds. Default proceeds are half the catalog value
            // per unit; the DM may override priceCp (total) to model haggling, a stingy
            // fence, or a motivated buyer.
            const payload = action.payload || {};
            const ref = payload.itemId || payload.itemKey || payload.name || '';
            const lc = String(ref).toLowerCase();
            const item = state.inventory.find(i =>
                (payload.itemId && i.id === payload.itemId) ||
                (payload.itemKey && i.itemKey === payload.itemKey) ||
                (i.name && i.name.toLowerCase() === lc)
            );
            if (!item) {
                return {
                    ...state,
                    messages: [...state.messages, systemMessage(`Can't sell "${ref}" — it's not in your inventory.`)],
                };
            }

            const quantity = Math.max(1, Math.min(item.quantity || 1, payload.quantity || 1));
            const proceedsCp = Number.isFinite(payload.priceCp)
                ? Math.max(0, Math.trunc(payload.priceCp))
                : Math.floor((item.valueCp || 0) / 2) * quantity;

            // Sales get the same one-shot replay protection as purchases: a re-emitted
            // sell event must not remove the item twice or pay out twice.
            const saleTransaction = {
                item: { itemKey: item.itemKey, name: item.name },
                quantity,
                priceCp: proceedsCp,
                signature: `${normalizeItemKey(item.itemKey || item.name) || normalizeRefToken(item.name)}|${quantity}|${proceedsCp}`,
            };
            const saleMeta = payload._meta || {};
            const saleSourceId = String(saleMeta.sourceId || '').slice(0, 160);
            const saleDuplicate = findRecentTransactionDuplicate(state.recentSales, saleTransaction, saleSourceId, currentMessageIndex(state));
            const exactSaleReplay = !!saleSourceId && saleDuplicate?.sourceId === saleSourceId;
            if (saleDuplicate && (exactSaleReplay || !playerMessageSupportsRepeatTransaction(item, saleMeta.playerMessage, SALE_VERB_RE))) {
                return {
                    ...state,
                    recentSales: rememberTransaction(state.recentSales, saleTransaction, saleSourceId, currentMessageIndex(state), 'ignored'),
                    messages: [
                        ...state.messages,
                        systemMessage(`Duplicate sale ignored — ${item.name} was already sold recently.`),
                    ],
                };
            }

            const nextState = {
                ...state,
                character: addCurrency(state.character, { copper: proceedsCp }),
                recentSales: rememberTransaction(state.recentSales, saleTransaction, saleSourceId, currentMessageIndex(state)),
                messages: [
                    ...state.messages,
                    systemMessage(`Sold ${quantity > 1 ? `${quantity}x ` : ''}${item.name} for ${formatCurrency(proceedsCp)}.`),
                ],
            };
            return withInventoryAndAC(nextState, consumeItem(state.inventory, item.id, quantity));
        }

        case 'REMOVE_ITEM': {
            return withInventoryAndAC(state, state.inventory.filter(item => item.id !== action.payload));
        }

        case 'REMOVE_ITEM_BY_NAME': {
            const nameToRemove = (action.payload || '').toLowerCase();
            const matchToRemove = state.inventory.find(i => i.name?.toLowerCase() === nameToRemove);
            if (!matchToRemove) {
                console.warn(`[Reducer] Could not find item to remove by name: "${action.payload}"`);
                return state;
            }
            return withInventoryAndAC(state, state.inventory.filter(i => i.id !== matchToRemove.id));
        }

        case 'UPDATE_ITEM':
            return {
                ...state,
                inventory: state.inventory.map(item =>
                    item.id === action.payload.id ? { ...item, ...action.payload } : item
                ),
            };

        case 'EQUIP_ITEM': {
            const itemToEquip = state.inventory.find(i => i.id === action.payload);
            if (!itemToEquip || !isEquippableItem(itemToEquip)) return state;

            const updatedInv = state.inventory.map(item => {
                if (item.id === action.payload) return { ...item, equipped: true };
                return item;
            });

            return withInventoryAndAC(state, normalizeEquippedSlots(updatedInv, action.payload));
        }

        case 'EQUIP_ITEM_BY_REF': {
            const item = findInventoryItemByRef(state.inventory, action.payload);
            return item
                ? gameReducer(state, { type: 'EQUIP_ITEM', payload: item.id })
                : state;
        }

        case 'UNEQUIP_ITEM': {
            const updatedInvUneq = state.inventory.map(item =>
                item.id === action.payload ? { ...item, equipped: false } : item
            );
            return withInventoryAndAC(state, updatedInvUneq);
        }

        case 'UNEQUIP_ITEM_BY_REF': {
            const item = findInventoryItemByRef(state.inventory, action.payload, { preferEquipped: true });
            return item
                ? gameReducer(state, { type: 'UNEQUIP_ITEM', payload: item.id })
                : state;
        }

        // --- Messages ---
        case 'ADD_MESSAGE':
            return {
                ...state,
                messages: [...state.messages, {
                    id: action.payload.id || `msg-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
                    timestamp: Date.now(),
                    ...action.payload,
                }],
            };

        case 'CLAIM_LOOT_SOURCE': {
            const sourceId = action.payload;
            if (!sourceId || (state.appliedLootSourceIds || []).includes(sourceId)) return state;
            const updated = [...(state.appliedLootSourceIds || []), sourceId];
            return { ...state, appliedLootSourceIds: updated.slice(-500) };
        }

        case 'UPDATE_LAST_MESSAGE':
            return {
                ...state,
                messages: state.messages.map((msg, idx) =>
                    idx === state.messages.length - 1 ? { ...msg, ...action.payload } : msg
                ),
            };

        case 'PROPOSE_ROLEPLAY_CHECK': {
            if (state.combat?.active) return state;
            const pendingRoleplayCheck = sanitizePendingRoleplayCheck(action.payload);
            return pendingRoleplayCheck ? { ...state, pendingRoleplayCheck } : state;
        }

        case 'CLEAR_ROLEPLAY_CHECK':
            return state.pendingRoleplayCheck ? { ...state, pendingRoleplayCheck: null } : state;

        // Record a roleplay-check ruling that ended without dice (withdrawn after a
        // challenge, or set aside via Change Approach) so the prompt can bind the DM
        // to its own recent table history instead of re-adjudicating from scratch.
        case 'RECORD_ROLL_RULING': {
            const ruling = normalizeRollRuling(action.payload);
            if (!ruling) return state;
            return {
                ...state,
                recentRulings: [...(state.recentRulings || []), ruling].slice(-RECENT_RULING_LIMIT),
            };
        }

        // Un-hide a withheld roll-setup narration when no dice will ever supersede it
        // (the player changed approach). Once revealed, the text is player-visible AND
        // back in the DM's history window, so its fiction stays canon.
        case 'REVEAL_MESSAGE': {
            const messageId = action.payload?.id;
            if (!messageId) return state;
            let revealed = false;
            const messages = state.messages.map(msg => {
                if (msg.id !== messageId || !msg.hidden || !msg.content?.trim()) return msg;
                revealed = true;
                return { ...msg, hidden: false, revealedSetup: true };
            });
            return revealed ? { ...state, messages } : state;
        }

        // --- Dice Rolls ---
        case 'ADD_ROLL':
            return {
                ...state,
                rollHistory: [...state.rollHistory, action.payload],
            };

        // --- Quests ---
        case 'ADD_QUEST': {
            const payload = action.payload || {};
            const nameToken = normalizeRefToken(payload.name);
            const existing = state.quests.find(quest =>
                quest.status === 'active' && (
                    (payload.id && quest.id === payload.id) ||
                    (nameToken && normalizeRefToken(quest.name) === nameToken)
                )
            );
            if (existing) {
                return {
                    ...state,
                    quests: state.quests.map(quest => quest.id === existing.id
                        ? {
                            ...quest,
                            name: payload.name || quest.name,
                            description: payload.description || quest.description,
                        }
                        : quest),
                };
            }
            return {
                ...state,
                quests: [...state.quests, {
                    id: payload.id || `quest-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
                    status: 'active',
                    addedAt: Date.now(),
                    ...payload,
                }],
            };
        }

        case 'COMPLETE_QUEST': {
            const ref = action.payload || '';
            const refId = typeof ref === 'object' ? ref.id : ref;
            const refName = typeof ref === 'object' ? ref.name : ref;
            const nameToken = normalizeRefToken(refName);
            return {
                ...state,
                quests: state.quests.map(q =>
                    q.id === refId || (nameToken && normalizeRefToken(q.name) === nameToken)
                        ? { ...q, status: 'completed' }
                        : q
                ),
            };
        }

        case 'FAIL_QUEST': {
            const ref = action.payload || '';
            const refId = typeof ref === 'object' ? ref.id : ref;
            const refName = typeof ref === 'object' ? ref.name : ref;
            const nameToken = normalizeRefToken(refName);
            return {
                ...state,
                quests: state.quests.map(q =>
                    q.id === refId || (nameToken && normalizeRefToken(q.name) === nameToken)
                        ? { ...q, status: 'failed' }
                        : q
                ),
            };
        }

        case 'REMOVE_QUEST':
            return {
                ...state,
                quests: state.quests.filter(q => q.id !== action.payload),
            };

        // --- World Facts ---
        case 'ADD_WORLD_FACT': {
            const fact = {
                id: `fact-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
                timestamp: Date.now(),
                category: 'general',
                ...action.payload,
            };
            const existingSets = state.worldFacts.map(f => factTokenSet(f.fact));
            if (isNearDuplicateFact(fact.fact, existingSets)) return state;
            return { ...state, worldFacts: [...state.worldFacts, fact] };
        }

        case 'ADD_WORLD_FACTS': {
            // Bulk add, rejecting exact and near-duplicate restatements of known facts
            // (the Scribe tends to re-canonize the same truth with slight rewording).
            const existingSets = state.worldFacts.map(f => factTokenSet(f.fact));
            const newFacts = [];
            for (const f of action.payload || []) {
                if (!f?.fact || isNearDuplicateFact(f.fact, existingSets)) continue;
                existingSets.push(factTokenSet(f.fact));
                newFacts.push({
                    id: `fact-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
                    timestamp: Date.now(),
                    category: 'general',
                    ...f,
                });
            }
            if (newFacts.length === 0) return state;
            return { ...state, worldFacts: [...state.worldFacts, ...newFacts] };
        }

        case 'REMOVE_WORLD_FACT':
            return { ...state, worldFacts: state.worldFacts.filter(f => f.id !== action.payload) };

        // --- Story Memory ---
        case 'ADD_STORY_MEMORY_CARD': {
            const card = normalizeStoryMemoryCard(action.payload);
            if (!card) return state;
            const idx = findStoryMemoryMatch(state.storyMemory || [], card);
            if (idx === -1) {
                return { ...state, storyMemory: [...(state.storyMemory || []), card] };
            }
            const existing = state.storyMemory[idx];
            return {
                ...state,
                storyMemory: state.storyMemory.map((memory, i) => i === idx
                    ? normalizeStoryMemoryCard({
                        ...existing,
                        ...card,
                        text: pickMergedCardText(existing.text, card.text),
                        firstSeenAt: existing.firstSeenAt,
                        lastSeenAt: Date.now(),
                        salience: Math.max(existing.salience || 1, card.salience || 1),
                        emotionalCharge: Math.max(existing.emotionalCharge || 0, card.emotionalCharge || 0),
                        tags: [...new Set([...(existing.tags || []), ...(card.tags || [])])],
                        linkedNpcNames: [...new Set([...(existing.linkedNpcNames || []), ...(card.linkedNpcNames || [])])],
                    }, existing)
                    : memory),
            };
        }

        case 'ADD_STORY_MEMORY_CARDS': {
            let next = state;
            for (const card of action.payload || []) {
                next = gameReducer(next, { type: 'ADD_STORY_MEMORY_CARD', payload: card });
            }
            return next;
        }

        case 'UPDATE_STORY_MEMORY': {
            const update = normalizeStoryMemoryUpdate(action.payload);
            if (!update) return state;
            const idx = (state.storyMemory || []).findIndex(memory =>
                (update.id && memory.id === update.id) ||
                (update.subject && memory.subject?.toLowerCase() === update.subject.toLowerCase()) ||
                (update.text && memory.text?.toLowerCase() === update.text.toLowerCase())
            );
            if (idx === -1) return state;
            return {
                ...state,
                storyMemory: state.storyMemory.map((memory, i) => i === idx
                    ? normalizeStoryMemoryCard({ ...memory, ...update, lastSeenAt: Date.now() }, memory)
                    : memory),
            };
        }

        // --- Hidden campaign fronts ---
        case 'INITIALIZE_FRONTS': {
            if ((state.fronts || []).length > 0) return state;
            const fronts = createInitialFronts({
                premise: action.payload?.premise || state.session?.premise || '',
                character: state.character,
                location: state.currentLocation,
            });
            return { ...state, fronts };
        }

        case 'INSTALL_GENERATED_FRONTS': {
            if (action.payload?.sessionId !== state.session?.id
                || state.session?.frontDirector?.version >= FRONTS_VERSION
                || !Array.isArray(action.payload?.fronts)) return state;
            // Generation runs on the slow DM model while play continues, so the
            // result routinely lands after the opening exchange. A late install is
            // safe as long as the deterministic fallback front hasn't started
            // moving — once it has clock/stage history, keep it (2026-07-14 eval).
            const visibleCount = (state.messages || []).filter(message => !message.hidden).length;
            const existingFronts = state.fronts || [];
            const untouchedFallback = existingFronts.length === 0
                || (existingFronts.length === 1
                    && existingFronts[0].id === 'front-local-pressure'
                    && !(existingFronts[0].clock > 0)
                    && !(existingFronts[0].stage > 0));
            if (visibleCount > 2 && !untouchedFallback) return state;
            const fronts = action.payload.fronts.slice(0, 3).map(front => normalizeFront(front));
            if (fronts.length < 2) return state;
            return {
                ...state,
                fronts,
                session: {
                    ...state.session,
                    frontDirector: {
                        version: FRONTS_VERSION,
                        generationVersion: FRONTS_VERSION,
                        source: 'campaign-creation',
                        generatedAt: Date.now(),
                        lastJournalEnd: 0,
                    },
                },
            };
        }

        case 'MIGRATE_FRONTS': {
            if (state.session?.frontMigration?.version >= 1 || !Array.isArray(action.payload?.fronts) || action.payload.fronts.length === 0) {
                return state;
            }
            const existingFronts = state.fronts || [];
            const existingIds = new Set(existingFronts.map(front => front.id).filter(Boolean));
            const existingTitles = new Set(existingFronts.map(front => front.title?.toLowerCase()).filter(Boolean));
            const additions = action.payload.fronts
                .filter(front => !existingIds.has(front.id) && !existingTitles.has(front.title?.toLowerCase()))
                .slice(0, Math.max(0, 3 - existingFronts.length))
                .map(front => normalizeFront(front));
            if (additions.length === 0) return state;
            return {
                ...state,
                fronts: [...existingFronts, ...additions],
                session: {
                    ...state.session,
                    frontMigration: {
                        version: 1,
                        migratedAt: Date.now(),
                        contextCounts: action.payload.counts || {},
                    },
                    frontDirector: {
                        ...state.session?.frontDirector,
                        version: FRONTS_VERSION,
                        source: 'contextual-migration',
                        generatedAt: Date.now(),
                        lastJournalEnd: state.session?.frontDirector?.lastJournalEnd || 0,
                    },
                },
                messages: [
                    ...state.messages,
                    systemMessage('**The living world awakens.** Hidden pressures now grow from this campaign’s established history. Their details remain private; you will encounter only their in-world signs, choices, and consequences.'),
                ],
            };
        }

        case 'UPGRADE_FRONTS_V2': {
            if (action.payload?.sessionId !== state.session?.id
                || state.session?.frontDirector?.generationVersion >= FRONTS_VERSION
                || !Array.isArray(action.payload?.enrichments)
                || !Array.isArray(action.payload?.newFronts)) return state;
            const existingFronts = state.fronts || [];
            const enrichmentById = new Map(action.payload.enrichments
                .filter(entry => entry?.id && entry?.faction?.name && entry?.faction?.goal)
                .map(entry => [entry.id, entry.faction]));
            const enriched = existingFronts.map(front => enrichmentById.has(front.id)
                ? normalizeFront({ ...front, faction: enrichmentById.get(front.id) }, front)
                : front);
            if (enriched.some(front => !front.faction?.name || !front.faction?.goal)) return state;

            const existingIds = new Set(enriched.map(front => front.id));
            const existingTitles = new Set(enriched.map(front => front.title?.toLowerCase()).filter(Boolean));
            const additions = action.payload.newFronts
                .filter(front => front?.id && front?.title && front?.goal && front?.stakes
                    && Array.isArray(front?.grimPortents) && front.grimPortents.length >= 3
                    && front?.faction?.name && front?.faction?.goal
                    && !existingIds.has(front.id) && !existingTitles.has(front.title.toLowerCase()))
                .slice(0, Math.max(0, 3 - enriched.length))
                .map(front => normalizeFront(front));
            const fronts = [...enriched, ...additions];
            if (fronts.length < 2 || fronts.length > 3) return state;

            return {
                ...state,
                fronts,
                session: {
                    ...state.session,
                    frontDirector: {
                        ...state.session?.frontDirector,
                        version: FRONTS_VERSION,
                        generationVersion: FRONTS_VERSION,
                        source: 'existing-campaign-upgrade',
                        upgradedAt: Date.now(),
                        contextCounts: action.payload.counts || {},
                        lastJournalEnd: state.session?.frontDirector?.lastJournalEnd || state.session?.prunedMessageCount || 0,
                    },
                },
            };
        }

        case 'UPDATE_FRONT': {
            const update = normalizeFrontUpdate(action.payload);
            if (!update) return state;
            const fronts = state.fronts || [];
            const idx = fronts.findIndex(f => f.id === update.id || f.title?.toLowerCase() === update.title?.toLowerCase());
            if (idx === -1) return state;
            const existing = fronts[idx];
            const boundedUpdate = {
                ...update,
                ...(update.clock !== undefined && {
                    clock: Math.max((existing.clock || 0) - 1, Math.min((existing.clock || 0) + 1, update.clock)),
                }),
                ...(update.stage !== undefined && {
                    stage: Math.max((existing.stage || 0) - 1, Math.min((existing.stage || 0) + 1, update.stage)),
                }),
                maxClock: existing.maxClock || 6,
            };
            return {
                ...state,
                fronts: fronts.map((front, i) => i === idx ? normalizeFront(boundedUpdate, front) : front),
            };
        }

        case 'APPLY_FRONT_ADVANCE_BATCH': {
            const cadenceId = String(action.payload?.cadenceId || '').trim().slice(0, 160);
            const journalEnd = Math.max(0, Math.round(Number(action.payload?.journalEnd) || 0));
            const previousEnd = state.session?.frontDirector?.lastJournalEnd || 0;
            if (!cadenceId || journalEnd <= previousEnd) return state;
            const result = applyFrontAdvanceBatch(state.fronts || [], {
                cadenceId,
                previousCadenceId: state.session?.frontDirector?.lastCadenceId || null,
                advances: action.payload?.advances,
            });
            return {
                ...state,
                fronts: result.fronts,
                session: {
                    ...state.session,
                    frontDirector: {
                        ...state.session?.frontDirector,
                        version: FRONTS_VERSION,
                        lastCadenceId: cadenceId,
                        lastJournalEnd: journalEnd,
                        lastProcessedAt: Date.now(),
                        lastAppliedCount: result.appliedCount,
                    },
                },
            };
        }

        // Mark a batch of messages as summarized (excluded from future LLM history)
        case 'MARK_MESSAGES_SUMMARIZED': {
            // action.payload = index up to which messages are now summarized
            const upTo = action.payload;
            return {
                ...state,
                messages: state.messages.map((msg, idx) =>
                    idx < upTo ? { ...msg, summarized: true } : msg
                ),
                session: { ...state.session, prunedMessageCount: upTo },
            };
        }

        // --- Journal & NPCs ---
        case 'ADD_JOURNAL_ENTRY':
            return {
                ...state,
                journal: [...state.journal, {
                    id: action.payload.id || `journal-${Date.now()}`,
                    timestamp: action.payload.timestamp || Date.now(),
                    ...action.payload,
                }],
            };

        // ADD_NPC and UPDATE_NPC are the same operation: upsert by id or name (see
        // upsertNpc). Keeping one create/merge path means the per-turn Scribe and the
        // DM's inline npc_updates can introduce a brand-new NPC the instant it appears,
        // instead of being silently dropped until the next journal pass.
        case 'ADD_NPC':
        case 'UPDATE_NPC': {
            const nextNpcs = upsertNpc(state.npcs, action.payload);
            if (nextNpcs === state.npcs) return state;
            const touched = findTouchedNpc(nextNpcs, action.payload);
            let storyMemory = state.storyMemory || [];
            if (touched) {
                const promotion = buildStoryMemoryPromotion(touched);
                if (promotion) {
                    const idx = findStoryMemoryMatch(storyMemory, promotion);
                    if (idx === -1) {
                        const card = normalizeStoryMemoryCard(promotion);
                        if (card) storyMemory = [...storyMemory, card];
                    } else {
                        storyMemory = storyMemory.map((card, i) => (
                            i === idx ? normalizeStoryMemoryCard({ ...promotion, id: card.id }, card) : card
                        ));
                    }
                }
            }
            return { ...state, npcs: nextNpcs, storyMemory };
        }

        case 'PIN_NPC':
            return {
                ...state,
                npcs: (state.npcs || []).map(npc => (
                    npc.id === action.payload?.id
                        ? normalizeNpcRecord({
                            ...npc,
                            pinned: !!action.payload.pinned,
                            rosterTier: 'character',
                            importance: 5,
                        })
                        : npc
                )),
            };

        case 'ARCHIVE_NPC':
            return {
                ...state,
                npcs: (state.npcs || []).map(npc => (
                    npc.id === action.payload?.id
                        ? normalizeNpcRecord({ ...npc, rosterTier: 'archived_creature', kind: 'creature', pinned: false })
                        : npc
                )),
            };

        case 'MIGRATE_NPC_ROSTER': {
            const needsMigration = (state.npcs || []).some(npc => !npc.rosterTier);
            if (!needsMigration) return state;
            return { ...state, npcs: (state.npcs || []).map(npc => migrateLegacyNpc(npc)) };
        }

        case 'ARCHIVE_NPC_BULK': {
            const ids = action.payload?.ids || [];
            if (ids.length === 0) return state;
            return { ...state, npcs: archiveNpcBulk(state.npcs, ids) };
        }

        case 'ARCHIVE_GENERIC_FODDER': {
            const fodder = listArchivableFodder(state.npcs || []);
            if (fodder.length === 0) return state;
            const ids = new Set(fodder.map(npc => npc.id));
            return {
                ...state,
                npcs: state.npcs.map(npc => (
                    ids.has(npc.id)
                        ? normalizeNpcRecord({ ...npc, rosterTier: 'archived_creature', kind: 'creature', pinned: false })
                        : npc
                )),
            };
        }

        case 'SET_LOCATION':
            return { ...state, currentLocation: action.payload };

        // --- Party / Companions ---
        case 'ADD_COMPANION': {
            // Check if already in party
            const party = state.party || [];
            const name = String(action.payload?.name || '').toLowerCase();
            if (party.find(c => c.id === action.payload?.id || c.name?.toLowerCase() === name)) return state;
            if (party.length >= MAX_PARTY_SIZE) {
                return {
                    ...state,
                    messages: [...state.messages, systemMessage(`The party is full (${MAX_PARTY_SIZE}/${MAX_PARTY_SIZE}). Someone must leave before another companion can join.`)],
                };
            }
            return {
                ...state,
                party: [...party, normalizeCompanion(action.payload)],
            };
        }

        case 'UPDATE_COMPANION':
            return {
                ...state,
                party: (state.party || []).map(companion =>
                    (companion.id === action.payload.id || companion.name === action.payload.name)
                        ? normalizeCompanion(action.payload, companion)
                        : companion
                ),
            };

        case 'REMOVE_COMPANION':
            return {
                ...state,
                party: (state.party || []).filter(c => c.name !== action.payload.name && c.id !== action.payload.id),
            };

        // --- Combat ---
        case 'START_COMBAT': {
            // Track exactly the enemies the DM declared — no count or HP trimming. Encounter
            // difficulty for low-level solo play is steered by the system prompt instead, so
            // the narrative and the tracked combatants always stay 1:1.
            const usedEnemyIds = new Set();
            const enemies = (Array.isArray(action.payload?.enemies) ? action.payload.enemies : [])
                .map((enemy, index) => normalizeCombatEnemy(enemy, index, usedEnemyIds));
            if (enemies.length === 0) return state;
            const dexMod = state.character?.abilityScores
                ? getModifier(state.character.abilityScores.dexterity)
                : 0;
            const playerInitiativeRoll = rollWithModifier(1, 20, dexMod, 'Initiative');
            const companionInitiatives = (state.party || []).map(c => ({
                companion: c,
                initiative: rollDie(20),
            }));

            // Build turn order: player + companions + enemies sorted by engine-owned initiative.
            const turnOrder = [
                { type: 'player', name: state.character?.name || 'Player', initiative: playerInitiativeRoll.total },
                ...companionInitiatives.map(({ companion, initiative }) => ({
                    type: 'companion',
                    id: companion.id,
                    name: companion.name,
                    initiative,
                })),
                ...enemies.map(e => ({ type: 'enemy', id: e.id, name: e.name, initiative: e.initiative })),
            ].sort((a, b) => b.initiative - a.initiative);
            const playerIdx = turnOrder.findIndex(actor => actor.type === 'player');
            const actorsBeforePlayer = playerIdx > 0 ? turnOrder.slice(0, playerIdx) : [];
            const surprise = action.payload?.surprise;
            const openingActors = surprise === 'player'
                ? turnOrder.filter(actor => actor.type === 'enemy' || (actor.type === 'companion' && actorsBeforePlayer.includes(actor)))
                : surprise === 'enemies'
                    ? actorsBeforePlayer.filter(actor => actor.type !== 'enemy')
                    : actorsBeforePlayer;
            const openingActorIds = openingActors.map(actor => actor.id || actor.name);
            const phase = openingActorIds.length > 0
                ? COMBAT_PHASES.OPENING
                : COMBAT_PHASES.AWAITING_PLAYER;
            const queuedExchange = reconcileStartingCombatExchange(action.payload?.queuedExchange, enemies);

            return {
                ...state,
                combat: {
                    active: true,
                    enemies,
                    turnOrder,
                    currentTurn: openingActorIds.length > 0 ? 0 : Math.max(0, playerIdx),
                    round: 1,
                    xpAwarded: false,
                    bonusActionUsed: false,
                    phase,
                    openingActorIds,
                    surprise: ['player', 'enemies'].includes(surprise) ? surprise : 'none',
                    queuedExchange,
                    lastExchangeResult: null,
                    resolvedExchangeIds: [],
                },
                rollHistory: [...state.rollHistory, playerInitiativeRoll],
                messages: [
                    ...state.messages,
                    systemMessage(`**Initiative** — ${state.character?.name || 'You'} rolled **${playerInitiativeRoll.total}** (d20: ${playerInitiativeRoll.rolls.join(', ')}${dexMod ? `, DEX ${dexMod >= 0 ? '+' : ''}${dexMod}` : ''}).`),
                ],
            };
        }

        case 'END_COMBAT': {
            const llmAwardedXp = action.payload?.llmAwardedXp || false;
            // Lost/abandoned fights still earn XP, but only for foes genuinely slain
            // before the end — never for enemies who fled or accepted a surrender
            // while the player ultimately went down or ran.
            const slainXpOnly = !!action.payload?.slainXpOnly;
            let newState = {
                ...state,
                combat: { ...initialGameState.combat },
            };

            // Client-side XP fallback — only when NO XP was earned for this fight at all:
            // neither by the DM this turn (llmAwardedXp) nor at any point during it
            // (combat.xpAwarded). Prevents the manual "End Combat" button double-awarding.
            if (!llmAwardedXp && !state.combat.xpAwarded && state.character) {
                const defeatedEnemies = (state.combat.enemies || []).filter(e => slainXpOnly
                    ? ((e.hp ?? 0) <= 0 || e.condition === 'dead')
                    : !isEnemyActive(e));
                const fallbackXp = estimateCombatExperience(defeatedEnemies);

                if (fallbackXp > 0) {
                    const enemyNames = defeatedEnemies.map(e => e.name).join(', ');
                    const result = awardExperience(newState.character, fallbackXp, {
                        reason: slainXpOnly
                            ? `foes slain before the fight ended: ${enemyNames || 'enemies'}`
                            : `battle complete: ${enemyNames || 'enemies'}`,
                    });
                    newState = {
                        ...newState,
                        character: result.character,
                        messages: [...newState.messages, ...result.messages],
                    };
                    return newState;
                }
            }

            return newState;
        }

        case 'FINALIZE_VICTORY': {
            if (!state.combat.active || !(state.combat.enemies || []).length) return state;
            const allDefeated = state.combat.enemies.every(e => !isEnemyActive(e));
            if (!allDefeated) return state;
            return gameReducer(state, { type: 'END_COMBAT', payload: { autoVictory: true } });
        }

        case 'BEGIN_COMBAT_INTENT':
            if (!state.combat.active || state.combat.phase !== COMBAT_PHASES.AWAITING_PLAYER) return state;
            return { ...state, combat: { ...state.combat, phase: COMBAT_PHASES.AWAITING_INTENT } };

        case 'CANCEL_COMBAT_INTENT':
            if (!state.combat.active || state.combat.phase !== COMBAT_PHASES.AWAITING_INTENT) return state;
            return { ...state, combat: { ...state.combat, phase: COMBAT_PHASES.AWAITING_PLAYER } };

        case 'APPLY_COMBAT_EXCHANGE': {
            const payload = action.payload || {};
            if (!state.combat.active || !payload.exchangeId || !payload.result) return state;
            if ((state.combat.resolvedExchangeIds || []).includes(payload.exchangeId)) return state;
            if (state.combat.phase === COMBAT_PHASES.AWAITING_NARRATION) return state;
            if (state.combat.phase === COMBAT_PHASES.OPENING && payload.result.kind !== 'opening') return state;
            if ([COMBAT_PHASES.AWAITING_PLAYER, COMBAT_PHASES.AWAITING_INTENT].includes(state.combat.phase) && payload.result.kind !== 'exchange') return state;

            let next = state;
            const preExchangeMessageCount = state.messages.length;
            if (Number.isInteger(payload.deathSaveNatural)) {
                next = gameReducer(next, { type: 'DEATH_SAVE_RESULT', payload: { die: payload.deathSaveNatural } });
            }
            if (Number.isFinite(payload.playerDamage) && payload.playerDamage > 0) {
                next = gameReducer(next, { type: 'TAKE_DAMAGE', payload: payload.playerDamage });
            }

            const resultMessages = String(payload.result.summary || '')
                .split('\n')
                .map(line => line.trim())
                .filter(Boolean)
                .map(line => systemMessage(line));
            // The inner DEATH_SAVE_RESULT / TAKE_DAMAGE dispatches append their own status
            // lines ("X is defeated", "X falls!"). Those must render AFTER the exchange's
            // roll summary — the dice caused the defeat, so the reader sees them first.
            const statusMessages = next.messages.slice(preExchangeMessageCount);
            const playerIdx = state.combat.turnOrder.findIndex(actor => actor.type === 'player');
            const character = payload.consumeActionSurge && next.character?.pendingActionSurge
                ? { ...next.character, pendingActionSurge: false }
                : next.character;
            return {
                ...next,
                character,
                party: Array.isArray(payload.party) ? payload.party : next.party,
                rollHistory: [...next.rollHistory, ...(Array.isArray(payload.rolls) ? payload.rolls : [])],
                messages: [...next.messages.slice(0, preExchangeMessageCount), ...resultMessages, ...statusMessages],
                combat: {
                    ...next.combat,
                    enemies: Array.isArray(payload.enemies) ? payload.enemies : next.combat.enemies,
                    phase: COMBAT_PHASES.AWAITING_NARRATION,
                    currentTurn: playerIdx >= 0 ? playerIdx : next.combat.currentTurn,
                    lastExchangeResult: payload.result,
                    queuedExchange: payload.result.kind === 'opening' ? next.combat.queuedExchange : null,
                    openingActorIds: payload.result.kind === 'opening' ? next.combat.openingActorIds : [],
                    resolvedExchangeIds: [...(next.combat.resolvedExchangeIds || []), payload.exchangeId].slice(-20),
                },
            };
        }

        case 'COMPLETE_COMBAT_NARRATION': {
            if (!state.combat.active || state.combat.phase !== COMBAT_PHASES.AWAITING_NARRATION) return state;
            const result = state.combat.lastExchangeResult;
            if (!result?.exchangeId || result.exchangeId !== action.payload?.exchangeId) return state;
            if (result.terminal === 'victory') {
                return gameReducer(state, { type: 'END_COMBAT', payload: { autoVictory: true } });
            }
            if (result.terminal === 'defeat') {
                return gameReducer(state, { type: 'END_COMBAT', payload: { defeat: true, slainXpOnly: true } });
            }
            if (result.terminal === 'escaped') {
                return gameReducer(state, { type: 'END_COMBAT', payload: { escaped: true, slainXpOnly: true } });
            }
            const playerIdx = state.combat.turnOrder.findIndex(actor => actor.type === 'player');
            const completedOpening = result.kind === 'opening';
            return {
                ...state,
                combat: {
                    ...state.combat,
                    phase: COMBAT_PHASES.AWAITING_PLAYER,
                    currentTurn: playerIdx >= 0 ? playerIdx : 0,
                    round: completedOpening ? state.combat.round : state.combat.round + 1,
                    bonusActionUsed: completedOpening ? state.combat.bonusActionUsed : false,
                    openingActorIds: [],
                    lastExchangeResult: null,
                },
            };
        }

        case 'REJECT_COMBAT_EXCHANGE': {
            if (!state.combat.active) return state;
            const playerIdx = state.combat.turnOrder.findIndex(actor => actor.type === 'player');
            return {
                ...state,
                combat: {
                    ...state.combat,
                    phase: COMBAT_PHASES.AWAITING_PLAYER,
                    currentTurn: playerIdx >= 0 ? playerIdx : state.combat.currentTurn,
                    queuedExchange: null,
                },
                messages: [
                    ...state.messages,
                    systemMessage(`**Combat action not resolved:** ${action.payload?.reason || 'The action envelope was invalid.'} No one acted; try again.`),
                ],
            };
        }

        case 'UPDATE_ENEMY':
            return {
                ...state,
                combat: {
                    ...state.combat,
                    enemies: state.combat.enemies.map(e => {
                        if (e.id !== action.payload.id) return e;
                        // Allowlist: UPDATE_ENEMY may only change HP. Mechanical stats
                        // (attackBonus/damage/ac/maxHp/name) are NOT mutable here, so a DM
                        // enemy_updates payload can't inject "+99" or "50d100". Condition is
                        // always re-derived from HP, never trusted from the payload.
                        const newHp = clampEnemyCurrentHP(action.payload.hp, e.maxHp, e.hp);
                        const updated = { ...e, hp: newHp };
                        updated.condition = enemyHealthCondition(updated.hp, updated.maxHp);
                        return updated;
                    }),
                },
            };

        // --- Auth ---
        case 'SET_USER':
            return {
                ...state,
                user: {
                    ...action.payload,
                    isAuthLoading: false
                }
            };

        case 'SIGNOUT_USER':
            return {
                ...state,
                user: {
                    uid: null,
                    email: null,
                    isGuest: false,
                    isAuthLoading: false
                }
            };

        // --- Settings ---
        case 'UPDATE_SETTINGS':
            return {
                ...state,
                settings: { ...state.settings, ...action.payload },
            };

        // --- UI ---
        case 'SET_UI':
            return {
                ...state,
                ui: { ...state.ui, ...action.payload },
            };

        // --- Session ---
        case 'UPDATE_SESSION':
            {
                const session = { ...state.session, ...action.payload };
                const shouldSeedFronts = action.payload?.id
                    && action.payload.id !== state.session?.id
                    && state.character
                    && (state.fronts || []).length === 0;
                return {
                ...state,
                    session,
                    fronts: shouldSeedFronts
                        ? createInitialFronts({ premise: session.premise, character: state.character, location: state.currentLocation })
                        : state.fronts,
                };
            }

        // --- Bulk Load ---
        case 'LOAD_GAME': {
            const loadedInventory = normalizeInventory(action.payload.inventory || []);
            // Auto-equip armor/shield if nothing of that type is equipped (fixes old saves)
            const hasEquippedArmor = loadedInventory.some(i => i.equipped && i.type === 'armor' && !i.isShield);
            const hasEquippedShield = loadedInventory.some(i => i.equipped && (i.type === 'shield' || i.isShield));
            if (!hasEquippedArmor || !hasEquippedShield) {
                for (const item of loadedInventory) {
                    if (!hasEquippedArmor && item.type === 'armor' && !item.isShield && item.baseAC) {
                        item.equipped = true;
                        break;
                    }
                }
                for (const item of loadedInventory) {
                    if (!hasEquippedShield && (item.type === 'shield' || item.isShield)) {
                        item.equipped = true;
                        break;
                    }
                }
            }
            // Collapse invalid equipped combinations from older saves: one active weapon,
            // one armor, one shield, and no shield while a two-handed weapon is active.
            const normalizedEquippedInventory = normalizeEquippedSlots(loadedInventory);
            const loadedCharacter = action.payload.character;
            // Recalculate AC on load to fix stale saves
            // Backfill new character fields for old saves
            const rawBackfilledCharacter = loadedCharacter ? {
                skillProficiencies: [],
                expertiseSkills: [],
                classResources: loadedCharacter.class ? buildClassResources(loadedCharacter.class, loadedCharacter.level || 1) : {},
                hitDice: {
                    total: loadedCharacter.level || 1,
                    remaining: loadedCharacter.level || 1,
                    die: CLASSES[loadedCharacter.class]?.hitDie || 8,
                },
                ...loadedCharacter,
                fightingStyle: normalizeFightingStyle(loadedCharacter.class, loadedCharacter.fightingStyle),
                martialArchetype: normalizeMartialArchetype(loadedCharacter.class, loadedCharacter.level, loadedCharacter.martialArchetype),
                ...normalizeAbilityScoreImprovementState(loadedCharacter),
            } : loadedCharacter;
            if (rawBackfilledCharacter) {
                rawBackfilledCharacter.armorClass = computeACFromInventory(normalizedEquippedInventory, rawBackfilledCharacter);
            }
            const pendingProgression = applyPendingLevelUpsOnLoad(rawBackfilledCharacter);
            const backfilledCharacter = pendingProgression.character;
            // Validate required state shape
            const validated = validateSaveState(action.payload);
            const loadedSession = {
                ...initialGameState.session,
                ...action.payload.session,
                // Derive the summarization boundary from the messages actually present
                // (summarized messages are a contiguous prefix). This self-heals a stale
                // index from a trimmed cloud save or an older save format.
                prunedMessageCount: (validated.messages || []).filter(m => m.summarized).length,
            };
            let loadedFronts = Array.isArray(action.payload.fronts)
                ? action.payload.fronts.map(f => normalizeFront(f))
                : [];
            // Heal pre-serializer saves: local saves before 2026-07-03 never persisted
            // fronts, so every reloaded campaign silently lost its hidden world clocks.
            // An established campaign must never run front-less — reseed the deterministic
            // local pressure, and drop the generation/upgrade marker that described the
            // lost front web so Settings → "Upgrade to Dynamic World" becomes available
            // again to rebuild rich fronts from campaign canon. Cadence watermarks
            // (lastCadenceId/lastJournalEnd) are kept so old cadences cannot replay.
            if (loadedFronts.length === 0 && backfilledCharacter) {
                loadedFronts = createInitialFronts({
                    premise: loadedSession.premise,
                    character: backfilledCharacter,
                    location: action.payload.currentLocation || null,
                });
                if (loadedSession.frontDirector) {
                    const { generationVersion: _lostGeneration, source: _lostSource, ...directorRest } = loadedSession.frontDirector;
                    loadedSession.frontDirector = directorRest;
                }
            }
            return {
                ...validated,
                // Use the normalized + migrated inventory (auto-equipped armor/shield and the
                // single-active-weapon collapse). Previously these were computed for AC only
                // and discarded, leaving the raw saved inventory — so the migrations never applied.
                inventory: normalizedEquippedInventory,
                character: backfilledCharacter,
                messages: [...validated.messages, ...pendingProgression.messages],
                user: state.user,
                settings: {
                    ...initialGameState.settings,
                    ...(action.payload.settings || {}),
                    ...state.settings,
                },
                // Backfill new fields for old saves that don't have them
                worldFacts: action.payload.worldFacts || [],
                fronts: loadedFronts,
                session: loadedSession,
                npcs: (action.payload.npcs || []).map(npc => migrateLegacyNpc(npc)),
                ui: { ...initialGameState.ui },
            };
        }

        case 'NEW_GAME':
            return {
                ...initialGameState,
                settings: state.settings, // Preserve settings across games
            };

        default:
            console.warn(`Unknown action type: ${action.type}`);
            return state;
    }
}
