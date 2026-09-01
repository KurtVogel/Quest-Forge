/**
 * Campaign Chronicle — chapter-close retelling of actual play (IDEAS.md
 * 2026-07-06). The chronicler reads the REAL messages of a span (messages are
 * never deleted, only journal-summarized out of the LLM window) and retells
 * them as one continuous saga chapter.
 *
 * STRICTLY player-facing: the chronicle is never injected into the DM prompt,
 * never embedded into RAG, and never consulted by the Scribe. The structured
 * memory layers stay the retrieval format; this is the visible payoff of the
 * memory stack, not another memory.
 *
 * Runs on the DM model (creative work, not extraction — the frontDirector
 * precedent), chunked for long spans: each passage call receives the tail of
 * the previous passage for seamless continuation. A very long span closes as
 * multiple chapters (Part 1, 2, …) rather than one — a single chapter would
 * hit the reducer's 60k text clamp and silently lose the overflow.
 */
import { sendMessage } from './adapter.js';
import { collectNarrativeEntries } from './narrativeMessages.js';

export const CHRONICLE_MIN_MESSAGES = 6;
export const CHRONICLE_CHUNK_SIZE = 30; // exported so the UI can estimate passages/duration
const CHUNK_SIZE = CHRONICLE_CHUNK_SIZE;
const MESSAGE_CLIP = 4000;
const TAIL_CONTEXT = 700;
// A run closes a chapter every CHUNKS_PER_CHAPTER chunks (~300 messages,
// ~30–45k chars of prose) — safely under the reducer's 60k text clamp. The
// old design joined ALL passages into one chapter and sliced to 60k: a
// 59-chunk first close of a long campaign silently discarded two-thirds of
// the paid-for retelling mid-sentence while toIndex still claimed the whole
// span as chronicled (2026-08-29, live campaign).
export const CHRONICLE_CHUNKS_PER_CHAPTER = 10;
const CHUNKS_PER_CHAPTER = CHRONICLE_CHUNKS_PER_CHAPTER;

const CHRONICLER_PROMPT = `You are the CHRONICLER of a tabletop RPG campaign. You receive the raw table transcript of one span of play and retell it as a single continuous narrative passage — a chapter of the saga the player will keep and reread.

RULES:
- Third person, past tense, the hero by name. The DM's narration and the player's declared actions are one story now, told from outside.
- NEVER invent events, dialogue, motives, or outcomes the transcript does not contain. Compress routine (travel, shopping, rest) to a sentence; dwell on turning points, meaningful dialogue, danger, and consequence.
- TABLE RECORD lines are mechanical results (dice, coin, rests, combat outcomes): transmute them into fiction — the blow lands or misses, the purse lightens — never quote numbers, DCs, rolls, or game terms.
- Unvarnished: keep what actually happened at full specificity — blood, fear, desire, humiliation, tenderness, failure. Intimate or bodily content stays frank in content and clinical in register: neutral anatomical language, never crude slang, and never faded, softened, or moralized beyond what the transcript itself does.
- Write in the campaign's own tone and register. Prose only: no headings, no lists, no meta-commentary, no "in this chapter", no addressing the reader.
- When PREVIOUS PASSAGE is provided, continue seamlessly from it without recapping.
- Aim for 300-700 words for this passage.

Output ONLY the narrative prose.`;

function stripEventBlocks(text) {
    return String(text || '').replace(/```json[\s\S]*?```/g, '').trim();
}

/**
 * The chronicle-eligible entries of a raw span with their RAW message indexes
 * (salvaged shorter-span chapters need the true toIndex): visible play only,
 * minus OOC table talk — a table-talk turn is excluded from RAG, the Scribe,
 * and the DM window by design, and its recap/rules exchange must not be retold
 * as story either (2026-08-29 audit). The predicate is THE shared
 * narrative-eligibility rule in narrativeMessages.js (SceneArt and
 * sessionPriming read through the same one — 2026-09-01 P1).
 */
const collectChapterEntries = collectNarrativeEntries;

/** The chronicle-eligible messages of a raw span: visible play only. */
export function collectChapterMessages(messages = [], fromIndex = 0, toIndex = Infinity) {
    return collectChapterEntries(messages, fromIndex, toIndex).map(entry => entry.message);
}

function renderTranscript(chunk, heroName) {
    return chunk.map(m => {
        const content = stripEventBlocks(m.content).slice(0, MESSAGE_CLIP);
        if (m.role === 'user') return `PLAYER (${heroName}): ${content}`;
        if (m.role === 'assistant') return `DM: ${content}`;
        return `TABLE RECORD: ${content}`;
    }).join('\n\n');
}

/**
 * Retell every message played since the last chapter. A span longer than
 * CHUNKS_PER_CHAPTER chunks closes as MULTIPLE chapters (Part 1, Part 2, …)
 * with honest contiguous fromIndex/toIndex — no text is ever discarded.
 * Returns { chapters: [{ title, text, fromIndex, toIndex }], salvaged?,
 * warning? } — the caller dispatches the whole array as one action.
 */
export async function writeChronicleChapters({ state, title = '', onProgress = null }) {
    const settings = state?.settings || {};
    if (!settings.apiKey) {
        throw new Error('Add your AI provider API key in Settings before writing a chapter.');
    }
    const chapters = state.chronicle || [];
    const fromIndex = chapters.length > 0 ? (chapters[chapters.length - 1].toIndex ?? -1) + 1 : 0;
    const toIndex = (state.messages || []).length - 1;
    const eligible = collectChapterEntries(state.messages, fromIndex, toIndex);
    if (eligible.length < CHRONICLE_MIN_MESSAGES) {
        throw new Error('Not enough new play to close a chapter yet — keep adventuring first.');
    }

    const heroName = state.character?.name || 'the hero';
    const premise = String(state.session?.premise || '').slice(0, 1200);
    const chunks = [];
    for (let i = 0; i < eligible.length; i += CHUNK_SIZE) {
        chunks.push(eligible.slice(i, i + CHUNK_SIZE));
    }

    // Part titles: a single-part close keeps the classic titling; a multi-part
    // close shares the custom name ("Saga — Part 2") or numbers each part as
    // its own chapter so the tab's numbering stays continuous. The custom base
    // is clipped so the reducer's 80-char title clamp can never eat the suffix.
    const multiPart = chunks.length > CHUNKS_PER_CHAPTER;
    const customTitle = String(title || '').trim().slice(0, multiPart ? 68 : 80);
    const partTitle = (partNumber) => {
        if (!multiPart) return customTitle || `Chapter ${chapters.length + 1}`;
        return customTitle
            ? `${customTitle} — Part ${partNumber}`
            : `Chapter ${chapters.length + partNumber}`;
    };

    const out = [];
    let passages = []; // the part currently being written
    let partFromIndex = fromIndex;
    let previousTail = '';
    let completedChunks = 0;
    let salvaged = false;

    const closePart = (coveredToIndex) => {
        out.push({
            title: partTitle(out.length + 1),
            text: passages.join('\n\n'),
            fromIndex: partFromIndex,
            toIndex: coveredToIndex,
        });
        partFromIndex = coveredToIndex + 1;
        passages = [];
    };

    for (let i = 0; i < chunks.length; i++) {
        if (onProgress) onProgress(`Writing passage ${i + 1} of ${chunks.length}…`);
        const userMessage = [
            `HERO: ${heroName}`,
            premise ? `CAMPAIGN PREMISE (background canon, not events of this span): ${premise}` : null,
            // The tail threads across part boundaries too — the saga reads
            // seamlessly even where the storage splits into chapters.
            previousTail ? `PREVIOUS PASSAGE (continue seamlessly, do not recap):\n…${previousTail}` : null,
            `TRANSCRIPT OF THIS SPAN:\n${renderTranscript(chunks[i].map(entry => entry.message), heroName)}`,
        ].filter(Boolean).join('\n\n');

        try {
            const response = await sendMessage({
                provider: settings.llmProvider,
                apiKey: settings.apiKey,
                model: settings.model,
                systemPrompt: CHRONICLER_PROMPT,
                messageHistory: [],
                userMessage,
                temperature: 0.8, // narrative voice, but bound to transcript facts
            });
            const passage = stripEventBlocks(response);
            if (!passage) throw new Error('The chronicler returned an empty passage.');
            passages.push(passage);
            previousTail = passage.slice(-TAIL_CONTEXT);
            completedChunks = i + 1;
        } catch (error) {
            // Salvage completed passages instead of discarding paid-for DM-model
            // work: close what was already written — toIndex lands on the last
            // retold message, so the next "Close chapter" resumes exactly there
            // (2026-08-29 audit). A failure before ANY passage exists still
            // throws: there is nothing to keep.
            if (out.length === 0 && passages.length === 0) throw error;
            console.warn(`[Chronicler] Passage ${i + 1} of ${chunks.length} failed (${error.message || error}) — salvaging the ${completedChunks} completed passage(s).`);
            salvaged = true;
            break;
        }

        const lastChunkOfRun = i === chunks.length - 1;
        if (passages.length === CHUNKS_PER_CHAPTER || lastChunkOfRun) {
            // The final part of a clean run claims the RAW span end so trailing
            // hidden/system messages never stay "pending"; every earlier
            // boundary lands on the last message its chunk retold.
            closePart(lastChunkOfRun ? toIndex : chunks[i][chunks[i].length - 1].index);
        }
    }
    if (salvaged && passages.length > 0) {
        closePart(chunks[completedChunks - 1][chunks[completedChunks - 1].length - 1].index);
    }

    return {
        chapters: out,
        ...(salvaged && {
            salvaged: true,
            warning: 'The chronicler failed partway — the completed passages were kept as a shorter chapter. Close another chapter to retell the rest.',
        }),
    };
}

/** The whole chronicle as a portable markdown document. */
export function chronicleToMarkdown(chapters = [], sessionName = 'Campaign') {
    const parts = [`# ${sessionName} — Chronicle`];
    for (const chapter of chapters) {
        const when = chapter.createdAt ? new Date(chapter.createdAt).toLocaleDateString() : '';
        parts.push(`## ${chapter.title}${when ? `\n\n_${when}_` : ''}\n\n${chapter.text}`);
    }
    return parts.join('\n\n---\n\n');
}
