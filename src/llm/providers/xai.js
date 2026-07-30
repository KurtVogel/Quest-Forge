/**
 * xAI (Grok) API provider for DM narration.
 * The chat endpoint is OpenAI-compatible (same request/response shape, same
 * SSE stream format, same finish_reason semantics), so this is a thin
 * instantiation of the shared factory against api.x.ai. Only narration runs
 * here — the memory machinery (RAG, Scribe & co.) stays on Gemini regardless
 * of the DM provider.
 */
import { makeOpenAICompatProvider } from './openaiCompatible.js';
import { normalizeXaiApiKey } from './xaiKey.js';

const { send, stream } = makeOpenAICompatProvider({
    label: 'xAI',
    baseUrl: 'https://api.x.ai/v1/chat/completions',
    mapApiKey: normalizeXaiApiKey,
});

/** Send a non-streaming message to xAI. */
export const sendXaiMessage = send;

/** Stream a message from xAI. */
export const streamXaiMessage = stream;
