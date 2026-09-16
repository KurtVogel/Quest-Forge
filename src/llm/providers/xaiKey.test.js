import { describe, expect, it } from 'vitest';
import { normalizeXaiApiKey } from './xaiKey.js';

describe('normalizeXaiApiKey', () => {
    it('trims and prefixes a pasted bare token; keeps a prefixed one', () => {
        expect(normalizeXaiApiKey('  abc  ')).toBe('xai-abc');
        expect(normalizeXaiApiKey('xai-abc')).toBe('xai-abc');
        expect(normalizeXaiApiKey('')).toBe('');
        expect(normalizeXaiApiKey(undefined)).toBe('');
    });

    it('is type-strict (2026-09-16 providers-adapter P2): a non-string key is no key, never a throw', () => {
        expect(() => normalizeXaiApiKey(123)).not.toThrow();
        expect(normalizeXaiApiKey(123)).toBe('');
        expect(normalizeXaiApiKey({ key: 'x' })).toBe('');
        expect(normalizeXaiApiKey(['xai-abc'])).toBe('');
    });
});
