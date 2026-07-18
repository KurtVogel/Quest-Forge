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
// Current-gen Flash-Lite (IDEAS.md "Machinery model upgrade", gated on the
// 2026-07-18 eval:memory pass): ~5x cheaper per token than 2.5 Flash and off
// the legacy-deprecation track. Extraction-sensitive consumers (Scribe
// appearance/stance merges, roll audits) were the quality gate.
export const MACHINERY_MODEL = 'gemini-3.1-flash-lite';

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
 */
export function getBackgroundConfig(settings) {
    return {
        provider: 'gemini',
        apiKey: getMachineryGeminiKey(settings),
        model: MACHINERY_MODEL,
    };
}
