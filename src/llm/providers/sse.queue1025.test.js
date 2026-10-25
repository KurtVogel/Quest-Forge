/**
 * Strengthening queue 2026-10-25 (providers-adapter, Lap 1) — the transport
 * shelf's two rows:
 * - `Retry-After` is a header a BROWSER cannot read cross-origin unless the
 *   provider exposes it (measured: OpenAI exposes CF-Ray alone). Gemini's
 *   429 BODY carries the same fact (`google.rpc.RetryInfo` + "retry in Ns");
 *   `parseBodyRetryDelayMs` reads it, `makeHttpError` falls back to it, the
 *   parse site clamps to a HARD cap and `retryDelay` applies the LANE's cap.
 * - liveness is bytes, not text: `readSseStream` reports every read that
 *   returns bytes through `onActivity`, so a text-less keep-alive arms the
 *   adapter's idle timer.
 */
import { describe, expect, it, vi } from 'vitest';
import { BACKGROUND_RETRY_AFTER_CAP_MS, makeHttpError, parseBodyRetryDelayMs, parseRetryAfterMs, readSseStream, RETRY_AFTER_CAP_MS, RETRY_AFTER_HARD_CAP_MS, retryDelay } from './sse.js';

const RETRY_INFO = 'type.googleapis.com/google.rpc.RetryInfo';

/** Google's 429 body as the API sends it (the message AND the RetryInfo detail). */
function geminiQuotaBody(retryDelay, message = 'You exceeded your current quota. Please retry in 32.5s.') {
    return {
        error: {
            code: 429,
            message,
            status: 'RESOURCE_EXHAUSTED',
            details: [
                { '@type': 'type.googleapis.com/google.rpc.QuotaFailure', violations: [{ quotaMetric: 'generate_content_requests' }] },
                { '@type': RETRY_INFO, retryDelay },
            ],
        },
    };
}

const response = (payload, { status = 429, statusText = 'Too Many Requests', headers = {} } = {}) => ({
    status,
    statusText,
    json: async () => payload,
    headers: { get: (name) => headers[name.toLowerCase()] ?? null },
});

describe('parseBodyRetryDelayMs — the body\'s copy of Retry-After', () => {
    it('reads the RetryInfo detail in Google\'s string form ("32s" / "32.5s")', () => {
        expect(parseBodyRetryDelayMs(geminiQuotaBody('32s'))).toBe(32_000);
        expect(parseBodyRetryDelayMs(geminiQuotaBody('32.5s'))).toBe(32_500);
    });

    it('reads the RetryInfo detail in the proto JSON form ({ seconds, nanos })', () => {
        expect(parseBodyRetryDelayMs(geminiQuotaBody({ seconds: 32, nanos: 500_000_000 }))).toBe(32_500);
        expect(parseBodyRetryDelayMs(geminiQuotaBody({ seconds: '20' }))).toBe(20_000);
    });

    it('falls back to the message\'s "retry in Ns" phrasing when no RetryInfo detail rides the body', () => {
        expect(parseBodyRetryDelayMs({ error: { message: 'Quota exceeded. Please retry in 32.5s.' } })).toBe(32_500);
        expect(parseBodyRetryDelayMs({ error: { message: 'Resource exhausted; retry in 7 seconds.' } })).toBe(7_000);
        expect(parseBodyRetryDelayMs({ error: { message: 'Try again later, retry after 12 s' } })).toBe(12_000);
    });

    it('the RetryInfo detail wins over the message when both are present', () => {
        expect(parseBodyRetryDelayMs(geminiQuotaBody('40s', 'Please retry in 5s.'))).toBe(40_000);
    });

    it('takes the raw body text as well as the parsed record (the embed lane holds text)', () => {
        expect(parseBodyRetryDelayMs(JSON.stringify(geminiQuotaBody('32s')))).toBe(32_000);
        expect(parseBodyRetryDelayMs('<html>Bad Gateway</html>')).toBeNull();
    });

    it('is harmless for an OpenAI / xAI body, a bodiless reply and junk', () => {
        expect(parseBodyRetryDelayMs({ error: { message: 'Rate limit reached for gpt-6.1-sol', type: 'requests', code: 'rate_limit_exceeded' } })).toBeNull();
        expect(parseBodyRetryDelayMs({ error: 'string-shaped xAI error' })).toBeNull();
        expect(parseBodyRetryDelayMs({})).toBeNull();
        expect(parseBodyRetryDelayMs(null)).toBeNull();
        expect(parseBodyRetryDelayMs([])).toBeNull();
        expect(parseBodyRetryDelayMs(geminiQuotaBody('soon', 'retry later'))).toBeNull();
        expect(parseBodyRetryDelayMs(geminiQuotaBody('0s', 'retry in 0s'))).toBeNull();
        expect(parseBodyRetryDelayMs({ error: { message: 'x', details: [null, 42, { '@type': RETRY_INFO }] } })).toBeNull();
    });

    it('clamps to the HARD cap like the header parse', () => {
        expect(parseBodyRetryDelayMs(geminiQuotaBody('3600s'))).toBe(RETRY_AFTER_HARD_CAP_MS);
        expect(parseBodyRetryDelayMs({ error: { message: 'retry in 99999s' } })).toBe(RETRY_AFTER_HARD_CAP_MS);
    });
});

describe('the two caps — a HARD cap at the parse site, the LANE\'s cap in retryDelay', () => {
    it('the constants stand in their order: lane default 10 s < background 30 s < hard 60 s', () => {
        expect(RETRY_AFTER_CAP_MS).toBe(10_000);
        expect(BACKGROUND_RETRY_AFTER_CAP_MS).toBe(30_000);
        expect(RETRY_AFTER_HARD_CAP_MS).toBe(60_000);
    });

    it('parseRetryAfterMs clamps to the hard cap, not the lane default', () => {
        expect(parseRetryAfterMs('45')).toBe(45_000);
        expect(parseRetryAfterMs('3600')).toBe(RETRY_AFTER_HARD_CAP_MS);
    });

    it('retryDelay applies the DEFAULT lane cap when none is passed (the DM stream, the pre-commit lane)', () => {
        expect(retryDelay(0, { retryAfterMs: 32_000 }, { base: 1000, jitterMs: 0 })).toBe(RETRY_AFTER_CAP_MS);
        expect(retryDelay(0, { retryAfterMs: 4_000 }, { base: 1000, jitterMs: 0 })).toBe(4_000);
    });

    it('retryDelay applies a passed lane cap (the background lane waits 30 s, never the hard cap\'s 60)', () => {
        expect(retryDelay(0, { retryAfterMs: 25_000 }, { base: 1000, jitterMs: 0, capMs: BACKGROUND_RETRY_AFTER_CAP_MS })).toBe(25_000);
        expect(retryDelay(0, { retryAfterMs: 45_000 }, { base: 1000, jitterMs: 0, capMs: BACKGROUND_RETRY_AFTER_CAP_MS })).toBe(30_000);
        expect(retryDelay(0, { retryAfterMs: RETRY_AFTER_HARD_CAP_MS }, { base: 1000, jitterMs: 0, capMs: BACKGROUND_RETRY_AFTER_CAP_MS })).toBe(30_000);
    });

    it('a longer backoff still wins over a capped retry-after, and a junk cap reads as the default', () => {
        expect(retryDelay(4, { retryAfterMs: 5_000 }, { base: 1000, jitterMs: 0, capMs: 2_000 })).toBe(16_000);
        expect(retryDelay(0, { retryAfterMs: 32_000 }, { base: 1000, jitterMs: 0, capMs: 0 })).toBe(RETRY_AFTER_CAP_MS);
        expect(retryDelay(0, { retryAfterMs: 32_000 }, { base: 1000, jitterMs: 0, capMs: NaN })).toBe(RETRY_AFTER_CAP_MS);
        expect(retryDelay(0, { retryAfterMs: 32_000 }, { base: 1000, jitterMs: 0, capMs: undefined })).toBe(RETRY_AFTER_CAP_MS);
    });
});

describe('makeHttpError reads the body\'s delay when the header is not there to read', () => {
    it('a Gemini 429 with RetryInfo and NO header stamps retryAfterMs from the body', async () => {
        const err = await makeHttpError('Gemini')(response(geminiQuotaBody('32s')));
        expect(err.status).toBe(429);
        expect(err.retryAfterMs).toBe(32_000);
        expect(err.message).toContain('Gemini API error (429)');
    });

    it('the message-only form stamps it too', async () => {
        const err = await makeHttpError('Gemini')(response({ error: { message: 'Please retry in 20s.', status: 'RESOURCE_EXHAUSTED' } }));
        expect(err.retryAfterMs).toBe(20_000);
    });

    it('a readable header still wins over the body', async () => {
        const err = await makeHttpError('Gemini')(response(geminiQuotaBody('32s'), { headers: { 'retry-after': '7' } }));
        expect(err.retryAfterMs).toBe(7_000);
    });

    it('an OpenAI-shaped 429 with neither stamps nothing (the backoff governs)', async () => {
        const err = await makeHttpError('OpenAI')(response({ error: { message: 'Rate limit reached', type: 'requests', code: 'rate_limit_exceeded' } }));
        expect(err.status).toBe(429);
        expect(err.retryAfterMs).toBeUndefined();
    });
});

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

const sse = (payload) => `data: ${JSON.stringify(payload)}\n\n`;

describe('readSseStream reports liveness per READ through onActivity', () => {
    it('fires once per read that returns bytes — text-less events included — and before the event is parsed', async () => {
        const order = [];
        const onActivity = vi.fn(() => order.push('activity'));
        const onEvent = vi.fn((event) => order.push(`event:${Object.keys(event)[0]}`));
        await readSseStream(streamResponse([
            sse({ usageMetadata: { promptTokenCount: 10 } }), // a Gemini usage-only event
            sse({ choices: [{ delta: {} }] }), // an OpenAI reasoning keep-alive
            sse({ candidates: [{ content: { parts: [{ thought: true, text: 'hmm' }] } }] }), // a thought part
            sse({ candidates: [{ content: { parts: [{ text: 'The door opens.' }] }, finishReason: 'STOP' }] }),
        ]), onEvent, { onActivity });
        expect(onActivity).toHaveBeenCalledTimes(4);
        expect(onEvent).toHaveBeenCalledTimes(4);
        expect(order[0]).toBe('activity');
        expect(order[1]).toMatch(/^event:/);
    });

    it('a read split mid-event still counts as life (bytes arrived, no event yet)', async () => {
        const onActivity = vi.fn();
        const events = [];
        await readSseStream(streamResponse(['data: {"a"', ':1}\n\n']), (e) => events.push(e), { onActivity });
        expect(onActivity).toHaveBeenCalledTimes(2);
        expect(events).toEqual([{ a: 1 }]);
    });

    it('an empty read is not life, and the option is optional', async () => {
        const onActivity = vi.fn();
        const encoder = new TextEncoder();
        const reads = [new Uint8Array(0), encoder.encode('data: {"a":1}\n\n')];
        let index = 0;
        const body = { getReader: () => ({ read: async () => (index < reads.length ? { done: false, value: reads[index++] } : { done: true, value: undefined }) }) };
        await readSseStream({ ok: true, body }, () => {}, { onActivity });
        expect(onActivity).toHaveBeenCalledTimes(1);
        await expect(readSseStream(streamResponse(['data: {"a":1}\n\n']), () => {})).resolves.toBeUndefined();
        await expect(readSseStream(streamResponse(['data: {"a":1}\n\n']), () => {}, { onActivity: 'not a function' })).resolves.toBeUndefined();
    });
});
