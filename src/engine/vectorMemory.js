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
// v4 (2026-07-30 review P0-4): rows are campaign-keyed ([sessionId, text]).
// Under the old text-only key the ONLY safe campaign switch was a full wipe —
// ChatPanel cleared the store on every mount, which made the cache-hit branch
// production-unreachable and re-embedded the whole campaign on every reload
// (hundreds of API calls on a mature save). Now each campaign owns its rows,
// seeding loads only the active campaign, and no mount-time wipe is needed.
const EMBED_DB_VERSION = 4;
const EMBED_STORE = 'embeddings';

function openEmbedDB() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(EMBED_DB_NAME, EMBED_DB_VERSION);
        request.onerror = () => reject(request.error);
        request.onsuccess = () => resolve(request.result);
        // A version bump while another tab holds a connection would otherwise hang
        // every embed/persist/load call silently (same gap fixed in persistence.js).
        request.onblocked = () => reject(new Error('Embedding cache blocked by another open tab'));
        request.onupgradeneeded = (event) => {
            const db = event.target.result;
            if (db.objectStoreNames.contains(EMBED_STORE)) {
                db.deleteObjectStore(EMBED_STORE);
            }
            db.createObjectStore(EMBED_STORE, { keyPath: ['sessionId', 'text'] });
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
    // Resolves only after the IndexedDB clear COMMITS, so a caller can order a
    // subsequent load/seed behind it. Never rejects — the cache is non-critical.
    return openEmbedDB().then(db => new Promise(resolve => {
        const tx = db.transaction(EMBED_STORE, 'readwrite');
        tx.objectStore(EMBED_STORE).clear();
        tx.oncomplete = () => { db.close(); resolve(); };
        tx.onabort = () => { db.close(); resolve(); };
    })).catch(() => {});
}

async function loadPersistedEmbeddings(sessionId) {
    try {
        const db = await openEmbedDB();
        // `return await`, not bare `return`: a bare returned promise's rejection
        // (request.onerror) skips this try/catch and rejects the caller's seed
        // instead of degrading to [] (found by the 2026-07-28 audit tests).
        return await new Promise((resolve, reject) => {
            const tx = db.transaction(EMBED_STORE, 'readonly');
            const request = tx.objectStore(EMBED_STORE).getAll();
            request.onsuccess = () => {
                const entries = request.result || [];
                const compatible = entries.filter(entry => (
                    // Only the active campaign's rows — another campaign's memories
                    // must never leak into this session's retrieval.
                    entry.sessionId === sessionId
                    && entry.schema === GEMINI_EMBED_SCHEMA
                    && Array.isArray(entry.vector)
                    && entry.vector.length === GEMINI_EMBED_DIMENSIONS
                    // A corrupted/tampered row with NaN/non-number elements would
                    // yield NaN cosine scores and pollute the store.
                    && entry.vector.every(Number.isFinite)
                ));
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

/** In-memory store for the ACTIVE campaign: { sessionId, text, vector, category, timestamp }[] */
let memoryStore = [];
/** Campaign whose memories are currently loaded; stamped onto every new entry. */
let activeSessionId = null;

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
    // `?.` guards null/undefined but not type — an object-valued world fact from
    // the parser would throw on .trim() inside this async fn (2026-07-28 audit).
    if (!apiKey || typeof text !== 'string' || !text.trim()) return;

    // Deduplicate by exact text
    if (memoryStore.some(m => m.text === text)) return;

    const vector = await embedText(apiKey, text, { inputType: 'document' });
    if (!vector) {
        console.error('[VectorMemory] Embedding failed for:', text.slice(0, 80));
        return;
    }

    const entry = {
        // Campaign key — rows are persisted per campaign so a switch loads its own
        // cache instead of wiping everything. An entry added before any seed set a
        // session stays in-memory only (the composite key rejects a null part).
        sessionId: activeSessionId,
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
    if (activeSessionId != null) persistEmbedding(entry); // fire-and-forget to IndexedDB
}

/**
 * Bulk-seed the active campaign's memories. Loads that campaign's cached
 * embeddings from IndexedDB and re-embeds only the items not already cached.
 * Always REPLACES the in-memory store wholesale — switching campaigns is just
 * seeding the new one; no wipe of other campaigns' rows is needed or performed.
 * @param {string} apiKey
 * @param {Array<{text: string, category: string}>} items
 * @param {string|null} sessionId - the campaign these memories belong to
 */
export async function seedMemories(apiKey, items, sessionId = null) {
    if (!apiKey) return;
    activeSessionId = sessionId;
    memoryStore = [];
    if (!items?.length && sessionId == null) return;

    // This campaign's cached embeddings first
    const persisted = sessionId != null ? await loadPersistedEmbeddings(sessionId) : [];
    if (persisted.length > 0) {
        memoryStore = persisted;
        console.log(`[VectorMemory] Loaded ${persisted.length} cached embeddings for this campaign`);
    }

    // Embed only items not already cached
    const existingTexts = new Set(persisted.map(m => m.text));
    const newItems = (items || []).filter(item => !existingTexts.has(item.text));
    if (newItems.length > 0) {
        if (persisted.length > 0) console.log(`[VectorMemory] Embedding ${newItems.length} new items not in cache`);
        const BATCH = 5;
        for (let i = 0; i < newItems.length; i += BATCH) {
            const batch = newItems.slice(i, i + BATCH);
            await Promise.all(batch.map(item => addMemory(apiKey, item.text, item.category, item.location)));
        }
    }
    if (persisted.length === 0) {
        console.log(`[VectorMemory] Seeded ${memoryStore.length} memories (fresh embeddings)`);
    }
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
 * Clear the in-memory store and the ENTIRE persisted cache (all campaigns).
 * Since rows became campaign-keyed this is a maintenance/reset tool, not part
 * of the campaign-switch path — seeding a campaign replaces the in-memory
 * store and reads only that campaign's rows.
 */
export function clearMemories() {
    memoryStore = [];
    activeSessionId = null;
    // Awaitable: resolves once the persisted clear actually commits.
    return clearPersistedEmbeddings();
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
