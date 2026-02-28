/**
 * Vector Memory — RAG (Retrieval-Augmented Generation) for long-term RPG memory.
 *
 * How it works:
 * 1. Significant events (world facts, journal summaries, NPC interactions) are
 *    embedded as 768-dim vectors using Gemini's text-embedding-004 model.
 * 2. Embeddings are stored in memory (not persisted — they're cheap to regenerate).
 * 3. Before each DM prompt, the current scene context is embedded and we retrieve
 *    the top-N most semantically relevant past memories.
 * 4. Retrieved memories are injected into the system prompt so the DM "remembers"
 *    relevant past events even from very early in the session.
 *
 * All similarity search is done client-side (cosine similarity) — no backend needed.
 */

import { embedText } from '../llm/providers/gemini.js';

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
 * Add a memory entry and embed it.
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
    if (!vector) return; // Silently skip if embedding failed

    memoryStore.push({ text, vector, category, timestamp: Date.now() });
}

/**
 * Bulk-add memories. Used to seed the store from existing world facts and journal entries.
 * @param {string} apiKey
 * @param {Array<{text: string, category: string}>} items
 */
export async function seedMemories(apiKey, items) {
    if (!apiKey || !items?.length) return;

    // Embed in parallel (batches of 5 to avoid rate limits)
    const BATCH = 5;
    for (let i = 0; i < items.length; i += BATCH) {
        const batch = items.slice(i, i + BATCH);
        await Promise.all(batch.map(item => addMemory(apiKey, item.text, item.category)));
    }
    console.log(`[VectorMemory] Seeded ${memoryStore.length} memories`);
}

/**
 * Retrieve the top-N most relevant memories for a given query.
 * @param {string} apiKey
 * @param {string} query - Current scene context / player action
 * @param {number} [topN=5] - How many memories to retrieve
 * @param {number} [minScore=0.6] - Minimum similarity threshold
 * @returns {Promise<Array<{text: string, category: string, score: number}>>}
 */
export async function retrieveRelevant(apiKey, query, topN = 5, minScore = 0.6) {
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
 * Clear the in-memory store (called on new game).
 */
export function clearMemories() {
    memoryStore = [];
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
    return `## RETRIEVED MEMORIES (most relevant to current scene)\nThese past events are relevant right now — factor them into your narration:\n${lines}`;
}
