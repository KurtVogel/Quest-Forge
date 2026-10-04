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
