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

/** The Gemini key powering embeddings/RAG and background extraction, or ''. */
export function getMachineryGeminiKey(settings) {
    if (!settings) return '';
    if (settings.llmProvider === 'gemini' && settings.apiKey) return settings.apiKey;
    return settings.geminiApiKey?.trim() || '';
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
        thinkingBudget: 0,
        maxOutputTokens: 8192,
        timeoutMs: 60_000,
    };
}
