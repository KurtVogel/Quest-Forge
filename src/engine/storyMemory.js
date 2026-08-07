import { containment, overlapCount, tokenSet as sharedTokenSet } from './textMatch.js';

const ALLOWED_TYPES = new Set([
    'callback',
    'promise',
    'wound',
    'relationship',
    'mystery',
    'playerCanon',
    'foreshadow',
    'npcAgenda',
]);

const ALLOWED_STATUS = new Set(['active', 'resolved', 'dormant']);
const MAX_TEXT_LENGTH = 260;
const MAX_SUBJECT_LENGTH = 80;
const MAX_TAGS = 8;
const MAX_LINKED_NPCS = 6;
const DEFAULT_CARD_LIMIT = 5;
const CALLBACK_COOLDOWN_MS = 1000 * 60 * 8;
const TYPE_ALIASES = {
    player_canon: 'playerCanon',
    playercanon: 'playerCanon',
    npc_agenda: 'npcAgenda',
    npcagenda: 'npcAgenda',
};

function cleanText(value, fallback = '') {
    const text = String(value || '').replace(/\s+/g, ' ').trim();
    return text || fallback;
}

function clampNumber(value, min, max, fallback) {
    const n = Number(value);
    if (!Number.isFinite(n)) return fallback;
    return Math.max(min, Math.min(max, Math.round(n)));
}

function normalizeTextArray(value, max = MAX_TAGS) {
    const source = Array.isArray(value) ? value : [];
    return [...new Set(source.map(v => cleanText(v)).filter(Boolean))]
        .slice(0, max);
}

const STORY_STOP_WORDS = new Set([
    'the', 'and', 'that', 'with', 'from', 'this', 'they', 'your', 'you', 'for',
    'into', 'about', 'what', 'when', 'where', 'there', 'their', 'have', 'has',
    'had', 'was', 'were', 'are', 'but', 'not', 'all', 'his', 'her', 'she', 'him',
]);

// Shared Unicode tokenizer (textMatch.js): the old local `[a-z0-9']{3,}`
// matcher silently dropped every non-ASCII token, so cards about "Virtapää"
// could never dedupe or score by name.
function tokenSet(text) {
    return sharedTokenSet(text, { stopWords: STORY_STOP_WORDS, minLength: 3 });
}

const overlapScore = overlapCount;

/** tokenSet with possessives folded ("jack's" → "jack") so subject phrasings
 * like "Jack's promise" and "Jack, the promise" compare as the same entity. */
function meaningTokens(text) {
    return sharedTokenSet(text, { stopWords: STORY_STOP_WORDS, minLength: 3, foldPossessives: true });
}

/** Fraction of the SMALLER set's tokens found in the larger one (0..1). */
const tokenContainment = containment;

/** The Scribe re-reports the same durable beat with fresh framing each turn
 * ("Jack's promise to Oren…" / "Jack's broken promise to Oren, now amidst…"),
 * defeating the exact-subject/exact-text dedupe and flooding the card pool.
 * Same-type cards whose text token sets largely contain each other — or whose
 * subjects name the same entities with substantial text overlap — are the same
 * card being restated, not new material. */
export function isNearDuplicateStoryCard(a = {}, b = {}) {
    if (!a || !b || a.type !== b.type) return false;
    const textA = meaningTokens(a.text);
    const textB = meaningTokens(b.text);
    const textScore = tokenContainment(textA, textB);
    if (Math.min(textA.size, textB.size) >= 3 && textScore >= 0.75) return true;
    const subjectA = meaningTokens(a.subject);
    const subjectB = meaningTokens(b.subject);
    if (!subjectA.size || !subjectB.size) return false;
    return tokenContainment(subjectA, subjectB) >= 0.8 && textScore >= 0.5;
}

/** On a near-duplicate merge the newest framing usually wins, but a bare
 * fragment must never clobber a strictly richer record of the same beat. */
export function pickMergedCardText(existingText = '', incomingText = '') {
    if (!existingText) return incomingText;
    if (!incomingText) return existingText;
    const existing = meaningTokens(existingText);
    const incoming = meaningTokens(incomingText);
    const fragment = incoming.size < existing.size
        && overlapScore(incoming, existing) / (incoming.size || 1) >= 0.8;
    return fragment ? existingText : incomingText;
}

/** "public"/"everyone" in a knowers list means the info is NOT secret. */
const PUBLIC_KNOWER_RE = /^(public|everyone|everybody|all|common knowledge)$/i;

/**
 * Epistemics boundary (DECISIONS.md 2026-08-05 ×2): a non-empty knownBy list
 * marks information as PRIVATE to exactly those people. Empty/absent = common
 * knowledge. Any "public"-style entry clears the whole list — the extractor
 * saying "everyone knows" must never render as a secret known to "everyone".
 */
export function normalizeKnownBy(value) {
    const list = normalizeTextArray(value, MAX_LINKED_NPCS);
    if (list.some(name => PUBLIC_KNOWER_RE.test(name))) return [];
    return list;
}

/** "[SECRET — known only to: X, Y] " prefix, or '' for common knowledge. */
export function formatSecrecyTag(knownBy) {
    const list = Array.isArray(knownBy) ? knownBy.map(v => cleanText(v)).filter(Boolean).slice(0, MAX_LINKED_NPCS) : [];
    return list.length > 0 ? `[SECRET — known only to: ${list.join(', ')}] ` : '';
}

export function normalizeStoryMemoryCard(card = {}, existing = null) {
    const now = Date.now();
    const text = cleanText(card.text || card.memory || card.note, existing?.text || '').slice(0, MAX_TEXT_LENGTH);
    if (!text) return null;

    const rawType = cleanText(card.type, existing?.type || 'callback');
    const aliasedType = TYPE_ALIASES[rawType] || TYPE_ALIASES[rawType.toLowerCase()] || rawType;
    const type = ALLOWED_TYPES.has(aliasedType) ? aliasedType : 'callback';
    const rawStatus = cleanText(card.status, existing?.status || 'active');
    const status = ALLOWED_STATUS.has(rawStatus) ? rawStatus : 'active';
    // Conditional keys: an update that omits the field must not wipe the
    // stored value through the {...existing, ...card} merge spread.
    const knownBy = normalizeKnownBy(card.knownBy ?? card.known_by ?? existing?.knownBy);
    // witnessed and knownBy are mutually exclusive; when the extractor emits
    // both (2026-08-06 live playtest: a public accusation carried
    // knownBy ["the hero"]), secrecy wins — a secret must never travel as
    // hearsay, while an under-traveled public deed is only lost color.
    const witnessed = knownBy.length === 0
        && (card.witnessed !== undefined ? !!card.witnessed : !!existing?.witnessed);
    // Reducer-stamped at card birth; ages witnessed deeds for regional hearsay.
    const firstSeenMessage = Number.isFinite(card.firstSeenMessage)
        ? card.firstSeenMessage
        : (Number.isFinite(existing?.firstSeenMessage) ? existing.firstSeenMessage : undefined);

    return {
        ...(knownBy.length > 0 && { knownBy }),
        ...(witnessed && { witnessed: true }),
        ...(Number.isFinite(firstSeenMessage) && { firstSeenMessage }),
        id: cleanText(card.id, existing?.id || `mem-${now}-${Math.random().toString(36).slice(2, 7)}`),
        type,
        text,
        subject: cleanText(card.subject, existing?.subject || '').slice(0, MAX_SUBJECT_LENGTH),
        tags: normalizeTextArray(card.tags, MAX_TAGS),
        salience: clampNumber(card.salience, 1, 5, existing?.salience ?? 3),
        emotionalCharge: clampNumber(card.emotionalCharge ?? card.emotional_charge, 0, 5, existing?.emotionalCharge ?? 2),
        status,
        firstSeenAt: card.firstSeenAt || card.first_seen_at || existing?.firstSeenAt || now,
        lastSeenAt: card.lastSeenAt || card.last_seen_at || now,
        lastUsedAt: card.lastUsedAt || card.last_used_at || existing?.lastUsedAt || null,
        source: cleanText(card.source, existing?.source || 'scribe').slice(0, 40),
        linkedNpcNames: normalizeTextArray(card.linkedNpcNames || card.linked_npc_names, MAX_LINKED_NPCS),
        location: cleanText(card.location, existing?.location || '').slice(0, MAX_SUBJECT_LENGTH),
    };
}

export function normalizeStoryMemoryUpdate(update = {}) {
    if (!update || typeof update !== 'object') return null;
    const id = cleanText(update.id || update.memoryId || update.memory_id);
    const subject = cleanText(update.subject);
    const text = cleanText(update.text);
    if (!id && !subject && !text) return null;

    const out = {};
    if (id) out.id = id;
    if (subject) out.subject = subject.slice(0, MAX_SUBJECT_LENGTH);
    if (text) out.text = text.slice(0, MAX_TEXT_LENGTH);
    if (update.status && ALLOWED_STATUS.has(update.status)) out.status = update.status;
    // The engine owns the clock: `used: true` stamps Date.now(). A raw
    // lastUsedAt pass-through was never part of the DM contract ({id, used})
    // and would let a hallucinated timestamp pin a card outside — or forever
    // inside — scoreStoryMemory's callback-cooldown gate (2026-07-14 audit).
    if (update.used || update.markUsed || update.mark_used) out.lastUsedAt = Date.now();
    if (update.salience !== undefined) out.salience = clampNumber(update.salience, 1, 5, 3);
    if (update.emotionalCharge !== undefined || update.emotional_charge !== undefined) {
        out.emotionalCharge = clampNumber(update.emotionalCharge ?? update.emotional_charge, 0, 5, 2);
    }
    if (Array.isArray(update.tags)) out.tags = normalizeTextArray(update.tags, MAX_TAGS);
    if (Array.isArray(update.linkedNpcNames) || Array.isArray(update.linked_npc_names)) {
        out.linkedNpcNames = normalizeTextArray(update.linkedNpcNames || update.linked_npc_names, MAX_LINKED_NPCS);
    }
    if (update.location) out.location = cleanText(update.location).slice(0, MAX_SUBJECT_LENGTH);
    return out;
}

export function findStoryMemoryMatch(memories = [], card = {}) {
    const subject = cleanText(card.subject).toLowerCase();
    const text = cleanText(card.text).toLowerCase();
    return memories.findIndex(m => {
        if (card.id && m.id === card.id) return true;
        if (subject && m.subject?.toLowerCase() === subject && m.type === card.type) return true;
        if (text && m.text?.toLowerCase() === text) return true;
        return isNearDuplicateStoryCard(m, card);
    });
}

export function scoreStoryMemory(card, { query = '', location = '', npcs = [], now = Date.now() } = {}) {
    if (!card || (card.status || 'active') !== 'active') return 0;
    if (card.lastUsedAt && now - card.lastUsedAt < CALLBACK_COOLDOWN_MS) return 0;

    const queryTokens = tokenSet([
        query,
        location,
        ...(npcs || []).map(n => `${n.name || ''} ${n.disposition || ''} ${n.lastNotes || n.notes || ''}`),
    ].filter(Boolean).join(' '));
    // Exported entry point: guard field types rather than trust every caller
    // to pass a normalized card (all stored cards are, but the function isn't).
    const cardTags = Array.isArray(card.tags) ? card.tags : [];
    const cardNpcNames = Array.isArray(card.linkedNpcNames) ? card.linkedNpcNames : [];
    const cardTokens = tokenSet([
        card.text,
        card.subject,
        card.location,
        ...cardTags,
        ...cardNpcNames,
    ].filter(Boolean).join(' '));

    let score = card.salience * 2 + card.emotionalCharge;
    score += overlapScore(cardTokens, queryTokens) * 3;

    if (location && card.location && card.location.toLowerCase() === String(location).toLowerCase()) {
        score += 4;
    }

    const npcNames = new Set((npcs || []).map(n => String(n.name || '').toLowerCase()).filter(Boolean));
    for (const name of cardNpcNames) {
        if (npcNames.has(String(name).toLowerCase())) score += 5;
    }

    if (card.lastSeenAt) {
        const ageHours = Math.max(0, (now - card.lastSeenAt) / (1000 * 60 * 60));
        score += Math.max(0, 3 - ageHours / 24);
    }

    if (card.type === 'promise' || card.type === 'mystery' || card.type === 'foreshadow') score += 2;
    if (card.type === 'playerCanon') score += 1;

    return score;
}

/** How many journal cadences of silence age a low-salience card out. */
export const DORMANCY_JOURNAL_CYCLES = 3;
/** Long-payoff card types that never decay — their moment may be far away. */
const DORMANCY_EXEMPT_TYPES = new Set(['promise', 'playerCanon']);

/**
 * Journal-cadence age-out (IDEAS.md 2026-07-14; 2026-08-06 audit — the pool
 * only ever grew): active salience-1/2 cards untouched across the last
 * DORMANCY_JOURNAL_CYCLES journal entries decay to `dormant` — still in saves,
 * skipped by curation and the RAG seed, and revived automatically if the
 * Scribe re-reports the beat (the ADD_STORY_MEMORY_CARD merge restores
 * `active`). "Untouched" compares the card's last merge/use stamp against the
 * timestamp of the journal entry N cycles back, so the measure is
 * conversational (a cadence ≈ 10 messages) while using existing stamps.
 */
export function applyStoryMemoryDormancy(cards = [], journal = []) {
    const list = Array.isArray(cards) ? cards : [];
    const entries = Array.isArray(journal) ? journal : [];
    if (entries.length < DORMANCY_JOURNAL_CYCLES) return list;
    const cutoff = entries[entries.length - DORMANCY_JOURNAL_CYCLES]?.timestamp;
    if (!Number.isFinite(cutoff)) return list;

    let changed = false;
    const next = list.map(card => {
        if (!card || (card.status || 'active') !== 'active') return card;
        if ((card.salience || 0) > 2 || DORMANCY_EXEMPT_TYPES.has(card.type)) return card;
        const lastTouch = Math.max(card.lastSeenAt || 0, card.lastUsedAt || 0, card.firstSeenAt || 0);
        if (lastTouch >= cutoff) return card;
        changed = true;
        return { ...card, status: 'dormant' };
    });
    return changed ? next : list;
}

export function curateStoryMemory({ memories = [], query = '', location = '', npcs = [], now = Date.now(), limit = DEFAULT_CARD_LIMIT } = {}) {
    return (memories || [])
        .map(card => ({ card, score: scoreStoryMemory(card, { query, location, npcs, now }) }))
        .filter(item => item.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, limit)
        .map(item => ({ ...item.card, score: item.score }));
}

export function buildStoryMemoryPromptBlock(memories = []) {
    if (!memories.length) return '';
    const lines = memories.slice(0, DEFAULT_CARD_LIMIT).map(m => {
        const subject = m.subject ? ` | subject: ${m.subject}` : '';
        // Array.isArray, not just ?.length — a string value has .length but no .join.
        const npcs = Array.isArray(m.linkedNpcNames) && m.linkedNpcNames.length ? ` | NPCs: ${m.linkedNpcNames.join(', ')}` : '';
        const loc = m.location ? ` | location: ${m.location}` : '';
        return `- ${formatSecrecyTag(m.knownBy)}(${m.type}; salience ${m.salience}/5${subject}${npcs}${loc}) ${m.text}`;
    }).join('\n');

    return `## DRAMATIC CALLBACK OPPORTUNITIES
These are compact story memories that may matter now. Use at most ONE naturally if it improves the scene. Do not force a callback, do not explain this memory system, and do not slow the turn down just to prove you remember something. If you visibly pay off or resolve one, mark it with memory_updates in the JSON. A memory tagged SECRET is known ONLY to the people listed — no other character may reference or act on it.
${lines}`;
}
