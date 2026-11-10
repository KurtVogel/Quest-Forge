/**
 * Shared helpers for the living-world director family (frontDirector,
 * frontUpgrade, frontAftermath, absenceDrift, regionalFronts)
 * and the Scribe-side machinery modules. Every director receives its answer
 * as prose-wrapped JSON and used to carry a private copy of the same
 * extract→parse→repair→throw dance plus a private cleanText (2026-08-19
 * audit: six copies of the dance, eight of cleanText) — one implementation,
 * one test surface.
 */
import { extractLlmJson, parseJsonText, parseLlmJson } from './utils/jsonExtractor.js';
import { sendMessage } from './adapter.js';
import { dmCallConfig } from './machinery.js';
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
        ...dmCallConfig(state.settings),
        systemPrompt: prompt,
        messageHistory: [],
        userMessage: JSON.stringify(context),
        temperature, // creative invention, inside a strict JSON schema
        // ONE request per attempt (2026-11-09 living-world P2): the failure
        // ledger (`engine/directorRetry.js`) is this lane's retry, with a
        // backoff in play. The adapter's default two retries under it made a
        // marker whose reply never parsed cost up to nine DM-model requests.
        maxRetries: 0,
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

/**
 * A record's place in a message window, by its STAMP (never by its words): a
 * fact's birth (`atMessage`), a journal entry's closing row (`messageRange`).
 * With no window every record passes; inside one, an unstamped (legacy)
 * record does not — it cannot be placed.
 */
function inMessageWindow(stamp, { asOfMessage, afterMessage }) {
    const hasCeiling = Number.isFinite(asOfMessage);
    const hasFloor = Number.isFinite(afterMessage);
    if (!hasCeiling && !hasFloor) return true;
    if (!Number.isFinite(stamp)) return false;
    return (!hasCeiling || stamp <= asOfMessage) && (!hasFloor || stamp > afterMessage);
}

/**
 * `asOfMessage` / `afterMessage` (2026-11-09 living-world P2) select facts and
 * journal entries by stamp before the newest-N cut: a lane asked about a place
 * the hero LEFT reads canon as of the departure, where plain recency hands it
 * the absence (measured: 20 of 20 facts about the road, none about the place).
 */
export function baseDirectorContext(state, overrides = {}) {
    const limits = { ...DIRECTOR_CONTEXT_DEFAULTS, ...overrides };
    const facts = liveWorldFacts(state.worldFacts).filter(fact => inMessageWindow(fact?.atMessage, limits));
    const journal = (state.journal || []).filter(entry => inMessageWindow(entry?.messageRange?.[1], limits));
    return {
        campaignPremise: cleanText(state.session?.premise, CAMPAIGN_PREMISE_MAX_LENGTH),
        hero: directorHero(state.character),
        canonicalWorldFacts: (limits.facts > 0 ? facts.slice(-limits.facts) : []).map(fact => ({
            category: cleanText(fact.category, 60),
            fact: cleanText(fact.fact, limits.factChars),
        })),
        // Journal entries have only summary/keyDecisions/consequences/location —
        // the old title/content projection shipped `title: ""` every time and
        // documented a schema that isn't real (2026-08-31 P2).
        ...(limits.journal > 0 && {
            journal: journal.slice(-limits.journal).map(entry => ({
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
    const anchors = Array.isArray(anchorKey) ? anchorKey : [anchorKey];
    // The anchor contract is deliberate here (required lists, not omit rules):
    // no whole-object fallback, so a reply without the schema's list is
    // "missing", not an empty install.
    const extracted = extractLlmJson(response, { anchors });
    if (!extracted) throw new Error(missingMessage || `The ${label} response did not contain ${anchors[0]}.`);
    const value = parseJsonText(extracted.json);
    if (value === undefined || value === null || typeof value !== 'object') throw new Error(malformedMessage || `The ${label} response was malformed.`);
    return value;
}

/**
 * Non-throwing sibling of parseDirectorJson for the fire-and-forget Scribe
 * passes (per-turn extraction, cadence reflection), whose failure contract is
 * "log and quietly do nothing" rather than an error surface. Returns the
 * parsed object, or null when no JSON exists or repair fails.
 *
 * Whole-object fallback (2026-09-16 scribe P1): an anchor list is a schema
 * ASSUMPTION, and the Scribe's own prompt says "omit empty/unknown fields"
 * — a turn with an NPC update, a relocation, and a six-silver payment but
 * no durable fact came back without `world_facts` and parsed to null, so
 * NOTHING dispatched (the payment audit included). When the reply IS the
 * object (the machinery's "Output ONLY the JSON" contract), read it whole.
 * The walk itself is jsonExtractor's ONE (2026-10-11).
 */
export function tryParseDirectorJson(response, anchorKey, label) {
    const value = parseLlmJson(response, { anchors: anchorKey, wholeObject: true, label })?.value ?? null;
    // The whole-object fallback reads "the object", never a JSON array or a
    // provider's `{ "error": … }` body (2026-11-04 scribe P2): both were inert
    // downstream but the inspector booked a pass that extracted nothing with
    // no reason. A refusal here is a logged null.
    if (Array.isArray(value)) {
        console.warn(`[${label || 'Director'}] Reply was a JSON array, not the schema object — ignored.`);
        return null;
    }
    if (value && typeof value === 'object' && 'error' in value) {
        const anchors = Array.isArray(anchorKey) ? anchorKey : [anchorKey];
        if (!anchors.some(key => key && key in value)) {
            console.warn(`[${label || 'Director'}] Reply was an error body, not the schema object — ignored.`);
            return null;
        }
    }
    return value;
}

