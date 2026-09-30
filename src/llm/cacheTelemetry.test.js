/**
 * Cache telemetry (memory-research Adoption Queue M2, built 2026-09-30):
 * every DM provider reports its prompt / cached-token counts into the
 * Memory Inspector through the adapter's `onUsage`, xAI requests carry the
 * per-server affinity header with a one-time preflight fallback, and the
 * reply itself stays a string on every lane.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { normalizeOpenAIUsage } from './providers/openaiCompatible.js';
import { normalizeGeminiUsage, sendGeminiMessage, streamGeminiMessage } from './providers/gemini.js';
import { sendXaiMessage, streamXaiMessage } from './providers/xai.js';
import { streamOpenAIMessage } from './providers/openai.js';
import { sendMessage, streamMessage } from './adapter.js';
import { captureUsage, captureProviderNote, getInspectorSnapshot, resetInspector, USAGE_HISTORY_CAP } from '../debug/memoryInspectorStore.js';

function jsonResponse(payload, { ok = true, status = 200, statusText = 'OK' } = {}) {
    return { ok, status, statusText, json: async () => payload };
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
const ARGS = { apiKey: 'sk-test', model: 'test-model', systemPrompt: 'You are the DM.', messageHistory: [], userMessage: 'I open the door.' };

describe('usage normalizers — one adapter shape from each provider family', () => {
    it('OpenAI-compatible: prompt_tokens + prompt_tokens_details.cached_tokens + completion_tokens; missing cache reads 0; junk reads null', () => {
        expect(normalizeOpenAIUsage({ prompt_tokens: 12000, prompt_tokens_details: { cached_tokens: 9000 }, completion_tokens: 300 }))
            .toEqual({ promptTokens: 12000, cachedTokens: 9000, outputTokens: 300 });
        expect(normalizeOpenAIUsage({ prompt_tokens: 500 })).toEqual({ promptTokens: 500, cachedTokens: 0, outputTokens: null });
        expect(normalizeOpenAIUsage({ prompt_tokens: '500' })).toBeNull();
        expect(normalizeOpenAIUsage(null)).toBeNull();
        expect(normalizeOpenAIUsage('usage')).toBeNull();
    });

    it('Gemini: promptTokenCount + cachedContentTokenCount + candidatesTokenCount (+ thoughtsTokenCount)', () => {
        expect(normalizeGeminiUsage({ promptTokenCount: 40000, cachedContentTokenCount: 31000, candidatesTokenCount: 420, thoughtsTokenCount: 800 }))
            .toEqual({ promptTokens: 40000, cachedTokens: 31000, outputTokens: 420, thoughtTokens: 800 });
        expect(normalizeGeminiUsage({ promptTokenCount: 40000 })).toEqual({ promptTokens: 40000, cachedTokens: 0, outputTokens: null, thoughtTokens: null });
        expect(normalizeGeminiUsage({})).toBeNull();
    });
});

describe('providers report usage through onUsage and keep returning the text', () => {
    afterEach(() => {
        vi.restoreAllMocks();
        vi.unstubAllGlobals();
    });

    it('Gemini stream: the LAST chunk\'s usageMetadata wins; the reply is still the joined text', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(streamResponse([
            sse({ candidates: [{ content: { parts: [{ text: 'The door ' }] } }], usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 2 } }),
            sse({ candidates: [{ content: { parts: [{ text: 'creaks.' }] }, finishReason: 'STOP' }], usageMetadata: { promptTokenCount: 100, cachedContentTokenCount: 80, candidatesTokenCount: 5 } }),
        ])));
        const onUsage = vi.fn();
        const chunks = [];
        const text = await streamGeminiMessage({ ...ARGS, onChunk: (c) => chunks.push(c), onUsage });
        expect(text).toBe('The door creaks.');
        expect(chunks).toEqual(['The door ', 'creaks.']);
        expect(onUsage).toHaveBeenCalledTimes(1);
        expect(onUsage).toHaveBeenCalledWith({ promptTokens: 100, cachedTokens: 80, outputTokens: 5, thoughtTokens: null });
    });

    it('Gemini send: usageMetadata on the body', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({
            candidates: [{ content: { parts: [{ text: 'Done.' }] }, finishReason: 'STOP' }],
            usageMetadata: { promptTokenCount: 5000, cachedContentTokenCount: 4096, candidatesTokenCount: 40 },
        })));
        const onUsage = vi.fn();
        expect(await sendGeminiMessage({ ...ARGS, onUsage })).toBe('Done.');
        expect(onUsage).toHaveBeenCalledWith({ promptTokens: 5000, cachedTokens: 4096, outputTokens: 40, thoughtTokens: null });
    });

    it('OpenAI stream asks for usage (stream_options.include_usage) and reads the final usage-only chunk', async () => {
        const fetchMock = vi.fn().mockResolvedValue(streamResponse([
            sse({ choices: [{ delta: { content: 'The door creaks.' } }] }),
            sse({ choices: [{ delta: {}, finish_reason: 'stop' }] }),
            sse({ choices: [], usage: { prompt_tokens: 12000, prompt_tokens_details: { cached_tokens: 6000 }, completion_tokens: 30 } }),
            'data: [DONE]\n\n',
        ]));
        vi.stubGlobal('fetch', fetchMock);
        const onUsage = vi.fn();
        const text = await streamOpenAIMessage({ ...ARGS, onChunk: () => {}, onUsage });
        expect(text).toBe('The door creaks.');
        const body = JSON.parse(fetchMock.mock.calls[0][1].body);
        expect(body.stream_options).toEqual({ include_usage: true });
        expect(onUsage).toHaveBeenCalledWith({ promptTokens: 12000, cachedTokens: 6000, outputTokens: 30 });
    });

    it('xAI stream does NOT send stream_options (usage rides the final chunk unasked) and still reports it', async () => {
        const fetchMock = vi.fn().mockResolvedValue(streamResponse([
            sse({ choices: [{ delta: { content: 'Creak.' }, finish_reason: 'stop' }], usage: { prompt_tokens: 900, prompt_tokens_details: { cached_tokens: 700 }, completion_tokens: 3 } }),
            'data: [DONE]\n\n',
        ]));
        vi.stubGlobal('fetch', fetchMock);
        const onUsage = vi.fn();
        expect(await streamXaiMessage({ ...ARGS, apiKey: 'xai-test', onChunk: () => {}, onUsage })).toBe('Creak.');
        expect(JSON.parse(fetchMock.mock.calls[0][1].body).stream_options).toBeUndefined();
        expect(onUsage).toHaveBeenCalledWith({ promptTokens: 900, cachedTokens: 700, outputTokens: 3 });
    });

    it('a throwing onUsage is the caller\'s problem, never a failed reply', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({
            choices: [{ finish_reason: 'stop', message: { content: 'Fine.' } }],
            usage: { prompt_tokens: 10, completion_tokens: 1 },
        })));
        await expect(sendXaiMessage({ ...ARGS, apiKey: 'xai-test', onUsage: () => { throw new Error('boom'); } })).rejects.toThrow('boom');
        // (the provider does not swallow it — the adapter callers pass a
        // capture that cannot throw; this pins that the text was produced first)
    });
});

describe('xAI affinity header — x-grok-conv-id with a one-time preflight fallback', () => {
    afterEach(() => {
        vi.restoreAllMocks();
        vi.unstubAllGlobals();
    });

    it('sends x-grok-conv-id = conversationId on the request', async () => {
        const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ choices: [{ finish_reason: 'stop', message: { content: 'Ok.' } }] }));
        vi.stubGlobal('fetch', fetchMock);
        await sendXaiMessage({ ...ARGS, apiKey: 'xai-test', conversationId: 'session-abc' });
        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(fetchMock.mock.calls[0][1].headers['x-grok-conv-id']).toBe('session-abc');
    });

    it('omits the header without a conversationId', async () => {
        const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ choices: [{ finish_reason: 'stop', message: { content: 'Ok.' } }] }));
        vi.stubGlobal('fetch', fetchMock);
        await sendXaiMessage({ ...ARGS, apiKey: 'xai-test' });
        expect(fetchMock.mock.calls[0][1].headers['x-grok-conv-id']).toBeUndefined();
    });

    it('a preflight refusal (network TypeError before any byte) resends ONCE without the header and reports the header names', async () => {
        const fetchMock = vi.fn()
            .mockRejectedValueOnce(new TypeError('Failed to fetch'))
            .mockResolvedValueOnce(jsonResponse({ choices: [{ finish_reason: 'stop', message: { content: 'Ok.' } }] }));
        vi.stubGlobal('fetch', fetchMock);
        const onHeaderRejected = vi.fn();
        expect(await sendXaiMessage({ ...ARGS, apiKey: 'xai-test', conversationId: 'session-abc', onHeaderRejected })).toBe('Ok.');
        expect(fetchMock).toHaveBeenCalledTimes(2);
        expect(fetchMock.mock.calls[0][1].headers['x-grok-conv-id']).toBe('session-abc');
        expect(fetchMock.mock.calls[1][1].headers['x-grok-conv-id']).toBeUndefined();
        expect(onHeaderRejected).toHaveBeenCalledWith(['x-grok-conv-id']);
    });

    it('a second network failure without the header is rethrown as it is; a caller abort never retries', async () => {
        vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
        await expect(sendXaiMessage({ ...ARGS, apiKey: 'xai-test', conversationId: 's' })).rejects.toThrow('Failed to fetch');
        const controller = new AbortController();
        controller.abort();
        const fetchMock = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'));
        vi.stubGlobal('fetch', fetchMock);
        await expect(sendXaiMessage({ ...ARGS, apiKey: 'xai-test', conversationId: 's', signal: controller.signal })).rejects.toThrow();
        expect(fetchMock).toHaveBeenCalledTimes(1);
    });
});

describe('adapter pass-through', () => {
    afterEach(() => {
        vi.restoreAllMocks();
        vi.unstubAllGlobals();
    });

    it('sendMessage and streamMessage forward onUsage / conversationId / onHeaderRejected to the provider', async () => {
        const fetchMock = vi.fn()
            .mockResolvedValueOnce(jsonResponse({ choices: [{ finish_reason: 'stop', message: { content: 'Ok.' } }], usage: { prompt_tokens: 10, completion_tokens: 1 } }))
            .mockResolvedValueOnce(streamResponse([
                sse({ choices: [{ delta: { content: 'Ok.' }, finish_reason: 'stop' }], usage: { prompt_tokens: 20, prompt_tokens_details: { cached_tokens: 15 }, completion_tokens: 1 } }),
                'data: [DONE]\n\n',
            ]));
        vi.stubGlobal('fetch', fetchMock);
        const onUsage = vi.fn();
        await sendMessage({ provider: 'xai', apiKey: 'xai-test', model: 'grok', systemPrompt: 's', messageHistory: [], userMessage: 'u', onUsage, conversationId: 'conv-1', maxRetries: 0 });
        await streamMessage({ provider: 'xai', apiKey: 'xai-test', model: 'grok', systemPrompt: 's', messageHistory: [], userMessage: 'u', onChunk: () => {}, onUsage, conversationId: 'conv-1' });
        expect(onUsage.mock.calls.map(c => c[0])).toEqual([
            { promptTokens: 10, cachedTokens: 0, outputTokens: 1 },
            { promptTokens: 20, cachedTokens: 15, outputTokens: 1 },
        ]);
        for (const call of fetchMock.mock.calls) expect(call[1].headers['x-grok-conv-id']).toBe('conv-1');
    });
});

describe('inspector capture — captureUsage / captureProviderNote', () => {
    beforeEach(() => resetInspector());

    it('records the row with cachedShare and keeps a capped history, newest last', () => {
        captureUsage({ lane: 'dm', mode: 'standard', provider: 'gemini', model: 'gemini-3.1-pro-preview', promptTokens: 40000, cachedTokens: 30000, outputTokens: 400, promptChars: 130000 });
        const { lastUsage, usageHistory } = getInspectorSnapshot();
        expect(lastUsage).toMatchObject({ lane: 'dm', mode: 'standard', provider: 'gemini', promptTokens: 40000, cachedTokens: 30000, outputTokens: 400, cachedShare: 0.75, promptChars: 130000 });
        expect(usageHistory).toHaveLength(1);
        for (let i = 0; i < USAGE_HISTORY_CAP + 5; i++) captureUsage({ promptTokens: 100 + i, cachedTokens: 0 });
        expect(getInspectorSnapshot().usageHistory).toHaveLength(USAGE_HISTORY_CAP);
        expect(getInspectorSnapshot().usageHistory.at(-1).promptTokens).toBe(100 + USAGE_HISTORY_CAP + 4);
    });

    it('a row without counts has null share; junk counts read null', () => {
        captureUsage({ promptTokens: 'lots', cachedTokens: NaN });
        expect(getInspectorSnapshot().lastUsage).toMatchObject({ promptTokens: null, cachedTokens: null, cachedShare: null });
    });

    it('provider notes dedupe by text and cap at 8', () => {
        captureProviderNote('xai refused the x-grok-conv-id header');
        captureProviderNote('xai refused the x-grok-conv-id header');
        expect(getInspectorSnapshot().providerNotes).toEqual(['xai refused the x-grok-conv-id header']);
        for (let i = 0; i < 10; i++) captureProviderNote(`note ${i}`);
        expect(getInspectorSnapshot().providerNotes).toHaveLength(8);
        captureProviderNote('');
        expect(getInspectorSnapshot().providerNotes).toHaveLength(8);
    });
});
