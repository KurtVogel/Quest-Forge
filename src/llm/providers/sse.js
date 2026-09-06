/**
 * Shared SSE plumbing for streaming chat providers (Gemini + the
 * OpenAI-compatible factory). One reader means a stream-truncation fix lands
 * once instead of being hand-copied across providers — streamGeminiMessage was
 * the third hand-maintained copy of this skeleton (2026-08-30 audit).
 */

/**
 * Read an SSE response body to completion, invoking onEvent(parsedJson) for
 * every `data:` event. `[DONE]` sentinels and malformed JSON lines are
 * skipped; an incomplete trailing line is buffered across reads, and a final
 * line the server never terminated is still delivered when the body ends.
 * The field separator is `data:` with an OPTIONAL space — both are valid
 * SSE, and a proxy in a player's path may emit either (2026-09-06 audit).
 */
export async function readSseStream(response, onEvent) {
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
        const streamError = parsed && typeof parsed === 'object' ? parsed.error : null;
        if (streamError) {
            throw makeStreamError(streamError);
        }
        onEvent(parsed);
    };

    while (true) {
        const { done, value } = await reader.read();
        if (done) break;

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
 * `Retry-After` in milliseconds — delta-seconds or an HTTP-date — capped so a
 * hostile/huge header can never park the retry loop; null when absent or junk.
 */
export const RETRY_AFTER_CAP_MS = 10_000;
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
    if (ms == null || !Number.isFinite(ms) || ms <= 0) return null;
    return Math.min(ms, RETRY_AFTER_CAP_MS);
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
 * (2026-09-06 audit).
 */
export function makeHttpError(label) {
    return async function httpError(response) {
        const error = await response.json().catch(() => ({}));
        const detail = error.error?.message
            || (typeof error.error === 'string' ? error.error : '')
            || response.statusText;
        const err = new Error(`${label} API error (${response.status}): ${detail}`);
        err.status = response.status;
        const retryAfterMs = parseRetryAfterMs(response.headers?.get?.('retry-after'));
        if (retryAfterMs != null) err.retryAfterMs = retryAfterMs;
        return err;
    };
}
