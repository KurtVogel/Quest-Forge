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
import { extractBalancedJson, repairJson } from './utils/jsonExtractor.js';

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
      "appearance": "concrete physical/visual description — build, face, hair, clothing, distinguishing features (only if newly described)",
      "lastLocation": "where they are now (only if mentioned)"
    }
  ],
  "player_appearance": "concrete physical/visual description of the PLAYER's character, only if newly described this turn — otherwise omit",
  "location": "Current location if changed, or null"
}

Rules:
- World facts are durable truths: deaths, alliances, betrayals, discoveries, curses, historical facts revealed
- Do NOT record transient action descriptions as facts ("Player attacked goblin" is not a world fact)
- DO record outcomes: "The goblin captain Rarg is dead", "The village of Millhaven burned to the ground"
- Only include npc_updates for NPCs that appeared in this specific exchange
- Capture "appearance"/"player_appearance" only from concrete visual details the narrative actually states — never invent looks. These feed scene-art generation, so accuracy matters.
- Only include fields you have actual information for — omit empty/unknown fields
- DO NOT alter explicit words or details: copy names, proper nouns, numbers, and specific phrases exactly as the DM wrote them — never rename, paraphrase, translate, or invent. Refer to each NPC by the exact name used in the narrative so their record never forks.
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

        const jsonMatch = extractBalancedJson(response, 'world_facts');
        if (!jsonMatch) return;

        let extracted;
        try {
            extracted = JSON.parse(jsonMatch.json);
        } catch {
            try {
                extracted = JSON.parse(repairJson(jsonMatch.json));
                console.warn('[Scribe] JSON repaired before parsing.');
            } catch (e2) {
                console.warn('[Scribe] JSON parse failed after repair:', e2.message);
                return;
            }
        }

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

        if (typeof extracted.player_appearance === 'string' && extracted.player_appearance.trim()) {
            dispatch({ type: 'UPDATE_CHARACTER', payload: { appearance: extracted.player_appearance.trim() } });
        }

        if (extracted.location) {
            dispatch({ type: 'SET_LOCATION', payload: extracted.location });
        }
    } catch (e) {
        // Scribe failures must never block the main game loop, but log clearly
        console.error('[Scribe] Extraction failed:', e.message || e);
    }
}

const ART_DIRECTOR_PROMPT = `You are the art director for a gritty, mature, dark-fantasy RPG. Given the current scene and the known visual details of the characters and things present, write ONE vivid image-generation prompt that an image model will render.

Rules:
- Output ONLY the prompt text — no preamble, no quotes, no JSON, no explanation.
- 60-110 words. Concrete and visual: describe the characters in frame (using the provided appearances), the setting, composition/framing, lighting, weather, mood, and art style.
- Use the EXACT appearance details provided for each named character so they look consistent across scenes. If a character has no given appearance, infer modestly from their race/class/equipment — do not contradict known details.
- Depict only what the situation supports. This is an adult, gritty world: render violence, grime, and mature/sensual content frankly when the scene calls for it, but keep it grounded, never gratuitous.
- End with a short style tag, e.g. "dark fantasy digital painting, cinematic lighting, highly detailed".
- Do NOT include any on-image text, captions, watermarks, UI, or speech bubbles.`;

/**
 * Compose a single image-generation prompt for the current scene. Runs on demand
 * (when the player requests scene art), not every turn. Pulls together the current
 * situation and the accumulated visual details of the entities likely in frame, and
 * asks the Scribe model to art-direct a finished prompt.
 *
 * @returns {Promise<string|null>} A finished image prompt, or null on failure.
 */
export async function composeScenePrompt({ situation, character, npcs = [], combat, currentLocation, settings }) {
    if (!settings?.apiKey) return null;

    const lines = [];
    if (currentLocation) lines.push(`Location: ${currentLocation}`);
    if (situation) lines.push(`Current situation: ${situation}`);

    if (character) {
        const equipped = (character.equippedSummary || '').trim();
        const desc = character.appearance?.trim()
            || `a ${character.race || ''} ${character.class || 'adventurer'}`.trim();
        lines.push(`Player character — ${character.name}: ${desc}${equipped ? ` Wearing/wielding: ${equipped}.` : ''}`);
    }

    // NPCs likely in frame: most recently active first, capped for prompt size.
    const recentNpcs = [...npcs]
        .sort((a, b) => (b.lastSeen || b.firstMet || 0) - (a.lastSeen || a.firstMet || 0))
        .slice(0, 4)
        .filter(n => n.name);
    for (const n of recentNpcs) {
        const desc = n.appearance?.trim() || `${n.disposition || ''} NPC`.trim();
        lines.push(`NPC — ${n.name}: ${desc}`);
    }

    if (combat?.active && combat.enemies?.length > 0) {
        lines.push(`In combat against: ${combat.enemies.map(e => e.name).filter(Boolean).join(', ')}.`);
    }

    try {
        const prompt = await sendMessage({
            provider: settings.llmProvider,
            apiKey: settings.apiKey,
            model: SCRIBE_MODEL,
            systemPrompt: ART_DIRECTOR_PROMPT,
            messageHistory: [],
            userMessage: lines.join('\n'),
        });
        const cleaned = String(prompt || '').trim();
        return cleaned || null;
    } catch (e) {
        console.log('[Scribe] Image-prompt composition failed:', e.message || e);
        return null;
    }
}
