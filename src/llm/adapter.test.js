/**
 * Tests for the provider-agnostic LLM adapter: routing, validation, and the
 * PROVIDERS/PROVIDER_LIST catalog consumed by Settings.
 */
import { afterEach, describe, expect, it, vi, beforeEach } from 'vitest';

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

const { sendMessage, streamMessage, PROVIDERS, PROVIDER_LIST } = await import('./adapter.js');

beforeEach(() => {
    sendGeminiMessage.mockReset();
    streamGeminiMessage.mockReset();
    sendOpenAIMessage.mockReset();
    streamOpenAIMessage.mockReset();
    sendXaiMessage.mockReset();
    streamXaiMessage.mockReset();
});

const baseOptions = {
    apiKey: 'test-key',
    model: 'gemini-3.1-pro-preview',
    systemPrompt: 'You are a DM.',
    messageHistory: [],
    userMessage: 'I open the door.',
};

describe('sendMessage', () => {
    it('routes to the gemini provider', async () => {
        sendGeminiMessage.mockResolvedValue('narration');
        const result = await sendMessage({ ...baseOptions, provider: 'gemini' });
        expect(result).toBe('narration');
        expect(sendGeminiMessage).toHaveBeenCalledWith(expect.objectContaining({ apiKey: 'test-key', model: 'gemini-3.1-pro-preview' }));
        expect(sendOpenAIMessage).not.toHaveBeenCalled();
    });

    it('routes to the openai provider', async () => {
        sendOpenAIMessage.mockResolvedValue('narration');
        const result = await sendMessage({ ...baseOptions, provider: 'openai', model: 'gpt-4o-mini' });
        expect(result).toBe('narration');
        expect(sendOpenAIMessage).toHaveBeenCalledWith(expect.objectContaining({ model: 'gpt-4o-mini' }));
        expect(sendGeminiMessage).not.toHaveBeenCalled();
    });

    it('routes to the xai provider', async () => {
        sendXaiMessage.mockResolvedValue('narration');
        const result = await sendMessage({ ...baseOptions, provider: 'xai', model: 'grok-4.3' });
        expect(result).toBe('narration');
        expect(sendXaiMessage).toHaveBeenCalledWith(expect.objectContaining({ model: 'grok-4.3' }));
        expect(sendGeminiMessage).not.toHaveBeenCalled();
    });

    it('throws for an unknown provider', async () => {
        await expect(sendMessage({ ...baseOptions, provider: 'anthropic' })).rejects.toThrow('Unknown LLM provider: "anthropic"');
    });

    it('throws when the API key is missing', async () => {
        await expect(sendMessage({ ...baseOptions, provider: 'gemini', apiKey: '' })).rejects.toThrow('API key is required');
        expect(sendGeminiMessage).not.toHaveBeenCalled();
    });
});

describe('streamMessage', () => {
    it('routes to the gemini provider and forwards onChunk/signal', async () => {
        streamGeminiMessage.mockResolvedValue('full response');
        const onChunk = vi.fn();
        const signal = new AbortController().signal;
        const result = await streamMessage({ ...baseOptions, provider: 'gemini', onChunk, signal });
        expect(result).toBe('full response');
        expect(streamGeminiMessage).toHaveBeenCalledWith(expect.objectContaining({ onChunk, signal }));
    });

    it('routes to the openai provider', async () => {
        streamOpenAIMessage.mockResolvedValue('full response');
        const result = await streamMessage({ ...baseOptions, provider: 'openai' });
        expect(result).toBe('full response');
        expect(streamOpenAIMessage).toHaveBeenCalled();
    });

    it('routes to the xai provider', async () => {
        streamXaiMessage.mockResolvedValue('full response');
        const result = await streamMessage({ ...baseOptions, provider: 'xai', model: 'grok-4.3' });
        expect(result).toBe('full response');
        expect(streamXaiMessage).toHaveBeenCalled();
    });

    it('throws for an unknown provider', async () => {
        await expect(streamMessage({ ...baseOptions, provider: 'anthropic' })).rejects.toThrow('Unknown LLM provider: "anthropic"');
    });

    it('throws when the API key is missing', async () => {
        await expect(streamMessage({ ...baseOptions, provider: 'openai', apiKey: undefined })).rejects.toThrow('API key is required');
        expect(streamOpenAIMessage).not.toHaveBeenCalled();
    });
});

describe('sendMessage retry/backoff', () => {
    afterEach(() => {
        vi.useRealTimers();
    });

    it('retries a transient failure and succeeds', async () => {
        vi.useFakeTimers();
        const transient = Object.assign(new Error('Gemini API error (503): overloaded'), { status: 503 });
        sendGeminiMessage.mockRejectedValueOnce(transient).mockResolvedValueOnce('recovered');
        const promise = sendMessage({ ...baseOptions, provider: 'gemini' });
        await vi.advanceTimersByTimeAsync(2000);
        await expect(promise).resolves.toBe('recovered');
        expect(sendGeminiMessage).toHaveBeenCalledTimes(2);
    });

    it('does not retry a non-transient error', async () => {
        const fatal = Object.assign(new Error('Gemini API error (400): bad request'), { status: 400 });
        sendGeminiMessage.mockRejectedValue(fatal);
        await expect(sendMessage({ ...baseOptions, provider: 'gemini' })).rejects.toThrow('(400)');
        expect(sendGeminiMessage).toHaveBeenCalledTimes(1);
    });

    it('gives up after two retries and surfaces the error', async () => {
        vi.useFakeTimers();
        const transient = Object.assign(new Error('rate limited'), { status: 429 });
        sendGeminiMessage.mockRejectedValue(transient);
        const promise = sendMessage({ ...baseOptions, provider: 'gemini' });
        const outcome = expect(promise).rejects.toThrow('rate limited');
        await vi.advanceTimersByTimeAsync(10000);
        await outcome;
        expect(sendGeminiMessage).toHaveBeenCalledTimes(3);
    });

    it('forwards temperature to the provider', async () => {
        sendGeminiMessage.mockResolvedValue('ok');
        await sendMessage({ ...baseOptions, provider: 'gemini', temperature: 0.2 });
        expect(sendGeminiMessage).toHaveBeenCalledWith(expect.objectContaining({ temperature: 0.2 }));
    });
});

describe('PROVIDERS / PROVIDER_LIST', () => {
    it('lists gemini, openai, and xai with at least one model each', () => {
        expect(PROVIDER_LIST).toEqual(['gemini', 'openai', 'xai']);
        expect(PROVIDERS.gemini.models.length).toBeGreaterThan(0);
        expect(PROVIDERS.openai.models.length).toBeGreaterThan(0);
        expect(PROVIDERS.xai.models.length).toBeGreaterThan(0);
    });

    it('gives every model an id and a name', () => {
        for (const provider of PROVIDER_LIST) {
            for (const model of PROVIDERS[provider].models) {
                expect(model.id).toBeTruthy();
                expect(model.name).toBeTruthy();
            }
        }
    });
});
