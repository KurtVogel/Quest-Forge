import { afterEach, describe, expect, it, vi } from 'vitest';
import { embedText, GEMINI_EMBED_DIMENSIONS } from './gemini.js';

function embeddingResponse(length = GEMINI_EMBED_DIMENSIONS) {
    return {
        ok: true,
        json: async () => ({ embedding: { values: Array.from({ length }, (_, i) => i / length) } }),
    };
}

describe('Gemini embedding provider', () => {
    afterEach(() => {
        vi.restoreAllMocks();
        vi.unstubAllGlobals();
    });

    it('uses gemini-embedding-2 with the documented retrieval-document format', async () => {
        const fetchMock = vi.fn().mockResolvedValue(embeddingResponse());
        vi.stubGlobal('fetch', fetchMock);

        const vector = await embedText('test-key', 'Kraul fell in the cavern.');

        expect(vector).toHaveLength(768);
        expect(fetchMock).toHaveBeenCalledOnce();
        const [url, options] = fetchMock.mock.calls[0];
        expect(url).toBe('https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-2:embedContent');
        expect(options.headers['x-goog-api-key']).toBe('test-key');
        expect(JSON.parse(options.body)).toEqual({
            model: 'models/gemini-embedding-2',
            content: { parts: [{ text: 'title: none | text: Kraul fell in the cavern.' }] },
            output_dimensionality: 768,
        });
    });

    it('uses the documented asymmetric search-query format for retrieval queries', async () => {
        const fetchMock = vi.fn().mockResolvedValue(embeddingResponse());
        vi.stubGlobal('fetch', fetchMock);

        await embedText('test-key', 'Who ruled the cavern?', { inputType: 'query' });

        const body = JSON.parse(fetchMock.mock.calls[0][1].body);
        expect(body.content.parts[0].text).toBe('task: search result | query: Who ruled the cavern?');
    });

    it('rejects a response with an unexpected vector size instead of caching it', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(embeddingResponse(3)));
        const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

        const vector = await embedText('test-key', 'A malformed vector.');

        expect(vector).toBeNull();
        expect(errorSpy).toHaveBeenCalledWith(
            expect.stringContaining('Expected 768 values from gemini-embedding-2'),
            expect.any(Object),
        );
    });
});
