import { afterEach, describe, expect, it, vi } from 'vitest';
import { makeHttpError, makeStreamError, parseRetryAfterMs, readSseStream, RETRY_AFTER_CAP_MS } from './sse.js';

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

async function collect(chunks) {
    const events = [];
    await readSseStream(streamResponse(chunks), (e) => events.push(e));
    return events;
}

describe('readSseStream (2026-09-06 audit: the one SSE reader gets a direct suite)', () => {
    it('accepts the spec-valid `data:` form without a space', async () => {
        expect(await collect(['data:{"a":1}\n\ndata: {"a":2}\n\n'])).toEqual([{ a: 1 }, { a: 2 }]);
    });

    it('flushes a final line the server never terminated', async () => {
        expect(await collect(['data: {"a":1}\n\n', 'data: {"a":2}'])).toEqual([{ a: 1 }, { a: 2 }]);
    });

    it('reassembles an event split across reads, tolerates CRLF, and skips [DONE] and malformed lines', async () => {
        const events = await collect(['data: {"a"', ':1}\r\n\r\ndata: not json\r\n\r\ndata: [DONE]\r\n\r\n']);
        expect(events).toEqual([{ a: 1 }]);
    });

    it('ignores comment/other fields and an empty data line', async () => {
        expect(await collect([': keep-alive\n\nevent: ping\ndata:\n\ndata: {"ok":true}\n\n'])).toEqual([{ ok: true }]);
    });

    it('throws the in-band error event with its real message', async () => {
        await expect(collect(['data: {"error":{"message":"context length exceeded","code":400}}\n\n']))
            .rejects.toThrow(/context length exceeded/);
    });
});

describe('makeStreamError status classification', () => {
    it('stamps numeric codes, numeric strings, and the symbolic names providers actually send', () => {
        expect(makeStreamError({ message: 'x', code: 429 }).status).toBe(429);
        expect(makeStreamError({ message: 'x', code: '503' }).status).toBe(503);
        // Gemini: google.rpc.Code name without a numeric code
        expect(makeStreamError({ message: 'quota', status: 'RESOURCE_EXHAUSTED' }).status).toBe(429);
        expect(makeStreamError({ message: 'down', status: 'UNAVAILABLE' }).status).toBe(503);
        // OpenAI: string code
        expect(makeStreamError({ message: 'slow down', code: 'rate_limit_exceeded' }).status).toBe(429);
        expect(makeStreamError({ message: 'oops', code: 'server_error' }).status).toBe(500);
    });

    it('leaves status unset for unknown shapes and names the detail', () => {
        const err = makeStreamError({ message: 'weird', code: 'something_else' });
        expect(err.status).toBeUndefined();
        expect(err.message).toMatch(/weird/);
        expect(makeStreamError('bare string').message).toMatch(/bare string/);
    });
});

describe('makeHttpError', () => {
    afterEach(() => { vi.useRealTimers(); });

    const response = (payload, { status = 500, statusText = 'Server Error', headers = {} } = {}) => ({
        status,
        statusText,
        json: async () => payload,
        headers: { get: (name) => headers[name.toLowerCase()] ?? null },
    });

    it('an object-valued error without a message falls through to statusText', async () => {
        const err = await makeHttpError('Test')(response({ error: { type: 'x' } }, { status: 502, statusText: 'Bad Gateway' }));
        expect(err.message).toBe('Test API error (502): Bad Gateway');
        expect(err.status).toBe(502);
        expect(err.retryAfterMs).toBeUndefined();
    });

    it('parses delta-seconds Retry-After into retryAfterMs (capped)', async () => {
        const short = await makeHttpError('Test')(response({}, { status: 429, headers: { 'retry-after': '3' } }));
        expect(short.retryAfterMs).toBe(3000);
        const long = await makeHttpError('Test')(response({}, { status: 429, headers: { 'retry-after': '3600' } }));
        expect(long.retryAfterMs).toBe(RETRY_AFTER_CAP_MS);
    });

    it('parses an HTTP-date Retry-After relative to now and ignores junk', async () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-09-06T10:00:00Z'));
        const dated = await makeHttpError('Test')(response({}, { status: 429, headers: { 'retry-after': 'Sun, 06 Sep 2026 10:00:04 GMT' } }));
        expect(dated.retryAfterMs).toBe(4000);
        const junk = await makeHttpError('Test')(response({}, { status: 429, headers: { 'retry-after': 'soon-ish' } }));
        expect(junk.retryAfterMs).toBeUndefined();
    });

    it('a response without a headers object still builds the error', async () => {
        const err = await makeHttpError('Test')({ status: 500, statusText: 'x', json: async () => ({}) });
        expect(err.status).toBe(500);
    });
});

describe('parseRetryAfterMs', () => {
    it('returns null for empty, negative, zero, or non-finite values', () => {
        expect(parseRetryAfterMs('')).toBeNull();
        expect(parseRetryAfterMs(null)).toBeNull();
        expect(parseRetryAfterMs('0')).toBeNull();
        expect(parseRetryAfterMs('-5')).toBeNull();
        expect(parseRetryAfterMs('NaN')).toBeNull();
    });
});
