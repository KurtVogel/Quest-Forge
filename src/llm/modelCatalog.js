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
            { id: DEFAULT_DM_MODEL, name: 'Gemini 3.8 Flash (Recommended)', description: 'The DM model — newest Flash, stable, fast and cheap (1M context, 64k output)', dmThinking: 'low' },
            { id: 'gemini-3-flash-preview', name: 'Gemini 3 Flash', description: 'Fast frontier-class, great value' },
            { id: 'gemini-3.5-flash-lite', name: 'Gemini 3.5 Flash-Lite', description: 'Budget tier — what Gemini 2.5 Flash becomes on 2026-12-01; stronger multi-turn persona consistency than 3.1 Flash-Lite ($0.30 / $2.50 per M tokens)' },
            { id: 'gemini-3.1-flash-lite', name: 'Gemini 3.1 Flash-Lite', description: 'Cheapest ($0.25 / $1.50 per M tokens)' },
            // gemini-2.5-flash left the picker 2026-11-04: Google retired it
            // 2026-11-02 and routes it to gemini-3.5-flash-lite from 2026-12-01
            // (RETIRED_MODEL_ALIASES below keeps a stored id on that tier).
        ],
    },
    openai: {
        name: 'OpenAI',
        models: [
            // GPT-6 family (Astra 2026-09-03, Sol/Luna 09-22, 6.1 Sol 09-29). For a
            // DM the tier is the prose: Terra reviewed as narratively flat, Astra
            // leads EQ-Bench creative writing at 5× Sol's price (2026-10-03).
            { id: 'gpt-6.1-sol', name: 'GPT-6.1 Sol (Recommended)', description: 'Newest — near-Astra quality at a fifth of the price', dmThinking: 'low' },
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
            // 4.3 stays the recommended row (2026-11-04): 1M context at $1.25 /
            // $2.50 per M, the only Grok shape played here. xAI's own pick is
            // 4.7 ("the most capable model we've built", 500k context, $2 / $6,
            // every rate ×2 at ≥ 200k prompt tokens) — offered, not default,
            // until a run shows its event compliance. grok-4.1-fast left the
            // picker: xAI's models page no longer lists it (alias below).
            { id: 'grok-4.3', name: 'Grok 4.3 (Recommended)', description: 'xAI — fast, strong prose, 1M context, but weaker game-event compliance: quests, loot, and coin may need the built-in audits to keep up' },
            { id: 'grok-4.7', name: 'Grok 4.7', description: 'xAI\'s newest and most capable; 500k context, $2 / $6 per M tokens (×2 at ≥ 200k prompt tokens). Not playtested here — same event-compliance caveat' },
        ],
    },
};

/**
 * Model ids the picker no longer offers, mapped to the row a stored setting
 * should land on (2026-11-04). Each alias is what the PROVIDER itself does
 * with the retired id, so the player keeps the tier they chose: Google routes
 * gemini-2.5-flash to gemini-3.5-flash-lite and gemini-2.5-pro to
 * gemini-3.8-flash from 2026-12-01 (changelog 2026-11-02); xAI aliases a
 * retired id to the latest stable version. The settings heal reads this
 * before falling to the provider's first row; an alias never crosses
 * providers (the heal checks the target is one of the provider's own rows).
 */
export const RETIRED_MODEL_ALIASES = Object.freeze({
    'gemini-2.5-flash': 'gemini-3.5-flash-lite',
    'gemini-2.5-pro': DEFAULT_DM_MODEL,
    'grok-4.1-fast': 'grok-4.3',
});

export const PROVIDER_LIST = Object.keys(PROVIDERS);

/**
 * The thinking level the DM stream asks a model for: the row's `dmThinking`,
 * or null when the row has none and the provider's own default governs.
 *
 * A level is a fact about ONE model, never a provider-wide default. With
 * nothing sent, Gemini 3.8 Flash thinks before every reply and the player
 * waits on it, while the Flash-Lite rows do not think at all and a level
 * would make them start. The models also disagree on what they accept
 * (3.8 Flash refuses `minimal`; GPT-6.1 Sol refuses `none`). So a row carries
 * a level only where that level was timed against the model's default on the
 * same scripted turns (`npm run eval:latency`) and the replies were read
 * blind. The value is the wire value: Gemini's `thinkingLevel`, OpenAI's
 * `reasoning_effort`.
 */
export function dmThinkingLevelFor(provider, model) {
    const row = PROVIDERS[provider]?.models?.find(entry => entry.id === model);
    return typeof row?.dmThinking === 'string' && row.dmThinking ? row.dmThinking : null;
}
