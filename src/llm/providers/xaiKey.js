/**
 * xAI API keys must carry the `xai-` prefix; players often paste the bare
 * token. Shared by the chat provider (xai.js) and scene-art renderer
 * (imageGen.js) so both repair pasted keys identically.
 */
export function normalizeXaiApiKey(apiKey) {
    // Type-strict (2026-09-16 audit P2): a non-string key from a corrupted
    // settings row threw at the first xAI / scene-art call.
    const trimmed = typeof apiKey === 'string' ? apiKey.trim() : '';
    if (!trimmed) return '';
    return trimmed.startsWith('xai-') ? trimmed : `xai-${trimmed}`;
}
