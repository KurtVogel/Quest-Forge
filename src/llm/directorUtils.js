/**
 * Shared helpers for the living-world director family (frontDirector,
 * frontUpgrade, frontAftermath, absenceDrift, regionalFronts)
 * and the Scribe-side machinery modules. Every director receives its answer
 * as prose-wrapped JSON and used to carry a private copy of the same
 * extract→parse→repair→throw dance plus a private cleanText (2026-08-19
 * audit: six copies of the dance, eight of cleanText) — one implementation,
 * one test surface.
 */
import { extractBalancedJson, repairJson, scanBalancedObject, stripMarkdownFences } from './utils/jsonExtractor.js';
import { sendMessage } from './adapter.js';
import { CAMPAIGN_PREMISE_MAX_LENGTH } from '../config/contentLimits.js';
import { liveWorldFacts } from '../engine/worldFacts.js';

// Whitespace-collapse + trim + optional clamp (omit the max to keep the full
// text), type-strict — the engine's own shelf since 2026-10-02.
import { cleanText } from '../engine/text.js';

export { cleanText };

/**
 * One compact chat-message projection for director context payloads
 * (2026-08-31 P2 — frontAftermath and regionalFronts carried private copies).
 * Hidden, deleted, and system rows drop; content clamps to `maxChars`.
 */
export function compactMessage(message, maxChars = 900) {
    if (!message || message.hidden || message.deleted || !['user', 'assistant'].includes(message.role)) return null;
    const content = cleanText(message.content, maxChars);
    return content ? { role: message.role, content } : null;
}

/**
 * THE gate of a marker-keyed background director (2026-10-03 audit: four
 * `shouldGenerate*` functions were the same four-term test): its one-shot
 * marker is pending, the campaign has an id, a DM key exists, and no fight is
 * live. Each director passes its own (typed) marker.
 */
export function isDirectorReady(state, marker) {
    return !!(marker && state?.session?.id && state.settings?.apiKey && !state.combat?.active);
}

/**
 * THE director call (six `sendMessage` bodies were one): the DM's own
 * provider / key / model — creative work, not extraction — an empty history,
 * the context as the one user message, and the anchored parse. Returns the
 * parsed object; each director sanitizes its own shape.
 */
export async function runDirector(state, { prompt, context, anchor, label, temperature = 0.7, errors }) {
    const response = await sendMessage({
        provider: state.settings.llmProvider,
        apiKey: state.settings.apiKey,
        model: state.settings.model,
        systemPrompt: prompt,
        messageHistory: [],
        userMessage: JSON.stringify(context),
        temperature, // creative invention, inside a strict JSON schema
    });
    return parseDirectorJson(response, anchor, label, errors);
}

/** The hero as every director sees them: who, never what they carry or can do. */
export function directorHero(character) {
    const hero = character || {};
    return {
        name: cleanText(hero.name, 100),
        race: cleanText(hero.race, 60),
        class: cleanText(hero.class, 60),
        level: hero.level || 1,
    };
}

/**
 * The canon projections every living-world director ships, with ONE default
 * set of numbers. Each lane used to own a copy and the copies drifted (facts
 * −30 × 500 vs −20 × 400, quests −10 × 400 / −6 × 240 / −8 × 240, journal
 * −6 × 1000 vs −4 × 800); a lane that needs a wider window now says so at its
 * call site, with its reason. `journal: 0` omits the journal key.
 */
export const DIRECTOR_CONTEXT_DEFAULTS = Object.freeze({
    facts: 20, factChars: 400,
    quests: 8, questChars: 240,
    journal: 4, journalChars: 800,
});

export function baseDirectorContext(state, overrides = {}) {
    const limits = { ...DIRECTOR_CONTEXT_DEFAULTS, ...overrides };
    return {
        campaignPremise: cleanText(state.session?.premise, CAMPAIGN_PREMISE_MAX_LENGTH),
        hero: directorHero(state.character),
        canonicalWorldFacts: liveWorldFacts(state.worldFacts).slice(-limits.facts).map(fact => ({
            category: cleanText(fact.category, 60),
            fact: cleanText(fact.fact, limits.factChars),
        })),
        // Journal entries have only summary/keyDecisions/consequences/location —
        // the old title/content projection shipped `title: ""` every time and
        // documented a schema that isn't real (2026-08-31 P2).
        ...(limits.journal > 0 && {
            journal: (state.journal || []).slice(-limits.journal).map(entry => ({
                summary: cleanText(entry.summary, limits.journalChars),
            })),
        }),
        activeQuests: (state.quests || [])
            .filter(quest => !['completed', 'failed'].includes(quest.status))
            .slice(-limits.quests)
            .map(quest => ({
                name: cleanText(quest.name, 120),
                description: cleanText(quest.description, limits.questChars),
            })),
    };
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
    // Whole-object fallback (2026-09-16 scribe P1): an anchor list is a schema
    // ASSUMPTION, and the Scribe's own prompt says "omit empty/unknown fields"
    // — a turn with an NPC update, a relocation, and a six-silver payment but
    // no durable fact came back without `world_facts` and parsed to null, so
    // NOTHING dispatched (the payment audit included). When the reply IS the
    // object (the machinery's "Output ONLY the JSON" contract), read it whole.
    if (!extracted) {
        const cleaned = stripMarkdownFences(text).trim();
        if (!cleaned.startsWith('{')) return null;
        const end = scanBalancedObject(cleaned, 0);
        extracted = { json: end > 0 ? cleaned.slice(0, end) : cleaned, startIndex: 0 };
    }
    const parsed = parseObjectJson(extracted.json, label);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
}

function parseObjectJson(json, label) {
    try {
        return JSON.parse(json);
    } catch {
        try {
            const parsed = JSON.parse(repairJson(json));
            console.warn(`[${label}] JSON repaired before parsing.`);
            return parsed;
        } catch (e) {
            console.warn(`[${label}] JSON parse failed after repair:`, e.message);
            return null;
        }
    }
}
