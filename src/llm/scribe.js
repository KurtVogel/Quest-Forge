/**
 * Scribe — a lightweight Gemini 2.5 Flash call that runs silently after every
 * DM response. It extracts structured world-state updates from the narrative:
 * new world facts, NPC data, and notable consequences.
 *
 * The Scribe does NOT replace the journal summarizer. It runs every turn for
 * granular extraction; the journal runs every 10 messages for narrative archiving.
 *
 * Cost: ~Gemini 2.5 Flash rates (tiny fraction of the DM model cost).
 */

import { sendMessage } from './adapter.js';

const SCRIBE_MODEL = 'gemini-2.5-flash';

const SCRIBE_SYSTEM_PROMPT = `You are a meticulous game world record-keeper. Given a DM's narrative response and the player's action that prompted it, extract any new canonical facts about the game world.

Output ONLY valid JSON:
{
  "world_facts": [
    { "fact": "A canonical statement of something now true in this world", "category": "lore|character|location|event|relationship" }
  ],
  "npc_updates": [
    {
      "name": "NPC name",
      "disposition": "friendly|neutral|hostile|wary|unknown",
      "lastNotes": "brief note on what happened with them this turn",
      "personality": "trait observed (only if newly revealed)",
      "goals": "what they want (only if newly revealed)",
      "secrets": "hidden info (only if newly hinted at or revealed)",
      "lastLocation": "where they are now (only if mentioned)"
    }
  ],
  "location": "Current location if changed, or null"
}

Rules:
- World facts are durable truths: deaths, alliances, betrayals, discoveries, curses, historical facts revealed
- Do NOT record transient action descriptions as facts ("Player attacked goblin" is not a world fact)
- DO record outcomes: "The goblin captain Rarg is dead", "The village of Millhaven burned to the ground"
- Only include npc_updates for NPCs that appeared in this specific exchange
- Only include fields you have actual information for — omit empty/unknown fields
- If nothing notable happened (pure narration, no new facts), return { "world_facts": [], "npc_updates": [], "location": null }
- Output ONLY the JSON, no other text`;

/**
 * Run the Scribe after a DM response to extract world-state updates.
 * Dispatches updates silently — the player never sees this.
 *
 * @param {object} options
 * @param {string} options.playerMessage - The player's input
 * @param {string} options.dmNarrative - The DM's response narrative
 * @param {object} options.settings - Game settings (provider, apiKey)
 * @param {function} options.dispatch - Game state dispatch
 */
export async function runScribe({ playerMessage, dmNarrative, settings, dispatch }) {
    if (!settings.apiKey || !dmNarrative) return;

    try {
        const response = await sendMessage({
            provider: settings.llmProvider,
            apiKey: settings.apiKey,
            model: SCRIBE_MODEL,
            systemPrompt: SCRIBE_SYSTEM_PROMPT,
            messageHistory: [],
            userMessage: `Player action: ${playerMessage}\n\nDM narrative: ${dmNarrative}`,
        });

        const jsonMatch = response.match(/\{[\s\S]*\}/);
        if (!jsonMatch) return;

        const extracted = JSON.parse(jsonMatch[0]);

        if (Array.isArray(extracted.world_facts) && extracted.world_facts.length > 0) {
            dispatch({ type: 'ADD_WORLD_FACTS', payload: extracted.world_facts });
            console.log(`[Scribe] Added ${extracted.world_facts.length} world fact(s)`);
        }

        if (Array.isArray(extracted.npc_updates) && extracted.npc_updates.length > 0) {
            for (const npc of extracted.npc_updates) {
                dispatch({ type: 'UPDATE_NPC', payload: npc });
            }
            console.log(`[Scribe] Updated ${extracted.npc_updates.length} NPC(s)`);
        }

        if (extracted.location) {
            dispatch({ type: 'SET_LOCATION', payload: extracted.location });
        }
    } catch (e) {
        // Scribe failures are silent — they must never block the main game loop
        console.warn('[Scribe] Extraction failed (non-critical):', e.message);
    }
}
