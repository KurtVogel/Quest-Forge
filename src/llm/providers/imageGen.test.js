import { beforeEach, describe, expect, it, vi } from 'vitest';
import { clearImageCache, generateSceneImageDetailed } from './imageGen.js';

describe('scene image provider reporting', () => {
    beforeEach(() => {
        clearImageCache();
        vi.restoreAllMocks();
    });

    it('labels the free provider when no xAI image key is configured', async () => {
        const fetchMock = vi.fn();
        vi.stubGlobal('fetch', fetchMock);

        const result = await generateSceneImageDetailed('Vesa in a cavern', '');

        expect(result).toMatchObject({
            provider: 'pollinations',
            fallbackReason: 'missing-key',
            url: expect.stringContaining('image.pollinations.ai'),
        });
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('reports xAI success without a fallback warning', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
            ok: true,
            json: async () => ({ data: [{ b64_json: 'dGVzdA==' }] }),
        }));

        const result = await generateSceneImageDetailed('Vesa defeats Kraul', 'xai-test-key');

        expect(result).toEqual({
            provider: 'xai',
            fallbackReason: null,
            url: 'data:image/jpeg;base64,dGVzdA==',
        });
    });

    it('labels fallback output when xAI rejects the request', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
            ok: false,
            status: 401,
            text: async () => 'invalid key',
        }));

        const result = await generateSceneImageDetailed('Vesa defeats Kraul', 'bad-key');

        expect(result).toMatchObject({
            provider: 'pollinations',
            fallbackReason: 'xai-error',
        });
    });
});
