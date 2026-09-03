/**
 * Shared SSE plumbing for streaming chat providers (Gemini + the
 * OpenAI-compatible factory). One reader means a stream-truncation fix lands
 * once instead of being hand-copied across providers — streamGeminiMessage was
 * the third hand-maintained copy of this skeleton (2026-08-30 audit).
 */

/**
 * Read an SSE response body to completion, invoking onEvent(parsedJson) for
 * every `data: ` event. `[DONE]` sentinels and malformed JSON lines are
 * skipped; an incomplete trailing line is buffered across reads.
 */
export async function readSseStream(response, onEvent) {
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || ''; // keep the incomplete line in the buffer

        for (const line of lines) {
            if (!line.startsWith('data: ')) continue;
            const data = line.slice(6).trim();
            if (data === '[DONE]') continue;
            let parsed;
            try {
                parsed = JSON.parse(data);
            } catch {
                continue; // Ignore malformed JSON lines
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
        }
    }
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
    const code = Number(streamError?.code ?? streamError?.status);
    if (Number.isInteger(code) && code >= 100 && code <= 599) err.status = code;
    return err;
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
 * transient failures.
 */
export function makeHttpError(label) {
    return async function httpError(response) {
        const error = await response.json().catch(() => ({}));
        const detail = error.error?.message
            || (typeof error.error === 'string' ? error.error : '')
            || response.statusText;
        const err = new Error(`${label} API error (${response.status}): ${detail}`);
        err.status = response.status;
        return err;
    };
}
