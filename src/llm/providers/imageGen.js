/**
 * Scene-art image generation via xAI (Grok Imagine).
 *
 * The prompt is composed upstream by the Scribe (see scribe.js `composeScenePrompt`),
 * which assembles the current situation plus the known visual details of the
 * characters/things in frame. This module just renders that finished prompt and
 * caches the result. If no xAI key is set or the request fails, it falls back to a
 * free, no-auth provider (lower quality) so scene art still appears.
 */

const IMAGE_CACHE = new Map();
const IMAGE_CACHE_MAX = 10;

const XAI_IMAGE_ENDPOINT = 'https://api.x.ai/v1/images/generations';
// Recommended model as of 2026 (grok-imagine-image-pro is deprecated May 2026).
const XAI_IMAGE_MODEL = 'grok-imagine-image-quality';

/**
 * Insert or update a cache entry with LRU eviction (max IMAGE_CACHE_MAX entries).
 */
function cacheSet(key, value) {
    if (IMAGE_CACHE.has(key)) {
        IMAGE_CACHE.delete(key);
    } else if (IMAGE_CACHE.size >= IMAGE_CACHE_MAX) {
        IMAGE_CACHE.delete(IMAGE_CACHE.keys().next().value);
    }
    IMAGE_CACHE.set(key, value);
}

/** Guess the image MIME from the leading bytes of a base64 payload. */
function mimeFromBase64(b64) {
    if (b64.startsWith('iVBOR')) return 'image/png';
    if (b64.startsWith('R0lGOD')) return 'image/gif';
    if (b64.startsWith('UklGR')) return 'image/webp';
    return 'image/jpeg'; // xAI returns JPEG by default
}

/**
 * Render a finished image prompt to a displayable image URL.
 * @param {string} prompt - The fully-composed visual prompt
 * @param {string} imageApiKey - xAI (Grok) API key
 * @returns {Promise<string|null>} Data URL (xAI) or image URL (fallback), or null
 */
export async function generateSceneImage(prompt, imageApiKey) {
    if (!prompt) return null;

    const cacheKey = prompt.toLowerCase().trim();
    if (IMAGE_CACHE.has(cacheKey)) {
        return IMAGE_CACHE.get(cacheKey);
    }

    if (imageApiKey) {
        try {
            const response = await fetch(XAI_IMAGE_ENDPOINT, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${imageApiKey}`,
                },
                body: JSON.stringify({
                    model: XAI_IMAGE_MODEL,
                    prompt,
                    n: 1,
                    aspect_ratio: '16:9',
                    resolution: '1k',
                    response_format: 'b64_json',
                }),
            });

            if (response.ok) {
                const data = await response.json();
                const b64 = data?.data?.[0]?.b64_json;
                if (b64) {
                    const dataUrl = `data:${mimeFromBase64(b64)};base64,${b64}`;
                    cacheSet(cacheKey, dataUrl);
                    return dataUrl;
                }
                // OK status but no image — most likely filtered by content moderation.
                console.log('[ImageGen] xAI returned no image (possibly filtered by moderation).');
            } else {
                const errText = await response.text().catch(() => '');
                console.log(`[ImageGen] xAI image request failed (Status ${response.status}). ${errText.slice(0, 200)}`);
            }
        } catch (e) {
            console.log('[ImageGen] xAI image generation failed, falling back:', e.message);
        }
    }

    // Free fallback (no key required). Lower quality — used only when xAI is unavailable.
    try {
        const seed = Math.floor(Math.random() * 100000);
        const safePrompt = encodeURIComponent(prompt);
        const fallbackUrl = `https://image.pollinations.ai/prompt/${safePrompt}?width=1280&height=720&nologo=true&seed=${seed}`;
        // Returned as an <img src> URL directly to avoid CORS issues on fetch.
        cacheSet(cacheKey, fallbackUrl);
        return fallbackUrl;
    } catch (e) {
        console.warn('[ImageGen] Fallback failed:', e);
    }

    return null;
}

/**
 * Clear the image cache.
 */
export function clearImageCache() {
    IMAGE_CACHE.clear();
}
