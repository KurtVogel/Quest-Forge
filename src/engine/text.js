/**
 * THE text-typing shelf for engine and director boundaries (2026-10-02
 * hidden-fronts Lap-4: six private engine copies plus the llm/ one, three of
 * them byte-identical, one of them not type-strict).
 *
 * Type-strict by rule (2026-09-08): only a string or a finite number carries
 * text. `String(object)` minted "[object Object]" as a front's epitaph, a
 * hearsay line AND a permanent world fact — every other shape is junk → ''.
 * Whitespace runs collapse to one space (a stored line is a prompt line).
 */
export function cleanText(value, max = Infinity) {
    if (typeof value !== 'string' && !(typeof value === 'number' && Number.isFinite(value))) return '';
    return String(value || '').replace(/\s+/g, ' ').trim().slice(0, max);
}

/**
 * A plain object — the record twin of the type-strict rule: an array, a
 * string, or `null` is never a record a boundary may read fields from.
 */
export function isRecord(value) {
    return !!value && typeof value === 'object' && !Array.isArray(value);
}

/** `cleanText` with a fallback for the empty / junk case. */
export function textOr(value, fallback = '') {
    return cleanText(value) || fallback;
}

const FALSE_FLAG_WORDS = new Set(['false', 'no', 'off', '0', 'none', 'null', 'undefined']);

/**
 * A LANE boolean (the 09-15 `is_undead` rule): "false" / "no" / "0" / "" are
 * false, anything else truthy is `!!`. Read wherever an LLM or an import may
 * spell a flag as a word. One shelf since 2026-10-12 (story-memory Lap-4 P2):
 * four private `toFlag`s under one name carried TWO semantics.
 */
export function toFlag(value) {
    if (typeof value === 'string') {
        const word = value.trim().toLowerCase();
        return word !== '' && !FALSE_FLAG_WORDS.has(word);
    }
    return !!value;
}

/**
 * A PERSISTED engine boolean: only `true` (or a hand-edited "true") is true.
 * The load heals read this for flags the engine itself writes — a stray `1` or
 * "yes" in a save is junk, not a death or a deleted message.
 */
export function strictFlag(value) {
    if (typeof value === 'string') return value.trim().toLowerCase() === 'true';
    return value === true;
}

/** A finite number rounded and clamped into [min, max], or the fallback. */
export function clampNumber(value, min, max, fallback) {
    const n = Number(value);
    if (!Number.isFinite(n)) return fallback;
    return Math.max(min, Math.min(max, Math.round(n)));
}
