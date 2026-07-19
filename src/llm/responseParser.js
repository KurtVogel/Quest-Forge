/**
 * Response parser — extract game events from LLM responses.
 * Looks for JSON blocks embedded in the narrative text.
 *
/**
 * Response parser — extract game events from LLM responses.
 * Looks for JSON blocks embedded in the narrative text.
 *
 * Failure-mode resilience:
 * - Mode A: DM wrote roll request in text → text roll detector converts it
 * - Mode B/C: DM pre-narrated outcome before roll → flagged for corrector in ChatPanel
 * - Mode D: Malformed JSON → repair attempted before falling back to null
 */

import { extractBalancedJson, repairJson } from './utils/jsonExtractor.js';
import { sendMessage } from './adapter.js';
import { getBackgroundConfig } from './machinery.js';
import { CLASSES } from '../data/classes.js';
import { validateEnemyAttackBonus, validateEnemySaveBonus, sanitizeEnemyDamage, clampEnemyAC, clampEnemyHP, normalizeEnemyConditions } from '../engine/enemyStats.js';
import { normalizeCombatExchange, reconcileStartingCombatExchange } from '../engine/combatExchange.js';
import { normalizeItem } from '../data/items.js';

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
function clamp(value, min, max, fallback = 0) {
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

// All recognized skill and ability names for text roll detection
const KNOWN_SKILLS = [
    'perception', 'stealth', 'athletics', 'acrobatics', 'investigation',
    'insight', 'persuasion', 'deception', 'intimidation', 'sleight of hand',
    'arcana', 'history', 'nature', 'religion', 'medicine', 'survival',
    'animal handling', 'performance', 'thieves tools', "thieves' tools",
    'strength', 'dexterity', 'constitution', 'intelligence', 'wisdom', 'charisma',
    'attack', 'initiative',
];

// Outcome language that should never appear BEFORE dice are rolled
const OUTCOME_KEYWORDS = [
    'you succeed', 'you fail', 'you hit', 'you miss', 'misses you',
    'strikes true', 'you manage to', 'you land', 'you slay', 'you kill',
    'falls dead', 'you spot', 'you notice', 'you find the', 'critical hit',
    'you successfully', 'your attack lands', 'your blow', 'you strike',
];

/**
 * Validate and sanitize combat_start data from the LLM.
 * Ensures every enemy has required fields with sensible defaults.
 * @param {object|null} combatStart - Raw combat_start from LLM
 * @returns {object|null} Sanitized combat_start or null if invalid
 */
function validateCombatStart(combatStart) {
    if (!combatStart) return null;
    if (!Array.isArray(combatStart.enemies) || combatStart.enemies.length === 0) return null;

    const usedIds = new Set();
    const sanitizedEnemies = combatStart.enemies
        .filter(e => e && typeof e.name === 'string' && e.name.trim())
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

/**
 * Scan narrative text for roll requests the DM wrote in plain text instead of JSON.
 * Returns a requestedRolls array (may be empty).
 * @param {string} narrative
 * @returns {Array}
 */
export function detectTextRollRequests(narrative) {
    const rolls = [];
    const lower = narrative.toLowerCase();

    // Extract DC if mentioned: "DC 15", "DC15", "difficulty class 14"
    const dcMatch = lower.match(/\bdc\s*(\d+)\b/) || lower.match(/difficulty class\s*(\d+)/);
    // A malformed prose request without an explicit DC should fall back to the
    // normal solo-play obstacle, not the old overly punishing DC 15 default.
    const dc = dcMatch ? parseInt(dcMatch[1], 10) : 10;

    // Pattern 1: "roll a/an [skill] check/save"
    const rollPattern = /(?:roll|make|attempt)\s+(?:a|an)\s+([\w\s']+?)\s+(?:check|save|saving throw)/gi;
    let match;
    while ((match = rollPattern.exec(narrative)) !== null) {
        const skillRaw = match[1].trim().toLowerCase();
        if (KNOWN_SKILLS.some(s => skillRaw.includes(s) || s.includes(skillRaw))) {
            const skill = KNOWN_SKILLS.find(s => skillRaw.includes(s) || s.includes(skillRaw)) || skillRaw;
            // Note: "saving" does NOT contain the substring "save" — match both forms.
            const type = /sav(e|ing)/i.test(match[0]) ? 'saving_throw' : 'skill_check';
            rolls.push({ type, skill, dc, description: match[0].trim() });
        }
    }

    // Pattern 2: "[Skill] check" standing alone (e.g. "a Perception check")
    if (rolls.length === 0) {
        for (const skill of KNOWN_SKILLS) {
            const skillPattern = new RegExp(`\\b${skill.replace(/['"]/g, ".")}\\s+(?:check|save|saving throw)`, 'i');
            if (skillPattern.test(narrative)) {
                const type = /save|saving throw/i.test(narrative.match(skillPattern)?.[0] || '') ? 'saving_throw' : 'skill_check';
                rolls.push({ type, skill, dc, description: `${skill} check (DC ${dc})` });
                break; // One detected roll per response is enough to trigger the system
            }
        }
    }

    return rolls;
}

/**
 * Check if narrative contains outcome language that shouldn't be there yet
 * (i.e. before dice are rolled). Returns true if pre-narrated outcome is detected.
 * @param {string} narrative
 * @returns {boolean}
 */
export function detectPreNarratedOutcome(narrative) {
    const lower = narrative.toLowerCase();
    return OUTCOME_KEYWORDS.some(kw => lower.includes(kw));
}

/**
 * Parse an LLM response to extract narrative text and game events.
 * @param {string} response - Full LLM response text
 * @returns {{ narrative: string, events: GameEvents | null }}
 */
export function parseResponse(response) {
    if (!response) return { narrative: '', events: null };

    // Try to find a fenced JSON block in the response
    const jsonMatch = response.match(/```json\s*\n?([\s\S]*?)\n?\s*```/);

    console.log('[ResponseParser] Raw response length:', response.length);
    console.log('[ResponseParser] JSON block found:', !!jsonMatch);

    if (!jsonMatch) {
        // Fallback 1: unfenced JSON containing requested_rolls — use balanced-brace extraction
        const looseJson = extractBalancedJson(response, 'requested_rolls');
        if (looseJson) {
            console.warn('[ResponseParser] Found unfenced JSON with requested_rolls — attempting parse.');
            try {
                const parsed = JSON.parse(looseJson.json);
                const narrative = response.slice(0, looseJson.startIndex).trim();
                const events = normalizeEvents(parsed);
                console.log('[ResponseParser] Parsed unfenced JSON.');
                return { narrative, events };
            } catch {
                // Try repair before giving up
                try {
                    const parsed = JSON.parse(repairJson(looseJson.json));
                    const narrative = response.slice(0, looseJson.startIndex).trim();
                    const events = normalizeEvents(parsed);
                    console.log('[ResponseParser] Parsed unfenced JSON after repair.');
                    return { narrative, events };
                } catch (e2) {
                    console.warn('[ResponseParser] Failed to parse unfenced JSON:', e2.message);
                }
            }
        }

        // Fallback 2: text roll detector — DM put roll request in narrative prose
        console.log('[ResponseParser] No JSON block — scanning for text-based roll requests.');
        console.log('[ResponseParser] Response tail (last 200 chars):', response.slice(-200));

        const detectedRolls = detectTextRollRequests(response);
        if (detectedRolls.length > 0) {
            console.warn(`[ResponseParser] Detected ${detectedRolls.length} text-based roll request(s) — converting to JSON events.`);
            const events = normalizeEvents({ requested_rolls: detectedRolls });
            events._textRollDetected = true; // Flag for ChatPanel to show a notice
            return { narrative: response.trim(), events };
        }

        // Pure narrative — no events
        return { narrative: response.trim(), events: null };
    }

    // Extract narrative (everything before the JSON block)
    const jsonStart = response.indexOf(jsonMatch[0]);
    const narrative = response.slice(0, jsonStart).trim();

    // Parse the JSON, attempting repair on failure
    let events = null;
    try {
        events = JSON.parse(jsonMatch[1]);
    } catch {
        console.warn('[ResponseParser] JSON parse failed, attempting repair...');
        try {
            events = JSON.parse(repairJson(jsonMatch[1]));
            console.warn('[ResponseParser] JSON repaired successfully.');
        } catch (e2) {
            console.warn('[ResponseParser] JSON repair failed too:', e2.message);
            console.warn('[ResponseParser] Raw JSON string:', jsonMatch[1]);
            return { narrative: response.trim(), events: null };
        }
    }

    events = normalizeEvents(events);

    if (events.requestedRolls.length > 0) {
        console.log(`[ResponseParser] ${events.requestedRolls.length} roll(s) requested:`,
            events.requestedRolls.map(r => `${r.type}: ${r.description} (DC ${r.dc})`).join(', ')
        );
    }

    return { narrative, events };
}

/** Bounded spell_cast entries: a single object, a bare name, or an array of up to 3. */
function normalizeSpellCasts(raw) {
    const list = Array.isArray(raw) ? raw : (raw ? [raw] : []);
    return list.slice(0, 3)
        .map(entry => {
            if (typeof entry === 'string') return entry.trim() ? { spell: entry.trim().slice(0, 80), slotLevel: null, target: null } : null;
            if (!entry || typeof entry !== 'object') return null;
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

/**
 * Normalize and validate event data from the LLM.
 */
export function normalizeEvents(raw) {
    const equipmentChanges = Array.isArray(raw.equipment_changes)
        ? raw.equipment_changes
        : (raw.equipment_change ? [raw.equipment_change] : []);
    const combatStart = validateCombatStart(raw.combat_start);
    const normalizedCombatExchange = normalizeCombatExchange(raw.combat_exchange);
    const combatExchange = combatStart
        ? reconcileStartingCombatExchange(normalizedCombatExchange, combatStart.enemies)
        : normalizedCombatExchange;

    return {
        requestedRolls: Array.isArray(raw.requested_rolls)
            ? raw.requested_rolls.map(r => ({
                type: r.type || 'skill_check',
                skill: r.skill || null,
                ability: r.ability || null,
                dc: typeof r.dc === 'number' ? r.dc : 15,
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
            }))
            : [],
        combatExchange,
        combatExchangeRejected: raw.combat_exchange != null && !combatExchange,
        damageDealt: clamp(raw.damage_dealt, 0, 999),
        damageTaken: clamp(raw.damage_taken, 0, 999),
        startingItems: (Array.isArray(raw.starting_items) ? raw.starting_items : [])
            .map(item => {
                if (typeof item === 'string') return { name: item };
                if (!item || typeof item !== 'object') return null;
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
            })
            .filter(Boolean)
            .slice(0, 12),
        itemsFound: Array.isArray(raw.items_found) ? raw.items_found.slice(0, 20) : [],
        itemsLost: Array.isArray(raw.items_lost) ? raw.items_lost.slice(0, 20) : [],
        equipmentChanges: equipmentChanges
            .map(c => ({
                action: String(c?.action || '').toLowerCase(),
                itemId: c?.itemId || c?.id || null,
                itemKey: c?.itemKey || c?.key || null,
                name: c?.name || c?.item || null,
                type: c?.type || c?.slot || null,
            }))
            .filter(c => c.action === 'equip' || c.action === 'unequip')
            .slice(0, 10),
        purchases: Array.isArray(raw.purchases)
            ? raw.purchases
            : (raw.purchase ? [raw.purchase] : []),
        sells: Array.isArray(raw.sells)
            ? raw.sells
            : (raw.sell ? [raw.sell] : []),
        goldFound: clamp(raw.gold_found, 0, 10000),
        goldLost: clamp(raw.gold_lost, 0, 10000),
        silverFound: clamp(raw.silver_found, 0, 10000),
        silverLost: clamp(raw.silver_lost, 0, 10000),
        copperFound: clamp(raw.copper_found, 0, 10000),
        copperLost: clamp(raw.copper_lost, 0, 10000),
        expAwarded: clamp(raw.exp_awarded, 0, 10000),
        restTaken: typeof raw.rest_taken === 'string' ? raw.rest_taken : null,
        // Out-of-combat casting: the engine validates the spell and spends the slot.
        spellCasts: normalizeSpellCasts(raw.spell_cast ?? raw.spells_cast ?? raw.spell_casts),
        conditionsGained: Array.isArray(raw.conditions_gained) ? raw.conditions_gained : [],
        conditionsRemoved: Array.isArray(raw.conditions_removed) ? raw.conditions_removed : [],
        // Limited class abilities the player spent this turn (e.g. ["secondWind"]).
        resourcesUsed: Array.isArray(raw.resources_used) ? raw.resources_used : [],
        questUpdates: Array.isArray(raw.quest_updates) ? raw.quest_updates : [],
        location: raw.location || null,
        healing: clamp(raw.healing, 0, 999),
        // Combat events (validated to prevent state corruption)
        combatStart,
        combatEnd: !!raw.combat_end,
        enemyUpdates: Array.isArray(raw.enemy_updates) ? raw.enemy_updates : [],
        // Companion events
        addCompanions: Array.isArray(raw.add_companions) ? raw.add_companions : [],
        updateCompanions: Array.isArray(raw.update_companions) ? raw.update_companions : [],
        removeCompanions: Array.isArray(raw.remove_companions) ? raw.remove_companions : [],
        // World memory
        worldFacts: Array.isArray(raw.world_facts)
            ? raw.world_facts.map(f =>
                typeof f === 'string' ? { fact: f, category: 'general' } : f
            )
            : [],
        npcUpdates: Array.isArray(raw.npc_updates) ? raw.npc_updates : [],
        frontUpdates: Array.isArray(raw.front_updates) ? raw.front_updates : [],
        memoryUpdates: Array.isArray(raw.memory_updates) ? raw.memory_updates
            .map(update => {
                if (!update || typeof update !== 'object') return null;
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
            })
            .filter(Boolean)
            .slice(0, 10)
            : [],
        // Player death event (not game-over — triggers narrative transition)
        playerDeath: raw.player_death
            ? { description: raw.player_death.description || 'Your character has fallen.' }
            : null,
        levelUp: !!raw.level_up,
    };
}

/**
 * Apply parsed events to dispatch game state changes.
 * @param {object} events - Normalized events from parseResponse
 * @param {function} dispatch - Game state dispatch function
 */
export function applyEvents(events, dispatch, getState = null, opts = {}) {
    if (!events) return;

    // A roll-setup turn (the player's action that triggered dice) only declares the
    // structural state the dice need — combat starting. Every *outcome* mutation is
    // deferred to the post-roll narration. This stops the DM from double-applying state
    // when it (mis)emits the same fields in both the withheld setup response and the
    // outcome response — the root cause of duplicate resources_used, and the latent
    // double-counting of gold, items, XP, and conditions.
    if (opts.setupPhase) {
        if (events.combatStart) {
            dispatch({
                type: 'START_COMBAT',
                payload: {
                    enemies: events.combatStart.enemies || [],
                    playerInitiative: events.combatStart.player_initiative,
                    surprise: events.combatStart.surprise,
                    queuedExchange: events.combatExchange,
                },
            });
        }
        return;
    }

    // During engine-owned combat, a response without combat_exchange is either a question,
    // clarification, or narration. It has no authority to mutate mechanics. Completed
    // exchanges are committed by APPLY_COMBAT_EXCHANGE and their narration is parsed with
    // narrationOnly, so dropping inline events here cannot discard a legitimate combat turn.
    if (getState?.()?.combat?.active) {
        console.warn('[applyEvents] Ignored non-exchange events during active engine-owned combat.');
        return;
    }

    const state = getState?.();
    const resources = state?.character?.classResources || {};
    const classResourceDefs = CLASSES[state?.character?.class]?.resources || {};
    const uiOwnedResources = events.resourcesUsed.filter(resourceKey => classResourceDefs[resourceKey]);
    const unavailableResources = events.resourcesUsed.filter(resourceKey => {
        const res = resources[resourceKey];
        return res && res.used >= res.max;
    });
    const suppressResourceHealing = (unavailableResources.length > 0 || uiOwnedResources.length > 0) && events.healing > 0;

    // Premise reconciliation has distinct semantics from ordinary loot: starting
    // belongings must not duplicate class gear or each other. Normalize through the
    // catalog first so aliases such as "massive warhammer" share the catalog identity.
    const itemIdentityTokens = item => {
        const normalized = normalizeItem(typeof item === 'string' ? { name: item } : item);
        return [normalized.itemKey, normalized.name]
            .filter(Boolean)
            .map(value => String(value).toLowerCase().replace(/[^a-z0-9]/g, ''));
    };
    const startingInventoryTokens = new Set((state?.inventory || []).flatMap(itemIdentityTokens));
    for (const item of events.startingItems || []) {
        const normalized = normalizeItem(item);
        const tokens = itemIdentityTokens(normalized);
        if (tokens.some(token => startingInventoryTokens.has(token))) {
            console.warn(`[applyEvents] Ignored duplicate premise starting item "${normalized.name}".`);
            continue;
        }
        dispatch({ type: 'ADD_ITEM', payload: normalized });
        tokens.forEach(token => startingInventoryTokens.add(token));
    }

    // Player abilities/consumables are activated through the game UI now, which marks
    // them spent and applies any dice-backed effect. If the DM emits a known player
    // resource anyway, skip the spend and any paired healing so it cannot bypass the UI.
    // If it emits a resource already spent, skip it silently — never fire a contradictory
    // "unavailable" notice for a correct use.
    for (const resourceKey of events.resourcesUsed) {
        if (uiOwnedResources.includes(resourceKey)) continue;
        const res = resources[resourceKey];
        if (res && res.used >= res.max) continue;
        dispatch({ type: 'USE_RESOURCE', payload: resourceKey });
    }

    if (events.damageTaken > 0) {
        dispatch({ type: 'TAKE_DAMAGE', payload: events.damageTaken });
    }

    if (events.healing > 0 && !suppressResourceHealing) {
        dispatch({ type: 'HEAL', payload: events.healing });
    }

    // A `purchase`/`sell` already adds/removes the traded item atomically. If the DM ALSO
    // lists that same item in items_found/items_lost (the prompt forbids it), the item gets
    // duplicated or removed twice. Drop found/lost entries that match a traded item by
    // normalized key or name — the item-side twin of the coin guard below.
    const normToken = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    const itemKeyOf = (it) => (typeof it === 'string' ? '' : (it.itemKey || it.key || ''));
    const itemNameOf = (it) => (typeof it === 'string' ? it : (it.name || ''));
    const tradedTokenSet = (entries, getKey, getName) => {
        const set = new Set();
        for (const e of entries) {
            if (getKey(e)) set.add(normToken(getKey(e)));
            if (getName(e)) set.add(normToken(getName(e)));
        }
        return set;
    };
    const dropMatching = (entries, tokens, action) => {
        if (tokens.size === 0) return entries;
        return entries.filter((it) => {
            const k = itemKeyOf(it);
            const n = itemNameOf(it);
            const dup = (k && tokens.has(normToken(k))) || (n && tokens.has(normToken(n)));
            if (dup) console.warn(`[applyEvents] Ignored a found/lost "${n || k}" already handled by the atomic ${action}.`);
            return !dup;
        });
    };
    const purchasedTokens = tradedTokenSet(events.purchases, (p) => p.itemKey || p.item?.itemKey || p.key, (p) => p.name || p.item?.name);
    const soldTokens = tradedTokenSet(events.sells, (s) => s.itemKey || s.key, (s) => s.name);
    const itemsFound = dropMatching(events.itemsFound, purchasedTokens, 'purchase');
    const itemsLost = dropMatching(events.itemsLost, soldTokens, 'sale');

    // Loot deduplication guard — prevent the same message from granting gold/items twice
    // (e.g. from a re-render, state restore, or DM re-narrating already-applied loot).
    const lootSourceId = opts?.lootSourceId;
    const hasLoot = itemsFound.length > 0
        || (events.goldFound ?? 0) > 0 || (events.silverFound ?? 0) > 0 || (events.copperFound ?? 0) > 0;
    let lootAlreadyClaimed = false;
    if (lootSourceId && hasLoot) {
        if ((getState?.()?.appliedLootSourceIds || []).includes(lootSourceId)) {
            lootAlreadyClaimed = true;
            console.warn(`[applyEvents] Loot from source ${lootSourceId} already applied; skipping items and gold.`);
        } else {
            dispatch({ type: 'CLAIM_LOOT_SOURCE', payload: lootSourceId });
        }
    }

    for (const item of itemsFound) {
        if (lootAlreadyClaimed) break;
        const itemData = typeof item === 'string'
            // Let ADD_ITEM recognize catalog strings before falling back to generic gear.
            ? { name: item }
            : {
                // Let normalizeItem (in ADD_ITEM) fill name/type/weight from the catalog
                // when an itemKey or recognizable name matches — only override when the DM
                // actually specified them. Forcing type:'gear' here hid catalog consumables
                // (e.g. a Potion of Healing granted by itemKey), so their Use button never
                // appeared and they displayed as a generic "Unknown item".
                ...(item.name && { name: item.name }),
                ...(item.type && { type: item.type }),
                ...(Number.isFinite(item.weight) && { weight: item.weight }),
                // Preserve mechanical item properties from LLM/catalog references.
                ...(item.itemKey && { itemKey: item.itemKey }),
                ...(item.key && { itemKey: item.key }),
                ...(item.category && { category: item.category }),
                ...(item.valueCp !== undefined && { valueCp: item.valueCp }),
                ...(item.priceCp !== undefined && { priceCp: item.priceCp }),
                ...(item.rarity && { rarity: item.rarity }),
                ...(item.description && { description: item.description }),
                ...(item.baseAC !== undefined && { baseAC: item.baseAC }),
                ...(item.armorType && { armorType: item.armorType }),
                ...(item.acBonus !== undefined && { acBonus: item.acBonus }),
                ...(item.magicBonus !== undefined && { magicBonus: item.magicBonus }),
                ...(item.isShield && { isShield: true, type: 'shield' }),
                ...(item.shieldAC !== undefined && { shieldAC: item.shieldAC }),
                ...(item.damage && { damage: item.damage }),
                ...(item.damageVersatile && { damageVersatile: item.damageVersatile }),
                ...(item.damageType && { damageType: item.damageType }),
                ...(item.attackBonus !== undefined && { attackBonus: item.attackBonus }),
                ...(item.damageBonus !== undefined && { damageBonus: item.damageBonus }),
                ...(item.ranged !== undefined && { ranged: !!item.ranged }),
                ...(item.finesse !== undefined && { finesse: !!item.finesse }),
                ...(item.thrown !== undefined && { thrown: !!item.thrown }),
                ...(item.twoHanded !== undefined && { twoHanded: !!item.twoHanded }),
                ...(item.versatile !== undefined && { versatile: !!item.versatile }),
                ...(item.consumableType && { consumableType: item.consumableType }),
                ...(item.healing && { healing: item.healing }),
                ...(item.quantity && { quantity: item.quantity }),
            };
        dispatch({ type: 'ADD_ITEM', payload: itemData });
    }

    const transactionMeta = {
        ...(lootSourceId && { sourceId: lootSourceId }),
        ...(opts?.playerMessage && { playerMessage: opts.playerMessage }),
    };
    const withTransactionMeta = (entry) => {
        if (Object.keys(transactionMeta).length === 0) return entry;
        return entry && typeof entry === 'object' && !Array.isArray(entry)
            ? { ...entry, _meta: transactionMeta }
            : { name: String(entry || ''), _meta: transactionMeta };
    };

    for (const purchase of events.purchases) {
        dispatch({ type: 'PURCHASE_ITEM', payload: withTransactionMeta(purchase) });
    }

    for (const sale of events.sells) {
        dispatch({ type: 'SELL_ITEM', payload: withTransactionMeta(sale) });
    }

    for (const itemName of itemsLost) {
        const lostName = typeof itemName === 'string' ? itemName : itemName.name || '';
        if (!lostName) continue;
        dispatch({ type: 'REMOVE_ITEM_BY_NAME', payload: lostName });
    }

    for (const change of events.equipmentChanges) {
        dispatch({
            type: change.action === 'equip' ? 'EQUIP_ITEM_BY_REF' : 'UNEQUIP_ITEM_BY_REF',
            payload: change,
        });
    }

    // An atomic `purchase` already validates funds and deducts payment; a `sell` already
    // credits the proceeds. The DM is told not to ALSO emit loose coin deltas for the same
    // transaction, but it sometimes does — double-charging (or double-paying) the player.
    // Enforce the contract: a purchase suppresses loose coin LOSSES this turn, a sale
    // suppresses loose coin GAINS. This is the root of "the system reduced my coins after
    // I already paid." (A genuinely separate gain/loss is far rarer than this LLM slip,
    // and the prompt already forbids mixing the two.)
    let { goldFound, goldLost, silverFound, silverLost, copperFound, copperLost } = events;
    if (events.purchases.length > 0 && (goldLost > 0 || silverLost > 0 || copperLost > 0)) {
        console.warn('[applyEvents] Ignored loose coin loss emitted alongside an atomic purchase — the purchase already paid.');
        goldLost = silverLost = copperLost = 0;
    }
    if (events.sells.length > 0 && (goldFound > 0 || silverFound > 0 || copperFound > 0)) {
        console.warn('[applyEvents] Ignored loose coin gain emitted alongside an atomic sale — the sale already paid out.');
        goldFound = silverFound = copperFound = 0;
    }

    // Coin gains travel as ONE replay-guarded grant: the recentCoinGrants ledger in the
    // reducer suppresses an identical grant re-emitted within a few messages (a reward
    // narrated again while the pouch is counted/split must not pay twice).
    if (!lootAlreadyClaimed && (goldFound > 0 || silverFound > 0 || copperFound > 0)) {
        dispatch({
            type: 'ADD_COIN_GRANT',
            payload: {
                gold: goldFound,
                silver: silverFound,
                copper: copperFound,
                _meta: transactionMeta,
            },
        });
    }
    if (goldLost > 0) dispatch({ type: 'REMOVE_GOLD', payload: goldLost });
    if (silverLost > 0) dispatch({ type: 'REMOVE_SILVER', payload: silverLost });
    if (copperLost > 0) dispatch({ type: 'REMOVE_COPPER', payload: copperLost });

    if (events.levelUp) {
        // Explicit level-up from the DM — skip ADD_EXP to avoid double-leveling
        // if the awarded XP would also cross the threshold. Any bonus XP carries
        // over as progress toward the next level.
        dispatch({ type: 'LEVEL_UP', payload: { bonusExp: events.expAwarded || 0, reason: 'milestone' } });
    } else if (events.expAwarded > 0) {
        dispatch({ type: 'ADD_EXP', payload: events.expAwarded });
    }

    if (events.restTaken === 'short' || events.restTaken === 'long') {
        // source: 'dm' arms the reducer's rest replay guard — the DM tends to keep
        // re-emitting rest_taken while the rest's narration is still in its window.
        dispatch({ type: 'TAKE_REST', payload: events.restTaken, meta: { source: 'dm', ...transactionMeta } });
    }

    for (const cast of events.spellCasts || []) {
        dispatch({ type: 'CAST_SPELL', payload: withTransactionMeta(cast) });
    }

    for (const condition of events.conditionsGained) {
        dispatch({ type: 'ADD_CONDITION', payload: condition });
    }
    for (const condition of events.conditionsRemoved) {
        dispatch({ type: 'REMOVE_CONDITION', payload: condition });
    }

    for (const quest of events.questUpdates) {
        // Every branch requires an identity — a malformed update with neither id nor
        // name would otherwise create a permanent nameless "ghost" quest row.
        if (!quest || (!quest.id && !String(quest.name || '').trim())) continue;
        if (quest.status === 'new' || quest.status === 'updated') {
            // ADD_QUEST upserts by id/name, so "updated" refreshes the existing entry
            // (or self-heals into a new one if the DM never opened it).
            dispatch({ type: 'ADD_QUEST', payload: { ...(quest.id && { id: quest.id }), name: quest.name, description: quest.description } });
        } else if (quest.status === 'completed' && (quest.id || quest.name)) {
            dispatch({ type: 'COMPLETE_QUEST', payload: { id: quest.id, name: quest.name } });
        } else if (quest.status === 'failed' && (quest.id || quest.name)) {
            dispatch({ type: 'FAIL_QUEST', payload: { id: quest.id, name: quest.name } });
        }
    }

    if (events.combatStart) {
        dispatch({
            type: 'START_COMBAT',
            payload: {
                enemies: events.combatStart.enemies || [],
                playerInitiative: events.combatStart.player_initiative,
                surprise: events.combatStart.surprise,
            },
        });
    }

    if (events.combatEnd) {
        // Pass whether the LLM awarded XP so the reducer can apply a fallback
        dispatch({ type: 'END_COMBAT', payload: { llmAwardedXp: events.expAwarded > 0 } });
    }

    for (const eu of events.enemyUpdates) {
        dispatch({ type: 'UPDATE_ENEMY', payload: eu });
    }

    for (const comp of events.addCompanions) {
        dispatch({ type: 'ADD_COMPANION', payload: comp });
    }
    for (const comp of events.updateCompanions) {
        dispatch({ type: 'UPDATE_COMPANION', payload: comp });
    }
    for (const compName of events.removeCompanions) {
        dispatch({ type: 'REMOVE_COMPANION', payload: { name: compName } });
    }

    if (events.worldFacts.length > 0) {
        dispatch({ type: 'ADD_WORLD_FACTS', payload: events.worldFacts });
    }

    for (const npc of events.npcUpdates) {
        dispatch({ type: 'UPDATE_NPC', payload: npc });
    }

    for (const front of events.frontUpdates) {
        dispatch({ type: 'UPDATE_FRONT', payload: front });
    }

    for (const memory of events.memoryUpdates) {
        dispatch({ type: 'UPDATE_STORY_MEMORY', payload: memory });
    }

    if (events.playerDeath) {
        const character = state?.character;
        const lowLevelSolo = character && (character.level ?? 1) <= 2 && (!state?.party || state.party.length === 0);
        if (lowLevelSolo) {
            dispatch({
                type: 'PLAYER_DEFEAT',
                payload: { description: events.playerDeath.description },
            });
            return;
        }

        dispatch({
            type: 'ADD_MESSAGE',
            payload: {
                role: 'system',
                content: `**${events.playerDeath.description}**\n\nYour story is not over. Describe what happens next — does your spirit linger, possess a body nearby, or does fate have other plans?`,
                isDeathEvent: true,
            },
        });
        dispatch({ type: 'UPDATE_CHARACTER', payload: { currentHP: 0, isDead: true, dying: false } });
    }
}

export async function detectSemanticTextRolls(narrative, settings) {
    const background = getBackgroundConfig(settings);
    if (!background.apiKey || !narrative) return null;

    // Cheap gate: prose that requests a roll essentially always names one of these.
    // Without it, EVERY ordinary no-roll narration pays a blocking LLM round-trip
    // for a detector that almost always returns empty. (DECISIONS.md 2026-06-22
    // rejected regex *extraction* — this only decides whether to make the semantic
    // call at all; false positives merely cost one call.)
    if (!/\b(roll|check|saving throw|save|dc\s*\d|d20)\b/i.test(narrative)) return null;

    const systemPrompt = `You are a parser assistant for a tabletop RPG. Analyze the Dungeon Master's (DM) narrative text to determine if they requested the player to make a non-combat check or saving throw in the text (which violates the system's structured event schema).

For example, if the DM wrote "Make a Perception check (DC 12) to spot the hidden door" or "Roll a Charisma check", extract the requested check.

Output ONLY valid JSON:
{
  "requested_rolls": [
    {
      "type": "skill_check|saving_throw",
      "skill": "perception|stealth|athletics|insight|etc", // the specific skill or ability name
      "dc": 12, // the DC if specified, default to 10
      "description": "The exact check description or context"
    }
  ]
}

If no roll request is found in the text, return:
{
  "requested_rolls": []
}

Output ONLY the JSON, no prose outside the JSON.`;

    try {
        const response = await sendMessage({
            ...background,
            systemPrompt,
            messageHistory: [],
            userMessage: `DM narrative: ${narrative}`,
            temperature: 0.2, // roll detection — determinism over flair
        });

        const jsonMatch = extractBalancedJson(response, 'requested_rolls');
        if (!jsonMatch) return null;

        let parsed;
        try {
            parsed = JSON.parse(jsonMatch.json);
        } catch {
            return null;
        }
        return Array.isArray(parsed.requested_rolls) ? parsed.requested_rolls : null;
    } catch (e) {
        console.warn('[ResponseParser] Semantic roll detection failed:', e.message || e);
        return null;
    }
}

/**
 * @typedef {Object} GameEvents
 * @property {Array} requestedRolls - Dice rolls the DM is requesting
 * @property {number} damageDealt - Damage player dealt to enemies
 * @property {number} damageTaken - Damage player took
 * @property {Array} startingItems - Premise-owned starting belongings, deduplicated against live inventory
 * @property {Array} itemsFound - Items found/received
 * @property {Array} itemsLost - Items lost/consumed
 * @property {Array} questUpdates - Quest state changes
 * @property {string|null} location - Current location name
 * @property {number} healing - HP healed
 */
