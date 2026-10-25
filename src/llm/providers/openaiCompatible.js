/**
 * Shared factory for OpenAI-compatible chat-completions providers.
 * OpenAI and xAI speak the same request/response shape, the same SSE stream
 * format, and the same finish_reason semantics — only the base URL, the error
 * label, and (for xAI) a key normalizer differ. Keeping one implementation
 * means stream-truncation fixes land once instead of being hand-copied.
 */
import { asRecord, assertStreamComplete, historyText, isNetworkFailure, makeCompletionGuard, makeHttpError, readSseStream, reportUsage } from './sse.js';

/**
 * Output cap is a glitch-loop guard, not a budget — 4096 silently truncated
 * long turns and ate the trailing JSON event block. 16384 is the gpt-4o family
 * completion ceiling (Grok accepts far larger outputs, so it matches this
 * proven ceiling). Providers whose models count REASONING tokens against the
 * cap (OpenAI's gpt-5 family) pass a per-model `maxOutputTokensFor` — the
 * exact reason gemini.js runs at 32,768 (2026-09-06 audit).
 */
export const DEFAULT_MAX_TOKENS = 16384;

/** "length" means the reply was truncated mid-response. */
const assertCompleteResponse = makeCompletionGuard({
    completeReason: 'stop',
    truncatedReason: 'length',
});

/** The split is usable when both halves are non-empty strings. */
function usableParts(parts) {
    return !!parts && typeof parts.prefix === 'string' && parts.prefix && typeof parts.dynamic === 'string' && parts.dynamic;
}

/**
 * Convert our message format to the OpenAI-compatible chat format.
 *
 * The prefix boundary is TOLD to the provider (memory-research M1,
 * 2026-10-14): with `systemPromptParts` the system prompt rides as TWO
 * leading system messages — the byte-stable prefix first, the dynamic half
 * second. xAI matches its cache at message granularity, so the prefix
 * message is the whole fix there; OpenAI gpt-5.6+ matches only at cache
 * breakpoints, so `explicitCache` puts one on the prefix message's text
 * part. One message, as before, when no split is given.
 */
export function formatMessages(systemPrompt, messageHistory, userMessage, { systemPromptParts = null, explicitCache = false } = {}) {
    const messages = usableParts(systemPromptParts)
        ? [
            {
                role: 'system',
                content: explicitCache
                    ? [{ type: 'text', text: systemPromptParts.prefix, prompt_cache_breakpoint: { mode: 'explicit' } }]
                    : systemPromptParts.prefix,
            },
            { role: 'system', content: systemPromptParts.dynamic },
        ]
        : [{ role: 'system', content: systemPrompt }];

    for (const msg of messageHistory) {
        messages.push({
            // Only genuine assistant turns are the model's own; anything else
            // (user, and a `system` line a caller forgot to fold) is user-side
            // context, matching buildMessageWindow's own mapping.
            role: msg.role === 'assistant' ? 'assistant' : 'user',
            content: historyText(msg.content),
        });
    }

    messages.push({ role: 'user', content: userMessage });
    return messages;
}

/**
 * Build an OpenAI-compatible provider.
 *
 * @param {object} options
 * @param {string} options.label - Human-readable provider name for error messages.
 * @param {string} options.baseUrl - Full chat-completions endpoint URL.
 * @param {function} [options.mapApiKey] - Optional key normalizer applied before the
 *   Authorization header (e.g. xAI's mandatory `xai-` prefix repair).
 * @param {string} [options.maxTokensParam] - Wire name of the output-cap field.
 *   OpenAI deprecated `max_tokens` in favor of `max_completion_tokens` (post-4o
 *   models 400 on the old name), while xAI still speaks `max_tokens` — the one
 *   request-shape divergence between the two (2026-08-08 audit).
 * @param {function} [options.temperatureUnsupported] - Predicate on the model id;
 *   when true the `temperature` field is omitted entirely. OpenAI's reasoning
 *   models (gpt-5 family, o-series) 400 on any non-default temperature, while
 *   xAI's grok models accept it — the second request-shape divergence
 *   (2026-08-22 OpenAI playtest).
 * @param {function} [options.maxOutputTokensFor] - Output cap by model id
 *   (defaults to DEFAULT_MAX_TOKENS for every model).
 * @param {function} [options.explicitCacheFor] - Predicate on the model id:
 *   true sends `prompt_cache_options: { mode: 'explicit' }` and a
 *   `prompt_cache_breakpoint` on the prefix message (OpenAI gpt-5.6+). A 400
 *   naming either field drops both for the rest of the session (one-time
 *   fallback, the affinity header's pattern) and tells the caller.
 * @returns {{ send: function, stream: function }}
 */
export function makeOpenAICompatProvider({ label, baseUrl, mapApiKey = (key) => key, maxTokensParam = 'max_tokens', temperatureUnsupported = () => false, maxOutputTokensFor = () => DEFAULT_MAX_TOKENS, streamUsage = false, extraHeaders = () => ({}), explicitCacheFor = () => false }) {
    let explicitCacheRejected = false;
    const wantsExplicitCache = (args) => !explicitCacheRejected && usableParts(args.systemPromptParts) && !!explicitCacheFor(args.model);
    const namesCacheField = (error) => /prompt_cache_(?:breakpoint|options)/i.test(String(error?.message || ''));

    /**
     * One request, with the explicit-cache fields when the model takes them
     * and ONE re-send without them on a 400 that names them (the unverified
     * step: a text part with a breakpoint on a Chat Completions `system`
     * message). The retry is the same request minus two fields; the player
     * never sees the first reply.
     */
    async function requestWithCacheFallback(args, bodyFor) {
        const explicit = wantsExplicitCache(args);
        const init = (body) => ({
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${mapApiKey(args.apiKey)}`,
            },
            body: JSON.stringify(body),
            signal: args.signal,
        });
        let response = await fetchWithExtraHeaders(args, init(bodyFor(explicit)));
        if (!response.ok && explicit && response.status === 400) {
            const error = await httpError(response);
            if (!namesCacheField(error)) throw error;
            explicitCacheRejected = true;
            args.onCacheBreakpointRejected?.();
            response = await fetchWithExtraHeaders(args, init(bodyFor(false)));
        }
        if (!response.ok) throw await httpError(response);
        return response;
    }

    /**
     * One fetch with the provider's extra headers (2026-09-30 cache telemetry:
     * xAI's `x-grok-conv-id` routes a conversation to one server so its
     * per-server cache can hit). A custom header costs a CORS preflight; if
     * the provider's edge does not allow it the browser fails the request
     * before any byte, as a network TypeError — then the request is sent
     * ONCE more without the header, so a header the edge rejects can never
     * take the DM lane down. A caller abort passes.
     *
     * The refusal is JUDGED by the plain re-send and REMEMBERED for the
     * session (2026-10-25 providers-adapter P2): a network TypeError on the
     * headered fetch is also what an OFFLINE call looks like, so the header is
     * proven refused only when the plain send gets a response (any status) —
     * then `headerRejected` drops the extra headers from every later call of
     * this factory instance (the `explicitCacheRejected` twin) and the caller
     * is told once. When the plain send ALSO fails as a network failure it was
     * never the header: the original error is rethrown with no note. The old
     * shape sent every offline xAI call twice per attempt and posted a false
     * "refused the header" inspector note on each.
     */
    let headerRejected = false;
    async function fetchWithExtraHeaders(args, init) {
        const extra = headerRejected ? {} : (extraHeaders(args) || {});
        const keys = Object.keys(extra);
        if (keys.length === 0) return fetch(baseUrl, init);
        let headeredError;
        try {
            return await fetch(baseUrl, { ...init, headers: { ...init.headers, ...extra } });
        } catch (error) {
            if (args.signal?.aborted || !isNetworkFailure(error)) throw error;
            headeredError = error;
        }
        let plain;
        try {
            plain = await fetch(baseUrl, init);
        } catch (plainError) {
            // Offline, a blocked host, an abort: nothing the header did.
            if (args.signal?.aborted || !isNetworkFailure(plainError)) throw plainError;
            throw headeredError;
        }
        headerRejected = true;
        args.onHeaderRejected?.(keys);
        return plain;
    }
    const httpError = makeHttpError(label);

    /**
     * A refusal is a first-class reply shape on this API (`message.refusal` /
     * `delta.refusal` with `content: null`, `finish_reason: 'stop'`). Read
     * only `content`, and a refusal RESOLVES to "" — which the orchestrator
     * used to commit as a blank DM turn with no error and the refusal text
     * never shown (2026-09-06 P1). Thrown instead: visible, and DELETE_MESSAGE
     * exists to scrub exactly this.
     */
    const refusalError = (refusal) =>
        new Error(`The model declined to respond: ${String(refusal).trim().slice(0, 500)} — edit or remove (✕) the message it objected to, or rephrase, then continue.`);

    /** Send a non-streaming message. (thinkingBudget is Gemini-only; ignored here.) */
    async function send(args) {
        const { model, systemPrompt, systemPromptParts, messageHistory, userMessage, temperature, maxOutputTokens, onUsage } = args;
        const response = await requestWithCacheFallback(args, (explicitCache) => ({
            model,
            messages: formatMessages(systemPrompt, messageHistory, userMessage, { systemPromptParts, explicitCache }),
            ...(temperatureUnsupported(model) ? {} : { temperature: temperature ?? 0.9 }),
            [maxTokensParam]: Number.isFinite(maxOutputTokens) ? maxOutputTokens : maxOutputTokensFor(model),
            ...(explicitCache ? { prompt_cache_options: { mode: 'explicit' } } : {}),
        }));

        const data = asRecord(await response.json());
        const message = data.choices?.[0]?.message;
        if (message?.refusal) {
            throw refusalError(message.refusal);
        }
        assertCompleteResponse(data.choices?.[0]?.finish_reason);
        reportUsage(onUsage, data.usage, normalizeOpenAIUsage);
        const content = contentText(message?.content);
        if (!content) {
            throw new Error('No response generated. The model may have been blocked or returned empty.');
        }
        return content;
    }

    /** Stream a message, calling onChunk with each text fragment. */
    async function stream(args) {
        const { model, systemPrompt, systemPromptParts, messageHistory, userMessage, onChunk, temperature, maxOutputTokens, onUsage, onActivity } = args;
        const response = await requestWithCacheFallback(args, (explicitCache) => ({
            model,
            messages: formatMessages(systemPrompt, messageHistory, userMessage, { systemPromptParts, explicitCache }),
            ...(temperatureUnsupported(model) ? {} : { temperature: temperature ?? 0.9 }),
            // A passed cap is honored like the send's (2026-10-12 — the
            // stream ignored it); the DM lane passes none and keeps the
            // per-model cap (REASONING_MAX_TOKENS on a reasoning model).
            [maxTokensParam]: Number.isFinite(maxOutputTokens) ? maxOutputTokens : maxOutputTokensFor(model),
            stream: true,
            // OpenAI reports usage on a stream only when asked; the final
            // chunk then carries it (cached_tokens included). xAI sends it
            // unasked, so the flag is per provider.
            ...(streamUsage ? { stream_options: { include_usage: true } } : {}),
            ...(explicitCache ? { prompt_cache_options: { mode: 'explicit' } } : {}),
        }));

        let fullText = '';
        let refusalText = '';
        let finishReason = null;
        let usage = null;

        // `onActivity` is the adapter's idle timer, armed per READ (bytes, not
        // text — 2026-10-25): a reasoning model's empty keep-alive delta is life.
        await readSseStream(response, (parsed) => {
            if (parsed.usage && typeof parsed.usage === 'object') usage = parsed.usage;
            const choice = parsed.choices?.[0];
            if (choice?.finish_reason) finishReason = choice.finish_reason;
            const refusal = choice?.delta?.refusal;
            if (typeof refusal === 'string' && refusal) refusalText += refusal;
            const text = contentText(choice?.delta?.content);
            if (text) {
                fullText += text;
                onChunk(text);
            }
        }, { onActivity });

        if (refusalText.trim()) {
            throw refusalError(refusalText);
        }
        assertStreamComplete(finishReason, assertCompleteResponse);
        reportUsage(onUsage, usage, normalizeOpenAIUsage);
        return fullText;
    }

    return { send, stream };
}

/**
 * Token usage in the adapter's one shape (2026-09-30 cache telemetry):
 * `{ promptTokens, cachedTokens, writtenTokens, outputTokens }` from an
 * OpenAI-compatible `usage` object — `prompt_tokens`,
 * `prompt_tokens_details.cached_tokens` (OpenAI and xAI report the cache hit
 * there), `prompt_tokens_details.cache_write_tokens` (OpenAI's 1.25× cache
 * WRITE, 2026-10-14 — the field the 09-30 telemetry lacked), `completion_tokens`.
 * Missing or non-numeric fields read as null / 0; a throw in the callback is
 * the caller's and never fails the reply.
 */
export function normalizeOpenAIUsage(usage) {
    if (!usage || typeof usage !== 'object') return null;
    const num = (value) => (Number.isFinite(value) ? value : null);
    const promptTokens = num(usage.prompt_tokens);
    if (promptTokens === null) return null;
    return {
        promptTokens,
        cachedTokens: num(usage.prompt_tokens_details?.cached_tokens) ?? 0,
        writtenTokens: num(usage.prompt_tokens_details?.cache_write_tokens) ?? 0,
        outputTokens: num(usage.completion_tokens),
    };
}

/**
 * Text out of an OpenAI-compatible `content` (2026-09-16 audit P2): a string
 * as-is, a content-parts array joined on its string `text` parts (compat
 * proxies emit these), anything else '' — an object delta used to stream
 * "[object Object]" to the player and commit it to the transcript.
 */
export function contentText(content) {
    if (typeof content === 'string') return content;
    if (Array.isArray(content)) {
        return content.map(part => (typeof part === 'string' ? part : (typeof part?.text === 'string' ? part.text : ''))).join('');
    }
    return '';
}
