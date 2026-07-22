import { afterEach, describe, expect, it, vi } from 'vitest';
import { embedText, GEMINI_EMBED_DIMENSIONS, sendGeminiMessage, streamGeminiMessage } from './gemini.js';

function jsonResponse(payload, { ok = true, status = 200, statusText = 'OK' } = {}) {
    return { ok, status, statusText, json: async () => payload };
}

/** Response whose body yields the given strings as successive reader chunks. */
function streamResponse(chunks) {
    const encoder = new TextEncoder();
    const encoded = chunks.map((chunk) => encoder.encode(chunk));
    let index = 0;
    return {
        ok: true,
        body: {
            getReader: () => ({
                read: async () => (index < encoded.length
                    ? { done: false, value: encoded[index++] }
                    : { done: true, value: undefined }),
            }),
        },
    };
}

const SEND_ARGS = {
    apiKey: 'test-key',
    model: 'gemini-test',
    systemPrompt: 'You are the DM.',
    messageHistory: [{ role: 'user', content: 'Hello' }, { role: 'assistant', content: 'Well met.' }],
    userMessage: 'I open the door.',
};

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

describe('sendGeminiMessage', () => {
    afterEach(() => {
        vi.restoreAllMocks();
        vi.unstubAllGlobals();
    });

    it('concatenates every text part instead of reading only parts[0]', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({
            candidates: [{
                finishReason: 'STOP',
                content: {
                    parts: [
                        { text: 'The door creaks open. ' },
                        { text: '```json\n{"world_facts": []}\n```' },
                    ],
                },
            }],
        })));

        const text = await sendGeminiMessage(SEND_ARGS);

        expect(text).toBe('The door creaks open. ```json\n{"world_facts": []}\n```');
    });

    it('skips thought parts (reasoning summaries) while keeping response parts', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({
            candidates: [{
                finishReason: 'STOP',
                content: {
                    parts: [
                        { thought: true, text: 'The player likely wants to sneak.' },
                        { text: 'You slip inside unseen.' },
                    ],
                },
            }],
        })));

        await expect(sendGeminiMessage(SEND_ARGS)).resolves.toBe('You slip inside unseen.');
    });

    it('throws a retryable truncation error on MAX_TOKENS instead of returning a cut-off reply', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({
            candidates: [{ finishReason: 'MAX_TOKENS', content: { parts: [{ text: 'Half a rep' }] } }],
        })));

        await expect(sendGeminiMessage(SEND_ARGS)).rejects.toThrow(/MAX_TOKENS/);
    });

    it('throws on a non-STOP finish reason such as SAFETY', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({
            candidates: [{ finishReason: 'SAFETY', content: { parts: [{ text: 'Partial' }] } }],
        })));

        await expect(sendGeminiMessage(SEND_ARGS)).rejects.toThrow(/stopped early \(SAFETY\)/);
    });

    it('throws when the response carries no usable text', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ candidates: [] })));

        await expect(sendGeminiMessage(SEND_ARGS)).rejects.toThrow(/No response generated/);
    });

    it('stamps .status onto HTTP errors so the adapter can retry transient failures', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(
            { error: { message: 'The model is overloaded.' } },
            { ok: false, status: 503, statusText: 'Service Unavailable' },
        )));

        const error = await sendGeminiMessage(SEND_ARGS).catch((err) => err);

        expect(error.status).toBe(503);
        expect(error.message).toContain('Gemini API error (503)');
        expect(error.message).toContain('The model is overloaded.');
    });
});

describe('streamGeminiMessage', () => {
    afterEach(() => {
        vi.restoreAllMocks();
        vi.unstubAllGlobals();
    });

    function sseEvent(payload) {
        return `data: ${JSON.stringify(payload)}\n`;
    }

    it('reassembles SSE events split across reads and concatenates multi-part chunks', async () => {
        const first = sseEvent({ candidates: [{ content: { parts: [{ text: 'You step ' }] } }] });
        const second = sseEvent({
            candidates: [{
                finishReason: 'STOP',
                content: { parts: [{ thought: true, text: 'wrap up' }, { text: 'into the hall.' }, { text: ' ```json\n{}\n```' }] },
            }],
        });
        // Split the second event mid-line to exercise the incomplete-line buffer.
        const chunks = [first, second.slice(0, 18), second.slice(18), 'data: [DONE]\n', 'data: {malformed\n'];
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(streamResponse(chunks)));
        const onChunk = vi.fn();

        const fullText = await streamGeminiMessage({ ...SEND_ARGS, onChunk });

        expect(fullText).toBe('You step into the hall. ```json\n{}\n```');
        expect(onChunk.mock.calls.map(([chunk]) => chunk)).toEqual(['You step ', 'into the hall. ```json\n{}\n```']);
    });

    it('throws after the stream ends when the finish reason marks truncation', async () => {
        const chunks = [
            sseEvent({ candidates: [{ content: { parts: [{ text: 'The goblin sw' }] } }] }),
            sseEvent({ candidates: [{ finishReason: 'MAX_TOKENS', content: { parts: [] } }] }),
        ];
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(streamResponse(chunks)));

        await expect(streamGeminiMessage({ ...SEND_ARGS, onChunk: vi.fn() })).rejects.toThrow(/MAX_TOKENS/);
    });

    it('stamps .status onto streaming HTTP errors', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(
            { error: { message: 'Quota exceeded.' } },
            { ok: false, status: 429, statusText: 'Too Many Requests' },
        )));

        const error = await streamGeminiMessage({ ...SEND_ARGS, onChunk: vi.fn() }).catch((err) => err);

        expect(error.status).toBe(429);
        expect(error.message).toContain('Quota exceeded.');
    });
});
