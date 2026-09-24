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
 *
 * Combat-exchange dice lines (`exchangeLine`, DECISIONS.md 2026-08-04) are
 * NOT narrative either (2026-09-23 combat-exchange P1): the tag was minted
 * for the DM window alone, so a 9-exchange fight's ~64 roll lines counted as
 * story here — the journal cadence fired twice for one fight, scene presence
 * was judged from "**Oda attacks Marsh bandit 4** — Rolled **20**", and the
 * chronicler retold each as a TABLE RECORD. The lines have exactly two
 * readers that need them, the chat and the narration prompt's RESOLVED
 * EVENTS, and the fight's outcome reaches the journal through the narration
 * prose, the END_COMBAT lines, and `recentEncounters`. Out-of-combat
 * roll-result lines keep their seat: nothing else carries them, so the
 * 2026-09-06 "engine roll-result lines still ride it" rule is narrowed to
 * them, not reversed.
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
        if (index > toIndex) return;
        // `kind: 'record'` is an engine receipt about the TABLE (the recall
        // dossier's "📜 From the record" line, 2026-09-18) — bookkeeping the
        // chronicler and the scene painter must never retell as story.
        if (!m || m.hidden || m.deleted || m.kind === 'error' || m.kind === 'record' || m.exchangeLine || typeof m.content !== 'string' || !m.content.trim()) return;
        // The table-talk pairing is tracked from the start of the transcript,
        // not from the span: a journal batch or chapter that opens on the DM's
        // at-the-table reply must still know the OOC line just before it
        // (2026-09-06 — the journal batch adopted this predicate).
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
        if (index < fromIndex) return;
        entries.push({ message: m, index });
    });
    return entries;
}

/** The narrative-eligible messages of a raw span: visible play only. */
export function collectNarrativeMessages(messages = [], fromIndex = 0, toIndex = Infinity) {
    return collectNarrativeEntries(messages, fromIndex, toIndex).map(entry => entry.message);
}

/**
 * How many recent narrative messages feed the presence gates (RAG retrieval,
 * callback curation, KNOWN NPCs). The DM's last narration is what establishes
 * who is in the scene; the player's own follow-up lines rarely repeat the name
 * of the person they are talking to. Three = the player's current line
 * (already committed), the DM's last narration, and the player's previous
 * line — one full exchange of context, short enough that someone who left the
 * scene fades within a turn or two.
 */
export const PRESENCE_MESSAGE_COUNT = 3;

/**
 * Scene text consulted ONLY for who is present (2026-09-06 P1) — never
 * embedded, so a search query stays unchanged. Reads the narrative-eligible
 * transcript: hidden setups, soft-deleted refusals, infrastructure error
 * lines, and OOC table talk never count as presence. Lives here (not in the
 * orchestrator) so promptBuilder can use it for KNOWN NPCs without a cycle.
 */
export function buildPresenceText(messages) {
    return collectNarrativeMessages(messages)
        .slice(-PRESENCE_MESSAGE_COUNT)
        .map(m => m.content)
        .join(' ');
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
