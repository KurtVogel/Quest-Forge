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

function tokenSet(text) {
    const stop = new Set([
        'the', 'and', 'that', 'with', 'from', 'this', 'they', 'your', 'you', 'for',
        'into', 'about', 'what', 'when', 'where', 'there', 'their', 'have', 'has',
        'had', 'was', 'were', 'are', 'but', 'not', 'all', 'his', 'her', 'she', 'him',
    ]);
    return new Set(String(text || '')
        .toLowerCase()
        .match(/[a-z0-9']{3,}/g)
        ?.filter(t => !stop.has(t)) || []);
}

function overlapScore(a, b) {
    if (!a.size || !b.size) return 0;
    let hits = 0;
    for (const token of a) {
        if (b.has(token)) hits += 1;
    }
    return hits;
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

    return {
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
    if (update.used || update.markUsed || update.mark_used) out.lastUsedAt = Date.now();
    if (update.lastUsedAt || update.last_used_at) out.lastUsedAt = update.lastUsedAt || update.last_used_at;
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
        return text && m.text?.toLowerCase() === text;
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
    const cardTokens = tokenSet([
        card.text,
        card.subject,
        card.location,
        ...(card.tags || []),
        ...(card.linkedNpcNames || []),
    ].filter(Boolean).join(' '));

    let score = card.salience * 2 + card.emotionalCharge;
    score += overlapScore(cardTokens, queryTokens) * 3;

    if (location && card.location && card.location.toLowerCase() === String(location).toLowerCase()) {
        score += 4;
    }

    const npcNames = new Set((npcs || []).map(n => String(n.name || '').toLowerCase()).filter(Boolean));
    for (const name of card.linkedNpcNames || []) {
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
        const npcs = m.linkedNpcNames?.length ? ` | NPCs: ${m.linkedNpcNames.join(', ')}` : '';
        const loc = m.location ? ` | location: ${m.location}` : '';
        return `- (${m.type}; salience ${m.salience}/5${subject}${npcs}${loc}) ${m.text}`;
    }).join('\n');

    return `## DRAMATIC CALLBACK OPPORTUNITIES
These are compact story memories that may matter now. Use at most ONE naturally if it improves the scene. Do not force a callback, do not explain this memory system, and do not slow the turn down just to prove you remember something. If you visibly pay off or resolve one, mark it with memory_updates in the JSON.
${lines}`;
}
