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
 * Extract → parse → repair one keyword-anchored balanced object, returning the
 * parsed value AND where it starts in `text` (callers slicing narrative off the
 * front need the index). ONE implementation of the anchors→parse→repair walk —
 * responseParser's unfenced fallback used to re-implement it inline just for
 * `startIndex` (2026-08-29 audit). Never throws — null on failure.
 */
export function parseBalancedJsonAt(text, keyword) {
    const jsonMatch = extractBalancedJson(text, keyword);
    if (!jsonMatch?.json) return null;
    try {
        return { value: JSON.parse(jsonMatch.json), startIndex: jsonMatch.startIndex };
    } catch {
        try {
            return { value: JSON.parse(repairJson(jsonMatch.json)), startIndex: jsonMatch.startIndex };
        } catch {
            return null;
        }
    }
}

/**
 * Parse a JSON object from LLM output, trying repair and optional keyword anchors.
 * Never throws — returns null on failure.
 */
export function parseJsonObjectLoose(text, keywords = []) {
    const cleaned = stripMarkdownFences(text);
    if (!cleaned) return null;

    for (const keyword of keywords) {
        const parsed = parseBalancedJsonAt(cleaned, keyword);
        if (parsed) return parsed.value;
    }
    // No anchor matched — a response that IS the object, fences already stripped.
    if (cleaned.startsWith('{')) {
        try {
            return JSON.parse(cleaned);
        } catch {
            try {
                return JSON.parse(repairJson(cleaned));
            } catch {
                // fall through
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
    // Remove trailing commas before } or ] — string-aware: a comma inside a
    // string VALUE ("…wait, }") is content, not syntax. The closing logic below
    // was made string-aware 2026-07-14; the old regex comma pass was not, and
    // mutated dialogue during repair (2026-08-05 audit).
    let repaired = '';
    {
        let inString = false;
        let escape = false;
        for (let i = 0; i < str.length; i++) {
            const ch = str[i];
            if (inString) {
                repaired += ch;
                if (escape) escape = false;
                else if (ch === '\\') escape = true;
                else if (ch === '"') inString = false;
                continue;
            }
            if (ch === '"') { inString = true; repaired += ch; continue; }
            if (ch === ',') {
                let j = i + 1;
                while (j < str.length && /\s/.test(str[j])) j++;
                if (j < str.length && (str[j] === '}' || str[j] === ']')) continue; // trailing comma — drop
            }
            repaired += ch;
        }
    }
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
