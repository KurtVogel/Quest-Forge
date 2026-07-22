import { afterEach, describe, expect, it, vi } from 'vitest';
import { sendXaiMessage, streamXaiMessage } from './xai.js';

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
    apiKey: 'xai-test',
    model: 'grok-test',
    systemPrompt: 'You are the DM.',
    messageHistory: [],
    userMessage: 'I open the door.',
};

describe('sendXaiMessage', () => {
    afterEach(() => {
        vi.restoreAllMocks();
        vi.unstubAllGlobals();
    });

    it('targets api.x.ai and returns the completion text', async () => {
        const fetchMock = vi.fn().mockResolvedValue(jsonResponse({
            choices: [{ finish_reason: 'stop', message: { content: 'The door creaks open.' } }],
        }));
        vi.stubGlobal('fetch', fetchMock);

        const text = await sendXaiMessage(SEND_ARGS);

        expect(text).toBe('The door creaks open.');
        const [url, options] = fetchMock.mock.calls[0];
        expect(url).toBe('https://api.x.ai/v1/chat/completions');
        expect(options.headers.Authorization).toBe('Bearer xai-test');
    });

    it('normalizes a pasted bare key with the required xai- prefix', async () => {
        const fetchMock = vi.fn().mockResolvedValue(jsonResponse({
            choices: [{ finish_reason: 'stop', message: { content: 'Done.' } }],
        }));
        vi.stubGlobal('fetch', fetchMock);

        await sendXaiMessage({ ...SEND_ARGS, apiKey: '  bare-token ' });

        expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe('Bearer xai-bare-token');
    });

    it('throws a retryable truncation error on finish_reason "length"', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({
            choices: [{ finish_reason: 'length', message: { content: 'Half a rep' } }],
        })));

        await expect(sendXaiMessage(SEND_ARGS)).rejects.toThrow(/truncated/);
    });

    it('stamps .status and unwraps string-shaped error bodies', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(
            { error: 'Invalid API key provided.' },
            { ok: false, status: 401, statusText: 'Unauthorized' },
        )));

        const error = await sendXaiMessage(SEND_ARGS).catch((err) => err);

        expect(error.status).toBe(401);
        expect(error.message).toContain('xAI API error (401)');
        expect(error.message).toContain('Invalid API key provided.');
    });
});

describe('streamXaiMessage', () => {
    afterEach(() => {
        vi.restoreAllMocks();
        vi.unstubAllGlobals();
    });

    function sseEvent(payload) {
        return `data: ${JSON.stringify(payload)}\n`;
    }

    it('reassembles SSE deltas split across reads', async () => {
        const first = sseEvent({ choices: [{ delta: { content: 'You step ' } }] });
        const second = sseEvent({ choices: [{ finish_reason: 'stop', delta: { content: 'into the hall.' } }] });
        const chunks = [first, second.slice(0, 15), second.slice(15), 'data: [DONE]\n'];
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(streamResponse(chunks)));
        const onChunk = vi.fn();

        const fullText = await streamXaiMessage({ ...SEND_ARGS, onChunk });

        expect(fullText).toBe('You step into the hall.');
        expect(onChunk.mock.calls.map(([chunk]) => chunk)).toEqual(['You step ', 'into the hall.']);
    });

    it('throws after the stream ends when finish_reason marks truncation', async () => {
        const chunks = [
            sseEvent({ choices: [{ delta: { content: 'The goblin sw' } }] }),
            sseEvent({ choices: [{ finish_reason: 'length', delta: {} }] }),
        ];
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(streamResponse(chunks)));

        await expect(streamXaiMessage({ ...SEND_ARGS, onChunk: vi.fn() })).rejects.toThrow(/truncated/);
    });
});
