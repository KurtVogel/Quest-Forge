/**
 * Dev-only settings seeder for local playtesting.
 *
 * Reads API keys from Vite env vars (VITE_GEMINI_API_KEY / VITE_XAI_API_KEY in the
 * git-ignored .env.local) and merges them into the persisted settings blob before
 * React mounts, so a playtest session never has to paste keys into the UI.
 *
 * The DM provider can be flipped without touching keys by setting
 * localStorage['qf-dev-dm-provider'] to 'gemini' or 'xai' and reloading.
 *
 * No-op outside `npm run dev` (import.meta.env.DEV) or when no VITE_ keys exist.
 */
const SETTINGS_KEY = 'rpg-client-settings';
const DM_FLAG_KEY = 'qf-dev-dm-provider';

export function seedDevSettings() {
    if (!import.meta.env.DEV) return;
    const geminiKey = import.meta.env.VITE_GEMINI_API_KEY;
    const xaiKey = import.meta.env.VITE_XAI_API_KEY;
    if (!geminiKey && !xaiKey) return;

    let settings = {};
    try {
        settings = JSON.parse(localStorage.getItem(SETTINGS_KEY)) || {};
    } catch {
        settings = {};
    }

    if (geminiKey) settings.geminiApiKey = geminiKey; // mandatory machinery key
    if (xaiKey) settings.imageApiKey = xaiKey; // scene art / portraits

    const dm = localStorage.getItem(DM_FLAG_KEY) || 'gemini';
    if (dm === 'xai' && xaiKey) {
        settings.llmProvider = 'xai';
        settings.apiKey = xaiKey;
        settings.model = 'grok-4.3';
    } else if (geminiKey) {
        settings.llmProvider = 'gemini';
        settings.apiKey = geminiKey;
        settings.model = 'gemini-3.1-pro-preview';
    }

    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
    console.info(`[devSettingsSeed] seeded settings for DM provider "${settings.llmProvider}"`);
}
