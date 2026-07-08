import { describe, it, expect } from 'vitest';
import { getMachineryGeminiKey, getBackgroundConfig, isMachineryReady, MACHINERY_MODEL } from './machinery.js';

describe('getMachineryGeminiKey', () => {
    it('doubles the main key as the machinery key when the DM is Gemini', () => {
        expect(getMachineryGeminiKey({ llmProvider: 'gemini', apiKey: 'main-key' })).toBe('main-key');
    });

    it('uses the dedicated Gemini key when the DM is another provider', () => {
        expect(getMachineryGeminiKey({ llmProvider: 'xai', apiKey: 'xai-key', geminiApiKey: 'gem-key' })).toBe('gem-key');
        expect(getMachineryGeminiKey({ llmProvider: 'openai', apiKey: 'oa-key', geminiApiKey: 'gem-key' })).toBe('gem-key');
    });

    it('prefers the dedicated key even when the Gemini DM key is empty', () => {
        expect(getMachineryGeminiKey({ llmProvider: 'gemini', apiKey: '', geminiApiKey: 'gem-key' })).toBe('gem-key');
    });

    it('returns empty when no Gemini key exists', () => {
        expect(getMachineryGeminiKey({ llmProvider: 'xai', apiKey: 'xai-key' })).toBe('');
        expect(getMachineryGeminiKey(null)).toBe('');
    });

    it('trims pasted whitespace from the dedicated key', () => {
        expect(getMachineryGeminiKey({ llmProvider: 'xai', geminiApiKey: '  gem-key  ' })).toBe('gem-key');
    });
});

describe('isMachineryReady', () => {
    it('mirrors machinery key availability', () => {
        expect(isMachineryReady({ llmProvider: 'gemini', apiKey: 'k' })).toBe(true);
        expect(isMachineryReady({ llmProvider: 'xai', apiKey: 'k', geminiApiKey: 'g' })).toBe(true);
        expect(isMachineryReady({ llmProvider: 'xai', apiKey: 'k' })).toBe(false);
        expect(isMachineryReady(undefined)).toBe(false);
    });
});

describe('getBackgroundConfig', () => {
    it('always targets Gemini Flash, never the DM provider or model', () => {
        const config = getBackgroundConfig({ llmProvider: 'xai', apiKey: 'xai-key', geminiApiKey: 'gem-key', model: 'grok-4.3' });
        expect(config).toEqual({ provider: 'gemini', apiKey: 'gem-key', model: MACHINERY_MODEL });
    });

    it('returns an empty key (callers skip) when no Gemini key exists', () => {
        expect(getBackgroundConfig({ llmProvider: 'openai', apiKey: 'oa-key', model: 'gpt-4o' }).apiKey).toBe('');
    });
});
