/**
 * Vector Memory — RAG (Retrieval-Augmented Generation) for long-term RPG memory.
 *
 * How it works:
 * 1. Significant events (world facts, journal summaries, NPC interactions) are
 *    embedded as 768-dim vectors using Gemini's text-embedding-004 model.
 * 2. Embeddings are persisted in IndexedDB so they survive page refreshes.
 * 3. Before each DM prompt, the current scene context is embedded and we retrieve
 *    the top-N most semantically relevant past memories.
 * 4. Retrieved memories are injected into the system prompt so the DM "remembers"
 *    relevant past events even from very early in the session.
 *
 * All similarity search is done client-side (cosine similarity) — no backend needed.
 */

import { embedText } from '../llm/providers/gemini.js';

// --- IndexedDB persistence for embeddings ---
const EMBED_DB_NAME = 'rpg-vector-memory';
const EMBED_DB_VERSION = 1;
const EMBED_STORE = 'embeddings';

function openEmbedDB() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(EMBED_DB_NAME, EMBED_DB_VERSION);
        request.onerror = () => reject(request.error);
        request.onsuccess = () => resolve(request.result);
        request.onupgradeneeded = (event) => {
            const db = event.target.result;
            if (!db.objectStoreNames.contains(EMBED_STORE)) {
                db.createObjectStore(EMBED_STORE, { keyPath: 'text' });
            }
        };
    });
}

function persistEmbedding(entry) {
    openEmbedDB().then(db => {
        const tx = db.transaction(EMBED_STORE, 'readwrite');
        tx.objectStore(EMBED_STORE).put(entry);
        tx.oncomplete = () => db.close();
    }).catch(() => {}); // Non-critical — in-memory still works
}

function clearPersistedEmbeddings() {
    openEmbedDB().then(db => {
        const tx = db.transaction(EMBED_STORE, 'readwrite');
        tx.objectStore(EMBED_STORE).clear();
        tx.oncomplete = () => db.close();
    }).catch(() => {});
}

async function loadPersistedEmbeddings() {
    try {
        const db = await openEmbedDB();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(EMBED_STORE, 'readonly');
            const request = tx.objectStore(EMBED_STORE).getAll();
            request.onsuccess = () => resolve(request.result || []);
            request.onerror = () => reject(request.error);
            tx.oncomplete = () => db.close();
        });
    } catch (e) {
        return [];
    }
}

// --- In-memory store ---

/** In-memory store: { text, vector, category, timestamp }[] */
let memoryStore = [];

/** Simple cosine similarity between two numeric arrays. */
function cosineSimilarity(a, b) {
    if (!a || !b || a.length !== b.length) return 0;
    let dot = 0, magA = 0, magB = 0;
    for (let i = 0; i < a.length; i++) {
        dot += a[i] * b[i];
        magA += a[i] * a[i];
        magB += b[i] * b[i];
    }
    const denom = Math.sqrt(magA) * Math.sqrt(magB);
    return denom === 0 ? 0 : dot / denom;
}

/**
 * Add a memory entry and embed it. Also persists to IndexedDB.
 * Silently skips if embedding fails.
 * @param {string} apiKey - Gemini API key
 * @param {string} text - The memory text
 * @param {string} [category] - e.g. 'world_fact', 'journal', 'npc', 'event'
 */
export async function addMemory(apiKey, text, category = 'general') {
    if (!apiKey || !text?.trim()) return;

    // Deduplicate by exact text
    if (memoryStore.some(m => m.text === text)) return;

    const vector = await embedText(apiKey, text);
    if (!vector) {
        console.error('[VectorMemory] Embedding failed for:', text.slice(0, 80));
        return;
    }

    const entry = { text, vector, category, timestamp: Date.now() };
    memoryStore.push(entry);
    persistEmbedding(entry); // fire-and-forget to IndexedDB
}

/**
 * Bulk-add memories. First tries to load cached embeddings from IndexedDB.
 * Only re-embeds items that aren't already cached.
 * @param {string} apiKey
 * @param {Array<{text: string, category: string}>} items
 */
export async function seedMemories(apiKey, items) {
    if (!apiKey || !items?.length) return;

    // Try loading persisted embeddings first
    const persisted = await loadPersistedEmbeddings();
    if (persisted.length > 0) {
        memoryStore = persisted;
        console.log(`[VectorMemory] Loaded ${persisted.length} cached embeddings from IndexedDB`);

        // Only embed items not already in cache
        const existingTexts = new Set(persisted.map(m => m.text));
        const newItems = items.filter(item => !existingTexts.has(item.text));
        if (newItems.length > 0) {
            console.log(`[VectorMemory] Embedding ${newItems.length} new items not in cache`);
            const BATCH = 5;
            for (let i = 0; i < newItems.length; i += BATCH) {
                const batch = newItems.slice(i, i + BATCH);
                await Promise.all(batch.map(item => addMemory(apiKey, item.text, item.category)));
            }
        }
        return;
    }

    // No cache — embed everything from scratch
    const BATCH = 5;
    for (let i = 0; i < items.length; i += BATCH) {
        const batch = items.slice(i, i + BATCH);
        await Promise.all(batch.map(item => addMemory(apiKey, item.text, item.category)));
    }
    console.log(`[VectorMemory] Seeded ${memoryStore.length} memories (fresh embeddings)`);
}

/**
 * Retrieve the top-N most relevant memories for a given query.
 * @param {string} apiKey
 * @param {string} query - Current scene context / player action
 * @param {number} [topN=8] - How many memories to retrieve
 * @param {number} [minScore=0.55] - Minimum similarity threshold
 * @returns {Promise<Array<{text: string, category: string, score: number}>>}
 */
export async function retrieveRelevant(apiKey, query, topN = 8, minScore = 0.55) {
    if (!apiKey || !query || memoryStore.length === 0) return [];

    const queryVector = await embedText(apiKey, query);
    if (!queryVector) return [];

    const scored = memoryStore
        .map(m => ({ ...m, score: cosineSimilarity(queryVector, m.vector) }))
        .filter(m => m.score >= minScore)
        .sort((a, b) => b.score - a.score)
        .slice(0, topN);

    return scored.map(m => ({ text: m.text, category: m.category, score: m.score }));
}

/**
 * Clear the in-memory store and persisted IndexedDB cache (called on new game).
 */
export function clearMemories() {
    memoryStore = [];
    clearPersistedEmbeddings();
}

/**
 * Return current memory count (for debugging/UI).
 */
export function getMemoryCount() {
    return memoryStore.length;
}

/**
 * Build a "retrieved memories" block for injection into the system prompt.
 * @param {Array<{text: string, category: string}>} memories
 * @returns {string}
 */
export function buildRetrievedMemoriesBlock(memories) {
    if (!memories || memories.length === 0) return '';
    const lines = memories.map(m => `- [${m.category}] ${m.text}`).join('\n');
    return `## RETRIEVED MEMORIES (most relevant to current scene)\nThese past events are relevant right now — factor them into your narration. They may include world facts, NPC details, or events from earlier in the adventure that aren't shown elsewhere in this prompt:\n${lines}`;
}
