/**
 * Response parser — extract game events from LLM responses.
 * Looks for JSON blocks embedded in the narrative text.
 *
 * Failure-mode resilience:
 * - Mode A: DM wrote roll request in text → text roll detector converts it
 * - Mode B/C: DM pre-narrated outcome before roll → flagged for corrector in ChatPanel
 * - Mode D: Malformed JSON → repair attempted before falling back to null
 */

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
 * Attempt to repair common JSON formatting issues before giving up.
 * @param {string} str - Raw JSON string
 * @returns {string} Repaired string (may still be invalid)
 */
function repairJson(str) {
    // Remove trailing commas before } or ]
    let repaired = str.replace(/,\s*([\}\]])/g, '$1');
    // Count open vs close braces/brackets and close unclosed ones
    const openBraces = (repaired.match(/\{/g) || []).length;
    const closeBraces = (repaired.match(/\}/g) || []).length;
    const openBrackets = (repaired.match(/\[/g) || []).length;
    const closeBrackets = (repaired.match(/\]/g) || []).length;
    if (openBrackets > closeBrackets) repaired += ']'.repeat(openBrackets - closeBrackets);
    if (openBraces > closeBraces) repaired += '}'.repeat(openBraces - closeBraces);
    return repaired;
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
            const type = match[0].toLowerCase().includes('save') ? 'saving_throw' : 'skill_check';
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
        // Fallback 1: unfenced JSON containing requested_rolls
        const looseJsonMatch = response.match(/\{[\s\S]*"requested_rolls"[\s\S]*\}/);
        if (looseJsonMatch) {
            console.warn('[ResponseParser] ⚠️ Found unfenced JSON with requested_rolls — attempting parse.');
            try {
                const parsed = JSON.parse(looseJsonMatch[0]);
                const jsonStart = response.indexOf(looseJsonMatch[0]);
                const narrative = response.slice(0, jsonStart).trim();
                const events = normalizeEvents(parsed);
                console.log('[ResponseParser] ✅ Parsed unfenced JSON.');
                return { narrative, events };
            } catch (e) {
                console.warn('[ResponseParser] Failed to parse unfenced JSON:', e.message);
            }
        }

        // Fallback 2: text roll detector — DM put roll request in narrative prose
        console.log('[ResponseParser] No JSON block — scanning for text-based roll requests.');
        console.log('[ResponseParser] Response tail (last 200 chars):', response.slice(-200));

        const detectedRolls = detectTextRollRequests(response);
        if (detectedRolls.length > 0) {
            console.warn(`[ResponseParser] 🎲 Detected ${detectedRolls.length} text-based roll request(s) — converting to JSON events.`);
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
    } catch (e) {
        console.warn('[ResponseParser] ❌ JSON parse failed, attempting repair...');
        try {
            events = JSON.parse(repairJson(jsonMatch[1]));
            console.warn('[ResponseParser] ✅ JSON repaired successfully.');
        } catch (e2) {
            console.warn('[ResponseParser] ❌ JSON repair failed too:', e2.message);
            console.warn('[ResponseParser] Raw JSON string:', jsonMatch[1]);
            return { narrative: response.trim(), events: null };
        }
    }

    events = normalizeEvents(events);

    if (events.requestedRolls.length > 0) {
        console.log(`[ResponseParser] 🎲 ${events.requestedRolls.length} roll(s) requested:`,
            events.requestedRolls.map(r => `${r.type}: ${r.description} (DC ${r.dc})`).join(', ')
        );
    }

    return { narrative, events };
}

/**
 * Normalize and validate event data from the LLM.
 */
function normalizeEvents(raw) {
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
                modifier: typeof r.modifier === 'number' ? r.modifier : null,
                // Damage roll field
                notation: r.notation || null,
                // Advantage / Disadvantage
                advantage: !!r.advantage,
                disadvantage: !!r.disadvantage,
            }))
            : [],
        damageDealt: typeof raw.damage_dealt === 'number' ? raw.damage_dealt : 0,
        damageTaken: typeof raw.damage_taken === 'number' ? raw.damage_taken : 0,
        itemsFound: Array.isArray(raw.items_found) ? raw.items_found : [],
        itemsLost: Array.isArray(raw.items_lost) ? raw.items_lost : [],
        goldFound: typeof raw.gold_found === 'number' ? raw.gold_found : 0,
        goldLost: typeof raw.gold_lost === 'number' ? raw.gold_lost : 0,
        silverFound: typeof raw.silver_found === 'number' ? raw.silver_found : 0,
        silverLost: typeof raw.silver_lost === 'number' ? raw.silver_lost : 0,
        copperFound: typeof raw.copper_found === 'number' ? raw.copper_found : 0,
        copperLost: typeof raw.copper_lost === 'number' ? raw.copper_lost : 0,
        expAwarded: typeof raw.exp_awarded === 'number' ? raw.exp_awarded : 0,
        restTaken: typeof raw.rest_taken === 'string' ? raw.rest_taken : null,
        conditionsGained: Array.isArray(raw.conditions_gained) ? raw.conditions_gained : [],
        conditionsRemoved: Array.isArray(raw.conditions_removed) ? raw.conditions_removed : [],
        questUpdates: Array.isArray(raw.quest_updates) ? raw.quest_updates : [],
        location: raw.location || null,
        healing: typeof raw.healing === 'number' ? raw.healing : 0,
        // Combat events
        combatStart: raw.combat_start || null,
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
    };
}

/**
 * Apply parsed events to dispatch game state changes.
 * @param {object} events - Normalized events from parseResponse
 * @param {function} dispatch - Game state dispatch function
 */
export function applyEvents(events, dispatch) {
    if (!events) return;

    if (events.damageTaken > 0) {
        dispatch({ type: 'TAKE_DAMAGE', payload: events.damageTaken });
    }

    if (events.healing > 0) {
        dispatch({ type: 'HEAL', payload: events.healing });
    }

    for (const item of events.itemsFound) {
        const itemData = typeof item === 'string'
            ? { name: item, type: 'gear', weight: 1 }
            : item;
        dispatch({ type: 'ADD_ITEM', payload: itemData });
    }

    for (const itemName of events.itemsLost) {
        console.log(`DM says item lost: ${itemName}`);
    }

    if (events.goldFound > 0) dispatch({ type: 'ADD_GOLD', payload: events.goldFound });
    if (events.goldLost > 0) dispatch({ type: 'REMOVE_GOLD', payload: events.goldLost });
    if (events.silverFound > 0) dispatch({ type: 'ADD_SILVER', payload: events.silverFound });
    if (events.silverLost > 0) dispatch({ type: 'REMOVE_SILVER', payload: events.silverLost });
    if (events.copperFound > 0) dispatch({ type: 'ADD_COPPER', payload: events.copperFound });
    if (events.copperLost > 0) dispatch({ type: 'REMOVE_COPPER', payload: events.copperLost });

    if (events.expAwarded > 0) {
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

    if (events.combatEnd) dispatch({ type: 'END_COMBAT' });

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
        dispatch({
            type: 'ADD_MESSAGE',
            payload: {
                role: 'system',
                content: `💀 **${events.playerDeath.description}**\n\nYour story is not over. Describe what happens next — does your spirit linger, possess a body nearby, or does fate have other plans?`,
                isDeathEvent: true,
            },
        });
        dispatch({ type: 'UPDATE_CHARACTER', payload: { currentHP: 0, isDead: true } });
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
