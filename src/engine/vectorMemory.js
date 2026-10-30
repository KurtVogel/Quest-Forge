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
    embedTexts,
    GEMINI_EMBED_DIMENSIONS,
    GEMINI_EMBED_SCHEMA,
} from '../llm/providers/gemini.js';
import { findSubjectsInText, nameTokensPresent, textWordSet } from './textMatch.js';
import { formatSecrecyTag } from './storyMemory.js';

// The presence tokenizer lives on the tokenizer shelf (textMatch.js, 2026-10-11);
// re-exported so the RAG module's tagging helper keeps its historical name here.
export { findSubjectsInText };

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
        request.onsuccess = () => {
            const db = request.result;
            // A later version bump from another tab must not be blocked by this
            // connection forever (persistence.js's withDb does the same).
            db.onversionchange = () => db.close();
            resolve(db);
        };
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

/**
 * The exact key range of ONE campaign's rows. In IndexedDB key order arrays
 * sort after every string, so [sessionId, []] is an upper bound past any
 * text. Shared by the campaign READ and the campaign delete (2026-09-29
 * vector-memory P1: the read used to `getAll()` the whole store and filter
 * by sessionId in JS, so every Continue structured-cloned every OTHER
 * campaign's vectors on the device — ~46 MB for five mature campaigns — to
 * keep the one it wanted).
 */
function campaignKeyRange(sessionId) {
    return IDBKeyRange.bound([sessionId, ''], [sessionId, []]);
}

/**
 * THE embed-store transaction (2026-10-11 audit P2 — four hand-rolled
 * open / close / settle patterns, one of which closed only on `tx.onerror`):
 * opens the database, runs `run(store, done)` inside one transaction of
 * `mode`, resolves with whatever `run` handed to `done` once the transaction
 * COMMITS, rejects when it aborts or errors, and closes the connection on
 * every path — a failed put (quota) used to leave the handle open forever,
 * blocking every later version upgrade (2026-09-06 audit). Callers decide
 * what a failure means (the cache is non-critical: every writer swallows,
 * the reader degrades to []).
 */
function withEmbedDb(mode, run) {
    return openEmbedDB().then(db => new Promise((resolve, reject) => {
        let value;
        let failure = null;
        const tx = db.transaction(EMBED_STORE, mode);
        tx.oncomplete = () => { db.close(); resolve(value); };
        tx.onabort = () => { db.close(); reject(failure || tx.error || new Error('Embedding cache transaction aborted')); };
        tx.onerror = () => { failure = tx.error; };
        try {
            run(tx.objectStore(EMBED_STORE), (result) => { value = result; });
        } catch (e) {
            failure = e;
            try { tx.abort(); } catch { /* already aborting */ }
        }
    }));
}

/**
 * ONE readwrite transaction for a batch of puts and deletes (2026-09-29
 * vector-memory P2): the seed used to open a connection and a transaction
 * per persisted row — 1,501 `indexedDB.open` calls at the cap on a cold
 * device, 41 on a warm mount with 40 retags. Unkeyed rows (added before any
 * seed set a session) are skipped: the composite key rejects a null part.
 * Never rejects — the cache is non-critical, in-memory still works. Resolves
 * once the transaction settles, so a caller can order work behind it.
 */
function syncPersistedEmbeddings({ put = [], remove = [] } = {}) {
    const puts = put.filter(e => e && e.sessionId != null);
    const removes = remove.filter(e => e && e.sessionId != null);
    if (puts.length === 0 && removes.length === 0) return Promise.resolve();
    return withEmbedDb('readwrite', (store) => {
        for (const e of removes) store.delete([e.sessionId, e.text]);
        for (const e of puts) store.put(e);
    }).catch(() => {});
}

/** Fire-and-forget removal of specific persisted rows (eviction / stale-prune). */
function deletePersistedEmbeddings(entries) {
    syncPersistedEmbeddings({ remove: entries || [] });
}

/**
 * Vectors are STORED as Float32Array (2026-09-29 vector-memory P2): a
 * 768-double `number[]` structured-clones at 6,144 bytes per row — 8.8 MB
 * per campaign at the cap, in memory, on disk, and through every campaign
 * read — and float32 halves all three at no retrieval cost at the 0.55 /
 * 0.9 thresholds. Same vectors, narrower storage: the schema tag is
 * untouched, a legacy `number[]` row loads as-is and narrows on read (it is
 * rewritten only when a retag persists it), and cosineSimilarity indexes
 * either shape.
 */
function toStoredVector(vector) {
    return vector instanceof Float32Array ? vector : Float32Array.from(vector);
}

function isVectorShape(value) {
    return Array.isArray(value) || value instanceof Float32Array;
}

function clearPersistedEmbeddings() {
    // Resolves only after the IndexedDB clear COMMITS, so a caller can order a
    // subsequent load/seed behind it. Never rejects — the cache is non-critical.
    return withEmbedDb('readwrite', (store) => { store.clear(); }).catch(() => {});
}

async function loadPersistedEmbeddings(sessionId) {
    try {
        // The campaign's OWN key range — the read scales with this campaign,
        // not with every campaign on the device (2026-09-29 P1). `return
        // await`, not bare `return`: a rejection must land in THIS try so
        // the seed degrades to [] (found by the 2026-07-28 audit tests).
        return await withEmbedDb('readonly', (store, done) => {
            const request = store.getAll(campaignKeyRange(sessionId));
            request.onsuccess = () => {
                const entries = Array.isArray(request.result) ? request.result : [];
                done(entries.filter(entry => (
                    entry && typeof entry === 'object'
                    // Only the active campaign's rows — another campaign's memories
                    // must never leak into this session's retrieval (the range
                    // guarantees it; this is the belt).
                    && entry.sessionId === sessionId
                    && entry.schema === GEMINI_EMBED_SCHEMA
                    // The row's TEXT is its key and its prompt line — a
                    // non-string one would read "[object Object]" (2026-09-17 belt).
                    && typeof entry.text === 'string' && entry.text.trim()
                    && isVectorShape(entry.vector)
                    && entry.vector.length === GEMINI_EMBED_DIMENSIONS
                    // A corrupted/tampered row with NaN/non-number elements would
                    // yield NaN cosine scores and pollute the store.
                    && entry.vector.every(Number.isFinite)
                )).map(typeCachedRow));
            };
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
/**
 * Seed GENERATION (2026-10-23 vector-memory P2): bumped the moment a seed
 * replaces the store. An async writer captures it before its embed await and
 * storeMemoryEntry refuses a row from a stale generation — a batch of campaign
 * A that was on the wire when campaign B seeded used to land UNDER B (stamped
 * with the new activeSessionId, written to B's disk key, retrievable in B's
 * scenes for the rest of the session). A superseded seed itself bails out at
 * each of its awaits for the same reason.
 */
let seedGeneration = 0;

/**
 * Per-session QUERY-vector memo (2026-09-22 roll-resolution P2). The post-roll
 * outcome hop and the challenge hop pass the proposal's own playerAction, so
 * the orchestrator builds a byte-identical sceneContext and retrieveRelevant
 * paid one blocking Gemini round trip per check turn (two on a challenged one)
 * for the vector the previous hop already held. Keyed by the exact query text;
 * the presence gate and scoring still run per call, only the network hop is
 * skipped. A Map iterates in insertion order, so the cap evicts oldest-first.
 * Cleared with the store (clearMemories); vectors are model-tagged, not
 * campaign-tagged, so a campaign switch does not invalidate them.
 */
export const QUERY_VECTOR_MEMO_CAP = 16;
const queryVectorMemo = new Map();

function rememberQueryVector(query, vector) {
    if (queryVectorMemo.has(query)) return;
    if (queryVectorMemo.size >= QUERY_VECTOR_MEMO_CAP) {
        queryVectorMemo.delete(queryVectorMemo.keys().next().value);
    }
    queryVectorMemo.set(query, vector);
}

// --- Lifecycle (2026-08-06 P1: the cache previously grew without bound) ---

/**
 * Hard per-campaign row ceiling. Growth is ~2 rows per turn (player + narrative),
 * so 1500 covers several hundred turns of transient color on top of the durable
 * corpus (facts, journal, NPCs, story cards) before anything is evicted.
 */
export const MAX_CAMPAIGN_MEMORIES = 1500;

/**
 * Per-turn color evicts before durable canon: a 300-turn-old "player" or
 * "narrative" row is scene flavor long since journaled/summarized elsewhere,
 * while world facts, journal entries, NPC records, and story cards remain the
 * campaign's actual memory.
 */
const EVICT_FIRST_CATEGORIES = new Set(['player', 'narrative']);

/**
 * A load is a branch (memory-research M0, 2026-10-21). The seed is built from
 * the LOADED state, and every row the record composes (facts under their
 * DM-given category, journal entries, NPC notes, story cards) is in it — the
 * seed carries the whole record since 2026-08-22 (journal) and 2026-10-11 (one
 * fact composer). So a cached row of a RECORD category whose text the seed no
 * longer carries is either a stale predecessor wording (the 2026-08-06 prune)
 * or a row minted in a future the player abandoned by loading an older slot:
 * both prune. The one category the seed never carries is the TRANSIENT pair
 * (`narrative` / `player`, `EVICT_FIRST_CATEGORIES`): a transient row is judged
 * by its source stamp against the loaded transcript — an id the transcript
 * does not hold was written after this slot's last message. A stamp-less
 * legacy row and a legacy `general` row are kept (nothing can judge them).
 * `world_fact` used to be kept whenever absent from the seed (the "immutable
 * history" keep): loading an older slot of the same campaign retrieved the
 * facts and narration of turns that slot never played.
 */
const isTransientCategory = (category) => EVICT_FIRST_CATEGORIES.has(category) || category === 'general';

/** Campaigns whose durable corpus alone overflowed the cap — warned once each. */
const durableOverflowWarned = new Set();

/**
 * Enforce the campaign cap on the in-memory store, mirroring evictions to disk.
 * ONLY transient rows (per-turn player/narrative color) are evicted — durable
 * canon (facts, journal, NPCs, story cards) is never touched. Evicting durable
 * rows was churn, not a cap (2026-09-06 audit): the mount seed re-embeds
 * whatever the cache is missing with a fresh timestamp, so every Continue
 * evicted a DIFFERENT oldest slice, paid the overflow in embeds again, and
 * silently rotated a window of canon out of retrieval. A durable corpus past
 * the cap is logged once per campaign and kept whole.
 */
function enforceCampaignCap() {
    const overflow = memoryStore.length - MAX_CAMPAIGN_MEMORIES;
    if (overflow <= 0) return;
    const transient = memoryStore
        .filter(m => EVICT_FIRST_CATEGORIES.has(m.category))
        .sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));
    const toEvict = new Set(transient.slice(0, overflow));
    if (toEvict.size > 0) {
        memoryStore = memoryStore.filter(m => !toEvict.has(m));
        deletePersistedEmbeddings([...toEvict]);
    }
    const durableOverflow = overflow - toEvict.size;
    if (durableOverflow > 0 && !durableOverflowWarned.has(activeSessionId)) {
        durableOverflowWarned.add(activeSessionId);
        console.warn(`[VectorMemory] Durable memory corpus exceeds the ${MAX_CAMPAIGN_MEMORIES}-row cap by ${durableOverflow}; canon is never evicted, so the store is kept whole.`);
    }
}

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

/** Same people, same order — the seed-vs-cache tag comparison. */
function sameSubjects(a, b) {
    const listA = normalizeSubjects(a) || [];
    const listB = normalizeSubjects(b) || [];
    return listA.length === listB.length && listA.every((name, i) => name === listB[i]);
}

const MEMORY_LABEL_MAX = 80;

/** A stored label (category / location) read string-or-fallback, clamped. */
function cleanLabel(value, fallback = '') {
    const text = typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, MEMORY_LABEL_MAX) : '';
    return text || fallback;
}

/**
 * Type the optional fields of a cached row the way storeMemoryEntry writes
 * them (2026-09-17 vector-memory P2 belt): `category` string-or-'general',
 * `location` string-or-absent, `subjects` through normalizeSubjects — an
 * app-written row, so junk is unlikely, but the prompt block and the presence
 * gate read these fields raw.
 */
function typeCachedRow(entry) {
    const location = cleanLabel(entry.location);
    const subjects = normalizeSubjects(entry.subjects);
    const { location: _location, subjects: _subjects, sourceMessage: _source, atMessage: _at, ...rest } = entry;
    const atMessage = memoryStamp(entry.atMessage);
    return {
        ...rest,
        vector: toStoredVector(entry.vector),
        category: cleanLabel(entry.category, 'general'),
        ...(location && { location }),
        ...(subjects && { subjects }),
        ...(typeof entry.sourceMessage === 'string' && entry.sourceMessage && { sourceMessage: entry.sourceMessage.slice(0, 80) }),
        ...(atMessage !== null && { atMessage }),
    };
}

/**
 * A row's "message count when it was recorded" stamp (memory-research M1,
 * 2026-10-21): a finite, floored, non-negative integer, else null. The seed
 * reads it from the record (a fact's `atMessage`, a journal entry's span end,
 * a card's `firstSeenMessage`, an NPC's `lastSeenMessage`), the live lanes
 * stamp the count at the write, and the prompt block turns it into
 * "N turns ago". Never part of the row's text (its identity).
 */
function memoryStamp(value) {
    return Number.isFinite(value) ? Math.max(0, Math.floor(value)) : null;
}

/**
 * Source-stamped retraction (memory-research M0, 2026-09-30): drop every row
 * this campaign read from one DM message — the narrative row stamped with
 * its id, and the `world_fact` rows whose text the reducer's retraction
 * named (`texts`, in the seed's own format) — from the store and from disk.
 * The player removed the message (✕, a refusal); its canon leaves with it.
 * Never rejects; the cache is derivable.
 *
 * Retraction follows the last witness (memory-research M0, 2026-10-28): a
 * fact the record KEPT because a later message restated it is named in
 * `keep` (`{ text, sourceMessage }` — the text in the seed's format, the
 * new source the reducer moved it to); its row stays, retagged to that
 * source in memory and on disk, whatever the row's old `sourceMessage` said.
 * Returns the count of rows removed.
 */
export function retractMemoriesFromMessage(messageId, texts = [], { keep = [] } = {}) {
    if (typeof messageId !== 'string' || !messageId) return Promise.resolve(0);
    const named = new Set((Array.isArray(texts) ? texts : []).filter(t => typeof t === 'string' && t));
    const keptSource = new Map();
    for (const entry of (Array.isArray(keep) ? keep : [])) {
        if (entry && typeof entry.text === 'string' && entry.text) {
            keptSource.set(entry.text, typeof entry.sourceMessage === 'string' && entry.sourceMessage ? entry.sourceMessage.slice(0, 80) : null);
        }
    }
    const gone = memoryStore.filter(row => !keptSource.has(row.text)
        && (row.sourceMessage === messageId || (named.size > 0 && named.has(row.text))));
    const retagged = [];
    if (keptSource.size > 0) {
        memoryStore = memoryStore.map(row => {
            if (!keptSource.has(row.text) || row.sourceMessage !== messageId) return row;
            const source = keptSource.get(row.text);
            const { sourceMessage: _old, ...rest } = row;
            const next = source ? { ...rest, sourceMessage: source } : rest;
            retagged.push(next);
            return next;
        });
    }
    if (gone.length === 0 && retagged.length === 0) return Promise.resolve(0);
    const goneSet = new Set(gone);
    memoryStore = memoryStore.filter(row => !goneSet.has(row));
    queryVectorMemo.clear();
    const persisted = gone.filter(row => row.sessionId != null);
    const put = retagged.filter(row => row.sessionId != null);
    if (persisted.length === 0 && put.length === 0) return Promise.resolve(gone.length);
    return syncPersistedEmbeddings({ remove: persisted, put }).then(() => gone.length, () => gone.length);
}

/** Clamp an untrusted subjects list to a small array of clean name strings. */
function normalizeSubjects(subjects) {
    const list = (Array.isArray(subjects) ? subjects : [])
        // String-only (2026-09-17 belt): an object element used to tag the row
        // with the subject "[object Object]", which no scene could ever present.
        .map(name => (typeof name === 'string' ? name : '').replace(/\s+/g, ' ').trim().slice(0, 80))
        .filter(Boolean)
        .slice(0, 4);
    return list.length > 0 ? list : null;
}

/**
 * Add ONE memory: a batch of one (2026-10-11 audit P2 — this was a second
 * document-embed path with its own guard, dedupe, embed call and persist).
 * The player line is its only live caller; it lands before the reply exists,
 * so it cannot ride the turn's batch. Silently skips if embedding fails.
 * @param {string} apiKey - Gemini API key
 * @param {string} text - The memory text
 * @param {string} [category] - e.g. 'world_fact', 'journal', 'npc', 'event'
 * @param {string|null} [location]
 * @param {string[]|null} [subjects] - people this memory is ABOUT (presence-aware retrieval)
 * @param {string|null} [sourceMessage] - the DM message this row was read from (retraction)
 */
export function addMemory(apiKey, text, category = 'general', location = null, subjects = null, sourceMessage = null) {
    return addMemories(apiKey, [{ text, category, location, subjects, sourceMessage }]);
}

/**
 * Add MANY memories through one embed round trip and one persist transaction
 * (2026-09-29 vector-memory P2: the ordinary turn's fan-out was one
 * `embedContent` request per world fact plus one for the narrative — six
 * embed calls on a turn with three facts, all against the per-minute quota
 * the NEXT turn's blocking query embed needs). The pre-embed filter skips
 * texts the store already holds (never pay for a known row) and dedupes
 * within the batch; storeMemoryEntry's own exact-text check is the one
 * AUTHORITATIVE dedupe (a row may land between the filter and the store).
 * A failed vector skips its item.
 * @param {string} apiKey
 * @param {Array<{text: string, category?: string, location?: string|null, subjects?: string[]|null}>} items
 */
export async function addMemories(apiKey, items) {
    if (!apiKey) return;
    const seen = new Set();
    const fresh = [];
    for (const item of (Array.isArray(items) ? items : [])) {
        const text = item?.text;
        if (typeof text !== 'string' || !text.trim() || seen.has(text)) continue;
        if (memoryStore.some(m => m.text === text)) continue;
        seen.add(text);
        fresh.push(item);
    }
    if (fresh.length === 0) return;
    // The generation this batch belongs to (2026-10-23 P2): a seed that lands
    // while the embed is on the wire makes these rows another campaign's.
    const generation = seedGeneration;
    const vectors = await embedTexts(apiKey, fresh.map(item => item.text), { inputType: 'document' });
    if (generation !== seedGeneration) {
        console.log(`[VectorMemory] Dropped ${fresh.length} rows embedded for a campaign that is no longer loaded`);
        return;
    }
    const stored = [];
    fresh.forEach((item, i) => {
        if (!vectors?.[i]) {
            console.error('[VectorMemory] Embedding failed for:', item.text.slice(0, 80));
            return;
        }
        const entry = storeMemoryEntry({
            text: item.text, vector: vectors[i], category: item.category || 'general',
            location: item.location, subjects: item.subjects, sourceMessage: item.sourceMessage, atMessage: item.atMessage,
            generation,
        });
        if (entry) stored.push(entry);
    });
    syncPersistedEmbeddings({ put: stored });
    enforceCampaignCap();
}

/**
 * The turn's memory batch (2026-09-29 vector-memory P2). A turn's world
 * facts land in sendToLLM and its narrative in the post-turn extraction, a
 * few awaits apart; queueing lets them ride ONE embed request. The caller
 * that knows the turn is complete calls flushMemoryQueue; a queue nobody
 * flushes (a fight-starting response, the opening scene) flushes itself
 * after this window, so no memory is ever held back. The player line still
 * embeds alone through addMemory — it lands before the reply exists.
 */
export const MEMORY_BATCH_WINDOW_MS = 1500;
let pendingBatch = null; // { apiKey, items, timer, promise, resolve }

/**
 * Queue one memory for the next batch. Resolves when that batch has been
 * embedded and stored (or skipped).
 * @param {string} apiKey
 * @param {string} text
 * @param {string} [category]
 * @param {string|null} [location]
 * @param {string[]|null} [subjects]
 */
export function queueMemory(apiKey, text, category = 'general', location = null, subjects = null, sourceMessage = null, options = {}) {
    return queueMemoryItem(apiKey, { text, category, location, subjects, sourceMessage }, options);
}

/** Queue one composed row (the composers below) for the next batch — THE queue entry. */
export function queueMemoryItem(apiKey, item, { carry = false } = {}) {
    if (!item || typeof item !== 'object') return Promise.resolve();
    const { text } = item;
    if (!apiKey || typeof text !== 'string' || !text.trim()) return Promise.resolve();
    // A batch is one key: a different key (a Settings change mid-turn)
    // flushes what was queued under the old one first.
    if (pendingBatch && pendingBatch.apiKey !== apiKey) flushMemoryQueue();
    if (!pendingBatch) {
        let resolve;
        const promise = new Promise(r => { resolve = r; });
        pendingBatch = { apiKey, items: [], timer: null, promise, resolve };
    }
    // A CARRIED row (2026-10-11 — the Scribe's facts land seconds after the
    // turn's batch flushed) waits for the next flush instead of arming the
    // window: it rides the next turn's request, never one of its own (the
    // journal entry's pattern; the mount seed covers a reload before then).
    // Any ordinary row arriving later arms the window for the whole batch.
    if (!carry && pendingBatch.timer === null) {
        pendingBatch.timer = setTimeout(() => { flushMemoryQueue(); }, MEMORY_BATCH_WINDOW_MS);
    }
    pendingBatch.items.push({
        text,
        category: item.category || 'general',
        location: item.location ?? null,
        subjects: item.subjects ?? null,
        sourceMessage: item.sourceMessage ?? null,
        atMessage: memoryStamp(item.atMessage),
    });
    return pendingBatch.promise;
}

/** Embed and store everything queued so far, now. Resolves when done. */
export function flushMemoryQueue() {
    const batch = pendingBatch;
    if (!batch) return Promise.resolve();
    pendingBatch = null;
    if (batch.timer !== null) clearTimeout(batch.timer);
    const run = addMemories(batch.apiKey, batch.items).catch(() => {});
    run.then(batch.resolve, batch.resolve);
    return run;
}

/** Drop a queued batch without embedding it (campaign reset). */
function discardMemoryQueue() {
    const batch = pendingBatch;
    if (!batch) return;
    pendingBatch = null;
    if (batch.timer !== null) clearTimeout(batch.timer);
    batch.resolve();
}

/**
 * Store one already-embedded entry in memory (dedupe; NO persist — the caller
 * persists, alone or in a batch). Returns the stored entry, or null when the
 * text was already in the store. Shared by addMemory, addMemories, and the seed.
 */
function storeMemoryEntry({ text, vector, category = 'general', location = null, subjects = null, sourceMessage = null, atMessage = null, generation = seedGeneration }) {
    // A row from a stale generation (2026-10-23 P2) belongs to a campaign the
    // store no longer holds: refused, never stamped with the live session.
    if (generation !== seedGeneration) return null;
    if (memoryStore.some(m => m.text === text)) return null;
    const cleanSubjects = normalizeSubjects(subjects);
    const stamp = memoryStamp(atMessage);
    const place = cleanLocation(location);
    const entry = {
        // Campaign key — rows are persisted per campaign so a switch loads its own
        // cache instead of wiping everything. An entry added before any seed set a
        // session stays in-memory only (the composite key rejects a null part).
        sessionId: activeSessionId,
        text,
        vector: toStoredVector(vector),
        category,
        // Where the hero was when this memory was recorded — lets retrieval label
        // memories from elsewhere so the DM doesn't transplant local color across
        // the map. Optional; older cached embeddings simply have no tag.
        ...(place !== null && { location: place }),
        // Who this memory is ABOUT — presence-aware retrieval (2026-08-28)
        // down-weights person-tied memories in scenes that person is nowhere
        // near. Optional; untagged rows are never gated.
        ...(cleanSubjects && { subjects: cleanSubjects }),
        // The DM message this row was read from (retraction, 2026-09-30):
        // removing that message removes the row. Optional; legacy rows have none.
        ...(typeof sourceMessage === 'string' && sourceMessage.trim() && { sourceMessage: sourceMessage.trim().slice(0, 80) }),
        // The message count when this memory was recorded (2026-10-21): the
        // prompt block says "N turns ago" from it. Optional; legacy rows have
        // none and print no age.
        ...(stamp !== null && { atMessage: stamp }),
        schema: GEMINI_EMBED_SCHEMA,
        timestamp: Date.now(),
    };
    memoryStore.push(entry);
    return entry;
}

/** A row's place tag: a trimmed, clamped string, or null — the one shape the store and the retag compare. */
function cleanLocation(location) {
    return typeof location === 'string' && location.trim() ? location.trim().slice(0, 80) : null;
}

/**
 * The seed currently loading/embedding — `{ promise, sessionId }`, or null.
 * Awaited by retrieveRelevant; a second seed of the SAME campaign chains
 * behind it (2026-10-23 P2).
 */
let seedInFlight = null;

/**
 * Bulk-seed the active campaign's memories. Loads that campaign's cached
 * embeddings from IndexedDB and re-embeds only the items not already cached.
 * Always REPLACES the in-memory store wholesale — switching campaigns is just
 * seeding the new one; no wipe of other campaigns' rows is needed or performed.
 * @param {string} apiKey
 * @param {Array<{text: string, category: string}>} items
 * @param {string|null} sessionId - the campaign these memories belong to
 * @param {{ onIncomplete?: (report: { missing: number, reason: object|null }) => void }} [options] -
 *   `onIncomplete` (2026-09-29): called once when rows the seed meant to embed
 *   are still missing at the end (a rate limit, an outage, a rejected key)
 *   with the count and the provider's first failure reason — the session
 *   then runs against a partial store until the next mount, which the
 *   player should hear about (it used to be console-only).
 */
export function seedMemories(apiKey, items, sessionId = null, { onIncomplete = null, retiredTexts = null, transcriptIds = null, onBranchPruned = null } = {}) {
    const options = { onIncomplete, retiredTexts, transcriptIds, onBranchPruned };
    // Two overlapping seeds of ONE campaign (2026-10-23 P2 — a doubled mount
    // effect, a Continue tapped twice) used to embed the cold set TWICE: the
    // second read `existingTexts` before the first's rows had landed. The
    // second now runs AFTER the first settles and reads its rows from disk
    // (the seed awaits its own persist before resolving). A seed of a
    // DIFFERENT campaign starts at once; its generation bump makes the
    // superseded seed bail out at its next await.
    const previous = seedInFlight;
    const run = previous && sessionId != null && previous.sessionId === sessionId
        ? previous.promise.catch(() => {}).then(() => seedMemoriesInner(apiKey, items, sessionId, options))
        : seedMemoriesInner(apiKey, items, sessionId, options);
    // Retrieval awaits an in-flight seed (2026-09-06 audit): the first turn
    // after Continue on an uncached campaign used to query a partial store
    // while the cold seed was still embedding — silently, with the DM's first
    // narration of the session missing exactly the memories it needed most.
    const inFlight = { promise: run, sessionId };
    seedInFlight = inFlight;
    const settle = () => { if (seedInFlight === inFlight) seedInFlight = null; };
    run.then(settle, settle);
    return run;
}

async function seedMemoriesInner(apiKey, items, sessionId, { onIncomplete = null, retiredTexts = null, transcriptIds = null, onBranchPruned = null } = {}) {
    if (!apiKey) return;
    // This seed's generation (2026-10-23 P2): a later seed moves it, and this
    // one then stops at its next await — its late rows would otherwise be
    // stamped with the OTHER campaign's session and pushed into its store.
    const generation = ++seedGeneration;
    const superseded = () => seedGeneration !== generation;
    activeSessionId = sessionId;
    memoryStore = [];
    discardMemoryQueue(); // a batch queued under the previous campaign
    if (!items?.length && sessionId == null) return;

    // This campaign's cached embeddings first. A RECORD-category row (a fact,
    // a journal entry, an NPC note, a story card) is kept only while its exact
    // text is still in the current seed: anything else is a stale predecessor
    // wording OR a row from a future the player abandoned by loading an older
    // slot (see isTransientCategory), dropped here and from disk (replace,
    // not append). A TRANSIENT row (narrative / player — never in the seed) is
    // kept unless its source stamp names a message the loaded transcript does
    // not hold. Every disk write of the seed — the stale deletes, the retags,
    // the new rows — rides ONE transaction at the end (2026-09-29 P2).
    const persistedRaw = sessionId != null ? await loadPersistedEmbeddings(sessionId) : [];
    if (superseded()) return;
    const currentSeedTexts = new Set((items || []).map(item => item.text));
    // Retired texts (2026-09-29): the caller names the texts the record has
    // retired (a superseded or retracted fact); those rows prune whatever
    // their category. Since 2026-10-21 a special case of the record rule — a
    // retired fact is out of the seed anyway — kept as the belt.
    const retired = retiredTexts instanceof Set ? retiredTexts : new Set(Array.isArray(retiredTexts) ? retiredTexts : []);
    // The loaded transcript's message ids (2026-10-21, "a load is a branch"):
    // null means the caller could not say, and every stamped row is kept.
    const transcript = transcriptIds instanceof Set ? transcriptIds : (Array.isArray(transcriptIds) ? new Set(transcriptIds) : null);
    const persisted = [];
    const stale = [];
    let branched = 0;
    for (const entry of persistedRaw) {
        let keep;
        if (retired.has(entry.text)) {
            keep = false;
        } else if (isTransientCategory(entry.category)) {
            keep = !transcript || typeof entry.sourceMessage !== 'string' || !entry.sourceMessage || transcript.has(entry.sourceMessage);
            if (!keep) branched += 1;
        } else {
            keep = currentSeedTexts.has(entry.text);
        }
        (keep ? persisted : stale).push(entry);
    }
    if (stale.length > 0) {
        console.log(`[VectorMemory] Pruned ${stale.length} stale rows from the campaign cache (${branched} written after this slot's last message)`);
    }
    if (branched > 0 && typeof onBranchPruned === 'function') {
        try { onBranchPruned(branched); } catch { /* a note must never break the seed */ }
    }
    const toPersist = [];
    if (persisted.length > 0) {
        memoryStore = persisted;
        console.log(`[VectorMemory] Loaded ${persisted.length} cached embeddings for this campaign`);
    }

    // Embed only items not already cached. One batchEmbedContents round trip
    // per 100 items (2026-08-08 audit: the old 5-wide per-item fan-out cost a
    // cold device ~300 sequential trips before RAG was warm); a failed vector
    // skips its item exactly like the per-item path, and the next mount's seed
    // retries whatever the cache is still missing.
    // The seed's `subjects` win over the cached row's: a journal row tagged
    // when only Celeste was on the roster stayed [Celeste] forever, invisible
    // to Ketta's scenes once she was registered (2026-09-06 audit — the old
    // patch fired only on rows with NO tag). Compared as normalized lists; a
    // changed list is rewritten in place (same [sessionId, text] key, so
    // persist is an upsert; no re-embed). A seed item carrying no subjects
    // leaves the cached tag alone — the live-add tagger may know more than a
    // seed built from a since-trimmed roster.
    const seedByText = new Map((items || [])
        .filter(item => typeof item?.text === 'string' && item.text.trim())
        .map(item => [item.text, item]));
    // The text is the key; `subjects`, `atMessage` and `location` are NOT —
    // they follow the record (2026-10-23 P2: a cache keyed by one field
    // re-reads every OTHER field on a hit, in ONE place). The stamp used to be
    // carried into a stamp-LESS row only (2026-10-21), so a `state` fact the
    // record re-stamped @10 → @90 — the one fact kind whose age the DM is
    // asked to judge — retrieved as @10 on every later mount, and `location`
    // was never re-read: an NPC moved Dunmere → Rimehollow retrieved at
    // Dunmere. A seed item carrying NO stamp or NO location leaves the cached
    // one alone, the subjects rule — the live fact lane tags "where recorded"
    // and the seed's fact composer carries no place by design.
    for (const entry of memoryStore) {
        const seedItem = seedByText.get(entry.text);
        if (!seedItem) continue;
        let changed = false;
        const cleanSubjects = normalizeSubjects(seedItem.subjects);
        if (cleanSubjects && !sameSubjects(cleanSubjects, entry.subjects)) {
            entry.subjects = cleanSubjects;
            changed = true;
        }
        const seedStamp = memoryStamp(seedItem.atMessage);
        if (seedStamp !== null && entry.atMessage !== seedStamp) {
            entry.atMessage = seedStamp;
            changed = true;
        }
        const seedLocation = cleanLocation(seedItem.location);
        if (seedLocation !== null && entry.location !== seedLocation) {
            entry.location = seedLocation;
            changed = true;
        }
        if (changed) toPersist.push(entry);
    }

    const existingTexts = new Set(persisted.map(m => m.text));
    const newItems = (items || [])
        .filter(item => typeof item?.text === 'string' && item.text.trim())
        .filter(item => !existingTexts.has(item.text));
    let missing = 0;
    let failure = null;
    if (newItems.length > 0) {
        if (persisted.length > 0) console.log(`[VectorMemory] Embedding ${newItems.length} new items not in cache`);
        const vectors = await embedTexts(apiKey, newItems.map(item => item.text), {
            inputType: 'document',
            onError: (reason) => { failure = reason; },
        });
        if (superseded()) return;
        newItems.forEach((item, i) => {
            if (vectors?.[i]) {
                const entry = storeMemoryEntry({ text: item.text, vector: vectors[i], category: item.category || 'general', location: item.location, subjects: item.subjects, atMessage: item.atMessage, generation });
                if (entry) toPersist.push(entry);
            } else {
                missing += 1;
                console.error('[VectorMemory] Embedding failed for:', item.text.slice(0, 80));
            }
        });
    }
    // Awaited (2026-10-23 P2): the seed resolves once its rows are on disk, so
    // a same-campaign seed chained behind it reads them instead of re-embedding.
    await syncPersistedEmbeddings({ put: toPersist, remove: stale });
    if (superseded()) return;
    if (persisted.length === 0) {
        console.log(`[VectorMemory] Seeded ${memoryStore.length} memories (fresh embeddings)`);
    }
    // A long campaign's cache can arrive over the cap (rows persisted before the
    // cap existed) — addMemory enforces per-add, this covers the bulk load.
    enforceCampaignCap();
    // Rows still missing run this whole session against a partial store
    // (2026-09-29 P2) — said once, with the provider's reason, so the player
    // hears it instead of the console.
    if (missing > 0 && typeof onIncomplete === 'function') {
        try { onIncomplete({ missing, reason: failure }); } catch { /* a notice must never break the seed */ }
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
/** How much similarity an absent-subject memory must additionally clear. */
export const PRESENCE_ABSENT_PENALTY = 0.12;
/** Two rows at or above this mutual cosine are one memory for slot purposes. */
export const NEAR_DUPLICATE_SIMILARITY = 0.9;
/** Rank-only category nudges (order, never the gate — 2026-08-06 rule). */
export const CATEGORY_BOOST = {
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

/**
 * @param {string} apiKey
 * @param {string} query - embedded as the search query (unchanged by presenceText)
 * @param {number} [topN]
 * @param {number} [minScore]
 * @param {{ presenceText?: string, onUnavailable?: (reason: object|null) => void, atMessage?: number|null }} [options] -
 *   `presenceText`: extra scene text (the last narrative turns) consulted ONLY
 *   for who is present; never embedded. `onUnavailable`: called once when the
 *   QUERY embed fails (a memory-less turn) with the provider's failure reason
 *   (`{ status, message, timedOut }`) or null. `atMessage`: the message count
 *   this retrieval is for — stamped as `lastHitMessage` on each retrieved
 *   store row (inspector telemetry, in-memory only; 2026-09-30).
 * @returns {Promise<Array<{text: string, category: string, score: number, hits: number, location?: string, atMessage?: number}>>}
 */
export async function retrieveRelevant(apiKey, query, topN = 8, minScore = 0.55, { presenceText = '', onUnavailable = null, atMessage = null } = {}) {
    if (!apiKey || !query) return [];
    // A cold seed still embedding: wait for the store to be whole rather than
    // answer from the slice that happens to have landed.
    if (seedInFlight) await seedInFlight.promise.catch(() => {});
    if (memoryStore.length === 0) return [];

    let failure = null;
    let queryVector = queryVectorMemo.get(query) || null;
    if (!queryVector) {
        queryVector = await embedText(apiKey, query, { inputType: 'query', onError: (reason) => { failure = reason; } });
        if (queryVector) rememberQueryVector(query, queryVector);
    }
    if (!queryVector) {
        // Distinct from "nothing matched" (2026-09-17 P2): a failed query
        // embed means the turn runs memory-LESS, which the caller should say
        // out loud — a console line alone hid the class from the player.
        // The provider's reason rides along (2026-09-19): a rejected key after
        // a vendor switch and a rate limit need different remedies.
        if (typeof onUnavailable === 'function') {
            try { onUnavailable(failure); } catch { /* a notice must never break retrieval */ }
        }
        return [];
    }

    // Presence-aware retrieval (2026-08-28, "dormant, not deleted"): a memory
    // tagged with the people it is ABOUT loses ground when none of them are in
    // the scene — pure semantic similarity had the hero's darkest recorded
    // nights following him into every unrelated intimate scene, because to a
    // cosine "sex is sex". The moment the person, place, or thread re-enters
    // the conversation the query names them and the memory returns at full
    // weight. Unlike the category boost (order-only by the 2026-08-06 rule),
    // this penalty deliberately affects the GATE too: keeping a row out is the
    // safe direction; it can never let a sub-threshold row in.
    // Presence is judged from the player's message PLUS the last narrative
    // turns (2026-09-06 P1): the DM's narration is what establishes who is in
    // the scene, and a conversation's second line ("What do you know about
    // the ledger?") rarely repeats the name of the person being spoken to —
    // judged from the query alone, every dialogue went dormant on exactly the
    // person it was about. The embed query itself is untouched.
    const queryWords = textWordSet(`${query} ${presenceText || ''}`);
    // null (no identifying tokens, "The Lady") can't be judged absent — treat
    // as present so the row is never permanently penalized.
    const subjectsPresent = (subjects) => subjects.some(name => nameTokensPresent(queryWords, name) !== false);

    const scored = memoryStore
        .map(m => {
            const similarity = cosineSimilarity(queryVector, m.vector);
            const absentSubject = Array.isArray(m.subjects) && m.subjects.length > 0 && !subjectsPresent(m.subjects);
            return { entry: m, gated: similarity - (absentSubject ? PRESENCE_ABSENT_PENALTY : 0) };
        })
        .filter(({ gated }) => gated >= minScore)
        .map(({ entry, gated }) => ({
            ...entry,
            entry, // the store row itself — the telemetry stamp below writes to it
            score: gated + (CATEGORY_BOOST[entry.category] || 0),
        }))
        .sort((a, b) => b.score - a.score);

    // Diversity pass (MMR-lite): near-duplicate rows — three consecutive journal
    // entries about the same night — share ONE slot instead of crowding out the
    // current scene's actual context. Greedy: keep the best of each cluster.
    const chosen = [];
    for (const candidate of scored) {
        if (chosen.length >= topN) break;
        if (chosen.some(sel => cosineSimilarity(sel.vector, candidate.vector) >= NEAR_DUPLICATE_SIMILARITY)) continue;
        chosen.push(candidate);
    }

    // Retrieval telemetry (memory-research M2, 2026-09-30): a per-row hit
    // count and the last message it was retrieved for, stamped on the
    // in-memory store row — read by the inspector, never a survival rule,
    // never persisted (the cache store is written by the batch, not per turn).
    // The chosen copy keeps its store row beside the spread (2026-10-11 P2
    // nit: the stamp used to re-find each row by text + category — O(N) per
    // chosen row — and count the hit twice).
    for (const m of chosen) {
        const row = m.entry;
        row.hits = (Number.isFinite(row.hits) ? row.hits : 0) + 1;
        if (Number.isFinite(atMessage)) row.lastHitMessage = atMessage;
    }
    return chosen.map(m => ({
        text: m.text,
        category: m.category,
        score: m.score,
        hits: m.entry.hits,
        ...(m.location && { location: m.location }),
        ...(Number.isFinite(m.atMessage) && { atMessage: m.atMessage }),
    }));
}

/**
 * Clear the in-memory store and the ENTIRE persisted cache (all campaigns).
 * TEST/MAINTENANCE ONLY — zero production call sites by design (2026-08-30
 * ruling): since rows became campaign-keyed, campaign switch replaces the
 * in-memory store and reads only that campaign's rows, and save deletion
 * purges per-campaign rows via deleteCampaignMemories, so no product flow
 * needs a global wipe. Kept as the test suite's reset hook and a console
 * escape hatch; wire it into UI only as part of an explicit
 * reset-all-app-data flow, never a campaign-level action.
 */
export function clearMemories() {
    memoryStore = [];
    activeSessionId = null;
    queryVectorMemo.clear();
    discardMemoryQueue();
    // Awaitable: resolves once the persisted clear actually commits.
    return clearPersistedEmbeddings();
}

/**
 * Delete every persisted embedding row belonging to ONE campaign (2026-08-06 P1:
 * before this, deleting a campaign's saves orphaned its rows permanently).
 * Composite [sessionId, text] keys make this a single ranged delete — in
 * IndexedDB key order, arrays sort after every string, so [sessionId, []] is an
 * upper bound past any text. Never rejects; the cache is derivable, so a failed
 * purge only costs disk until the next successful one.
 */
export function deleteCampaignMemories(sessionId) {
    if (sessionId == null) return Promise.resolve();
    if (activeSessionId === sessionId) {
        memoryStore = [];
    }
    return withEmbedDb('readwrite', (store) => { store.delete(campaignKeyRange(sessionId)); }).catch(() => {});
}

/**
 * Should deleting a save slot purge its campaign's embedding cache?
 * Only when the campaign is verifiably gone from this device: the deleted slot
 * carried a sessionId stamp, it isn't the live session, and no remaining slot
 * (manual or autosave) claims it. Legacy saves without the stamp contribute
 * nothing to remainingSessionIds — the worst case of purging a campaign a
 * legacy slot still holds is a transparent re-embed on its next load, never
 * data loss (embeddings are derived from the save itself).
 */
export function shouldPurgeCampaignEmbeddings({ deletedSessionId, liveSessionId = null, remainingSessionIds = [] }) {
    if (!deletedSessionId) return false;
    if (deletedSessionId === liveSessionId) return false;
    return !remainingSessionIds.includes(deletedSessionId);
}

/**
 * TEST HOOK: current memory count. No production caller by design (the
 * Memory Inspector counts the record, not the cache) — kept, with
 * getMemoryTexts, as the suite's store inspection beside clearMemories.
 */
export function getMemoryCount() {
    return memoryStore.length;
}

/** Texts currently in the store — store inspection for tests/diagnostics
 * (retrieval is no longer a faithful mirror: the diversity pass collapses
 * near-duplicate vectors by design). */
export function getMemoryTexts() {
    return memoryStore.map(m => m.text);
}

// ——— THE row composers (2026-10-11 audit P2) ———
// A RAG row's TEXT is its identity: the exact-text dedupe, the mutable-category
// prune, the retired-texts prune and the retraction all compare it. It had
// eleven composers across the seed, the live lanes and the retraction — and
// the live fact lane composed from the WIRE before the reducer judged it, so a
// restatement the record refused was embedded anyway and a `knownBy: "public"`
// fact embedded with a SECRET tag the record never had. One composer per
// category: the seed, every live lane and the retraction call these.

/** Narrative / player text clamp — the live lanes embed a scene's head, not its whole. */
export const MEMORY_TEXT_CLAMP = 500;

/** A world fact's row text — the secrecy tag inside the text, so a hit re-surfaces its knower boundary. */
export function factMemoryText(fact) {
    return `${formatSecrecyTag(fact?.knownBy)}${typeof fact?.fact === 'string' ? fact.fact : ''}`;
}

// Every composer stamps `atMessage` from its record (2026-10-21, memory-research
// M1 — a retrieved memory says when): a fact's own `atMessage` (re-stamped by
// a state / intent restatement), a journal entry's span END, a card's first
// sighting, an NPC's last sighting; the live scene lanes pass the count.

/** A world fact's row (seed or live lane). */
export function factMemoryItem(fact, { location = null, sourceMessage = null, atMessage = fact?.atMessage } = {}) {
    return {
        text: factMemoryText(fact),
        category: typeof fact?.category === 'string' && fact.category ? fact.category : 'world_fact',
        location,
        subjects: null,
        sourceMessage,
        atMessage: memoryStamp(atMessage),
    };
}

/** A narrative or player row: the location in the text so a hit says where it was recorded. */
export function sceneMemoryItem(text, { category = 'narrative', location = null, sourceMessage = null, atMessage = null } = {}) {
    const clean = typeof text === 'string' ? text.slice(0, MEMORY_TEXT_CLAMP) : '';
    return {
        text: location ? `[Location: ${location}] ${clean}` : clean,
        category,
        location,
        subjects: null,
        sourceMessage,
        atMessage: memoryStamp(atMessage),
    };
}

/** A journal entry's row, tagged with the roster people it names; aged at its span's end. */
export function journalMemoryItem(entry, rosterNames = []) {
    const range = Array.isArray(entry?.messageRange) ? entry.messageRange : null;
    return {
        text: typeof entry?.summary === 'string' ? entry.summary : '',
        category: 'journal',
        location: entry?.location ?? null,
        subjects: findSubjectsInText(entry?.summary, rosterNames),
        sourceMessage: null,
        atMessage: memoryStamp(range?.[1]),
    };
}

/**
 * An NPC's row: name, disposition and current notes, about that person; aged
 * at their last sighting. NULL for an NPC with no notes or no name (2026-10-23
 * nit): the seed site used to pre-filter `lastNotes || notes` on its own and
 * agree with this text by coincidence — a divergence read "Tammo (friendly):
 * undefined". The composer owns the rule; callers `.filter(Boolean)`
 * (queueMemoryItem already skips a null item).
 */
export function npcMemoryItem(npc) {
    const name = typeof npc?.name === 'string' && npc.name.trim() ? npc.name : null;
    const notes = [npc?.lastNotes, npc?.notes].find(value => typeof value === 'string' && value.trim()) ?? null;
    if (name === null || notes === null) return null;
    return {
        text: `${name} (${npc?.disposition || 'unknown'}): ${notes}`,
        category: 'npc',
        location: npc?.basedIn || npc?.lastLocation || null,
        subjects: [npc?.name],
        sourceMessage: null,
        atMessage: memoryStamp(npc?.lastSeenMessage),
    };
}

/** A story card's row: secrecy tag, subject and text, about its linked people; aged at its first sighting. */
export function storyCardMemoryItem(card) {
    return {
        text: `${formatSecrecyTag(card?.knownBy)}${card?.subject ? `${card.subject}: ` : ''}${card?.text}`,
        category: `story_${card?.type || 'callback'}`,
        location: card?.location ?? null,
        subjects: Array.isArray(card?.linkedNpcNames) && card.linkedNpcNames.length > 0 ? card.linkedNpcNames : null,
        sourceMessage: null,
        atMessage: memoryStamp(card?.firstSeenMessage),
    };
}
