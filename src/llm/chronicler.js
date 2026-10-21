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
import { CHRONICLE_CHAPTER_TEXT_MAX, CHRONICLE_PART_CHAR_BUDGET, CHRONICLE_TITLE_MAX } from '../config/contentLimits.js';
import { dmCallConfig } from './machinery.js';
import { findFencedJsonBlocks } from './responseParser.js';
import { listRevealableSetupIds } from '../engine/roleplayCheck.js';
import { describeFrontReveal } from '../engine/fronts.js';

/**
 * The hidden pressures the hero ENDED inside a span (WOW 2026-10-21): their
 * design, now known, handed to the chronicler so the symptoms the table saw
 * are retold as foreshadowing. Read from the fronts themselves — a resolution
 * stamps `resolvedAtMessage` at the 🕰️ row's index — so a reload, a late
 * close or two resolutions in one span all carry; nothing new in the session.
 * The DM never sees this beyond the 40-row echo; RAG and the Scribe never.
 */
export function describeRevealedFronts(fronts, fromIndex, toIndex) {
    return (Array.isArray(fronts) ? fronts : [])
        .filter(front => front && front.status === 'resolved'
            && Number.isFinite(front.resolvedAtMessage)
            && front.resolvedAtMessage >= fromIndex && front.resolvedAtMessage <= toIndex)
        .map(front => `- "${String(front.title || 'A hidden threat').slice(0, 160)}": ${describeFrontReveal(front)}`);
}

/** The chronicler's own read of the transcript: the epilogue reply included. */
export function collectChronicleEntries(messages, fromIndex, toIndex) {
    return collectNarrativeEntries(messages, fromIndex, toIndex, { keepEpilogue: true });
}

// Room a multi-part title keeps for its " — Part NN" suffix inside CHRONICLE_TITLE_MAX.
const PART_SUFFIX_RESERVE = 12;

export const CHRONICLE_MIN_MESSAGES = 6;
/**
 * A passage's transcript is budgeted in CHARACTERS, with the message count as
 * the belt (2026-09-26 chronicler Lap-3 P2). Sized by count alone, 30 × the
 * 4,000-char clip put one call anywhere from 740 chars (30 curt rows) to 122k
 * chars (30 clipped narrations) — a 165× spread against ONE fixed ask, the
 * 09-13 "budget in one unit, clamp in another" family on the input side: the
 * curt chunk got padded, the fat one compressed 40:1 at ~30k input tokens as
 * the app's largest non-streaming payload against the 90s stall guard (and a
 * stall re-sends it twice more before salvage). A chunk now closes BEFORE the
 * entry that would push its rendered transcript past CHRONICLE_CHUNK_CHARS,
 * so every passage call is at most that many transcript chars (a lone entry
 * is at most one clipped row); the count belt keeps a run of tiny rows from
 * becoming a 300-row chunk, and the length aim scales with the material
 * (`passageWordAim`) so a short span is never inflated.
 */
export const CHRONICLE_CHUNK_CHARS = 20000;
export const CHRONICLE_CHUNK_SIZE = 30; // the message-count belt
const MESSAGE_CLIP = 4000;
const TRANSCRIPT_LINE_GAP = 2; // the '\n\n' between rendered rows
const TAIL_CONTEXT = 700;
// A run closes a chapter every CHRONICLE_CHUNKS_PER_CHAPTER chunks (~300 messages,
// ~30–45k chars of prose) — safely under the reducer's 60k text clamp. The
// old design joined ALL passages into one chapter and sliced to 60k: a
// 59-chunk first close of a long campaign silently discarded two-thirds of
// the paid-for retelling mid-sentence while toIndex still claimed the whole
// span as chronicled (2026-08-29, live campaign).
// …and ALSO by accumulated CHARACTERS (2026-09-13 audit P1): nothing bounds
// a passage, and ten 7,000-char passages (a modest overshoot of the 300–700
// word aim) made a 70k part the reducer sliced to 60k mid-sentence — the
// same bug one level down. A part closes before a passage would push it
// past CHRONICLE_PART_CHAR_BUDGET; a single passage over the chapter ceiling
// is clipped with a visible warning.
export const CHRONICLE_CHUNKS_PER_CHAPTER = 10;

const CHRONICLER_PROMPT = `You are the CHRONICLER of a tabletop RPG campaign. You receive the raw table transcript of one span of play and retell it as a single continuous narrative passage — a chapter of the saga the player will keep and reread.

RULES:
- Third person, past tense, the hero by name. The DM's narration and the player's declared actions are one story now, told from outside.
- NEVER invent events, dialogue, motives, or outcomes the transcript does not contain. Compress routine (travel, shopping, rest) to a sentence; dwell on turning points, meaningful dialogue, danger, and consequence.
- TABLE RECORD lines are mechanical results (dice, coin, rests, combat outcomes): transmute them into fiction — the blow lands or misses, the purse lightens — never quote numbers, DCs, rolls, or game terms.
- Unvarnished: keep what actually happened at full specificity — blood, fear, desire, humiliation, tenderness, failure. Intimate or bodily content stays frank in content and clinical in register: neutral anatomical language, never crude slang, and never faded, softened, or moralized beyond what the transcript itself does.
- Write in the campaign's own tone and register. Prose only: no headings, no lists, no meta-commentary, no "in this chapter", no addressing the reader.
- When PREVIOUS PASSAGE is provided, continue seamlessly from it without recapping.
- When HIDDEN PRESSURES THE HERO ENDED is provided, the signs it names that the transcript shows were the steps of that design: tell them as foreshadowing, in hindsight, and the ending as the stopping of what was coming — never a sign the transcript does not show.
- Length: follow the LENGTH AIM given with the transcript — it is sized to the material. Never pad a short span or invent to fill it.

Output ONLY the narrative prose.`;

/**
 * The passage's word aim, scaled to its transcript: a full 20k-char chunk
 * keeps the classic 300–700; a 5k chunk asks for ~85–180; the floor is
 * 60–150. The old fixed ask was the reason a 740-char chunk came back padded.
 */
export function passageWordAim(transcriptChars) {
    const chars = Math.max(0, Number(transcriptChars) || 0);
    const low = Math.max(60, Math.min(300, Math.round(chars / 60)));
    const high = Math.max(150, Math.min(700, Math.round(chars / 28)));
    return [low, high];
}

/**
 * Every DM event block out of a row, through THE fence grammar
 * (`findFencedJsonBlocks`, 2026-10-11 — ```` ```JSON ```` and the bare object
 * fence included; a private ```` ```json ````-only regex here was the one
 * place the parser's grammar was spelled a second way, 2026-10-21 chronicler
 * P2). Blocks are removed back to front so each one's index stays valid.
 */
function stripEventBlocks(text) {
    let out = String(text || '');
    for (const block of findFencedJsonBlocks(out).reverse()) {
        out = out.slice(0, block.index) + out.slice(block.index + block.full.length);
    }
    return out.trim();
}

function renderTranscriptLine(entry, heroName) {
    const m = entry.message;
    const content = stripEventBlocks(m.content).slice(0, MESSAGE_CLIP);
    if (m.role === 'user') return `PLAYER (${heroName}): ${content}`;
    // The epilogue is the saga's own close (2026-10-21): the chronicler is told
    // what it is reading so the retelling ends the chapter on it, as an
    // ending, instead of folding it into the events before the hero fell.
    if (m.role === 'assistant') return entry.epilogue
        ? `DM — THE EPILOGUE (what became of everyone after the hero's death; retell it as the saga's close, nothing after it): ${content}`
        : `DM: ${content}`;
    return `TABLE RECORD: ${content}`;
}

/**
 * Cut the eligible entries into passage chunks: a chunk closes before the
 * entry that would push its rendered transcript past CHRONICLE_CHUNK_CHARS or its row
 * count past CHRONICLE_CHUNK_SIZE (an empty chunk always takes the entry, so a lone
 * clipped row is the only way past the budget — and it never is, since a
 * row is at most MESSAGE_CLIP + its label). Each chunk carries its rendered
 * `transcript` so the call and the UI estimate read one plan. Pure and
 * synchronous: the Journal tab calls it per render through a memo.
 */
export function planChroniclePassages(entries = [], heroName = 'the hero') {
    const chunks = [];
    let current = null;
    for (const entry of entries) {
        const line = renderTranscriptLine(entry, heroName);
        const added = current ? current.chars + TRANSCRIPT_LINE_GAP + line.length : line.length;
        if (!current || current.entries.length >= CHRONICLE_CHUNK_SIZE || added > CHRONICLE_CHUNK_CHARS) {
            current = { entries: [], lines: [], chars: 0 };
            chunks.push(current);
            current.chars = line.length;
        } else {
            current.chars = added;
        }
        current.entries.push(entry);
        current.lines.push(line);
    }
    return chunks.map(chunk => ({
        entries: chunk.entries,
        transcript: chunk.lines.join('\n\n'),
        chars: chunk.chars,
    }));
}

/**
 * Retell every message played since the last chapter. A span longer than
 * CHRONICLE_CHUNKS_PER_CHAPTER chunks closes as MULTIPLE chapters (Part 1, Part 2, …)
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
    const eligible = collectChronicleEntries(state.messages, fromIndex, toIndex);
    if (eligible.length < CHRONICLE_MIN_MESSAGES) {
        throw new Error('Not enough new play to close a chapter yet — keep adventuring first.');
    }
    // The final part claims the RAW span end so trailing system rows never stay
    // pending — but never a withheld check setup the player can still reveal
    // (2026-10-21 chronicler P2): a close with a proposal card on the table
    // used to claim the hidden setup row, and "Change approach" then revealed
    // it inside a closed span no future close retells. The claim stops before
    // the earliest such row, never short of the last retold message.
    const revealable = new Set(listRevealableSetupIds(state.pendingRoleplayCheck, state.messages));
    const firstRevealableIndex = (state.messages || []).findIndex(m => revealable.has(m?.id));
    const spanEnd = firstRevealableIndex === -1 ? toIndex : Math.min(toIndex, firstRevealableIndex - 1);

    const heroName = state.character?.name || 'the hero';
    const premise = String(state.session?.premise || '').slice(0, 1200);
    const revealed = describeRevealedFronts(state.fronts, fromIndex, toIndex);
    const revealBlock = revealed.length > 0
        ? `HIDDEN PRESSURES THE HERO ENDED IN THIS SPAN (their design, known only now — the signs the transcript shows were its steps; retell them as foreshadowing of what it wanted, in hindsight, and invent no sign the transcript lacks):\n${revealed.join('\n')}`
        : null;
    const chunks = planChroniclePassages(eligible, heroName);
    const lastIndexOf = (chunk) => chunk.entries[chunk.entries.length - 1].index;

    // Part titles: a single-part close keeps the classic titling; a multi-part
    // close shares the custom name ("Saga — Part 2") or numbers each part as
    // its own chapter so the tab's numbering stays continuous. The custom base
    // is clipped so the reducer's 80-char title clamp can never eat the suffix.
    // Whether a close is multi-part is only KNOWN once a second part closes
    // (the character budget can split a run the chunk count would not), so
    // the first part is retitled into the part form at that moment.
    const customTitle = String(title || '').trim();
    const partTitle = (partNumber, multiPart) => {
        if (!multiPart) return customTitle.slice(0, CHRONICLE_TITLE_MAX) || `Chapter ${chapters.length + 1}`;
        return customTitle
            ? `${customTitle.slice(0, CHRONICLE_TITLE_MAX - PART_SUFFIX_RESERVE)} — Part ${partNumber}`
            : `Chapter ${chapters.length + partNumber}`;
    };

    const out = [];
    let passages = []; // the part currently being written
    let partChars = 0;
    let partFromIndex = fromIndex;
    let previousTail = '';
    let completedChunks = 0;
    let salvaged = false;
    let clipped = false;

    const closePart = (coveredToIndex) => {
        const multiPart = out.length > 0;
        out.push({
            title: partTitle(out.length + 1, multiPart),
            text: passages.join('\n\n'),
            fromIndex: partFromIndex,
            toIndex: coveredToIndex,
        });
        if (out.length === 2) out[0].title = partTitle(1, true);
        partFromIndex = coveredToIndex + 1;
        passages = [];
        partChars = 0;
    };

    for (let i = 0; i < chunks.length; i++) {
        if (onProgress) onProgress(`Writing passage ${i + 1} of ${chunks.length}…`);
        const [aimLow, aimHigh] = passageWordAim(chunks[i].chars);
        const userMessage = [
            `HERO: ${heroName}`,
            premise ? `CAMPAIGN PREMISE (background canon, not events of this span): ${premise}` : null,
            revealBlock,
            // The tail threads across part boundaries too — the saga reads
            // seamlessly even where the storage splits into chapters.
            previousTail ? `PREVIOUS PASSAGE (continue seamlessly, do not recap):\n…${previousTail}` : null,
            `LENGTH AIM: ${aimLow}–${aimHigh} words for this passage.`,
            `TRANSCRIPT OF THIS SPAN:\n${chunks[i].transcript}`,
        ].filter(Boolean).join('\n\n');

        try {
            const response = await sendMessage({
                ...dmCallConfig(settings),
                systemPrompt: CHRONICLER_PROMPT,
                messageHistory: [],
                userMessage,
                temperature: 0.8, // narrative voice, but bound to transcript facts
            });
            let passage = stripEventBlocks(response);
            if (!passage) throw new Error('The chronicler returned an empty passage.');
            if (passage.length > CHRONICLE_CHAPTER_TEXT_MAX) {
                passage = passage.slice(0, CHRONICLE_CHAPTER_TEXT_MAX);
                clipped = true;
            }
            // Close the part BEFORE this passage would push it past the
            // character budget: the previous chunk's last retold message is
            // the honest boundary, and this passage opens the next part.
            if (passages.length > 0 && partChars + 2 + passage.length > CHRONICLE_PART_CHAR_BUDGET) {
                closePart(lastIndexOf(chunks[i - 1]));
            }
            passages.push(passage);
            partChars += (passages.length > 1 ? 2 : 0) + passage.length;
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
        if (passages.length === CHRONICLE_CHUNKS_PER_CHAPTER || lastChunkOfRun) {
            // The final part of a clean run claims the RAW span end so trailing
            // hidden/system messages never stay "pending"; every earlier
            // boundary lands on the last message its chunk retold.
            closePart(lastChunkOfRun ? Math.max(spanEnd, lastIndexOf(chunks[i])) : lastIndexOf(chunks[i]));
        }
    }
    if (salvaged && passages.length > 0) {
        closePart(lastIndexOf(chunks[completedChunks - 1]));
    }

    // Both warnings ride when both happened (2026-10-21 chronicler P2: the
    // salvage text used to win and the clipped part sat in the chapters with
    // no word) — one sentence each, joined.
    const warnings = [
        salvaged && 'The chronicler failed partway — the completed passages were kept as a shorter chapter. Close another chapter to retell the rest.',
        clipped && 'One passage ran past the chapter ceiling and was clipped at its end. Remove the chapter and close again if the cut shows.',
    ].filter(Boolean);
    return {
        chapters: out,
        ...(salvaged && { salvaged: true }),
        ...(clipped && { clipped: true }),
        ...(warnings.length > 0 && { warning: warnings.join(' ') }),
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
