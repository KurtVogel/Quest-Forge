/**
 * Google Gemini API provider.
 * Uses the REST API directly (no SDK dependency needed).
 */

const GEMINI_API_BASE = 'https://generativelanguage.googleapis.com/v1alpha/models';
const GEMINI_EMBED_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';
// Google's current embedding model. Its default output is 3072 dimensions; 768 is
// an officially supported Matryoshka truncation that keeps the browser cache compact.
// The schema includes our asymmetric retrieval format because changing either the
// model or formatting makes previously cached vectors semantically incompatible.
const GEMINI_EMBED_MODEL = 'gemini-embedding-2';
export const GEMINI_EMBED_DIMENSIONS = 768;
export const GEMINI_EMBED_SCHEMA = `${GEMINI_EMBED_MODEL}:search-retrieval-v1:${GEMINI_EMBED_DIMENSIONS}`;

function formatEmbeddingInput(text, inputType) {
    const content = String(text || '').trim();
    if (inputType === 'query') {
        return `task: search result | query: ${content}`;
    }
    if (inputType === 'document') {
        return `title: none | text: ${content}`;
    }
    throw new Error(`Unsupported Gemini embedding input type: ${inputType}`);
}

/**
 * Output cap is a glitch-loop guard, NOT a budget. The old 4096 silently
 * truncated long turns — and the trailing JSON event block is exactly what a
 * truncation eats, so events (loot, XP, rolls) vanished without a trace.
 * Thinking-capable models also count reasoning tokens against this cap.
 */
const GEMINI_MAX_OUTPUT_TOKENS = 32768;

/**
 * A finishReason other than STOP means the text is truncated or blocked; treating
 * it as a complete response silently drops the trailing JSON event block. Fail
 * loudly instead — the caller surfaces a retryable error to the player.
 */
function assertCompleteResponse(finishReason) {
    if (!finishReason || finishReason === 'STOP') return;
    if (finishReason === 'MAX_TOKENS') {
        throw new Error('The model hit its output token cap mid-response (MAX_TOKENS) — the reply would be truncated. Please retry.');
    }
    throw new Error(`The model stopped early (${finishReason}) — the response is blocked or incomplete. Please retry or rephrase.`);
}

async function httpError(response) {
    const error = await response.json().catch(() => ({}));
    const err = new Error(`Gemini API error (${response.status}): ${error.error?.message || response.statusText}`);
    err.status = response.status; // lets the adapter retry transient failures
    return err;
}

/**
 * Thinking-capable models may return several parts per candidate (and flag
 * reasoning summaries with `thought: true`). Reading only parts[0] silently
 * drops the rest — which for a DM turn is the trailing JSON event block.
 */
function extractCandidateText(candidate) {
    const parts = candidate?.content?.parts;
    if (!Array.isArray(parts)) return '';
    let text = '';
    for (const part of parts) {
        if (part?.thought) continue; // reasoning summary, not response text
        if (typeof part?.text === 'string') text += part.text;
    }
    return text;
}

/**
 * Convert our message format to Gemini's content format.
 */
function formatMessages(systemPrompt, messageHistory, userMessage, temperature, { thinkingBudget, maxOutputTokens } = {}) {
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
            // 0.9 suits creative DM narration; extraction tasks (Scribe, journal,
            // roll policy) pass a low temperature for reliable JSON.
            temperature: temperature ?? 0.9,
            topP: 0.95,
            maxOutputTokens: Number.isFinite(maxOutputTokens) ? maxOutputTokens : GEMINI_MAX_OUTPUT_TOKENS,
            // Machinery calls (pure-JSON extraction, 2-4 per turn) pass 0 so
            // default-on thinking cannot burn reasoning tokens against the cap;
            // DM narration omits it and keeps the model's own default.
            ...(Number.isFinite(thinkingBudget) && { thinkingConfig: { thinkingBudget } }),
        },
    };
}

/**
 * Send a non-streaming message to Gemini.
 */
export async function sendGeminiMessage({ apiKey, model, systemPrompt, messageHistory, userMessage, temperature, thinkingBudget, maxOutputTokens, signal }) {
    const url = `${GEMINI_API_BASE}/${model}:generateContent`;
    const body = formatMessages(systemPrompt, messageHistory, userMessage, temperature, { thinkingBudget, maxOutputTokens });

    const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
        body: JSON.stringify(body),
        signal,
    });

    if (!response.ok) {
        throw await httpError(response);
    }

    const data = await response.json();
    const candidate = data.candidates?.[0];
    assertCompleteResponse(candidate?.finishReason);
    const text = extractCandidateText(candidate);
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
 * @param {{inputType?: 'document'|'query'}} [options]
 * @returns {Promise<number[]|null>}
 */
export async function embedText(apiKey, text, { inputType = 'document' } = {}) {
    if (!apiKey || !String(text || '').trim()) return null;

    const url = `${GEMINI_EMBED_BASE}/${GEMINI_EMBED_MODEL}:embedContent`;
    try {
        const formattedText = formatEmbeddingInput(text, inputType);
        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
            body: JSON.stringify({
                model: `models/${GEMINI_EMBED_MODEL}`,
                content: { parts: [{ text: formattedText }] },
                output_dimensionality: GEMINI_EMBED_DIMENSIONS,
            }),
            // RAG retrieval is awaited BEFORE the DM prompt is built — a stalled
            // embed call must fail into the null path, never hang the turn.
            signal: AbortSignal.timeout(30_000),
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
        if (!Array.isArray(values) || values.length !== GEMINI_EMBED_DIMENSIONS) {
            console.error(
                `[Gemini embed] Expected ${GEMINI_EMBED_DIMENSIONS} values from ${GEMINI_EMBED_MODEL}, received ${values?.length || 0}:`,
                data,
            );
            return null;
        }
        return values;
    } catch (err) {
        console.error('[Gemini embed] Request failed:', err);
        return null;
    }
}

/**
 * Batch variant of embedText: batchEmbedContents embeds up to 100 texts per
 * round trip (2026-08-08 audit: the per-item seed path cost a cold device
 * ~300 sequential trips before RAG was warm). Chunks internally, so callers
 * may pass any length. Returns an array aligned with `texts` — number[] per
 * success, null per empty/failed slot; a wholesale HTTP failure nulls that
 * chunk so callers skip those items exactly like the per-item path (the next
 * mount's seed retries whatever the cache is still missing).
 */
export async function embedTexts(apiKey, texts, { inputType = 'document' } = {}) {
    const list = Array.isArray(texts) ? texts : [];
    const results = new Array(list.length).fill(null);
    if (!apiKey || list.length === 0) return results;
    const sendable = [];
    list.forEach((text, index) => {
        if (String(text || '').trim()) sendable.push({ index, text });
    });

    const url = `${GEMINI_EMBED_BASE}/${GEMINI_EMBED_MODEL}:batchEmbedContents`;
    const BATCH_LIMIT = 100; // the API's per-call request ceiling
    for (let start = 0; start < sendable.length; start += BATCH_LIMIT) {
        const chunk = sendable.slice(start, start + BATCH_LIMIT);
        try {
            const response = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
                body: JSON.stringify({
                    requests: chunk.map(({ text }) => ({
                        model: `models/${GEMINI_EMBED_MODEL}`,
                        content: { parts: [{ text: formatEmbeddingInput(text, inputType) }] },
                        output_dimensionality: GEMINI_EMBED_DIMENSIONS,
                    })),
                }),
                // Seeding runs in the background at mount — a stalled batch must
                // fail into nulls (skip + retry next mount), never hang the seed.
                signal: AbortSignal.timeout(60_000),
            });
            if (!response.ok) {
                const body = await response.text().catch(() => '');
                console.error(
                    `[Gemini embed] Batch HTTP ${response.status} ${response.statusText} from ${GEMINI_EMBED_MODEL}:`,
                    body.slice(0, 500),
                );
                continue;
            }
            const data = await response.json();
            const embeddings = Array.isArray(data.embeddings) ? data.embeddings : [];
            chunk.forEach(({ index }, j) => {
                const values = embeddings[j]?.values;
                if (Array.isArray(values) && values.length === GEMINI_EMBED_DIMENSIONS) {
                    results[index] = values;
                }
            });
        } catch (err) {
            console.error('[Gemini embed] Batch request failed:', err);
        }
    }
    return results;
}

/**
 * Stream a message from Gemini.
 */
export async function streamGeminiMessage({ apiKey, model, systemPrompt, messageHistory, userMessage, onChunk, signal, temperature }) {
    const url = `${GEMINI_API_BASE}/${model}:streamGenerateContent?alt=sse`;
    const body = formatMessages(systemPrompt, messageHistory, userMessage, temperature);

    const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
        body: JSON.stringify(body),
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

        // Parse SSE events
        const lines = buffer.split('\n');
        buffer = lines.pop() || ''; // Keep incomplete line in buffer

        for (const line of lines) {
            if (line.startsWith('data: ')) {
                const jsonStr = line.slice(6).trim();
                if (jsonStr === '[DONE]') continue;

                try {
                    const data = JSON.parse(jsonStr);
                    const candidate = data.candidates?.[0];
                    if (candidate?.finishReason) finishReason = candidate.finishReason;
                    const text = extractCandidateText(candidate);
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

    // A truncated stream looks complete but is missing its tail — usually the JSON
    // event block. A clean close that never delivered a finishReason is the same
    // failure (dropped connection, proxy close, or a mid-stream error payload as
    // the final event) — the lenient no-reason pass is only right for non-streaming.
    if (!finishReason) {
        throw new Error('The connection dropped mid-response — the reply is incomplete. Please retry.');
    }
    assertCompleteResponse(finishReason);
    return fullText;
}
