/**
 * Provider payloads are trusted by TYPE, not shape (2026-09-09 audit P2): a
 * non-string Gemini body became `data:image/png;base64,[object Object]`,
 * returned as a SUCCESS and cached under the scene key; a verbatim
 * `text/html` mime flowed into the portrait writes; a non-string xAI body was
 * reported as `xai-network: b64.startsWith is not a function`.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { clearImageCache, generateSceneImageDetailed, peekCachedImage } from './imageGen.js';

const geminiWith = (inlineData, finishReason = 'STOP') => ({
    ok: true,
    json: async () => ({ candidates: [{ finishReason, content: { parts: [{ text: 'here' }, { inlineData }] } }] }),
});
const xaiWith = (b64_json) => ({ ok: true, json: async () => ({ data: [{ b64_json }] }) });

describe('image provider payload typing', () => {
    beforeEach(() => {
        clearImageCache();
        vi.restoreAllMocks();
    });

    it('a non-string Gemini body is "no image" for that tier, never a cached [object Object] success', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(geminiWith({ data: { bytes: 1 }, mimeType: 'image/png' })));
        const result = await generateSceneImageDetailed('A dock at dusk', '', { geminiApiKey: 'gem-key', sessionScope: 's1', cacheKey: 'k1' });
        expect(result.provider).toBe('pollinations');
        expect(result.fallbackReason).toContain('gemini-empty');
        expect(result.url).not.toContain('[object Object]');
        expect(peekCachedImage?.('gemini|s1|k1') ?? null).toBeNull();
    });

    it('a non-image Gemini mime is "no image" — text/html never reaches a portrait write', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(geminiWith({ data: 'PHNjcmlwdD4=', mimeType: 'text/html' })));
        const result = await generateSceneImageDetailed('A dock', '', { geminiApiKey: 'gem-key' });
        expect(result.provider).toBe('pollinations');
        expect(result.fallbackReason).toContain('gemini-empty');
    });

    it('a non-base64 Gemini body is refused too', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(geminiWith({ data: 'not base64 at all!', mimeType: 'image/png' })));
        const result = await generateSceneImageDetailed('A dock', '', { geminiApiKey: 'gem-key' });
        expect(result.provider).toBe('pollinations');
    });

    it('a valid Gemini webp body keeps its (lowercased) mime', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(geminiWith({ data: 'UklGRgAA', mimeType: 'IMAGE/WEBP' })));
        const result = await generateSceneImageDetailed('A dock', '', { geminiApiKey: 'gem-key' });
        expect(result).toMatchObject({ provider: 'gemini', url: 'data:image/webp;base64,UklGRgAA' });
    });

    it('a non-string xAI body is xai-empty (not a network error) and falls through the chain', async () => {
        const fetchMock = vi.fn()
            .mockResolvedValueOnce(xaiWith({ bytes: 1 }))
            .mockResolvedValueOnce(geminiWith({ data: 'Z2VtaW5p', mimeType: 'image/png' }));
        vi.stubGlobal('fetch', fetchMock);
        const result = await generateSceneImageDetailed('A dock', 'xai-key', { geminiApiKey: 'gem-key' });
        expect(result.provider).toBe('gemini');
        expect(result.fallbackReason).toBe('xai-empty');
        expect(result.fallbackReason).not.toContain('startsWith');
    });
});
