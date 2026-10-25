/**
 * Google Gemini API provider.
 * Uses the REST API directly (no SDK dependency needed).
 */
import { asRecord, assertStreamComplete, BACKGROUND_RETRY_AFTER_CAP_MS, historyText, isTransient, makeCompletionGuard, makeHttpError, parseBodyRetryDelayMs, parseRetryAfterMs, readSseStream, reportUsage, retryDelay, sleep } from './sse.js';

// v1beta on both lanes since 2026-10-25 (providers-adapter nit): the chat
// lane rode v1alpha with no recorded reason while the embed rode v1beta.
// Probed live on gemini-3.8-flash with the app's own body shape (system
// instruction, contents, safetySettings BLOCK_NONE, thinkingConfig) — both
// generateContent and streamGenerateContent?alt=sse answered 200 with text.
const GEMINI_API_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';
const GEMINI_EMBED_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';
// Google's current embedding model. Its default output is 3072 dimensions; 768 is
// an officially supported Matryoshka truncation that keeps the browser cache compact.
// The schema includes our asymmetric retrieval format because changing either the
// model or formatting makes previously cached vectors semantically incompatible.
const GEMINI_EMBED_MODEL = 'gemini-embedding-2';
export const GEMINI_EMBED_DIMENSIONS = 768;
export const GEMINI_EMBED_SCHEMA = `${GEMINI_EMBED_MODEL}:search-retrieval-v1:${GEMINI_EMBED_DIMENSIONS}`;

/**
 * The EMBED input ceiling in characters (2026-09-17 vector-memory P1). The
 * embed model's per-input token limit is not recorded in the repo (2,048
 * tokens on the predecessor model); 6,000 characters (~1,500 English tokens)
 * stays under it with headroom for name-heavy prose. Only the wire text is
 * truncated — the memory row keeps its full text as the dedupe key, so the
 * seed's "already cached" check and the prompt injection are unchanged. Every
 * live source is clamped far below this (journal 2,000, facts 400, cards 260);
 * the cap is the belt for a pre-clamp save or an unusually long narration.
 */
export const MAX_EMBED_INPUT_CHARS = 6000;

function formatEmbeddingInput(text, inputType) {
    const content = String(text || '').trim().slice(0, MAX_EMBED_INPUT_CHARS);
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

const assertCompleteResponse = makeCompletionGuard({
    completeReason: 'STOP',
    truncatedReason: 'MAX_TOKENS',
    truncatedLabel: ' (MAX_TOKENS)',
});

const httpError = makeHttpError('Gemini');

/**
 * A PROMPT-level block: `{ promptFeedback: { blockReason } }` with no
 * candidates. This is the one classifier `safetySettings: BLOCK_NONE` cannot
 * switch off (PROHIBITED_CONTENT), i.e. the residual refusal class after
 * 2026-08-28. It used to read as "No response generated" non-streaming and
 * "connection dropped … please retry" streaming (2026-09-06 P1) — and a
 * retry of a deterministic block loops. Name it, with the edit/remove remedy.
 */
function promptBlockReason(data) {
    const reason = data?.promptFeedback?.blockReason;
    return typeof reason === 'string' && reason ? reason : null;
}

function promptBlockedError(reason, data) {
    const message = data?.promptFeedback?.blockReasonMessage;
    const detail = typeof message === 'string' && message.trim() ? `: ${message.trim().slice(0, 300)}` : '';
    return new Error(`Gemini blocked the prompt (${reason}${detail}) — the input itself was refused, so retrying the same message will fail again. Edit or remove (✕) the offending message, then continue.`);
}

/**
 * A usable embedding: the documented length AND every element a finite
 * number (2026-09-16 audit P2 — a 768-slot vector of strings passed the
 * length check, cosine went NaN, and the row never retrieved this session).
 */
function isEmbeddingVector(values) {
    return Array.isArray(values)
        && values.length === GEMINI_EMBED_DIMENSIONS
        && values.every(v => typeof v === 'number' && Number.isFinite(v));
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
 * The app's declared content policy (DECISIONS.md 2026-08-28): Quest Forge is
 * an adult-fiction game running on the player's own API key, and its records
 * are contractually unvarnished — but until 2026-08-28 no call ever declared
 * that to the API, so Google's DEFAULT thresholds silently governed every DM
 * turn AND every machinery call (the known journal-summarizer safety blocks on
 * explicit narration, and part of the live "sorry, I can't continue" refusal
 * cascade). BLOCK_NONE disables the API-side classifiers on the player's key;
 * in-band model refusals on genuinely prohibited content remain the model's
 * own floor. CIVIC_INTEGRITY is deliberately not listed (restricted category,
 * defaults apply).
 */
const GEMINI_SAFETY_SETTINGS = [
    { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_NONE' },
    { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_NONE' },
    { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_NONE' },
    { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_NONE' },
];

/**
 * Convert our message format to Gemini's content format.
 */
function formatMessages(systemPrompt, messageHistory, userMessage, temperature, { thinkingBudget, maxOutputTokens } = {}) {
    const contents = [];

    // Convert history. Only genuine assistant turns are the model's own;
    // anything else (user, and a `system` line a caller forgot to fold) is
    // user-side context, matching buildMessageWindow's own mapping. `text`
    // must be a string — a null part is a 400 at Gemini.
    for (const msg of messageHistory) {
        contents.push({
            role: msg.role === 'assistant' || msg.role === 'model' ? 'model' : 'user',
            parts: [{ text: historyText(msg.content) }],
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
        safetySettings: GEMINI_SAFETY_SETTINGS,
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
 * Token usage in the adapter's one shape (2026-09-30 cache telemetry) from a
 * Gemini `usageMetadata`: `promptTokenCount`, `cachedContentTokenCount` (the
 * implicit-cache hit — the app never creates an explicit cache), and
 * `candidatesTokenCount` (+ `thoughtsTokenCount` as `thoughtTokens`).
 */
export function normalizeGeminiUsage(usageMetadata) {
    if (!usageMetadata || typeof usageMetadata !== 'object') return null;
    const num = (value) => (Number.isFinite(value) ? value : null);
    const promptTokens = num(usageMetadata.promptTokenCount);
    if (promptTokens === null) return null;
    return {
        promptTokens,
        cachedTokens: num(usageMetadata.cachedContentTokenCount) ?? 0,
        outputTokens: num(usageMetadata.candidatesTokenCount),
        thoughtTokens: num(usageMetadata.thoughtsTokenCount),
    };
}

/**
 * Send a non-streaming message to Gemini.
 */
export async function sendGeminiMessage({ apiKey, model, systemPrompt, messageHistory, userMessage, temperature, thinkingBudget, maxOutputTokens, signal, onUsage }) {
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

    // A `null` body threw at `.candidates` (2026-09-16 audit P2).
    const data = asRecord(await response.json());
    const candidate = data.candidates?.[0];
    const blockReason = promptBlockReason(data);
    if (blockReason && !candidate) {
        throw promptBlockedError(blockReason, data);
    }
    assertCompleteResponse(candidate?.finishReason);
    reportUsage(onUsage, data.usageMetadata, normalizeGeminiUsage);
    const text = extractCandidateText(candidate);
    if (!text) {
        throw new Error('No response generated. The model may have been blocked or returned empty.');
    }
    return text;
}

/**
 * Generate a text embedding vector using Gemini's embedding model.
 * Returns a number[] (768 dimensions) or null on failure.
 *
 * ONE embed path since 2026-10-12 (providers-adapter Lap 4): this is
 * `embedTexts([text])` under the query's whole-call deadline — the single
 * used to re-implement the fetch, the vector check, the error message, the
 * Retry-After retry and the report beside the batch, ~70 lines twice with
 * two retry preconditions. The deadline (EMBED_QUERY_TIMEOUT_MS) covers the
 * WHOLE call, its one retry included: RAG retrieval is awaited BEFORE the DM
 * prompt is built, so a stalled embed must fail into the null path, never
 * hang the turn.
 *
 * `onError` (2026-09-19): the null return stays the contract for every caller,
 * but a failed QUERY embed is said out loud to the player, and "the embedding
 * call failed" told them nothing — a vendor switch that left the wrong key in
 * the machinery slot reads identically to a rate limit or a dropped network.
 * The callback receives `{ status, message, timedOut }` (the API's own error
 * message when the body carries one) so the caller can name the cause and
 * the remedy. It is invoked at most once per call and its throws are ignored.
 * @param {string} apiKey
 * @param {string} text - Text to embed
 * @param {{inputType?: 'document'|'query', onError?: (reason: EmbedFailure) => void}} [options]
 * @returns {Promise<number[]|null>}
 */
export async function embedText(apiKey, text, { inputType = 'document', onError = null } = {}) {
    const [vector] = await embedTexts(apiKey, [text], { inputType, onError, deadlineMs: EMBED_QUERY_TIMEOUT_MS });
    return vector;
}

/** Stall budget of the single (query) embed, retry included. */
export const EMBED_QUERY_TIMEOUT_MS = 30_000;
/** Stall budget of one batch request (when the call has no whole-call deadline). */
export const EMBED_BATCH_TIMEOUT_MS = 60_000;
/** Backoff before the one retry when the provider sends no Retry-After. */
export const EMBED_RETRY_DEFAULT_MS = 1000;
/** Under a whole-call deadline, the retried fetch needs at least this much of it left. */
const EMBED_RETRY_MIN_ROOM_MS = 2000;

/**
 * @typedef {{ status: number|null, message: string, timedOut: boolean }} EmbedFailure
 * `status` is the HTTP status (null when no response arrived), `message` the
 * API's own error text when the body carried one (else the status text or the
 * exception message), `timedOut` true when the stall guard fired.
 */

/** The `error.message` of a Google API error body, or '' (string-typed, clamped). */
function apiErrorMessage(body) {
    try {
        const parsed = asRecord(JSON.parse(body));
        const message = asRecord(parsed.error).message;
        return typeof message === 'string' ? message.trim().slice(0, 300) : '';
    } catch {
        return '';
    }
}

/**
 * Embed many texts: batchEmbedContents embeds up to 100 texts per round trip
 * (2026-08-08 audit: the per-item seed path cost a cold device ~300
 * sequential trips before RAG was warm). Chunks internally, so callers may
 * pass any length. Returns an array aligned with `texts` — number[] per
 * success, null per empty/failed slot; a wholesale HTTP failure nulls that
 * chunk so callers skip those items (the next mount's seed retries whatever
 * the cache is still missing). `onError` receives the FIRST failure's
 * EmbedFailure, once — a malformed vector in a 200 counts.
 *
 * `deadlineMs` (2026-10-12): one deadline for the WHOLE call, every request
 * and the retry included (embedText's query lane); without it each request
 * has its own EMBED_BATCH_TIMEOUT_MS and the retry is never deadline-gated
 * (the background seed).
 */
export async function embedTexts(apiKey, texts, { inputType = 'document', onError = null, deadlineMs = null } = {}) {
    const list = Array.isArray(texts) ? texts : [];
    const results = new Array(list.length).fill(null);
    if (!apiKey || list.length === 0) return results;
    const sendable = [];
    list.forEach((text, index) => {
        if (String(text || '').trim()) sendable.push({ index, wire: formatEmbeddingInput(text, inputType) });
    });

    const url = `${GEMINI_EMBED_BASE}/${GEMINI_EMBED_MODEL}:batchEmbedContents`;
    const BATCH_LIMIT = 100; // the API's per-call request ceiling
    const deadline = Number.isFinite(deadlineMs) && deadlineMs > 0 ? Date.now() + deadlineMs : null;
    const requestTimeoutMs = () => (deadline == null ? EMBED_BATCH_TIMEOUT_MS : Math.max(1, deadline - Date.now()));
    const retryFits = (waitMs) => deadline == null || Date.now() + waitMs + EMBED_RETRY_MIN_ROOM_MS < deadline;
    let rejectedRequests = 0;
    // Has ANY request of this call embedded? The key-level 400 (a rejected
    // key) is the one case the rejected-request budget exists for, and its
    // signature is that NOTHING succeeds (2026-10-23 P2).
    let keyProven = false;
    // The first failure's reason, reported once (2026-09-29): the seed says
    // out loud when rows are still missing, and with what cause.
    let reported = false;
    const report = (reason) => {
        if (reported || typeof onError !== 'function') return;
        reported = true;
        try { onError(reason); } catch { /* a diagnostic must never break the null path */ }
    };

    // One request for one chunk. Fills `results` on success; on failure says
    // whether the API REJECTED the body (400/413 — one bad text among a
    // hundred healthy ones) as opposed to a transient/network/quota failure,
    // which a retry per item would only amplify.
    const sendChunk = async (chunk) => {
        try {
            const response = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
                body: JSON.stringify({
                    requests: chunk.map(({ wire }) => ({
                        model: `models/${GEMINI_EMBED_MODEL}`,
                        content: { parts: [{ text: wire }] },
                        output_dimensionality: GEMINI_EMBED_DIMENSIONS,
                    })),
                }),
                // A stalled request must fail into nulls (the seed skips and
                // retries next mount; the query turn goes on without memory),
                // never hang.
                signal: AbortSignal.timeout(requestTimeoutMs()),
            });
            if (!response.ok) {
                const body = await response.text().catch(() => '');
                console.error(
                    `[Gemini embed] HTTP ${response.status} ${response.statusText} from ${GEMINI_EMBED_MODEL} (${chunk.length} text${chunk.length === 1 ? '' : 's'}):`,
                    body.slice(0, 500),
                );
                const transient = isTransient(response.status);
                return {
                    ok: false,
                    rejected: response.status === 400 || response.status === 413,
                    transient,
                    // The header first; the body's RetryInfo / "retry in Ns"
                    // when the browser cannot read the header (2026-10-25).
                    retryAfterMs: transient ? (parseRetryAfterMs(response.headers?.get?.('retry-after')) ?? parseBodyRetryDelayMs(body)) : null,
                    reason: { status: response.status, message: apiErrorMessage(body) || response.statusText || '', timedOut: false },
                };
            }
            const data = asRecord(await response.json());
            const embeddings = Array.isArray(data.embeddings) ? data.embeddings : [];
            let malformed = 0;
            let firstMalformed = null;
            chunk.forEach(({ index }, j) => {
                const values = embeddings[j]?.values;
                if (isEmbeddingVector(values)) {
                    results[index] = values;
                    return;
                }
                malformed += 1;
                if (firstMalformed == null) firstMalformed = { slot: j, received: Array.isArray(values) ? values.length : 0 };
            });
            if (malformed === 0) return { ok: true, rejected: false };
            // A malformed vector is never cached and never retried (the same
            // body answers the same way), but it is a failure the caller hears.
            console.error(
                `[Gemini embed] Expected ${GEMINI_EMBED_DIMENSIONS} values from ${GEMINI_EMBED_MODEL} for ${malformed} of ${chunk.length} text${chunk.length === 1 ? '' : 's'}:`,
                firstMalformed,
            );
            return {
                ok: true,
                rejected: false,
                reason: { status: response.status, message: `Gemini returned no ${GEMINI_EMBED_DIMENSIONS}-value vector`, timedOut: false },
            };
        } catch (err) {
            console.error('[Gemini embed] Request failed:', err);
            const timedOut = err?.name === 'TimeoutError' || err?.name === 'AbortError';
            return {
                ok: false,
                rejected: false,
                // A browser network failure is transient; a stall is not (its
                // budget is spent) and neither is a programming bug.
                transient: !timedOut && isTransient(err),
                retryAfterMs: null,
                reason: { status: null, message: typeof err?.message === 'string' ? err.message : '', timedOut },
            };
        }
    };

    // ONE Retry-After-bounded whole-request retry per chunk on a transient
    // failure (2026-09-29 vector-memory P2: a 429 on the seed was a silent
    // partial store for the whole session; providers-adapter P2: one
    // per-minute 429 cost the query turn its memory). A retry that fails the
    // same way means the quota is gone for this call: later chunks null out at
    // once (the next mount retries), so a sustained 429 costs one wait, never
    // one per chunk — retrieveRelevant awaits this seed on the first turn.
    // Under a whole-call deadline the retry is taken only when the wait and
    // the retried fetch still fit inside it.
    let transientRetryExhausted = false;
    const sendChunkWithRetry = async (chunk) => {
        let outcome = await sendChunk(chunk);
        if (!outcome.ok && outcome.transient && !transientRetryExhausted) {
            // The embed lane waits like the background lane: up to 30 s of a
            // provider-sent delay (no player watches the seed; the query
            // lane's whole-call deadline still gates the retry below).
            const waitMs = retryDelay(0, outcome, { base: EMBED_RETRY_DEFAULT_MS, jitterMs: 0, capMs: BACKGROUND_RETRY_AFTER_CAP_MS });
            if (retryFits(waitMs)) {
                console.warn(`[Gemini embed] Transient failure (${outcome.reason.status ?? outcome.reason.message}); retrying once in ${waitMs}ms.`);
                await sleep(waitMs);
                outcome = await sendChunk(chunk);
                if (!outcome.ok && outcome.transient) transientRetryExhausted = true;
            }
        }
        if (outcome.reason) report(outcome.reason);
        return outcome;
    };

    // A rejected chunk is BISECTED so one bad text costs one row (2026-09-17
    // vector-memory P1): the whole 100-slot chunk used to null out, the seed
    // stored none of its healthy neighbours, and the next mount rebuilt the
    // same missing set in the same order — a permanent hole of up to 99 rows
    // plus a wasted call per Continue. Isolating one text in a hundred costs
    // ~8 rejected requests; the budget caps a key-level 400 (invalid key)
    // from fanning out into a request per text — past it the rest nulls out
    // exactly like before and the next mount retries.
    // The budget is spent depth-first, so it used to end the walk for TWO or
    // more bad texts in one chunk and null everything unsent (2026-10-23 P2,
    // measured: bad-10 + bad-90 cost 13 rows, three bad texts cost 51 — the
    // whole second half, re-lost on every mount since the same texts reject
    // again). A key-level 400 rejects EVERY request; once one request of this
    // call has embedded the key is proven and each further rejection is a bad
    // text being isolated (≤ 2·⌈log₂ 100⌉ + 1 requests apiece), so the walk
    // goes on under the wider MAX_BAD_TEXT_ISOLATION_REQUESTS ceiling — the
    // belt against a pathological call where most texts reject.
    const embedChunk = async (chunk) => {
        if (rejectedRequests > (keyProven ? MAX_BAD_TEXT_ISOLATION_REQUESTS : MAX_REJECTED_EMBED_REQUESTS)) return;
        const outcome = await sendChunkWithRetry(chunk);
        if (outcome.ok) {
            keyProven = true;
            return;
        }
        if (!outcome.rejected) return;
        rejectedRequests += 1;
        if (chunk.length < 2) return;
        const mid = Math.ceil(chunk.length / 2);
        await embedChunk(chunk.slice(0, mid));
        await embedChunk(chunk.slice(mid));
    };

    for (let start = 0; start < sendable.length; start += BATCH_LIMIT) {
        await embedChunk(sendable.slice(start, start + BATCH_LIMIT));
    }
    return results;
}

/** Rejected (400/413) batch requests one embedTexts call may spend bisecting before ANY request has embedded (a rejected key). */
export const MAX_REJECTED_EMBED_REQUESTS = 12;
/**
 * Rejected requests one call may spend isolating bad texts once a request HAS
 * embedded (the key works). One bad text in a 100-chunk costs ≤ 8 rejections,
 * so this tolerates a dozen per call; past it the rest nulls out and the next
 * mount retries (2026-10-23 vector-memory P2).
 */
export const MAX_BAD_TEXT_ISOLATION_REQUESTS = 100;

/**
 * Stream a message from Gemini.
 */
export async function streamGeminiMessage({ apiKey, model, systemPrompt, messageHistory, userMessage, onChunk, signal, temperature, maxOutputTokens, onUsage, onActivity }) {
    const url = `${GEMINI_API_BASE}/${model}:streamGenerateContent?alt=sse`;
    // A passed output cap is honored like the send's (2026-10-12); the DM
    // lane passes none and keeps GEMINI_MAX_OUTPUT_TOKENS.
    const body = formatMessages(systemPrompt, messageHistory, userMessage, temperature, { maxOutputTokens });

    const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
        body: JSON.stringify(body),
        signal,
    });

    if (!response.ok) {
        throw await httpError(response);
    }

    let fullText = '';
    let finishReason = null;
    let blockReason = null;
    let blockedPayload = null;
    let usageMetadata = null;

    // `onActivity` is the adapter's idle timer, armed per READ (bytes, not
    // text — 2026-10-25): a thought-only or usageMetadata-only event is life.
    await readSseStream(response, (data) => {
        // Every chunk may carry usageMetadata; the last one is the whole call's.
        if (data.usageMetadata && typeof data.usageMetadata === 'object') usageMetadata = data.usageMetadata;
        const reason = promptBlockReason(data);
        if (reason) {
            blockReason = reason;
            blockedPayload = data;
        }
        const candidate = data.candidates?.[0];
        if (candidate?.finishReason) finishReason = candidate.finishReason;
        const text = extractCandidateText(candidate);
        if (text) {
            fullText += text;
            onChunk(text);
        }
    }, { onActivity });

    if (blockReason && !finishReason) {
        throw promptBlockedError(blockReason, blockedPayload);
    }
    assertStreamComplete(finishReason, assertCompleteResponse);
    reportUsage(onUsage, usageMetadata, normalizeGeminiUsage);
    return fullText;
}
