import { sliceWhole } from '../config/contentLimits.js';

/**
 * THE text-typing shelf for engine and director boundaries (2026-10-02
 * hidden-fronts Lap-4: six private engine copies plus the llm/ one, three of
 * them byte-identical, one of them not type-strict).
 *
 * Type-strict by rule (2026-09-08): only a string or a finite number carries
 * text. `String(object)` minted "[object Object]" as a front's epitaph, a
 * hearsay line AND a permanent world fact — every other shape is junk → ''.
 * Whitespace runs collapse to one space (a stored line is a prompt line).
 * The clamp never splits a surrogate pair (2026-11-05 strengthening P2 — the
 * one `sliceWhole` beside `cleanTextField`, which shares this shelf's rule).
 */
export function cleanText(value, max = Infinity) {
    if (typeof value !== 'string' && !(typeof value === 'number' && Number.isFinite(value))) return '';
    return sliceWhole(String(value || '').replace(/\s+/g, ' ').trim(), max);
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
 * false, any other word is true. Read wherever an LLM or an import may
 * spell a flag as a word. One shelf since 2026-10-12 (story-memory Lap-4 P2):
 * four private `toFlag`s under one name carried TWO semantics.
 *
 * Type-strict like the rest of this shelf (2026-11-10 strengthening P1): only
 * a boolean, a number or a string carries a flag. `!!` read `{}` and `[]` —
 * an empty list copied from a neighbouring wire — as true, and `level_up: []`
 * paid the story milestone.
 */
export function toFlag(value) {
    if (typeof value === 'string') {
        const word = value.trim().toLowerCase();
        return word !== '' && !FALSE_FLAG_WORDS.has(word);
    }
    if (typeof value === 'boolean') return value;
    if (typeof value === 'number') return Number.isFinite(value) && value !== 0;
    return false;
}

const TRUE_FLAG_WORDS = new Set(['true', 'yes', 'on', '1']);
const DEFINITE_FALSE_FLAG_WORDS = new Set(['false', 'no', 'off', '0']);

/**
 * A lane VERDICT (2026-11-05 strengthening P2): `true` / `false` when the
 * value says so (`toFlag`'s words, either spelling), `undefined` when it does
 * not — omitted, blank, `null`, "none", or junk is NO verdict, so the caller's
 * own fallback decides (the arbiter's sync floor, the pre-narration regex).
 * `toFlag` would read junk as `true` and an omission as `false`.
 */
export function triFlag(value) {
    if (typeof value === 'boolean') return value;
    if (typeof value === 'number') return value === 1 ? true : (value === 0 ? false : undefined);
    if (typeof value !== 'string') return undefined;
    const word = value.trim().toLowerCase();
    if (TRUE_FLAG_WORDS.has(word)) return true;
    if (DEFINITE_FALSE_FLAG_WORDS.has(word)) return false;
    return undefined;
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

/**
 * An engine system row for the transcript (2026-10-14 progression Lap-4 P2):
 * ONE composer for every reducer handler, the progression receipts and the
 * out-of-combat resolver — it lived in handlers/shared.js with a second copy
 * in progression.js (the import cycle progression ⇄ handlers/shared) and
 * eleven inline `{ role: 'system', content }` literals in rollResolver.js.
 * `extra` carries the row flags (`dmVisible`, `kind`, `narrationCue`, …).
 */
export function systemMessage(content, extra = {}) {
    return {
        id: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        timestamp: Date.now(),
        role: 'system',
        content,
        ...extra,
    };
}
