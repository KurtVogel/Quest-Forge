/**
 * The Gemini "machinery" — everything that keeps a campaign coherent behind
 * the DM's back: RAG embeddings (vectorMemory), the Scribe world-state
 * extractor, journal summaries, roll-policy audits, NPC enrichment, and
 * fodder review. It always runs on Gemini Flash, no matter which provider
 * narrates as the DM.
 *
 * When the DM itself is Gemini, the main key doubles as the machinery key.
 * Any other DM provider (OpenAI, xAI) requires a dedicated Gemini key —
 * playing without the machinery is not supported: no memory extraction, no
 * RAG, no loot audit, and a long campaign silently rots. ChatPanel refuses
 * to start a turn until `isMachineryReady` passes, so background tasks can
 * assume a key exists (their own key guards remain as cheap safety nets).
 */
// Current-gen full Flash (Vesa 2026-08-22, up from 3.1-flash-lite): id verified
// against the live models API (no 3.7-flash-lite variant exists). Costs more per
// token than Lite; extraction-sensitive consumers (Scribe appearance/stance
// merges, roll audits) remain the quality gate on any future swap.
export const MACHINERY_MODEL = 'gemini-3.7-flash';

/**
 * One extra attempt on another Flash when MACHINERY_MODEL refuses for
 * capacity (429 / 5xx) after the lane's own retries (grand playtest
 * 2026-10-02: a 3.7 Flash "high demand" spike lost whole Scribe passes —
 * facts, cards, the loot and payment audits — while 3 Flash answered every
 * call). Text lanes only; embeddings keep their own model.
 */
export const MACHINERY_FALLBACK_MODEL = 'gemini-3-flash-preview';

/** The Gemini key powering embeddings/RAG and background extraction, or ''. */
export function getMachineryGeminiKey(settings) {
    if (!settings) return '';
    // Type-strict (2026-09-16 audit P2): AppShell calls isMachineryReady in
    // RENDER, so a numeric key in a corrupted settings row took the shell
    // down at boot through `?.trim is not a function`.
    if (settings.llmProvider === 'gemini' && typeof settings.apiKey === 'string' && settings.apiKey.trim()) {
        return settings.apiKey.trim();
    }
    return typeof settings.geminiApiKey === 'string' ? settings.geminiApiKey.trim() : '';
}

/** Where the machinery key is edited, for the player-facing remedies below. */
export function describeMachineryKeyField(settings) {
    return settings?.llmProvider === 'gemini'
        ? 'Settings → AI Provider → API Key'
        : 'Settings → AI Provider → Gemini API Key (game memory)';
}

/**
 * The vendor a pasted API key belongs to, judged by its well-known prefix, or
 * null when the shape is unknown (a hint, never a gate — vendors may change
 * their formats). Google API keys start with `AIza`, OpenAI's with `sk-`,
 * xAI's with `xai-` (the xAI chat provider normalizes a missing prefix in).
 */
export function detectApiKeyVendor(key) {
    const text = typeof key === 'string' ? key.trim() : '';
    if (!text) return null;
    if (/^AIza[0-9A-Za-z_-]{20,}$/.test(text)) return 'gemini';
    if (/^xai-/i.test(text)) return 'xai';
    if (/^sk-/i.test(text)) return 'openai';
    return null;
}

const VENDOR_LABELS = { gemini: 'Gemini', openai: 'OpenAI', xai: 'xAI' };
const VENDOR_ARTICLES = { gemini: 'a', openai: 'an', xai: 'an' };
const VENDOR_PREFIXES = { gemini: 'AIza…', openai: 'sk-…', xai: 'xai-…' };

/**
 * A one-line warning when a key's shape says it belongs to a different
 * vendor than the field expects, or '' (2026-09-19): switching the DM vendor
 * mid-campaign leaves two key fields on screen, and a Gemini key pasted into
 * the OpenAI slot — or an OpenAI key left in the memory slot — otherwise
 * fails only at the first embed, as an unexplained "embedding call failed".
 */
export function describeKeyVendorMismatch(key, expectedVendor) {
    const expected = VENDOR_LABELS[expectedVendor] ? expectedVendor : null;
    const detected = detectApiKeyVendor(key);
    if (!expected || !detected || detected === expected) return '';
    return `This looks like ${VENDOR_ARTICLES[detected]} ${VENDOR_LABELS[detected]} key (${VENDOR_PREFIXES[detected]}). ${VENDOR_LABELS[expected]} keys start with ${VENDOR_PREFIXES[expected]}.`;
}

/**
 * The player-facing line for a memory-less turn, from the query embed's
 * failure reason (`{ status, message, timedOut }` from `embedText`, or null).
 * Names the cause and the remedy: a rejected or unauthorized key is a
 * standing outage (the Scribe and the journal run on the same key, so nothing
 * new is remembered until it is fixed — the honest opposite of "retrieval
 * resumes next turn"), a rate limit or a stall is transient.
 */
export function describeMemoryUnavailable(reason, settings) {
    const status = Number.isFinite(reason?.status) ? reason.status : null;
    const message = typeof reason?.message === 'string' ? reason.message.trim() : '';
    const detail = status != null ? `HTTP ${status}${message ? `: ${message}` : ''}` : message;
    const lead = 'Long-term memory could not be consulted this turn';
    const answers = 'the DM answers from the recent conversation only';
    if (status === 400 || status === 401 || status === 403) {
        return `${lead} — Gemini rejected the game-memory key (${detail}). ${answers[0].toUpperCase()}${answers.slice(1)}, and the Scribe and journal cannot run either, so nothing new is remembered until the key is fixed: ${describeMachineryKeyField(settings)}.`;
    }
    if (status === 429) {
        return `${lead} — Gemini rate-limited the embedding call (${detail}); ${answers}. Nothing is lost; retrieval resumes when the quota clears.`;
    }
    if (reason?.timedOut) {
        return `${lead} — the embedding call stalled and was abandoned; ${answers}. Nothing is lost; retrieval resumes next turn.`;
    }
    if (status != null) {
        return `${lead} — Gemini answered the embedding call with ${detail}; ${answers}. Nothing is lost; retrieval resumes next turn.`;
    }
    if (message) {
        return `${lead} — the embedding call failed (${message}); ${answers}. Nothing is lost; retrieval resumes next turn.`;
    }
    return `${lead} (the embedding call failed) — ${answers}. Nothing is lost; retrieval resumes next turn.`;
}

/** True when the campaign machinery can run (a Gemini key is available). */
export function isMachineryReady(settings) {
    return !!getMachineryGeminiKey(settings);
}

/**
 * Provider config for background LLM tasks (Scribe, journal, roll policy,
 * NPC enrichment/review, semantic roll detection). Always Gemini Flash.
 *
 * Extraction calls are pure JSON: thinkingBudget 0 stops default-on thinking
 * from burning reasoning tokens against the output cap (2-4 such calls run
 * per turn, two of them blocking), and 8192 output tokens is generous for
 * every consumer's bounded JSON. Both ride the sendMessage options spread.
 */
export function getBackgroundConfig(settings) {
    return {
        provider: 'gemini',
        apiKey: getMachineryGeminiKey(settings),
        model: MACHINERY_MODEL,
        fallbackModel: MACHINERY_FALLBACK_MODEL,
        thinkingBudget: 0,
        maxOutputTokens: 8192,
        timeoutMs: 60_000,
    };
}

/**
 * THE DM-model call config (2026-10-08 chronicler Lap-4 P2): the player's
 * chosen provider / key / model, for the DM turn, the missing-events nudge,
 * the six directors and the chronicler — creative work on the DM model, as
 * opposed to getBackgroundConfig's extraction lane. Five sites hand-built
 * the same three fields; a fourth field would have landed on some of them.
 */
export function dmCallConfig(settings) {
    return {
        provider: settings?.llmProvider,
        apiKey: settings?.apiKey,
        model: settings?.model,
    };
}

/**
 * Stall budget for the two machinery calls that sit BETWEEN the DM's last
 * streamed token and the commit — the roll arbiter and the semantic roll
 * detector (2026-09-29 providers-adapter P2). The background lane's three
 * 60 s attempts (183 s with backoff) are right for the Scribe and the
 * journal, where a lost extraction costs the campaign; here the player is
 * watching "waiting" with the narration already fully received, and both
 * callers carry an offline fallback (the sync rules / "no rolls detected"),
 * so the lane gets ONE attempt at this budget and then falls back.
 */
export const PRE_COMMIT_TIMEOUT_MS = 20_000;

/** getBackgroundConfig for a call the player is waiting on: one attempt, 20 s. */
export function getPreCommitConfig(settings) {
    return { ...getBackgroundConfig(settings), timeoutMs: PRE_COMMIT_TIMEOUT_MS, maxRetries: 0 };
}

/**
 * The player-facing line for a mount seed that could not embed every row
 * (2026-09-29 vector-memory P2): a rate-limited or failed seed used to be
 * console-only, and the whole session then ran against a partial store.
 * Same cause vocabulary as describeMemoryUnavailable (`{ status, message,
 * timedOut }` from the batch embed, or null).
 */
export function describeMemorySeedIncomplete(missing, reason, settings) {
    const count = Number.isFinite(missing) && missing > 0 ? Math.floor(missing) : 0;
    const rows = `${count} ${count === 1 ? 'memory' : 'memories'}`;
    const status = Number.isFinite(reason?.status) ? reason.status : null;
    const message = typeof reason?.message === 'string' ? reason.message.trim() : '';
    const detail = status != null ? `HTTP ${status}${message ? `: ${message}` : ''}` : message;
    const partial = 'Long-term memory runs on a partial record this session; the rest embed on the next Continue.';
    // A batch 400 is ambiguous (one oversized row among a hundred is also a
    // 400) — the key wording needs 401/403 or Google's own "API key" message.
    const keyRejected = status === 401 || status === 403 || (status === 400 && /api key/i.test(message));
    if (keyRejected) {
        return `${rows} could not be embedded — Gemini rejected the game-memory key (${detail}). Long-term memory, the Scribe, and the journal cannot run until the key is fixed: ${describeMachineryKeyField(settings)}.`;
    }
    if (status === 429) {
        return `${rows} could not be embedded — Gemini rate-limited the embedding call (${detail}). ${partial}`;
    }
    if (reason?.timedOut) {
        return `${rows} could not be embedded — the embedding call stalled and was abandoned. ${partial}`;
    }
    if (detail) {
        return `${rows} could not be embedded — the embedding call failed (${detail}). ${partial}`;
    }
    return `${rows} could not be embedded (the embedding call failed). ${partial}`;
}
