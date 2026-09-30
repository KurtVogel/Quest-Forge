/**
 * Source-stamped retraction, the RAG half (memory-research M0, 2026-09-30):
 * a row remembers the DM message it was read from; removing that message
 * removes the row from the store AND from the persisted cache, and the
 * reducer's named fact texts go with it.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';

globalThis.IDBKeyRange = IDBKeyRange;

const { embedTextMock, embedTextsMock, SCHEMA } = vi.hoisted(() => ({
    embedTextMock: vi.fn(),
    embedTextsMock: vi.fn(),
    SCHEMA: 'gemini-embedding-2:search-retrieval-v1:768',
}));

vi.mock('../llm/providers/gemini.js', () => ({
    embedText: embedTextMock,
    embedTexts: embedTextsMock,
    GEMINI_EMBED_DIMENSIONS: 768,
    GEMINI_EMBED_SCHEMA: SCHEMA,
}));

import { addMemory, clearMemories, getMemoryTexts, queueMemory, flushMemoryQueue, retractMemoriesFromMessage, seedMemories } from './vectorMemory.js';

function unitVector(index) {
    const vector = Array(768).fill(0);
    vector[index] = 1;
    return vector;
}

describe('retractMemoriesFromMessage', () => {
    beforeEach(async () => {
        globalThis.indexedDB = new IDBFactory();
        embedTextMock.mockReset();
        embedTextsMock.mockReset();
        let n = 1;
        embedTextMock.mockImplementation(async () => unitVector(n++ % 700));
        embedTextsMock.mockImplementation(async (apiKey, texts, options) =>
            Promise.all((texts || []).map(text => embedTextMock(apiKey, text, options))));
        await clearMemories();
    });

    it('removes the narrative row stamped with the message and the named world_fact rows, in memory and on disk', async () => {
        await seedMemories('key', [], 'sess-1');
        await addMemory('key', '[Location: Saltmere] The reeve says the road is flooded.', 'narrative', 'Saltmere', null, 'a1');
        await addMemory('key', 'The harbor road is flooded.', 'world_fact', 'Saltmere');
        await addMemory('key', 'Orsa owns the countinghouse.', 'world_fact', 'Saltmere');
        queueMemory('key', 'Another beat.', 'narrative', 'Saltmere', null, 'a2');
        await flushMemoryQueue();
        expect(getMemoryTexts()).toHaveLength(4);

        const removed = await retractMemoriesFromMessage('a1', ['The harbor road is flooded.']);
        expect(removed).toBe(2);
        expect(getMemoryTexts().sort()).toEqual(['Another beat.', 'Orsa owns the countinghouse.']);

        // The persisted cache no longer holds them: re-seeding the same
        // campaign REPLACES the store from the cache — only survivors load.
        await seedMemories('key', [], 'sess-1');
        expect(getMemoryTexts()).not.toContain('The harbor road is flooded.');
        expect(getMemoryTexts()).not.toContain('[Location: Saltmere] The reeve says the road is flooded.');
        expect(getMemoryTexts()).toContain('Orsa owns the countinghouse.');
    });

    it('returns 0 and touches nothing for an unknown message or junk', async () => {
        await addMemory('key', 'A row.', 'narrative', null, null, 'a1');
        expect(await retractMemoriesFromMessage('nope')).toBe(0);
        expect(await retractMemoriesFromMessage(null)).toBe(0);
        expect(await retractMemoriesFromMessage('')).toBe(0);
        expect(getMemoryTexts()).toEqual(['A row.']);
    });
});
