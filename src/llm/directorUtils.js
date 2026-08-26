/**
 * Shared helpers for the living-world director family (frontDirector,
 * frontUpgrade, frontMigration, frontAftermath, absenceDrift, regionalFronts)
 * and the Scribe-side machinery modules. Every director receives its answer
 * as prose-wrapped JSON and used to carry a private copy of the same
 * extract→parse→repair→throw dance plus a private cleanText (2026-08-19
 * audit: six copies of the dance, eight of cleanText) — one implementation,
 * one test surface.
 */
import { extractBalancedJson, repairJson } from './utils/jsonExtractor.js';

/** Whitespace-collapse + trim + optional clamp. Omit maxLength to keep the full text. */
export function cleanText(value, maxLength) {
    return String(value || '').replace(/\s+/g, ' ').trim().slice(0, maxLength);
}

/**
 * Extract and parse a director response's JSON object, anchored on a key the
 * schema guarantees, repairing once before giving up. `anchorKey` may be an
 * array — the first anchor that extracts wins (frontUpgrade's two-list
 * schema). Error messages default to the family's standard phrasing; modules
 * whose messages reach the player (the migration/upgrade dialogs) override
 * them so every existing surface stays byte-identical.
 */
export function parseDirectorJson(response, anchorKey, label, { missingMessage, malformedMessage } = {}) {
    const text = String(response || '');
    const anchors = Array.isArray(anchorKey) ? anchorKey : [anchorKey];
    let extracted = null;
    for (const anchor of anchors) {
        extracted = extractBalancedJson(text, anchor);
        if (extracted) break;
    }
    if (!extracted) throw new Error(missingMessage || `The ${label} response did not contain ${anchors[0]}.`);
    try {
        return JSON.parse(extracted.json);
    } catch {
        try {
            return JSON.parse(repairJson(extracted.json));
        } catch {
            throw new Error(malformedMessage || `The ${label} response was malformed.`);
        }
    }
}

/**
 * Non-throwing sibling of parseDirectorJson for the fire-and-forget Scribe
 * passes (per-turn extraction, cadence reflection), whose failure contract is
 * "log and quietly do nothing" rather than an error surface. Returns the
 * parsed object, or null when no anchored JSON exists or repair fails.
 */
export function tryParseDirectorJson(response, anchorKey, label) {
    const text = String(response || '');
    const anchors = Array.isArray(anchorKey) ? anchorKey : [anchorKey];
    let extracted = null;
    for (const anchor of anchors) {
        extracted = extractBalancedJson(text, anchor);
        if (extracted) break;
    }
    if (!extracted) return null;
    try {
        return JSON.parse(extracted.json);
    } catch {
        try {
            const parsed = JSON.parse(repairJson(extracted.json));
            console.warn(`[${label}] JSON repaired before parsing.`);
            return parsed;
        } catch (e) {
            console.warn(`[${label}] JSON parse failed after repair:`, e.message);
            return null;
        }
    }
}
