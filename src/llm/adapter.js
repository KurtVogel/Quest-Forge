/**
 * Provider-agnostic LLM adapter.
 * Routes requests to the appropriate provider implementation.
 */
import { sendGeminiMessage, streamGeminiMessage } from './providers/gemini.js';
import { sendOpenAIMessage, streamOpenAIMessage } from './providers/openai.js';
import { sendXaiMessage, streamXaiMessage } from './providers/xai.js';
import { isNetworkFailure, isTransient, retryDelay, sleep } from './providers/sse.js';
// The Settings picker's catalog lives in its own module (2026-10-12) so state/
// can read it without importing the transport; re-exported for every caller.
export { DEFAULT_DM_MODEL, PROVIDERS, PROVIDER_LIST } from './modelCatalog.js';

const providers = {
    gemini: { send: sendGeminiMessage, stream: streamGeminiMessage },
    openai: { send: sendOpenAIMessage, stream: streamOpenAIMessage },
    xai: { send: sendXaiMessage, stream: streamXaiMessage },
};

// Transient failures worth retrying — rate limits, server hiccups, dropped
// connections — are judged by sse.js `isTransient`, the one vocabulary the
// embed lanes read too (2026-10-12). fetch() rejects with a TypeError on a
// network failure, but so does any programming bug inside a provider; only the
// browsers' network-failure messages count, so a bug is never retried.

/** Backoff base of a non-streaming retry (doubles per attempt, plus jitter). */
const SEND_RETRY_BASE_MS = 1000;
/** Backoff base of a DM stream refused before its first byte. */
const STREAM_RETRY_BASE_MS = 1500;

/**
 * Browser fetch never times out on its own: a stalled connection (no response,
 * no error) used to hang the awaiting turn forever — three call sites block the
 * turn pre-commit (2026-08-08 audit P1). Every non-streaming call now aborts
 * after this long and retries like any other transient failure.
 */
const DEFAULT_SEND_TIMEOUT_MS = 90_000;

/**
 * Retries after the first attempt. A retry budget belongs to the LANE, not
 * the call (2026-09-29 providers-adapter P2): three 60 s attempts are right
 * for a background extraction, where a lost Scribe pass costs the campaign,
 * and wrong for a call the player is watching — a pre-commit lane passes
 * `maxRetries: 0` with its own short `timeoutMs` (machinery.js
 * getPreCommitConfig).
 */
export const DEFAULT_SEND_MAX_RETRIES = 2;

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
 * Retries of a DM stream that a provider REFUSED before its first byte
 * (429 / 5xx / network failure — the same classifier as sendMessage). Safe:
 * no partial output exists yet. Mid-stream failures still surface at once.
 */
export const STREAM_START_MAX_RETRIES = 2;

/**
 * Send a message to the configured LLM provider.
 *
 * Non-streaming calls (Scribe, journal, roll policy, front generation) retry
 * transient failures with backoff — a single 429/503 must not silently cost the
 * campaign a memory extraction or loot audit. Streaming (the visible DM turn)
 * retries only a refusal before its first byte (STREAM_START_MAX_RETRIES);
 * once output has reached the player a failure surfaces as is.
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
 * @param {number} [options.maxRetries] - Retries after the first attempt
 *   (default 2; 0 = one attempt, for a call the player is waiting on).
 * @param {number} [options.retryAfterCapMs] - The LANE's ceiling on a
 *   provider-sent retry-after (sse.js retryDelay; default RETRY_AFTER_CAP_MS
 *   10 s). The background lane passes BACKGROUND_RETRY_AFTER_CAP_MS (30 s)
 *   through getBackgroundConfig so a Gemini per-minute window is waited out
 *   inside its 3 × 60 s budget instead of burning the retry (2026-10-25).
 * @param {AbortSignal} [options.signal] - External cancel; never retried.
 * @param {function} [options.onUsage] - Receives `{ promptTokens, cachedTokens,
 *   outputTokens }` once the provider reports usage (2026-09-30 cache
 *   telemetry); the reply itself stays a string.
 * @param {string} [options.conversationId] - Cache-affinity id for providers
 *   that route by conversation (xAI `x-grok-conv-id`); ignored elsewhere.
 * @param {function} [options.onHeaderRejected] - Called with the header names
 *   when a provider's edge refused the affinity header's preflight.
 * @param {{ prefix: string, dynamic: string }} [options.systemPromptParts] - The
 *   system prompt split at the cache-prefix boundary (memory-research M1,
 *   2026-10-14): OpenAI-compatible providers send two leading system messages
 *   (and an explicit breakpoint on OpenAI gpt-5.6+); Gemini ignores it.
 * @param {function} [options.onCacheBreakpointRejected] - Called once when the
 *   provider 400s the explicit breakpoint fields; the call is re-sent without.
 * @param {string} [options.fallbackModel] - Same provider, another model: ONE
 *   extra attempt once the retry budget is spent on a capacity refusal
 *   (429 / 5xx — never a stall, a 4xx, or a cancel). Grand playtest
 *   2026-10-02: `gemini-3.7-flash` answered ~1 call in 3 with "503 high
 *   demand" for an hour and the Scribe lost whole turns while another Flash
 *   answered every call.
 * @returns {Promise<string>} LLM response text
 */
export async function sendMessage({ provider, apiKey, model, systemPrompt, systemPromptParts, messageHistory, userMessage, temperature, thinkingBudget, maxOutputTokens, timeoutMs = DEFAULT_SEND_TIMEOUT_MS, maxRetries = DEFAULT_SEND_MAX_RETRIES, retryAfterCapMs, signal, onUsage, conversationId, onHeaderRejected, onCacheBreakpointRejected, fallbackModel }) {
    const p = providers[provider];
    if (!p) throw new Error(`Unknown LLM provider: "${provider}"`);
    if (!apiKey) throw new Error('API key is required. Please set it in Settings.');

    const MAX_RETRIES = Number.isInteger(maxRetries) && maxRetries >= 0 ? maxRetries : DEFAULT_SEND_MAX_RETRIES;
    let activeModel = model;
    for (let attempt = 0; ; attempt++) {
        if (signal?.aborted) throw new DOMException('The request was aborted.', 'AbortError');
        // Requests sent so far, this one included — the fallback attempt runs
        // past the retry budget and is counted too (2026-10-12: a stalled
        // fallback said "3 attempts" for four requests).
        const requests = attempt + 1;
        // Per-attempt controller: the stall timer must not leak an abort into a
        // later retry, and an external caller signal cancels every attempt.
        const controller = new AbortController();
        const onExternalAbort = () => controller.abort();
        signal?.addEventListener('abort', onExternalAbort, { once: true });
        const stallTimer = setTimeout(() => controller.abort(), timeoutMs);
        try {
            return await p.send({ apiKey, model: activeModel, systemPrompt, systemPromptParts, messageHistory, userMessage, temperature, thinkingBudget, maxOutputTokens, signal: controller.signal, onUsage, conversationId, onHeaderRejected, onCacheBreakpointRejected });
        } catch (error) {
            const stalled = error?.name === 'AbortError' && !signal?.aborted;
            if (signal?.aborted) throw error; // caller cancelled — never retry
            if (!stalled && attempt >= MAX_RETRIES && isTransient(error) && !isNetworkFailure(error)
                && typeof fallbackModel === 'string' && fallbackModel && activeModel !== fallbackModel) {
                console.warn(`[LLM Adapter] ${provider} ${activeModel} refused after ${requests} attempt(s) (${error.message}); one attempt on ${fallbackModel}.`);
                activeModel = fallbackModel;
                continue;
            }
            if (!stalled && (attempt >= MAX_RETRIES || !isTransient(error))) throw error;
            if (stalled && attempt >= MAX_RETRIES) {
                throw new Error(`${provider} request stalled — no response after ${Math.round(timeoutMs / 1000)}s (${requests} attempt${requests === 1 ? '' : 's'}).`);
            }
            const reason = stalled ? `stalled after ${Math.round(timeoutMs / 1000)}s` : error.message;
            // A retry-after the provider sent (header or body) wins over the
            // backoff, under the lane's cap (sse.js retryDelay).
            const delay = retryDelay(attempt, error, { base: SEND_RETRY_BASE_MS, capMs: retryAfterCapMs });
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
 * Calls onChunk with each text fragment as it arrives. The visible DM turn's
 * lane: it takes NONE of sendMessage's timeoutMs / maxRetries / thinkingBudget
 * / fallbackModel — its stall guard is the idle timer, its retry budget is
 * STREAM_START_MAX_RETRIES (before the first byte only), and the provider's
 * own model defaults govern thinking; `maxOutputTokens` is forwarded like the
 * send's (2026-10-25 — the providers honored it, the adapter dropped it).
 * @param {object} options
 * @param {string} options.provider - Provider name ('gemini' | 'openai' | 'xai')
 * @param {string} options.apiKey - API key
 * @param {string} options.model - Model identifier
 * @param {string} options.systemPrompt - System prompt
 * @param {Array} options.messageHistory - Previous messages [{role, content}]
 * @param {string} options.userMessage - New user message
 * @param {function} options.onChunk - Callback receiving each text chunk
 * @param {AbortSignal} [options.signal] - Optional abort signal (the Stop
 *   button); surfaces as an AbortError, never retried
 * @param {number} [options.temperature] - Sampling temperature (default 0.9)
 * @param {number} [options.maxOutputTokens] - Per-call output cap override;
 *   omitted, the provider's per-model cap governs.
 * @param {number} [options.idleTimeoutMs] - Abort when no BYTES have arrived
 *   for this long (default DEFAULT_STREAM_IDLE_TIMEOUT_MS). Reset on every
 *   transport read through the provider's `onActivity` (2026-10-25 — a
 *   reasoning model's text-less keep-alives used to leave the timer dead)
 *   and on every text chunk.
 * @param {function} [options.onUsage] - As sendMessage
 * @param {string} [options.conversationId] - As sendMessage
 * @param {function} [options.onHeaderRejected] - As sendMessage
 * @returns {Promise<string>} Complete response text
 */
export async function streamMessage({ provider, apiKey, model, systemPrompt, systemPromptParts, messageHistory, userMessage, onChunk, signal, temperature, maxOutputTokens, idleTimeoutMs = DEFAULT_STREAM_IDLE_TIMEOUT_MS, onUsage, conversationId, onHeaderRejected, onCacheBreakpointRejected }) {
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
    let streamed = false;
    armIdleTimer();
    try {
        let result;
        for (let attempt = 0; ; attempt++) {
            try {
                // `onActivity`: the transport's per-read liveness arms the idle
                // timer too — the text callback alone missed a reasoning
                // model's text-less events (2026-10-25).
                result = await p.stream({ apiKey, model, systemPrompt, systemPromptParts, messageHistory, userMessage, onChunk: (chunk) => { streamed = true; guardedOnChunk(chunk); }, onActivity: armIdleTimer, signal: controller.signal, temperature, maxOutputTokens, onUsage, conversationId, onHeaderRejected, onCacheBreakpointRejected });
                break;
            } catch (error) {
                // A transient refusal BEFORE the first byte is safe to retry —
                // nothing reached the player (grand playtest 2026-10-02: Gemini
                // 3.8 Flash refused DM streams with 503s for an hour, and every
                // one cost the player a whole turn and a retyped line). A stall,
                // a cancel, or anything after a chunk is never retried.
                if (streamed || stalled || controller.signal.aborted || signal?.aborted
                    || attempt >= STREAM_START_MAX_RETRIES || !isTransient(error)) throw error;
                const wait = retryDelay(attempt, error, { base: STREAM_RETRY_BASE_MS });
                console.warn(`[LLM Adapter] ${provider} stream refused before the first byte (${error.message}); retry ${attempt + 1}/${STREAM_START_MAX_RETRIES} in ~${Math.round(wait)}ms.`);
                clearTimeout(idleTimer);
                await sleep(wait);
                if (signal?.aborted) throw new DOMException('The request was aborted.', 'AbortError');
                armIdleTimer();
            }
        }
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
