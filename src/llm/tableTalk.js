/**
 * Out-of-character table talk — the player speaking to the DM as a person at the
 * table ("OOC: ...", "DM, ...") instead of acting as their character.
 *
 * Gemini tends to break character graciously on its own; other DM providers (Grok
 * in live play, 2026-07-09) stay in-fiction and steamroll the question into scene
 * narration. So OOC handling cannot live in provider goodwill: a standing prompt
 * rule covers unprefixed meta questions best-effort, and this deterministic
 * detector forces a dedicated response mode for explicitly marked table talk.
 */

// Explicit markers only — a message must START as table talk. In-scene sentences
// that merely mention a "dm"/"ooc" substring never match.
const TABLE_TALK_PREFIX = /^\s*(?:[([]\s*ooc\b|\/?ooc\b|(?:hey\s+|hi\s+)?(?:dm|gm|dungeon\s+master|game\s+master)\s*[:,])/i;

/** True when the player message is explicitly addressed to the DM out of character. */
export function isTableTalkMessage(text) {
    return TABLE_TALK_PREFIX.test(String(text || ''));
}

/**
 * Response-mode block appended to the system prompt on a detected table-talk turn.
 * Mirrors the combat-intent-only mode: one unambiguous contract for this response.
 */
export const TABLE_TALK_RESPONSE_MODE = `## CURRENT RESPONSE MODE — OUT-OF-CHARACTER TABLE TALK
The player's message is out-of-character table talk addressed to you, the Dungeon Master — NOT a character action. Step outside the fiction and answer them directly, DM to player: brief, honest, helpful.
- Do NOT continue the scene, advance time, speak or act for NPCs, request rolls, or emit ANY game events. The world is paused; no JSON event block belongs in this response.
- Recaps, rules clarifications, and honest answers about past events are welcome. Take tone, pacing, and content requests seriously and adjust going forward.
- Never reveal hidden DM state: campaign front titles, clocks, stages, or portents; secret NPC motives; private notes.
- End with one short line handing play back to the scene where it paused.`;

/**
 * Standing DM rule injected into every system prompt, so unprefixed meta questions
 * still get a table-talk answer from providers that would otherwise stay in-fiction.
 */
export const TABLE_TALK_STANDING_RULE = `## OUT-OF-CHARACTER TABLE TALK

Sometimes the player speaks to YOU — the Dungeon Master — rather than acting as their character: messages prefixed "OOC:" or "(OOC)", messages addressed "DM," / "GM,", or plainly meta questions about rules, past events, pacing, tone, or the game itself. Treat these as table talk, never as character actions:
- Step out of the fiction and answer as the DM at the table — brief, direct, honest.
- Do not advance the scene, move time, act for NPCs, request rolls, or emit game events in a table-talk reply. The world is paused.
- Never reveal hidden DM state (front titles/clocks/stages, secret NPC motives, private notes), but recap freely and take tone/pacing/content requests seriously.
- Close by handing play back to the scene, then resume the fiction exactly where it paused when the player next acts in character.`;
