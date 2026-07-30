/**
 * Scene-art image generation: xAI (Grok Imagine) first, Gemini image gen second.
 *
 * The prompt is composed upstream by the Scribe (see scribe.js `composeScenePrompt`),
 * which assembles the current situation plus the known visual details of the
 * characters/things in frame. This module just renders that finished prompt and
 * caches the result. Provider chain (DECISIONS.md 2026-07-25 spike):
 *   1. xAI Grok Imagine (imageApiKey) — primary: best adult-content latitude,
 *      gender-faithful, fast.
 *   2. Gemini 3 Pro Image (the mandatory machinery key) — quality fallback:
 *      spike-verified gender-faithful and excellent; every player has this key.
 *      (The flash image tier is NOT used: it failed the armored-dwarf-woman
 *      gender case — the exact failure this chain exists to prevent.)
 *   3. Pollinations (no key) — labeled last resort only.
 */

import { normalizeXaiApiKey } from './xaiKey.js';

const IMAGE_CACHE = new Map();
const IMAGE_CACHE_MAX = 10;

const XAI_IMAGE_ENDPOINT = 'https://api.x.ai/v1/images/generations';
// Recommended model as of 2026 (grok-imagine-image-pro is deprecated May 2026).
const XAI_IMAGE_MODEL = 'grok-imagine-image-quality';

const GEMINI_IMAGE_MODEL = 'gemini-3-pro-image';
const GEMINI_IMAGE_ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_IMAGE_MODEL}:generateContent`;

// Pollinations renders via a GET URL; an uncapped prompt can exceed browser/CDN
// URL limits and the <img> then fails silently (never fetched, no error event).
const POLLINATIONS_PROMPT_MAX = 1500;

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

    const normalizedImageApiKey = normalizeXaiApiKey(imageApiKey);
    const geminiApiKey = (options.geminiApiKey || '').trim();
    const aspectRatio = options.aspectRatio || '16:9';
    const resolution = options.resolution || '1k';
    const fallbackWidth = options.fallbackWidth || 1280;
    const fallbackHeight = options.fallbackHeight || 720;
    const baseCacheKey = `${aspectRatio}|${resolution}|${prompt.toLowerCase().trim()}`;
    const preferredProvider = normalizedImageApiKey ? 'xai' : (geminiApiKey ? 'gemini' : 'pollinations');
    const preferredCacheKey = `${preferredProvider}|${baseCacheKey}`;
    // bypassCache is the reroll affordance: generation is the point of the
    // feature, so "Visualize again" must be able to produce a NEW image.
    if (!options.bypassCache && IMAGE_CACHE.has(preferredCacheKey)) {
        return IMAGE_CACHE.get(preferredCacheKey);
    }

    let fallbackReason = normalizedImageApiKey ? 'xai-error' : 'missing-key';
    if (normalizedImageApiKey) {
        try {
            const response = await fetch(XAI_IMAGE_ENDPOINT, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${normalizedImageApiKey}`,
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
                const compactError = errText.replace(/\s+/g, ' ').trim().slice(0, 300);
                fallbackReason = `xai-http-${response.status}${compactError ? `: ${compactError}` : ''}`;
                console.warn(`[ImageGen] xAI image request failed (Status ${response.status}). ${compactError}`);
            }
        } catch (e) {
            fallbackReason = `xai-network: ${String(e.message || e).slice(0, 200)}`;
            console.log('[ImageGen] xAI image generation failed, falling back:', e.message);
        }
    }

    // Gemini image fallback on the mandatory machinery key — every player has
    // one, so the quality floor is a real image model, not Pollinations.
    if (geminiApiKey) {
        try {
            const response = await fetch(`${GEMINI_IMAGE_ENDPOINT}?key=${encodeURIComponent(geminiApiKey)}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    contents: [{ parts: [{ text: prompt }] }],
                    generationConfig: {
                        responseModalities: ['IMAGE'],
                        imageConfig: { aspectRatio },
                    },
                }),
            });
            if (response.ok) {
                const data = await response.json();
                const parts = data?.candidates?.[0]?.content?.parts || [];
                const inline = parts.find(p => p?.inlineData?.data)?.inlineData;
                if (inline) {
                    const dataUrl = `data:${inline.mimeType || 'image/png'};base64,${inline.data}`;
                    const finalUrl = await downscaleDataUrl(dataUrl, {
                        maxWidth: options.maxWidth,
                        maxHeight: options.maxHeight,
                        quality: options.quality,
                    });
                    const result = { url: finalUrl, provider: 'gemini', fallbackReason };
                    cacheSet(`gemini|${baseCacheKey}`, result);
                    return result;
                }
                const finish = data?.candidates?.[0]?.finishReason || 'no-image';
                fallbackReason = `${fallbackReason}; gemini-empty (${finish})`;
                console.log('[ImageGen] Gemini returned no image:', finish);
            } else {
                const errText = await response.text().catch(() => '');
                fallbackReason = `${fallbackReason}; gemini-http-${response.status}`;
                console.warn(`[ImageGen] Gemini image request failed (Status ${response.status}). ${errText.replace(/\s+/g, ' ').trim().slice(0, 200)}`);
            }
        } catch (e) {
            fallbackReason = `${fallbackReason}; gemini-network: ${String(e.message || e).slice(0, 200)}`;
            console.log('[ImageGen] Gemini image generation failed, falling back:', e.message);
        }
    }

    // Free fallback (no key required). Lower quality — used only when both real
    // providers are unavailable.
    try {
        const seed = Math.floor(Math.random() * 100000);
        const safePrompt = encodeURIComponent(prompt.slice(0, POLLINATIONS_PROMPT_MAX));
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

export async function generateSceneImageDetailed(prompt, imageApiKey, extraOptions = {}) {
    return generateImageResult(prompt, imageApiKey, {
        aspectRatio: '16:9',
        resolution: '1k',
        fallbackWidth: 1280,
        fallbackHeight: 720,
        ...extraOptions,
    });
}

export async function generatePortraitImageDetailed(prompt, imageApiKey, extraOptions = {}) {
    return generateImageResult(prompt, imageApiKey, {
        aspectRatio: '3:4',
        resolution: '1k',
        fallbackWidth: 768,
        fallbackHeight: 1024,
        maxWidth: 480,
        maxHeight: 640,
        quality: 0.82,
        ...extraOptions,
    });
}

/** URL-only portrait wrapper (CharacterSheet's hero portrait uses it). */
export async function generatePortraitImage(prompt, imageApiKey, extraOptions = {}) {
    const result = await generatePortraitImageDetailed(prompt, imageApiKey, extraOptions);
    return result?.url || null;
}

/**
 * Clear the image cache.
 */
export function clearImageCache() {
    IMAGE_CACHE.clear();
}
