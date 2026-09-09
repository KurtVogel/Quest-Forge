/**
 * THE portrait URL allowlist (2026-09-09 audit P2). Three copies used to exist —
 * the NPC roster's SAFE_PORTRAIT_URL, the hero vault's sanitizeImageUrl, and
 * NOTHING on the hero's live save: `healLoadedCharacter` spread `portraitUrl`
 * raw and UPDATE_CHARACTER stored anything, so a shared/cloud save carrying
 * `https://tracker.example/pixel.png` rendered as an <img src> on the sheet,
 * the profile screen, and the reveal — a third-party fetch. One rule now:
 * a Pollinations prompt URL or an inline image data URL, capped at the vault's
 * export ceiling (an over-ceiling portrait single-handedly pushed a cloud save
 * into chunking — one click regenerates it).
 */
export const MAX_PORTRAIT_URL_LENGTH = 300_000;

const SAFE_PORTRAIT_URL = /^(?:https:\/\/image\.pollinations\.ai\/prompt\/\S+|data:image\/(?:png|jpe?g|webp|gif);base64,[a-z0-9+/=]+)$/i;

/** The URL itself when it is safe to render, otherwise ''. */
export function sanitizePortraitUrl(value) {
    if (typeof value !== 'string') return '';
    const s = value.trim();
    if (!s || s.length > MAX_PORTRAIT_URL_LENGTH) return '';
    return SAFE_PORTRAIT_URL.test(s) ? s : '';
}
