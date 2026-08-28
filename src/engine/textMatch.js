/**
 * Shared fuzzy-text matching core — tokenize → stop-word filter → set
 * containment. One algorithm behind four subsystems that each grew their own
 * copy: world-fact dedupe (gameReducer), NPC dossier merges (npcRoster),
 * story-memory card dedupe (storyMemory), and the location registry.
 *
 * Deliberately NOT shared: stop-word lists, minimum token lengths, and
 * containment thresholds. Those vary per domain on purpose (a location name
 * needs direction words that a fact dedupe wants filtered), so every caller
 * passes its own via options and keeps its threshold at the call site.
 */

/**
 * Meaningful-token set for fuzzy matching. Unicode-aware (\p{L}\p{N}), so
 * non-ASCII names ("Virtapää") survive tokenization intact.
 *
 * Options:
 * - stopWords: Set of tokens to drop (checked after lowercasing), or null.
 * - minLength: minimum token length to keep (default 1 = keep everything).
 * - foldPossessives: strip "'s" before tokenizing so "Jack's promise" and
 *   "Jack, the promise" name the same entity.
 */
export function tokenSet(text, { stopWords = null, minLength = 1, foldPossessives = false } = {}) {
    let normalized = String(text || '').toLowerCase();
    if (foldPossessives) normalized = normalized.replace(/['’]s\b/g, '');
    normalized = normalized
        .replace(/[^\p{L}\p{N}\s]/gu, ' ')
        .replace(/\s+/g, ' ')
        .trim();
    if (!normalized) return new Set();
    return new Set(normalized.split(' ').filter(token => (
        token.length >= minLength && !(stopWords && stopWords.has(token))
    )));
}

/** Number of `a`'s tokens found in `b`. */
export function overlapCount(a, b) {
    if (!a?.size || !b?.size) return 0;
    let hits = 0;
    for (const token of a) {
        if (b.has(token)) hits += 1;
    }
    return hits;
}

/** Directional: fraction of `contained`'s tokens found in `container` (0..1).
 * Returns 0 when either set is empty — callers own their empty-set policy. */
export function coverage(contained, container) {
    if (!contained?.size || !container?.size) return 0;
    return overlapCount(contained, container) / contained.size;
}

/** Symmetric: fraction of the SMALLER set's tokens found in the larger (0..1).
 * "Odo is dead" vs "Odo is dead, killed at the docks" scores 1. */
export function containment(a, b) {
    if (!a?.size || !b?.size) return 0;
    const small = a.size <= b.size ? a : b;
    const large = a.size <= b.size ? b : a;
    return overlapCount(small, large) / small.size;
}

/**
 * Item identity match shared by the Scribe audit family AND the reducer's
 * name-referenced item removal: exact compact-token equality OR symmetric
 * meaningful-token containment, so a narrated "hempen rope" matches the
 * catalog's "Hempen Rope (50 ft)" and "wax candles" matches "Wax Candles (x5)".
 * One copy on purpose (2026-08-28 P1): the audits matched fuzzily while
 * REMOVE_ITEM_BY_NAME stayed exact-only, so a drifted-name items_lost
 * dead-ended at both layers.
 */
export function itemIdentityMatches(a, b) {
    const compactA = String(a || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    const compactB = String(b || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    if (compactA && compactA === compactB) return true;
    const setA = tokenSet(String(a || ''), { minLength: 2 });
    const setB = tokenSet(String(b || ''), { minLength: 2 });
    return setA.size > 0 && setB.size > 0 && containment(setA, setB) >= 0.99;
}
