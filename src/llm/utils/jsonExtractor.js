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
 * Parse one JSON text, repairing ONCE before giving up (trailing commas,
 * truncation, an unclosed string). Returns the parsed value — which may be
 * a JSON `null` — or `undefined` when nothing parses; never throws.
 * THE parse→repair step every LLM-JSON reader shares (2026-10-11 audit: the
 * walk had seven inline copies, and the roll arbiter's copy had no repair —
 * a reply truncated by its final `}` flipped a REJECT into an accept).
 * `label` names the lane in the one-line warning a repair earns.
 */
export function parseJsonText(json, { label = null } = {}) {
    if (typeof json !== 'string' || !json.trim()) return undefined;
    try {
        return JSON.parse(json);
    } catch {
        try {
            const parsed = JSON.parse(repairJson(json));
            if (label) console.warn(`[${label}] JSON repaired before parsing.`);
            return parsed;
        } catch (e) {
            if (label) console.warn(`[${label}] JSON parse failed after repair:`, e.message);
            return undefined;
        }
    }
}

/**
 * Locate the JSON object an LLM reply carries: the first anchor key that
 * extracts a balanced object wins (`{ json, startIndex }`); with
 * `wholeObject`, a reply that IS the object (fences stripped, starting at
 * `{`) is read whole as the fallback — the machinery's "Output ONLY the JSON"
 * contract, whose schema keys are an ASSUMPTION the model may omit
 * (2026-09-16 scribe P1). `startIndex` is relative to `text` for an anchored
 * hit and null for the whole-object read (its text was fence-stripped).
 */
export function extractLlmJson(text, { anchors = [], wholeObject = false } = {}) {
    const source = String(text || '');
    for (const anchor of (Array.isArray(anchors) ? anchors : [anchors])) {
        if (typeof anchor !== 'string' || !anchor) continue;
        const match = extractBalancedJson(source, anchor);
        if (match?.json) return match;
    }
    if (!wholeObject) return null;
    const cleaned = stripMarkdownFences(source);
    if (!cleaned.startsWith('{')) return null;
    const end = scanBalancedObject(cleaned, 0);
    return { json: end > 0 ? cleaned.slice(0, end) : cleaned, startIndex: null };
}

/**
 * THE extract → parse → repair walk: `extractLlmJson` then `parseJsonText`,
 * accepting only a plain object. Returns `{ value, startIndex }` or null —
 * never throws. Every reader of LLM JSON runs on this (the DM parser's
 * unfenced lane, the directors, the Scribe, the nudge, the enrichment lane,
 * the roll arbiter, the journal, the fodder review).
 */
export function parseLlmJson(text, { anchors = [], wholeObject = false, label = null } = {}) {
    const extracted = extractLlmJson(text, { anchors, wholeObject });
    if (!extracted) return null;
    const value = parseJsonText(extracted.json, { label });
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    return { value, startIndex: extracted.startIndex };
}

/**
 * One keyword-anchored object with where it starts in `text` (callers
 * slicing narrative off the front need the index). Never throws — null on
 * failure. A thin name over parseLlmJson, kept for the DM parser's lane.
 */
export function parseBalancedJsonAt(text, keyword) {
    return parseLlmJson(text, { anchors: [keyword] });
}

/**
 * Parse a JSON object from LLM output: keyword anchors first, then the reply
 * read whole when it IS the object. The same walk the directors run
 * (2026-10-11 audit: this twin used `JSON.parse(cleaned)` on the WHOLE
 * fence-stripped string, so a fenced object followed by prose with no anchor
 * hit parsed through the director's walk and returned null here — and the
 * weaker twin was the one the journal cadence and the fodder review read).
 * Never throws — returns null on failure.
 */
export function parseJsonObjectLoose(text, keywords = []) {
    return parseLlmJson(text, { anchors: keywords, wholeObject: true })?.value ?? null;
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
/**
 * Backward-walk budget across ALL anchor occurrences of one extraction: each
 * prose mention of a wire key used to walk back to index 0 — 4,000 mentions
 * in a 234k reply cost 1.56 s on the main thread (2026-09-15 audit P2).
 * Occurrences are tried LAST-first (the events block trails the narrative,
 * so the real key is the last occurrence and prose mentions are never
 * walked); the budget is the belt for absurd inputs.
 */
const MAX_ANCHOR_SCAN_CHARS = 4_000_000;

export function extractBalancedJson(text, keyword) {
    // Anchor candidates: every occurrence of the QUOTED key first (a JSON key
    // proper), then every bare occurrence (repair-path unquoted keys). The old
    // first-bare-occurrence anchor stopped at a prose mention before the block
    // ("I'll log this under quest_updates") and returned null, so the raw JSON
    // shipped as narrative (2026-09-05 audit).
    const quoted = keyword.startsWith('"') ? keyword : `"${keyword}"`;
    const budget = { remaining: MAX_ANCHOR_SCAN_CHARS };
    for (const needle of quoted === keyword ? [keyword] : [quoted, keyword]) {
        for (let keyIdx = text.lastIndexOf(needle); keyIdx !== -1; keyIdx = keyIdx === 0 ? -1 : text.lastIndexOf(needle, keyIdx - 1)) {
            if (budget.remaining <= 0) return null;
            const match = extractEnclosingObject(text, keyIdx, budget);
            if (match) return match;
        }
    }
    return null;
}

/**
 * Forward, string-aware balanced-brace walk from a known `{` at `startIdx`.
 * Returns the index just past the matching `}`, or -1 when the object never
 * closes. Shared by the anchor extractor and the parser's fenced-block reader
 * (a ``` inside a JSON string value must not end a fenced block early).
 */
export function scanBalancedObject(text, startIdx) {
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
            if (depth === 0) return i + 1;
        }
    }
    return -1;
}

function extractEnclosingObject(text, keyIdx, budget = null) {
    // Walk backwards to the innermost brace that actually ENCLOSES the keyword,
    // tracking a running close-count so an already-closed earlier object is
    // skipped over. The old nearest-'{' walk anchored on unrelated nested
    // objects whenever the keyword wasn't the JSON's first key — e.g. in
    // {"npc_updates":[{...}], "requested_rolls":[...]} it silently extracted
    // the inner NPC object and dropped the roll request (P0, 2026-07-14 audit).
    // String-aware in REVERSE since 2026-09-15 (audit P2): the char before a
    // JSON key is outside any string, a quote toggles, and a quote behind an
    // odd run of backslashes is escaped content — an unbalanced `{` inside a
    // string VALUE before the key ("Gate {West") used to anchor inside the
    // string, parse and repair both failed, and the raw JSON shipped as prose.
    let startIdx = -1;
    let closeCount = 0;
    let inString = false;
    let scanned = 0;
    for (let i = keyIdx - 1; i >= 0; i--) {
        scanned++;
        const ch = text[i];
        if (ch === '"') {
            let backslashes = 0;
            for (let j = i - 1; j >= 0 && text[j] === '\\'; j--) backslashes++;
            if (backslashes % 2 === 0) inString = !inString;
            continue;
        }
        if (inString) continue;
        if (ch === '}') {
            closeCount++;
        } else if (ch === '{') {
            if (closeCount === 0) { startIdx = i; break; }
            closeCount--;
        }
    }
    if (budget) budget.remaining -= scanned;
    if (startIdx === -1) return null;

    const end = scanBalancedObject(text, startIdx);
    if (end !== -1) return { json: text.slice(startIdx, end), startIndex: startIdx };
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
    if (inString) {
        // A truncation right after a backslash (`"abc\`) would escape the
        // closing quote appended here and stay unparseable — drop the dangling
        // escape first (2026-09-15 audit P2).
        if (escape) repaired = repaired.slice(0, -1);
        repaired += '"';
    }
    while (stack.length > 0) {
        repaired += stack.pop() === '{' ? '}' : ']';
    }
    return repaired;
}
