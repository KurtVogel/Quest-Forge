/**
 * 2026-10-03 scene-art Lap-4 pins.
 *
 * (1) The fallback-reason GRAMMAR is a contract between its writer (the
 * provider chain here) and its reader (`fallbackNotice` in SceneArt): the
 * reasons used to be assembled as prose in one module and parsed with `===` /
 * `includes` in the other, with no test that failed when a reason was renamed.
 * These cases run a REAL chain result through the real reader.
 *
 * (2) One portrait request: the option set the four call sites used to
 * assemble by hand, and the one error string they threw.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
    clearImageCache,
    generateSceneImageDetailed,
    imageRequestOptions,
    isMissingKeyFallback,
    isXaiFilteredFallback,
    NPC_PORTRAIT_SIZE,
    requestPortrait,
} from './imageGen.js';
import { fallbackNotice } from '../../components/SceneArt/sceneArtHelpers.js';

const xaiOk = (b64 = 'dGVzdA==') => ({ ok: true, json: async () => ({ data: [{ b64_json: b64 }] }) });
const xaiEmpty = () => ({ ok: true, json: async () => ({ data: [] }) });
const geminiOk = (b64 = 'Z2VtaW5p') => ({
    ok: true,
    json: async () => ({ candidates: [{ content: { parts: [{ inlineData: { data: b64, mimeType: 'image/png' } }] } }] }),
});
const geminiEmpty = () => ({ ok: true, json: async () => ({ candidates: [{ finishReason: 'IMAGE_SAFETY' }] }) });
const httpError = (status, body = 'nope') => ({ ok: false, status, text: async () => body });

const chain = (...replies) => {
    const fetchMock = vi.fn();
    for (const reply of replies) {
        if (reply instanceof Error) fetchMock.mockRejectedValueOnce(reply);
        else fetchMock.mockResolvedValueOnce(reply);
    }
    vi.stubGlobal('fetch', fetchMock);
    return fetchMock;
};

beforeEach(() => {
    clearImageCache();
    vi.restoreAllMocks();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
});

describe('the fallback reason: writer and reader agree', () => {
    it('xAI rendered — no notice', async () => {
        chain(xaiOk());
        const result = await generateSceneImageDetailed('a cavern', 'xai-key', { geminiApiKey: 'g' });
        expect(result.fallbackReason).toBeNull();
        expect(fallbackNotice(result)).toBe('');
    });

    it('no xAI key, Gemini rendered — "add an xAI key"', async () => {
        chain(geminiOk());
        const result = await generateSceneImageDetailed('a cavern', '', { geminiApiKey: 'g' });
        expect(result).toMatchObject({ provider: 'gemini', fallbackReason: 'missing-key' });
        expect(isMissingKeyFallback(result.fallbackReason)).toBe(true);
        expect(fallbackNotice(result)).toContain('Add an xAI Image API Key');
    });

    it('xAI filtered, Gemini rendered — "possibly filtered"', async () => {
        chain(xaiEmpty(), geminiOk());
        const result = await generateSceneImageDetailed('a cavern', 'xai-key', { geminiApiKey: 'g' });
        expect(result.provider).toBe('gemini');
        expect(isXaiFilteredFallback(result.fallbackReason)).toBe(true);
        expect(fallbackNotice(result)).toContain('possibly filtered');
    });

    it('xAI refused or unreachable, Gemini rendered — "xAI rendering failed"', async () => {
        for (const failure of [httpError(401, 'bad key'), new Error('connection reset')]) {
            clearImageCache();
            chain(failure, geminiOk());
            const result = await generateSceneImageDetailed('a cavern', 'xai-key', { geminiApiKey: 'g' });
            expect(result.provider).toBe('gemini');
            expect(isXaiFilteredFallback(result.fallbackReason)).toBe(false);
            expect(isMissingKeyFallback(result.fallbackReason)).toBe(false);
            expect(fallbackNotice(result)).toContain('xAI rendering failed');
        }
    });

    it('no key of any kind — the free render says which key to add', async () => {
        chain();
        const result = await generateSceneImageDetailed('a cavern', '');
        expect(result).toMatchObject({ provider: 'pollinations', fallbackReason: 'missing-key' });
        expect(fallbackNotice(result)).toContain('Free fallback render');
    });

    it('both real providers returned nothing — "possibly because the prompt was filtered"', async () => {
        chain(xaiEmpty(), geminiEmpty());
        const result = await generateSceneImageDetailed('a cavern', 'xai-key', { geminiApiKey: 'g' });
        expect(result.provider).toBe('pollinations');
        expect(result.fallbackReason).toBe('xai-empty; gemini-empty (IMAGE_SAFETY)');
        expect(isXaiFilteredFallback(result.fallbackReason)).toBe(true);
        expect(fallbackNotice(result)).toContain('prompt was filtered');
    });

    it('no xAI key and Gemini failed — a real-provider failure, not the "add a key" line', async () => {
        chain(httpError(500, 'overloaded'));
        const result = await generateSceneImageDetailed('a cavern', '', { geminiApiKey: 'g' });
        expect(result.provider).toBe('pollinations');
        expect(result.fallbackReason).toBe('missing-key; gemini-http-500: overloaded');
        expect(isMissingKeyFallback(result.fallbackReason)).toBe(false);
        expect(fallbackNotice(result)).toContain('rendering failed on the real providers');
    });

    it('both tiers word a refusal and a network failure the same way', async () => {
        chain(httpError(429, 'slow down'), new Error('socket hang up'));
        const result = await generateSceneImageDetailed('a cavern', 'xai-key', { geminiApiKey: 'g' });
        expect(result.fallbackReason).toBe('xai-http-429: slow down; gemini-network: socket hang up');
    });

    it('the predicates never match a reason that merely contains the words', () => {
        expect(isXaiFilteredFallback('xai-network: xai-empty handed')).toBe(false);
        expect(isXaiFilteredFallback(null)).toBe(false);
        expect(isMissingKeyFallback('missing-key; gemini-http-500')).toBe(false);
    });
});

describe('one portrait request', () => {
    const settings = { llmProvider: 'gemini', apiKey: 'machinery-key', imageApiKey: 'xai-key' };

    it('imageRequestOptions carries the machinery key and the campaign scope — the two a caller could forget', () => {
        expect(imageRequestOptions(settings, { sessionScope: 'campaign-1' }))
            .toEqual({ geminiApiKey: 'machinery-key', sessionScope: 'campaign-1', bypassCache: false });
        const controller = new AbortController();
        expect(imageRequestOptions(settings, { sessionScope: { x: 1 }, bypassCache: 1, signal: controller.signal }))
            .toEqual({ geminiApiKey: 'machinery-key', sessionScope: '', bypassCache: true, signal: controller.signal });
        expect(imageRequestOptions(null).geminiApiKey).toBe('');
    });

    it('a first request is cached per campaign; an existing picture makes the next one a reroll', async () => {
        const fetchMock = chain(xaiOk('Zmlyc3Q='), xaiOk('c2Vjb25k'), xaiOk('dGhpcmQ='));
        const first = await requestPortrait('Portrait of Astra', settings, { sessionScope: 'campaign-1' });
        const again = await requestPortrait('Portrait of Astra', settings, { sessionScope: 'campaign-1' });
        expect(again).toEqual(first);
        expect(fetchMock).toHaveBeenCalledTimes(1);
        const other = await requestPortrait('Portrait of Astra', settings, { sessionScope: 'campaign-2' });
        expect(fetchMock).toHaveBeenCalledTimes(2);
        expect(other.url).not.toBe(first.url);
        const reroll = await requestPortrait('Portrait of Astra', settings, { sessionScope: 'campaign-1', existingUrl: first.url });
        expect(fetchMock).toHaveBeenCalledTimes(3);
        expect(reroll.url).not.toBe(first.url);
    });

    it('falls to the machinery key when xAI fails, and passes a size through', async () => {
        const fetchMock = chain(httpError(500), geminiOk());
        const result = await requestPortrait('Portrait of Grub', settings, { sessionScope: 'c', size: NPC_PORTRAIT_SIZE });
        expect(result.provider).toBe('gemini');
        expect(String(fetchMock.mock.calls[1][0])).toContain('key=machinery-key');
    });

    it('throws ONE error string when nothing came back', async () => {
        await expect(requestPortrait('', settings, { sessionScope: 'c' })).rejects.toThrow('No portrait returned.');
    });
});
