/**
 * Shared factory for OpenAI-compatible chat-completions providers.
 * OpenAI and xAI speak the same request/response shape, the same SSE stream
 * format, and the same finish_reason semantics — only the base URL, the error
 * label, and (for xAI) a key normalizer differ. Keeping one implementation
 * means stream-truncation fixes land once instead of being hand-copied.
 */
import { assertStreamComplete, makeCompletionGuard, makeHttpError, readSseStream } from './sse.js';

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

/**
 * Convert our message format to the OpenAI-compatible chat format.
 */
function formatMessages(systemPrompt, messageHistory, userMessage) {
    const messages = [
        { role: 'system', content: systemPrompt },
    ];

    for (const msg of messageHistory) {
        messages.push({
            // Only genuine assistant turns are the model's own; anything else
            // (user, and a `system` line a caller forgot to fold) is user-side
            // context, matching buildMessageWindow's own mapping.
            role: msg.role === 'assistant' ? 'assistant' : 'user',
            content: typeof msg.content === 'string' ? msg.content : String(msg.content ?? ''),
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
 * @returns {{ send: function, stream: function }}
 */
export function makeOpenAICompatProvider({ label, baseUrl, mapApiKey = (key) => key, maxTokensParam = 'max_tokens', temperatureUnsupported = () => false, maxOutputTokensFor = () => DEFAULT_MAX_TOKENS }) {
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
    async function send({ apiKey, model, systemPrompt, messageHistory, userMessage, temperature, maxOutputTokens, signal }) {
        const response = await fetch(baseUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${mapApiKey(apiKey)}`,
            },
            body: JSON.stringify({
                model,
                messages: formatMessages(systemPrompt, messageHistory, userMessage),
                ...(temperatureUnsupported(model) ? {} : { temperature: temperature ?? 0.9 }),
                [maxTokensParam]: Number.isFinite(maxOutputTokens) ? maxOutputTokens : maxOutputTokensFor(model),
            }),
            signal,
        });

        if (!response.ok) {
            throw await httpError(response);
        }

        const data = await response.json();
        const message = data.choices?.[0]?.message;
        if (message?.refusal) {
            throw refusalError(message.refusal);
        }
        assertCompleteResponse(data.choices?.[0]?.finish_reason);
        const content = message?.content;
        if (!content) {
            throw new Error('No response generated. The model may have been blocked or returned empty.');
        }
        return content;
    }

    /** Stream a message, calling onChunk with each text fragment. */
    async function stream({ apiKey, model, systemPrompt, messageHistory, userMessage, onChunk, signal, temperature }) {
        const response = await fetch(baseUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${mapApiKey(apiKey)}`,
            },
            body: JSON.stringify({
                model,
                messages: formatMessages(systemPrompt, messageHistory, userMessage),
                ...(temperatureUnsupported(model) ? {} : { temperature: temperature ?? 0.9 }),
                [maxTokensParam]: maxOutputTokensFor(model),
                stream: true,
            }),
            signal,
        });

        if (!response.ok) {
            throw await httpError(response);
        }

        let fullText = '';
        let refusalText = '';
        let finishReason = null;

        await readSseStream(response, (parsed) => {
            const choice = parsed.choices?.[0];
            if (choice?.finish_reason) finishReason = choice.finish_reason;
            const refusal = choice?.delta?.refusal;
            if (typeof refusal === 'string' && refusal) refusalText += refusal;
            const text = choice?.delta?.content || '';
            if (text) {
                fullText += text;
                onChunk(text);
            }
        });

        if (refusalText.trim()) {
            throw refusalError(refusalText);
        }
        assertStreamComplete(finishReason, assertCompleteResponse);
        return fullText;
    }

    return { send, stream };
}
