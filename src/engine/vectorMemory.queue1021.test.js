/**
 * Memory-research 2026-10-21 (Lane A): a retrieved memory says when (M1) and
 * a load is a branch (M0). Every row carries `atMessage` from its record or
 * the live write, the seed stamps a cached stamp-less row through the retag
 * upsert (no re-embed), retrieval returns the stamp; and the seed prunes a
 * transient row stamped with a message the loaded transcript does not hold,
 * and a record-category row the seed no longer carries — a load of an older
 * slot forgets the future the player abandoned.
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
    getMemoryTexts,
    journalMemoryItem,
    npcMemoryItem,
    queueMemoryItem,
    retrieveRelevant,
    sceneMemoryItem,
    seedMemories,
    storyCardMemoryItem,
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

async function flushAsync(rounds = 25) {
    for (let i = 0; i < rounds; i++) await new Promise(resolve => setTimeout(resolve, 0));
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
    await clearMemories();
});

describe('M1: every composer stamps atMessage from its record', () => {
    it('a fact from its own atMessage (overridable), a journal entry from its span end, an NPC from the last sighting, a card from the first', () => {
        expect(factMemoryItem({ fact: 'The mill burned.', atMessage: 12 }).atMessage).toBe(12);
        expect(factMemoryItem({ fact: 'The mill burned.', atMessage: 12 }, { atMessage: 3 }).atMessage).toBe(3);
        expect(journalMemoryItem({ summary: 'A week on the road.', messageRange: [4, 9] }).atMessage).toBe(9);
        expect(npcMemoryItem({ name: 'Tammo', lastNotes: 'Keeps the ferry.', lastSeenMessage: 7 }).atMessage).toBe(7);
        expect(storyCardMemoryItem({ type: 'promise', text: 'A ribbon.', firstSeenMessage: 5 }).atMessage).toBe(5);
        expect(sceneMemoryItem('The reeve nods.', { atMessage: 2.7 }).atMessage).toBe(2);
    });

    it('junk is no stamp (null), never NaN or a negative', () => {
        expect(factMemoryItem({ fact: 'x' }).atMessage).toBeNull();
        expect(journalMemoryItem({ summary: 'x', messageRange: 'junk' }).atMessage).toBeNull();
        expect(npcMemoryItem({ name: 'T', lastNotes: 'x', lastSeenMessage: '7' }).atMessage).toBeNull();
        expect(sceneMemoryItem('x', { atMessage: -4 }).atMessage).toBe(0);
        expect(sceneMemoryItem('x', { atMessage: Infinity }).atMessage).toBeNull();
    });

    it('the live lanes store the stamp and retrieval returns it; a stamp-less row returns none', async () => {
        await seedMemories('key', [], 's1');
        queueMemoryItem('key', sceneMemoryItem('The harbor road is flooded.', { location: 'Saltmere', sourceMessage: 'a9', atMessage: 40 }));
        await flushMemoryQueue();
        await addMemories('key', [sceneMemoryItem('I draw my blade.', { category: 'player' })]);
        const rows = await retrieveRelevant('key', 'flooded road', 8, 0.5);
        const stamped = rows.find(r => r.text.includes('flooded'));
        const bare = rows.find(r => r.text === 'I draw my blade.');
        expect(stamped.atMessage).toBe(40);
        expect(bare).toBeDefined();
        expect(bare.atMessage).toBeUndefined();
    });

    it('the seed stamps new rows, carries a stamp into a cached stamp-less row with NO re-embed, and never overwrites a cached stamp', async () => {
        await putEmbeddings([
            row('Old fact without a stamp.', 'world_fact'),
            row('Old fact with a stamp.', 'world_fact', { atMessage: 3 }),
        ]);
        const seed = [
            { text: 'Old fact without a stamp.', category: 'world_fact', atMessage: 11 },
            { text: 'Old fact with a stamp.', category: 'world_fact', atMessage: 99 },
            { text: 'A new fact.', category: 'world_fact', atMessage: 20 },
        ];
        await seedMemories('key', seed, 's1');
        await flushAsync();
        expect(embedTextsMock).toHaveBeenCalledTimes(1);
        expect(embedTextsMock.mock.calls[0][1]).toEqual(['A new fact.']);

        const rows = await retrieveRelevant('key', 'fact', 8, 0.5);
        const byText = Object.fromEntries(rows.map(r => [r.text, r.atMessage]));
        expect(byText['Old fact without a stamp.']).toBe(11);
        expect(byText['Old fact with a stamp.']).toBe(3);
        expect(byText['A new fact.']).toBe(20);

        // The carried stamp is on DISK: a second mount reads it back without the seed's help.
        embedTextsMock.mockClear();
        await seedMemories('key', seed.map(({ text, category }) => ({ text, category })), 's1');
        const again = await retrieveRelevant('key', 'fact', 8, 0.5);
        expect(again.find(r => r.text === 'Old fact without a stamp.').atMessage).toBe(11);
        expect(embedTextsMock).not.toHaveBeenCalled();
    });
});

describe('M0: a load is a branch — the seed forgets the abandoned future', () => {
    it('prunes a transient row stamped with a message the loaded transcript does not hold, keeps a stamped row it holds and a stamp-less legacy row', async () => {
        await putEmbeddings([
            row('[Location: Saltmere] The reeve says the road is flooded.', 'narrative', { sourceMessage: 'm-future' }),
            row('[Location: Saltmere] The ferry is late.', 'narrative', { sourceMessage: 'm-5' }),
            row('I pay the reeve.', 'player', { sourceMessage: 'm-future-2' }),
            row('A legacy narrative row.', 'narrative'),
            row('A legacy general row.', 'general', { sourceMessage: 'm-future-3' }),
        ]);
        const onBranchPruned = vi.fn();
        await seedMemories('key', [], 's1', { transcriptIds: new Set(['m-1', 'm-5']), onBranchPruned });
        await flushAsync();
        const texts = getMemoryTexts();
        expect(texts).not.toContain('[Location: Saltmere] The reeve says the road is flooded.');
        expect(texts).not.toContain('I pay the reeve.');
        expect(texts).toContain('[Location: Saltmere] The ferry is late.');
        expect(texts).toContain('A legacy narrative row.');
        expect(texts).not.toContain('A legacy general row.');
        expect(onBranchPruned).toHaveBeenCalledTimes(1);
        expect(onBranchPruned).toHaveBeenCalledWith(3);

        // Gone from disk too: a later seed that cannot judge (no transcript) does not resurrect them.
        await seedMemories('key', [], 's1');
        expect(getMemoryTexts()).not.toContain('I pay the reeve.');
        expect(getMemoryTexts()).toContain('[Location: Saltmere] The ferry is late.');
    });

    it('without a transcript (null) every stamped transient row is kept and nothing is reported', async () => {
        await putEmbeddings([row('[Location: X] A beat.', 'narrative', { sourceMessage: 'm-anything' })]);
        const onBranchPruned = vi.fn();
        await seedMemories('key', [], 's1', { onBranchPruned });
        expect(getMemoryTexts()).toContain('[Location: X] A beat.');
        expect(onBranchPruned).not.toHaveBeenCalled();
    });

    it('a fact row under ANY category the loaded record no longer carries prunes; one it carries stays; retiredTexts is still the belt', async () => {
        await putEmbeddings([
            row('The threat known as "The Mill Brood" has ended.', 'event'),
            row('The harbor road is flooded.', 'world_fact'),
            row('The bridge at Ashford is passable.', 'world_fact'),
            row('Orsa (wary): keeps the countinghouse.', 'npc'),
        ]);
        const seed = [
            { text: 'The harbor road is flooded.', category: 'world_fact' },
            { text: 'Orsa (wary): keeps the countinghouse.', category: 'npc' },
        ];
        await seedMemories('key', seed, 's1', { retiredTexts: new Set(['The bridge at Ashford is passable.']) });
        await flushAsync();
        const texts = getMemoryTexts();
        expect(texts).toEqual(expect.arrayContaining(['The harbor road is flooded.', 'Orsa (wary): keeps the countinghouse.']));
        expect(texts).not.toContain('The threat known as "The Mill Brood" has ended.');
        expect(texts).not.toContain('The bridge at Ashford is passable.');
        expect(embedTextsMock).not.toHaveBeenCalled();
    });
});
