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
 * proven ceiling); raise if newer models with larger outputs are added.
 */
const MAX_TOKENS = 16384;

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
            role: msg.role === 'user' ? 'user' : 'assistant',
            content: msg.content,
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
 * @returns {{ send: function, stream: function }}
 */
export function makeOpenAICompatProvider({ label, baseUrl, mapApiKey = (key) => key, maxTokensParam = 'max_tokens', temperatureUnsupported = () => false }) {
    const httpError = makeHttpError(label);

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
                [maxTokensParam]: Number.isFinite(maxOutputTokens) ? maxOutputTokens : MAX_TOKENS,
            }),
            signal,
        });

        if (!response.ok) {
            throw await httpError(response);
        }

        const data = await response.json();
        assertCompleteResponse(data.choices?.[0]?.finish_reason);
        const content = data.choices?.[0]?.message?.content;
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
                [maxTokensParam]: MAX_TOKENS,
                stream: true,
            }),
            signal,
        });

        if (!response.ok) {
            throw await httpError(response);
        }

        let fullText = '';
        let finishReason = null;

        await readSseStream(response, (parsed) => {
            const choice = parsed.choices?.[0];
            if (choice?.finish_reason) finishReason = choice.finish_reason;
            const text = choice?.delta?.content || '';
            if (text) {
                fullText += text;
                onChunk(text);
            }
        });

        assertStreamComplete(finishReason, assertCompleteResponse);
        return fullText;
    }

    return { send, stream };
}
