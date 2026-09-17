/**
 * OpenAI API provider.
 * Thin instantiation of the shared OpenAI-compatible provider factory —
 * the request/stream/error behavior lives in openaiCompatible.js — plus one
 * OpenAI-specific diagnosis: a CORS-hidden error reply (below).
 */
import { DEFAULT_MAX_TOKENS, makeOpenAICompatProvider } from './openaiCompatible.js';
import { isNetworkFailure, makeHttpError } from './sse.js';

/** Reasoning models: gpt-5 family and the o-series. */
const isReasoningModel = (model) => /^(gpt-5|o\d)/.test(model || '');

/**
 * Reasoning tokens count against `max_completion_tokens`, so the gpt-4o
 * ceiling (16,384) left a heavy-reasoning long turn hitting `length` and the
 * truncation error retrying at the same cap (2026-09-06 audit). 32,768
 * matches the Gemini thinking-model cap; still a glitch-loop guard, not a
 * budget.
 */
export const REASONING_MAX_TOKENS = 32768;

/**
 * The key probe for a CORS-hidden chat error (2026-09-17 playtest). OpenAI's
 * edge answers a rejected key on `POST /v1/chat/completions` with a 401 that
 * carries NO `Access-Control-Allow-Origin` header, so in a browser the fetch
 * promise rejects with a bare `TypeError: Failed to fetch` — no status, no
 * body, and the player reads "Error: Failed to fetch" with no idea the key
 * was the cause (verified from the deployed origin in headless Chromium:
 * chat POST → CORS block; the same bad key on `GET /v1/models` → a readable
 * 401 with its message). The probe is that GET: it is CORS-clean on every
 * status, so it tells a rejected key apart from a key that OpenAI accepts
 * (then the hidden error is model access / quota / an outage) and from a
 * network that cannot reach OpenAI at all.
 */
export const OPENAI_KEY_PROBE_URL = 'https://api.openai.com/v1/models';

const probeHttpError = makeHttpError('OpenAI');

/**
 * Explain a network-failure TypeError out of an OpenAI chat fetch. Resolves
 * to the Error the caller should throw instead:
 * - the probe rejects the key (any non-2xx) → a plain Error naming the
 *   rejection, `.status` stamped so the adapter never retries it;
 * - the probe accepts the key → a plain Error saying OpenAI rejected the
 *   request but hid the reason (model access / quota / outage), not retried;
 * - the probe itself cannot reach OpenAI → a TypeError still in the
 *   "Failed to fetch" family, so the adapter's transient retry stays on;
 * - the caller aborted → the original error, untouched.
 */
export async function explainOpenAIFetchFailure({ apiKey, model, error, signal, fetchImpl = fetch }) {
    if (signal?.aborted) return error;
    let response;
    try {
        response = await fetchImpl(OPENAI_KEY_PROBE_URL, {
            method: 'GET',
            headers: { 'Authorization': `Bearer ${apiKey}` },
            signal,
        });
    } catch (probeError) {
        if (signal?.aborted || probeError?.name === 'AbortError') return error;
        return new TypeError(`Failed to fetch — the browser could not reach OpenAI at all (offline, a network or extension blocking api.openai.com, or an OpenAI outage). Check the connection and retry.`);
    }
    if (!response.ok) {
        const rejection = await probeHttpError(response);
        const explained = new Error(`OpenAI rejected your API key — ${rejection.message.replace(/\.+$/, '')}. Update the key in Settings → AI Provider.`);
        explained.status = rejection.status;
        return explained;
    }
    return new Error(`OpenAI rejected the request but hid the reason from the browser (its error replies carry no CORS headers, so the page only sees "Failed to fetch"). The API key itself is accepted — check that this key/project has access to the model "${model}", that the account has quota and billing, then retry; if it persists, try another model in Settings → AI Provider.`);
}

const { send: sendRaw, stream: streamRaw } = makeOpenAICompatProvider({
    label: 'OpenAI',
    baseUrl: 'https://api.openai.com/v1/chat/completions',
    // OpenAI's current field name; post-4o models reject legacy max_tokens.
    maxTokensParam: 'max_completion_tokens',
    // Reasoning models (gpt-5 family, o-series) 400 on any non-default temperature.
    temperatureUnsupported: isReasoningModel,
    maxOutputTokensFor: (model) => (isReasoningModel(model) ? REASONING_MAX_TOKENS : DEFAULT_MAX_TOKENS),
});

/** Send a non-streaming message to OpenAI. */
export async function sendOpenAIMessage(args) {
    try {
        return await sendRaw(args);
    } catch (error) {
        if (!isNetworkFailure(error)) throw error;
        throw await explainOpenAIFetchFailure({ apiKey: args.apiKey, model: args.model, error, signal: args.signal });
    }
}

/**
 * Stream a message from OpenAI. A network failure AFTER the first chunk is a
 * dropped connection mid-reply, not a hidden error reply — it is rethrown
 * as is (the adapter's stall/retry semantics own it); only a failure before
 * any byte arrived is diagnosed.
 */
export async function streamOpenAIMessage(args) {
    let received = false;
    const onChunk = (chunk) => {
        received = true;
        args.onChunk?.(chunk);
    };
    try {
        return await streamRaw({ ...args, onChunk });
    } catch (error) {
        if (received || !isNetworkFailure(error)) throw error;
        throw await explainOpenAIFetchFailure({ apiKey: args.apiKey, model: args.model, error, signal: args.signal });
    }
}
