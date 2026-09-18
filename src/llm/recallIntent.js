/**
 * Recall intent — the player asking a character (or the DM) about the PAST
 * ("remember when…", "what happened at…", "what did she say…") — WOW
 * 2026-09-18, "the engine and the DM conspire to answer from the record".
 *
 * Deterministic, the tableTalk.js pattern: zero LLM calls, a sync regex
 * floor. A detected recall turn makes the orchestrator assemble the engine's
 * RECALL DOSSIER (`engine/recallDossier.js`) from the never-deleted
 * transcript and the engine-owned ledgers, widen retrieval with the asked-
 * about people counted as present, and append `## THE RECORD` to the prompt
 * so the answer comes from what actually happened, never from a plausible
 * fabrication. In-character questions AND OOC table talk both qualify —
 * the OOC lane simply keeps its own response mode on top.
 *
 * Subjects are the known entities the question names (roster people, party
 * companions, places, quests) plus capitalized free names; query tokens are
 * the question's content words with the recall phrasing itself removed.
 */

import { tokenSet } from '../engine/textMatch.js';
import { findSubjectsInText } from '../engine/vectorMemory.js';

/** Recall phrasings, applied after any OOC prefix is stripped. */
const RECALL_PATTERNS = [
    /\b(?:do|don['’]?t|did|didn['’]?t|can|could|would)?\s*(?:you|ya)\s+(?:still\s+|even\s+)?(?:remember|recall)\b/i,
    /\bremember\s+(?:when|how|that|the|what|who|where|why|our|my|your|his|her|their|those|this|back|me)\b/i,
    /\bremember\s*\?/i,
    /^\s*remember\b/i,
    /\bremember\s+\p{Lu}\p{Ll}+/u,
    /\bwhat\s+(?:really\s+|actually\s+|exactly\s+)?happened\s+(?:when|at|in|to|with|after|before|back|that|the|on|during|there|here|last)\b/i,
    /\bback\s+when\b/i,
    /\b(?:the\s+)?last\s+time\s+(?:we|you|i|he|she|they)\b/i,
    /\bthe\s+(?:first\s+|other\s+)?time\s+(?:we|you|i|he|she|they)\b/i,
    /\btell\s+me\s+(?:again\s+)?(?:what\s+happened|how\s+it\s+went|about\s+(?:the\s+)?(?:time|night|day|fight|battle)\b)/i,
    /\btell\s+me\s+again\b/i,
    /\bremind\s+(?:me|us)\b/i,
    /\bwhat\s+did\s+(?:\S+\s+){0,3}?(?:say|tell|promise|swear|do|give|want|call|offer|ask)\b/i,
    /\bwho\s+was\s+(?:it|the\s+one|that|he|she)\b/i,
    /\bwhere\s+did\s+(?:we|you|i|they|he|she)\b/i,
    /\bhow\s+did\s+(?:we|you|i|they|he|she)\s+(?:get|meet|end|come|find|escape|survive|win|lose|first)\b/i,
    /\bdidn['’]?t\s+(?:we|you|i|he|she|they)\s+(?:once\s+)?(?:\S+\s+){0,2}?(?:fight|meet|kill|find|promise|say|agree|see|go|take|lose|leave|save|pay|owe)\b/i,
    /\bwasn['’]?t\s+(?:it|that)\s+(?:you|him|her|them)\s+who\b/i,
    /\bwhat\s+was\s+(?:the\s+name\s+of|his\s+name|her\s+name|their\s+name|that\s+(?:place|town|village|inn|man|woman)\s+called)\b/i,
    /\bwhat(?:['’]s|\s+is|\s+was)\s+(?:his|her|their)\s+name\b/i,
    /\byou\s+(?:once\s+)?(?:told|promised|swore|mentioned|warned)\s+(?:me|us)\b/i,
    /\byou\s+said\s+(?:that|you|we|it|he|she|they|the)\b/i,
    /\bwhatever\s+(?:happened|became)\s+(?:to|of)\b/i,
];

/** Words that belong to the recall phrasing, not to the thing recalled. */
const RECALL_STOP_WORDS = new Set([
    'remember', 'recall', 'remind', 'happened', 'happen', 'time', 'back', 'last', 'when',
    'tell', 'again', 'about', 'said', 'told', 'promised', 'what', 'name', 'called', 'thing',
    'that', 'this', 'those', 'these', 'with', 'from', 'into', 'there', 'here', 'their', 'your',
    'have', 'were', 'was', 'you', 'the', 'and', 'but', 'not', 'did', 'didn', 'does', 'doesn',
    'don', 'still', 'even', 'really', 'actually', 'exactly', 'ever', 'once', 'ago', 'then',
    'they', 'them', 'she', 'her', 'his', 'him', 'our', 'ours', 'yours', 'who', 'whom', 'where',
    'how', 'why', 'which', 'whatever', 'became', 'wasn', 'isn', 'aren', 'weren', 'could',
    'would', 'should', 'can', 'will', 'know', 'think', 'thought', 'mean', 'meant', 'anything',
    'something', 'everything', 'nothing', 'ooc', 'please', 'just', 'like', 'also', 'ever',
    'first', 'other', 'night', 'day', 'ago', 'before', 'after', 'during', 'while', 'well',
]);

/** The OOC prefix the table-talk detector honors, stripped before matching. */
const OOC_PREFIX = /^\s*(?:[([]\s*ooc\s*[)\]]?\s*[:,]?|\/?ooc\b\s*[:,]?|(?:hey\s+|hi\s+)?(?:dm|gm|dungeon\s+master|game\s+master)\s*[:,])\s*/i;

const MAX_SUBJECTS = 6;
const MAX_QUERY_TOKENS = 12;
const MAX_QUESTION_CHARS = 200;

/**
 * First-person narration ("I remember my training and steady my breath") is
 * the hero remembering, not asking — unless it is actually a question.
 */
const FIRST_PERSON_REMEMBERING = /\bI\s+(?:still\s+|can\s+|do\s+|will\s+|always\s+)?(?:remember|recall)\b/i;

/** True when the message asks about the past. Pure, sync. */
export function isRecallQuestion(text) {
    const body = String(text || '').replace(OOC_PREFIX, '');
    if (!body.trim()) return false;
    if (FIRST_PERSON_REMEMBERING.test(body) && !body.includes('?')) return false;
    return RECALL_PATTERNS.some(pattern => pattern.test(body));
}

/**
 * Capitalized words that are not sentence-initial — free proper names the
 * roster may not know ("that smuggler Orzo"). Sentence-initial words are
 * skipped because English capitalizes them regardless.
 */
function freeProperNames(body) {
    const names = [];
    const seen = new Set();
    const re = /(^|[.!?]\s+|\s)(\p{Lu}\p{Ll}{2,})/gu;
    let match;
    while ((match = re.exec(body)) !== null) {
        const leadIn = match[1];
        const word = match[2];
        const sentenceStart = leadIn === '' || /[.!?]\s+$/.test(leadIn);
        if (sentenceStart) continue;
        const key = word.toLowerCase();
        if (seen.has(key) || RECALL_STOP_WORDS.has(key)) continue;
        seen.add(key);
        names.push(word);
    }
    return names;
}

function cleanNames(list) {
    return (Array.isArray(list) ? list : [])
        .map(name => (typeof name === 'string' ? name.trim() : ''))
        .filter(Boolean);
}

/**
 * Detect a recall question and extract what it is about.
 *
 * @param {string} text - the player's message (OOC prefix allowed)
 * @param {object} [known] - the campaign's known entities
 * @param {string[]} [known.npcNames]
 * @param {string[]} [known.partyNames]
 * @param {string[]} [known.locationNames]
 * @param {string[]} [known.questNames]
 * @returns {{ question: string, subjects: string[], queryTokens: string[], tableTalk: boolean } | null}
 */
export function detectRecallIntent(text, known = {}) {
    const raw = String(text || '');
    if (!isRecallQuestion(raw)) return null;
    const tableTalk = OOC_PREFIX.test(raw);
    const body = raw.replace(OOC_PREFIX, '').trim();

    const subjects = [];
    const seen = new Set();
    const addSubject = (name) => {
        const key = String(name).toLowerCase();
        if (!key || seen.has(key) || subjects.length >= MAX_SUBJECTS) return;
        seen.add(key);
        subjects.push(String(name));
    };
    const knownNames = [
        ...cleanNames(known.npcNames),
        ...cleanNames(known.partyNames),
        ...cleanNames(known.locationNames),
        ...cleanNames(known.questNames),
    ];
    for (const name of findSubjectsInText(body, knownNames, MAX_SUBJECTS) || []) addSubject(name);
    for (const name of freeProperNames(body)) {
        // A free name already covered by a known entity's tokens is that entity.
        const covered = subjects.some(subject => tokenSet(subject).has(name.toLowerCase()));
        if (!covered) addSubject(name);
    }

    const queryTokens = [...tokenSet(body, { stopWords: RECALL_STOP_WORDS, minLength: 4, foldPossessives: true })]
        .slice(0, MAX_QUERY_TOKENS);

    return {
        question: body.slice(0, MAX_QUESTION_CHARS),
        subjects,
        queryTokens,
        tableTalk,
    };
}
