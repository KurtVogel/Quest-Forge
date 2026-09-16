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
 * blob are returned, so the GameContext merge keeps supplying the defaults.
 */
import { PROVIDERS } from '../llm/adapter.js';
import { PRESETS } from '../data/presets.js';
import { normalizePaceDial } from '../engine/worldTempo.js';
import { cleanTextField } from '../config/contentLimits.js';

export const SETTINGS_KEY_MAX = 512;
export const SETTINGS_MODEL_MAX = 120;
export const SETTINGS_RULESET_MAX = 60;
export const SETTINGS_CUSTOM_PROMPT_MAX = 20_000;
const FIREBASE_CONFIG_MAX_KEYS = 20;

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
    if ('llmProvider' in raw && typeof raw.llmProvider === 'string' && Object.prototype.hasOwnProperty.call(PROVIDERS, raw.llmProvider)) {
        out.llmProvider = raw.llmProvider;
    }
    if ('preset' in raw && typeof raw.preset === 'string' && Object.prototype.hasOwnProperty.call(PRESETS, raw.preset)) {
        out.preset = raw.preset;
    }
    if ('paceDial' in raw) out.paceDial = normalizePaceDial(raw.paceDial);
    if ('memoryInspector' in raw) out.memoryInspector = raw.memoryInspector === true;
    if ('firebaseConfig' in raw) {
        const config = raw.firebaseConfig;
        if (config && typeof config === 'object' && !Array.isArray(config)) {
            out.firebaseConfig = Object.fromEntries(
                Object.entries(config)
                    .filter(([, value]) => typeof value === 'string')
                    .slice(0, FIREBASE_CONFIG_MAX_KEYS)
                    .map(([k, value]) => [k, value.trim().slice(0, SETTINGS_KEY_MAX)]),
            );
        }
    }
    return out;
}
