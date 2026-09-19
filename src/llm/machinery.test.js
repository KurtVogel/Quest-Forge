import { describe, it, expect } from 'vitest';
import { describeKeyVendorMismatch, describeMachineryKeyField, describeMemoryUnavailable, detectApiKeyVendor, getMachineryGeminiKey, getBackgroundConfig, isMachineryReady, MACHINERY_MODEL } from './machinery.js';

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

    it('trims pasted whitespace from the Gemini DM key too (2026-09-19)', () => {
        expect(getMachineryGeminiKey({ llmProvider: 'gemini', apiKey: '  main-key\n' })).toBe('main-key');
    });
});

describe('detectApiKeyVendor / describeKeyVendorMismatch (2026-09-19 — a key in the wrong slot after a vendor switch)', () => {
    const GEMINI = 'AIzaSyD-example_key_of_the_usual_length_01';

    it('recognizes the three vendors by prefix and nothing else', () => {
        expect(detectApiKeyVendor(GEMINI)).toBe('gemini');
        expect(detectApiKeyVendor(' sk-proj-abc123 ')).toBe('openai');
        expect(detectApiKeyVendor('xai-abc123')).toBe('xai');
        expect(detectApiKeyVendor('AIza')).toBeNull();
        expect(detectApiKeyVendor('some-other-shape')).toBeNull();
        expect(detectApiKeyVendor('')).toBeNull();
        expect(detectApiKeyVendor(42)).toBeNull();
        expect(detectApiKeyVendor(null)).toBeNull();
    });

    it('warns only when the shape belongs to a DIFFERENT vendor than the field expects', () => {
        expect(describeKeyVendorMismatch('sk-proj-abc', 'gemini')).toBe('This looks like an OpenAI key (sk-…). Gemini keys start with AIza….');
        expect(describeKeyVendorMismatch(GEMINI, 'openai')).toBe('This looks like a Gemini key (AIza…). OpenAI keys start with sk-….');
        expect(describeKeyVendorMismatch(GEMINI, 'xai')).toBe('This looks like a Gemini key (AIza…). xAI keys start with xai-….');
        expect(describeKeyVendorMismatch('xai-abc', 'gemini')).toBe('This looks like an xAI key (xai-…). Gemini keys start with AIza….');
        expect(describeKeyVendorMismatch(GEMINI, 'gemini')).toBe('');
        expect(describeKeyVendorMismatch('sk-proj-abc', 'openai')).toBe('');
        expect(describeKeyVendorMismatch('unknown-shape', 'gemini')).toBe('');
        expect(describeKeyVendorMismatch('', 'gemini')).toBe('');
        expect(describeKeyVendorMismatch(GEMINI, 'unknown-vendor')).toBe('');
    });
});

describe('describeMemoryUnavailable (2026-09-19 — the memory-less turn names its cause)', () => {
    it('a rejected key is a standing outage with the remedy for the CURRENT DM vendor', () => {
        const reason = { status: 400, message: 'API key not valid. Please pass a valid API key.', timedOut: false };
        const line = describeMemoryUnavailable(reason, { llmProvider: 'openai' });
        expect(line).toContain('Gemini rejected the game-memory key (HTTP 400: API key not valid. Please pass a valid API key.)');
        expect(line).toContain('the Scribe and journal cannot run either');
        expect(line).toContain('Settings → AI Provider → Gemini API Key (game memory)');
        expect(line).not.toContain('resumes next turn');
        expect(describeMemoryUnavailable({ status: 403, message: 'PERMISSION_DENIED', timedOut: false }, { llmProvider: 'gemini' }))
            .toContain('Settings → AI Provider → API Key.');
        expect(describeMachineryKeyField({ llmProvider: 'gemini' })).toBe('Settings → AI Provider → API Key');
        expect(describeMachineryKeyField({ llmProvider: 'xai' })).toBe('Settings → AI Provider → Gemini API Key (game memory)');
    });

    it('a rate limit, a stall, an unknown status, and a network error are transient', () => {
        expect(describeMemoryUnavailable({ status: 429, message: 'Quota exceeded', timedOut: false }, {}))
            .toBe('Long-term memory could not be consulted this turn — Gemini rate-limited the embedding call (HTTP 429: Quota exceeded); the DM answers from the recent conversation only. Nothing is lost; retrieval resumes when the quota clears.');
        expect(describeMemoryUnavailable({ status: null, message: 'aborted', timedOut: true }, {}))
            .toBe('Long-term memory could not be consulted this turn — the embedding call stalled and was abandoned; the DM answers from the recent conversation only. Nothing is lost; retrieval resumes next turn.');
        expect(describeMemoryUnavailable({ status: 503, message: '', timedOut: false }, {}))
            .toBe('Long-term memory could not be consulted this turn — Gemini answered the embedding call with HTTP 503; the DM answers from the recent conversation only. Nothing is lost; retrieval resumes next turn.');
        expect(describeMemoryUnavailable({ status: null, message: 'Failed to fetch', timedOut: false }, {}))
            .toBe('Long-term memory could not be consulted this turn — the embedding call failed (Failed to fetch); the DM answers from the recent conversation only. Nothing is lost; retrieval resumes next turn.');
    });

    it('keeps the generic line when no reason arrived, and types a junk reason', () => {
        const generic = 'Long-term memory could not be consulted this turn (the embedding call failed) — the DM answers from the recent conversation only. Nothing is lost; retrieval resumes next turn.';
        expect(describeMemoryUnavailable(null, {})).toBe(generic);
        expect(describeMemoryUnavailable(undefined, undefined)).toBe(generic);
        expect(describeMemoryUnavailable({ status: 'nope', message: { x: 1 } }, {})).toBe(generic);
        expect(describeMemoryUnavailable({ status: 400, message: 7 }, {})).toContain('(HTTP 400)');
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
        expect(config).toEqual({
            provider: 'gemini',
            apiKey: 'gem-key',
            model: MACHINERY_MODEL,
            // Extraction economics (2026-08-09): no reasoning tokens, bounded
            // JSON output, and a 60s stall guard on every machinery call.
            thinkingBudget: 0,
            maxOutputTokens: 8192,
            timeoutMs: 60_000,
        });
    });

    it('returns an empty key (callers skip) when no Gemini key exists', () => {
        expect(getBackgroundConfig({ llmProvider: 'openai', apiKey: 'oa-key', model: 'gpt-4o' }).apiKey).toBe('');
    });
});

describe('type-strict keys (2026-09-16 providers-adapter P2 — a numeric key crashed the app shell in render)', () => {
    it('non-string keys read as absent instead of throwing', () => {
        expect(() => getMachineryGeminiKey({ llmProvider: 'xai', geminiApiKey: 123 })).not.toThrow();
        expect(getMachineryGeminiKey({ llmProvider: 'xai', geminiApiKey: 123 })).toBe('');
        expect(getMachineryGeminiKey({ llmProvider: 'gemini', apiKey: { k: 1 } })).toBe('');
        expect(getMachineryGeminiKey({ llmProvider: 'gemini', apiKey: ['k'], geminiApiKey: 'gem-key' })).toBe('gem-key');
        expect(isMachineryReady({ llmProvider: 'gemini', apiKey: 42 })).toBe(false);
    });
});
