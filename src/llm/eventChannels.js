/**
 * Event-channel registry — THE definition of the DM→engine event contract.
 *
 * Every channel the DM can emit in its trailing JSON block is declared here:
 * its wire key(s), its camelCase key on the normalized events object, and its
 * normalization (shape guards, clamps, caps). `normalizeEvents` is a loop over
 * this table, so every array channel gets the same element-shape guard for
 * free — the 2026-07 audits fixed four separate crashes that were all the same
 * bug: hand-rolled per-channel normalization with uneven guard depth.
 *
 * Adding a channel = ONE entry here + a reducer action + (usually) a line in
 * promptBuilder's RESPONSE_FORMAT example. The agreement test
 * (eventChannels.test.js) fails if the prompt example and this registry drift
 * apart — the fate of `damage_dealt`, which the DM was instructed to emit for
 * months while the engine silently ignored it, cannot recur.
 *
 * Application (events → dispatches) lives in src/state/applyEvents.js.
 */

import { validateEnemyAttackBonus, validateEnemySaveBonus, sanitizeEnemyDamage, clampEnemyAC, clampEnemyHP, normalizeEnemyConditions } from '../engine/enemyStats.js';
import { normalizeCombatExchange, reconcileStartingCombatExchange } from '../engine/combatExchange.js';

/** Cryptographically random integer in [min, max] — replaces Math.random() fallbacks. */
function cryptoRandInt(min, max) {
    const range = max - min + 1;
    return min + (crypto.getRandomValues(new Uint32Array(1))[0] % range);
}

/**
 * Clamp a numeric LLM value to a sane range; unusable values become the fallback.
 * LLMs regularly emit numeric fields as strings ("15") or with a trailing unit
 * ("15 gp"); silently zeroing those made narrated coin/XP grants vanish, so a
 * leading-number parse is accepted and logged before falling back.
 */
export function clamp(value, min, max, fallback = 0) {
    let num = value;
    if (typeof value === 'string' && value.trim() !== '') {
        num = Number(value);
        if (!Number.isFinite(num)) num = parseFloat(value);
        if (Number.isFinite(num)) {
            console.warn(`[ResponseParser] Coerced string numeric value "${value}" -> ${num}.`);
        }
    }
    return Number.isFinite(num) ? Math.max(min, Math.min(max, num)) : fallback;
}

const isPlainObject = (v) => !!v && typeof v === 'object' && !Array.isArray(v);

/**
 * The uniform array-channel guard: keep plain objects (and, when allowed,
 * non-empty strings), drop everything else, cap the list. A null/scalar/array
 * element in ANY channel must never reach a reducer.
 */
function guardedList(raw, { allowStrings = false, cap = Infinity, map = null } = {}) {
    if (!Array.isArray(raw)) return [];
    let list = raw.filter(entry => isPlainObject(entry) || (allowStrings && typeof entry === 'string' && entry.trim()));
    if (map) list = list.map(map).filter(entry => entry !== null && entry !== undefined);
    return list.slice(0, cap);
}

function canonicalEnemyId(enemy, index, usedIds) {
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

/**
 * Validate and sanitize combat_start data from the LLM.
 * Ensures every enemy has required fields with sensible defaults.
 */
export function validateCombatStart(combatStart) {
    if (!combatStart || !isPlainObject(combatStart)) return null;
    if (!Array.isArray(combatStart.enemies) || combatStart.enemies.length === 0) return null;

    const usedIds = new Set();
    const sanitizedEnemies = combatStart.enemies
        .filter(e => isPlainObject(e) && typeof e.name === 'string' && e.name.trim())
        .map((e, index) => {
            // Enemy turns are engine-owned, so capture the foe's stats once here, validated at
            // this boundary via the shared sanitizer. Out-of-range offensive stats are dropped
            // (→ engine default), HP/AC are clamped into a safe band.
            const attackBonus = validateEnemyAttackBonus(
                typeof e.attack_bonus === 'number' ? e.attack_bonus : e.attackBonus
            );
            const damage = sanitizeEnemyDamage(e.damage);
            const saveBonus = validateEnemySaveBonus(
                typeof e.save_bonus === 'number' ? e.save_bonus : e.saveBonus
            );
            return {
                id: canonicalEnemyId(e, index, usedIds),
                name: e.name.trim().slice(0, 100),
                hp: clampEnemyHP(e.hp),
                ac: clampEnemyAC(e.ac),
                conditions: normalizeEnemyConditions(e.conditions),
                initiative: (typeof e.initiative === 'number') ? e.initiative : cryptoRandInt(1, 20),
                ...(attackBonus !== undefined && { attackBonus }),
                ...(damage !== undefined && { damage }),
                ...(saveBonus !== undefined && { saveBonus }),
                isUndead: e.is_undead === true || e.isUndead === true,
            };
        });

    if (sanitizedEnemies.length === 0) return null;

    return {
        enemies: sanitizedEnemies,
        surprise: ['player', 'enemies'].includes(String(combatStart.surprise || '').toLowerCase())
            ? String(combatStart.surprise).toLowerCase()
            : 'none',
        player_initiative: (typeof combatStart.player_initiative === 'number')
            ? combatStart.player_initiative
            : cryptoRandInt(1, 20),
    };
}

function normalizeRequestedRoll(r) {
    return {
        type: r.type || 'skill_check',
        // Type-guarded like dc/modifier: a truthy non-string (array/number)
        // throws deep in rollResolver AFTER dice are shown (2026-07-23 audit).
        skill: typeof r.skill === 'string' && r.skill.trim() ? r.skill.trim() : null,
        ability: typeof r.ability === 'string' && r.ability.trim() ? r.ability.trim() : null,
        // DC default 10, the solo-play standard obstacle — NOT 15: the prompt's
        // own ladder says "never default DC 15", and the text-roll detector
        // already used 10 for exactly that reason. One default, both paths.
        dc: typeof r.dc === 'number' ? r.dc : 10,
        description: r.description || '',
        reason: String(r.reason || r.roll_reason || '').slice(0, 500),
        opposition: String(r.opposition || '').slice(0, 500),
        failureStakes: String(r.failure_stakes || r.failureStakes || '').slice(0, 500),
        difficultyReason: String(r.difficulty_reason || r.difficultyReason || '').slice(0, 500),
        advantageReason: String(r.advantage_reason || r.advantageReason || '').slice(0, 500),
        disadvantageReason: String(r.disadvantage_reason || r.disadvantageReason || '').slice(0, 500),
        // NPC attack fields
        attacker: r.attacker || null,
        attackerId: r.attackerId || r.companionId || r.companion_id || null,
        modifier: typeof r.modifier === 'number' ? r.modifier : null,
        // Damage roll field
        notation: r.notation || null,
        // Combat (batched-round) fields: who takes the hit + inline weapon damage
        target: r.target || null,
        damage: r.damage || null,
        // Advantage / Disadvantage
        advantage: !!r.advantage,
        disadvantage: !!r.disadvantage,
    };
}

function normalizeStartingItem(item) {
    if (typeof item === 'string') return { name: item };
    const name = String(item.name || '').trim();
    const itemKey = String(item.itemKey || item.key || '').trim();
    if (!name && !itemKey) return null;
    // Premise-established stacks ("two Potions of Healing") keep their
    // count — clamped small; starting gear is belongings, not a hoard.
    const quantity = Number.isFinite(Number(item.quantity))
        ? Math.max(1, Math.min(10, Math.floor(Number(item.quantity))))
        : 1;
    return {
        ...(name && { name }),
        ...(itemKey && { itemKey }),
        ...(item.description && { description: String(item.description).slice(0, 500) }),
        ...(item.equipped === true && { equipped: true }),
        ...(quantity > 1 && { quantity }),
    };
}

const QUEST_UPDATE_STATUSES = new Set(['new', 'updated', 'completed', 'failed']);

/**
 * Type-guard a quest update at the parser boundary (mirrors the world-fact
 * whitelist): an object-valued name/description would persist into the save and
 * crash QuestPanel's render on every open (2026-07-25 audit). A valid identity
 * with a missing or misspelled status defaults to 'new' — the DM's "job
 * accepted" intent must not vanish silently, and ADD_QUEST upserts so an
 * existing quest just refreshes.
 */
function normalizeQuestUpdate(raw) {
    const id = (typeof raw.id === 'string' || typeof raw.id === 'number')
        ? String(raw.id).trim().slice(0, 80)
        : '';
    const name = typeof raw.name === 'string' ? raw.name.trim().slice(0, 160) : '';
    if (!id && !name) return null;
    const description = typeof raw.description === 'string' ? raw.description.trim().slice(0, 800) : '';
    const status = typeof raw.status === 'string' ? raw.status.trim().toLowerCase() : '';
    return {
        ...(id && { id }),
        ...(name && { name }),
        ...(description && { description }),
        status: QUEST_UPDATE_STATUSES.has(status) ? status : 'new',
    };
}

/** Bounded spell_cast entries: a single object, a bare name, or an array of up to 3. */
function normalizeSpellCasts(raw) {
    const list = Array.isArray(raw) ? raw : (raw ? [raw] : []);
    return list.slice(0, 3)
        .map(entry => {
            if (typeof entry === 'string') return entry.trim() ? { spell: entry.trim().slice(0, 80), slotLevel: null, target: null } : null;
            if (!isPlainObject(entry)) return null;
            const spell = String(entry.spell || entry.name || entry.key || '').trim().slice(0, 80);
            if (!spell) return null;
            const rawLevel = entry.slot_level ?? entry.slotLevel;
            return {
                spell,
                slotLevel: Number.isFinite(rawLevel) ? Math.max(1, Math.min(5, Math.round(rawLevel))) : null,
                target: entry.target ? String(entry.target).trim().slice(0, 100) : null,
            };
        })
        .filter(Boolean);
}

function normalizeMemoryUpdate(update) {
    return {
        ...(update.id && { id: String(update.id) }),
        ...(update.memoryId && { memoryId: String(update.memoryId) }),
        ...(update.memory_id && { memory_id: String(update.memory_id) }),
        ...(update.subject && { subject: String(update.subject) }),
        ...(update.text && { text: String(update.text) }),
        ...(update.status && { status: String(update.status) }),
        ...(update.used !== undefined && { used: !!update.used }),
        ...(update.markUsed !== undefined && { markUsed: !!update.markUsed }),
        ...(update.mark_used !== undefined && { mark_used: !!update.mark_used }),
        ...(typeof update.salience === 'number' && { salience: update.salience }),
        ...(typeof update.emotionalCharge === 'number' && { emotionalCharge: update.emotionalCharge }),
        ...(typeof update.emotional_charge === 'number' && { emotional_charge: update.emotional_charge }),
        ...(Array.isArray(update.tags) && { tags: update.tags.map(String) }),
        ...(Array.isArray(update.linkedNpcNames) && { linkedNpcNames: update.linkedNpcNames.map(String) }),
        ...(Array.isArray(update.linked_npc_names) && { linked_npc_names: update.linked_npc_names.map(String) }),
        ...(update.location && { location: String(update.location) }),
    };
}

/** items_found/items_lost accept catalog strings and item objects — nothing else. */
function isLootEntry(entry) {
    if (typeof entry === 'string') return entry.trim().length > 0;
    return isPlainObject(entry);
}

/**
 * The registry. Each entry: the primary wire key the DM is documented to emit,
 * any accepted aliases, the camelCase key on the normalized events object, and
 * `read(raw)` — the channel's whole normalization, taking the raw parsed JSON.
 * Channels with cross-channel coupling (combat_start ↔ combat_exchange) are
 * reconciled in a post-pass inside normalizeEvents.
 */
export const EVENT_CHANNELS = [
    {
        wire: 'requested_rolls', key: 'requestedRolls',
        read: raw => guardedList(raw.requested_rolls, { map: normalizeRequestedRoll }),
    },
    { wire: 'damage_taken', key: 'damageTaken', read: raw => clamp(raw.damage_taken, 0, 999) },
    { wire: 'healing', key: 'healing', read: raw => clamp(raw.healing, 0, 999) },
    {
        wire: 'starting_items', key: 'startingItems',
        read: raw => guardedList(raw.starting_items, { allowStrings: true, cap: 12, map: normalizeStartingItem }),
    },
    // A null/array/number element would mint a junk "Unknown item" (or crash the
    // traded-item dedup's `.name` read) — keep only named strings and plain objects.
    { wire: 'items_found', key: 'itemsFound', read: raw => (Array.isArray(raw.items_found) ? raw.items_found.filter(isLootEntry).slice(0, 20) : []) },
    { wire: 'items_lost', key: 'itemsLost', read: raw => (Array.isArray(raw.items_lost) ? raw.items_lost.filter(isLootEntry).slice(0, 20) : []) },
    {
        wire: 'equipment_changes', aliases: ['equipment_change'], key: 'equipmentChanges',
        read: raw => {
            const list = Array.isArray(raw.equipment_changes)
                ? raw.equipment_changes
                : (raw.equipment_change ? [raw.equipment_change] : []);
            return list
                .map(c => ({
                    action: String(c?.action || '').toLowerCase(),
                    itemId: c?.itemId || c?.id || null,
                    itemKey: c?.itemKey || c?.key || null,
                    name: c?.name || c?.item || null,
                    type: c?.type || c?.slot || null,
                }))
                .filter(c => c.action === 'equip' || c.action === 'unequip')
                .slice(0, 10);
        },
    },
    {
        wire: 'purchase', aliases: ['purchases'], key: 'purchases',
        read: raw => (Array.isArray(raw.purchases) ? raw.purchases : (raw.purchase ? [raw.purchase] : [])),
    },
    {
        wire: 'sell', aliases: ['sells'], key: 'sells',
        read: raw => (Array.isArray(raw.sells) ? raw.sells : (raw.sell ? [raw.sell] : [])),
    },
    { wire: 'gold_found', key: 'goldFound', read: raw => clamp(raw.gold_found, 0, 10000) },
    { wire: 'gold_lost', key: 'goldLost', read: raw => clamp(raw.gold_lost, 0, 10000) },
    { wire: 'silver_found', key: 'silverFound', read: raw => clamp(raw.silver_found, 0, 10000) },
    { wire: 'silver_lost', key: 'silverLost', read: raw => clamp(raw.silver_lost, 0, 10000) },
    { wire: 'copper_found', key: 'copperFound', read: raw => clamp(raw.copper_found, 0, 10000) },
    { wire: 'copper_lost', key: 'copperLost', read: raw => clamp(raw.copper_lost, 0, 10000) },
    { wire: 'exp_awarded', key: 'expAwarded', read: raw => clamp(raw.exp_awarded, 0, 10000) },
    { wire: 'level_up', key: 'levelUp', read: raw => !!raw.level_up },
    { wire: 'rest_taken', key: 'restTaken', read: raw => (typeof raw.rest_taken === 'string' ? raw.rest_taken : null) },
    // Out-of-combat casting: the engine validates the spell and spends the slot.
    { wire: 'spell_cast', aliases: ['spells_cast', 'spell_casts'], key: 'spellCasts', read: raw => normalizeSpellCasts(raw.spell_cast ?? raw.spells_cast ?? raw.spell_casts) },
    { wire: 'conditions_gained', key: 'conditionsGained', read: raw => guardedList(raw.conditions_gained, { allowStrings: true, cap: 10 }) },
    { wire: 'conditions_removed', key: 'conditionsRemoved', read: raw => guardedList(raw.conditions_removed, { allowStrings: true, cap: 10 }) },
    // Limited class abilities the player spent this turn (e.g. ["secondWind"]).
    { wire: 'resources_used', key: 'resourcesUsed', read: raw => guardedList(raw.resources_used, { allowStrings: true, cap: 10 }) },
    { wire: 'quest_updates', key: 'questUpdates', read: raw => guardedList(raw.quest_updates, { cap: 8, map: normalizeQuestUpdate }) },
    { wire: 'location', key: 'location', read: raw => raw.location || null },
    { wire: 'combat_start', key: 'combatStart', read: raw => validateCombatStart(raw.combat_start) },
    { wire: 'combat_end', key: 'combatEnd', read: raw => !!raw.combat_end },
    // Non-object elements dropped so UPDATE_ENEMY never sees a null payload
    // (2026-07-27 audit — now the uniform guard every array channel gets).
    { wire: 'enemy_updates', key: 'enemyUpdates', read: raw => guardedList(raw.enemy_updates, { cap: 12 }) },
    { wire: 'add_companions', key: 'addCompanions', read: raw => guardedList(raw.add_companions, { cap: 6 }) },
    { wire: 'update_companions', key: 'updateCompanions', read: raw => guardedList(raw.update_companions, { cap: 6 }) },
    {
        wire: 'remove_companions', key: 'removeCompanions',
        // Entries are companion names; an object entry contributes its `name`.
        read: raw => guardedList(raw.remove_companions, { allowStrings: true, cap: 6, map: entry => {
            const name = typeof entry === 'string' ? entry.trim() : String(entry.name || '').trim();
            return name || null;
        } }),
    },
    {
        wire: 'world_facts', key: 'worldFacts',
        read: raw => guardedList(raw.world_facts, { allowStrings: true, map: f => (typeof f === 'string' ? { fact: f, category: 'general' } : f) }),
    },
    { wire: 'npc_updates', key: 'npcUpdates', read: raw => guardedList(raw.npc_updates, { cap: 10 }) },
    { wire: 'front_updates', key: 'frontUpdates', read: raw => guardedList(raw.front_updates, { cap: 8 }) },
    { wire: 'memory_updates', key: 'memoryUpdates', read: raw => guardedList(raw.memory_updates, { cap: 10, map: normalizeMemoryUpdate }) },
    // Player death event (not game-over — triggers narrative transition)
    {
        wire: 'player_death', key: 'playerDeath',
        read: raw => (raw.player_death
            ? { description: (isPlainObject(raw.player_death) && raw.player_death.description) || 'Your character has fallen.' }
            : null),
    },
    // combat_exchange is registered for wire-key recognition; its normalization
    // couples to combat_start and runs in normalizeEvents' post-pass below.
    { wire: 'combat_exchange', key: 'combatExchange', read: raw => normalizeCombatExchange(raw.combat_exchange) },
];

/** Every wire key (primary + alias) the engine recognizes. */
export const KNOWN_WIRE_KEYS = new Set(EVENT_CHANNELS.flatMap(c => [c.wire, ...(c.aliases || [])]));

/**
 * Normalize and validate event data from the LLM.
 * One loop over the registry, plus the combat_start ↔ combat_exchange
 * reconciliation post-pass (start-of-combat enemy ids and same-response intent
 * references are canonicalized together).
 */
export function normalizeEvents(raw) {
    // A fenced ```json null``` (or bare scalar/array) block parses cleanly, so the
    // repair path never engages — coerce to an empty event set instead of throwing
    // on the first property read (2026-07-27 audit).
    if (!isPlainObject(raw)) raw = {};

    const events = {};
    for (const channel of EVENT_CHANNELS) {
        events[channel.key] = channel.read(raw);
    }

    if (events.combatStart) {
        events.combatExchange = reconcileStartingCombatExchange(events.combatExchange, events.combatStart.enemies);
    }
    events.combatExchangeRejected = raw.combat_exchange != null && !events.combatExchange;

    return events;
}
