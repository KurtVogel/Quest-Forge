/**
 * Strengthening queue 2026-10-25 (providers-adapter, Lap 1) — the Gemini lanes:
 * - the embed's `sendChunk` reads the 429 BODY's RetryInfo when the browser
 *   cannot read the `Retry-After` header, and the embed retry waits under the
 *   BACKGROUND cap (30 s), not the DM lane's 10 s;
 * - both chat lanes ride `v1beta` (probed live on gemini-3.8-flash with the
 *   app's own body shape: generateContent and streamGenerateContent?alt=sse
 *   both 200 with text; the chat lane had sat on `v1alpha` with no reason);
 * - the stream forwards the adapter's `onActivity` to the reader.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { embedTexts, GEMINI_EMBED_DIMENSIONS, sendGeminiMessage, streamGeminiMessage } from './gemini.js';
import { BACKGROUND_RETRY_AFTER_CAP_MS } from './sse.js';

const RETRY_INFO = 'type.googleapis.com/google.rpc.RetryInfo';

function quotaBody(retryDelay) {
    return JSON.stringify({
        error: {
            code: 429,
            message: `You exceeded your current quota. Please retry in ${retryDelay}.`,
            status: 'RESOURCE_EXHAUSTED',
            details: [{ '@type': RETRY_INFO, retryDelay }],
        },
    });
}

/** A 429 whose Retry-After header the browser cannot read (not CORS-exposed): headers.get → null. */
function rateLimited(retryDelay) {
    return {
        ok: false,
        status: 429,
        statusText: 'Too Many Requests',
        text: async () => quotaBody(retryDelay),
        headers: { get: () => null },
    };
}

function embeddingResponse(count = 1) {
    return {
        ok: true,
        status: 200,
        json: async () => ({ embeddings: Array.from({ length: count }, () => ({ values: Array.from({ length: GEMINI_EMBED_DIMENSIONS }, (_, i) => i / GEMINI_EMBED_DIMENSIONS) })) }),
    };
}

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

const sse = (payload) => `data: ${JSON.stringify(payload)}\n\n`;

const ARGS = { apiKey: 'test-key', model: 'gemini-3.8-flash', systemPrompt: 'You are the DM.', messageHistory: [], userMessage: 'I open the door.' };

describe('the embed lane reads the 429 body\'s delay and waits under the background cap', () => {
    afterEach(() => {
        vi.restoreAllMocks();
        vi.unstubAllGlobals();
        vi.useRealTimers();
    });

    it('a 429 with RetryInfo "20s" and no readable header waits 20 s (the old 10 s cap would have retried at 10)', async () => {
        vi.useFakeTimers();
        vi.spyOn(console, 'error').mockImplementation(() => {});
        vi.spyOn(console, 'warn').mockImplementation(() => {});
        const fetchMock = vi.fn()
            .mockResolvedValueOnce(rateLimited('20s'))
            .mockResolvedValueOnce(embeddingResponse());
        vi.stubGlobal('fetch', fetchMock);
        const promise = embedTexts('key', ['a seed row']); // the seed lane: no whole-call deadline
        await vi.advanceTimersByTimeAsync(10_500);
        expect(fetchMock).toHaveBeenCalledTimes(1);
        await vi.advanceTimersByTimeAsync(10_000);
        expect(fetchMock).toHaveBeenCalledTimes(2);
        const [vector] = await promise;
        expect(vector).toHaveLength(GEMINI_EMBED_DIMENSIONS);
    });

    it('a body delay past the background cap waits exactly BACKGROUND_RETRY_AFTER_CAP_MS (30 s), never the hard cap', async () => {
        vi.useFakeTimers();
        vi.spyOn(console, 'error').mockImplementation(() => {});
        vi.spyOn(console, 'warn').mockImplementation(() => {});
        const fetchMock = vi.fn()
            .mockResolvedValueOnce(rateLimited('45s'))
            .mockResolvedValueOnce(embeddingResponse());
        vi.stubGlobal('fetch', fetchMock);
        const promise = embedTexts('key', ['a seed row']);
        await vi.advanceTimersByTimeAsync(BACKGROUND_RETRY_AFTER_CAP_MS - 500);
        expect(fetchMock).toHaveBeenCalledTimes(1);
        await vi.advanceTimersByTimeAsync(1_000);
        expect(fetchMock).toHaveBeenCalledTimes(2);
        await promise;
    });

    it('the message-only form ("Please retry in 5s") is read when the body carries no RetryInfo detail', async () => {
        vi.useFakeTimers();
        vi.spyOn(console, 'error').mockImplementation(() => {});
        vi.spyOn(console, 'warn').mockImplementation(() => {});
        const fetchMock = vi.fn()
            .mockResolvedValueOnce({ ok: false, status: 429, statusText: 'Too Many Requests', headers: { get: () => null }, text: async () => JSON.stringify({ error: { message: 'Quota exceeded. Please retry in 5s.' } }) })
            .mockResolvedValueOnce(embeddingResponse());
        vi.stubGlobal('fetch', fetchMock);
        const promise = embedTexts('key', ['a seed row']);
        await vi.advanceTimersByTimeAsync(4_500);
        expect(fetchMock).toHaveBeenCalledTimes(1); // the 1 s default backoff would have retried by now
        await vi.advanceTimersByTimeAsync(1_000);
        expect(fetchMock).toHaveBeenCalledTimes(2);
        await promise;
    });
});

describe('the chat lane rides v1beta (2026-10-25 nit, probed live)', () => {
    afterEach(() => {
        vi.restoreAllMocks();
        vi.unstubAllGlobals();
    });

    it('generateContent and streamGenerateContent both POST to /v1beta/models/', async () => {
        const fetchMock = vi.fn()
            .mockResolvedValueOnce({ ok: true, json: async () => ({ candidates: [{ content: { parts: [{ text: 'Ok.' }] }, finishReason: 'STOP' }] }) })
            .mockResolvedValueOnce(streamResponse([sse({ candidates: [{ content: { parts: [{ text: 'Ok.' }] }, finishReason: 'STOP' }] })]));
        vi.stubGlobal('fetch', fetchMock);
        await sendGeminiMessage(ARGS);
        await streamGeminiMessage({ ...ARGS, onChunk: () => {} });
        expect(fetchMock.mock.calls[0][0]).toBe('https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent');
        expect(fetchMock.mock.calls[1][0]).toBe('https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:streamGenerateContent?alt=sse');
        for (const call of fetchMock.mock.calls) expect(call[0]).not.toContain('v1alpha');
    });
});

describe('streamGeminiMessage forwards onActivity to the reader (liveness is bytes, not text)', () => {
    afterEach(() => {
        vi.restoreAllMocks();
        vi.unstubAllGlobals();
    });

    it('a usageMetadata-only event and a thought-only event fire onActivity without any onChunk', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(streamResponse([
            sse({ usageMetadata: { promptTokenCount: 10 } }),
            sse({ candidates: [{ content: { parts: [{ thought: true, text: 'thinking…' }] } }] }),
            sse({ candidates: [{ content: { parts: [{ text: 'The door opens.' }] }, finishReason: 'STOP' }], usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 4 } }),
        ])));
        const onActivity = vi.fn();
        const onChunk = vi.fn();
        const text = await streamGeminiMessage({ ...ARGS, onChunk, onActivity });
        expect(text).toBe('The door opens.');
        expect(onActivity).toHaveBeenCalledTimes(3);
        expect(onChunk).toHaveBeenCalledTimes(1);
    });

    it('the stream works without onActivity (the arg is optional)', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(streamResponse([
            sse({ candidates: [{ content: { parts: [{ text: 'Ok.' }] }, finishReason: 'STOP' }] }),
        ])));
        await expect(streamGeminiMessage({ ...ARGS, onChunk: () => {} })).resolves.toBe('Ok.');
    });
});
