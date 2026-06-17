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
import { CLASSES } from '../data/classes.js';

/** Cryptographically random integer in [min, max] — replaces Math.random() fallbacks. */
function cryptoRandInt(min, max) {
    const range = max - min + 1;
    return min + (crypto.getRandomValues(new Uint32Array(1))[0] % range);
}

/** Clamp a numeric LLM value to a sane range; non-numbers become the fallback. */
function clamp(value, min, max, fallback = 0) {
    return typeof value === 'number' ? Math.max(min, Math.min(max, value)) : fallback;
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

    const sanitizedEnemies = combatStart.enemies
        .filter(e => e && typeof e.name === 'string' && e.name.trim())
        .map(e => ({
            name: e.name.trim(),
            hp: (typeof e.hp === 'number' && e.hp > 0) ? e.hp : 20,
            ac: (typeof e.ac === 'number' && e.ac > 0) ? e.ac : 12,
            initiative: (typeof e.initiative === 'number') ? e.initiative : cryptoRandInt(1, 20),
        }));

    if (sanitizedEnemies.length === 0) return null;

    return {
        enemies: sanitizedEnemies,
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
function detectTextRollRequests(narrative) {
    const rolls = [];
    const lower = narrative.toLowerCase();

    // Extract DC if mentioned: "DC 15", "DC15", "difficulty class 14"
    const dcMatch = lower.match(/\bdc\s*(\d+)\b/) || lower.match(/difficulty class\s*(\d+)/);
    const dc = dcMatch ? parseInt(dcMatch[1], 10) : 15;

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

/**
 * Normalize and validate event data from the LLM.
 */
function normalizeEvents(raw) {
    const equipmentChanges = Array.isArray(raw.equipment_changes)
        ? raw.equipment_changes
        : (raw.equipment_change ? [raw.equipment_change] : []);

    return {
        requestedRolls: Array.isArray(raw.requested_rolls)
            ? raw.requested_rolls.map(r => ({
                type: r.type || 'skill_check',
                skill: r.skill || null,
                ability: r.ability || null,
                dc: typeof r.dc === 'number' ? r.dc : 15,
                description: r.description || '',
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
        damageDealt: clamp(raw.damage_dealt, 0, 999),
        damageTaken: clamp(raw.damage_taken, 0, 999),
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
        conditionsGained: Array.isArray(raw.conditions_gained) ? raw.conditions_gained : [],
        conditionsRemoved: Array.isArray(raw.conditions_removed) ? raw.conditions_removed : [],
        // Limited class abilities the player spent this turn (e.g. ["secondWind"]).
        resourcesUsed: Array.isArray(raw.resources_used) ? raw.resources_used : [],
        questUpdates: Array.isArray(raw.quest_updates) ? raw.quest_updates : [],
        location: raw.location || null,
        healing: clamp(raw.healing, 0, 999),
        // Combat events (validated to prevent state corruption)
        combatStart: validateCombatStart(raw.combat_start),
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
                },
            });
        }
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

    for (const item of itemsFound) {
        const itemData = typeof item === 'string'
            ? { name: item, type: 'gear', weight: 1 }
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

    for (const purchase of events.purchases) {
        dispatch({ type: 'PURCHASE_ITEM', payload: purchase });
    }

    for (const sale of events.sells) {
        dispatch({ type: 'SELL_ITEM', payload: sale });
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

    if (goldFound > 0) dispatch({ type: 'ADD_GOLD', payload: goldFound });
    if (goldLost > 0) dispatch({ type: 'REMOVE_GOLD', payload: goldLost });
    if (silverFound > 0) dispatch({ type: 'ADD_SILVER', payload: silverFound });
    if (silverLost > 0) dispatch({ type: 'REMOVE_SILVER', payload: silverLost });
    if (copperFound > 0) dispatch({ type: 'ADD_COPPER', payload: copperFound });
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
        dispatch({ type: 'TAKE_REST', payload: events.restTaken });
    }

    for (const condition of events.conditionsGained) {
        dispatch({ type: 'ADD_CONDITION', payload: condition });
    }
    for (const condition of events.conditionsRemoved) {
        dispatch({ type: 'REMOVE_CONDITION', payload: condition });
    }

    for (const quest of events.questUpdates) {
        if (quest.status === 'new') {
            dispatch({ type: 'ADD_QUEST', payload: { name: quest.name, description: quest.description } });
        } else if (quest.status === 'completed' && quest.id) {
            dispatch({ type: 'COMPLETE_QUEST', payload: quest.id });
        }
    }

    if (events.combatStart) {
        dispatch({
            type: 'START_COMBAT',
            payload: {
                enemies: events.combatStart.enemies || [],
                playerInitiative: events.combatStart.player_initiative,
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

/**
 * @typedef {Object} GameEvents
 * @property {Array} requestedRolls - Dice rolls the DM is requesting
 * @property {number} damageDealt - Damage player dealt to enemies
 * @property {number} damageTaken - Damage player took
 * @property {Array} itemsFound - Items found/received
 * @property {Array} itemsLost - Items lost/consumed
 * @property {Array} questUpdates - Quest state changes
 * @property {string|null} location - Current location name
 * @property {number} healing - HP healed
 */
