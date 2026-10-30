/**
 * `mimeFromBase64` sniffs JPEG explicitly and returns null for an unknown
 * magic (2026-10-29 audit nit): ANY unrecognised base64 used to default to
 * `image/jpeg`, so a non-image `b64_json` (an HTML error page, say) became a
 * `data:image/jpeg` URL the sanitizer accepted and the reducer stored. Now
 * that tier is `xai-empty (not an image)`, never cached, and the chain falls
 * through.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { clearImageCache, generateSceneImageDetailed, isXaiFilteredFallback, peekCachedImage } from './imageGen.js';

const xaiWith = (b64_json) => ({ ok: true, json: async () => ({ data: [{ b64_json }] }) });
const geminiOk = () => ({
    ok: true,
    json: async () => ({ candidates: [{ content: { parts: [{ inlineData: { data: 'Z2VtaW5p', mimeType: 'image/png' } }] } }] }),
});

describe('xAI payload magic (2026-10-29)', () => {
    beforeEach(() => {
        clearImageCache();
        vi.restoreAllMocks();
    });

    it('/9j/ is a JPEG', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(xaiWith('/9j/4AAQSkZJRg==')));
        const result = await generateSceneImageDetailed('A dock', 'xai-key');
        expect(result).toEqual({ provider: 'xai', fallbackReason: null, url: 'data:image/jpeg;base64,/9j/4AAQSkZJRg==' });
    });

    it('an HTML body (PCFET0NU = "<!DOCT") is "not an image": the tier is empty, nothing is cached, the chain falls through', async () => {
        const fetchMock = vi.fn()
            .mockResolvedValueOnce(xaiWith('PCFET0NUWVBFIGh0bWw+'))
            .mockResolvedValueOnce(geminiOk());
        vi.stubGlobal('fetch', fetchMock);
        const result = await generateSceneImageDetailed('A dock', 'xai-key', { geminiApiKey: 'gem-key', sessionScope: 's', cacheKey: 'k' });
        expect(result.provider).toBe('gemini');
        expect(result.fallbackReason).toBe('xai-empty (not an image)');
        expect(result.url).not.toContain('image/jpeg');
        // Not moderation: the filtered-notice predicate must not read it as one.
        expect(isXaiFilteredFallback(result.fallbackReason)).toBe(false);
        expect(peekCachedImage('k', { imageApiKey: 'xai-key', sessionScope: 's' })).toBeNull();
    });

    it('a body with no image data at all stays the bare xai-empty the moderation notice reads', async () => {
        const fetchMock = vi.fn()
            .mockResolvedValueOnce({ ok: true, json: async () => ({ data: [] }) })
            .mockResolvedValueOnce(geminiOk());
        vi.stubGlobal('fetch', fetchMock);
        const result = await generateSceneImageDetailed('A dock', 'xai-key', { geminiApiKey: 'gem-key' });
        expect(result.fallbackReason).toBe('xai-empty');
        expect(isXaiFilteredFallback(result.fallbackReason)).toBe(true);
    });
});
