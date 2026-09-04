/**
 * THE narrative-eligible message predicate (2026-09-01 scene-art P1).
 *
 * Three consumers read the transcript as STORY rather than as the DM window:
 * the chronicler (chapter retelling), sessionPriming (has the opening scene
 * been narrated yet?), and SceneArt's situation picker (the moment the art
 * director paints). Each used to carry its own filter and they drifted —
 * SceneArt honored `hidden` but not `deleted`, so a scrubbed refusal ("I
 * can't continue this…") became the "Current situation" the painter
 * rendered, cached under that message's id.
 *
 * One rule, shared: a message is narrative when it is visible (not `hidden`,
 * not soft-`deleted`), has text, is not an infrastructure error line (`kind:
 * 'error'` — "Error resolving check: Failed to fetch" is not play, and the
 * chronicler prompt told the model to fictionalize every TABLE RECORD; the
 * 2026-09-04 audit's twin of the table-talk leak), and is not an OOC
 * table-talk exchange — the
 * player's table-talk message AND its immediately following assistant reply
 * skip together, because the reply is a DM-at-the-table answer, never fiction
 * (the table-talk turn is already excluded from RAG, the Scribe, and the DM
 * window by design; nothing flags the reply on the stored message, so the
 * pairing is derived from the preceding user message).
 */
import { isTableTalkMessage } from './tableTalk.js';

/**
 * Narrative-eligible entries of a raw span with their RAW message indexes
 * (salvaged shorter-span chapters need the true toIndex).
 * @returns {Array<{ message: object, index: number }>}
 */
export function collectNarrativeEntries(messages = [], fromIndex = 0, toIndex = Infinity) {
    const entries = [];
    let skipNextAssistant = false;
    (messages || []).forEach((m, index) => {
        if (index < fromIndex || index > toIndex) return;
        if (!m || m.hidden || m.deleted || m.kind === 'error' || typeof m.content !== 'string' || !m.content.trim()) return;
        if (m.role === 'user') {
            skipNextAssistant = false;
            if (isTableTalkMessage(m.content)) {
                skipNextAssistant = true;
                return;
            }
        } else if (m.role === 'assistant' && skipNextAssistant) {
            skipNextAssistant = false;
            return;
        }
        entries.push({ message: m, index });
    });
    return entries;
}

/** The narrative-eligible messages of a raw span: visible play only. */
export function collectNarrativeMessages(messages = [], fromIndex = 0, toIndex = Infinity) {
    return collectNarrativeEntries(messages, fromIndex, toIndex).map(entry => entry.message);
}

/**
 * The newest assistant message that is genuine narration — the DM's latest
 * narrated moment. Null when no narration has been played yet.
 */
export function findLatestNarration(messages = []) {
    const entries = collectNarrativeEntries(messages);
    for (let i = entries.length - 1; i >= 0; i--) {
        if (entries[i].message.role === 'assistant') return entries[i].message;
    }
    return null;
}
