/**
 * Vector Memory — RAG (Retrieval-Augmented Generation) for long-term RPG memory.
 *
 * How it works:
 * 1. Significant events (world facts, journal summaries, NPC interactions) are
 *    embedded as 768-dim retrieval documents using Gemini's gemini-embedding-2.
 * 2. Embeddings are persisted in IndexedDB so they survive page refreshes.
 * 3. Before each DM prompt, the current scene context is embedded as a search query
 *    and we retrieve the top-N most semantically relevant past memories.
 * 4. Retrieved memories are injected into the system prompt so the DM "remembers"
 *    relevant past events even from very early in the session.
 *
 * All similarity search is done client-side (cosine similarity) — no backend needed.
 */

import {
    embedText,
    GEMINI_EMBED_DIMENSIONS,
    GEMINI_EMBED_SCHEMA,
} from '../llm/providers/gemini.js';

// --- IndexedDB persistence for embeddings ---
const EMBED_DB_NAME = 'rpg-vector-memory';
// v3: gemini-embedding-2 plus Google's asymmetric search/document formatting.
// Vectors from a different model or input format cannot be compared meaningfully.
const EMBED_DB_VERSION = 3;
const EMBED_STORE = 'embeddings';

function openEmbedDB() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(EMBED_DB_NAME, EMBED_DB_VERSION);
        request.onerror = () => reject(request.error);
        request.onsuccess = () => resolve(request.result);
        request.onupgradeneeded = (event) => {
            const db = event.target.result;
            if (db.objectStoreNames.contains(EMBED_STORE)) {
                db.deleteObjectStore(EMBED_STORE);
            }
            db.createObjectStore(EMBED_STORE, { keyPath: 'text' });
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
            request.onsuccess = () => {
                const entries = request.result || [];
                const compatible = entries.filter(entry => (
                    entry.schema === GEMINI_EMBED_SCHEMA
                    && Array.isArray(entry.vector)
                    && entry.vector.length === GEMINI_EMBED_DIMENSIONS
                ));
                if (compatible.length !== entries.length) {
                    console.warn(`[VectorMemory] Ignored ${entries.length - compatible.length} incompatible cached embeddings.`);
                }
                resolve(compatible);
            };
            request.onerror = () => reject(request.error);
            tx.oncomplete = () => db.close();
        });
    } catch {
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
export async function addMemory(apiKey, text, category = 'general', location = null) {
    if (!apiKey || !text?.trim()) return;

    // Deduplicate by exact text
    if (memoryStore.some(m => m.text === text)) return;

    const vector = await embedText(apiKey, text, { inputType: 'document' });
    if (!vector) {
        console.error('[VectorMemory] Embedding failed for:', text.slice(0, 80));
        return;
    }

    const entry = {
        text,
        vector,
        category,
        // Where the hero was when this memory was recorded — lets retrieval label
        // memories from elsewhere so the DM doesn't transplant local color across
        // the map. Optional; older cached embeddings simply have no tag.
        ...(typeof location === 'string' && location.trim() && { location: location.trim().slice(0, 80) }),
        schema: GEMINI_EMBED_SCHEMA,
        timestamp: Date.now(),
    };
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
                await Promise.all(batch.map(item => addMemory(apiKey, item.text, item.category, item.location)));
            }
        }
        return;
    }

    // No cache — embed everything from scratch
    const BATCH = 5;
    for (let i = 0; i < items.length; i += BATCH) {
        const batch = items.slice(i, i + BATCH);
        await Promise.all(batch.map(item => addMemory(apiKey, item.text, item.category, item.location)));
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

    const queryVector = await embedText(apiKey, query, { inputType: 'query' });
    if (!queryVector) return [];

    const categoryBoost = {
        npc_character: 0.08,
        story_relationship: 0.07,
        story_npcAgenda: 0.07,
        story_callback: 0.05,
        story_promise: 0.05,
        story_playerCanon: 0.04,
        world_fact: 0.03,
        journal: 0.02,
        narrative: -0.04,
        npc: 0.02,
    };

    const scored = memoryStore
        .map(m => ({
            ...m,
            score: cosineSimilarity(queryVector, m.vector) + (categoryBoost[m.category] || 0),
        }))
        .filter(m => m.score >= minScore)
        .sort((a, b) => b.score - a.score)
        .slice(0, topN);

    return scored.map(m => ({ text: m.text, category: m.category, score: m.score, ...(m.location && { location: m.location }) }));
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
    const lines = memories.map(m => {
        const label = m.category === 'player'
            ? 'player statement/attempt — not automatically canon'
            : m.category;
        const locationTag = m.location ? ` — recorded at: ${m.location}` : '';
        return `- [${label}${locationTag}] ${m.text}`;
    }).join('\n');
    return `## RETRIEVED MEMORIES (most relevant to current scene)\nUse canonical world facts and DM-established memories normally. An entry labeled "player statement/attempt" records something the player said, wanted, or tried; it is not proof that an external claim became true unless the established fiction corroborates it.\nThese are memories, not the current scene. An entry recorded at a DIFFERENT place than where the hero now stands is context from elsewhere — never transplant its creatures, factions, or local color into the present location unless the fiction has actually moved them here. Distant places stay distinct: give each region its own dangers.\n${lines}`;
}
