/**
 * Helpers shared by multiple reducer domains and the save-migration pipeline
 * (migrations.js). Single-domain helpers live in their domain module instead.
 */
import { computeACFromInventory } from '../../engine/rules.js';
import { conversationalDistance } from '../../engine/replayLedger.js';
import { itemIdentityMatches } from '../../engine/textMatch.js';
import { ITEM_CATALOG, clampMagicBonus, normalizeItemKey, parseMagicBonusFromName } from '../../data/items.js';
import { MAX_CHARACTER_LEVEL } from '../../engine/progression.js';
import { normalizeKnownBy } from '../../engine/storyMemory.js';
import { appendKeepsakes } from '../../engine/companionGear.js';
import { NPC_DOSSIER_FIELD_MAX, NPC_GENDER_MAX, NPC_SPECIES_MAX } from '../../config/contentLimits.js';
import { COMBAT_PHASES, isLowLevelSolo } from '../../engine/combatExchange.js';
import {
    appendBondMoments,
    appendCallbackHooks,
    clampNpcDossierField,
    classifyNpcCandidate,
    mergeNpcDossierText,
    namesMatch,
    normalizeNpcRecord,
    NPC_DURABLE_TEXT_FIELDS,
} from '../../engine/npcRoster.js';

// Live rollHistory cap, matching persistence's MAX_SAVED_ROLLS: only 50 are
// ever persisted, 20 render, 5 reach the prompt — but the live array grew
// unbounded for the whole session (2026-08-01 audit).
export const ROLL_HISTORY_CAP = 50;

/** Append roll(s) to a rollHistory array, keeping only the newest 50. */
export function appendRollHistory(rollHistory, rolls) {
    const additions = Array.isArray(rolls) ? rolls : [rolls];
    return [...(rollHistory || []), ...additions].slice(-ROLL_HISTORY_CAP);
}

export function systemMessage(content, extra = {}) {
    return {
        id: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        timestamp: Date.now(),
        role: 'system',
        content,
        ...extra,
    };
}

/** Mark a character as dead (3 failed death saves or a fatal narrative event). */
export function applyDeath(character) {
    return { ...character, isDead: true, dying: false, deathSaves: { successes: 0, failures: 0 } };
}

// The low-level-solo predicate is engine-owned (combatExchange.js) so the exchange
// engine, the reducer, applyEvents, and the prompt all ask the SAME function live.
export { isLowLevelSolo };

export function withCondition(character, condition) {
    const conditions = character.conditions || [];
    if (conditions.some(c => c.toLowerCase() === condition.toLowerCase())) return character;
    return { ...character, conditions: [...conditions, condition] };
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
 * Load-side heal for one persisted chronicle chapter (2026-09-04 audit): the
 * chronicle was the one persisted collection validateSaveState never
 * shape-guarded, while both readers index its last element unguarded —
 * ChronicleTab and writeChronicleChapters — so a null entry crashed the whole
 * Journal panel on open and a string toIndex ("12") string-concatenated the
 * next chapter's fromIndex into "121" (every close said "Not enough new play").
 * Plain objects with text survive; from/toIndex are coerced to finite
 * integers; junk drops.
 */
export function healChronicleChapter(entry) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return null;
    const text = typeof entry.text === 'string' ? entry.text.trim().slice(0, 60000) : '';
    if (!text) return null;
    const index = (value) => {
        const n = Number(value);
        return Number.isFinite(n) ? Math.max(0, Math.trunc(n)) : 0;
    };
    return {
        ...entry,
        id: typeof entry.id === 'string' && entry.id ? entry.id : `chapter-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        title: String(entry.title ?? '').trim().slice(0, 80),
        text,
        fromIndex: index(entry.fromIndex),
        toIndex: index(entry.toIndex),
        createdAt: Number.isFinite(Number(entry.createdAt)) ? Number(entry.createdAt) : Date.now(),
    };
}

export function reviveCharacter(character) {
    return {
        ...character,
        dying: false,
        lowLevelDefeat: false,
        deathSaves: { successes: 0, failures: 0 },
        conditions: (character.conditions || []).filter(c => c.toLowerCase() !== 'unconscious'),
    };
}

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
const WORLD_FACT_MAX_LENGTH = 400;
const WORLD_FACT_CATEGORY_MAX_LENGTH = 40;

export function sanitizeWorldFactPayload(payload) {
    if (!payload || typeof payload !== 'object') return null;
    const fact = typeof payload.fact === 'string' ? payload.fact.trim().slice(0, WORLD_FACT_MAX_LENGTH) : '';
    if (!fact) return null;
    const category = (typeof payload.category === 'string' && payload.category.trim())
        ? payload.category.trim().slice(0, WORLD_FACT_CATEGORY_MAX_LENGTH)
        : 'general';
    // Epistemics boundary (DECISIONS.md 2026-08-05 ×2): a non-empty knownBy
    // marks the fact as private to exactly those people. Always present in the
    // output so a hostile save's junk value gets overwritten on load.
    return { fact, category, knownBy: normalizeKnownBy(payload.knownBy ?? payload.known_by) };
}

export const RECENT_TRANSACTION_LIMIT = 20;

// Explicit repeat-intent phrasing: "another", "one/two/a few more", "more of those", etc.
export const REPEAT_TRANSACTION_RE = /\b(another|second|same|again|(?:one|two|three|four|five|six|a couple(?: of)?|a few|several|some)\s+more|more of (?:those|these|them))\b/i;

// Proximity beats co-occurrence (live 2026-08-22 double-grant: "Another time,
// Odo… I count three silver out of my purse" read as repeat-grant intent because
// "another" and "silver" merely co-occurred sentences apart — and the coin was
// flowing OUT). A repeat quantifier only shows repeat intent when it attaches to
// the noun it repeats: "another twenty silver", "a few more of those", "the same
// stew again". `nounRe` is a bare alternation group (no anchors of its own).
const REPEAT_QUANTIFIER_SRC = String.raw`(?:another|a second|the same|(?:one|two|three|four|five|six|a couple(?: of)?|a few|several|some) more|more of)`;

export function repeatIntentNearNoun(playerMessage, nounRe) {
    const text = String(playerMessage || '');
    if (!text.trim()) return false;
    const noun = nounRe.source;
    const near = new RegExp(String.raw`\b${REPEAT_QUANTIFIER_SRC}\s+(?:[\w'-]+\s+){0,2}?(?:${noun})\b`, 'i');
    if (near.test(text)) return true;
    // Inverted form: the noun with a trailing "again" in the same clause
    // ("buy it again", "cast that again", "the stew again, please").
    const trailing = new RegExp(String.raw`\b(?:${noun})\b[^.!?;]{0,24}\bagain\b`, 'i');
    return trailing.test(text);
}

export function sanitizeRecentTransaction(entry) {
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

export function playerMessageSupportsRepeatTransaction(item, playerMessage, verbRe) {
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

    // Last resort: a repeat quantifier attached to a pronoun ("another one",
    // "more of those", "buy it again") — bare co-occurrence of a repeat word and
    // a stray pronoun anywhere in the message is NOT repeat intent (2026-08-22).
    return repeatIntentNearNoun(text, /(?:one|round|it|that|those|these|them)/);
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
    if (STACK_EXEMPT_TYPES.has(item.type) || item.isShield) return null;
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
    return inventory.map(row => (row === target
        ? { ...row, quantity: Math.max(1, Math.trunc(row.quantity || 1)) + added }
        : row));
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
        nextCharacter.conditions = (nextCharacter.conditions || [])
            .filter(c => String(c).toLowerCase() !== String(sustained.condition).toLowerCase());
    }
    nextCharacter = { ...nextCharacter, armorClass: computeACFromInventory(inventory || [], nextCharacter) };
    const nextParty = (party || []).map(companion => {
        if (companion.id !== sustained.targetId) return companion;
        const { spellAcBonus: _droppedBonus, ...cleaned } = companion;
        if (sustained.condition) {
            cleaned.conditions = (cleaned.conditions || [])
                .filter(c => String(c).toLowerCase() !== String(sustained.condition).toLowerCase());
        }
        return cleaned;
    });
    return { character: nextCharacter, party: nextParty };
}

/** How many disposition shifts to keep per NPC — enough to show an arc, bounded for state size. */
const MAX_NPC_HISTORY = 10;

/**
 * Cadence-stamped relationship arcs (2026-08-28): a transition enters
 * relationshipHistory only when it SURVIVES to a journal cadence — the live
 * `disposition` chip still moves per turn, but Neutral↔Friendly↔Wary flicker
 * inside one sitting collapses to wherever the relationship actually landed.
 * `arcDisposition` anchors the last stamped state; legacy records derive it
 * from their history tail (or current disposition) on first stamp, so the fix
 * never mints a retroactive transition. The 'unknown' → X establishment is
 * not an arc beat, matching the old rule.
 */
export function stampNpcRelationshipArcs(npcs) {
    if (!Array.isArray(npcs) || npcs.length === 0) return npcs;
    let changed = false;
    const next = npcs.map(npc => {
        const history = Array.isArray(npc.relationshipHistory) ? npc.relationshipHistory : [];
        const anchor = npc.arcDisposition
            || history[history.length - 1]?.to
            || npc.disposition
            || 'unknown';
        if (!npc.disposition || npc.disposition === anchor) {
            if (npc.arcDisposition === anchor) return npc;
            changed = true;
            return { ...npc, arcDisposition: anchor };
        }
        changed = true;
        if (anchor === 'unknown') {
            return { ...npc, arcDisposition: npc.disposition };
        }
        return {
            ...npc,
            arcDisposition: npc.disposition,
            relationshipHistory: [
                ...history,
                { from: anchor, to: npc.disposition, at: Date.now(), note: npc.lastNotes || '' },
            ].slice(-MAX_NPC_HISTORY),
        };
    });
    return changed ? next : npcs;
}

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
        return { damage, weaponBonus };
    }
    const fallback = (typeof payloadDamage === 'string' && payloadDamage.trim())
        ? payloadDamage.trim().slice(0, 20)
        : defaultCompanionDamage(weapon);
    return { damage: fallback, weaponBonus };
}

export function companionStatus(hp, maxHp) {
    if (hp <= 0) return 'downed';
    const pct = maxHp > 0 ? hp / maxHp : 1;
    if (pct <= 0.25) return 'critical';
    if (pct <= 0.5) return 'bloodied';
    return 'healthy';
}

export function normalizeCompanion(payload = {}, existing = {}) {
    const merged = { ...existing, ...payload };
    const hasExplicitStatus = Object.prototype.hasOwnProperty.call(payload, 'status');
    const level = clampNumber(merged.level, 1, MAX_CHARACTER_LEVEL, existing.level || 1);
    const maxHp = clampNumber(merged.maxHp ?? merged.maxHP, 1, 999, existing.maxHp || 20);
    const hp = clampNumber(merged.hp, 0, maxHp, existing.hp ?? maxHp);
    const weapon = String(merged.weapon || existing.weapon || 'Dagger').trim().slice(0, 60) || 'Dagger';
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
        damage = merged.damage || existing.damage || defaultCompanionDamage(weapon);
        weaponBonus = clampMagicBonus(Number(existing.weaponBonus) || 0);
    }

    return {
        id: merged.id || `companion-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
        name: String(merged.name || existing.name || 'Companion').trim().slice(0, 40),
        role: merged.role || existing.role || 'ally',
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
        conditions: Array.isArray(merged.conditions) ? merged.conditions : (existing.conditions || []),
        notes: merged.notes || existing.notes || '',
        appearance: merged.appearance || existing.appearance || '',
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
    if (npcs.some(npc => namesMatch(npc.name, name))) return npcs;
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

export function upsertNpc(npcs, payload) {
    if (!payload || (!payload.id && !payload.name)) return npcs;
    const update = pruneBlankFields({ ...payload, lastSeen: Date.now() });
    if (update.appearance) {
        update.appearance = String(update.appearance).trim().slice(0, NPC_DOSSIER_FIELD_MAX);
    }
    // Short current-state fields (like appearance, plain replace): feed scene art,
    // the KNOWN NPCs block, and NPC RAG so generated images stop misgendering —
    // and so a goblin stays a goblin instead of defaulting to a human figure.
    if (update.gender) {
        update.gender = String(update.gender).trim().slice(0, NPC_GENDER_MAX);
    }
    if (update.species) {
        update.species = String(update.species).trim().slice(0, NPC_SPECIES_MAX);
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
        // Disposition updates live here, but arc HISTORY is no longer stamped
        // per update (2026-08-28): every Scribe mood re-read used to mint a
        // transition, so one tavern evening produced nine meaningless hops.
        // stampNpcRelationshipArcs records a transition on the journal cadence,
        // only for shifts that actually held.
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

function equipmentKindMatches(item, kind) {
    const k = String(kind || '').toLowerCase();
    if (!k) return false;
    if (k === 'armor') return item.type === 'armor' && !item.isShield;
    if (k === 'shield') return item.type === 'shield' || item.isShield;
    if (k === 'weapon') return item.type === 'weapon';
    return false;
}

/**
 * Resolve a DM-supplied item reference (id, catalog key, name, or generic
 * armor/shield/weapon kind) against the live inventory. Shared by the
 * equip/unequip channel, name-referenced removal, and sales — one resolution
 * ladder so a name that equips also sells and removes (2026-08-28 audit).
 */
export function findInventoryItemByRef(inventory, ref, { preferEquipped = false } = {}) {
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

    // Fuzzy token-containment, UNAMBIGUOUS only (2026-08-28): a narrated
    // "hempen rope" resolves to "Hempen Rope (50 ft)" — the same identity rule
    // the Scribe audits use — but two candidate stacks resolve to nothing
    // rather than a guess.
    if (name) {
        const fuzzy = candidates.filter(i =>
            itemIdentityMatches(name, i.name) || (i.itemKey && itemIdentityMatches(name, i.itemKey)));
        if (fuzzy.length === 1) return fuzzy[0];
    }

    const kind = payload.type || payload.slot || payload.category || name;
    return candidates.find(i => equipmentKindMatches(i, kind)) || null;
}
