import { beforeEach, describe, expect, it, vi } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';

const { embedTextMock, SCHEMA } = vi.hoisted(() => ({
    embedTextMock: vi.fn(),
    SCHEMA: 'gemini-embedding-2:search-retrieval-v1:768',
}));

vi.mock('../llm/providers/gemini.js', () => ({
    embedText: embedTextMock,
    GEMINI_EMBED_DIMENSIONS: 768,
    GEMINI_EMBED_SCHEMA: SCHEMA,
}));

import {
    addMemory,
    buildRetrievedMemoriesBlock,
    clearMemories,
    getMemoryCount,
    retrieveRelevant,
    seedMemories,
} from './vectorMemory.js';

function unitVector(index) {
    const vector = Array(768).fill(0);
    vector[index] = 1;
    return vector;
}

function putEmbedding(entry) {
    return new Promise((resolve, reject) => {
        const request = globalThis.indexedDB.open('rpg-vector-memory', 3);
        request.onupgradeneeded = (event) => {
            const db = event.target.result;
            if (!db.objectStoreNames.contains('embeddings')) {
                db.createObjectStore('embeddings', { keyPath: 'text' });
            }
        };
        request.onsuccess = () => {
            const db = request.result;
            const tx = db.transaction('embeddings', 'readwrite');
            tx.objectStore('embeddings').put(entry);
            tx.oncomplete = () => { db.close(); resolve(); };
            tx.onerror = () => reject(tx.error);
        };
        request.onerror = () => reject(request.error);
    });
}

describe('VectorMemory embedding roles', () => {
    beforeEach(() => {
        globalThis.indexedDB = new IDBFactory();
        clearMemories();
        embedTextMock.mockReset();
    });

    it('embeds stored memories as documents and scene context as a query', async () => {
        const vector = Array(768).fill(0);
        vector[0] = 1;
        embedTextMock.mockResolvedValue(vector);

        await addMemory('test-key', 'Kraul was defeated in the cavern.', 'world_fact');
        const matches = await retrieveRelevant('test-key', 'What happened to Kraul?', 1, 0.5);

        expect(embedTextMock).toHaveBeenNthCalledWith(
            1,
            'test-key',
            'Kraul was defeated in the cavern.',
            { inputType: 'document' },
        );
        expect(embedTextMock).toHaveBeenNthCalledWith(
            2,
            'test-key',
            'What happened to Kraul?',
            { inputType: 'query' },
        );
        expect(matches).toEqual([expect.objectContaining({
            text: 'Kraul was defeated in the cavern.',
            category: 'world_fact',
            score: expect.closeTo(1.03, 2),
        })]);
    });

    it('labels retrieved raw player statements as non-canonical claims', () => {
        const block = buildRetrievedMemoriesBlock([
            { category: 'player', text: 'A unicorn bursts through the goblin-camp wall.' },
            { category: 'world_fact', text: 'The goblin camp gate is barred.' },
        ]);

        expect(block).toContain('[player statement/attempt — not automatically canon]');
        expect(block).toContain('is not proof that an external claim became true');
        expect(block).toContain('[world_fact] The goblin camp gate is barred.');
    });

    it('buildRetrievedMemoriesBlock returns an empty string for no memories', () => {
        expect(buildRetrievedMemoriesBlock([])).toBe('');
        expect(buildRetrievedMemoriesBlock(null)).toBe('');
        expect(buildRetrievedMemoriesBlock(undefined)).toBe('');
    });
});

describe('addMemory guards and dedup', () => {
    beforeEach(() => {
        globalThis.indexedDB = new IDBFactory();
        clearMemories();
        embedTextMock.mockReset();
    });

    it('does nothing without an API key', async () => {
        await addMemory('', 'Some fact.', 'world_fact');
        expect(embedTextMock).not.toHaveBeenCalled();
        expect(getMemoryCount()).toBe(0);
    });

    it('does nothing for empty or whitespace-only text', async () => {
        await addMemory('key', '   ', 'world_fact');
        expect(embedTextMock).not.toHaveBeenCalled();
        expect(getMemoryCount()).toBe(0);
    });

    it('does not re-embed an exact duplicate text', async () => {
        embedTextMock.mockResolvedValue(unitVector(0));
        await addMemory('key', 'The bridge collapsed.', 'world_fact');
        await addMemory('key', 'The bridge collapsed.', 'world_fact');
        expect(embedTextMock).toHaveBeenCalledTimes(1);
        expect(getMemoryCount()).toBe(1);
    });

    it('skips the entry when embedding fails (returns null)', async () => {
        embedTextMock.mockResolvedValue(null);
        await addMemory('key', 'The bridge collapsed.', 'world_fact');
        expect(getMemoryCount()).toBe(0);
    });
});

describe('retrieveRelevant guards, scoring, and ranking', () => {
    beforeEach(() => {
        globalThis.indexedDB = new IDBFactory();
        clearMemories();
        embedTextMock.mockReset();
    });

    it('returns no matches without an API key', async () => {
        expect(await retrieveRelevant('', 'query')).toEqual([]);
        expect(embedTextMock).not.toHaveBeenCalled();
    });

    it('returns no matches without a query', async () => {
        expect(await retrieveRelevant('key', '')).toEqual([]);
        expect(embedTextMock).not.toHaveBeenCalled();
    });

    it('returns no matches when the memory store is empty', async () => {
        expect(await retrieveRelevant('key', 'query')).toEqual([]);
        expect(embedTextMock).not.toHaveBeenCalled();
    });

    it('returns no matches when embedding the query fails', async () => {
        embedTextMock.mockResolvedValueOnce(unitVector(0)); // for addMemory
        await addMemory('key', 'Fact one.', 'world_fact');
        embedTextMock.mockResolvedValueOnce(null); // for the query embed
        expect(await retrieveRelevant('key', 'query')).toEqual([]);
    });

    it('filters out matches below minScore', async () => {
        embedTextMock.mockResolvedValueOnce(unitVector(0));
        await addMemory('key', 'Unrelated fact.', 'journal');
        embedTextMock.mockResolvedValueOnce(unitVector(1)); // orthogonal -> similarity 0
        const matches = await retrieveRelevant('key', 'query', 8, 0.5);
        expect(matches).toEqual([]);
    });

    it('limits results to topN, highest score first', async () => {
        embedTextMock.mockResolvedValueOnce(unitVector(0));
        await addMemory('key', 'Fact A.', 'world_fact');
        embedTextMock.mockResolvedValueOnce(unitVector(0));
        await addMemory('key', 'Fact B.', 'world_fact');
        embedTextMock.mockResolvedValueOnce(unitVector(0));
        await addMemory('key', 'Fact C.', 'world_fact');

        embedTextMock.mockResolvedValueOnce(unitVector(0));
        const matches = await retrieveRelevant('key', 'query', 2, 0.5);
        expect(matches).toHaveLength(2);
    });

    it('applies a category boost that can reorder equally-similar matches', async () => {
        embedTextMock.mockResolvedValueOnce(unitVector(0));
        await addMemory('key', 'A plain narrative beat.', 'narrative'); // boost -0.04
        embedTextMock.mockResolvedValueOnce(unitVector(0));
        await addMemory('key', 'An important NPC fact.', 'npc_character'); // boost +0.08

        embedTextMock.mockResolvedValueOnce(unitVector(0));
        const matches = await retrieveRelevant('key', 'query', 8, 0);
        expect(matches[0].category).toBe('npc_character');
        expect(matches[0].score).toBeGreaterThan(matches[1].score);
    });
});

describe('seedMemories', () => {
    beforeEach(() => {
        globalThis.indexedDB = new IDBFactory();
        clearMemories();
        embedTextMock.mockReset();
    });

    it('does nothing without an API key or with an empty item list', async () => {
        await seedMemories('', [{ text: 'a', category: 'world_fact' }]);
        await seedMemories('key', []);
        expect(embedTextMock).not.toHaveBeenCalled();
        expect(getMemoryCount()).toBe(0);
    });

    it('embeds every item fresh when no cache exists', async () => {
        embedTextMock.mockResolvedValue(unitVector(0));
        await seedMemories('key', [
            { text: 'Fact one.', category: 'world_fact' },
            { text: 'Fact two.', category: 'journal' },
        ]);
        expect(embedTextMock).toHaveBeenCalledTimes(2);
        expect(getMemoryCount()).toBe(2);
    });

    it('loads compatible cached embeddings and only embeds items missing from the cache', async () => {
        await putEmbedding({
            text: 'Cached fact.',
            vector: unitVector(0),
            category: 'world_fact',
            schema: SCHEMA,
            timestamp: 1,
        });
        embedTextMock.mockResolvedValue(unitVector(1));

        await seedMemories('key', [
            { text: 'Cached fact.', category: 'world_fact' },
            { text: 'Brand new fact.', category: 'world_fact' },
        ]);

        expect(embedTextMock).toHaveBeenCalledTimes(1);
        expect(embedTextMock).toHaveBeenCalledWith('key', 'Brand new fact.', { inputType: 'document' });
        expect(getMemoryCount()).toBe(2);
    });

    it('ignores cached embeddings with an incompatible schema and re-embeds from scratch', async () => {
        await putEmbedding({
            text: 'Stale fact.',
            vector: unitVector(0),
            category: 'world_fact',
            schema: 'old-schema-v0',
            timestamp: 1,
        });
        embedTextMock.mockResolvedValue(unitVector(0));

        await seedMemories('key', [{ text: 'Stale fact.', category: 'world_fact' }]);

        expect(embedTextMock).toHaveBeenCalledTimes(1);
        expect(getMemoryCount()).toBe(1);
    });
});
