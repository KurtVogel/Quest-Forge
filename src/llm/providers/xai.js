/**
 * xAI (Grok) API provider for DM narration.
 * The chat endpoint is OpenAI-compatible (same request/response shape, same
 * SSE stream format, same finish_reason semantics), so this mirrors openai.js
 * against api.x.ai. Only narration runs here — the memory machinery (RAG,
 * Scribe & co.) stays on Gemini regardless of the DM provider.
 */
import { normalizeXaiApiKey } from './xaiKey.js';

const XAI_API_BASE = 'https://api.x.ai/v1/chat/completions';

/**
 * Output cap is a glitch-loop guard, not a budget — long DM turns must keep
 * their trailing JSON event block. Grok models accept far larger outputs, so
 * this matches the OpenAI provider's proven ceiling.
 */
const XAI_MAX_TOKENS = 16384;

/** A finish_reason of "length" means the reply was truncated mid-response. */
function assertCompleteResponse(finishReason) {
    if (!finishReason || finishReason === 'stop') return;
    if (finishReason === 'length') {
        throw new Error('The model hit its output token cap mid-response — the reply would be truncated. Please retry.');
    }
    throw new Error(`The model stopped early (${finishReason}) — the response is blocked or incomplete. Please retry or rephrase.`);
}

async function httpError(response) {
    const error = await response.json().catch(() => ({}));
    const err = new Error(`xAI API error (${response.status}): ${error.error?.message || error.error || response.statusText}`);
    err.status = response.status; // lets the adapter retry transient failures
    return err;
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
 * Send a non-streaming message to xAI.
 */
export async function sendXaiMessage({ apiKey, model, systemPrompt, messageHistory, userMessage, temperature }) {
    const response = await fetch(XAI_API_BASE, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${normalizeXaiApiKey(apiKey)}`,
        },
        body: JSON.stringify({
            model,
            messages: formatMessages(systemPrompt, messageHistory, userMessage),
            temperature: temperature ?? 0.9,
            max_tokens: XAI_MAX_TOKENS,
        }),
    });

    if (!response.ok) {
        throw await httpError(response);
    }

    const data = await response.json();
    assertCompleteResponse(data.choices?.[0]?.finish_reason);
    return data.choices?.[0]?.message?.content || '';
}

/**
 * Stream a message from xAI.
 */
export async function streamXaiMessage({ apiKey, model, systemPrompt, messageHistory, userMessage, onChunk, signal, temperature }) {
    const response = await fetch(XAI_API_BASE, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${normalizeXaiApiKey(apiKey)}`,
        },
        body: JSON.stringify({
            model,
            messages: formatMessages(systemPrompt, messageHistory, userMessage),
            temperature: temperature ?? 0.9,
            max_tokens: XAI_MAX_TOKENS,
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
    // event block. Surface it as an error so the turn is retried, not half-applied.
    assertCompleteResponse(finishReason);
    return fullText;
}
