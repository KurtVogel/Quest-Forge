import { afterEach, describe, expect, it, vi } from 'vitest';
import { asRecord, historyText, isTransient, makeHttpError, makeStreamError, parseRetryAfterMs, readSseStream, reportUsage, RETRY_AFTER_HARD_CAP_MS, retryDelay, TRANSIENT_STATUS } from './sse.js';

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

    it('parses delta-seconds Retry-After into retryAfterMs (under the HARD cap; the lane cap is retryDelay\'s since 2026-10-25)', async () => {
        const short = await makeHttpError('Test')(response({}, { status: 429, headers: { 'retry-after': '3' } }));
        expect(short.retryAfterMs).toBe(3000);
        const long = await makeHttpError('Test')(response({}, { status: 429, headers: { 'retry-after': '3600' } }));
        expect(long.retryAfterMs).toBe(RETRY_AFTER_HARD_CAP_MS);
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

describe('hostile bodies and events (2026-09-16 providers-adapter P2)', () => {
    const nullBodyResponse = (status, headers = {}) => ({
        status, statusText: 'Too Many Requests', json: async () => null,
        headers: { get: (name) => headers[name.toLowerCase()] ?? null },
    });

    it('makeHttpError stamps status and Retry-After even when the body parses to null (the retry classifier used to see a TypeError)', async () => {
        const err = await makeHttpError('Gemini')(nullBodyResponse(429, { 'retry-after': '2' }));
        expect(err.message).toBe('Gemini API error (429): Too Many Requests');
        expect(err.status).toBe(429);
        expect(err.retryAfterMs).toBe(2000);
    });

    it('readSseStream skips non-object events (data: null, data: 42) instead of handing them to the consumer', async () => {
        expect(await collect(['data: null\n\ndata: 42\n\ndata: "str"\n\ndata: {"ok":true}\n\n'])).toEqual([{ ok: true }]);
    });

    it('a response without a body is a dropped connection, not a TypeError out of getReader', async () => {
        await expect(readSseStream({ ok: true, body: null }, () => {})).rejects.toThrow(/no response body/);
        await expect(readSseStream(undefined, () => {})).rejects.toThrow(/no response body/);
    });
});

describe('the transport vocabulary, spelled once (2026-10-12 providers-adapter Lap 4)', () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('isTransient reads a status number or an error: the five statuses and a browser network failure, nothing else', () => {
        for (const status of [429, 500, 502, 503, 504]) {
            expect(isTransient(status)).toBe(true);
            expect(isTransient(Object.assign(new Error('x'), { status }))).toBe(true);
        }
        expect([...TRANSIENT_STATUS].sort()).toEqual([429, 500, 502, 503, 504]);
        for (const status of [200, 400, 401, 403, 404, 413]) expect(isTransient(status)).toBe(false);
        expect(isTransient(new TypeError('Failed to fetch'))).toBe(true);
        expect(isTransient(new TypeError("Cannot read properties of undefined (reading 'x')"))).toBe(false);
        const stall = new Error('The operation was aborted due to timeout');
        stall.name = 'TimeoutError';
        expect(isTransient(stall)).toBe(false);
        expect(isTransient(null)).toBe(false);
        expect(isTransient(undefined)).toBe(false);
    });

    it('retryDelay doubles from its base, adds at most the jitter, and a longer Retry-After wins', () => {
        vi.spyOn(Math, 'random').mockReturnValue(0.5);
        expect(retryDelay(0, null, { base: 1000 })).toBe(1125);
        expect(retryDelay(1, {}, { base: 1500 })).toBe(3125);
        expect(retryDelay(0, { retryAfterMs: 4000 }, { base: 1000 })).toBe(4000);
        expect(retryDelay(2, { retryAfterMs: 1000 }, { base: 1000 })).toBe(4125);
        // The embed lane: no jitter, so its wait is exactly the Retry-After or the base.
        expect(retryDelay(0, { retryAfterMs: null }, { base: 1000, jitterMs: 0 })).toBe(1000);
        expect(retryDelay(0, { retryAfterMs: 2000 }, { base: 1000, jitterMs: 0 })).toBe(2000);
    });

    it('asRecord accepts only a plain object; makeHttpError no longer reads an ARRAY body as the error', async () => {
        expect(asRecord({ a: 1 })).toEqual({ a: 1 });
        for (const junk of [null, undefined, [1, 2], 'text', 42]) expect(asRecord(junk)).toEqual({});
        const arrayBody = [{ error: { message: 'not this' } }];
        arrayBody.error = { message: 'nor this' };
        const err = await makeHttpError('Test')({ status: 503, statusText: 'Service Unavailable', json: async () => arrayBody });
        expect(err.message).toBe('Test API error (503): Service Unavailable');
        expect(err.status).toBe(503);
    });

    it('historyText and reportUsage are the two lanes\' shared shelves', () => {
        expect(historyText('hi')).toBe('hi');
        expect(historyText(null)).toBe('');
        expect(historyText(undefined)).toBe('');
        expect(historyText(42)).toBe('42');
        const onUsage = vi.fn();
        reportUsage(onUsage, { n: 3 }, (raw) => (raw?.n ? { promptTokens: raw.n } : null));
        reportUsage(onUsage, null, () => null);
        reportUsage(undefined, { n: 1 }, () => { throw new Error('never normalized without a callback'); });
        expect(onUsage.mock.calls).toEqual([[{ promptTokens: 3 }]]);
    });
});
