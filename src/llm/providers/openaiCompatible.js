/**
 * Shared factory for OpenAI-compatible chat-completions providers.
 * OpenAI and xAI speak the same request/response shape, the same SSE stream
 * format, and the same finish_reason semantics — only the base URL, the error
 * label, and (for xAI) a key normalizer differ. Keeping one implementation
 * means stream-truncation fixes land once instead of being hand-copied.
 */

/**
 * Output cap is a glitch-loop guard, not a budget — 4096 silently truncated
 * long turns and ate the trailing JSON event block. 16384 is the gpt-4o family
 * completion ceiling (Grok accepts far larger outputs, so it matches this
 * proven ceiling); raise if newer models with larger outputs are added.
 */
const MAX_TOKENS = 16384;

/** A finish_reason of "length" means the reply was truncated mid-response. */
function assertCompleteResponse(finishReason) {
    if (!finishReason || finishReason === 'stop') return;
    if (finishReason === 'length') {
        throw new Error('The model hit its output token cap mid-response — the reply would be truncated. Please retry.');
    }
    throw new Error(`The model stopped early (${finishReason}) — the response is blocked or incomplete. Please retry or rephrase.`);
}

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
 * @returns {{ send: function, stream: function }}
 */
export function makeOpenAICompatProvider({ label, baseUrl, mapApiKey = (key) => key }) {
    async function httpError(response) {
        const error = await response.json().catch(() => ({}));
        // The string fallback covers xAI's occasional string-shaped error bodies
        // ({ "error": "Invalid API key" }); it is harmless for OpenAI's
        // { "error": { "message": ... } } shape.
        const err = new Error(`${label} API error (${response.status}): ${error.error?.message || error.error || response.statusText}`);
        err.status = response.status; // lets the adapter retry transient failures
        return err;
    }

    /** Send a non-streaming message. */
    async function send({ apiKey, model, systemPrompt, messageHistory, userMessage, temperature }) {
        const response = await fetch(baseUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${mapApiKey(apiKey)}`,
            },
            body: JSON.stringify({
                model,
                messages: formatMessages(systemPrompt, messageHistory, userMessage),
                temperature: temperature ?? 0.9,
                max_tokens: MAX_TOKENS,
            }),
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
                temperature: temperature ?? 0.9,
                max_tokens: MAX_TOKENS,
                stream: true,
            }),
            signal,
        });

        if (!response.ok) {
            throw await httpError(response);
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let fullText = '';
        let buffer = '';
        let finishReason = null;

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop() || '';

            for (const line of lines) {
                if (line.startsWith('data: ')) {
                    const data = line.slice(6).trim();
                    if (data === '[DONE]') continue;

                    try {
                        const parsed = JSON.parse(data);
                        const choice = parsed.choices?.[0];
                        if (choice?.finish_reason) finishReason = choice.finish_reason;
                        const text = choice?.delta?.content || '';
                        if (text) {
                            fullText += text;
                            onChunk(text);
                        }
                    } catch {
                        // Ignore malformed lines
                    }
                }
            }
        }

        // A truncated stream looks complete but is missing its tail — usually the JSON
        // event block. A clean close that never delivered a finish_reason is the same
        // failure (dropped connection or proxy close) — the lenient no-reason pass is
        // only right for non-streaming.
        if (!finishReason) {
            throw new Error('The connection dropped mid-response — the reply is incomplete. Please retry.');
        }
        assertCompleteResponse(finishReason);
        return fullText;
    }

    return { send, stream };
}
