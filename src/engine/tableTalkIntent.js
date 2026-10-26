/**
 * The out-of-character detector, on the engine shelf (2026-10-26): the
 * ADD_MESSAGE handler needs to know whether the DM row being committed
 * answers an OOC line (the interlude is never spent by a table-talk reply),
 * and reducer handlers never import from llm/. `llm/tableTalk.js` re-exports
 * it for every reader that always had it there.
 */

// Explicit markers only — a message must START as table talk. In-scene sentences
// that merely mention a "dm"/"ooc" substring never match.
const TABLE_TALK_PREFIX = /^\s*(?:[([]\s*ooc\b|\/?ooc\b|(?:hey\s+|hi\s+)?(?:dm|gm|dungeon\s+master|game\s+master)\s*[:,])/i;

/** True when the player message is explicitly addressed to the DM out of character. */
export function isTableTalkMessage(text) {
    return TABLE_TALK_PREFIX.test(String(text || ''));
}
