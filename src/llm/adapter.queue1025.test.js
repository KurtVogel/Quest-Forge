/**
 * Strengthening queue 2026-10-25 (providers-adapter, Lap 1) — the adapter's
 * three rows:
 * - the idle timer listens at the TRANSPORT: the provider's `onActivity`
 *   (every read that returns bytes) arms it, so a reasoning model's text-less
 *   keep-alives across the idle budget no longer read as a stall; a stream
 *   with no bytes at all still stalls with the existing message;
 * - `sendMessage` forwards the lane's `retryAfterCapMs` to `retryDelay`
 *   (the background lane waits up to 30 s, the default stays 10 s);
 * - `streamMessage` takes and forwards `maxOutputTokens` (the providers
 *   honored it; the adapter dropped it).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { sendGeminiMessage, streamGeminiMessage, sendOpenAIMessage, streamOpenAIMessage, sendXaiMessage, streamXaiMessage } = vi.hoisted(() => ({
    sendGeminiMessage: vi.fn(),
    streamGeminiMessage: vi.fn(),
    sendOpenAIMessage: vi.fn(),
    streamOpenAIMessage: vi.fn(),
    sendXaiMessage: vi.fn(),
    streamXaiMessage: vi.fn(),
}));

vi.mock('./providers/gemini.js', () => ({ sendGeminiMessage, streamGeminiMessage }));
vi.mock('./providers/openai.js', () => ({ sendOpenAIMessage, streamOpenAIMessage }));
vi.mock('./providers/xai.js', () => ({ sendXaiMessage, streamXaiMessage }));

const { sendMessage, streamMessage } = await import('./adapter.js');
const { BACKGROUND_RETRY_AFTER_CAP_MS, RETRY_AFTER_CAP_MS } = await import('./providers/sse.js');

beforeEach(() => {
    sendGeminiMessage.mockReset();
    streamGeminiMessage.mockReset();
    sendOpenAIMessage.mockReset();
    streamOpenAIMessage.mockReset();
    sendXaiMessage.mockReset();
    streamXaiMessage.mockReset();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
});

const baseOptions = {
    apiKey: 'test-key',
    model: 'gemini-3.8-flash',
    systemPrompt: 'You are a DM.',
    messageHistory: [],
    userMessage: 'I open the door.',
};

const abortOn = (signal, reject) => signal.addEventListener('abort', () => reject(new DOMException('The operation was aborted.', 'AbortError')), { once: true });

describe('the idle timer listens at the transport', () => {
    it('text-less events across the idle timeout (a think longer than the budget) do NOT stall when onActivity fires per read', async () => {
        vi.useFakeTimers();
        streamGeminiMessage.mockImplementation(({ onActivity, onChunk, signal }) => new Promise((resolve, reject) => {
            // Bytes every 3 s for 12 s (usageMetadata / thought events), no text until 13 s.
            for (const at of [3000, 6000, 9000, 12000]) setTimeout(() => onActivity(), at);
            setTimeout(() => onChunk('The door opens.'), 13000);
            setTimeout(() => resolve('The door opens.'), 13500);
            abortOn(signal, reject);
        }));
        const onChunk = vi.fn();
        const promise = streamMessage({ ...baseOptions, provider: 'gemini', onChunk, idleTimeoutMs: 5000 });
        await vi.advanceTimersByTimeAsync(13500);
        await expect(promise).resolves.toBe('The door opens.');
        expect(onChunk).toHaveBeenCalledWith('The door opens.');
    });

    it('the same stream WITHOUT onActivity (the pre-fix shape) is cut as a stall — the row the fix exists for', async () => {
        vi.useFakeTimers();
        streamGeminiMessage.mockImplementation(({ onChunk, signal }) => new Promise((resolve, reject) => {
            setTimeout(() => onChunk('late'), 13000);
            setTimeout(() => resolve('late'), 13500);
            abortOn(signal, reject);
        }));
        const promise = streamMessage({ ...baseOptions, provider: 'gemini', onChunk: vi.fn(), idleTimeoutMs: 5000 });
        const outcome = expect(promise).rejects.toThrow('gemini stream stalled — no data for 5s');
        await vi.advanceTimersByTimeAsync(5000);
        await outcome;
    });

    it('a stream with no bytes at all still stalls with the existing message', async () => {
        vi.useFakeTimers();
        streamGeminiMessage.mockImplementation(({ signal }) => new Promise((resolve, reject) => abortOn(signal, reject)));
        const promise = streamMessage({ ...baseOptions, provider: 'gemini', onChunk: vi.fn(), idleTimeoutMs: 5000 });
        const outcome = expect(promise).rejects.toThrow('gemini stream stalled — no data for 5s. Please retry.');
        await vi.advanceTimersByTimeAsync(5000);
        await outcome;
    });

    it('a lull AFTER the last activity still stalls — activity arms, it does not disarm', async () => {
        vi.useFakeTimers();
        streamGeminiMessage.mockImplementation(({ onActivity, signal }) => new Promise((resolve, reject) => {
            setTimeout(() => onActivity(), 4000);
            abortOn(signal, reject);
        }));
        const promise = streamMessage({ ...baseOptions, provider: 'gemini', onChunk: vi.fn(), idleTimeoutMs: 5000 });
        let settled = false;
        promise.catch(() => { settled = true; });
        await vi.advanceTimersByTimeAsync(8000); // 4 s + 4 s: inside the re-armed window
        expect(settled).toBe(false);
        const outcome = expect(promise).rejects.toThrow(/stalled/);
        await vi.advanceTimersByTimeAsync(1000); // 9 s: the window armed at 4 s closes
        await outcome;
    });

    it('streamMessage hands every provider an onActivity function beside onChunk', async () => {
        for (const [provider, mock, model] of [['gemini', streamGeminiMessage, 'gemini-3.8-flash'], ['openai', streamOpenAIMessage, 'gpt-6.1-sol'], ['xai', streamXaiMessage, 'grok-4.3']]) {
            mock.mockResolvedValue('Ok.');
            await streamMessage({ ...baseOptions, provider, model, onChunk: vi.fn() });
            expect(mock).toHaveBeenCalledWith(expect.objectContaining({ onActivity: expect.any(Function), onChunk: expect.any(Function) }));
        }
    });
});

describe('sendMessage forwards the lane\'s retryAfterCapMs', () => {
    it('with the background cap a 25 s body delay is waited out (the default 10 s cap would have retried at 10)', async () => {
        vi.useFakeTimers();
        const quota = Object.assign(new Error('Gemini API error (429): quota'), { status: 429, retryAfterMs: 25_000 });
        sendGeminiMessage.mockRejectedValueOnce(quota).mockResolvedValueOnce('recovered');
        const promise = sendMessage({ ...baseOptions, provider: 'gemini', retryAfterCapMs: BACKGROUND_RETRY_AFTER_CAP_MS });
        await vi.advanceTimersByTimeAsync(RETRY_AFTER_CAP_MS + 1_500);
        expect(sendGeminiMessage).toHaveBeenCalledTimes(1);
        await vi.advanceTimersByTimeAsync(14_000);
        await expect(promise).resolves.toBe('recovered');
        expect(sendGeminiMessage).toHaveBeenCalledTimes(2);
    });

    it('without the option the default 10 s cap governs (the DM stream and the pre-commit lane)', async () => {
        vi.useFakeTimers();
        const quota = Object.assign(new Error('Gemini API error (429): quota'), { status: 429, retryAfterMs: 25_000 });
        sendGeminiMessage.mockRejectedValueOnce(quota).mockResolvedValueOnce('recovered');
        const promise = sendMessage({ ...baseOptions, provider: 'gemini' });
        await vi.advanceTimersByTimeAsync(RETRY_AFTER_CAP_MS + 500);
        await expect(promise).resolves.toBe('recovered');
        expect(sendGeminiMessage).toHaveBeenCalledTimes(2);
    });

    it('the background cap is itself bounded: a 45 s delay waits 30 s, never 45', async () => {
        vi.useFakeTimers();
        const quota = Object.assign(new Error('Gemini API error (429): quota'), { status: 429, retryAfterMs: 45_000 });
        sendGeminiMessage.mockRejectedValueOnce(quota).mockResolvedValueOnce('recovered');
        const promise = sendMessage({ ...baseOptions, provider: 'gemini', retryAfterCapMs: BACKGROUND_RETRY_AFTER_CAP_MS });
        await vi.advanceTimersByTimeAsync(BACKGROUND_RETRY_AFTER_CAP_MS - 500);
        expect(sendGeminiMessage).toHaveBeenCalledTimes(1);
        await vi.advanceTimersByTimeAsync(1_000);
        await expect(promise).resolves.toBe('recovered');
    });
});

describe('streamMessage takes and forwards maxOutputTokens (2026-10-25 nit)', () => {
    it('a passed cap reaches the provider; none passed, the provider sees undefined and keeps its per-model cap', async () => {
        streamGeminiMessage.mockResolvedValue('Ok.');
        await streamMessage({ ...baseOptions, provider: 'gemini', onChunk: vi.fn(), maxOutputTokens: 4096 });
        expect(streamGeminiMessage).toHaveBeenCalledWith(expect.objectContaining({ maxOutputTokens: 4096 }));
        streamOpenAIMessage.mockResolvedValue('Ok.');
        await streamMessage({ ...baseOptions, provider: 'openai', model: 'gpt-6.1-sol', onChunk: vi.fn() });
        expect(streamOpenAIMessage.mock.calls[0][0].maxOutputTokens).toBeUndefined();
    });
});
