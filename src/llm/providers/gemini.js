/**
 * Google Gemini API provider.
 * Uses the REST API directly (no SDK dependency needed).
 */

const GEMINI_API_BASE = 'https://generativelanguage.googleapis.com/v1alpha/models';
const GEMINI_EMBED_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';
// gemini-embedding-001 is the GA replacement for text-embedding-004, which was
// retired on 2026-01-14. Default output is 3072-dim; we truncate to 768 to keep
// cached vectors compact and stay compatible with existing IndexedDB entries.
const GEMINI_EMBED_MODEL = 'gemini-embedding-001';
const GEMINI_EMBED_DIMENSIONS = 768;

/**
 * Convert our message format to Gemini's content format.
 */
function formatMessages(systemPrompt, messageHistory, userMessage) {
    const contents = [];

    // Convert history
    for (const msg of messageHistory) {
        contents.push({
            role: msg.role === 'user' ? 'user' : 'model',
            parts: [{ text: msg.content }],
        });
    }

    // Add new user message
    contents.push({
        role: 'user',
        parts: [{ text: userMessage }],
    });

    return {
        system_instruction: {
            parts: [{ text: systemPrompt }],
        },
        contents,
        generationConfig: {
            temperature: 0.9,
            topP: 0.95,
            maxOutputTokens: 4096,
        },
    };
}

/**
 * Send a non-streaming message to Gemini.
 */
export async function sendGeminiMessage({ apiKey, model, systemPrompt, messageHistory, userMessage }) {
    const url = `${GEMINI_API_BASE}/${model}:generateContent`;
    const body = formatMessages(systemPrompt, messageHistory, userMessage);

    const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
        body: JSON.stringify(body),
    });

    if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        throw new Error(`Gemini API error (${response.status}): ${error.error?.message || response.statusText}`);
    }

    const data = await response.json();
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) {
        throw new Error('No response generated. The model may have been blocked or returned empty.');
    }
    return text;
}

/**
 * Generate a text embedding vector using Gemini's embedding model.
 * Returns a number[] (768 dimensions) or null on failure.
 * @param {string} apiKey
 * @param {string} text - Text to embed
 * @returns {Promise<number[]|null>}
 */
export async function embedText(apiKey, text) {
    const url = `${GEMINI_EMBED_BASE}/${GEMINI_EMBED_MODEL}:embedContent`;
    try {
        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
            body: JSON.stringify({
                model: `models/${GEMINI_EMBED_MODEL}`,
                content: { parts: [{ text }] },
                output_dimensionality: GEMINI_EMBED_DIMENSIONS,
            }),
        });
        if (!response.ok) {
            const body = await response.text().catch(() => '');
            console.error(
                `[Gemini embed] HTTP ${response.status} ${response.statusText} from ${GEMINI_EMBED_MODEL}:`,
                body.slice(0, 500),
            );
            return null;
        }
        const data = await response.json();
        const values = data.embedding?.values;
        if (!values?.length) {
            console.error('[Gemini embed] Empty/missing embedding.values in response:', data);
            return null;
        }
        return values;
    } catch (err) {
        console.error('[Gemini embed] Request failed:', err);
        return null;
    }
}

/**
 * Stream a message from Gemini.
 */
export async function streamGeminiMessage({ apiKey, model, systemPrompt, messageHistory, userMessage, onChunk, signal }) {
    const url = `${GEMINI_API_BASE}/${model}:streamGenerateContent?alt=sse`;
    const body = formatMessages(systemPrompt, messageHistory, userMessage);

    const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
        body: JSON.stringify(body),
        signal,
    });

    if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        throw new Error(`Gemini API error (${response.status}): ${error.error?.message || response.statusText}`);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let fullText = '';
    let buffer = '';

    while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });

        // Parse SSE events
        const lines = buffer.split('\n');
        buffer = lines.pop() || ''; // Keep incomplete line in buffer

        for (const line of lines) {
            if (line.startsWith('data: ')) {
                const jsonStr = line.slice(6).trim();
                if (jsonStr === '[DONE]') continue;

                try {
                    const data = JSON.parse(jsonStr);
                    const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
                    if (text) {
                        fullText += text;
                        onChunk(text);
                    }
                } catch {
                    // Ignore malformed JSON lines
                }
            }
        }
    }

    return fullText;
}
