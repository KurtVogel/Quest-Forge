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
 * "Ask the DM for a recap" (WOW 2026-09-15, session-return W2): the one
 * bounded request the return card's button sends. It rides THIS lane — the
 * OOC prefix is what makes it table talk: events force-nulled, kept out of
 * memory, hidden state never revealed. Player-initiated only, so DECISIONS.md
 * 2026-06-19 ("Continue never calls the DM") is honored, not reversed.
 */
export const RECAP_REQUEST_MESSAGE = 'OOC: Recap where we are, what\'s open, and what you last asked me — in your voice, under 120 words.';

/**
 * "What became of them" (WOW 2026-09-30, death-and-stakes W1 — the last
 * chapter): the ending card's ONE epilogue request, sent once on tap after
 * the hero's death. It rides the same lane as the recap — the OOC prefix
 * makes it table talk (events force-nulled, kept out of memory, hidden
 * fronts never revealed) — and `EPILOGUE_RESPONSE_MODE` replaces the
 * ordinary table-talk mode for it, because an epilogue must be allowed to
 * move the world on (the ordinary mode forbids advancing time). The player
 * chooses the ending's shape, never whether the hero died.
 */
export const EPILOGUE_REQUEST_MESSAGE = 'OOC: My hero is dead and the story is over. Give me the ending — what became of everyone and everything they left behind: each companion, the people who knew them, the unfinished business, and the places. One short passage each, in your voice, unvarnished.';

/** True when the player line IS the ending card's epilogue request (verbatim). */
export function isEpilogueRequest(text) {
    return String(text || '').trim() === EPILOGUE_REQUEST_MESSAGE;
}

/** The response mode the epilogue request gets instead of TABLE_TALK_RESPONSE_MODE. */
export const EPILOGUE_RESPONSE_MODE = `## CURRENT RESPONSE MODE — THE EPILOGUE
The hero is dead and this campaign is over. The player has asked you, out of character, for the ending: what became of the people and places the hero leaves behind. Write it as a series of short closing passages in your own narrator's voice — one paragraph each, in this order:
- every companion who traveled with the hero (by name): what they did after, and what the hero's death meant to them;
- at least two other people who knew the hero (by name — the ones with a real stance toward them), each in the light of that stance and their history together;
- the unfinished business: each active quest or open promise, whether it was ever finished, and by whom;
- the places the hero marked, and what they are like a season later.
Ground every passage in what is on record — the known people, their stances and key moments, the active quests, the world facts, the campaign's last scenes. Be unvarnished and specific; grief, relief, indifference, and profit are all allowed. Nothing new begins: no hooks, no successors, no offers to continue. Never reveal hidden campaign fronts, clocks, stages, or private notes — but the world may move on from pressures the hero never resolved, seen only through their visible consequences. Do NOT request rolls or emit ANY game events; no JSON event block belongs in this response. Under 500 words. End on the last line of the saga, not on a question.`;

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
