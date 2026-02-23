/**
 * Image generation using Gemini's Imagen API for scene art.
 * Falls back gracefully if image generation is not available.
 */

const IMAGE_CACHE = new Map();

/**
 * Generate a scene image from a description using Gemini Imagen.
 * @param {string} description - Scene description to visualize
 * @param {string} apiKey - Gemini API key
 * @returns {Promise<string|null>} Data URL of generated image, or null on failure
 */
export async function generateSceneImage(description, apiKey) {
    if (!description) return null;

    // Check cache
    const cacheKey = description.toLowerCase().trim();
    if (IMAGE_CACHE.has(cacheKey)) {
        return IMAGE_CACHE.get(cacheKey);
    }

    if (apiKey) {
        try {
            // Use Gemini's image generation model (Imagen 4)
            const response = await fetch(
                `https://generativelanguage.googleapis.com/v1beta/models/imagen-4.0-generate-001:predict?key=${apiKey}`,
                {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        instances: [{
                            prompt: `Fantasy RPG scene illustration, high quality digital art, atmospheric lighting: ${description}`,
                        }],
                        parameters: {
                            sampleCount: 1,
                            aspectRatio: '16:9',
                            personGeneration: 'ALLOW_ALL',
                        },
                    }),
                }
            );

            if (response.ok) {
                const data = await response.json();
                const imageB64 = data?.predictions?.[0]?.bytesBase64Encoded;
                if (imageB64) {
                    const dataUrl = `data:image/png;base64,${imageB64}`;
                    IMAGE_CACHE.set(cacheKey, dataUrl);
                    return dataUrl;
                }
            } else {
                const errText = await response.text();
                // Instead of console.warn, we can log it gracefully so it doesn't look like a crash
                console.log(`[ImageGen] Gemini API fallback triggered (Status ${response.status})`);
            }
        } catch (e) {
            console.log('[ImageGen] Scene art generation with Gemini failed, falling back:', e.message);
        }
    }

    try {
        console.log('Attempting fallback to Pollinations AI...');
        const seed = Math.floor(Math.random() * 100000);
        const safePrompt = encodeURIComponent(`Fantasy RPG scene illustration, high quality digital art, atmospheric lighting: ${description}`);
        const fallbackUrl = `https://image.pollinations.ai/prompt/${safePrompt}?width=800&height=450&nologo=true&seed=${seed}`;

        // Return the URL directly to be used as <img src="..."> to avoid CORS blocks on fetch
        IMAGE_CACHE.set(cacheKey, fallbackUrl);
        return fallbackUrl;
    } catch (e) {
        console.warn('Fallback failed:', e);
    }

    return null;
}

/**
 * Clear the image cache.
 */
export function clearImageCache() {
    IMAGE_CACHE.clear();
}
