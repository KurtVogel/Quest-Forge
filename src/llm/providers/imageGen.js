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

    try {
        // Use Gemini's image generation model (Imagen 3)
        const response = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models/imagen-3.0-generate-002:predict?key=${apiKey}`,
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
            console.warn(`Gemini Imagen API returned ${response.status}:`, errText);
        }
    } catch (e) {
        console.warn('Scene art generation error with Gemini, falling back:', e);
    }

    try {
        console.log('Attempting fallback to Pollinations AI...');
        const seed = Math.floor(Math.random() * 100000);
        const safePrompt = encodeURIComponent(`Fantasy RPG scene illustration, high quality digital art, atmospheric lighting: ${description}`);
        const fallbackUrl = `https://image.pollinations.ai/prompt/${safePrompt}?width=800&height=450&nologo=true&seed=${seed}`;

        // Fetch as blob to avoid ORB and CORS issues directly in the <img> tag
        const fbResponse = await fetch(fallbackUrl);
        if (fbResponse.ok) {
            const blob = await fbResponse.blob();
            return new Promise((resolve) => {
                const reader = new FileReader();
                reader.onloadend = () => {
                    const dataUrl = reader.result;
                    IMAGE_CACHE.set(cacheKey, dataUrl);
                    resolve(dataUrl);
                };
                reader.readAsDataURL(blob);
            });
        }
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
