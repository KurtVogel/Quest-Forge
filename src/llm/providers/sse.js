/**
 * Shared SSE plumbing for streaming chat providers (Gemini + the
 * OpenAI-compatible factory). One reader means a stream-truncation fix lands
 * once instead of being hand-copied across providers — streamGeminiMessage was
 * the third hand-maintained copy of this skeleton (2026-08-30 audit).
 *
 * Since 2026-10-12 (providers-adapter Lap 4) it is also THE transport
 * vocabulary: what a transient failure is (`isTransient`), how long to wait
 * before the retry (`retryDelay`), `sleep`, the body typer (`asRecord`), the
 * usage reporter and the history-text coercion — each was spelled twice or
 * more across the adapter's two lanes, the embed's two lanes and the two
 * provider families.
 */
import { isRecord } from '../../engine/text.js';

/**
 * Read an SSE response body to completion, invoking onEvent(parsedJson) for
 * every `data:` event. `[DONE]` sentinels and malformed JSON lines are
 * skipped; an incomplete trailing line is buffered across reads, and a final
 * line the server never terminated is still delivered when the body ends.
 * The field separator is `data:` with an OPTIONAL space — both are valid
 * SSE, and a proxy in a player's path may emit either (2026-09-06 audit).
 *
 * `onActivity` (2026-10-25 providers-adapter P2) fires on every read that
 * returns BYTES, before they are parsed: liveness is bytes, not text. The
 * adapter's idle timer used to be armed by the consumer's text callback
 * alone, so a reasoning model's text-less keep-alives (a `thought` part, a
 * `usageMetadata`-only event, an empty OpenAI `delta`) kept the connection
 * alive and the timer dead — a think longer than the idle budget was cut as
 * "stalled" while data flowed.
 */
export async function readSseStream(response, onEvent, { onActivity = null } = {}) {
    // A response without a body is a dropped connection, not a TypeError out
    // of getReader (2026-09-16 audit P2).
    if (!response?.body || typeof response.body.getReader !== 'function') {
        throw new Error('The connection dropped before the reply began — no response body. Please retry.');
    }
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    const handleLine = (line) => {
        if (!line.startsWith('data:')) return;
        const data = line.slice(5).trim();
        if (!data || data === '[DONE]') return;
        let parsed;
        try {
            parsed = JSON.parse(data);
        } catch {
            return; // Ignore malformed JSON lines
        }
        // Both OpenAI-compatible and Gemini streams can deliver a failure as
        // an in-band `{"error": …}` event and then close cleanly. It carries
        // no choices/candidates, so a handler that only reads those sees an
        // empty stream and the player gets "connection dropped" instead of
        // the real cause (rate limit, context length, bad request) — the
        // 2026-09-03 OpenAI playtest failed nine streams in a row that way.
        // One junk event (`data: null`, `data: 42`) used to reach both
        // consumers and kill the whole DM turn as a TypeError (2026-09-16 P2).
        if (!parsed || typeof parsed !== 'object') return;
        const streamError = parsed.error;
        if (streamError) {
            throw makeStreamError(streamError);
        }
        onEvent(parsed);
    };

    while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value?.length && typeof onActivity === 'function') onActivity();

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || ''; // keep the incomplete line in the buffer

        for (const line of lines) handleLine(line);
    }
    // Flush the decoder's trailing bytes and any unterminated final line — a
    // server that closes without a final newline still delivered that event.
    buffer += decoder.decode();
    if (buffer.trim()) handleLine(buffer);
}

/**
 * fetch() rejects with a TypeError on a network failure (no HTTP status at
 * all), but so does any programming bug inside a provider — this matches the
 * browsers' own network-failure messages (Chrome "Failed to fetch", Firefox
 * "NetworkError when attempting to fetch resource.", Safari "Load failed",
 * React Native "Network request failed") and nothing else. Shared by the
 * adapter's retry classifier and the OpenAI provider's CORS diagnosis.
 */
const NETWORK_FAILURE_RE = /failed to fetch|networkerror|load failed|network request failed/i;
export function isNetworkFailure(error) {
    return error instanceof TypeError && NETWORK_FAILURE_RE.test(error?.message || '');
}

/** Transient HTTP statuses worth a retry: a rate limit or a server hiccup. */
export const TRANSIENT_STATUS = Object.freeze(new Set([429, 500, 502, 503, 504]));

/**
 * THE transient judgement (2026-10-12 — it was spelled as `RETRYABLE_STATUS` +
 * `isRetryableError` in the adapter and `RETRYABLE_EMBED_STATUS` + `.has` +
 * `isNetworkFailure` in the embed). A number is read as an HTTP status; any
 * other value as an error — transient when its `.status` is, or when it is a
 * browser network failure (a stall's AbortError / TimeoutError is not: each
 * lane decides what a stall costs on its own).
 */
export function isTransient(errorOrStatus) {
    if (typeof errorOrStatus === 'number') return TRANSIENT_STATUS.has(errorOrStatus);
    return TRANSIENT_STATUS.has(errorOrStatus?.status) || isNetworkFailure(errorOrStatus);
}

/**
 * The wait before retry `attempt` (0-based): exponential backoff from `base`
 * plus up to `jitterMs` of jitter, and a provider's retry-after (the
 * `.retryAfterMs` that makeHttpError stamps, under the HARD cap) wins
 * whenever it is longer — a per-minute quota 429 burned all three attempts
 * in ~3 s and lost the Scribe/journal extraction (2026-09-06).
 *
 * `capMs` is the LANE's ceiling on that provider-sent wait (2026-10-25
 * providers-adapter P2): the DM stream and the pre-commit lane keep
 * RETRY_AFTER_CAP_MS (10 s — the player is watching), the background lane
 * and the embed seed may wait BACKGROUND_RETRY_AFTER_CAP_MS (30 s) inside
 * their own budgets, because Gemini's per-minute windows say 20–60 s and a
 * 10 s wait simply burned the retry.
 */
export function retryDelay(attempt, error, { base = 1000, jitterMs = 250, capMs = RETRY_AFTER_CAP_MS } = {}) {
    const backoff = base * 2 ** attempt + Math.random() * jitterMs;
    const cap = Number.isFinite(capMs) && capMs > 0 ? capMs : RETRY_AFTER_CAP_MS;
    const retryAfter = Number.isFinite(error?.retryAfterMs) ? Math.min(error.retryAfterMs, cap) : 0;
    return Math.max(backoff, retryAfter);
}

export const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

/** A parsed provider body as a plain object, else {} (`null`, an array, a scalar). */
export function asRecord(value) {
    return isRecord(value) ? value : {};
}

/**
 * One history row's text: a string as-is, anything else `String(x ?? '')` —
 * a null part is a 400 at Gemini and a null content a 400 at the compat APIs.
 */
export function historyText(content) {
    return typeof content === 'string' ? content : String(content ?? '');
}

/**
 * Hand a provider's raw usage to the caller's `onUsage` through that
 * provider's normalizer, when there is a callback and a usable shape.
 */
export function reportUsage(onUsage, raw, normalize) {
    if (typeof onUsage !== 'function') return;
    const usage = normalize(raw);
    if (usage) onUsage(usage);
}

/**
 * Turn an in-band stream error payload into a thrown Error that names the
 * cause. OpenAI-compatible: `{ error: { message, type, code } }`; Gemini:
 * `{ error: { code, message, status } }`; some proxies send a bare string.
 * `.status` is stamped from a numeric code so the adapter's retry classifier
 * can treat 429/5xx like their HTTP twins.
 */
export function makeStreamError(streamError) {
    const detail = typeof streamError === 'string'
        ? streamError
        : (streamError?.message || streamError?.status || streamError?.type || 'unknown error');
    const err = new Error(`The provider reported an error mid-stream: ${String(detail).slice(0, 300)}. Please retry.`);
    const status = numericStatus(streamError?.code) ?? numericStatus(streamError?.status)
        ?? SYMBOLIC_STATUS[String(streamError?.status || streamError?.code || '').toLowerCase()];
    if (status) err.status = status;
    return err;
}

/** A numeric HTTP status from a number or numeric string, else undefined. */
function numericStatus(value) {
    const code = Number(value);
    return Number.isInteger(code) && code >= 100 && code <= 599 ? code : undefined;
}

/**
 * Gemini's string `status` (google.rpc.Code names) and OpenAI's string `code`
 * mapped to the HTTP status they stand for, so an in-band stream error is
 * classified like its HTTP twin.
 */
const SYMBOLIC_STATUS = {
    resource_exhausted: 429,
    rate_limit_exceeded: 429,
    insufficient_quota: 429,
    unavailable: 503,
    server_error: 500,
    internal: 500,
    deadline_exceeded: 504,
    invalid_argument: 400,
    permission_denied: 403,
    unauthenticated: 401,
};

/**
 * The provider-sent retry-after has TWO caps since 2026-10-25 (providers-
 * adapter P2). The parse site clamps to the HARD cap, so a hostile or huge
 * value can never park a retry loop whatever lane reads it; each lane then
 * applies its own ceiling in `retryDelay` — the default (the DM stream, the
 * pre-commit arbiter / detector) is 10 s, the background extraction lane and
 * the embed seed take 30 s (their budgets are 3 × 60 s and a whole-call
 * deadline), so a Gemini per-minute window is waited out instead of burning
 * the retry at 10 s and losing the Scribe pass.
 */
export const RETRY_AFTER_HARD_CAP_MS = 60_000;
export const RETRY_AFTER_CAP_MS = 10_000;
export const BACKGROUND_RETRY_AFTER_CAP_MS = 30_000;

/** A positive, finite millisecond wait clamped to the hard cap, else null. */
function clampRetryMs(ms) {
    if (ms == null || !Number.isFinite(ms) || ms <= 0) return null;
    return Math.min(ms, RETRY_AFTER_HARD_CAP_MS);
}

/**
 * `Retry-After` in milliseconds — delta-seconds or an HTTP-date — under the
 * hard cap; null when absent or junk. NOTE (2026-10-25, measured from the
 * deployed origin): `Retry-After` is not a CORS-safelisted response header,
 * so a browser reads it only when the provider's `Access-Control-Expose-
 * Headers` names it — xAI exposes `*`, OpenAI exposes `CF-Ray` alone, Google
 * exposes the reply's own header names. The body's copy of the same fact
 * (`parseBodyRetryDelayMs`) is readable everywhere and is the fallback.
 */
export function parseRetryAfterMs(headerValue) {
    const raw = String(headerValue || '').trim();
    if (!raw) return null;
    let ms = null;
    if (/^\d+$/.test(raw)) {
        ms = Number(raw) * 1000;
    } else {
        const at = Date.parse(raw);
        if (Number.isFinite(at)) ms = at - Date.now();
    }
    return clampRetryMs(ms);
}

/** Seconds out of Google's duration forms: "32s" / "32.5s", or `{ seconds, nanos }`. */
function durationSeconds(value) {
    if (typeof value === 'string') {
        const match = /^\s*(\d+(?:\.\d+)?)\s*s\s*$/i.exec(value);
        return match ? Number(match[1]) : null;
    }
    if (isRecord(value)) {
        const seconds = Number(value.seconds ?? 0);
        const nanos = Number(value.nanos ?? 0);
        if (!Number.isFinite(seconds) || !Number.isFinite(nanos)) return null;
        return seconds + nanos / 1e9;
    }
    return null;
}

/**
 * The retry delay a Google API error BODY carries, in milliseconds under the
 * hard cap, else null (2026-10-25 providers-adapter P2). Two places say it:
 * `error.details[]` holds a `google.rpc.RetryInfo` entry (`@type` ending in
 * `RetryInfo`) with `retryDelay` as "32s" / "32.5s" or `{ seconds, nanos }`,
 * and the message itself reads "Please retry in 32.5s". The body is readable
 * cross-origin where the `Retry-After` header is not, so both Gemini lanes
 * read it when the header is absent. Harmless for an OpenAI / xAI body (no
 * `details`, no such phrasing → null). Takes the parsed record or the raw
 * body text.
 */
export function parseBodyRetryDelayMs(body) {
    let record = body;
    if (typeof body === 'string') {
        try {
            record = JSON.parse(body);
        } catch {
            return null;
        }
    }
    const error = asRecord(asRecord(record).error);
    const details = Array.isArray(error.details) ? error.details : [];
    for (const detail of details) {
        if (!isRecord(detail) || !/RetryInfo$/.test(String(detail['@type'] || ''))) continue;
        const seconds = durationSeconds(detail.retryDelay);
        if (seconds != null) return clampRetryMs(seconds * 1000);
    }
    if (typeof error.message === 'string') {
        const match = /retry (?:in|after) (\d+(?:\.\d+)?)\s*(?:s\b|secs?\b|seconds?\b)/i.exec(error.message);
        if (match) return clampRetryMs(Number(match[1]) * 1000);
    }
    return null;
}

/**
 * A truncated stream looks complete but is missing its tail — usually the
 * trailing JSON event block. A clean close that never delivered a finish
 * reason is the same failure (dropped connection, proxy close, or a
 * mid-stream error payload as the final event) — the lenient no-reason pass
 * is only right for non-streaming. On a delivered reason, defer to the
 * provider's own completion guard (reason vocabularies differ).
 */
export function assertStreamComplete(finishReason, assertCompleteResponse) {
    if (!finishReason) {
        throw new Error('The connection dropped mid-response — the reply is incomplete. Please retry.');
    }
    assertCompleteResponse(finishReason);
}

/**
 * Completion-guard factory: a finish reason other than the provider's
 * "complete" value means the text is truncated or blocked — treating it as a
 * complete response silently drops the trailing JSON event block, so fail
 * loudly and let the caller surface a retryable error. Providers differ only
 * in reason vocabulary (Gemini STOP/MAX_TOKENS vs OpenAI-compatible
 * stop/length) and whether the truncation message names the reason. A falsy
 * reason passes — non-streaming responses may legitimately omit it; streams
 * gate that case via assertStreamComplete.
 */
export function makeCompletionGuard({ completeReason, truncatedReason, truncatedLabel = '' }) {
    return function assertCompleteResponse(finishReason) {
        if (!finishReason || finishReason === completeReason) return;
        if (finishReason === truncatedReason) {
            throw new Error(`The model hit its output token cap mid-response${truncatedLabel} — the reply would be truncated. Please retry.`);
        }
        throw new Error(`The model stopped early (${finishReason}) — the response is blocked or incomplete. Please retry or rephrase.`);
    };
}

/**
 * HTTP-error factory: one error shape for every provider. The string fallback
 * covers xAI's occasional string-shaped error bodies ({ "error": "..." }) and
 * is harmless for the object shape ({ "error": { "message": ... } }); an
 * object-valued `error` without a message falls through to statusText rather
 * than printing "[object Object]". `.status` lets the adapter retry
 * transient failures, and `.retryAfterMs` carries a `Retry-After` header so
 * a per-minute quota 429 is not burned through in three ~1 s attempts
 * (2026-09-06 audit) — or, when the browser cannot read the header (not
 * CORS-exposed), the BODY's own delay (`parseBodyRetryDelayMs`, 2026-10-25).
 */
export function makeHttpError(label) {
    return async function httpError(response) {
        // A body that parses to `null` threw out of this helper before
        // `.status`/`.retryAfterMs` stamped, so a 429/503 shaped that way was
        // never retried (2026-09-16 audit P2).
        // An ARRAY body is not a record either (2026-10-12): asRecord.
        const error = asRecord(await response.json().catch(() => ({})));
        const detail = error.error?.message
            || (typeof error.error === 'string' ? error.error : '')
            || response.statusText;
        const err = new Error(`${label} API error (${response.status}): ${detail}`);
        err.status = response.status;
        const retryAfterMs = parseRetryAfterMs(response.headers?.get?.('retry-after')) ?? parseBodyRetryDelayMs(error);
        if (retryAfterMs != null) err.retryAfterMs = retryAfterMs;
        return err;
    };
}
