/**
 * xAI API keys must carry the `xai-` prefix; players often paste the bare
 * token. Shared by the chat provider (xai.js) and scene-art renderer
 * (imageGen.js) so both repair pasted keys identically.
 */
export function normalizeXaiApiKey(apiKey) {
    const trimmed = apiKey?.trim();
    if (!trimmed) return '';
    return trimmed.startsWith('xai-') ? trimmed : `xai-${trimmed}`;
}
