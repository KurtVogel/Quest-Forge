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
import { getMachineryGeminiKey } from '../machinery.js';

const IMAGE_CACHE = new Map();
const IMAGE_CACHE_MAX = 10;

// Store at the size you render (2026-09-21 audit P2). The Journal/Companions
// card draws an NPC portrait 84 px wide — 256×341 covers a 3× DPR phone at
// ~1/3 of the 480×640 bytes (the hero's sheet + wizard reveal keep 480×640).
export const NPC_PORTRAIT_SIZE = Object.freeze({ maxWidth: 256, maxHeight: 341 });

// The scene cache holds up to 10 renders in tab memory; a Gemini inline PNG is
// several MB of base64, so ten full-resolution entries could pin tens of MB on
// the phone target. The render handed back to the caller (the CURRENT picture)
// stays full-resolution; the CACHED copy is a display-sized JPEG re-encode.
const SCENE_CACHE_MAX_WIDTH = 1280;
const SCENE_CACHE_MAX_HEIGHT = 1280;
const SCENE_CACHE_QUALITY = 0.85;
// At or under the display size only a heavyweight (PNG-class) payload is worth
// re-encoding; a 1k JPEG passes through untouched.
const SCENE_CACHE_REENCODE_OVER_CHARS = 1_200_000;

const XAI_IMAGE_ENDPOINT = 'https://api.x.ai/v1/images/generations';
// Recommended model as of 2026 (grok-imagine-image-pro is deprecated May 2026).
const XAI_IMAGE_MODEL = 'grok-imagine-image-quality';

const GEMINI_IMAGE_MODEL = 'gemini-3-pro-image';
const GEMINI_IMAGE_ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_IMAGE_MODEL}:generateContent`;

// Pollinations renders via a GET URL; an uncapped prompt can exceed browser/CDN
// URL limits and the <img> then fails silently (never fetched, no error event).
const POLLINATIONS_PROMPT_MAX = 1500;

// Backstop for the POST providers too: the art director is instructed to stay
// short, but a runaway composed prompt must not ride the xAI/Gemini request
// bodies unbounded either.
const PROVIDER_PROMPT_MAX = 4000;

// Stall guard for the two provider POSTs (2026-09-01 scene-art P1): browser
// fetch never times out on its own, so a stalled socket pinned SceneArt's
// spinner forever with the whole control row hidden, and the fallback chain
// never engaged because a hang is not a rejection. A timeout is just another
// `xai-network:` / `gemini-network:` reason and falls through the chain.
export const IMAGE_FETCH_TIMEOUT_MS = 60_000;

function abortError(message) {
    const error = new Error(message);
    error.name = 'AbortError';
    return error;
}

/**
 * Per-request abort signal: the stall timer OR the caller's own cancel
 * (options.signal). Own timer + controller (not AbortSignal.timeout) so the
 * guard is fake-timer testable and the external cancel can be told apart
 * from a stall by the caller's signal state.
 */
function requestSignal(externalSignal) {
    const controller = new AbortController();
    const timer = setTimeout(
        () => controller.abort(new Error(`stalled — no response after ${Math.round(IMAGE_FETCH_TIMEOUT_MS / 1000)}s`)),
        IMAGE_FETCH_TIMEOUT_MS,
    );
    const onExternalAbort = () => controller.abort(abortError('Image generation cancelled.'));
    if (externalSignal?.aborted) onExternalAbort();
    else externalSignal?.addEventListener?.('abort', onExternalAbort, { once: true });
    return {
        signal: controller.signal,
        release() {
            clearTimeout(timer);
            externalSignal?.removeEventListener?.('abort', onExternalAbort);
        },
    };
}

/**
 * A deliberate cancel is NOT a provider failure: it must never fall through
 * to the next provider in the chain (cancel ≠ provider failure).
 */
function rethrowIfCancelled(options) {
    if (options.signal?.aborted) throw abortError('Image generation cancelled.');
}

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

/**
 * Cache a finished render. Portraits were already downscaled by the caller's
 * own maxWidth/maxHeight; a full-resolution scene render is cached as a
 * display-sized copy (see SCENE_CACHE_*), never at full size.
 */
async function cacheRender(key, result, options) {
    if (options.maxWidth || options.maxHeight || !result.url?.startsWith('data:image/')) {
        cacheSet(key, result);
        return;
    }
    const url = await downscaleDataUrl(result.url, {
        maxWidth: SCENE_CACHE_MAX_WIDTH,
        maxHeight: SCENE_CACHE_MAX_HEIGHT,
        quality: SCENE_CACHE_QUALITY,
        reencodeOverChars: SCENE_CACHE_REENCODE_OVER_CHARS,
    });
    cacheSet(key, url === result.url ? result : { ...result, url });
}

/** Guess the image MIME from the leading bytes of a base64 payload. */
function mimeFromBase64(b64) {
    if (b64.startsWith('iVBOR')) return 'image/png';
    if (b64.startsWith('R0lGOD')) return 'image/gif';
    if (b64.startsWith('UklGR')) return 'image/webp';
    return 'image/jpeg'; // xAI returns JPEG by default
}

// Provider payloads are trusted by TYPE, not shape (2026-09-09 audit P2): a
// non-string body used to become `data:image/png;base64,[object Object]`,
// returned as a SUCCESS, cached under the scene key, and rendered as a broken
// <img> until Reroll; a verbatim `text/html` mime flowed into the portrait
// writes. Anything that is not a base64 string is "no image" for that tier.
const BASE64_BODY = /^[a-z0-9+/=]+$/i;
const IMAGE_MIME = /^image\/(?:png|jpe?g|webp|gif)$/i;

function base64ImageBody(value) {
    return typeof value === 'string' && value.length > 0 && BASE64_BODY.test(value) ? value : null;
}

function geminiInlineImage(parts) {
    for (const part of Array.isArray(parts) ? parts : []) {
        const inline = part?.inlineData;
        const data = base64ImageBody(inline?.data);
        if (!data) continue;
        const mimeType = typeof inline.mimeType === 'string' && IMAGE_MIME.test(inline.mimeType.trim())
            ? inline.mimeType.trim().toLowerCase()
            : (inline.mimeType ? null : 'image/png');
        if (!mimeType) continue;
        return { data, mimeType };
    }
    return null;
}

async function downscaleDataUrl(dataUrl, { maxWidth, maxHeight, quality = 0.82, reencodeOverChars = 0 } = {}) {
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
        const heavy = reencodeOverChars > 0 && dataUrl.length > reencodeOverChars;
        if (scale >= 1 && !heavy) return dataUrl;

        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
        canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        const encoded = canvas.toDataURL('image/jpeg', quality);
        // A re-encode that did not shrink anything is not worth the generation loss.
        return scale >= 1 && encoded.length >= dataUrl.length ? dataUrl : encoded;
    } catch (e) {
        console.warn('[ImageGen] Portrait downscale failed:', e);
        return dataUrl;
    }
}

/**
 * The fallback-reason GRAMMAR — written here, read by `fallbackNotice` in
 * components/SceneArt/sceneArtHelpers.js through the two predicates below
 * (2026-10-03 audit: the reasons were assembled as prose in this module and
 * parsed with `===` / `includes` in that one, with no shared constant and no
 * test that failed when a reason was renamed). A result's `fallbackReason` is
 * null for the first tier that had a key, else the reasons of every tier that
 * failed before it, joined with "; ":
 *   missing-key                     no xAI key configured
 *   <tier>-empty[ (<detail>)]       an OK reply with no image (usually moderation)
 *   <tier>-http-<status>[: <body>]  the provider refused the request
 *   <tier>-network: <message>       the request never completed (or stalled)
 */
const REASON_MISSING_KEY = 'missing-key';
const reason = {
    empty: (tier, detail) => `${tier}-empty${detail ? ` (${detail})` : ''}`,
    http: (tier, status, body) => `${tier}-http-${status}${body ? `: ${body}` : ''}`,
    network: (tier, message) => `${tier}-network: ${message}`,
};

/** True when the render fell back ONLY because no xAI key is configured. */
export function isMissingKeyFallback(fallbackReason) {
    return fallbackReason === REASON_MISSING_KEY;
}

/** True when xAI answered OK with no image — most likely content moderation. */
export function isXaiFilteredFallback(fallbackReason) {
    return typeof fallbackReason === 'string' && fallbackReason.split('; ').includes(reason.empty('xai'));
}

/**
 * The two real providers as descriptors: how to ask, and how to read an image
 * out of an OK reply. Everything else — the stall guard, the cancel rule, the
 * downscale, the cache write, the reason on failure — is ONE dance in
 * `tryProvider` (the tiers were two ~45-line copies of it).
 */
const TIERS = {
    xai: {
        request: (prompt, apiKey) => ({
            url: XAI_IMAGE_ENDPOINT,
            init: {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${apiKey}`,
                },
                body: JSON.stringify({
                    model: XAI_IMAGE_MODEL,
                    prompt,
                    n: 1,
                    response_format: 'b64_json',
                }),
            },
        }),
        extract: (data) => {
            const b64 = base64ImageBody(data?.data?.[0]?.b64_json);
            return b64 ? `data:${mimeFromBase64(b64)};base64,${b64}` : null;
        },
        emptyDetail: () => '',
    },
    gemini: {
        request: (prompt, apiKey, { aspectRatio }) => ({
            url: `${GEMINI_IMAGE_ENDPOINT}?key=${encodeURIComponent(apiKey)}`,
            init: {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    contents: [{ parts: [{ text: prompt }] }],
                    generationConfig: {
                        responseModalities: ['IMAGE'],
                        imageConfig: { aspectRatio },
                    },
                }),
            },
        }),
        extract: (data) => {
            const inline = geminiInlineImage(data?.candidates?.[0]?.content?.parts);
            return inline ? `data:${inline.mimeType};base64,${inline.data}` : null;
        },
        emptyDetail: (data) => data?.candidates?.[0]?.finishReason || 'no-image',
    },
};

/**
 * Ask one provider. Resolves `{ result }` on an image, `{ reason }` on any
 * provider failure (which falls through the chain), and THROWS only for the
 * caller's own cancel — a deliberate cancel is never a provider failure.
 */
async function tryProvider(tier, apiKey, prompt, options, { cacheKey, priorReason }) {
    const guard = requestSignal(options.signal);
    try {
        const { url, init } = TIERS[tier].request(prompt, apiKey, options);
        const response = await fetch(url, { ...init, signal: guard.signal });
        if (!response.ok) {
            const body = (await response.text().catch(() => '')).replace(/\s+/g, ' ').trim().slice(0, 300);
            console.warn(`[ImageGen] ${tier} image request failed (Status ${response.status}). ${body}`);
            return { reason: reason.http(tier, response.status, body) };
        }
        const data = await response.json();
        const dataUrl = TIERS[tier].extract(data);
        if (!dataUrl) {
            // OK status but no image — most likely filtered by content moderation.
            const detail = TIERS[tier].emptyDetail(data);
            console.warn(`[ImageGen] ${tier} returned no image (possibly filtered by moderation).`, detail);
            return { reason: reason.empty(tier, detail) };
        }
        const finalUrl = await downscaleDataUrl(dataUrl, {
            maxWidth: options.maxWidth,
            maxHeight: options.maxHeight,
            quality: options.quality,
        });
        const result = { url: finalUrl, provider: tier, fallbackReason: priorReason };
        await cacheRender(`${tier}|${cacheKey}`, result, options);
        return { result };
    } catch (e) {
        rethrowIfCancelled(options);
        console.warn(`[ImageGen] ${tier} image generation failed, falling back:`, e.message);
        return { reason: reason.network(tier, String(e.message || e).slice(0, 200)) };
    } finally {
        guard.release();
    }
}

/** The best provider the configured keys allow — the cache is keyed on it, so a cached fallback never blocks a retry on a better tier. */
function preferredProvider(imageApiKey, geminiApiKey) {
    if (normalizeXaiApiKey(imageApiKey)) return 'xai';
    return (typeof geminiApiKey === 'string' && geminiApiKey.trim()) ? 'gemini' : 'pollinations';
}

/**
 * Render a finished image prompt to a displayable image URL.
 * @param {string} prompt - The fully-composed visual prompt
 * @param {string} imageApiKey - xAI (Grok) API key
 * @param {object} options - Generation options
 * @returns {Promise<{url:string,provider:'xai'|'gemini'|'pollinations',fallbackReason:string|null}|null>}
 */
async function generateImageResult(prompt, imageApiKey, options = {}) {
    if (!prompt) return null;
    prompt = String(prompt).slice(0, PROVIDER_PROMPT_MAX);

    const keys = {
        xai: normalizeXaiApiKey(imageApiKey),
        gemini: (options.geminiApiKey || '').trim(),
    };
    const aspectRatio = options.aspectRatio || '16:9';
    const fallbackWidth = options.fallbackWidth || 1280;
    const fallbackHeight = options.fallbackHeight || 720;
    // options.cacheKey lets the caller key on the render's INPUTS instead of
    // the finished prompt. Scene prompts are written fresh by an LLM per click,
    // so a prompt-derived key could never hit for them — every repeat Visualize
    // paid a compose call + a full generation and pushed another full-res
    // base64 into the cache (2026-08-01 audit P1).
    // options.sessionScope folds the campaign id into every key so one
    // campaign's cached render is unreachable from another BY CONSTRUCTION
    // (2026-08-20 audit P2) — which is why no campaign boundary clears the
    // cache any more (five call sites did, as a belt, until 2026-10-04).
    const baseCacheKey = `${options.sessionScope || ''}|${options.cacheKey || `${aspectRatio}|${prompt.toLowerCase().trim()}`}`;
    const preferredCacheKey = `${preferredProvider(imageApiKey, keys.gemini)}|${baseCacheKey}`;
    // bypassCache is the reroll affordance: generation is the point of the
    // feature, so "Visualize again" must be able to produce a NEW image.
    if (!options.bypassCache && IMAGE_CACHE.has(preferredCacheKey)) {
        return IMAGE_CACHE.get(preferredCacheKey);
    }

    // xAI first; then Gemini on the mandatory machinery key — every player has
    // one, so the quality floor is a real image model, not Pollinations.
    let fallbackReason = keys.xai ? null : REASON_MISSING_KEY;
    for (const tier of ['xai', 'gemini']) {
        if (!keys[tier]) continue;
        const outcome = await tryProvider(tier, keys[tier], prompt, { ...options, aspectRatio }, { cacheKey: baseCacheKey, priorReason: fallbackReason });
        if (outcome.result) return outcome.result;
        fallbackReason = fallbackReason ? `${fallbackReason}; ${outcome.reason}` : outcome.reason;
    }
    rethrowIfCancelled(options);

    // Free fallback (no key required). Lower quality — used only when both real
    // providers are unavailable. Returned as an <img src> URL directly to avoid
    // CORS issues on fetch.
    const seed = Math.floor(Math.random() * 100000);
    const safePrompt = encodeURIComponent(prompt.slice(0, POLLINATIONS_PROMPT_MAX));
    const result = {
        url: `https://image.pollinations.ai/prompt/${safePrompt}?width=${fallbackWidth}&height=${fallbackHeight}&nologo=true&seed=${seed}`,
        provider: 'pollinations',
        fallbackReason,
    };
    cacheSet(`pollinations|${baseCacheKey}`, result);
    return result;
}

export async function generateSceneImageDetailed(prompt, imageApiKey, extraOptions = {}) {
    return generateImageResult(prompt, imageApiKey, {
        aspectRatio: '16:9',
        fallbackWidth: 1280,
        fallbackHeight: 720,
        ...extraOptions,
    });
}

export async function generatePortraitImageDetailed(prompt, imageApiKey, extraOptions = {}) {
    return generateImageResult(prompt, imageApiKey, {
        aspectRatio: '3:4',
        fallbackWidth: 768,
        fallbackHeight: 1024,
        maxWidth: 480,
        maxHeight: 640,
        quality: 0.82,
        ...extraOptions,
    });
}

/**
 * Probe the cache by an input-derived key (see options.cacheKey) WITHOUT
 * generating — lets SceneArt short-circuit before the compose call. Honors the
 * provider-chain preference, so a cached fallback-provider result never blocks
 * a retry on a better provider.
 */
export function peekCachedImage(cacheKey, { imageApiKey, geminiApiKey, sessionScope } = {}) {
    if (!cacheKey) return null;
    return IMAGE_CACHE.get(`${preferredProvider(imageApiKey, geminiApiKey)}|${sessionScope || ''}|${cacheKey}`) || null;
}

/**
 * The option set every image request shares — the machinery key for the
 * Gemini tier and the campaign scope that keeps one campaign's cache apart
 * from another's. One builder, so a caller cannot forget either.
 */
export function imageRequestOptions(settings, { sessionScope = '', bypassCache = false, signal } = {}) {
    return {
        geminiApiKey: getMachineryGeminiKey(settings),
        sessionScope: typeof sessionScope === 'string' ? sessionScope : '',
        bypassCache: !!bypassCache,
        ...(signal && { signal }),
    };
}

/**
 * "Paint this character" — THE portrait request (2026-10-03 audit: the Journal
 * card, the Character Sheet, the creation wizard and SceneArt's focus mode each
 * assembled the same options and threw the same string). `existingUrl` makes
 * the call a REROLL: the prompt is deterministic, so without the cache bypass
 * a second click returned the identical picture (2026-08-20 audit P1). `size`
 * stores the portrait at the size it renders (NPC_PORTRAIT_SIZE for a card).
 * Resolves the render or throws — a caller shows `error.message`.
 */
export async function requestPortrait(prompt, settings, { existingUrl = '', sessionScope = '', size = null, signal } = {}) {
    const result = await generatePortraitImageDetailed(prompt, settings?.imageApiKey, {
        ...imageRequestOptions(settings, { sessionScope, bypassCache: !!existingUrl, signal }),
        ...(size || {}),
    });
    if (!result?.url) throw new Error('No portrait returned.');
    return result;
}

/**
 * Clear the image cache. No production caller since 2026-10-04 — every key
 * carries its campaign scope, so a boundary has nothing to clear; kept for
 * tests and as the one manual reset.
 */
export function clearImageCache() {
    IMAGE_CACHE.clear();
}
