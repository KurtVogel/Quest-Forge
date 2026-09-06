/**
 * OpenAI API provider.
 * Thin instantiation of the shared OpenAI-compatible provider factory —
 * the request/stream/error behavior lives in openaiCompatible.js.
 */
import { DEFAULT_MAX_TOKENS, makeOpenAICompatProvider } from './openaiCompatible.js';

/** Reasoning models: gpt-5 family and the o-series. */
const isReasoningModel = (model) => /^(gpt-5|o\d)/.test(model || '');

/**
 * Reasoning tokens count against `max_completion_tokens`, so the gpt-4o
 * ceiling (16,384) left a heavy-reasoning long turn hitting `length` and the
 * truncation error retrying at the same cap (2026-09-06 audit). 32,768
 * matches the Gemini thinking-model cap; still a glitch-loop guard, not a
 * budget.
 */
export const REASONING_MAX_TOKENS = 32768;

const { send, stream } = makeOpenAICompatProvider({
    label: 'OpenAI',
    baseUrl: 'https://api.openai.com/v1/chat/completions',
    // OpenAI's current field name; post-4o models reject legacy max_tokens.
    maxTokensParam: 'max_completion_tokens',
    // Reasoning models (gpt-5 family, o-series) 400 on any non-default temperature.
    temperatureUnsupported: isReasoningModel,
    maxOutputTokensFor: (model) => (isReasoningModel(model) ? REASONING_MAX_TOKENS : DEFAULT_MAX_TOKENS),
});

/** Send a non-streaming message to OpenAI. */
export const sendOpenAIMessage = send;

/** Stream a message from OpenAI. */
export const streamOpenAIMessage = stream;
