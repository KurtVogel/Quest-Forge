/**
 * Provider-agnostic LLM adapter.
 * Routes requests to the appropriate provider implementation.
 */
import { sendGeminiMessage, streamGeminiMessage } from './providers/gemini.js';
import { sendOpenAIMessage, streamOpenAIMessage } from './providers/openai.js';

const providers = {
    gemini: { send: sendGeminiMessage, stream: streamGeminiMessage },
    openai: { send: sendOpenAIMessage, stream: streamOpenAIMessage },
};

/**
 * Send a message to the configured LLM provider.
 * @param {object} options
 * @param {string} options.provider - Provider name ('gemini' | 'openai')
 * @param {string} options.apiKey - API key
 * @param {string} options.model - Model identifier
 * @param {string} options.systemPrompt - System prompt
 * @param {Array} options.messageHistory - Previous messages [{role, content}]
 * @param {string} options.userMessage - New user message
 * @returns {Promise<string>} LLM response text
 */
export async function sendMessage({ provider, apiKey, model, systemPrompt, messageHistory, userMessage }) {
    const p = providers[provider];
    if (!p) throw new Error(`Unknown LLM provider: "${provider}"`);
    if (!apiKey) throw new Error('API key is required. Please set it in Settings.');

    return p.send({ apiKey, model, systemPrompt, messageHistory, userMessage });
}

/**
 * Stream a message from the configured LLM provider.
 * Calls onChunk with each text fragment as it arrives.
 * @param {object} options - Same as sendMessage
 * @param {function} options.onChunk - Callback receiving each text chunk
 * @param {AbortSignal} [options.signal] - Optional abort signal
 * @returns {Promise<string>} Complete response text
 */
export async function streamMessage({ provider, apiKey, model, systemPrompt, messageHistory, userMessage, onChunk, signal }) {
    const p = providers[provider];
    if (!p) throw new Error(`Unknown LLM provider: "${provider}"`);
    if (!apiKey) throw new Error('API key is required. Please set it in Settings.');

    const result = await p.stream({ apiKey, model, systemPrompt, messageHistory, userMessage, onChunk, signal });
    console.log('[LLM Adapter] Full response received, length:', result.length);
    console.log('[LLM Adapter] Contains ```json:', result.includes('```json'));
    console.log('[LLM Adapter] Contains requested_rolls:', result.includes('requested_rolls'));
    console.log('[LLM Adapter] Response tail (last 300 chars):', result.slice(-300));
    return result;
}

/**
 * Available providers and their models.
 */
export const PROVIDERS = {
    gemini: {
        name: 'Google Gemini',
        models: [
            { id: 'gemini-3.1-pro-preview', name: 'Gemini 3.1 Pro (Latest!)', description: 'Most capable model, released Feb 2026' },
            { id: 'gemini-3-flash-preview', name: 'Gemini 3 Flash', description: 'Fast frontier-class, great value' },
            { id: 'gemini-2.5-flash', name: 'Gemini 2.5 Flash', description: 'Fast, smart, very affordable' },
            { id: 'gemini-2.5-pro', name: 'Gemini 2.5 Pro', description: 'Previous gen pro model' },
        ],
    },
    openai: {
        name: 'OpenAI',
        models: [
            { id: 'gpt-4o-mini', name: 'GPT-4o Mini (Recommended)', description: 'Fast and affordable' },
            { id: 'gpt-4o', name: 'GPT-4o', description: 'Highest quality' },
        ],
    },
};

export const PROVIDER_LIST = Object.keys(PROVIDERS);
