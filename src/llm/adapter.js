/**
 * Provider-agnostic LLM adapter.
 * Routes requests to the appropriate provider implementation.
 */
import { sendGeminiMessage, streamGeminiMessage } from './providers/gemini.js';
import { sendOpenAIMessage, streamOpenAIMessage } from './providers/openai.js';
import { sendXaiMessage, streamXaiMessage } from './providers/xai.js';
import { isNetworkFailure } from './providers/sse.js';

const providers = {
    gemini: { send: sendGeminiMessage, stream: streamGeminiMessage },
    openai: { send: sendOpenAIMessage, stream: streamOpenAIMessage },
    xai: { send: sendXaiMessage, stream: streamXaiMessage },
};

/** Transient failures worth retrying: rate limits, server hiccups, dropped connections. */
const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504]);

// fetch() rejects with a TypeError on network failure (no HTTP status at all), but
// so does any programming bug inside a provider — retrying those only masks the bug
// behind ~3s of pointless backoff. isNetworkFailure matches only the browsers'
// network-failure messages.
function isRetryableError(error) {
    if (RETRYABLE_STATUS.has(error?.status)) return true;
    return isNetworkFailure(error);
}

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Browser fetch never times out on its own: a stalled connection (no response,
 * no error) used to hang the awaiting turn forever — three call sites block the
 * turn pre-commit (2026-08-08 audit P1). Every non-streaming call now aborts
 * after this long and retries like any other transient failure.
 */
const DEFAULT_SEND_TIMEOUT_MS = 90_000;

/**
 * The streaming twin (2026-09-16 audit P2): a proxy that accepts the POST and
 * never sends a byte, or stops mid-reply without closing, parked the DM turn
 * in "waiting" forever — the 2026-08-08 stall class one lane over. An idle
 * timer aborts the stream when no chunk has arrived for this long (reset on
 * every chunk, so a long reply is never cut for being long); the same 90 s
 * the non-streaming guard uses, because reasoning models can think that
 * long before the first token.
 */
export const DEFAULT_STREAM_IDLE_TIMEOUT_MS = 90_000;

/**
 * Send a message to the configured LLM provider.
 *
 * Non-streaming calls (Scribe, journal, roll policy, front generation) retry
 * transient failures with backoff — a single 429/503 must not silently cost the
 * campaign a memory extraction or loot audit. Streaming (the visible DM turn)
 * never retries here: the player has UI-level retry paths and partial output.
 *
 * @param {object} options
 * @param {string} options.provider - Provider name ('gemini' | 'openai')
 * @param {string} options.apiKey - API key
 * @param {string} options.model - Model identifier
 * @param {string} options.systemPrompt - System prompt
 * @param {Array} options.messageHistory - Previous messages [{role, content}]
 * @param {string} options.userMessage - New user message
 * @param {number} [options.temperature] - Sampling temperature; use low values
 *   (~0.2) for JSON extraction tasks, omit for creative DM narration (0.9).
 * @param {number} [options.thinkingBudget] - Explicit reasoning-token budget
 *   (Gemini only; pass 0 for pure-JSON extraction tasks). Omit for DM defaults.
 * @param {number} [options.maxOutputTokens] - Per-call output cap override.
 * @param {number} [options.timeoutMs] - Stall guard; a call this old is aborted
 *   and retried (default 90s).
 * @param {AbortSignal} [options.signal] - External cancel; never retried.
 * @returns {Promise<string>} LLM response text
 */
export async function sendMessage({ provider, apiKey, model, systemPrompt, messageHistory, userMessage, temperature, thinkingBudget, maxOutputTokens, timeoutMs = DEFAULT_SEND_TIMEOUT_MS, signal }) {
    const p = providers[provider];
    if (!p) throw new Error(`Unknown LLM provider: "${provider}"`);
    if (!apiKey) throw new Error('API key is required. Please set it in Settings.');

    const MAX_RETRIES = 2;
    for (let attempt = 0; ; attempt++) {
        if (signal?.aborted) throw new DOMException('The request was aborted.', 'AbortError');
        // Per-attempt controller: the stall timer must not leak an abort into a
        // later retry, and an external caller signal cancels every attempt.
        const controller = new AbortController();
        const onExternalAbort = () => controller.abort();
        signal?.addEventListener('abort', onExternalAbort, { once: true });
        const stallTimer = setTimeout(() => controller.abort(), timeoutMs);
        try {
            return await p.send({ apiKey, model, systemPrompt, messageHistory, userMessage, temperature, thinkingBudget, maxOutputTokens, signal: controller.signal });
        } catch (error) {
            const stalled = error?.name === 'AbortError' && !signal?.aborted;
            if (signal?.aborted) throw error; // caller cancelled — never retry
            if (!stalled && (attempt >= MAX_RETRIES || !isRetryableError(error))) throw error;
            if (stalled && attempt >= MAX_RETRIES) {
                throw new Error(`${provider} request stalled — no response after ${Math.round(timeoutMs / 1000)}s (${MAX_RETRIES + 1} attempts).`);
            }
            const reason = stalled ? `stalled after ${Math.round(timeoutMs / 1000)}s` : error.message;
            // A `Retry-After` the provider sent wins over the default backoff —
            // a per-minute quota 429 burned all three attempts in ~3 s and lost
            // the Scribe/journal extraction (2026-09-06). Capped in sse.js.
            const backoff = 1000 * 2 ** attempt + Math.random() * 250;
            const delay = Math.max(backoff, Number.isFinite(error?.retryAfterMs) ? error.retryAfterMs : 0);
            console.warn(`[LLM Adapter] Transient ${provider} failure (${reason}); retry ${attempt + 1}/${MAX_RETRIES} in ~${Math.round(delay)}ms.`);
            await sleep(delay);
        } finally {
            clearTimeout(stallTimer);
            signal?.removeEventListener('abort', onExternalAbort);
        }
    }
}

/**
 * Stream a message from the configured LLM provider.
 * Calls onChunk with each text fragment as it arrives.
 * @param {object} options - Same as sendMessage
 * @param {function} options.onChunk - Callback receiving each text chunk
 * @param {AbortSignal} [options.signal] - Optional abort signal
 * @returns {Promise<string>} Complete response text
 */
export async function streamMessage({ provider, apiKey, model, systemPrompt, messageHistory, userMessage, onChunk, signal, temperature, idleTimeoutMs = DEFAULT_STREAM_IDLE_TIMEOUT_MS }) {
    const p = providers[provider];
    if (!p) throw new Error(`Unknown LLM provider: "${provider}"`);
    if (!apiKey) throw new Error('API key is required. Please set it in Settings.');
    if (signal?.aborted) throw new DOMException('The request was aborted.', 'AbortError');

    // Idle stall guard: our own controller so the caller's Stop button and the
    // stall both abort the fetch, while only the stall is renamed — a
    // deliberate cancel must still surface as an AbortError.
    const controller = new AbortController();
    const onExternalAbort = () => controller.abort();
    signal?.addEventListener('abort', onExternalAbort, { once: true });
    let stalled = false;
    let idleTimer = null;
    const armIdleTimer = () => {
        clearTimeout(idleTimer);
        idleTimer = setTimeout(() => { stalled = true; controller.abort(); }, idleTimeoutMs);
    };
    const guardedOnChunk = (chunk) => {
        armIdleTimer();
        onChunk?.(chunk);
    };
    armIdleTimer();
    try {
        const result = await p.stream({ apiKey, model, systemPrompt, messageHistory, userMessage, onChunk: guardedOnChunk, signal: controller.signal, temperature });
        if (import.meta.env.DEV) {
            console.log('[LLM Adapter] Full response received, length:', result.length);
            console.log('[LLM Adapter] Contains ```json:', result.includes('```json'));
            console.log('[LLM Adapter] Contains requested_rolls:', result.includes('requested_rolls'));
            console.log('[LLM Adapter] Response tail (last 300 chars):', result.slice(-300));
        }
        return result;
    } catch (error) {
        if (stalled && !signal?.aborted) {
            throw new Error(`${provider} stream stalled — no data for ${Math.round(idleTimeoutMs / 1000)}s. Please retry.`);
        }
        throw error;
    } finally {
        clearTimeout(idleTimer);
        signal?.removeEventListener('abort', onExternalAbort);
    }
}

/**
 * Available providers and their models.
 */
export const PROVIDERS = {
    gemini: {
        name: 'Google Gemini',
        models: [
            { id: 'gemini-3.1-pro-preview', name: 'Gemini 3.1 Pro (Recommended)', description: 'Most capable Gemini model' },
            { id: 'gemini-3-flash-preview', name: 'Gemini 3 Flash', description: 'Fast frontier-class, great value' },
            { id: 'gemini-3.1-flash-lite', name: 'Gemini 3.1 Flash-Lite', description: 'Cheapest current-gen' },
            { id: 'gemini-2.5-flash', name: 'Gemini 2.5 Flash', description: 'Previous gen, fast and affordable' },
            { id: 'gemini-2.5-pro', name: 'Gemini 2.5 Pro', description: 'Previous gen pro model' },
        ],
    },
    openai: {
        name: 'OpenAI',
        models: [
            { id: 'gpt-5.6-terra', name: 'GPT-5.6 Terra (Recommended)', description: 'Balanced current-gen tier' },
            { id: 'gpt-5.6-sol', name: 'GPT-5.6 Sol', description: 'Highest quality, priciest' },
            { id: 'gpt-5.6-luna', name: 'GPT-5.6 Luna', description: 'Fast, low-cost current-gen' },
            { id: 'gpt-5', name: 'GPT-5', description: 'Previous gen' },
            { id: 'gpt-4o', name: 'GPT-4o', description: 'Legacy' },
        ],
    },
    // DM narration only — the memory machinery (RAG, Scribe & co.) always runs
    // on Gemini via the dedicated machinery key (see llm/machinery.js).
    xai: {
        name: 'xAI (Grok)',
        models: [
            { id: 'grok-4.3', name: 'Grok 4.3 (Recommended)', description: 'xAI flagship — fast, strong prose, but weaker game-event compliance: quests, loot, and coin may need the built-in audits to keep up' },
            { id: 'grok-4.1-fast', name: 'Grok 4.1 Fast', description: 'Budget tier; xAI aliases retired IDs forward to the current model. Same event-compliance caveat as Grok 4.3' },
        ],
    },
};

export const PROVIDER_LIST = Object.keys(PROVIDERS);
