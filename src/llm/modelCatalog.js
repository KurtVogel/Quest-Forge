/**
 * The DM model catalog the Settings picker offers, per provider (split out of
 * the transport module 2026-10-12, providers-adapter Lap 4): `state/` reads it
 * at the settings heal and the initial state without importing the provider
 * code, and adapter.js re-exports it for every existing importer. A
 * provider's FIRST row is its default — the settings heal falls a stored id
 * the picker no longer offers to that row.
 */

/**
 * THE default DM model (Gemini Pro retired from the picker 2026-10-11): the
 * fresh-install setting, the Gemini row the picker lists first, and the dev
 * seed's Gemini model — one spelling for all three.
 */
export const DEFAULT_DM_MODEL = 'gemini-3.8-flash';

/**
 * Available providers and their models.
 */
export const PROVIDERS = {
    gemini: {
        name: 'Google Gemini',
        models: [
            { id: DEFAULT_DM_MODEL, name: 'Gemini 3.8 Flash (Recommended)', description: 'The DM model — newest Flash, stable, fast and cheap (1M context, 64k output)' },
            { id: 'gemini-3-flash-preview', name: 'Gemini 3 Flash', description: 'Fast frontier-class, great value' },
            { id: 'gemini-3.1-flash-lite', name: 'Gemini 3.1 Flash-Lite', description: 'Cheapest current-gen' },
            { id: 'gemini-2.5-flash', name: 'Gemini 2.5 Flash', description: 'Previous gen, fast and affordable' },
        ],
    },
    openai: {
        name: 'OpenAI',
        models: [
            // GPT-6 family (Astra 2026-09-03, Sol/Luna 09-22, 6.1 Sol 09-29). For a
            // DM the tier is the prose: Terra reviewed as narratively flat, Astra
            // leads EQ-Bench creative writing at 5× Sol's price (2026-10-03).
            { id: 'gpt-6.1-sol', name: 'GPT-6.1 Sol (Recommended)', description: 'Newest — near-Astra quality at a fifth of the price' },
            { id: 'gpt-6-astra', name: 'GPT-6 Astra', description: 'Best prose, priciest ($10/$50 per M tokens)' },
            { id: 'gpt-6-luna', name: 'GPT-6 Luna', description: 'Fast, cheapest current-gen' },
            { id: 'gpt-5.6-sol', name: 'GPT-5.6 Sol', description: 'Previous flagship tier, strong fiction' },
            { id: 'gpt-5.6-terra', name: 'GPT-5.6 Terra', description: 'Previous mid tier — flat for fiction' },
            { id: 'gpt-5', name: 'GPT-5', description: 'Older gen' },
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
