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
    });

    it('throws a retryable truncation error on finish_reason "length"', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({
            choices: [{ finish_reason: 'length', message: { content: 'Half a rep' } }],
        })));

        await expect(sendOpenAIMessage(SEND_ARGS)).rejects.toThrow(/truncated/);
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

    it('throws after the stream ends when finish_reason marks truncation', async () => {
        const chunks = [
            sseEvent({ choices: [{ delta: { content: 'The goblin sw' } }] }),
            sseEvent({ choices: [{ finish_reason: 'length', delta: {} }] }),
        ];
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(streamResponse(chunks)));

        await expect(streamOpenAIMessage({ ...SEND_ARGS, onChunk: vi.fn() })).rejects.toThrow(/truncated/);
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
