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

import { parseBalancedJsonAt, parseJsonObjectLoose, parseJsonText, scanBalancedObject } from './utils/jsonExtractor.js';
import { findSkillInText, SKILL_ABILITIES } from '../engine/rules.js';
import { markTurn } from './turnFlags.js';
import { sendMessage } from './adapter.js';
import { getPreCommitConfig } from './machinery.js';
import { normalizeEvents, EVENT_CHANNELS, KNOWN_WIRE_KEYS } from './eventChannels.js';
import { isMemoryInspectorEnabled } from '../debug/memoryInspectorStore.js';
import { DEFAULT_ROLL_DC } from '../config/contentLimits.js';

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
// ordinary prose, snake_case keys only ever appear as JSON. An object of ONLY
// plain-word wires on its own line is caught by `findPlainWireObject` instead.
const UNFENCED_EVENT_ANCHORS = EVENT_CHANNELS
    .flatMap(c => [c.wire, ...(c.aliases || [])])
    .filter(key => key.includes('_'));

// The skill / ability / attack phrases the prose detector listens for, DERIVED
// from the engine's own skill table (2026-10-11 audit P2): the old private
// 27-entry list was substring-matched both ways, so "Roll an Int check" read
// as Intimidation (Charisma −1 on a rogue with INT 14), "Make an Int save"
// as an Intimidation SAVE, and "Thieves' Tools check" minted a key the engine
// has no skill for, at +0 — a wrong stat rolled silently where a roll the
// engine cannot name is refused out loud ("Roll skipped", 2026-09-10). Every
// detected phrase is canonicalized through `findSkillInText`, the one lookup
// the wire's `resolveRollSkill` runs one step later.
const ROLL_SKILL_PHRASES = [
    ...Object.keys(SKILL_ABILITIES).map(key => key.replace(/([A-Z])/g, ' $1').toLowerCase().trim()),
    'strength', 'dexterity', 'constitution', 'intelligence', 'wisdom', 'charisma',
    // 'initiative' retired 2026-08-27 (DECISIONS.md): initiative is engine-owned
    // (START_COMBAT rolls it); a detected prose request had no consumer.
    'attack',
];

// Pattern 2 of detectTextRollRequests, compiled ONCE (2026-09-28 audit P2: it
// built one RegExp per known skill on every prose-only reply). Non-global, so
// `.test` carries no lastIndex state between calls. Word-bounded on both
// sides of the phrase, like findSkillInText.
const SKILL_REQUEST_PATTERNS = ROLL_SKILL_PHRASES.map(phrase => ({
    phrase,
    pattern: new RegExp(
        // `\)?` admits 5e's paren spelling, "Wisdom (Insight) check" (2026-10-24).
        `\\b(?:rolls?|makes?|attempts?|gives? me|need)\\b[\\s\\S]{0,40}?\\b${phrase.replace(/ /g, '[\\s-]*')}\\)?\\s+(?:check|save|saving throw)\\b`,
        'i',
    ),
}));

// Outcome language that should never appear BEFORE dice are rolled.
// 'you notice' was dropped 2026-10-24 (audit P2 nit): it is the ordinary
// opener of SETUP prose ("You notice the lock is old iron. Pick it?") and
// flagged a pre-narrated outcome on roll-free scene description; 'you spot'
// stays (a Perception result in 5e's own words). 'you find the' stays too —
// it is a search outcome, and no setup fixture depends on it either way.
const OUTCOME_KEYWORDS = [
    'you succeed', 'you fail', 'you hit', 'you miss', 'misses you',
    'strikes true', 'you manage to', 'you land', 'you slay', 'you kill',
    'falls dead', 'you spot', 'you find the', 'critical hit',
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

    // Pattern 1: "roll a/an [skill] check/save" — the skill phrase may carry
    // 5e's own paren spelling, "Wisdom (Insight) check" (the paren group is
    // part of the captured phrase; findSkillInText names the skill inside it).
    const rollPattern = /(?:roll|make|attempt)\s+(?:a|an)\s+([\w\s']+?(?:\s*\([\w\s']+\))?)\s+(?:check|save|saving throw)/gi;
    let match;
    while ((match = rollPattern.exec(narrative)) !== null) {
        // The engine's own lookup names the skill, or there is no roll here.
        const skill = findSkillInText(match[1]);
        if (skill) {
            // Note: "saving" does NOT contain the substring "save" — match both forms.
            const type = /sav(e|ing)/i.test(match[0]) ? 'saving_throw' : 'skill_check';
            const dc = dcForMatch(narrative, match.index, match[0].length);
            rolls.push({ type, skill, dc, description: match[0].trim() });
        }
    }

    // Pattern 2: "[Skill] check" NEAR a request verb (e.g. "give me a Perception
    // check"). A request verb is required like Pattern 1 — the bare noun phrase
    // fired on RECAP prose ("your earlier Perception check served you well") and
    // minted a phantom DC-10 proposal (2026-08-29 audit). Genuinely verb-less
    // prose requests stay covered by the semantic detector + arbiter.
    if (rolls.length === 0) {
        for (const { phrase, pattern: skillPattern } of SKILL_REQUEST_PATTERNS) {
            const hit = narrative.match(skillPattern);
            if (!hit) continue;
            const skill = findSkillInText(phrase);
            if (!skill) continue;
            const type = /save|saving throw/i.test(hit[0]) ? 'saving_throw' : 'skill_check';
            const dc = dcForMatch(narrative, hit.index, hit[0].length);
            rolls.push({ type, skill, dc, description: `${phrase} check (DC ${dc})` });
            break; // One detected roll per response is enough to trigger the system
        }
    }

    return rolls;
}

/**
 * The DC of ONE detected prose request: the number inside the match or in the
 * clause right after it ("Make a Stealth check (DC 12)", "Roll Athletics, DC
 * 15"), else the engine's one default. The detector used to read the FIRST
 * "DC n" in the whole reply (2026-10-24 audit P2): two requests in one reply
 * both priced at the first, and a recap's "your DC 18 Athletics feat" re-priced
 * a new Persuasion check at 18 — the 10-05 ruling class through the detector.
 */
const DC_AFTER_MATCH_CHARS = 40;
const DC_PATTERN = /\b(?:dc|difficulty class)\s*(\d+)\b/i;
function dcForMatch(narrative, index, length) {
    const matched = narrative.slice(index, index + length);
    // The clause right after the match: up to a sentence end, within a short window.
    const after = narrative.slice(index + length, index + length + DC_AFTER_MATCH_CHARS).split(/[.!?\n]/)[0];
    const hit = matched.match(DC_PATTERN) || after.match(DC_PATTERN);
    return hit ? parseInt(hit[1], 10) : DEFAULT_ROLL_DC;
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
 * THE fence grammar (2026-10-11 audit P2 — the finder, the second-fence
 * warning and the trailing strip each had their own idea of a fence, so a
 * bare ``` block after the ```json block shipped as raw JSON in the story
 * while its events vanished without a warning): every fenced JSON block in
 * the response, in order, each `{ full, body, index }`. The first is the
 * events block; the rest are discarded WITH a warning and stripped from the
 * prose. A block is a ```json fence (tag case-insensitive) or a bare ```
 * fence whose body is an object — both used to fall to the anchor path and
 * leave a dangling opener on the narrative (2026-09-05 audit). An object
 * body's extent is a string-aware balanced-brace walk closed by the NEXT
 * fence, so a ``` inside a JSON string value no longer ends the block early
 * — `"Read the ``` sign"` minted quest "Read the" AND appended the JSON
 * tail to the story as prose (2026-09-15 audit P2); the lazy regex remains
 * the fallback for a ```json body that is not an object. A bare fence
 * around prose (a sign, a letter) is never a block.
 */
export function findFencedJsonBlocks(response) {
    const blocks = [];
    let from = 0;
    while (from < response.length) {
        const rest = response.slice(from);
        // The EARLIEST opener of either kind — a tagged fence later in the
        // reply must not outrank a bare object block before it.
        // The tag admits ```jsonc / ```json5 / "``` json" (2026-10-24 audit
        // P2: `jsonc` matched the old tag with its `c` as the body's first byte).
        const tagged = rest.match(/```\s*json\w*\s*/i);
        const bare = rest.match(/```\s*(?=\{)/);
        const opener = (tagged && bare) ? (tagged.index <= bare.index ? tagged : bare) : (tagged || bare);
        if (!opener) break;
        const index = from + opener.index;
        const bodyStart = index + opener[0].length;
        let block = null;
        if (response[bodyStart] === '{') {
            const end = scanBalancedObject(response, bodyStart);
            // A TAGGED fence closes at the next fence; a BARE fence must close
            // right after its object (a bare fence around prose is never a block).
            const closerRule = /^```\s*json/i.test(opener[0]) ? /^[\s\S]*?```/ : /^\s*```/;
            const closer = end === -1 ? null : response.slice(end).match(closerRule);
            if (closer) {
                // The balanced object IS the body, whatever follows it up to
                // the closer: a note the DM left inside the fence after the
                // object is prose to append, never a reason to drop the events
                // (2026-10-24 audit P2 — the walk had the object in hand and
                // discarded it because the closer was not NEXT).
                const note = response.slice(end, end + closer[0].length - 3).trim();
                block = { full: response.slice(index, end + closer[0].length), body: response.slice(bodyStart, end), index, note };
            }
        }
        if (!block && /^```\s*json/i.test(opener[0])) {
            const lazy = rest.slice(opener.index).match(/^```\s*json\w*\s*\n?([\s\S]*?)\n?\s*```/i);
            if (lazy) block = { full: lazy[0], body: lazy[1], index };
        }
        if (block) {
            blocks.push(block);
            from = block.index + block.full.length;
        } else {
            from = bodyStart;
        }
    }
    return blocks;
}

/**
 * The UNFENCED lane's result — the twin of the fenced lane's prose rule
 * (2026-10-24 audit P1): the prose BEFORE the block and the prose AFTER it,
 * joined. The lane used to keep only the prose before (`slice(0, startIndex)`),
 * so a JSON-first unfenced reply committed a BLANK assistant row with its
 * events applied, and a mid-reply block dropped THE ASK after it.
 *
 * A truncated / unclosed fence leaves its opener dangling at the end of the
 * prose before the block: strip it, and the closer it may still have at the
 * head of the tail. Only an ODD fence count is dangling — a CLOSED prose
 * fence before the block (a sign, a letter) keeps its closer (the old strip
 * removed ANY trailing ``` and left that fence open, rendering the rest of
 * the row as code — 2026-10-24 nit).
 */
function unfencedResult(response, start, end, value) {
    let before = response.slice(0, start);
    let after = response.slice(end);
    const fences = (before.match(/```/g) || []).length;
    if (fences % 2 === 1 && /```[^\n]*\s*$/.test(before)) {
        before = before.replace(/```[^\n]*\s*$/, '');
        after = after.replace(/^\s*```\w*/, '');
    }
    let narrative = before.trim();
    const trailing = after.trim();
    if (trailing) {
        console.warn('[ResponseParser] Prose after the unfenced JSON — appended to the narrative.');
        narrative = narrative ? `${narrative}\n\n${trailing}` : trailing;
    }
    return { narrative, events: normalizeEvents(value) };
}

/**
 * An unfenced object on its OWN line whose top-level keys are all registered
 * wires — `{"healing": 8, "location": "The Mill"}` — is JSON, not prose,
 * though no snake_case anchor names it (2026-10-24 audit nit). Returns
 * `{ start, end, value }` or null. The key test is the whole gate: prose that
 * happens to open a line with a brace never carries only wire keys.
 */
function findPlainWireObject(response) {
    const lineStart = /^[ \t]*\{/gm;
    let hit;
    while ((hit = lineStart.exec(response)) !== null) {
        const start = hit.index + hit[0].length - 1;
        const end = scanBalancedObject(response, start);
        if (end === -1) return null;
        const value = parseJsonText(response.slice(start, end));
        if (value && typeof value === 'object' && !Array.isArray(value)) {
            const keys = Object.keys(value);
            if (keys.length > 0 && keys.every(key => KNOWN_WIRE_KEYS.has(key))) return { start, end, value };
        }
        lineStart.lastIndex = end;
    }
    return null;
}

/**
 * Parse an LLM response to extract narrative text and game events.
 * @param {string} response - Full LLM response text
 * @returns {{ narrative: string, events: object | null }}
 */
export function parseResponse(response) {
    // Callers pass strings; a non-string is no response, never a
    // `response.match is not a function` throw (2026-09-15 audit P2 belt).
    if (typeof response !== 'string' || !response) return { narrative: '', events: null };

    const blocks = findFencedJsonBlocks(response);
    const jsonMatch = blocks[0] || null;

    debugLog('[ResponseParser] Raw response length:', response.length);
    debugLog('[ResponseParser] JSON block found:', !!jsonMatch);

    if (!jsonMatch) {
        // Fallback 1: unfenced event JSON — balanced-brace extraction anchored on
        // each registry wire key in turn. The anchors usually point into the same
        // object, so the first parseable extraction wins. The extract→parse→repair
        // walk is the shared jsonExtractor one; startIndex slices the narrative off.
        for (const anchor of UNFENCED_EVENT_ANCHORS) {
            const parsed = parseBalancedJsonAt(response, anchor);
            if (!parsed) continue; // try the next anchor
            console.warn(`[ResponseParser] Parsed unfenced JSON (anchor: ${anchor}).`);
            // The block's extent is the string-aware balanced walk from its
            // start; a truncated (repaired) block runs to the end of the reply.
            const end = scanBalancedObject(response, parsed.startIndex);
            return unfencedResult(response, parsed.startIndex, end === -1 ? response.length : end, parsed.value);
        }
        // Fallback 1b: an unfenced object on its own line whose keys are ALL
        // registered wires ({"healing": 8, "location": "The Mill"}) — the
        // anchors exclude plain-word wires by design, so it rode the narrative
        // raw into the chat, the save, the window and RAG (2026-10-24 audit).
        const plainWires = findPlainWireObject(response);
        if (plainWires) {
            console.warn('[ResponseParser] Parsed unfenced JSON (plain-word wires on their own line).');
            return unfencedResult(response, plainWires.start, plainWires.end, plainWires.value);
        }

        // Fallback 2: text roll detector — DM put roll request in narrative prose
        debugLog('[ResponseParser] No JSON block — scanning for text-based roll requests.');
        debugLog('[ResponseParser] Response tail (last 200 chars):', response.slice(-200));

        const detectedRolls = detectTextRollRequests(response);
        if (detectedRolls.length > 0) {
            console.warn(`[ResponseParser] Detected ${detectedRolls.length} text-based roll request(s) — converting to JSON events.`);
            const events = normalizeEvents({ requested_rolls: detectedRolls });
            markTurn(events, { textRollDetected: true }); // read by turnVisibility's proposal-from-prose rule
            return { narrative: response.trim(), events };
        }

        // Pure narrative — no events
        return { narrative: response.trim(), events: null };
    }

    // A second fenced block is a real (Grok-observed) behavior class: only
    // the FIRST block is parsed. The drop is observable, never silent — and
    // the warning counts exactly the blocks the strip below removes.
    const extraBlocks = blocks.slice(1);
    if (extraBlocks.length > 0) {
        console.warn(`[ResponseParser] Response contains ${extraBlocks.length} further fenced JSON block(s) — only the first is parsed; the rest are discarded.`);
    }

    // Extract narrative (everything before the JSON block). Prose AFTER the
    // fence used to vanish silently — and a JSON-first response committed an
    // EMPTY assistant message — so non-empty trailing text (minus every
    // further fenced block, discarded with the warning above) is appended.
    const jsonStart = jsonMatch.index;
    let narrative = response.slice(0, jsonStart).trim();
    let trailing = response.slice(jsonStart + jsonMatch.full.length);
    for (const block of extraBlocks) trailing = trailing.replace(block.full, '');
    trailing = trailing.trim();
    // An in-fence note after the object is prose too (the fence grammar hands
    // it over) — but only once the object has PARSED: on the dropped path the
    // "note" is the tail of the broken block, and a tail of stray brackets
    // after a balanced object is never prose.
    const note = jsonMatch.note && !/^[\s\]}),;]*$/.test(jsonMatch.note) ? jsonMatch.note : '';
    const appendTrailing = (extra) => {
        const tail = [extra, trailing].filter(Boolean).join('\n\n');
        if (!tail) return;
        console.warn('[ResponseParser] Prose after the JSON block — appended to the narrative.');
        narrative = narrative ? `${narrative}\n\n${tail}` : tail;
    };

    // Parse the JSON, attempting repair on failure
    // Parse → repair once (jsonExtractor's ONE walk, 2026-10-11).
    // A body that parses to a non-object (`null`, a scalar, a list) carries
    // NO events — `events: null`, the pure-narrative shape, so a reply that
    // is only such a block is an EMPTY reply to the orchestrator's guard
    // (2026-10-24 audit P2: normalizeEvents coerced it to an empty bag, the
    // guard read the bag as events, and a blank bubble committed). Only a
    // body nothing can parse is DROPPED (flagged below).
    let events = parseJsonText(jsonMatch.body, { label: 'ResponseParser' });
    if (events !== undefined && (events === null || typeof events !== 'object' || Array.isArray(events))) {
        console.warn('[ResponseParser] Fenced block is not an object — no events.');
        appendTrailing(note);
        return { narrative, events: null };
    }
    if (events === undefined) {
        appendTrailing('');
        debugLog('[ResponseParser] Raw JSON string:', jsonMatch.body);
        // Unrepairable events are DROPPED — flag it so the caller can surface
        // a visible notice instead of the events vanishing in silence. The
        // narrative is the PROSE only: returning the full response leaked the
        // raw broken JSON into the story, the save, the DM's own window
        // (self-priming), the journal, and RAG (2026-09-05 audit P1).
        return { narrative, events: null, eventsDropped: true };
    }

    appendTrailing(note);
    events = normalizeEvents(events);

    if (events.requestedRolls.length > 0) {
        debugLog(`[ResponseParser] ${events.requestedRolls.length} roll(s) requested:`,
            events.requestedRolls.map(r => `${r.type}: ${r.description} (DC ${r.dc})`).join(', ')
        );
    }

    return { narrative, events };
}

/**
 * The detector's narrative payload, clamped from the END (2026-09-22
 * roll-resolution P2): the arbiter one call later clamps action and narrative
 * to 2k each, but this lane shipped the whole narration — up to
 * MESSAGE_CONTENT_MAX (20,000) ≈ 5k tokens whenever the gate opened. A prose
 * roll request sits in the narration's tail ("…now make a Perception check"),
 * so the tail is what the gate and the detector see.
 */
export const SEMANTIC_ROLL_NARRATIVE_MAX = 4000;

export async function detectSemanticTextRolls(narrative, settings, { signal } = {}) {
    // A pre-commit lane: the narration is fully received and the player is
    // watching "waiting" — one attempt, 20 s, then "no rolls" (2026-09-29).
    const background = getPreCommitConfig(settings);
    if (!background.apiKey || !narrative) return null;
    narrative = String(narrative).slice(-SEMANTIC_ROLL_NARRATIVE_MAX);

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
      "skill": "perception|stealth|athletics|insight|etc",
      "dc": 12,
      "description": "The exact check description or context"
    }
  ]
}

"skill" is the specific skill or ability name. "dc" is the DC the text states; when none is stated, use ${DEFAULT_ROLL_DC}. Write plain JSON with no comments.

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
            signal, // the turn's Stop cancels the detector too (2026-09-07 P2)
        });

        // The shared loose parser gives this machinery consumer the same fence-strip
        // + repair path as its siblings — a truncated detector response used to
        // silently return null on a raw JSON.parse (2026-08-29 audit).
        const parsed = parseJsonObjectLoose(response, ['requested_rolls']);
        return Array.isArray(parsed?.requested_rolls) ? parsed.requested_rolls : null;
    } catch (e) {
        // A deliberate Stop is the caller's to handle — never swallowed into
        // "no rolls found" (the turn would commit as if nothing happened).
        if (e?.name === 'AbortError' && signal?.aborted) throw e;
        console.warn('[ResponseParser] Semantic roll detection failed:', e.message || e);
        return null;
    }
}
