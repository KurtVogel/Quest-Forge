/**
 * OpenAI API provider.
 * Uses the REST API directly via fetch.
 */

const OPENAI_API_BASE = 'https://api.openai.com/v1/chat/completions';

/**
 * Output cap is a glitch-loop guard, not a budget — 4096 silently truncated
 * long turns and ate the trailing JSON event block. 16384 is the gpt-4o family
 * completion ceiling; raise if newer models with larger outputs are added.
 */
const OPENAI_MAX_TOKENS = 16384;

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
    const err = new Error(`OpenAI API error (${response.status}): ${error.error?.message || response.statusText}`);
    err.status = response.status; // lets the adapter retry transient failures
    return err;
}

/**
 * Convert our message format to OpenAI's chat format.
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
 * Send a non-streaming message to OpenAI.
 */
export async function sendOpenAIMessage({ apiKey, model, systemPrompt, messageHistory, userMessage, temperature }) {
    const response = await fetch(OPENAI_API_BASE, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
            model,
            messages: formatMessages(systemPrompt, messageHistory, userMessage),
            temperature: temperature ?? 0.9,
            max_tokens: OPENAI_MAX_TOKENS,
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
 * Stream a message from OpenAI.
 */
export async function streamOpenAIMessage({ apiKey, model, systemPrompt, messageHistory, userMessage, onChunk, signal, temperature }) {
    const response = await fetch(OPENAI_API_BASE, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
            model,
            messages: formatMessages(systemPrompt, messageHistory, userMessage),
            temperature: temperature ?? 0.9,
            max_tokens: OPENAI_MAX_TOKENS,
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
