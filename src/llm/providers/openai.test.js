import { afterEach, describe, expect, it, vi } from 'vitest';
import { sendOpenAIMessage, streamOpenAIMessage } from './openai.js';

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
    apiKey: 'sk-test',
    model: 'gpt-test',
    systemPrompt: 'You are the DM.',
    messageHistory: [{ role: 'user', content: 'Hello' }, { role: 'assistant', content: 'Well met.' }],
    userMessage: 'I open the door.',
};

describe('sendOpenAIMessage', () => {
    afterEach(() => {
        vi.restoreAllMocks();
        vi.unstubAllGlobals();
    });

    it('sends the chat-format request and returns the completion text', async () => {
        const fetchMock = vi.fn().mockResolvedValue(jsonResponse({
            choices: [{ finish_reason: 'stop', message: { content: 'The door creaks open.' } }],
        }));
        vi.stubGlobal('fetch', fetchMock);

        const text = await sendOpenAIMessage(SEND_ARGS);

        expect(text).toBe('The door creaks open.');
        const [url, options] = fetchMock.mock.calls[0];
        expect(url).toBe('https://api.openai.com/v1/chat/completions');
        expect(options.headers.Authorization).toBe('Bearer sk-test');
        const body = JSON.parse(options.body);
        expect(body.model).toBe('gpt-test');
        expect(body.messages).toEqual([
            { role: 'system', content: 'You are the DM.' },
            { role: 'user', content: 'Hello' },
            { role: 'assistant', content: 'Well met.' },
            { role: 'user', content: 'I open the door.' },
        ]);
        // OpenAI's current output-cap field name; post-4o models 400 on the
        // legacy max_tokens (2026-08-08 audit). xAI keeps max_tokens — pinned
        // in xai.test.js.
        expect(body.max_completion_tokens).toBe(16384);
        expect(body.max_tokens).toBeUndefined();
        // Non-reasoning models keep the tuned temperature.
        expect(body.temperature).toBe(0.9);
    });

    it('omits temperature entirely for reasoning models that 400 on non-default values', async () => {
        // gpt-5 rejected temperature 0.7 live (2026-08-22 OpenAI playtest):
        // "Unsupported value: 'temperature' does not support 0.7 with this model."
        const fetchMock = vi.fn().mockResolvedValue(jsonResponse({
            choices: [{ finish_reason: 'stop', message: { content: 'ok' } }],
        }));
        vi.stubGlobal('fetch', fetchMock);

        await sendOpenAIMessage({ ...SEND_ARGS, model: 'gpt-5', temperature: 0.7 });
        await sendOpenAIMessage({ ...SEND_ARGS, model: 'o3-mini', temperature: 0.7 });
        await sendOpenAIMessage({ ...SEND_ARGS, model: 'gpt-4o', temperature: 0.7 });

        const bodies = fetchMock.mock.calls.map(([, options]) => JSON.parse(options.body));
        expect(bodies[0].temperature).toBeUndefined();
        expect(bodies[1].temperature).toBeUndefined();
        expect(bodies[2].temperature).toBe(0.7);
    });

    it('throws a retryable truncation error on finish_reason "length"', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({
            choices: [{ finish_reason: 'length', message: { content: 'Half a rep' } }],
        })));

        await expect(sendOpenAIMessage(SEND_ARGS)).rejects.toThrow(/truncated/);
    });

    it('throws instead of returning an empty string when a stop response carries no text', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({
            choices: [{ finish_reason: 'stop', message: { content: '' } }],
        })));

        await expect(sendOpenAIMessage(SEND_ARGS)).rejects.toThrow(/No response generated/);
    });

    it('throws on an unexpected finish reason such as content_filter', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({
            choices: [{ finish_reason: 'content_filter', message: { content: 'Partial' } }],
        })));

        await expect(sendOpenAIMessage(SEND_ARGS)).rejects.toThrow(/stopped early \(content_filter\)/);
    });

    it('stamps .status onto HTTP errors so the adapter can retry transient failures', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(
            { error: { message: 'Rate limit reached.' } },
            { ok: false, status: 429, statusText: 'Too Many Requests' },
        )));

        const error = await sendOpenAIMessage(SEND_ARGS).catch((err) => err);

        expect(error.status).toBe(429);
        expect(error.message).toContain('OpenAI API error (429)');
        expect(error.message).toContain('Rate limit reached.');
    });
});

describe('streamOpenAIMessage', () => {
    afterEach(() => {
        vi.restoreAllMocks();
        vi.unstubAllGlobals();
    });

    function sseEvent(payload) {
        return `data: ${JSON.stringify(payload)}\n`;
    }

    it('reassembles SSE deltas split across reads and ignores malformed lines', async () => {
        const first = sseEvent({ choices: [{ delta: { content: 'You step ' } }] });
        const second = sseEvent({ choices: [{ finish_reason: 'stop', delta: { content: 'into the hall.' } }] });
        // Split the second event mid-line to exercise the incomplete-line buffer.
        const chunks = [first, second.slice(0, 15), second.slice(15), 'data: {malformed\n', 'data: [DONE]\n'];
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(streamResponse(chunks)));
        const onChunk = vi.fn();

        const fullText = await streamOpenAIMessage({ ...SEND_ARGS, onChunk });

        expect(fullText).toBe('You step into the hall.');
        expect(onChunk.mock.calls.map(([chunk]) => chunk)).toEqual(['You step ', 'into the hall.']);
    });

    it('omits temperature for reasoning models on the streaming path too', async () => {
        const chunks = [sseEvent({ choices: [{ finish_reason: 'stop', delta: { content: 'ok' } }] })];
        const fetchMock = vi.fn().mockResolvedValue(streamResponse(chunks));
        vi.stubGlobal('fetch', fetchMock);

        await streamOpenAIMessage({ ...SEND_ARGS, model: 'gpt-5', onChunk: vi.fn() });

        const body = JSON.parse(fetchMock.mock.calls[0][1].body);
        expect(body.temperature).toBeUndefined();
    });

    it('throws after the stream ends when finish_reason marks truncation', async () => {
        const chunks = [
            sseEvent({ choices: [{ delta: { content: 'The goblin sw' } }] }),
            sseEvent({ choices: [{ finish_reason: 'length', delta: {} }] }),
        ];
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(streamResponse(chunks)));

        await expect(streamOpenAIMessage({ ...SEND_ARGS, onChunk: vi.fn() })).rejects.toThrow(/truncated/);
    });

    it('surfaces an in-band error event with its real message instead of "connection dropped"', async () => {
        // OpenAI delivers rate-limit / context errors as a `data: {"error": …}`
        // event and then closes the stream cleanly — no choices, no finish_reason.
        const chunks = [
            sseEvent({ choices: [{ delta: { content: 'You step ' } }] }),
            sseEvent({ error: { message: 'Rate limit reached for gpt-5.6-terra: tokens per min', type: 'tokens', code: 429 } }),
            'data: [DONE]\n',
        ];
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(streamResponse(chunks)));

        const failure = streamOpenAIMessage({ ...SEND_ARGS, onChunk: vi.fn() });
        await expect(failure).rejects.toThrow(/Rate limit reached/);
        await expect(failure).rejects.not.toThrow(/connection dropped/);
        await failure.catch(err => expect(err.status).toBe(429));
    });

    it('throws when the stream closes cleanly without ever delivering a finish_reason', async () => {
        const chunks = [sseEvent({ choices: [{ delta: { content: 'You step into' } }] })];
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(streamResponse(chunks)));

        await expect(streamOpenAIMessage({ ...SEND_ARGS, onChunk: vi.fn() })).rejects.toThrow(/connection dropped/);
    });

    it('stamps .status onto streaming HTTP errors', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(
            { error: { message: 'Server overloaded.' } },
            { ok: false, status: 503, statusText: 'Service Unavailable' },
        )));

        const error = await streamOpenAIMessage({ ...SEND_ARGS, onChunk: vi.fn() }).catch((err) => err);

        expect(error.status).toBe(503);
        expect(error.message).toContain('Server overloaded.');
    });
});

describe('refusals, reasoning output cap, history shape (2026-09-06 audit)', () => {
    afterEach(() => {
        vi.restoreAllMocks();
        vi.unstubAllGlobals();
    });

    it('P1: a non-streaming refusal throws the refusal text instead of "No response generated"', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({
            choices: [{ finish_reason: 'stop', message: { content: null, refusal: "I can't continue this scene." } }],
        })));
        await expect(sendOpenAIMessage(SEND_ARGS)).rejects.toThrow(/declined to respond: I can't continue this scene\./);
    });

    it('P1: a streamed refusal (delta.refusal, content null, stop) throws instead of resolving to ""', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(streamResponse([
            'data: {"choices":[{"delta":{"content":null,"refusal":"I can\'t "}}]}\n\n',
            'data: {"choices":[{"delta":{"refusal":"help with that."},"finish_reason":"stop"}]}\n\n',
            'data: [DONE]\n\n',
        ])));
        const onChunk = vi.fn();
        await expect(streamOpenAIMessage({ ...SEND_ARGS, onChunk })).rejects.toThrow(/declined to respond: I can't help with that\./);
        expect(onChunk).not.toHaveBeenCalled();
    });

    it('P2: reasoning models get the 32k output cap, gpt-4o keeps 16k, on both lanes', async () => {
        const fetchMock = vi.fn()
            .mockResolvedValueOnce(jsonResponse({ choices: [{ finish_reason: 'stop', message: { content: 'ok' } }] }))
            .mockResolvedValueOnce(jsonResponse({ choices: [{ finish_reason: 'stop', message: { content: 'ok' } }] }))
            .mockResolvedValueOnce(streamResponse(['data: {"choices":[{"delta":{"content":"ok"},"finish_reason":"stop"}]}\n\n']));
        vi.stubGlobal('fetch', fetchMock);
        await sendOpenAIMessage({ ...SEND_ARGS, model: 'gpt-5.6-terra' });
        await sendOpenAIMessage({ ...SEND_ARGS, model: 'gpt-4o' });
        await streamOpenAIMessage({ ...SEND_ARGS, model: 'gpt-5.6-sol', onChunk: () => {} });
        const caps = fetchMock.mock.calls.map(([, options]) => JSON.parse(options.body).max_completion_tokens);
        expect(caps).toEqual([32768, 16384, 32768]);
    });

    it('a stray system-role history line rides as user context and null content becomes ""', async () => {
        const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ choices: [{ finish_reason: 'stop', message: { content: 'ok' } }] }));
        vi.stubGlobal('fetch', fetchMock);
        await sendOpenAIMessage({ ...SEND_ARGS, messageHistory: [{ role: 'system', content: 'You rolled **12**.' }, { role: 'assistant', content: null }] });
        const body = JSON.parse(fetchMock.mock.calls[0][1].body);
        expect(body.messages.slice(1, 3)).toEqual([
            { role: 'user', content: 'You rolled **12**.' },
            { role: 'assistant', content: '' },
        ]);
    });
});
