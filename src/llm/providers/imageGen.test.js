import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearImageCache, generateSceneImageDetailed, generatePortraitImageDetailed, IMAGE_FETCH_TIMEOUT_MS, peekCachedImage } from './imageGen.js';

const xaiOk = (b64 = 'dGVzdA==') => ({
    ok: true,
    json: async () => ({ data: [{ b64_json: b64 }] }),
});

const geminiOk = (b64 = 'Z2VtaW5p', mimeType = 'image/png') => ({
    ok: true,
    json: async () => ({
        candidates: [{ content: { parts: [{ inlineData: { data: b64, mimeType } }] } }],
    }),
});

describe('scene image provider reporting', () => {
    beforeEach(() => {
        clearImageCache();
        vi.restoreAllMocks();
    });

    it('labels the free provider when no image key of any kind is configured', async () => {
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
        const fetchMock = vi.fn().mockResolvedValue(xaiOk());
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
        const fetchMock = vi.fn().mockResolvedValue(xaiOk());
        vi.stubGlobal('fetch', fetchMock);

        await generateSceneImageDetailed('Vesa lights a lantern', 'secret-suffix');

        expect(fetchMock).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({
            headers: expect.objectContaining({
                Authorization: 'Bearer xai-secret-suffix',
            }),
        }));
    });

    it('labels fallback output when xAI rejects the request and no Gemini key exists', async () => {
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

describe('input-keyed scene cache (2026-08-01 queue P1)', () => {
    beforeEach(() => {
        clearImageCache();
        vi.restoreAllMocks();
    });

    it('hits on the same cacheKey even when the composed prompt differs', async () => {
        // Scene prompts are LLM-composed and never byte-identical — the key is
        // the render's inputs, so a repeat Visualize on an unchanged scene hits.
        const fetchMock = vi.fn().mockResolvedValue(xaiOk());
        vi.stubGlobal('fetch', fetchMock);
        const first = await generateSceneImageDetailed('Composed prompt A', 'xai-key', { cacheKey: 'scene|msg-1|Tavern' });
        const second = await generateSceneImageDetailed('Composed prompt B, reworded by the LLM', 'xai-key', { cacheKey: 'scene|msg-1|Tavern' });
        expect(second).toEqual(first);
        expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('peekCachedImage probes without generating, honoring provider preference', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(xaiOk()));
        expect(peekCachedImage('scene|msg-1|Tavern', { imageApiKey: 'xai-key' })).toBeNull();
        const rendered = await generateSceneImageDetailed('Prompt', 'xai-key', { cacheKey: 'scene|msg-1|Tavern' });
        expect(peekCachedImage('scene|msg-1|Tavern', { imageApiKey: 'xai-key' })).toEqual(rendered);
        // Different provider preference (no keys → pollinations) must NOT
        // return the xAI-cached entry — better-provider retries stay possible.
        expect(peekCachedImage('scene|msg-1|Tavern', {})).toBeNull();
    });

    it('bypassCache rerolls and the new image replaces the cached entry', async () => {
        const fetchMock = vi.fn()
            .mockResolvedValueOnce(xaiOk('dGVzdA=='))
            .mockResolvedValueOnce(xaiOk('bmV3ZXI='));
        vi.stubGlobal('fetch', fetchMock);
        const first = await generateSceneImageDetailed('Prompt', 'xai-key', { cacheKey: 'k' });
        const rerolled = await generateSceneImageDetailed('Prompt', 'xai-key', { cacheKey: 'k', bypassCache: true });
        expect(rerolled.url).not.toBe(first.url);
        expect(peekCachedImage('k', { imageApiKey: 'xai-key' }).url).toBe(rerolled.url);
    });

    it('evicts the oldest entry once the cache exceeds its cap (2026-08-01 queue P2)', async () => {
        vi.stubGlobal('fetch', vi.fn());
        // Pollinations path (no keys) — no network needed, distinct cache keys.
        for (let i = 0; i <= 10; i++) {
            await generateSceneImageDetailed(`Scene ${i}`, '', { cacheKey: `k${i}` });
        }
        expect(peekCachedImage('k0', {})).toBeNull(); // oldest evicted at 11
        expect(peekCachedImage('k1', {})).not.toBeNull();
        expect(peekCachedImage('k10', {})).not.toBeNull();
    });

    it('caps a runaway composed prompt before it rides the POST request body (2026-08-01 queue P2)', async () => {
        const fetchMock = vi.fn().mockResolvedValue(xaiOk());
        vi.stubGlobal('fetch', fetchMock);
        await generateSceneImageDetailed('x'.repeat(20000), 'xai-key');
        const body = JSON.parse(fetchMock.mock.calls[0][1].body);
        expect(body.prompt.length).toBe(4000);
    });
});

describe('xAI degradation branches (2026-07-22 queue P1)', () => {
    beforeEach(() => {
        clearImageCache();
        vi.restoreAllMocks();
    });

    it('falls back with xai-empty when xAI returns 200 but no image (moderation)', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
            ok: true,
            json: async () => ({ data: [] }),
        }));

        const result = await generateSceneImageDetailed('A filtered scene', 'xai-key');
        expect(result).toMatchObject({
            provider: 'pollinations',
            fallbackReason: expect.stringContaining('xai-empty'),
        });
    });

    it('falls back with xai-network when the fetch itself throws', async () => {
        vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('connection reset')));

        const result = await generateSceneImageDetailed('A scene', 'xai-key');
        expect(result).toMatchObject({
            provider: 'pollinations',
            fallbackReason: expect.stringContaining('xai-network: connection reset'),
        });
    });

    it('a cached pollinations fallback never blocks a later xAI retry', async () => {
        // First call: xAI down → pollinations cached under its own provider key.
        vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('down')));
        const first = await generateSceneImageDetailed('Same scene', 'xai-key');
        expect(first.provider).toBe('pollinations');

        // Second call: xAI recovered — the preferred-provider cache key misses
        // and the retry reaches xAI.
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(xaiOk()));
        const second = await generateSceneImageDetailed('Same scene', 'xai-key');
        expect(second.provider).toBe('xai');
    });

    it('returns the cached xAI result on an identical repeat call', async () => {
        const fetchMock = vi.fn().mockResolvedValue(xaiOk());
        vi.stubGlobal('fetch', fetchMock);

        await generateSceneImageDetailed('Same scene', 'xai-key');
        await generateSceneImageDetailed('Same scene', 'xai-key');
        expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('bypassCache rerolls a fresh image instead of returning the cache', async () => {
        const fetchMock = vi.fn().mockResolvedValue(xaiOk());
        vi.stubGlobal('fetch', fetchMock);

        await generateSceneImageDetailed('Same scene', 'xai-key');
        await generateSceneImageDetailed('Same scene', 'xai-key', { bypassCache: true });
        expect(fetchMock).toHaveBeenCalledTimes(2);
    });
});

describe('Gemini image fallback (DECISIONS.md 2026-07-25)', () => {
    beforeEach(() => {
        clearImageCache();
        vi.restoreAllMocks();
    });

    it('renders through Gemini on the machinery key when no xAI key is set', async () => {
        const fetchMock = vi.fn().mockResolvedValue(geminiOk());
        vi.stubGlobal('fetch', fetchMock);

        const result = await generateSceneImageDetailed('A rainy street', '', { geminiApiKey: 'gem-key' });

        expect(result).toMatchObject({
            provider: 'gemini',
            fallbackReason: 'missing-key',
            url: 'data:image/png;base64,Z2VtaW5p',
        });
        const [url, init] = fetchMock.mock.calls[0];
        expect(url).toContain('gemini-3-pro-image:generateContent');
        expect(url).toContain('key=gem-key');
        const body = JSON.parse(init.body);
        expect(body.generationConfig.imageConfig.aspectRatio).toBe('16:9');
        expect(body.generationConfig.responseModalities).toEqual(['IMAGE']);
    });

    it('portraits request the 3:4 aspect from Gemini', async () => {
        const fetchMock = vi.fn().mockResolvedValue(geminiOk());
        vi.stubGlobal('fetch', fetchMock);

        await generatePortraitImageDetailed('A portrait', '', { geminiApiKey: 'gem-key' });
        const body = JSON.parse(fetchMock.mock.calls[0][1].body);
        expect(body.generationConfig.imageConfig.aspectRatio).toBe('3:4');
    });

    it('tries xAI first and falls through to Gemini when xAI fails', async () => {
        const fetchMock = vi.fn()
            .mockResolvedValueOnce({ ok: false, status: 500, text: async () => 'boom' })
            .mockResolvedValueOnce(geminiOk());
        vi.stubGlobal('fetch', fetchMock);

        const result = await generateSceneImageDetailed('A scene', 'xai-key', { geminiApiKey: 'gem-key' });
        expect(result.provider).toBe('gemini');
        expect(result.fallbackReason).toContain('xai-http-500');
        expect(fetchMock.mock.calls[0][0]).toContain('api.x.ai');
        expect(fetchMock.mock.calls[1][0]).toContain('generativelanguage.googleapis.com');
    });

    it('falls to pollinations with a combined reason when Gemini also returns no image', async () => {
        const fetchMock = vi.fn().mockResolvedValue({
            ok: true,
            json: async () => ({ candidates: [{ finishReason: 'IMAGE_SAFETY', content: { parts: [] } }] }),
        });
        vi.stubGlobal('fetch', fetchMock);

        const result = await generateSceneImageDetailed('A blocked scene', '', { geminiApiKey: 'gem-key' });
        expect(result).toMatchObject({
            provider: 'pollinations',
            fallbackReason: expect.stringContaining('gemini-empty (IMAGE_SAFETY)'),
        });
    });

    it('falls to pollinations when Gemini errors over HTTP', async () => {
        const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 429, text: async () => 'quota' });
        vi.stubGlobal('fetch', fetchMock);

        const result = await generateSceneImageDetailed('A scene', '', { geminiApiKey: 'gem-key' });
        expect(result).toMatchObject({
            provider: 'pollinations',
            fallbackReason: expect.stringContaining('gemini-http-429'),
        });
    });
});

describe('pollinations URL prompt cap (2026-07-22 queue P2)', () => {
    beforeEach(() => {
        clearImageCache();
        vi.restoreAllMocks();
    });

    it('caps a very long composed prompt before URL-encoding it', async () => {
        vi.stubGlobal('fetch', vi.fn());
        const longPrompt = 'A grand tableau. '.repeat(500); // ~8500 chars

        const result = await generateSceneImageDetailed(longPrompt, '');
        expect(result.provider).toBe('pollinations');
        const encodedPrompt = result.url.split('/prompt/')[1].split('?')[0];
        expect(decodeURIComponent(encodedPrompt).length).toBeLessThanOrEqual(1500);
    });
});

describe('downscaleDataUrl portrait compaction (2026-07-06 queue P1)', () => {
    // The downscale path needs Image + canvas; stub minimal DOM implementations.
    let origImage;
    let origDocument;

    function stubDom({ naturalWidth, naturalHeight, fail = false }) {
        class FakeImage {
            set src(_value) {
                this.naturalWidth = naturalWidth;
                this.naturalHeight = naturalHeight;
                queueMicrotask(() => (fail ? this.onerror?.(new Error('bad image')) : this.onload?.()));
            }
        }
        origImage = globalThis.Image;
        origDocument = globalThis.document;
        globalThis.Image = FakeImage;
        globalThis.document = {
            createElement: () => ({
                getContext: () => ({ drawImage: vi.fn() }),
                toDataURL: (mime) => `data:${mime};base64,c2NhbGVk`,
            }),
        };
    }

    beforeEach(() => {
        clearImageCache();
        vi.restoreAllMocks();
    });

    afterEach(() => {
        globalThis.Image = origImage;
        globalThis.document = origDocument;
    });

    it('downscales an oversized portrait to the requested bounds', async () => {
        stubDom({ naturalWidth: 960, naturalHeight: 1280 });
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(xaiOk()));

        const result = await generatePortraitImageDetailed('A portrait', 'xai-key');
        expect(result.url).toBe('data:image/jpeg;base64,c2NhbGVk');
    });

    it('returns the original data URL when the image is already small enough', async () => {
        stubDom({ naturalWidth: 400, naturalHeight: 500 });
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(xaiOk()));

        const result = await generatePortraitImageDetailed('A portrait', 'xai-key');
        expect(result.url).toBe('data:image/jpeg;base64,dGVzdA==');
    });

    it('degrades to the original data URL when decoding fails', async () => {
        stubDom({ naturalWidth: 0, naturalHeight: 0, fail: true });
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(xaiOk()));

        const result = await generatePortraitImageDetailed('A portrait', 'xai-key');
        expect(result.url).toBe('data:image/jpeg;base64,dGVzdA==');
    });

    it('scene renders skip downscaling entirely (no maxWidth/maxHeight)', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(xaiOk()));
        const result = await generateSceneImageDetailed('A scene', 'xai-key');
        expect(result.url).toBe('data:image/jpeg;base64,dGVzdA==');
    });
});

describe('stall guard + cancel on the provider chain (2026-09-01 scene-art P1)', () => {
    // A fetch that never resolves on its own and rejects with the signal's
    // reason when aborted — the shape of a stalled socket.
    const hangingFetch = () => vi.fn((_url, init) => new Promise((_resolve, reject) => {
        init.signal.addEventListener('abort', () => reject(init.signal.reason), { once: true });
    }));

    beforeEach(() => {
        clearImageCache();
        vi.restoreAllMocks();
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('times out a stalled xAI POST and falls through the chain as an xai-network reason', async () => {
        const fetchMock = hangingFetch();
        vi.stubGlobal('fetch', fetchMock);
        const pending = generateSceneImageDetailed('A scene', 'xai-key');
        await vi.advanceTimersByTimeAsync(IMAGE_FETCH_TIMEOUT_MS - 1);
        expect(fetchMock).toHaveBeenCalledTimes(1);
        await vi.advanceTimersByTimeAsync(1);
        const result = await pending;
        expect(result).toMatchObject({
            provider: 'pollinations',
            fallbackReason: expect.stringContaining('xai-network: stalled — no response after 60s'),
        });
        expect(fetchMock.mock.calls[0][1].signal).toBeInstanceOf(AbortSignal);
    });

    it('times out a stalled Gemini POST the same way', async () => {
        const fetchMock = hangingFetch();
        vi.stubGlobal('fetch', fetchMock);
        const pending = generateSceneImageDetailed('A scene', '', { geminiApiKey: 'gem-key' });
        await vi.advanceTimersByTimeAsync(IMAGE_FETCH_TIMEOUT_MS);
        const result = await pending;
        expect(result).toMatchObject({
            provider: 'pollinations',
            fallbackReason: expect.stringContaining('gemini-network: stalled'),
        });
        expect(fetchMock.mock.calls[0][0]).toContain('generativelanguage.googleapis.com');
    });

    it('a deliberate cancel rejects with AbortError and does NOT fall through to the next provider', async () => {
        const fetchMock = hangingFetch();
        vi.stubGlobal('fetch', fetchMock);
        const controller = new AbortController();
        const pending = generateSceneImageDetailed('A scene', 'xai-key', { geminiApiKey: 'gem-key', signal: controller.signal });
        await vi.advanceTimersByTimeAsync(10);
        controller.abort();
        await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
        // Only the xAI attempt happened — cancel ≠ provider failure.
        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(peekCachedImage('anything', { imageApiKey: 'xai-key' })).toBeNull();
    });

    it('a cancel during the Gemini leg rejects instead of returning pollinations', async () => {
        const fetchMock = hangingFetch();
        vi.stubGlobal('fetch', fetchMock);
        const controller = new AbortController();
        const pending = generateSceneImageDetailed('A scene', '', { geminiApiKey: 'gem-key', signal: controller.signal });
        await vi.advanceTimersByTimeAsync(10);
        controller.abort();
        await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
        expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('a successful render clears its stall timer (no late abort, no leaked timer)', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(xaiOk()));
        const result = await generateSceneImageDetailed('A scene', 'xai-key');
        expect(result.provider).toBe('xai');
        expect(vi.getTimerCount()).toBe(0);
    });
});

describe('sessionScope isolation + provider mime branches (2026-09-01 test depth)', () => {
    beforeEach(() => {
        clearImageCache();
        vi.restoreAllMocks();
    });

    it('the same cacheKey in two campaigns never shares a render, and peekCachedImage honors the scope', async () => {
        const fetchMock = vi.fn()
            .mockResolvedValueOnce(xaiOk('Y2FtcGFpZ25B'))
            .mockResolvedValueOnce(xaiOk('Y2FtcGFpZ25C'));
        vi.stubGlobal('fetch', fetchMock);
        const a = await generateSceneImageDetailed('Prompt', 'xai-key', { cacheKey: 'scene|msg-1|Tavern', sessionScope: 'campaign-a' });
        const b = await generateSceneImageDetailed('Prompt', 'xai-key', { cacheKey: 'scene|msg-1|Tavern', sessionScope: 'campaign-b' });
        expect(fetchMock).toHaveBeenCalledTimes(2);
        expect(a.url).not.toBe(b.url);
        expect(peekCachedImage('scene|msg-1|Tavern', { imageApiKey: 'xai-key', sessionScope: 'campaign-a' })).toEqual(a);
        expect(peekCachedImage('scene|msg-1|Tavern', { imageApiKey: 'xai-key', sessionScope: 'campaign-b' })).toEqual(b);
        expect(peekCachedImage('scene|msg-1|Tavern', { imageApiKey: 'xai-key' })).toBeNull();
        expect(peekCachedImage('scene|msg-1|Tavern', { imageApiKey: 'xai-key', sessionScope: 'campaign-c' })).toBeNull();
    });

    it('sniffs png, gif, and webp payloads from xAI by their leading bytes', async () => {
        const fetchMock = vi.fn()
            .mockResolvedValueOnce(xaiOk('iVBORw0KGgo='))
            .mockResolvedValueOnce(xaiOk('R0lGODlhAQAB'))
            .mockResolvedValueOnce(xaiOk('UklGRiQAAABXRUJQ'));
        vi.stubGlobal('fetch', fetchMock);
        expect((await generateSceneImageDetailed('png', 'xai-key')).url).toMatch(/^data:image\/png;base64,/);
        expect((await generateSceneImageDetailed('gif', 'xai-key')).url).toMatch(/^data:image\/gif;base64,/);
        expect((await generateSceneImageDetailed('webp', 'xai-key')).url).toMatch(/^data:image\/webp;base64,/);
    });
});

describe('Gemini-path portrait downscale (2026-09-01 test depth)', () => {
    let origImage;
    let origDocument;

    beforeEach(() => {
        clearImageCache();
        vi.restoreAllMocks();
        origImage = globalThis.Image;
        origDocument = globalThis.document;
        globalThis.Image = class {
            set src(_value) {
                this.naturalWidth = 960;
                this.naturalHeight = 1280;
                queueMicrotask(() => this.onload?.());
            }
        };
        globalThis.document = {
            createElement: () => ({
                getContext: () => ({ drawImage: vi.fn() }),
                toDataURL: (mime) => `data:${mime};base64,c2NhbGVk`,
            }),
        };
    });

    afterEach(() => {
        globalThis.Image = origImage;
        globalThis.document = origDocument;
    });

    it('downscales an oversized Gemini portrait exactly like the xAI path', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(geminiOk()));
        const result = await generatePortraitImageDetailed('A portrait', '', { geminiApiKey: 'gem-key' });
        expect(result.provider).toBe('gemini');
        expect(result.url).toBe('data:image/jpeg;base64,c2NhbGVk');
    });
});
