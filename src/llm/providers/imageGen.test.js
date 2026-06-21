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
        const fetchMock = vi.fn().mockResolvedValue({
            ok: true,
            json: async () => ({ data: [{ b64_json: 'dGVzdA==' }] }),
        });
        vi.stubGlobal('fetch', fetchMock);

        const result = await generateSceneImageDetailed('Vesa defeats Kraul', 'xai-test-key');

        expect(result).toEqual({
            provider: 'xai',
            fallbackReason: null,
            url: 'data:image/jpeg;base64,dGVzdA==',
        });
        expect(fetchMock).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({
            headers: expect.objectContaining({
                Authorization: 'Bearer xai-test-key',
            }),
        }));
    });

    it('adds the xAI prefix when a pasted key omits it', async () => {
        const fetchMock = vi.fn().mockResolvedValue({
            ok: true,
            json: async () => ({ data: [{ b64_json: 'dGVzdA==' }] }),
        });
        vi.stubGlobal('fetch', fetchMock);

        await generateSceneImageDetailed('Vesa lights a lantern', 'secret-suffix');

        expect(fetchMock).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({
            headers: expect.objectContaining({
                Authorization: 'Bearer xai-secret-suffix',
            }),
        }));
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
            fallbackReason: expect.stringContaining('xai-http-401'),
        });
    });
});
