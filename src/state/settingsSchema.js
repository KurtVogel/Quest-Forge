/**
 * The persisted settings blob's field heal (2026-09-16 providers-adapter P2).
 * Every other persisted input — the save, the roster, the ledgers — got a
 * typed load boundary; settings were typed as a CONTAINER only, and
 * GameContext spread the fields over the defaults. A numeric `geminiApiKey`
 * in a corrupted row threw `?.trim is not a function` from
 * getMachineryGeminiKey, which AppShell calls in RENDER whenever an apiKey is
 * set — the shell went down at boot and stayed down until the row was cleared
 * by hand. Known keys only, strings through cleanTextField, provider / preset /
 * pace whitelisted, unknown keys dropped. Only keys PRESENT in the stored
 * blob are returned, so the GameContext merge keeps supplying the defaults —
 * with one exception: a stored provider without a model gets its provider's
 * first row (the default model belongs to the default provider). This is the
 * ONE model heal (2026-10-12: GameContext re-ran it on the merged settings).
 */
import { PROVIDERS, RETIRED_MODEL_ALIASES } from '../llm/modelCatalog.js';
import { PRESETS } from '../data/presets.js';
import { normalizePaceDial } from '../engine/worldTempo.js';
import { cleanTextField } from '../config/contentLimits.js';
import { DEFAULT_CUSTOM_SYSTEM_PROMPT, RETIRED_DEFAULT_CUSTOM_SYSTEM_PROMPTS } from '../data/dmStylePrompt.js';

/** Line endings and the outer whitespace are not an edit. */
const promptKey = text => String(text || '').replace(/\r\n?/g, '\n').trim();
const RETIRED_PROMPT_KEYS = new Set(RETIRED_DEFAULT_CUSTOM_SYSTEM_PROMPTS.map(promptKey));

/**
 * A saved campaign prompt that is still, character for character, a default
 * this game used to ship was never edited by the player: it moves to the
 * current default (2026-11-09, the lean-description paragraph). Anything else
 * is the player's own words and is kept as written.
 */
export function healRetiredDefaultPrompt(prompt) {
    return RETIRED_PROMPT_KEYS.has(promptKey(prompt)) ? cleanTextField(DEFAULT_CUSTOM_SYSTEM_PROMPT, SETTINGS_CUSTOM_PROMPT_MAX) : prompt;
}

export const SETTINGS_KEY_MAX = 512;
export const SETTINGS_MODEL_MAX = 120;
export const SETTINGS_RULESET_MAX = 60;
export const SETTINGS_CUSTOM_PROMPT_MAX = 20_000;
const FIREBASE_CONFIG_KEYS = Object.freeze([
    'apiKey', 'authDomain', 'projectId', 'storageBucket', 'messagingSenderId', 'appId', 'measurementId', 'databaseURL',
]);

const STRING_FIELDS = Object.freeze({
    apiKey: SETTINGS_KEY_MAX,
    geminiApiKey: SETTINGS_KEY_MAX,
    imageApiKey: SETTINGS_KEY_MAX,
    model: SETTINGS_MODEL_MAX,
    ruleset: SETTINGS_RULESET_MAX,
    customSystemPrompt: SETTINGS_CUSTOM_PROMPT_MAX,
});

export function sanitizeSettings(raw) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
    const out = {};
    for (const [key, max] of Object.entries(STRING_FIELDS)) {
        if (key in raw) out[key] = cleanTextField(raw[key], max);
    }
    if (typeof out.customSystemPrompt === 'string') out.customSystemPrompt = healRetiredDefaultPrompt(out.customSystemPrompt);
    if ('llmProvider' in raw && typeof raw.llmProvider === 'string' && Object.prototype.hasOwnProperty.call(PROVIDERS, raw.llmProvider)) {
        out.llmProvider = raw.llmProvider;
    }
    // A model id the picker no longer offers (the Gemini Pro rows were retired
    // 2026-10-11 — heavy, expensive, more censored) falls to the provider's first
    // row: the picker is a <select>, so a stored id outside the list rendered
    // blank and the DM call went to a model the app had dropped on purpose. A
    // stored provider WITHOUT a model takes its first row too — the merge would
    // otherwise pair it with the default (Gemini) model. A RETIRED id with an
    // alias (2026-11-04: what the provider itself routes it to) lands on that
    // row when it is one of the provider's own, so a 2.5 Flash player keeps
    // the Flash-Lite tier Google gives them instead of stepping up to 3.8 Flash.
    if (typeof out.model === 'string' || out.llmProvider) {
        const provider = PROVIDERS[out.llmProvider || 'gemini'];
        if (provider && !provider.models.some(m => m.id === out.model)) {
            const alias = typeof out.model === 'string' ? RETIRED_MODEL_ALIASES[out.model] : undefined;
            out.model = alias && provider.models.some(m => m.id === alias) ? alias : provider.models[0].id;
        }
    }
    if ('preset' in raw && typeof raw.preset === 'string' && Object.prototype.hasOwnProperty.call(PRESETS, raw.preset)) {
        out.preset = raw.preset;
    }
    if ('paceDial' in raw) out.paceDial = normalizePaceDial(raw.paceDial);
    if ('memoryInspector' in raw) out.memoryInspector = raw.memoryInspector === true;
    if ('firebaseConfig' in raw) {
        const config = raw.firebaseConfig;
        if (config && typeof config === 'object' && !Array.isArray(config)) {
            // Key NAMES whitelisted (2026-11-05 strengthening P2): values and the
            // key count were bounded, names never — a 100,000-char key survived,
            // was re-written by saveSettings and parsed on every boot. The
            // config is handed whole to `initializeApp`, so the list is the
            // Firebase web config's own keys (Settings types the first three).
            out.firebaseConfig = Object.fromEntries(
                FIREBASE_CONFIG_KEYS
                    .filter(k => Object.prototype.hasOwnProperty.call(config, k) && typeof config[k] === 'string')
                    .map(k => [k, config[k].trim().slice(0, SETTINGS_KEY_MAX)]),
            );
        }
    }
    return out;
}
