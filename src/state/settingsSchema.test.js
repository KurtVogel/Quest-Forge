/**
 * The settings blob's typed load (settingsSchema.js) — its own suite since
 * 2026-10-12 (providers-adapter Lap 4): the model heal is THE one copy
 * (GameContext re-ran it on the merged settings and could never fire), and
 * the default DM model is one spelling across the catalog, the initial
 * state and the dev seed.
 */
import { describe, expect, it } from 'vitest';
import { sanitizeSettings } from './settingsSchema.js';
import { initialGameState } from './initialState.js';
import { DEFAULT_DM_MODEL, PROVIDERS } from '../llm/modelCatalog.js';
import { PROVIDERS as ADAPTER_PROVIDERS, DEFAULT_DM_MODEL as ADAPTER_DEFAULT } from '../llm/adapter.js';

/** What GameContext's initializer does with a loaded blob: defaults, then the blob. */
const merge = (blob) => ({ ...initialGameState.settings, ...sanitizeSettings(blob) });

describe('the stored-model heal (2026-10-12 — one copy)', () => {
    it('a retired Gemini Pro id falls to the provider\'s first row, the DM model', () => {
        expect(sanitizeSettings({ llmProvider: 'gemini', model: 'gemini-3.1-pro-preview' }).model).toBe(DEFAULT_DM_MODEL);
        expect(sanitizeSettings({ model: 'gemini-2.5-pro' }).model).toBe(DEFAULT_DM_MODEL);
    });

    it('a blank or junk model falls to the provider\'s first row', () => {
        expect(sanitizeSettings({ llmProvider: 'gemini', model: '' }).model).toBe(DEFAULT_DM_MODEL);
        expect(sanitizeSettings({ llmProvider: 'openai', model: '' }).model).toBe(PROVIDERS.openai.models[0].id);
        expect(sanitizeSettings({ llmProvider: 'xai', model: { id: 'grok' } }).model).toBe(PROVIDERS.xai.models[0].id);
    });

    it('a known id is kept on its own provider, and another provider\'s id is healed', () => {
        for (const provider of Object.keys(PROVIDERS)) {
            for (const { id } of PROVIDERS[provider].models) {
                expect(sanitizeSettings({ llmProvider: provider, model: id }).model).toBe(id);
            }
        }
        expect(sanitizeSettings({ llmProvider: 'openai', model: DEFAULT_DM_MODEL }).model).toBe(PROVIDERS.openai.models[0].id);
    });

    it('a stored provider WITHOUT a model gets its own first row, not the default provider\'s model', () => {
        expect(sanitizeSettings({ llmProvider: 'openai' })).toEqual({ llmProvider: 'openai', model: PROVIDERS.openai.models[0].id });
        expect(sanitizeSettings({ llmProvider: 'gemini' })).toEqual({ llmProvider: 'gemini', model: DEFAULT_DM_MODEL });
        // No provider and no model: nothing to heal, the merge supplies both defaults.
        expect(sanitizeSettings({ apiKey: 'k' })).toEqual({ apiKey: 'k' });
    });

    it('every merged blob already pairs a provider with one of its own models (the GameContext copy had nothing left to do)', () => {
        const blobs = [
            {}, { apiKey: 'k' }, { llmProvider: 'openai' }, { llmProvider: 'xai', model: 'gpt-4o' },
            { llmProvider: 'nope', model: 'grok-4.3' }, { model: 'gemini-3.1-pro-preview' }, { llmProvider: 'openai', model: '' },
        ];
        for (const blob of blobs) {
            const settings = merge(blob);
            expect(PROVIDERS[settings.llmProvider].models.some(m => m.id === settings.model)).toBe(true);
        }
    });
});

describe('the default DM model is one spelling', () => {
    it('the catalog lists it first for Gemini, the initial state uses it, and the adapter re-exports the same catalog', () => {
        expect(PROVIDERS.gemini.models[0].id).toBe(DEFAULT_DM_MODEL);
        expect(initialGameState.settings.llmProvider).toBe('gemini');
        expect(initialGameState.settings.model).toBe(DEFAULT_DM_MODEL);
        expect(ADAPTER_PROVIDERS).toBe(PROVIDERS);
        expect(ADAPTER_DEFAULT).toBe(DEFAULT_DM_MODEL);
    });
});
