/**
 * Shared JSON extraction utilities for LLM response parsing.
 * Both responseParser and scribe use these to safely extract JSON
 * from LLM output that may contain multiple JSON-like blocks.
 */

export function stripMarkdownFences(text) {
    return String(text || '')
        .trim()
        .replace(/^```(?:json)?\s*\n?/i, '')
        .replace(/\n?```\s*$/i, '')
        .trim();
}

/**
 * Parse a JSON object from LLM output, trying repair and optional keyword anchors.
 * Never throws — returns null on failure.
 */
export function parseJsonObjectLoose(text, keywords = []) {
    const cleaned = stripMarkdownFences(text);
    if (!cleaned) return null;

    const anchors = [...keywords, null];
    for (const keyword of anchors) {
        const jsonMatch = keyword
            ? extractBalancedJson(cleaned, keyword)
            : (cleaned.startsWith('{') ? { json: cleaned } : null);
        if (!jsonMatch?.json) continue;

        try {
            return JSON.parse(jsonMatch.json);
        } catch {
            try {
                return JSON.parse(repairJson(jsonMatch.json));
            } catch {
                // try next anchor
            }
        }
    }
    return null;
}

/**
 * Extract a balanced JSON object from text that contains a given keyword.
 * Uses brace counting instead of greedy regex to avoid grabbing too much
 * when the LLM outputs multiple JSON-like blocks in a single response.
 *
 * @param {string} text - Full response text
 * @param {string} keyword - Keyword the JSON must contain (e.g. 'requested_rolls')
 * @returns {{ json: string, startIndex: number } | null}
 */
export function extractBalancedJson(text, keyword) {
    const keyIdx = text.indexOf(keyword);
    if (keyIdx === -1) return null;

    // Walk backwards to the innermost brace that actually ENCLOSES the keyword,
    // tracking a running close-count so an already-closed earlier object is
    // skipped over. The old nearest-'{' walk anchored on unrelated nested
    // objects whenever the keyword wasn't the JSON's first key — e.g. in
    // {"npc_updates":[{...}], "requested_rolls":[...]} it silently extracted
    // the inner NPC object and dropped the roll request (P0, 2026-07-14 audit).
    let startIdx = -1;
    let closeCount = 0;
    for (let i = keyIdx; i >= 0; i--) {
        const ch = text[i];
        if (ch === '}') {
            closeCount++;
        } else if (ch === '{') {
            if (closeCount === 0) { startIdx = i; break; }
            closeCount--;
        }
    }
    if (startIdx === -1) return null;

    // Walk forward counting braces to find the matching close
    let depth = 0;
    let inString = false;
    let escape = false;
    for (let i = startIdx; i < text.length; i++) {
        const ch = text[i];
        if (escape) { escape = false; continue; }
        if (ch === '\\' && inString) { escape = true; continue; }
        if (ch === '"') { inString = !inString; continue; }
        if (inString) continue;
        if (ch === '{') depth++;
        if (ch === '}') {
            depth--;
            if (depth === 0) {
                return { json: text.slice(startIdx, i + 1), startIndex: startIdx };
            }
        }
    }
    // Unbalanced — return what we have (repairJson may fix it)
    return { json: text.slice(startIdx), startIndex: startIdx };
}

/**
 * Attempt to repair common JSON formatting issues before giving up.
 * Handles trailing commas and unclosed braces/brackets.
 *
 * @param {string} str - Raw JSON string
 * @returns {string} Repaired string (may still be invalid)
 */
export function repairJson(str) {
    // Remove trailing commas before } or ]
    let repaired = str.replace(/,\s*([}\]])/g, '$1');
    // A truncated response often ends mid-list, right after a comma
    repaired = repaired.replace(/,\s*$/, '');

    // Close unclosed strings/braces/brackets in correct NESTING order. The old
    // count-and-append (all ']' then all '}') produced invalid closings for any
    // truncation inside an object nested in an array — e.g. `[{"a":1` needs `}]`,
    // not `]}` — and counted braces inside string values.
    const stack = [];
    let inString = false;
    let escape = false;
    for (const ch of repaired) {
        if (escape) { escape = false; continue; }
        if (ch === '\\' && inString) { escape = true; continue; }
        if (ch === '"') { inString = !inString; continue; }
        if (inString) continue;
        if (ch === '{' || ch === '[') stack.push(ch);
        else if (ch === '}' || ch === ']') stack.pop();
    }
    if (inString) repaired += '"';
    while (stack.length > 0) {
        repaired += stack.pop() === '{' ? '}' : ']';
    }
    return repaired;
}
