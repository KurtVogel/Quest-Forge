/**
 * Long-term memory: world facts (near-duplicate rejection), story-memory
 * cards, journal entries/summarization marks, and the campaign chronicle.
 */
import { containment, tokenSet } from '../../engine/textMatch.js';
import {
    applyStoryMemoryDormancy,
    findStoryMemoryMatch,
    normalizeStoryMemoryCard,
    normalizeStoryMemoryUpdate,
    pickMergedCardText,
} from '../../engine/storyMemory.js';
import { gameReducer } from '../gameReducer.js';
import { sanitizeWorldFactPayload, stampNpcRelationshipArcs } from './shared.js';

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
 * Append chronicle chapter(s). The payload may be one chapter or an array —
 * a very long "Close chapter" span arrives as multiple parts in ONE action so
 * the flushAutoSave action-replay persists them all atomically (2026-08-29).
 */
export function appendChronicleChapter(chronicle = [], payload = {}) {
    const items = Array.isArray(payload) ? payload : [payload];
    let chapters = chronicle || [];
    for (const item of items) {
        const text = String(item?.text || '').trim();
        if (!text) continue;
        chapters = [...chapters, {
            id: `chapter-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
            title: String(item.title || '').trim().slice(0, 80) || `Chapter ${chapters.length + 1}`,
            text: text.slice(0, 60000),
            fromIndex: Number.isFinite(item.fromIndex) ? item.fromIndex : 0,
            toIndex: Number.isFinite(item.toIndex) ? item.toIndex : 0,
            createdAt: Date.now(),
        }];
    }
    return chapters;
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
            // Message-index birth stamp: regional hearsay measures a witnessed
            // deed's age in conversational messages, which wall-clock can't do.
            const born = { ...card, firstSeenMessage: (state.messages || []).length };
            return { ...state, storyMemory: [...(state.storyMemory || []), born] };
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
        const cards = state.storyMemory || [];
        // Identity resolution, strictest first: id, then subject — but a bare
        // subject shared by cards of different types is ambiguous ("Oren" could
        // mark the wrong card used/rewritten — 2026-08-06 audit), so subject
        // acts only when it names exactly ONE card. Exact text is the last
        // resort (the DM referencing a card by its wording).
        let idx = update.id ? cards.findIndex(memory => memory.id === update.id) : -1;
        if (idx === -1 && update.subject) {
            const matches = cards.reduce((acc, memory, i) => {
                if (memory.subject?.toLowerCase() === update.subject.toLowerCase()) acc.push(i);
                return acc;
            }, []);
            if (matches.length === 1) idx = matches[0];
        }
        if (idx === -1 && update.text) {
            idx = cards.findIndex(memory => memory.text?.toLowerCase() === update.text.toLowerCase());
        }
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
        const journal = [...state.journal, {
            id: action.payload.id || `journal-${Date.now()}`,
            timestamp: action.payload.timestamp || Date.now(),
            ...action.payload,
        }];
        return {
            ...state,
            journal,
            // The journal cadence doubles as the story-memory age-out pass:
            // low-salience cards silent for DORMANCY_JOURNAL_CYCLES cadences
            // go dormant (a Scribe re-report revives them).
            storyMemory: applyStoryMemoryDormancy(state.storyMemory, journal),
            // ...and as the relationship-arc stamp: a disposition shift enters
            // an NPC's history only if it held until this cadence (2026-08-28).
            npcs: stampNpcRelationshipArcs(state.npcs),
        };
    },

    ADD_CHRONICLE_CHAPTER(state, action) {
        const chronicle = appendChronicleChapter(state.chronicle, action.payload);
        if (chronicle === (state.chronicle || [])) return state;
        // Writing a chapter consumes the front-resolution ceremony nudge.
        const session = state.session?.chapterCloseSuggested
            ? { ...state.session, chapterCloseSuggested: null }
            : state.session;
        return { ...state, chronicle, session };
    },

    REMOVE_CHRONICLE_CHAPTER(state, action) {
        // Only the NEWEST chapter is removable: the next "Close chapter" always
        // resumes after the last chapter's toIndex, so removing the newest one
        // re-opens exactly its span for a fresh retelling (the recovery path for
        // a bad/truncated chapter), while removing a middle chapter would leave
        // a hole no future close could ever retell. The source messages are
        // never deleted, so nothing is lost but the prose.
        const chapters = state.chronicle || [];
        const last = chapters[chapters.length - 1];
        if (!last || !action.payload?.id || last.id !== action.payload.id) return state;
        return { ...state, chronicle: chapters.slice(0, -1) };
    },
};
