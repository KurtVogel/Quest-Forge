/**
 * Response parser — extract game events from LLM responses.
 * Looks for JSON blocks embedded in the narrative text.
 *
 * Failure-mode resilience:
 * - Mode A: DM wrote roll request in text → text roll detector converts it
 * - Mode B/C: DM pre-narrated outcome before roll → flagged for corrector in ChatPanel
 * - Mode D: Malformed JSON → repair attempted before falling back to null
 *
 * The event contract itself (per-channel normalization) lives in
 * eventChannels.js; application (events → dispatches) in state/applyEvents.js.
 * This file owns only text → parsed-JSON extraction and the prose detectors.
 */

import { extractBalancedJson, repairJson } from './utils/jsonExtractor.js';
import { sendMessage } from './adapter.js';
import { getBackgroundConfig } from './machinery.js';
import { normalizeEvents, EVENT_CHANNELS } from './eventChannels.js';
import { isMemoryInspectorEnabled } from '../debug/memoryInspectorStore.js';

export { normalizeEvents };

// Per-turn diagnostics are debug-only: four unconditional logs per ordinary
// turn (including a 200-char response tail) were permanent console churn on
// the phone target. ?debugMemory=1 (or the Settings inspector toggle's URL
// twin) turns them back on.
const debugLog = (...args) => {
    if (isMemoryInspectorEnabled()) console.log(...args);
};

// Anchor keys for rescuing UNFENCED event JSON, derived from the channel
// registry so the list can never drift from the contract. Anchoring only on
// requested_rolls dropped every other unfenced channel silently and leaked the
// raw JSON into the displayed narrative → journal → RAG (2026-08-05 audit P1).
// Plain-word wires (location, healing, purchase…) are excluded: they occur in
// ordinary prose, snake_case keys only ever appear as JSON.
const UNFENCED_EVENT_ANCHORS = EVENT_CHANNELS
    .flatMap(c => [c.wire, ...(c.aliases || [])])
    .filter(key => key.includes('_'));

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
 * @returns {{ narrative: string, events: object | null }}
 */
export function parseResponse(response) {
    if (!response) return { narrative: '', events: null };

    // Try to find a fenced JSON block in the response
    const jsonMatch = response.match(/```json\s*\n?([\s\S]*?)\n?\s*```/);

    debugLog('[ResponseParser] Raw response length:', response.length);
    debugLog('[ResponseParser] JSON block found:', !!jsonMatch);

    if (!jsonMatch) {
        // Fallback 1: unfenced event JSON — balanced-brace extraction anchored on
        // each registry wire key in turn. The anchors usually point into the same
        // object, so the first parseable extraction wins.
        for (const anchor of UNFENCED_EVENT_ANCHORS) {
            const looseJson = extractBalancedJson(response, anchor);
            if (!looseJson) continue;
            let parsed = null;
            try {
                parsed = JSON.parse(looseJson.json);
            } catch {
                try {
                    parsed = JSON.parse(repairJson(looseJson.json));
                } catch {
                    continue; // try the next anchor
                }
            }
            console.warn(`[ResponseParser] Parsed unfenced JSON (anchor: ${anchor}).`);
            const narrative = response.slice(0, looseJson.startIndex).trim();
            return { narrative, events: normalizeEvents(parsed) };
        }

        // Fallback 2: text roll detector — DM put roll request in narrative prose
        debugLog('[ResponseParser] No JSON block — scanning for text-based roll requests.');
        debugLog('[ResponseParser] Response tail (last 200 chars):', response.slice(-200));

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

    // A second fenced block is a real (Grok-observed) behavior class: today only
    // the FIRST block is parsed. Make the drop observable instead of silent.
    const secondFence = response.slice(response.indexOf(jsonMatch[0]) + jsonMatch[0].length).match(/```json/i);
    if (secondFence) {
        console.warn('[ResponseParser] Response contains a second ```json block — only the first is parsed; the rest is discarded.');
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
            debugLog('[ResponseParser] Raw JSON string:', jsonMatch[1]);
            // Unrepairable events are DROPPED — flag it so the caller can surface
            // a visible notice instead of the events vanishing in silence.
            return { narrative: response.trim(), events: null, eventsDropped: true };
        }
    }

    events = normalizeEvents(events);

    if (events.requestedRolls.length > 0) {
        debugLog(`[ResponseParser] ${events.requestedRolls.length} roll(s) requested:`,
            events.requestedRolls.map(r => `${r.type}: ${r.description} (DC ${r.dc})`).join(', ')
        );
    }

    return { narrative, events };
}

export async function detectSemanticTextRolls(narrative, settings) {
    const background = getBackgroundConfig(settings);
    if (!background.apiKey || !narrative) return null;

    // Cheap gate: prose that requests a roll essentially always looks request-
    // shaped. Without it, EVERY ordinary no-roll narration pays a blocking LLM
    // round-trip for a detector that almost always returns empty. (DECISIONS.md
    // 2026-06-22 rejected regex *extraction* — this only decides whether to make
    // the semantic call at all; false positives merely cost one call.) Bare
    // \bcheck\b/\bsave\b matched ordinary prose ("a quick check of the room")
    // — require a request verb NEAR the check/save noun, an explicit DC, or a
    // die name (2026-08-05 audit).
    const requestShaped =
        /\b(?:rolls?|makes?|attempts?|give me|need)\b[\s\S]{0,40}?\b(?:check|save|saving\s+throw)\b/i.test(narrative)
        || /\b(?:check|save|saving\s+throw)\b[\s\S]{0,40}?\b(?:roll|to resist)\b/i.test(narrative)
        || /\bdc\s*\d/i.test(narrative)
        || /\bd20\b/i.test(narrative);
    if (!requestShaped) return null;
    debugLog('[ResponseParser] Semantic roll gate opened — narrative looks request-shaped.');

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
