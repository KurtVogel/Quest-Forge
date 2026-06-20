import { beforeEach, describe, expect, it, vi } from 'vitest';

const { embedTextMock } = vi.hoisted(() => ({ embedTextMock: vi.fn() }));

vi.mock('../llm/providers/gemini.js', () => ({
    embedText: embedTextMock,
    GEMINI_EMBED_DIMENSIONS: 768,
    GEMINI_EMBED_SCHEMA: 'gemini-embedding-2:search-retrieval-v1:768',
}));

import { addMemory, clearMemories, retrieveRelevant } from './vectorMemory.js';

describe('VectorMemory embedding roles', () => {
    beforeEach(() => {
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
            score: 1,
        })]);
    });
});
