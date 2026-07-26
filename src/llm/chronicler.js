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
 * the previous passage for seamless continuation, then passages concatenate.
 */
import { sendMessage } from './adapter.js';

export const CHRONICLE_MIN_MESSAGES = 6;
const CHUNK_SIZE = 30;
const MESSAGE_CLIP = 4000;
const TAIL_CONTEXT = 700;
const CHAPTER_TEXT_MAX = 60000;

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

/** The chronicle-eligible messages of a raw span: visible play only. */
export function collectChapterMessages(messages = [], fromIndex = 0, toIndex = Infinity) {
    return (messages || [])
        .slice(fromIndex, toIndex === Infinity ? undefined : toIndex + 1)
        .filter(m => m && !m.hidden && typeof m.content === 'string' && m.content.trim());
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
 * Write the next chronicle chapter from every message played since the last
 * one. Returns { title, text, fromIndex, toIndex } — the caller dispatches.
 */
export async function writeChronicleChapter({ state, title = '', onProgress = null }) {
    const settings = state?.settings || {};
    if (!settings.apiKey) {
        throw new Error('Add your AI provider API key in Settings before writing a chapter.');
    }
    const chapters = state.chronicle || [];
    const fromIndex = chapters.length > 0 ? (chapters[chapters.length - 1].toIndex ?? -1) + 1 : 0;
    const toIndex = (state.messages || []).length - 1;
    const eligible = collectChapterMessages(state.messages, fromIndex, toIndex);
    if (eligible.length < CHRONICLE_MIN_MESSAGES) {
        throw new Error('Not enough new play to close a chapter yet — keep adventuring first.');
    }

    const heroName = state.character?.name || 'the hero';
    const premise = String(state.session?.premise || '').slice(0, 1200);
    const chunks = [];
    for (let i = 0; i < eligible.length; i += CHUNK_SIZE) {
        chunks.push(eligible.slice(i, i + CHUNK_SIZE));
    }

    const passages = [];
    for (let i = 0; i < chunks.length; i++) {
        if (onProgress) onProgress(`Writing passage ${i + 1} of ${chunks.length}…`);
        const previousTail = passages.length > 0
            ? passages[passages.length - 1].slice(-TAIL_CONTEXT)
            : '';
        const userMessage = [
            `HERO: ${heroName}`,
            premise ? `CAMPAIGN PREMISE (background canon, not events of this span): ${premise}` : null,
            previousTail ? `PREVIOUS PASSAGE (continue seamlessly, do not recap):\n…${previousTail}` : null,
            `TRANSCRIPT OF THIS SPAN:\n${renderTranscript(chunks[i], heroName)}`,
        ].filter(Boolean).join('\n\n');

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
    }

    return {
        title: String(title || '').trim().slice(0, 80) || `Chapter ${chapters.length + 1}`,
        text: passages.join('\n\n').slice(0, CHAPTER_TEXT_MAX),
        fromIndex,
        toIndex,
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
