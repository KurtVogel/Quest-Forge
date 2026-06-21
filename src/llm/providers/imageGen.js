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

async function downscaleDataUrl(dataUrl, { maxWidth, maxHeight, quality = 0.82 } = {}) {
    if (!dataUrl?.startsWith('data:image/') || (!maxWidth && !maxHeight)) return dataUrl;

    try {
        const img = new Image();
        img.decoding = 'async';
        await new Promise((resolve, reject) => {
            img.onload = resolve;
            img.onerror = reject;
            img.src = dataUrl;
        });

        const scale = Math.min(
            1,
            maxWidth ? maxWidth / img.naturalWidth : 1,
            maxHeight ? maxHeight / img.naturalHeight : 1
        );
        if (scale >= 1) return dataUrl;

        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
        canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        return canvas.toDataURL('image/jpeg', quality);
    } catch (e) {
        console.warn('[ImageGen] Portrait downscale failed:', e);
        return dataUrl;
    }
}

/**
 * Render a finished image prompt to a displayable image URL.
 * @param {string} prompt - The fully-composed visual prompt
 * @param {string} imageApiKey - xAI (Grok) API key
 * @param {object} options - Generation options
 * @returns {Promise<{url:string,provider:'xai'|'pollinations',fallbackReason:string|null}|null>}
 */
async function generateImageResult(prompt, imageApiKey, options = {}) {
    if (!prompt) return null;

    const aspectRatio = options.aspectRatio || '16:9';
    const resolution = options.resolution || '1k';
    const fallbackWidth = options.fallbackWidth || 1280;
    const fallbackHeight = options.fallbackHeight || 720;
    const baseCacheKey = `${aspectRatio}|${resolution}|${prompt.toLowerCase().trim()}`;
    const preferredCacheKey = `${imageApiKey ? 'xai' : 'pollinations'}|${baseCacheKey}`;
    if (IMAGE_CACHE.has(preferredCacheKey)) {
        return IMAGE_CACHE.get(preferredCacheKey);
    }

    let fallbackReason = imageApiKey ? 'xai-error' : 'missing-key';
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
                    response_format: 'b64_json',
                }),
            });

            if (response.ok) {
                const data = await response.json();
                const b64 = data?.data?.[0]?.b64_json;
                if (b64) {
                    const dataUrl = `data:${mimeFromBase64(b64)};base64,${b64}`;
                    const finalUrl = await downscaleDataUrl(dataUrl, {
                        maxWidth: options.maxWidth,
                        maxHeight: options.maxHeight,
                        quality: options.quality,
                    });
                    const result = { url: finalUrl, provider: 'xai', fallbackReason: null };
                    cacheSet(`xai|${baseCacheKey}`, result);
                    return result;
                }
                // OK status but no image — most likely filtered by content moderation.
                fallbackReason = 'xai-empty';
                console.log('[ImageGen] xAI returned no image (possibly filtered by moderation).');
            } else {
                const errText = await response.text().catch(() => '');
                const errSummary = `[ImageGen] xAI failed — Status ${response.status}: ${errText.slice(0, 400)}`;
                console.warn(errSummary);
                fallbackReason = errSummary;
            }
        } catch (e) {
            console.log('[ImageGen] xAI image generation failed, falling back:', e.message);
        }
    }

    // Free fallback (no key required). Lower quality — used only when xAI is unavailable.
    try {
        const seed = Math.floor(Math.random() * 100000);
        const safePrompt = encodeURIComponent(prompt);
        const fallbackUrl = `https://image.pollinations.ai/prompt/${safePrompt}?width=${fallbackWidth}&height=${fallbackHeight}&nologo=true&seed=${seed}`;
        // Returned as an <img src> URL directly to avoid CORS issues on fetch.
        const result = { url: fallbackUrl, provider: 'pollinations', fallbackReason };
        cacheSet(`pollinations|${baseCacheKey}`, result);
        return result;
    } catch (e) {
        console.warn('[ImageGen] Fallback failed:', e);
    }

    return null;
}

/** Backward-compatible URL-only renderer used by existing call sites. */
export async function generateImage(prompt, imageApiKey, options = {}) {
    const result = await generateImageResult(prompt, imageApiKey, options);
    return result?.url || null;
}

export async function generateSceneImageDetailed(prompt, imageApiKey) {
    return generateImageResult(prompt, imageApiKey, {
        aspectRatio: '16:9',
        resolution: '1k',
        fallbackWidth: 1280,
        fallbackHeight: 720,
    });
}

export async function generatePortraitImageDetailed(prompt, imageApiKey) {
    return generateImageResult(prompt, imageApiKey, {
        aspectRatio: '3:4',
        resolution: '1k',
        fallbackWidth: 768,
        fallbackHeight: 1024,
        maxWidth: 480,
        maxHeight: 640,
        quality: 0.82,
    });
}

export async function generateSceneImage(prompt, imageApiKey) {
    const result = await generateSceneImageDetailed(prompt, imageApiKey);
    return result?.url || null;
}

export async function generatePortraitImage(prompt, imageApiKey) {
    const result = await generatePortraitImageDetailed(prompt, imageApiKey);
    return result?.url || null;
}

/**
 * Clear the image cache.
 */
export function clearImageCache() {
    IMAGE_CACHE.clear();
}
