/**
 * Shared JSON extraction utilities for LLM response parsing.
 * Both responseParser and scribe use these to safely extract JSON
 * from LLM output that may contain multiple JSON-like blocks.
 */

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

    // Walk backwards to find the opening brace
    let startIdx = -1;
    for (let i = keyIdx; i >= 0; i--) {
        if (text[i] === '{') { startIdx = i; break; }
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
    let repaired = str.replace(/,\s*([\}\]])/g, '$1');
    // Count open vs close braces/brackets and close unclosed ones
    const openBraces = (repaired.match(/\{/g) || []).length;
    const closeBraces = (repaired.match(/\}/g) || []).length;
    const openBrackets = (repaired.match(/\[/g) || []).length;
    const closeBrackets = (repaired.match(/\]/g) || []).length;
    if (openBrackets > closeBrackets) repaired += ']'.repeat(openBrackets - closeBrackets);
    if (openBraces > closeBraces) repaired += '}'.repeat(openBraces - closeBraces);
    return repaired;
}
