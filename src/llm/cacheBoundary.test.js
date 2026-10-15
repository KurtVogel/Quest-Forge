/**
 * The prefix boundary told to the provider (memory-research M1 / C4,
 * 2026-10-14): the OpenAI-compatible lanes send the byte-stable prefix and
 * the dynamic half as TWO leading system messages, OpenAI gpt-5.6+ gets an
 * explicit cache breakpoint on the prefix with a one-time fallback on a 400
 * naming the field, Gemini sends the one string, and `writtenTokens` rides
 * the usage row. The bytes and their order are untouched.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { formatMessages, normalizeOpenAIUsage } from './providers/openaiCompatible.js';
import { isExplicitCacheModel, sendOpenAIMessage, streamOpenAIMessage } from './providers/openai.js';
import { sendXaiMessage } from './providers/xai.js';
import { sendGeminiMessage } from './providers/gemini.js';
import { buildSystemPrompt, buildSystemPromptSplit, PREFIX_END_PART } from './promptBuilder.js';
import { createCharacter } from '../engine/characterUtils.js';
import { captureUsage, getInspectorSnapshot, resetInspector } from '../debug/memoryInspectorStore.js';

function jsonResponse(payload, { ok = true, status = 200, statusText = 'OK' } = {}) {
    return { ok, status, statusText, json: async () => payload, text: async () => JSON.stringify(payload) };
}

function streamResponse(chunks) {
    const encoder = new TextEncoder();
    const encoded = chunks.map((chunk) => encoder.encode(chunk));
    let index = 0;
    return { ok: true, body: { getReader: () => ({ read: async () => (index < encoded.length ? { done: false, value: encoded[index++] } : { done: true, value: undefined }) }) } };
}
const sse = (payload) => `data: ${JSON.stringify(payload)}\n\n`;
const bodyOf = (fetchMock, call = 0) => JSON.parse(fetchMock.mock.calls[call][1].body);

const PARTS = { prefix: 'PREFIX: the rules and the hero sheet.', dynamic: 'DYNAMIC: HP 12/12, the scene.' };
const ARGS = { apiKey: 'sk-test', systemPrompt: `${PARTS.prefix}\n\n${PARTS.dynamic}`, systemPromptParts: PARTS, messageHistory: [{ role: 'assistant', content: 'The door creaks.' }], userMessage: 'I open the door.' };
const reply = (content = 'Hello.') => jsonResponse({ choices: [{ message: { content }, finish_reason: 'stop' }], usage: { prompt_tokens: 100, prompt_tokens_details: { cached_tokens: 60, cache_write_tokens: 30 }, completion_tokens: 5 } });

describe('the builder\'s split', () => {
    it('prefix + dynamic join to the exact string buildSystemPrompt returns, split after the hero sheet', () => {
        const options = {
            character: createCharacter('Testa', 'human', 'fighter', { strength: 15, dexterity: 13, constitution: 14, intelligence: 10, wisdom: 12, charisma: 8 }, ['athletics']),
            inventory: [], quests: [], rollHistory: [], preset: 'classicFantasy', ruleset: 'simplified5e', journal: [], npcs: [], party: [],
            currentLocation: 'Aldermill', combat: { active: false }, worldFacts: [], fronts: [], storyMemory: [], retrievedMemories: [], messages: [], messageCount: 0,
        };
        const split = buildSystemPromptSplit(options);
        expect(split.text).toBe(buildSystemPrompt(options));
        expect(`${split.prefix}\n\n${split.dynamic}`).toBe(split.text);
        expect(split.prefix).toContain('## HERO SHEET');
        expect(split.dynamic).not.toContain('## HERO SHEET');
        expect(split.dynamic).toContain('PLAYER CHARACTER');
        expect(PREFIX_END_PART).toBe('heroSheet');
    });
});

describe('formatMessages', () => {
    it('two leading system messages with a split; one without; the breakpoint only when asked', () => {
        const plain = formatMessages('SYS', [], 'hi');
        expect(plain[0]).toEqual({ role: 'system', content: 'SYS' });
        const two = formatMessages('SYS', [], 'hi', { systemPromptParts: PARTS });
        expect(two.slice(0, 2)).toEqual([{ role: 'system', content: PARTS.prefix }, { role: 'system', content: PARTS.dynamic }]);
        expect(two.at(-1)).toEqual({ role: 'user', content: 'hi' });
        const explicit = formatMessages('SYS', [], 'hi', { systemPromptParts: PARTS, explicitCache: true });
        expect(explicit[0]).toEqual({ role: 'system', content: [{ type: 'text', text: PARTS.prefix, prompt_cache_breakpoint: { mode: 'explicit' } }] });
        expect(explicit[1]).toEqual({ role: 'system', content: PARTS.dynamic });
        // An unusable split (an empty half) falls back to the one message.
        expect(formatMessages('SYS', [], 'hi', { systemPromptParts: { prefix: 'P', dynamic: '' } })[0]).toEqual({ role: 'system', content: 'SYS' });
    });

    it('isExplicitCacheModel: gpt-5.6 and later, never gpt-4o / gpt-5.5 / o-series', () => {
        for (const model of ['gpt-5.6', 'gpt-5.6-mini', 'gpt-5.10-sol', 'gpt-6.1-sol', 'gpt-7']) expect(isExplicitCacheModel(model), model).toBe(true);
        for (const model of ['gpt-4o', 'gpt-5', 'gpt-5.5-astra', 'o3', 'gemini-3.8-flash', '']) expect(isExplicitCacheModel(model), model).toBe(false);
    });
});

describe('providers on the wire', () => {
    afterEach(() => {
        vi.restoreAllMocks();
        vi.unstubAllGlobals();
        resetInspector();
    });

    it('OpenAI gpt-6.1-sol: two system messages, the breakpoint on the prefix, prompt_cache_options explicit, writtenTokens reported', async () => {
        const fetchMock = vi.fn().mockResolvedValue(reply());
        vi.stubGlobal('fetch', fetchMock);
        const onUsage = vi.fn();
        await sendOpenAIMessage({ ...ARGS, model: 'gpt-6.1-sol', onUsage });
        const body = bodyOf(fetchMock);
        expect(body.prompt_cache_options).toEqual({ mode: 'explicit' });
        expect(body.messages[0].content[0].prompt_cache_breakpoint).toEqual({ mode: 'explicit' });
        expect(body.messages[1]).toEqual({ role: 'system', content: PARTS.dynamic });
        expect(onUsage).toHaveBeenCalledWith({ promptTokens: 100, cachedTokens: 60, writtenTokens: 30, outputTokens: 5 });
    });

    it('OpenAI gpt-4o: two system messages, no breakpoint, no prompt_cache_options', async () => {
        const fetchMock = vi.fn().mockResolvedValue(reply());
        vi.stubGlobal('fetch', fetchMock);
        await sendOpenAIMessage({ ...ARGS, model: 'gpt-4o' });
        const body = bodyOf(fetchMock);
        expect(body.prompt_cache_options).toBeUndefined();
        expect(body.messages[0]).toEqual({ role: 'system', content: PARTS.prefix });
        expect(body.messages[1]).toEqual({ role: 'system', content: PARTS.dynamic });
    });

    it('OpenAI stream: the same two messages and fields, usage from the final chunk', async () => {
        const fetchMock = vi.fn().mockResolvedValue(streamResponse([
            sse({ choices: [{ delta: { content: 'The door ' } }] }),
            sse({ choices: [{ delta: { content: 'creaks.' }, finish_reason: 'stop' }] }),
            sse({ choices: [], usage: { prompt_tokens: 100, prompt_tokens_details: { cached_tokens: 90, cache_write_tokens: 0 }, completion_tokens: 4 } }),
            'data: [DONE]\n\n',
        ]));
        vi.stubGlobal('fetch', fetchMock);
        const onUsage = vi.fn();
        const text = await streamOpenAIMessage({ ...ARGS, model: 'gpt-6.1-sol', onChunk: () => {}, onUsage });
        expect(text).toBe('The door creaks.');
        const body = bodyOf(fetchMock);
        expect(body.stream).toBe(true);
        expect(body.prompt_cache_options).toEqual({ mode: 'explicit' });
        expect(body.messages[0].content[0].prompt_cache_breakpoint).toEqual({ mode: 'explicit' });
        expect(onUsage).toHaveBeenCalledWith({ promptTokens: 100, cachedTokens: 90, writtenTokens: 0, outputTokens: 4 });
    });

    it('xAI: two plain system messages, never the explicit fields', async () => {
        const fetchMock = vi.fn().mockResolvedValue(reply());
        vi.stubGlobal('fetch', fetchMock);
        await sendXaiMessage({ ...ARGS, apiKey: 'xai-test', model: 'grok-4.3' });
        const body = bodyOf(fetchMock);
        expect(body.messages[0]).toEqual({ role: 'system', content: PARTS.prefix });
        expect(body.messages[1]).toEqual({ role: 'system', content: PARTS.dynamic });
        expect(body.prompt_cache_options).toBeUndefined();
    });

    it('Gemini: the one system_instruction string, byte-identical to prefix + dynamic', async () => {
        const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ candidates: [{ content: { parts: [{ text: 'Hello.' }] }, finishReason: 'STOP' }], usageMetadata: { promptTokenCount: 10 } }));
        vi.stubGlobal('fetch', fetchMock);
        await sendGeminiMessage({ ...ARGS, apiKey: 'AIza-test', model: 'gemini-3.8-flash' });
        const body = bodyOf(fetchMock);
        const instruction = body.systemInstruction || body.system_instruction;
        expect(instruction.parts[0].text).toBe(`${PARTS.prefix}\n\n${PARTS.dynamic}`);
    });

    it('captureUsage keeps writtenTokens and writtenShare beside cachedShare', () => {
        captureUsage({ lane: 'dm', mode: 'standard', provider: 'openai', model: 'gpt-6.1-sol', promptTokens: 200, cachedTokens: 150, writtenTokens: 50, outputTokens: 10 });
        const row = getInspectorSnapshot().lastUsage;
        expect(row).toMatchObject({ cachedShare: 0.75, writtenTokens: 50, writtenShare: 0.25 });
        captureUsage({ lane: 'dm', provider: 'gemini', promptTokens: 200, cachedTokens: 150 });
        expect(getInspectorSnapshot().lastUsage).toMatchObject({ writtenTokens: null, writtenShare: null });
    });

    it('a 400 naming prompt_cache_breakpoint drops both fields ONCE for the session and tells the caller; a 400 about anything else throws', async () => {
        const rejected = jsonResponse({ error: { message: "Unknown parameter: 'messages[0].content[0].prompt_cache_breakpoint'." } }, { ok: false, status: 400, statusText: 'Bad Request' });
        const fetchMock = vi.fn().mockResolvedValueOnce(rejected).mockResolvedValue(reply('After the fallback.'));
        vi.stubGlobal('fetch', fetchMock);
        const onCacheBreakpointRejected = vi.fn();
        const text = await sendOpenAIMessage({ ...ARGS, model: 'gpt-6.1-sol', onCacheBreakpointRejected });
        expect(text).toBe('After the fallback.');
        expect(onCacheBreakpointRejected).toHaveBeenCalledTimes(1);
        expect(fetchMock).toHaveBeenCalledTimes(2);
        const retry = bodyOf(fetchMock, 1);
        expect(retry.prompt_cache_options).toBeUndefined();
        expect(retry.messages[0]).toEqual({ role: 'system', content: PARTS.prefix });
        // The session remembers: the next call never sends the fields.
        await sendOpenAIMessage({ ...ARGS, model: 'gpt-6.1-sol' });
        expect(bodyOf(fetchMock, 2).prompt_cache_options).toBeUndefined();
        expect(fetchMock).toHaveBeenCalledTimes(3);
        // Any other 400 is the error it always was.
        const other = jsonResponse({ error: { message: 'Invalid model.' } }, { ok: false, status: 400, statusText: 'Bad Request' });
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(other));
        await expect(sendOpenAIMessage({ ...ARGS, model: 'gpt-4o' })).rejects.toThrow(/Invalid model/);
    });

    it('normalizeOpenAIUsage without the write field reads 0 (xAI, older OpenAI)', () => {
        expect(normalizeOpenAIUsage({ prompt_tokens: 10, prompt_tokens_details: { cached_tokens: 4 }, completion_tokens: 1 })).toEqual({ promptTokens: 10, cachedTokens: 4, writtenTokens: 0, outputTokens: 1 });
    });
});
