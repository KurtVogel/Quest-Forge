/**
 * Long-term memory: world facts (near-duplicate rejection), story-memory
 * cards, journal entries/summarization marks, and the campaign chronicle.
 */
import { containment, tokenSet } from '../../engine/textMatch.js';
import {
    findStoryMemoryMatch,
    normalizeStoryMemoryCard,
    normalizeStoryMemoryUpdate,
    pickMergedCardText,
} from '../../engine/storyMemory.js';
import { gameReducer } from '../gameReducer.js';
import { sanitizeWorldFactPayload } from './shared.js';

// --- World-fact near-duplicate detection (Scribe over-extraction guard) ---
const FACT_STOP_WORDS = new Set([
    'the', 'a', 'an', 'of', 'to', 'in', 'is', 'are', 'was', 'were', 'and', 'or',
    'that', 'this', 'it', 'its', 'their', 'his', 'her', 'has', 'have', 'had',
    'by', 'for', 'with', 'at', 'on', 'as', 'be', 'been', 'from', 'now', 'not', 'no',
]);

function factTokenSet(text) {
    return tokenSet(text, { stopWords: FACT_STOP_WORDS });
}

// A fact whose meaningful tokens are ~all contained in an existing fact (or vice
// versa) is a restatement — "Odo is dead" vs "Odo is dead, killed at the docks".
function isNearDuplicateFact(candidate, existingSets) {
    const tokens = factTokenSet(candidate);
    if (tokens.size === 0) return true;
    return existingSets.some(existing => containment(tokens, existing) >= 0.9);
}

/**
 * Append a chronicle chapter; shared by ADD_CHRONICLE_CHAPTER and
 * flushAutoSave's pre-render merge.
 */
export function appendChronicleChapter(chronicle = [], payload = {}) {
    const text = String(payload.text || '').trim();
    if (!text) return chronicle || [];
    const chapters = chronicle || [];
    return [...chapters, {
        id: `chapter-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        title: String(payload.title || '').trim().slice(0, 80) || `Chapter ${chapters.length + 1}`,
        text: text.slice(0, 60000),
        fromIndex: Number.isFinite(payload.fromIndex) ? payload.fromIndex : 0,
        toIndex: Number.isFinite(payload.toIndex) ? payload.toIndex : 0,
        createdAt: Date.now(),
    }];
}

export const handlers = {
    ADD_WORLD_FACTS(state, action) {
        // Bulk add, rejecting exact and near-duplicate restatements of known facts
        // (the Scribe tends to re-canonize the same truth with slight rewording).
        const existingSets = state.worldFacts.map(f => factTokenSet(f.fact));
        const newFacts = [];
        for (const f of action.payload || []) {
            const sanitized = sanitizeWorldFactPayload(f);
            if (!sanitized || isNearDuplicateFact(sanitized.fact, existingSets)) continue;
            existingSets.push(factTokenSet(sanitized.fact));
            newFacts.push({
                id: `fact-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
                timestamp: Date.now(),
                ...sanitized,
            });
        }
        if (newFacts.length === 0) return state;
        return { ...state, worldFacts: [...state.worldFacts, ...newFacts] };
    },

    ADD_STORY_MEMORY_CARD(state, action) {
        const card = normalizeStoryMemoryCard(action.payload);
        if (!card) return state;
        const idx = findStoryMemoryMatch(state.storyMemory || [], card);
        if (idx === -1) {
            return { ...state, storyMemory: [...(state.storyMemory || []), card] };
        }
        const existing = state.storyMemory[idx];
        return {
            ...state,
            storyMemory: state.storyMemory.map((memory, i) => i === idx
                ? normalizeStoryMemoryCard({
                    ...existing,
                    ...card,
                    text: pickMergedCardText(existing.text, card.text),
                    firstSeenAt: existing.firstSeenAt,
                    lastSeenAt: Date.now(),
                    salience: Math.max(existing.salience || 1, card.salience || 1),
                    emotionalCharge: Math.max(existing.emotionalCharge || 0, card.emotionalCharge || 0),
                    tags: [...new Set([...(existing.tags || []), ...(card.tags || [])])],
                    linkedNpcNames: [...new Set([...(existing.linkedNpcNames || []), ...(card.linkedNpcNames || [])])],
                }, existing)
                : memory),
        };
    },

    ADD_STORY_MEMORY_CARDS(state, action) {
        let next = state;
        for (const card of action.payload || []) {
            next = gameReducer(next, { type: 'ADD_STORY_MEMORY_CARD', payload: card });
        }
        return next;
    },

    UPDATE_STORY_MEMORY(state, action) {
        const update = normalizeStoryMemoryUpdate(action.payload);
        if (!update) return state;
        const idx = (state.storyMemory || []).findIndex(memory =>
            (update.id && memory.id === update.id) ||
            (update.subject && memory.subject?.toLowerCase() === update.subject.toLowerCase()) ||
            (update.text && memory.text?.toLowerCase() === update.text.toLowerCase())
        );
        if (idx === -1) return state;
        return {
            ...state,
            storyMemory: state.storyMemory.map((memory, i) => i === idx
                ? normalizeStoryMemoryCard({ ...memory, ...update, lastSeenAt: Date.now() }, memory)
                : memory),
        };
    },

    // Mark a batch of messages as summarized (excluded from future LLM history)
    MARK_MESSAGES_SUMMARIZED(state, action) {
        // action.payload = index up to which messages are now summarized
        const upTo = action.payload;
        return {
            ...state,
            messages: state.messages.map((msg, idx) =>
                idx < upTo ? { ...msg, summarized: true } : msg
            ),
            session: { ...state.session, prunedMessageCount: upTo },
        };
    },

    ADD_JOURNAL_ENTRY(state, action) {
        return {
            ...state,
            journal: [...state.journal, {
                id: action.payload.id || `journal-${Date.now()}`,
                timestamp: action.payload.timestamp || Date.now(),
                ...action.payload,
            }],
        };
    },

    ADD_CHRONICLE_CHAPTER(state, action) {
        const chronicle = appendChronicleChapter(state.chronicle, action.payload);
        if (chronicle === (state.chronicle || [])) return state;
        return { ...state, chronicle };
    },
};
