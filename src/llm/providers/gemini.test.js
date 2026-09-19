import { afterEach, describe, expect, it, vi } from 'vitest';
import { embedText, embedTexts, GEMINI_EMBED_DIMENSIONS, MAX_EMBED_INPUT_CHARS, MAX_REJECTED_EMBED_REQUESTS, sendGeminiMessage, streamGeminiMessage } from './gemini.js';

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

describe('embedTexts — batchEmbedContents (2026-08-08 audit)', () => {
    afterEach(() => {
        vi.restoreAllMocks();
        vi.unstubAllGlobals();
    });

    const batchResponse = (count) => ({
        ok: true,
        json: async () => ({
            embeddings: Array.from({ length: count }, () => ({
                values: Array.from({ length: GEMINI_EMBED_DIMENSIONS }, (_, i) => i / GEMINI_EMBED_DIMENSIONS),
            })),
        }),
    });

    it('embeds many texts through one batch call with per-request document formatting', async () => {
        const fetchMock = vi.fn().mockResolvedValue(batchResponse(2));
        vi.stubGlobal('fetch', fetchMock);

        const vectors = await embedTexts('test-key', ['Kraul fell.', 'The gate is barred.']);

        expect(vectors).toHaveLength(2);
        expect(vectors[0]).toHaveLength(768);
        expect(fetchMock).toHaveBeenCalledOnce();
        const [url, options] = fetchMock.mock.calls[0];
        expect(url).toBe('https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-2:batchEmbedContents');
        const body = JSON.parse(options.body);
        expect(body.requests).toHaveLength(2);
        expect(body.requests[0]).toEqual({
            model: 'models/gemini-embedding-2',
            content: { parts: [{ text: 'title: none | text: Kraul fell.' }] },
            output_dimensionality: 768,
        });
    });

    it('chunks past the 100-request ceiling and nulls empty slots without sending them', async () => {
        const fetchMock = vi.fn()
            .mockResolvedValueOnce(batchResponse(100))
            .mockResolvedValueOnce(batchResponse(19));
        vi.stubGlobal('fetch', fetchMock);

        const texts = Array.from({ length: 120 }, (_, i) => (i === 5 ? '   ' : `Fact ${i}.`));
        const vectors = await embedTexts('test-key', texts);

        expect(fetchMock).toHaveBeenCalledTimes(2); // 119 sendable = 100 + 19
        expect(vectors).toHaveLength(120);
        expect(vectors[5]).toBeNull(); // the empty slot never reached the wire
        expect(vectors.filter(Boolean)).toHaveLength(119);
    });

    it('a failed batch nulls its chunk instead of throwing', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 500, statusText: 'boom', text: async () => 'err' }));
        const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

        const vectors = await embedTexts('test-key', ['One.', 'Two.']);

        expect(vectors).toEqual([null, null]);
        expect(errorSpy).toHaveBeenCalled();
        expect(await embedTexts('', ['One.'])).toEqual([null]);
        expect(await embedTexts('test-key', [])).toEqual([]);
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

    it('applies thinkingBudget and maxOutputTokens to generationConfig (machinery economics)', async () => {
        const fetchMock = vi.fn().mockResolvedValue(jsonResponse({
            candidates: [{ finishReason: 'STOP', content: { parts: [{ text: '{}' }] } }],
        }));
        vi.stubGlobal('fetch', fetchMock);

        await sendGeminiMessage({ ...SEND_ARGS, thinkingBudget: 0, maxOutputTokens: 8192 });

        const body = JSON.parse(fetchMock.mock.calls[0][1].body);
        expect(body.generationConfig.thinkingConfig).toEqual({ thinkingBudget: 0 });
        expect(body.generationConfig.maxOutputTokens).toBe(8192);
    });

    it('omits thinkingConfig and keeps the default output cap when not requested (DM path)', async () => {
        const fetchMock = vi.fn().mockResolvedValue(jsonResponse({
            candidates: [{ finishReason: 'STOP', content: { parts: [{ text: 'ok' }] } }],
        }));
        vi.stubGlobal('fetch', fetchMock);

        await sendGeminiMessage(SEND_ARGS);

        const body = JSON.parse(fetchMock.mock.calls[0][1].body);
        expect(body.generationConfig).not.toHaveProperty('thinkingConfig');
        expect(body.generationConfig.maxOutputTokens).toBe(32768);
    });

    it('threads the abort signal into fetch so the adapter stall guard can cancel it', async () => {
        const fetchMock = vi.fn().mockResolvedValue(jsonResponse({
            candidates: [{ finishReason: 'STOP', content: { parts: [{ text: 'ok' }] } }],
        }));
        vi.stubGlobal('fetch', fetchMock);
        const controller = new AbortController();

        await sendGeminiMessage({ ...SEND_ARGS, signal: controller.signal });

        expect(fetchMock.mock.calls[0][1].signal).toBe(controller.signal);
    });

    it('declares the app content policy via safetySettings on every request (2026-08-28)', () => {
        // Without this, Google's DEFAULT thresholds silently governed every DM
        // turn and machinery call — the journal-summarizer safety blocks and
        // part of the live refusal cascade. CIVIC_INTEGRITY deliberately absent.
        const fetchMock = vi.fn().mockResolvedValue(jsonResponse({
            candidates: [{ finishReason: 'STOP', content: { parts: [{ text: 'ok' }] } }],
        }));
        vi.stubGlobal('fetch', fetchMock);

        return sendGeminiMessage(SEND_ARGS).then(() => {
            const body = JSON.parse(fetchMock.mock.calls[0][1].body);
            expect(body.safetySettings).toEqual([
                { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_NONE' },
                { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_NONE' },
                { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_NONE' },
                { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_NONE' },
            ]);
            expect(body.safetySettings.some(s => s.category === 'HARM_CATEGORY_CIVIC_INTEGRITY')).toBe(false);
        });
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

    it('carries the same safetySettings on the streaming path', async () => {
        const chunks = [
            sseEvent({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: 'ok' }] } }] }),
        ];
        const fetchMock = vi.fn().mockResolvedValue(streamResponse(chunks));
        vi.stubGlobal('fetch', fetchMock);

        await streamGeminiMessage({ ...SEND_ARGS, onChunk: vi.fn() });

        const body = JSON.parse(fetchMock.mock.calls[0][1].body);
        expect(body.safetySettings.map(s => s.threshold)).toEqual(['BLOCK_NONE', 'BLOCK_NONE', 'BLOCK_NONE', 'BLOCK_NONE']);
    });

    it('throws after the stream ends when the finish reason marks truncation', async () => {
        const chunks = [
            sseEvent({ candidates: [{ content: { parts: [{ text: 'The goblin sw' }] } }] }),
            sseEvent({ candidates: [{ finishReason: 'MAX_TOKENS', content: { parts: [] } }] }),
        ];
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(streamResponse(chunks)));

        await expect(streamGeminiMessage({ ...SEND_ARGS, onChunk: vi.fn() })).rejects.toThrow(/MAX_TOKENS/);
    });

    it('surfaces an in-band error event with its real message instead of "connection dropped"', async () => {
        const chunks = [
            sseEvent({ candidates: [{ content: { parts: [{ text: 'You step ' }] } }] }),
            sseEvent({ error: { code: 429, message: 'Resource has been exhausted (e.g. check quota).', status: 'RESOURCE_EXHAUSTED' } }),
        ];
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(streamResponse(chunks)));

        const failure = streamGeminiMessage({ ...SEND_ARGS, onChunk: vi.fn() });
        await expect(failure).rejects.toThrow(/Resource has been exhausted/);
        await failure.catch(err => expect(err.status).toBe(429));
    });

    it('throws when the stream closes cleanly without ever delivering a finish reason', async () => {
        // A dropped connection / proxy close ends the SSE body early with done=true;
        // the partial text must not be returned as a complete DM turn.
        const chunks = [
            sseEvent({ candidates: [{ content: { parts: [{ text: 'You step into' }] } }] }),
        ];
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(streamResponse(chunks)));

        await expect(streamGeminiMessage({ ...SEND_ARGS, onChunk: vi.fn() })).rejects.toThrow(/connection dropped/);
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

describe('prompt-level blocks and history shape (2026-09-06 audit)', () => {
    afterEach(() => {
        vi.restoreAllMocks();
        vi.unstubAllGlobals();
    });

    it('P1: a non-streaming promptFeedback block names the reason and the edit/remove remedy', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({
            promptFeedback: { blockReason: 'PROHIBITED_CONTENT' },
        })));
        const err = await sendGeminiMessage(SEND_ARGS).catch(e => e);
        expect(err.message).toMatch(/blocked the prompt \(PROHIBITED_CONTENT\)/);
        expect(err.message).toMatch(/Edit or remove/);
        expect(err.message).not.toMatch(/No response generated/);
    });

    it('P1: a streamed promptFeedback block is named, never "connection dropped"', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(streamResponse([
            'data: {"promptFeedback":{"blockReason":"PROHIBITED_CONTENT","blockReasonMessage":"Content violates policy."}}\n\n',
        ])));
        const err = await streamGeminiMessage({ ...SEND_ARGS, onChunk: () => {} }).catch(e => e);
        expect(err.message).toMatch(/blocked the prompt \(PROHIBITED_CONTENT: Content violates policy\.\)/);
        expect(err.message).not.toMatch(/connection dropped/);
    });

    it('a candidate beside promptFeedback still wins (block only applies when nothing was generated)', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({
            promptFeedback: { safetyRatings: [] },
            candidates: [{ finishReason: 'STOP', content: { parts: [{ text: 'Fine.' }] } }],
        })));
        await expect(sendGeminiMessage(SEND_ARGS)).resolves.toBe('Fine.');
    });

    it('a stray system-role history line rides as a user part and null content becomes ""', async () => {
        const fetchMock = vi.fn().mockResolvedValue(jsonResponse({
            candidates: [{ finishReason: 'STOP', content: { parts: [{ text: 'ok' }] } }],
        }));
        vi.stubGlobal('fetch', fetchMock);
        await sendGeminiMessage({ ...SEND_ARGS, messageHistory: [{ role: 'system', content: 'You rolled **12**.' }, { role: 'assistant', content: null }] });
        const body = JSON.parse(fetchMock.mock.calls[0][1].body);
        expect(body.contents.slice(0, 2)).toEqual([
            { role: 'user', parts: [{ text: 'You rolled **12**.' }] },
            { role: 'model', parts: [{ text: '' }] },
        ]);
    });
});

describe('hostile bodies (2026-09-16 providers-adapter P2)', () => {
    afterEach(() => {
        vi.restoreAllMocks();
        vi.unstubAllGlobals();
    });

    it('a 200 with a null body is "No response generated", not a TypeError at .candidates', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(null)));
        await expect(sendGeminiMessage(SEND_ARGS)).rejects.toThrow('No response generated');
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse([1, 2])));
        await expect(sendGeminiMessage(SEND_ARGS)).rejects.toThrow('No response generated');
    });

    it('embedText rejects a vector of the right LENGTH whose elements are not finite numbers', async () => {
        vi.spyOn(console, 'error').mockImplementation(() => {});
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ embedding: { values: Array.from({ length: GEMINI_EMBED_DIMENSIONS }, () => 'x') } }) }));
        expect(await embedText('test-key', 'Strings are not a vector.')).toBeNull();
        const withNaN = Array.from({ length: GEMINI_EMBED_DIMENSIONS }, (_, i) => i / 1000);
        withNaN[3] = NaN;
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ embedding: { values: withNaN } }) }));
        expect(await embedText('test-key', 'One NaN poisons cosine.')).toBeNull();
    });

    it('embedTexts nulls the slot whose batch vector carries non-numeric elements and keeps the clean one', async () => {
        const clean = Array.from({ length: GEMINI_EMBED_DIMENSIONS }, (_, i) => i / 1000);
        const junk = Array.from({ length: GEMINI_EMBED_DIMENSIONS }, () => '0.1');
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ embeddings: [{ values: clean }, { values: junk }] }) }));
        const vectors = await embedTexts('test-key', ['Clean.', 'Strings.']);
        expect(vectors[0]).toHaveLength(GEMINI_EMBED_DIMENSIONS);
        expect(vectors[1]).toBeNull();
    });
});

describe('embed input cap + rejected-chunk bisect (2026-09-17 vector-memory P1)', () => {
    afterEach(() => {
        vi.restoreAllMocks();
        vi.unstubAllGlobals();
    });

    const vector = () => Array.from({ length: GEMINI_EMBED_DIMENSIONS }, (_, i) => i / GEMINI_EMBED_DIMENSIONS);
    const BAD = '[[REJECTED]]';
    /** A fetch that 400s any request body carrying the BAD sentinel and embeds the rest. */
    const rejectingFetch = () => vi.fn(async (_url, options) => {
        const body = JSON.parse(options.body);
        const requests = body.requests || [body];
        if (requests.some(r => r.content.parts[0].text.includes(BAD))) {
            return { ok: false, status: 400, statusText: 'Bad Request', text: async () => 'invalid input' };
        }
        return { ok: true, json: async () => ({ embeddings: requests.map(() => ({ values: vector() })) }) };
    });

    it('truncates the WIRE text to MAX_EMBED_INPUT_CHARS on both the single and the batch path', async () => {
        const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ embedding: { values: vector() }, embeddings: [{ values: vector() }] }) });
        vi.stubGlobal('fetch', fetchMock);
        const huge = 'x'.repeat(MAX_EMBED_INPUT_CHARS * 3);

        await embedText('test-key', huge);
        await embedTexts('test-key', [huge]);

        const single = JSON.parse(fetchMock.mock.calls[0][1].body).content.parts[0].text;
        const batched = JSON.parse(fetchMock.mock.calls[1][1].body).requests[0].content.parts[0].text;
        expect(single).toHaveLength('title: none | text: '.length + MAX_EMBED_INPUT_CHARS);
        expect(batched).toHaveLength('title: none | text: '.length + MAX_EMBED_INPUT_CHARS);
    });

    it('one rejected text among 120 costs ONE row: its 99 chunk-mates still embed, and the second chunk is untouched', async () => {
        const fetchMock = rejectingFetch();
        vi.stubGlobal('fetch', fetchMock);
        vi.spyOn(console, 'error').mockImplementation(() => {});

        const texts = Array.from({ length: 120 }, (_, i) => (i === 10 ? `Journal ${BAD} entry.` : `Fact ${i}.`));
        const vectors = await embedTexts('test-key', texts);

        expect(vectors[10]).toBeNull();
        expect(vectors.filter(Boolean)).toHaveLength(119);
        // 1 first attempt + ~8 rejections along the bisect + the healthy halves + the second chunk.
        expect(fetchMock.mock.calls.length).toBeLessThan(25);
    });

    it('a key-level 400 (every request rejected) stays within the rejected-request budget instead of fanning out per text', async () => {
        const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 400, statusText: 'API key not valid', text: async () => 'bad key' });
        vi.stubGlobal('fetch', fetchMock);
        vi.spyOn(console, 'error').mockImplementation(() => {});

        const vectors = await embedTexts('test-key', Array.from({ length: 100 }, (_, i) => `Fact ${i}.`));

        expect(vectors.every(v => v === null)).toBe(true);
        expect(fetchMock.mock.calls.length).toBeLessThanOrEqual(MAX_REJECTED_EMBED_REQUESTS + 1);
    });

    it('a transient failure (429 / 5xx / network) still nulls the chunk WITHOUT bisecting - a retry per item would only amplify it', async () => {
        const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 429, statusText: 'Too Many Requests', text: async () => 'slow down' });
        vi.stubGlobal('fetch', fetchMock);
        vi.spyOn(console, 'error').mockImplementation(() => {});

        const vectors = await embedTexts('test-key', Array.from({ length: 50 }, (_, i) => `Fact ${i}.`));

        expect(vectors.every(v => v === null)).toBe(true);
        expect(fetchMock).toHaveBeenCalledTimes(1);

        fetchMock.mockRejectedValue(new Error('network down'));
        expect(await embedTexts('test-key', ['a', 'b'])).toEqual([null, null]);
        expect(fetchMock).toHaveBeenCalledTimes(2);
    });
});

describe('embedText onError (2026-09-19 — the memory-less turn names its cause)', () => {
    afterEach(() => {
        vi.restoreAllMocks();
        vi.unstubAllGlobals();
    });

    it('reports the HTTP status and the API error message of a rejected key', async () => {
        vi.spyOn(console, 'error').mockImplementation(() => {});
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
            ok: false,
            status: 400,
            statusText: 'Bad Request',
            text: async () => JSON.stringify({ error: { code: 400, message: 'API key not valid. Please pass a valid API key.', status: 'INVALID_ARGUMENT' } }),
        }));
        const onError = vi.fn();
        expect(await embedText('sk-not-a-gemini-key', 'Who holds the bridge?', { inputType: 'query', onError })).toBeNull();
        expect(onError).toHaveBeenCalledTimes(1);
        expect(onError).toHaveBeenCalledWith({ status: 400, message: 'API key not valid. Please pass a valid API key.', timedOut: false });
    });

    it('falls back to the status text when the error body is not JSON, and clamps a long message', async () => {
        vi.spyOn(console, 'error').mockImplementation(() => {});
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 503, statusText: 'Service Unavailable', text: async () => '<html>oops</html>' }));
        const onError = vi.fn();
        await embedText('test-key', 'anything', { onError });
        expect(onError).toHaveBeenCalledWith({ status: 503, message: 'Service Unavailable', timedOut: false });

        const long = 'x'.repeat(1000);
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 429, statusText: 'Too Many Requests', text: async () => JSON.stringify({ error: { message: long } }) }));
        await embedText('test-key', 'anything', { onError });
        expect(onError).toHaveBeenLastCalledWith({ status: 429, message: 'x'.repeat(300), timedOut: false });
    });

    it('marks the stall guard as timedOut and a network failure as status null', async () => {
        vi.spyOn(console, 'error').mockImplementation(() => {});
        const timeout = new Error('The operation was aborted due to timeout');
        timeout.name = 'TimeoutError';
        vi.stubGlobal('fetch', vi.fn().mockRejectedValue(timeout));
        const onError = vi.fn();
        expect(await embedText('test-key', 'anything', { onError })).toBeNull();
        expect(onError).toHaveBeenCalledWith({ status: null, message: 'The operation was aborted due to timeout', timedOut: true });

        vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
        await embedText('test-key', 'anything', { onError });
        expect(onError).toHaveBeenLastCalledWith({ status: null, message: 'Failed to fetch', timedOut: false });
    });

    it('reports a malformed vector, ignores a throwing callback, and never calls it on success or an empty input', async () => {
        vi.spyOn(console, 'error').mockImplementation(() => {});
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ embedding: { values: [1, 2, 3] } }) }));
        const onError = vi.fn(() => { throw new Error('ui'); });
        await expect(embedText('test-key', 'anything', { onError })).resolves.toBeNull();
        expect(onError).toHaveBeenCalledTimes(1);
        expect(onError.mock.calls[0][0]).toMatchObject({ status: 200, timedOut: false });

        const quiet = vi.fn();
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(embeddingResponse()));
        expect(await embedText('test-key', 'anything', { onError: quiet })).toHaveLength(GEMINI_EMBED_DIMENSIONS);
        expect(await embedText('', 'anything', { onError: quiet })).toBeNull();
        expect(await embedText('test-key', '   ', { onError: quiet })).toBeNull();
        expect(quiet).not.toHaveBeenCalled();
    });
});
