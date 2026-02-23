/**
 * OpenAI API provider.
 * Uses the REST API directly via fetch.
 */

const OPENAI_API_BASE = 'https://api.openai.com/v1/chat/completions';

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
export async function sendOpenAIMessage({ apiKey, model, systemPrompt, messageHistory, userMessage }) {
    const response = await fetch(OPENAI_API_BASE, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
            model,
            messages: formatMessages(systemPrompt, messageHistory, userMessage),
            temperature: 0.9,
            max_tokens: 4096,
        }),
    });

    if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        throw new Error(`OpenAI API error (${response.status}): ${error.error?.message || response.statusText}`);
    }

    const data = await response.json();
    return data.choices?.[0]?.message?.content || '';
}

/**
 * Stream a message from OpenAI.
 */
export async function streamOpenAIMessage({ apiKey, model, systemPrompt, messageHistory, userMessage, onChunk, signal }) {
    const response = await fetch(OPENAI_API_BASE, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
            model,
            messages: formatMessages(systemPrompt, messageHistory, userMessage),
            temperature: 0.9,
            max_tokens: 4096,
            stream: true,
        }),
        signal,
    });

    if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        throw new Error(`OpenAI API error (${response.status}): ${error.error?.message || response.statusText}`);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let fullText = '';
    let buffer = '';

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
                    const text = parsed.choices?.[0]?.delta?.content || '';
                    if (text) {
                        fullText += text;
                        onChunk(text);
                    }
                } catch (e) {
                    // Ignore malformed lines
                }
            }
        }
    }

    return fullText;
}
