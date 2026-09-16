/**
 * Dev-only hook for scripting a session return (the return card, 2026-09-16):
 * `?returnAfter=3d` (or `36h`, `90m`, or a raw millisecond count) fakes the
 * gap since the campaign was last played, so the card can be exercised
 * without waiting six hours. ChatPanel reads the global in DEV builds only;
 * a production build never sets it (import.meta.env.DEV gate, like the
 * settings seeder). Never persisted, never touches the save.
 */
const UNIT_MS = { m: 60 * 1000, h: 60 * 60 * 1000, d: 24 * 60 * 60 * 1000 };

export function parseReturnAfter(value) {
    if (typeof value !== 'string') return null;
    const match = value.trim().match(/^(\d+(?:\.\d+)?)\s*([mhd])?$/i);
    if (!match) return null;
    const amount = Number(match[1]);
    if (!Number.isFinite(amount) || amount < 0) return null;
    const unit = match[2] ? UNIT_MS[match[2].toLowerCase()] : 1;
    return Math.round(amount * unit);
}

export function seedDevReturnGap() {
    if (!import.meta.env.DEV) return;
    const gap = parseReturnAfter(new URLSearchParams(window.location.search).get('returnAfter'));
    if (gap == null) return;
    globalThis.__QF_DEV_RETURN_GAP_MS__ = gap;
    console.info(`[devReturnCard] faking a ${gap} ms gap since the campaign was last played`);
}
