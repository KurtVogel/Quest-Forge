/**
 * OpenAI API provider.
 * Thin instantiation of the shared OpenAI-compatible provider factory —
 * the request/stream/error behavior lives in openaiCompatible.js.
 */
import { makeOpenAICompatProvider } from './openaiCompatible.js';

const { send, stream } = makeOpenAICompatProvider({
    label: 'OpenAI',
    baseUrl: 'https://api.openai.com/v1/chat/completions',
});

/** Send a non-streaming message to OpenAI. */
export const sendOpenAIMessage = send;

/** Stream a message from OpenAI. */
export const streamOpenAIMessage = stream;
