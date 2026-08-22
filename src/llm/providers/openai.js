/**
 * OpenAI API provider.
 * Thin instantiation of the shared OpenAI-compatible provider factory —
 * the request/stream/error behavior lives in openaiCompatible.js.
 */
import { makeOpenAICompatProvider } from './openaiCompatible.js';

const { send, stream } = makeOpenAICompatProvider({
    label: 'OpenAI',
    baseUrl: 'https://api.openai.com/v1/chat/completions',
    // OpenAI's current field name; post-4o models reject legacy max_tokens.
    maxTokensParam: 'max_completion_tokens',
    // Reasoning models (gpt-5 family, o-series) 400 on any non-default temperature.
    temperatureUnsupported: (model) => /^(gpt-5|o\d)/.test(model || ''),
});

/** Send a non-streaming message to OpenAI. */
export const sendOpenAIMessage = send;

/** Stream a message from OpenAI. */
export const streamOpenAIMessage = stream;
