/**
 * Strengthening queue 2026-10-25 (providers-adapter, Lap 1) — the compat
 * factory's two rows:
 * - the xAI affinity header's fallback is JUDGED by the plain re-send and
 *   REMEMBERED for the session: an OFFLINE call used to be sent twice per
 *   attempt with a false "refused the header" inspector note, and a genuine
 *   refusal was never remembered (CLAUDE / AGENTS said "ONE-time");
 * - the stream forwards the adapter's `onActivity` to the reader.
 * Built on a fresh factory instance per test, so the remembered flag never
 * leaks between tests (xai.js's singleton is pinned in cacheTelemetry.test.js).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { makeOpenAICompatProvider } from './openaiCompatible.js';

function jsonResponse(payload, { ok = true, status = 200, statusText = 'OK' } = {}) {
    return { ok, status, statusText, json: async () => payload, headers: { get: () => null } };
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
const OK = () => jsonResponse({ choices: [{ finish_reason: 'stop', message: { content: 'Ok.' } }] });
const ARGS = { apiKey: 'xai-test', model: 'grok-4.3', systemPrompt: 'You are the DM.', messageHistory: [], userMessage: 'I open the door.', conversationId: 'session-abc' };

/** The xai.js wiring on a fresh instance. */
function makeAffinityProvider() {
    return makeOpenAICompatProvider({
        label: 'xAI',
        baseUrl: 'https://api.x.ai/v1/chat/completions',
        extraHeaders: ({ conversationId }) => (typeof conversationId === 'string' && conversationId ? { 'x-grok-conv-id': conversationId } : {}),
    });
}

const headerOf = (fetchMock, call) => fetchMock.mock.calls[call][1].headers['x-grok-conv-id'];

describe('the affinity header\'s fallback is judged by the plain re-send', () => {
    afterEach(() => {
        vi.restoreAllMocks();
        vi.unstubAllGlobals();
    });

    it('OFFLINE: the plain send fails the same way → the ORIGINAL error is rethrown, two fetches, NO note, nothing remembered', async () => {
        const { send } = makeAffinityProvider();
        const fetchMock = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'));
        vi.stubGlobal('fetch', fetchMock);
        const onHeaderRejected = vi.fn();
        await expect(send({ ...ARGS, onHeaderRejected })).rejects.toThrow('Failed to fetch');
        expect(fetchMock).toHaveBeenCalledTimes(2);
        expect(headerOf(fetchMock, 0)).toBe('session-abc');
        expect(headerOf(fetchMock, 1)).toBeUndefined();
        expect(onHeaderRejected).not.toHaveBeenCalled();
        // Back online: the header is still sent — an outage proved nothing.
        fetchMock.mockReset().mockResolvedValue(OK());
        expect(await send({ ...ARGS, onHeaderRejected })).toBe('Ok.');
        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(headerOf(fetchMock, 0)).toBe('session-abc');
        expect(onHeaderRejected).not.toHaveBeenCalled();
    });

    it('REFUSED: the plain send gets a response → the note once, and every later call is ONE fetch without the header', async () => {
        const { send, stream } = makeAffinityProvider();
        const fetchMock = vi.fn()
            .mockRejectedValueOnce(new TypeError('Failed to fetch'))
            .mockResolvedValueOnce(OK());
        vi.stubGlobal('fetch', fetchMock);
        const onHeaderRejected = vi.fn();
        expect(await send({ ...ARGS, onHeaderRejected })).toBe('Ok.');
        expect(fetchMock).toHaveBeenCalledTimes(2);
        expect(headerOf(fetchMock, 0)).toBe('session-abc');
        expect(headerOf(fetchMock, 1)).toBeUndefined();
        expect(onHeaderRejected).toHaveBeenCalledTimes(1);
        expect(onHeaderRejected).toHaveBeenCalledWith(['x-grok-conv-id']);

        // The next call on the same factory instance: no preflight, no re-send, no second note.
        fetchMock.mockReset().mockResolvedValue(OK());
        expect(await send({ ...ARGS, onHeaderRejected })).toBe('Ok.');
        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(headerOf(fetchMock, 0)).toBeUndefined();
        expect(onHeaderRejected).toHaveBeenCalledTimes(1);

        // The stream lane shares the flag.
        fetchMock.mockReset().mockResolvedValue(streamResponse([sse({ choices: [{ delta: { content: 'Ok.' }, finish_reason: 'stop' }] })]));
        expect(await stream({ ...ARGS, onChunk: () => {}, onHeaderRejected })).toBe('Ok.');
        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(headerOf(fetchMock, 0)).toBeUndefined();
        expect(onHeaderRejected).toHaveBeenCalledTimes(1);
    });

    it('a refusal is proven by ANY response — a 429 on the plain send still counts (and surfaces as the HTTP error)', async () => {
        const { send } = makeAffinityProvider();
        const fetchMock = vi.fn()
            .mockRejectedValueOnce(new TypeError('Failed to fetch'))
            .mockResolvedValueOnce(jsonResponse({ error: { message: 'slow down' } }, { ok: false, status: 429, statusText: 'Too Many Requests' }));
        vi.stubGlobal('fetch', fetchMock);
        const onHeaderRejected = vi.fn();
        await expect(send({ ...ARGS, onHeaderRejected })).rejects.toMatchObject({ status: 429 });
        expect(onHeaderRejected).toHaveBeenCalledTimes(1);
        fetchMock.mockReset().mockResolvedValue(OK());
        await send({ ...ARGS, onHeaderRejected });
        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(headerOf(fetchMock, 0)).toBeUndefined();
    });

    it('a SUCCESS keeps sending the header on every call', async () => {
        const { send } = makeAffinityProvider();
        const fetchMock = vi.fn().mockResolvedValue(OK());
        vi.stubGlobal('fetch', fetchMock);
        const onHeaderRejected = vi.fn();
        await send({ ...ARGS, onHeaderRejected });
        await send({ ...ARGS, onHeaderRejected });
        expect(fetchMock).toHaveBeenCalledTimes(2);
        expect(headerOf(fetchMock, 0)).toBe('session-abc');
        expect(headerOf(fetchMock, 1)).toBe('session-abc');
        expect(onHeaderRejected).not.toHaveBeenCalled();
    });

    it('a non-network failure on the plain send is rethrown as itself, with no note and nothing remembered', async () => {
        const { send } = makeAffinityProvider();
        const fetchMock = vi.fn()
            .mockRejectedValueOnce(new TypeError('Failed to fetch'))
            .mockRejectedValueOnce(new DOMException('The operation was aborted.', 'AbortError'));
        vi.stubGlobal('fetch', fetchMock);
        const onHeaderRejected = vi.fn();
        await expect(send({ ...ARGS, onHeaderRejected })).rejects.toMatchObject({ name: 'AbortError' });
        expect(onHeaderRejected).not.toHaveBeenCalled();
        fetchMock.mockReset().mockResolvedValue(OK());
        await send({ ...ARGS, onHeaderRejected });
        expect(headerOf(fetchMock, 0)).toBe('session-abc');
    });

    it('a caller abort on the headered fetch is never re-sent (one fetch)', async () => {
        const { send } = makeAffinityProvider();
        const controller = new AbortController();
        controller.abort();
        const fetchMock = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'));
        vi.stubGlobal('fetch', fetchMock);
        await expect(send({ ...ARGS, signal: controller.signal })).rejects.toThrow();
        expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('a provider without extra headers never re-sends and never remembers anything', async () => {
        const { send } = makeOpenAICompatProvider({ label: 'OpenAI', baseUrl: 'https://api.openai.com/v1/chat/completions' });
        const fetchMock = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'));
        vi.stubGlobal('fetch', fetchMock);
        await expect(send({ ...ARGS, apiKey: 'sk-test' })).rejects.toThrow('Failed to fetch');
        expect(fetchMock).toHaveBeenCalledTimes(1);
    });
});

describe('the compat stream forwards onActivity to the reader (liveness is bytes, not text)', () => {
    afterEach(() => {
        vi.restoreAllMocks();
        vi.unstubAllGlobals();
    });

    it('a reasoning model\'s empty keep-alive deltas fire onActivity without any onChunk', async () => {
        const { stream } = makeOpenAICompatProvider({ label: 'OpenAI', baseUrl: 'https://api.openai.com/v1/chat/completions' });
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(streamResponse([
            sse({ choices: [{ delta: { role: 'assistant', content: '' } }] }),
            sse({ choices: [{ delta: {} }] }),
            sse({ choices: [{ delta: { content: 'The door opens.' }, finish_reason: 'stop' }] }),
            'data: [DONE]\n\n',
        ])));
        const onActivity = vi.fn();
        const onChunk = vi.fn();
        const text = await stream({ ...ARGS, apiKey: 'sk-test', model: 'gpt-6.1-sol', onChunk, onActivity });
        expect(text).toBe('The door opens.');
        expect(onActivity).toHaveBeenCalledTimes(4);
        expect(onChunk).toHaveBeenCalledTimes(1);
    });
});
