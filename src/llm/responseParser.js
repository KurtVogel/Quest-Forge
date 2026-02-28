/**
 * Response parser — extract game events from LLM responses.
 * Looks for JSON blocks embedded in the narrative text.
 */

/**
 * Parse an LLM response to extract narrative text and game events.
 * @param {string} response - Full LLM response text
 * @returns {{ narrative: string, events: GameEvents | null }}
 */
export function parseResponse(response) {
    if (!response) return { narrative: '', events: null };

    // Try to find a JSON block in the response
    const jsonMatch = response.match(/```json\s*\n?([\s\S]*?)\n?\s*```/);

    console.log('[ResponseParser] Raw response length:', response.length);
    console.log('[ResponseParser] JSON block found:', !!jsonMatch);

    if (!jsonMatch) {
        // Check if the response contains JSON-like content without proper fencing
        const looseJsonMatch = response.match(/\{[\s\S]*"requested_rolls"[\s\S]*\}/);
        if (looseJsonMatch) {
            console.warn('[ResponseParser] ⚠️ Found unfenced JSON with requested_rolls! DM forgot to fence it.');
            console.log('[ResponseParser] Attempting to parse unfenced JSON...');
            try {
                const parsed = JSON.parse(looseJsonMatch[0]);
                const jsonStart = response.indexOf(looseJsonMatch[0]);
                const narrative = response.slice(0, jsonStart).trim();
                const events = normalizeEvents(parsed);
                console.log('[ResponseParser] ✅ Successfully parsed unfenced JSON, events:', events);
                return { narrative, events };
            } catch (e) {
                console.warn('[ResponseParser] Failed to parse unfenced JSON:', e.message);
            }
        }

        // No JSON block — pure narrative
        console.log('[ResponseParser] No JSON block — pure narrative response');
        // Log a snippet of the response tail to help debug
        console.log('[ResponseParser] Response tail (last 200 chars):', response.slice(-200));
        return { narrative: response.trim(), events: null };
    }

    // Extract narrative (everything before the JSON block)
    const jsonStart = response.indexOf(jsonMatch[0]);
    const narrative = response.slice(0, jsonStart).trim();

    // Parse the JSON
    let events = null;
    try {
        events = JSON.parse(jsonMatch[1]);
        console.log('[ResponseParser] ✅ Parsed JSON events:', JSON.stringify(events, null, 2));
        events = normalizeEvents(events);
        console.log('[ResponseParser] Normalized events:', JSON.stringify(events, null, 2));

        if (events.requestedRolls.length > 0) {
            console.log(`[ResponseParser] 🎲 ${events.requestedRolls.length} roll(s) requested:`,
                events.requestedRolls.map(r => `${r.type}: ${r.description} (DC ${r.dc})`).join(', ')
            );
        }
    } catch (e) {
        console.warn('[ResponseParser] ❌ Failed to parse LLM event JSON:', e);
        console.warn('[ResponseParser] Raw JSON string:', jsonMatch[1]);
        // Return full response as narrative if JSON parsing fails
        return { narrative: response.trim(), events: null };
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
                type: r.type || 'ability_check',
                skill: r.skill || null,
                ability: r.ability || null,
                dc: typeof r.dc === 'number' ? r.dc : 15,
                description: r.description || '',
                // NPC attack fields
                attacker: r.attacker || null,
                modifier: typeof r.modifier === 'number' ? r.modifier : null,
                // Damage roll field
                notation: r.notation || null,
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

    // Apply damage taken
    if (events.damageTaken > 0) {
        dispatch({ type: 'TAKE_DAMAGE', payload: events.damageTaken });
    }

    // Apply healing
    if (events.healing > 0) {
        dispatch({ type: 'HEAL', payload: events.healing });
    }

    // Add found items to inventory
    for (const item of events.itemsFound) {
        const itemData = typeof item === 'string'
            ? { name: item, type: 'gear', weight: 1 }
            : item;
        dispatch({ type: 'ADD_ITEM', payload: itemData });
    }

    // Remove lost items from inventory
    for (const itemName of events.itemsLost) {
        // Just track it — user can manually remove from inventory
        // (We don't want to auto-remove in case the LLM hallucinates)
        console.log(`DM says item lost: ${itemName}`);
    }

    // Process Gold
    if (events.goldFound > 0) {
        dispatch({ type: 'ADD_GOLD', payload: events.goldFound });
    }
    if (events.goldLost > 0) {
        dispatch({ type: 'REMOVE_GOLD', payload: events.goldLost });
    }

    // Process Silver
    if (events.silverFound > 0) {
        dispatch({ type: 'ADD_SILVER', payload: events.silverFound });
    }
    if (events.silverLost > 0) {
        dispatch({ type: 'REMOVE_SILVER', payload: events.silverLost });
    }

    // Process Copper
    if (events.copperFound > 0) {
        dispatch({ type: 'ADD_COPPER', payload: events.copperFound });
    }
    if (events.copperLost > 0) {
        dispatch({ type: 'REMOVE_COPPER', payload: events.copperLost });
    }

    // Process Experience
    if (events.expAwarded > 0) {
        dispatch({ type: 'ADD_EXP', payload: events.expAwarded });
    }

    // Process Rests (short or long)
    if (events.restTaken === 'short' || events.restTaken === 'long') {
        dispatch({ type: 'TAKE_REST', payload: events.restTaken });
    }

    // Process Conditions
    for (const condition of events.conditionsGained) {
        dispatch({ type: 'ADD_CONDITION', payload: condition });
    }
    for (const condition of events.conditionsRemoved) {
        dispatch({ type: 'REMOVE_CONDITION', payload: condition });
    }

    // Add quest updates
    for (const quest of events.questUpdates) {
        if (quest.status === 'new') {
            dispatch({
                type: 'ADD_QUEST',
                payload: { name: quest.name, description: quest.description },
            });
        } else if (quest.status === 'completed' && quest.id) {
            dispatch({ type: 'COMPLETE_QUEST', payload: quest.id });
        }
    }

    // Combat events
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
        dispatch({ type: 'END_COMBAT' });
    }

    for (const eu of events.enemyUpdates) {
        dispatch({ type: 'UPDATE_ENEMY', payload: eu });
    }

    // Process Companions
    for (const comp of events.addCompanions) {
        dispatch({ type: 'ADD_COMPANION', payload: comp });
    }
    for (const comp of events.updateCompanions) {
        dispatch({ type: 'UPDATE_COMPANION', payload: comp });
    }
    for (const compName of events.removeCompanions) {
        dispatch({ type: 'REMOVE_COMPANION', payload: { name: compName } });
    }

    // World facts from DM
    if (events.worldFacts.length > 0) {
        dispatch({ type: 'ADD_WORLD_FACTS', payload: events.worldFacts });
    }

    // NPC rich updates from DM or Scribe
    for (const npc of events.npcUpdates) {
        dispatch({ type: 'UPDATE_NPC', payload: npc });
    }

    // Player death — narrative transition, not game over
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
