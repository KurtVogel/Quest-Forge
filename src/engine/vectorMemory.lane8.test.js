/**
 * Identity by reference, lane 8 (2026-11-08): a story card's row carries its
 * card id, and `nearestStoryCards` reads the cards nearest in meaning to a
 * query off those rows — one row per card, the query vector memoized with the
 * turn's own retrieval, legacy rows without the stamp skipped.
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

import { addMemories, clearMemories, nearestStoryCards, retrieveRelevant, storyCardMemoryItem } from './vectorMemory.js';

function alignedVector(index, cos) {
    const vector = Array(768).fill(0);
    vector[0] = cos;
    vector[index] = Math.sqrt(1 - cos * cos);
    return vector;
}
const unit = Array(768).fill(0); unit[0] = 1;

const BY_TEXT = new Map();
beforeEach(() => {
    clearMemories();
    globalThis.indexedDB = new IDBFactory();
    embedTextMock.mockReset();
    embedTextsMock.mockReset();
    embedTextMock.mockImplementation(async (apiKey, text) => BY_TEXT.get(text) || unit);
    embedTextsMock.mockImplementation(async (apiKey, texts, options) => Promise.all((texts || []).map(text => embedTextMock(apiKey, text, options))));
});

describe('nearestStoryCards', () => {
    it('returns the cards nearest the query, one per card, by card id, skipping rows with no stamp and rows that are not story rows', async () => {
        const near = storyCardMemoryItem({ id: 'c-near', type: 'promise', subject: 'the vow', text: 'Row out to Gannet Rock before the gales.', firstSeenMessage: 4 });
        const far = storyCardMemoryItem({ id: 'c-far', type: 'callback', text: 'Vasko plans a contraband run.' });
        const twin = { ...storyCardMemoryItem({ id: 'c-near', type: 'promise', text: 'An older wording of the vow.' }) };
        const legacy = { text: 'story: a row from before the stamp', category: 'story_promise' };
        const fact = { text: 'The light at Gannet Rock has gone dark.', category: 'world_fact' };
        BY_TEXT.set(near.text, alignedVector(1, 0.9));
        BY_TEXT.set(twin.text, alignedVector(2, 0.7));
        BY_TEXT.set(far.text, alignedVector(3, 0.2));
        BY_TEXT.set(legacy.text, alignedVector(4, 0.95));
        BY_TEXT.set(fact.text, alignedVector(5, 0.99));
        await addMemories('k', [near, far, twin, legacy, fact]);
        expect(near.cardId).toBe('c-near');
        const rows = await nearestStoryCards('k', 'why is the light dark', 5);
        expect(rows.map(row => row.cardId)).toEqual(['c-near', 'c-far']);
        expect(rows[0].score).toBeCloseTo(0.9, 5);
        expect(rows[0].text).toBe(near.text);
        expect(await nearestStoryCards('k', 'why is the light dark', 1)).toHaveLength(1);
        expect(await nearestStoryCards('', 'q')).toEqual([]);
        expect(await nearestStoryCards('k', '')).toEqual([]);
        expect(await nearestStoryCards('k', 'q', 0)).toEqual([]);
    });

    it('reuses the query vector the turn\'s retrieval memoized, and a failed query embed yields nothing', async () => {
        const near = storyCardMemoryItem({ id: 'c-near', type: 'promise', text: 'Row out to Gannet Rock before the gales.' });
        BY_TEXT.set(near.text, alignedVector(1, 0.9));
        await addMemories('k', [near]);
        embedTextMock.mockClear();
        await retrieveRelevant('k', 'the dark light', 3, 0.1);
        await nearestStoryCards('k', 'the dark light', 3);
        expect(embedTextMock.mock.calls.filter(([, text]) => text === 'the dark light')).toHaveLength(1);
        embedTextMock.mockImplementation(async (apiKey, text, options) => { if (text === 'another query') { options?.onError?.({ status: 429 }); return null; } return BY_TEXT.get(text) || unit; });
        expect(await nearestStoryCards('k', 'another query', 3)).toEqual([]);
    });

    it('the stamp survives the row typing and the persisted cache shape', async () => {
        const near = storyCardMemoryItem({ id: 'c-near', type: 'promise', text: 'Row out to Gannet Rock before the gales.' });
        BY_TEXT.set(near.text, alignedVector(1, 0.9));
        await addMemories('k', [{ ...near, cardId: `${'x'.repeat(100)}` }]);
        const rows = await nearestStoryCards('k', 'q', 3);
        expect(rows[0].cardId).toHaveLength(80);
    });
});
