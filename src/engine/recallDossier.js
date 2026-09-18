/**
 * The recall dossier — "remember when…" answered from the RECORD (WOW
 * 2026-09-18, Vesa: "THAT'S the moneyshot").
 *
 * When the player asks a character about the past, the engine assembles what
 * actually happened, in ORDER OF AUTHORITY, and the DM answers from it:
 *   1. engine ledgers — fights (`recentEncounters`), quests, RESOLVED fronts
 *      (never a live one: privacy ends at resolution, DECISIONS.md 2026-08-03),
 *      the dice that decided things (`rollHistory`);
 *   2. journal entries whose summary / decisions / consequences name the thing;
 *   3. story cards and world facts, honoring `knownBy` secrecy;
 *   4. the asked-about people's own records — key moments, the open thread;
 *   5. verbatim transcript lines — the message store is never deleted, only
 *      journal-pruned from the DM window, so "what did she say" can quote
 *      the line AS SAID.
 *
 * Pure and zero-LLM. Everything is matched by the shared textMatch tokenizer
 * (subject names weigh 3, content words 1), rendered with conversational
 * distance ("11 scenes ago, at Rimehollow") under a hard character budget so
 * the block never blows the prompt tripwire. The prompt block and the
 * player-facing receipt line render from the same dossier.
 */

import { tokenSet } from './textMatch.js';
import { findSubjectsInText } from './vectorMemory.js';
import { collectNarrativeEntries } from '../llm/narrativeMessages.js';
import { conversationalDistance } from './replayLedger.js';
import { formatSecrecyTag } from './storyMemory.js';
import { splitBondMoments } from './npcRoster.js';

export const RECALL_DOSSIER_CHAR_BUDGET = 1500;
/** Verbatim excerpt width around the first hit. */
export const RECALL_EXCERPT_CHARS = 240;

const CAPS = {
    fights: 3,
    quests: 3,
    fronts: 2,
    rolls: 2,
    journal: 4,
    cards: 4,
    facts: 4,
    people: 3,
    verbatim: 3,
};

const SUBJECT_WEIGHT = 3;
/** A lone content-word hit qualifies a row only when the word is this long (rare enough). */
const LONE_HIT_MIN_LENGTH = 5;

/** Light plural fold so "ghouls" finds "3× ghoul" and "ferrymen" finds "ferryman". */
function stem(token) {
    const t = String(token || '');
    if (t.length > 5 && t.endsWith('ies')) return `${t.slice(0, -3)}y`;
    if (t.length > 4 && t.endsWith('men')) return `${t.slice(0, -3)}man`;
    if (t.length > 4 && t.endsWith('es') && /[sxz]es$|[cs]hes$/.test(t)) return t.slice(0, -2);
    if (t.length > 4 && t.endsWith('s') && !t.endsWith('ss')) return t.slice(0, -1);
    return t;
}

function stemmedSet(text, options) {
    const out = new Set();
    for (const token of tokenSet(text, options)) out.add(stem(token));
    return out;
}

const clip = (value, max) => {
    const text = typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';
    if (text.length <= max) return text;
    return `${text.slice(0, Math.max(0, max - 1)).trimEnd()}…`;
};

/** "just now" / "N scenes ago" in CONVERSATIONAL distance (one scene ≈ 2 lines). */
export function describeScenesAgo(messages, atIndex) {
    if (!Array.isArray(messages) || !Number.isFinite(atIndex)) return '';
    const distance = conversationalDistance(messages, Math.max(0, Math.floor(atIndex)) - 1, messages.length - 1);
    const scenes = Math.ceil(distance / 2);
    if (scenes <= 0) return 'just now';
    return `${scenes} scene${scenes === 1 ? '' : 's'} ago`;
}

function makeScorer(intent) {
    const subjects = (Array.isArray(intent?.subjects) ? intent.subjects : []).filter(s => typeof s === 'string' && s.trim());
    const queryTokens = new Set((Array.isArray(intent?.queryTokens) ? intent.queryTokens : [])
        .map(t => stem(String(t || '').toLowerCase())).filter(Boolean));
    // Subject names count as query words too, so a one-word question about a
    // known person ("Remember Saima?") still finds the rows that name her.
    for (const subject of subjects) {
        for (const token of stemmedSet(subject, { minLength: 3 })) queryTokens.add(token);
    }
    /**
     * Score = subject hits × 3 + content-word hits. A row QUALIFIES when it
     * names a subject, matches two content words, or matches one rare-enough
     * word ("ghoul", "ferryman" — never "took") — precision over recall, the record is
     * read by the DM as truth.
     */
    const judge = (text) => {
        const clean = typeof text === 'string' ? text : '';
        if (!clean) return { score: 0, qualifies: false };
        const subjectHits = subjects.length > 0 ? (findSubjectsInText(clean, subjects, subjects.length) || []).length : 0;
        const rowTokens = stemmedSet(clean, { minLength: 3, foldPossessives: true });
        const hits = [...queryTokens].filter(token => rowTokens.has(token));
        const score = subjectHits * SUBJECT_WEIGHT + hits.length;
        const qualifies = subjectHits > 0
            || hits.length >= 2
            || hits.some(token => token.length >= LONE_HIT_MIN_LENGTH);
        return { score, qualifies };
    };
    return {
        subjects,
        queryTokens,
        hasQuery: subjects.length > 0 || queryTokens.size > 0,
        judge,
    };
}

/** Best-scoring items first, ties keep source order; qualifying only. */
function pick(items, scorer, textOf, cap) {
    return items
        .map((item, index) => ({ item, index, ...scorer.judge(textOf(item)) }))
        .filter(entry => entry.qualifies)
        .sort((a, b) => b.score - a.score || a.index - b.index)
        .slice(0, cap);
}

function excerptAround(content, scorer) {
    const text = String(content || '').replace(/\s+/g, ' ').trim();
    if (text.length <= RECALL_EXCERPT_CHARS) return text;
    const lower = text.toLowerCase();
    let hit = -1;
    for (const needle of [...scorer.subjects, ...scorer.queryTokens]) {
        const idx = lower.indexOf(String(needle).toLowerCase());
        if (idx !== -1 && (hit === -1 || idx < hit)) hit = idx;
    }
    const start = hit === -1 ? 0 : Math.max(0, hit - Math.floor(RECALL_EXCERPT_CHARS / 3));
    let from = start;
    if (from > 0) {
        const boundary = text.indexOf(' ', from);
        if (boundary !== -1 && boundary - from < 40) from = boundary + 1;
    }
    const slice = text.slice(from, from + RECALL_EXCERPT_CHARS).trim();
    return `${from > 0 ? '…' : ''}${slice}${from + RECALL_EXCERPT_CHARS < text.length ? '…' : ''}`;
}

/**
 * Assemble the dossier.
 *
 * @param {object} state - live game state
 * @param {{ subjects?: string[], queryTokens?: string[], question?: string }} intent
 * @param {{ maxChars?: number, heroName?: string }} [options]
 * @returns {{ lines: string[], text: string, stats: object, empty: boolean, subjects: string[] }}
 */
export function buildRecallDossier(state, intent, { maxChars = RECALL_DOSSIER_CHAR_BUDGET } = {}) {
    const scorer = makeScorer(intent);
    const messages = Array.isArray(state?.messages) ? state.messages : [];
    const heroName = typeof state?.character?.name === 'string' && state.character.name.trim() ? state.character.name.trim() : 'the hero';
    const stats = { fights: 0, quests: 0, fronts: 0, rolls: 0, journal: 0, cards: 0, facts: 0, people: 0, verbatim: 0 };
    const sections = [];
    let oldest = null;
    let newest = null;
    const noteDistance = (atIndex) => {
        if (!Number.isFinite(atIndex)) return;
        oldest = oldest === null ? atIndex : Math.min(oldest, atIndex);
        newest = newest === null ? atIndex : Math.max(newest, atIndex);
    };
    const when = (atIndex) => {
        const label = describeScenesAgo(messages, atIndex);
        if (label) noteDistance(atIndex);
        return label;
    };

    if (!scorer.hasQuery) {
        return { lines: [], text: '', stats, empty: true, subjects: [] };
    }

    // 1. Engine ledgers.
    const fights = pick(
        (Array.isArray(state?.recentEncounters) ? state.recentEncounters : []).filter(e => e && typeof e === 'object'),
        scorer,
        e => `${e.enemies || ''} ${e.location || ''} ${e.outcome || ''}`,
        CAPS.fights,
    ).map(({ item }) => {
        const where = typeof item.location === 'string' && item.location ? ` at ${clip(item.location, 60)}` : '';
        const ago = when(item.messageIndex);
        const outcome = item.outcome === 'defeat' ? 'the party was beaten' : item.outcome === 'escaped' ? 'the party escaped' : 'the party won';
        return `- FIGHT${ago ? ` (${ago}${where})` : where ? ` (${where.trim()})` : ''}: fought ${clip(item.enemies, 120)} — ${outcome}.`;
    });
    stats.fights = fights.length;
    sections.push(...fights);

    const quests = pick(
        (Array.isArray(state?.quests) ? state.quests : []).filter(q => q && typeof q === 'object' && typeof q.name === 'string'),
        scorer,
        q => `${q.name} ${q.description || ''}`,
        CAPS.quests,
    ).map(({ item }) => {
        const status = typeof item.status === 'string' ? item.status : 'active';
        const ago = Number.isFinite(item.openedAtMessage) ? when(item.openedAtMessage) : '';
        const opened = ago ? `, taken up ${ago}` : '';
        const description = typeof item.description === 'string' && item.description.trim() ? `: ${clip(item.description, 160)}` : '';
        return `- QUEST "${clip(item.name, 80)}" (${status}${opened})${description}`;
    });
    stats.quests = quests.length;
    sections.push(...quests);

    // Only RESOLVED fronts: a live front is hidden campaign state and never
    // enters any prompt as a dossier (DECISIONS.md 2026-07-14 / 2026-08-03).
    const fronts = pick(
        (Array.isArray(state?.fronts) ? state.fronts : []).filter(f => f && typeof f === 'object' && f.status === 'resolved'),
        scorer,
        f => `${f.title || ''} ${f.faction || ''} ${f.resolution || ''} ${f.notes || ''}`,
        CAPS.fronts,
    ).map(({ item }) => {
        const ago = when(item.resolvedAtMessage);
        const epitaph = typeof item.resolution === 'string' && item.resolution.trim() ? ` — ${clip(item.resolution, 200)}` : '';
        return `- ENDED${ago ? ` (${ago})` : ''}: the matter of ${clip(item.title || item.faction || 'a pressure', 80)} is finished${epitaph}`;
    });
    stats.fronts = fronts.length;
    sections.push(...fronts);

    const rolls = pick(
        (Array.isArray(state?.rollHistory) ? state.rollHistory : []).filter(r => r && typeof r === 'object' && typeof r.description === 'string' && r.description.trim()),
        scorer,
        r => r.description,
        CAPS.rolls,
    ).map(({ item }) => {
        const total = Number.isFinite(item.total) ? ` rolled ${item.total}` : '';
        const crit = item.isCritical ? ' (a natural 20)' : item.isCritFail ? ' (a natural 1)' : '';
        return `- DICE: ${clip(item.description, 120)}${total}${crit}.`;
    });
    stats.rolls = rolls.length;
    sections.push(...rolls);

    // 2. Journal — the chronicle of what happened, never a fallback stub.
    const journal = pick(
        (Array.isArray(state?.journal) ? state.journal : []).filter(j => j && typeof j === 'object' && !j.fallback && typeof j.summary === 'string'),
        scorer,
        j => `${j.summary} ${(Array.isArray(j.keyDecisions) ? j.keyDecisions : []).join(' ')} ${(Array.isArray(j.consequences) ? j.consequences : []).join(' ')}`,
        CAPS.journal,
    ).map(({ item }) => {
        const end = Array.isArray(item.messageRange) ? Number(item.messageRange[1]) : NaN;
        const ago = when(end);
        const where = typeof item.location === 'string' && item.location ? `, at ${clip(item.location, 60)}` : '';
        const decisions = (Array.isArray(item.keyDecisions) ? item.keyDecisions : []).filter(d => typeof d === 'string' && d.trim());
        const consequences = (Array.isArray(item.consequences) ? item.consequences : []).filter(c => typeof c === 'string' && c.trim());
        const parts = [clip(item.summary, 320)];
        if (decisions.length) parts.push(`Decisions: ${clip(decisions.join('; '), 200)}`);
        if (consequences.length) parts.push(`Consequences: ${clip(consequences.join('; '), 200)}`);
        return `- JOURNAL${ago ? ` (${ago}${where})` : where ? ` (${where.slice(2)})` : ''}: ${parts.join(' ')}`;
    });
    stats.journal = journal.length;
    sections.push(...journal);

    // 3. Story cards + world facts, secrecy tags intact.
    const cards = pick(
        (Array.isArray(state?.storyMemory) ? state.storyMemory : []).filter(c => c && typeof c === 'object' && typeof c.text === 'string' && c.text.trim()),
        scorer,
        c => `${c.subject || ''} ${c.text} ${(Array.isArray(c.linkedNpcNames) ? c.linkedNpcNames : []).join(' ')}`,
        CAPS.cards,
    ).map(({ item }) => {
        const ago = when(item.firstSeenMessage);
        const status = typeof item.status === 'string' ? item.status : 'active';
        return `- ${String(item.type || 'callback').toUpperCase()} on record${ago ? ` (${ago})` : ''}${status !== 'active' ? ` [${status}]` : ''}: ${formatSecrecyTag(item.knownBy)}${clip(item.text, 240)}`;
    });
    stats.cards = cards.length;
    sections.push(...cards);

    const facts = pick(
        (Array.isArray(state?.worldFacts) ? state.worldFacts : []).filter(f => f && typeof f === 'object' && typeof f.fact === 'string' && f.fact.trim()),
        scorer,
        f => f.fact,
        CAPS.facts,
    ).map(({ item }) => `- FACT: ${formatSecrecyTag(item.knownBy)}${clip(item.fact, 240)}`);
    stats.facts = facts.length;
    sections.push(...facts);

    // 4. The asked-about people: their key moments with the hero, the open thread.
    const roster = (Array.isArray(state?.npcs) ? state.npcs : []).filter(n => n && typeof n === 'object' && typeof n.name === 'string' && n.name.trim());
    const namedPeople = scorer.subjects.length > 0
        ? roster.filter(n => (findSubjectsInText(n.name, scorer.subjects, 1) || []).length > 0
            || (findSubjectsInText(scorer.subjects.join(' '), [n.name], 1) || []).length > 0)
        : [];
    const people = [];
    for (const npc of namedPeople.slice(0, CAPS.people)) {
        const { key, recent } = splitBondMoments(npc.bondMoments || []);
        const moments = [...key, ...recent.slice(0, 2)]
            .map(m => (m && typeof m.text === 'string' ? m.text : ''))
            .filter(Boolean)
            .slice(0, 4);
        const sentence = (text) => text.replace(/[.!?…]+$/, '');
        const thread = typeof npc.openThread === 'string' && npc.openThread.trim() ? ` Between ${npc.name} and ${heroName} now: ${sentence(clip(npc.openThread, 160))}.` : '';
        if (moments.length === 0 && !thread) continue;
        const history = moments.length > 0 ? ` Moments with ${heroName}: ${sentence(clip(moments.join(' | '), 400))}.` : '';
        people.push(`- ${clip(npc.name, 60)}'s record:${history}${thread}`);
    }
    stats.people = people.length;
    sections.push(...people);

    // 5. Verbatim lines — visible play only, and never the question being asked.
    const entries = collectNarrativeEntries(messages).filter(({ message, index }) =>
        index < messages.length - 1
        && (message.role === 'assistant' || message.role === 'user'));
    const verbatim = pick(entries, scorer, ({ message }) => message.content, CAPS.verbatim)
        .sort((a, b) => a.item.index - b.item.index)
        .map(({ item }) => {
            const ago = when(item.index);
            const who = item.message.role === 'user' ? `${heroName} said` : 'the DM narrated';
            return `- AS SAID${ago ? ` (${ago}` : '('}, ${who}): "${excerptAround(item.message.content, scorer)}"`;
        });
    stats.verbatim = verbatim.length;
    sections.push(...verbatim);

    // Budget: order of authority is push order, so the tail (verbatim) yields first.
    const lines = [];
    let used = 0;
    for (const line of sections) {
        if (used + line.length + 1 > maxChars) {
            if (lines.length === 0) {
                lines.push(clip(line, maxChars));
            }
            break;
        }
        lines.push(line);
        used += line.length + 1;
    }

    return {
        lines,
        text: lines.join('\n'),
        stats,
        empty: lines.length === 0,
        subjects: scorer.subjects,
        span: oldest !== null ? { oldest, newest } : null,
    };
}

const RECORD_RULES = `- Every name, number, place, and outcome in the answer comes from the record below or from the recent conversation. Never invent a plausible memory to fill a gap.
- Where the record holds nothing on a point, the answering character honestly does not remember, was not there, or never heard of it — said in their own voice. "I don't recall" always beats a confident fabrication.
- The character answers IN CHARACTER: with feeling, their own angle, and what it meant to them — but the facts are the facts.
- A line marked SECRET, or a moment this speaker could not have witnessed, can be relayed only as hearsay ("I heard…") or not at all. The hero's unspoken thoughts are known to no one.
- Asked what someone SAID, you may quote a line marked "AS SAID" exactly.
- Never request a roll to remember. Keep the scene alive after the answer (someone present acts, the ask stands) — but the record outranks brevity when the player asked for the record.`;

/**
 * The prompt block for a recall turn. Empty dossier → the honest variant.
 * @param {ReturnType<typeof buildRecallDossier> | null} dossier
 * @param {string} [question]
 */
export function buildRecallRecordBlock(dossier, question = '') {
    if (!dossier) return '';
    const asked = clip(question, 160);
    const about = dossier.subjects?.length ? dossier.subjects.map(s => clip(s, 40)).join(', ') : '';
    if (dossier.empty) {
        return `## THE RECORD — NOTHING FOUND, DO NOT INVENT
The player is asking about the PAST${asked ? ` ("${asked}")` : ''}. The engine searched this campaign's whole record${about ? ` for ${about}` : ''} — journal, facts, story cards, fights, quests, the transcript itself — and found NOTHING. That is the truth of the table: it did not happen on record, or nobody present could know it.
- Do NOT invent a plausible memory. The answering character honestly does not remember, was not there, never heard of it, or asks what the hero means — in their own voice.
- The only past you may draw on is the recent conversation you can see. Never request a roll to remember.
- Keep the scene alive after the honest answer (someone present acts, the ask stands).`;
    }
    return `## THE RECORD — ANSWER FROM THIS, NEVER INVENT
The player is asking about the PAST${asked ? ` ("${asked}")` : ''}. The engine looked it up. Below is the actual record of this campaign${about ? ` concerning ${about}` : ''}, most authoritative first (ledgers, then the journal, then cards and facts, then the people's own records, then lines quoted as said).
${RECORD_RULES}
${dossier.text}`;
}

/**
 * The player-facing receipt line — the trust signal that the game LOOKED.
 * @param {ReturnType<typeof buildRecallDossier> | null} dossier
 * @param {object[]} [messages] - for the span description
 */
export function describeRecallReceipt(dossier, messages = []) {
    if (!dossier) return '';
    const about = dossier.subjects?.length ? ` for ${dossier.subjects.map(s => clip(s, 40)).join(', ')}` : '';
    if (dossier.empty) {
        return `📜 Nothing on record${about} — the character answers only from what they could honestly know.`;
    }
    const s = dossier.stats || {};
    const parts = [];
    const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
    if (s.journal) parts.push(plural(s.journal, 'journal entry', 'journal entries'));
    if (s.fights) parts.push(plural(s.fights, 'fight', 'fights'));
    if (s.quests) parts.push(plural(s.quests, 'quest', 'quests'));
    if (s.fronts) parts.push(plural(s.fronts, 'ended matter', 'ended matters'));
    if (s.cards) parts.push(plural(s.cards, 'story card', 'story cards'));
    if (s.facts) parts.push(plural(s.facts, 'fact', 'facts'));
    if (s.people) parts.push(plural(s.people, "person's record", "people's records"));
    if (s.rolls) parts.push(plural(s.rolls, 'roll', 'rolls'));
    if (s.verbatim) parts.push(plural(s.verbatim, 'line as said', 'lines as said'));
    let span = '';
    if (dossier.span && Array.isArray(messages) && messages.length > 0) {
        const oldest = describeScenesAgo(messages, dossier.span.oldest);
        const newest = describeScenesAgo(messages, dossier.span.newest);
        span = oldest && newest ? (oldest === newest ? ` · ${oldest}` : ` · ${oldest} to ${newest}`) : '';
    }
    return `📜 From the record${about}: ${parts.join(' · ')}${span}.`;
}
