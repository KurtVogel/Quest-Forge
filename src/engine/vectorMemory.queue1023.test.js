/**
 * Strengthening 2026-10-23 (vector-memory-rag, Lap 1): the store has a seed
 * GENERATION — a writer whose embed was on the wire when another campaign
 * seeded lands nothing under the new campaign, a superseded seed's late rows
 * land nowhere, and two overlapping seeds of ONE campaign embed the cold set
 * once; the retag upsert re-reads `atMessage` AND `location` on a cache hit
 * (the text is the key, the stamp and the place follow the record); the NPC
 * composer owns the note-less filter.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';

globalThis.IDBKeyRange = IDBKeyRange;

const { embedTextMock, embedTextsMock, SCHEMA } = vi.hoisted(() => ({
    embedTextMock: vi.fn(),
    embedTextsMock: vi.fn(),
    SCHEMA: 'gemini-embedding-2:search-retrieval-v1:768',
}));

vi.mock('../llm/providers/gemini.js', async (importOriginal) => ({
    ...(await importOriginal()),
    embedText: embedTextMock,
    embedTexts: embedTextsMock,
    GEMINI_EMBED_DIMENSIONS: 768,
    GEMINI_EMBED_SCHEMA: SCHEMA,
}));

import {
    addMemories,
    clearMemories,
    factMemoryItem,
    flushMemoryQueue,
    getMemoryCount,
    getMemoryTexts,
    npcMemoryItem,
    queueMemoryItem,
    retrieveRelevant,
    sceneMemoryItem,
    seedMemories,
} from './vectorMemory.js';

function unitVector(index) {
    const vector = Array(768).fill(0);
    vector[index] = 1;
    return vector;
}

// Query-aligned (cos 0.8 against unitVector(0)) but mutually distinct (0.64),
// so the diversity pass never folds two rows into one slot.
function alignedVector(index) {
    const vector = Array(768).fill(0);
    vector[0] = 0.8;
    vector[index] = 0.6;
    return vector;
}
let nextAxis = 1;

function putEmbeddings(entries) {
    return new Promise((resolve, reject) => {
        const request = globalThis.indexedDB.open('rpg-vector-memory', 4);
        request.onupgradeneeded = (event) => {
            const db = event.target.result;
            if (!db.objectStoreNames.contains('embeddings')) {
                db.createObjectStore('embeddings', { keyPath: ['sessionId', 'text'] });
            }
        };
        request.onsuccess = () => {
            const db = request.result;
            const tx = db.transaction('embeddings', 'readwrite');
            const store = tx.objectStore('embeddings');
            for (const e of entries) store.put(e);
            tx.oncomplete = () => { db.close(); resolve(); };
            tx.onerror = () => reject(tx.error);
        };
        request.onerror = () => reject(request.error);
    });
}

/** Every persisted row of one campaign, read straight from the store. */
function readPersisted(sessionId) {
    return new Promise((resolve, reject) => {
        const request = globalThis.indexedDB.open('rpg-vector-memory', 4);
        request.onsuccess = () => {
            const db = request.result;
            const tx = db.transaction('embeddings', 'readonly');
            const all = tx.objectStore('embeddings').getAll();
            all.onsuccess = () => { db.close(); resolve(all.result.filter(r => r.sessionId === sessionId)); };
            all.onerror = () => reject(all.error);
        };
        request.onerror = () => reject(request.error);
    });
}

async function flushAsync(rounds = 25) {
    for (let i = 0; i < rounds; i++) await new Promise(resolve => setTimeout(resolve, 0));
}

/** An embedTexts implementation that holds ONE call (the first whose texts pass `match`) until `release()`. */
function holdEmbed(match = () => true) {
    let release = null;
    let held = false;
    embedTextsMock.mockImplementation(async (apiKey, texts, options) => {
        if (!held && match(texts)) {
            held = true;
            await new Promise(resolve => { release = resolve; });
        }
        return Promise.all((texts || []).map(text => embedTextMock(apiKey, text, options)));
    });
    return {
        release: async () => { release?.(); await flushAsync(); },
        get held() { return held; },
    };
}

const row = (text, category, extra = {}) => ({ sessionId: 's1', text, category, timestamp: 1, vector: alignedVector(nextAxis++), schema: SCHEMA, ...extra });

beforeEach(async () => {
    globalThis.indexedDB = new IDBFactory();
    embedTextMock.mockReset();
    embedTextsMock.mockReset();
    nextAxis = 1;
    embedTextMock.mockImplementation(async (apiKey, text, options) => (options?.inputType === 'query' ? unitVector(0) : alignedVector(nextAxis++)));
    embedTextsMock.mockImplementation(async (apiKey, texts, options) =>
        Promise.all((texts || []).map(text => embedTextMock(apiKey, text, options))));
    vi.spyOn(console, 'log').mockImplementation(() => {});
    await clearMemories();
});

describe('P2: the seed generation — a late writer during a seed switch lands nothing under the new campaign', () => {
    it('an addMemories past its embed await when another campaign seeds stores nothing, in memory or on disk', async () => {
        await seedMemories('key', [], 's1');
        const hold = holdEmbed();
        const late = addMemories('key', [sceneMemoryItem("Campaign A's reeve nods.", { sourceMessage: 'a-9', atMessage: 9 })]);
        await flushAsync();
        expect(hold.held).toBe(true);

        // Campaign B seeds while A's batch is on the wire.
        await seedMemories('key', [{ text: "Campaign B's gate is barred.", category: 'world_fact' }], 's2');
        await hold.release();
        await late;

        expect(getMemoryTexts()).toEqual(["Campaign B's gate is barred."]);
        expect((await readPersisted('s2')).map(r => r.text)).toEqual(["Campaign B's gate is barred."]);
        expect(await readPersisted('s1')).toEqual([]);
        // B's retrieval never sees A's scene.
        const rows = await retrieveRelevant('key', 'reeve', 8, 0.5);
        expect(rows.map(r => r.text)).not.toContain("Campaign A's reeve nods.");
    });

    it('a flushed queue batch on the wire at the switch lands nothing either', async () => {
        await seedMemories('key', [], 's1');
        const hold = holdEmbed();
        queueMemoryItem('key', factMemoryItem({ fact: 'The mill burned.', atMessage: 4 }));
        const flushed = flushMemoryQueue();
        await flushAsync();
        expect(hold.held).toBe(true);

        await seedMemories('key', [], 's2');
        await hold.release();
        await flushed;

        expect(getMemoryCount()).toBe(0);
        expect(await readPersisted('s2')).toEqual([]);
    });

    it('a superseded seed (another campaign seeded while its cold set was embedding) pushes none of its late rows into the new store', async () => {
        const hold = holdEmbed(texts => texts.some(t => t.startsWith('A:')));
        const seedA = seedMemories('key', [
            { text: 'A: the ferry is late.', category: 'world_fact' },
            { text: 'A: the reeve owes a debt.', category: 'world_fact' },
        ], 's1');
        await flushAsync();
        expect(hold.held).toBe(true);

        await seedMemories('key', [{ text: 'B: the gate is barred.', category: 'world_fact' }], 's2');
        await hold.release();
        await seedA;

        expect(getMemoryTexts()).toEqual(['B: the gate is barred.']);
        expect(await readPersisted('s1')).toEqual([]);
        expect((await readPersisted('s2')).map(r => r.text)).toEqual(['B: the gate is barred.']);
    });
});

describe('P2: two overlapping seeds of ONE campaign embed the cold set once', () => {
    const cold = Array.from({ length: 5 }, (_, i) => ({ text: `Cold fact ${i}.`, category: 'world_fact', atMessage: i }));

    it('the second seed awaits the first and makes NO embed call for rows the first landed', async () => {
        const hold = holdEmbed();
        const first = seedMemories('key', cold, 's1');
        const second = seedMemories('key', cold, 's1');
        await flushAsync();
        await hold.release();
        await Promise.all([first, second]);

        expect(embedTextsMock).toHaveBeenCalledTimes(1);
        expect(embedTextsMock.mock.calls[0][1]).toEqual(cold.map(c => c.text));
        expect(getMemoryCount()).toBe(5);
        expect((await readPersisted('s1')).length).toBe(5);
    });

    it('a second seed carrying one MORE item embeds only that item', async () => {
        const hold = holdEmbed();
        const first = seedMemories('key', cold, 's1');
        const second = seedMemories('key', [...cold, { text: 'A sixth fact.', category: 'world_fact' }], 's1');
        await flushAsync();
        await hold.release();
        await Promise.all([first, second]);

        expect(embedTextsMock).toHaveBeenCalledTimes(2);
        expect(embedTextsMock.mock.calls[1][1]).toEqual(['A sixth fact.']);
        expect(getMemoryCount()).toBe(6);
    });

    it('retrieval during the chained pair waits for BOTH seeds (the store is whole)', async () => {
        const hold = holdEmbed();
        const first = seedMemories('key', cold, 's1');
        const second = seedMemories('key', [...cold, { text: 'A sixth fact.', category: 'world_fact' }], 's1');
        const rows = retrieveRelevant('key', 'fact', 8, 0.5);
        await flushAsync();
        await hold.release();
        await Promise.all([first, second]);
        expect((await rows).map(r => r.text)).toContain('A sixth fact.');
    });
});

describe('P2: the retag re-reads atMessage AND location on a cache hit — no re-embed', () => {
    it('an NPC moved Dunmere → Rimehollow retrieves at Rimehollow, on this mount and from disk on the next', async () => {
        const tammo = (basedIn) => npcMemoryItem({ name: 'Tammo', disposition: 'friendly', lastNotes: 'Keeps the ferry.', basedIn, lastSeenMessage: 12 });
        await putEmbeddings([row(tammo('Dunmere').text, 'npc', { location: 'Dunmere', subjects: ['Tammo'], atMessage: 12 })]);

        await seedMemories('key', [tammo('Rimehollow')], 's1');
        expect(embedTextsMock).not.toHaveBeenCalled();
        const [hit] = await retrieveRelevant('key', 'Tammo ferry', 8, 0.5);
        expect(hit.location).toBe('Rimehollow');
        expect(hit.atMessage).toBe(12);

        // Persisted: a second mount whose seed item carries NO location keeps Rimehollow.
        await seedMemories('key', [{ ...tammo('Rimehollow'), location: null }], 's1');
        const [again] = await retrieveRelevant('key', 'Tammo ferry', 8, 0.5);
        expect(again.location).toBe('Rimehollow');
        expect(embedTextsMock).not.toHaveBeenCalled();
    });

    it('a state fact the record re-stamped @10 → @90 retrieves as @90; a seed item with no stamp or no location leaves the cached ones alone (the live lane tagged where it was recorded)', async () => {
        await putEmbeddings([row('The harbor road is flooded.', 'world_fact', { location: 'Saltmere', atMessage: 10 })]);
        await seedMemories('key', [factMemoryItem({ fact: 'The harbor road is flooded.', aspect: 'state', atMessage: 90 })], 's1');
        const [hit] = await retrieveRelevant('key', 'flooded road', 8, 0.5);
        expect(hit.atMessage).toBe(90);
        expect(hit.location).toBe('Saltmere');

        await seedMemories('key', [{ text: 'The harbor road is flooded.', category: 'world_fact' }], 's1');
        const [again] = await retrieveRelevant('key', 'flooded road', 8, 0.5);
        expect(again.atMessage).toBe(90);
        expect(again.location).toBe('Saltmere');
        expect(embedTextsMock).not.toHaveBeenCalled();
    });

    it('a hit whose stamp and place already agree with the record is NOT rewritten to disk', async () => {
        await putEmbeddings([row('The gate is barred.', 'world_fact', { location: 'Saltmere', atMessage: 4, timestamp: 777 })]);
        await seedMemories('key', [factMemoryItem({ fact: 'The gate is barred.', atMessage: 4 }, { location: 'Saltmere' })], 's1');
        const [persisted] = await readPersisted('s1');
        // Untouched row: its vector is still the plain array the fixture wrote (a rewrite narrows it to Float32Array).
        expect(Array.isArray(persisted.vector)).toBe(true);
        expect(persisted.timestamp).toBe(777);
    });
});

describe('nit: the NPC composer owns the note-less filter', () => {
    it('returns null for an NPC with no notes or no name; a note-less row never reads "undefined"', () => {
        expect(npcMemoryItem({ name: 'Tammo', disposition: 'friendly' })).toBeNull();
        expect(npcMemoryItem({ name: 'Tammo', lastNotes: '   ', notes: '' })).toBeNull();
        expect(npcMemoryItem({ lastNotes: 'Keeps the ferry.' })).toBeNull();
        expect(npcMemoryItem({ name: { first: 'T' }, lastNotes: 'Keeps the ferry.' })).toBeNull();
        expect(npcMemoryItem(null)).toBeNull();
        expect(npcMemoryItem({ name: 'Tammo', notes: 'Legacy notes.' }).text).toBe('Tammo (unknown): Legacy notes.');
        expect(npcMemoryItem({ name: 'Tammo', lastNotes: 'Keeps the ferry.', notes: 'Legacy notes.' }).text).toBe('Tammo (unknown): Keeps the ferry.');
    });

    it('a null composer result is skipped by the queue (no throw, nothing embedded) and by a .filter(Boolean) seed', async () => {
        await seedMemories('key', [npcMemoryItem({ name: 'Mute' }), npcMemoryItem({ name: 'Tammo', lastNotes: 'Keeps the ferry.' })].filter(Boolean), 's1');
        expect(getMemoryTexts()).toEqual(['Tammo (unknown): Keeps the ferry.']);
        await expect(queueMemoryItem('key', npcMemoryItem({ name: 'Mute' }))).resolves.toBeUndefined();
        expect(getMemoryCount()).toBe(1);
    });
});
