/**
 * Memory inspector capture store (dev/tuning instrument).
 *
 * A tiny module-level store — deliberately OUTSIDE game state — that records
 * what the memory machinery actually produced for the DM on the last turn:
 * curated story-memory cards (with their curation scores), RAG retrievals
 * (with cosine similarity), and the Scribe's last extraction / reflection
 * pass. ChatPanel and scribe.js compute all of this every turn and then
 * discard it the moment the prompt string is built; this store keeps the
 * latest copy so the read-only Memory Inspector panel can show it.
 *
 * Nothing here is ever persisted, serialized into saves, or read by game
 * logic. Captures are always-on and cheap (a few clipped objects per turn);
 * visibility is gated at the UI (Settings → Game toggle or ?debugMemory=1).
 * See IDEAS.md "Memory debug inspector".
 */

let snapshot = {
    lastInjection: null,
    lastScribePass: null,
    lastReflection: null,
    // Cache telemetry (memory-research M2, 2026-09-30): what each DM call
    // cost and how much of its prompt the provider served from cache.
    lastUsage: null,
    usageHistory: [],
    providerNotes: [],
};

/** DM-call usage rows kept for the inspector's trend column. */
export const USAGE_HISTORY_CAP = 24;

const listeners = new Set();

function publish(patch) {
    snapshot = { ...snapshot, ...patch };
    for (const listener of listeners) listener();
}

function clip(text, max = 240) {
    return String(text || '').replace(/\s+/g, ' ').trim().slice(0, max);
}

function round(score) {
    return Number.isFinite(score) ? Number(score.toFixed(3)) : null;
}

/** What the DM received this turn: RAG hits + curated callback cards, with scores. */
export function captureInjection({ playerMessage, location, retrieved = [], curated = [], record = null, receipt = null } = {}) {
    publish({
        lastInjection: {
            at: Date.now(),
            playerMessage: clip(playerMessage),
            location: clip(location, 120),
            // The recall dossier's lines on a "remember when…" turn (2026-09-18).
            record: Array.isArray(record) ? record.slice(0, 16).map(line => clip(line, 400)) : null,
            // The receipt ("From the record for X: 1 journal entry · …") —
            // inspector-only since 2026-09-21.
            receipt: typeof receipt === 'string' && receipt.trim() ? clip(receipt, 400) : null,
            retrieved: (retrieved || []).slice(0, 12).map(memory => ({
                text: clip(memory.text),
                category: memory.category || 'unknown',
                score: round(memory.score),
                location: clip(memory.location, 80) || null,
                // Per-row retrieval hits this session (engine-stamped in
                // vectorMemory, never a survival rule — M2, 2026-09-30).
                hits: Number.isFinite(memory.hits) ? memory.hits : null,
            })),
            curated: (curated || []).slice(0, 12).map(card => ({
                id: card.id || null,
                type: card.type || 'callback',
                subject: clip(card.subject, 80),
                text: clip(card.text),
                salience: card.salience ?? null,
                emotionalCharge: card.emotionalCharge ?? null,
                score: round(card.score),
                lastUsedAt: card.lastUsedAt || null,
            })),
        },
    });
}

/** Summary of the Scribe's last completed per-turn extraction pass. */
export function captureScribePass({ facts = [], npcsUpdated = [], cards = [], playerAppearance = false, location = null, lootAudited = false, paymentAudited = false, gearAudited = false } = {}) {
    publish({
        lastScribePass: {
            at: Date.now(),
            facts: facts.map(fact => clip(typeof fact === 'string' ? fact : fact?.fact)),
            npcsUpdated: npcsUpdated.map(name => clip(name, 80)),
            cards: cards.map(card => ({ type: card?.type || 'callback', subject: clip(card?.subject, 80), text: clip(card?.text) })),
            playerAppearance: !!playerAppearance,
            location: clip(location, 120) || null,
            lootAudited: !!lootAudited,
            paymentAudited: !!paymentAudited,
            gearAudited: !!gearAudited,
        },
    });
}

/** Summary of the last journal-cadence NPC/front reflection pass. */
export function captureReflection({ cadenceId = null, npcsUpdated = [], frontAdvances = [], cards = [], tempoDirective = null, frontProposal = null } = {}) {
    publish({
        lastReflection: {
            at: Date.now(),
            cadenceId: clip(cadenceId, 80) || null,
            npcsUpdated: npcsUpdated.map(name => clip(name, 80)),
            frontAdvances: (frontAdvances || []).slice(0, 6).map(advance => ({
                id: clip(advance?.id, 60),
                delta: Number.isFinite(advance?.delta) ? advance.delta : 0,
                reason: clip(advance?.reason),
                symptom: clip(advance?.symptom),
            })),
            cards: (cards || []).map(card => ({ type: card?.type || 'callback', subject: clip(card?.subject, 80), text: clip(card?.text) })),
            tempoDirective: tempoDirective && typeof tempoDirective === 'object'
                ? {
                    frontId: clip(tempoDirective.front_id || tempoDirective.frontId, 60) || null,
                    maxIntensity: clip(tempoDirective.max_intensity || tempoDirective.maxIntensity, 20) || null,
                    where: clip(tempoDirective.where, 120) || null,
                    rationale: clip(tempoDirective.rationale) || null,
                }
                : null,
            frontProposal: clip(frontProposal, 90) || null,
        },
    });
}

/**
 * One DM (or machinery) call's token usage as the provider reported it —
 * `{ promptTokens, cachedTokens, outputTokens }` from the adapter's `onUsage`
 * — with the call's lane, provider and model. `cachedShare` is the fraction
 * of the prompt the provider served from its cache: the number that decides
 * whether the byte-stable prefix (DECISIONS 2026-07-18) actually caches on
 * each provider, and on OpenAI (1.25x cache WRITES since GPT-5.6) whether the
 * volatile tail is a paid write every turn.
 */
export function captureUsage({ lane = 'dm', mode = 'standard', provider = null, model = null, promptTokens = null, cachedTokens = null, outputTokens = null, thoughtTokens = null, promptChars = null } = {}) {
    const prompt = Number.isFinite(promptTokens) ? promptTokens : null;
    const cached = Number.isFinite(cachedTokens) ? cachedTokens : null;
    const row = {
        at: Date.now(),
        lane: clip(lane, 20) || 'dm',
        mode: clip(mode, 40) || 'standard',
        provider: clip(provider, 40) || null,
        model: clip(model, 80) || null,
        promptTokens: prompt,
        cachedTokens: cached,
        outputTokens: Number.isFinite(outputTokens) ? outputTokens : null,
        thoughtTokens: Number.isFinite(thoughtTokens) ? thoughtTokens : null,
        promptChars: Number.isFinite(promptChars) ? promptChars : null,
        cachedShare: prompt && cached !== null ? Number((cached / prompt).toFixed(3)) : null,
    };
    publish({
        lastUsage: row,
        usageHistory: [...snapshot.usageHistory, row].slice(-USAGE_HISTORY_CAP),
    });
}

/** A provider-side note the player should be able to read (e.g. the xAI affinity header's preflight was refused). Deduped by text. */
export function captureProviderNote(text) {
    const note = clip(text, 240);
    if (!note || snapshot.providerNotes.includes(note)) return;
    publish({ providerNotes: [...snapshot.providerNotes, note].slice(-8) });
}

export function getInspectorSnapshot() {
    return snapshot;
}

export function subscribeInspector(listener) {
    listeners.add(listener);
    return () => listeners.delete(listener);
}

/** Test helper: return the store to its initial empty state. */
export function resetInspector() {
    publish({ lastInjection: null, lastScribePass: null, lastReflection: null, lastUsage: null, usageHistory: [], providerNotes: [] });
}

/** Panel visibility: explicit Settings toggle, or a ?debugMemory=1 URL flag. */
export function isMemoryInspectorEnabled(settings) {
    if (settings?.memoryInspector) return true;
    if (typeof window === 'undefined' || !window.location) return false;
    try {
        return new URLSearchParams(window.location.search).has('debugMemory');
    } catch {
        return false;
    }
}
