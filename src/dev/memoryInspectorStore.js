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
};

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
export function captureInjection({ playerMessage, location, retrieved = [], curated = [] } = {}) {
    publish({
        lastInjection: {
            at: Date.now(),
            playerMessage: clip(playerMessage),
            location: clip(location, 120),
            retrieved: (retrieved || []).slice(0, 12).map(memory => ({
                text: clip(memory.text),
                category: memory.category || 'unknown',
                score: round(memory.score),
                location: clip(memory.location, 80) || null,
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
export function captureScribePass({ facts = [], npcsUpdated = [], cards = [], playerAppearance = false, location = null, lootAudited = false, paymentAudited = false } = {}) {
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

export function getInspectorSnapshot() {
    return snapshot;
}

export function subscribeInspector(listener) {
    listeners.add(listener);
    return () => listeners.delete(listener);
}

/** Test helper: return the store to its initial empty state. */
export function resetInspector() {
    publish({ lastInjection: null, lastScribePass: null, lastReflection: null });
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
