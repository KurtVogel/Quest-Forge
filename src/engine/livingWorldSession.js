/**
 * Load-boundary sanitizers for the living-world sub-objects that ride
 * `session` (2026-09-08 living-world P2): `absenceDrift`, `regionalHearsay`,
 * and the three one-shot pending markers (`pendingAbsenceDrift`,
 * `pendingRegionalFronts`, `pendingFrontAftermath`).
 *
 * `validateSaveState` passed `payload.session` through untouched, so a string
 * pending marker fired the DM-model director call for an empty place and then
 * passed the install key guard on `undefined !== undefined`; a stored
 * `frontSymptom.maxIntensity` rendered verbatim into the prompt as the
 * intensity label. Every shape here is complete-or-null: a malformed
 * sub-object loads as absent, never as a half-typed object the readers trust.
 *
 * Lives in engine/ (not llm/) so reducer handlers never import from llm/ —
 * the same rule that keeps the living-world constants in worldTempo.js.
 */
import { INTENSITY_LEVELS } from './worldTempo.js';

const HEARSAY_GRADES = ['firsthand', 'secondhand', 'legend'];

function text(value, max) {
    if (typeof value !== 'string') return '';
    return value.replace(/\s+/g, ' ').trim().slice(0, max);
}

function finiteIndex(value) {
    const n = Number(value);
    return Number.isFinite(n) ? Math.max(0, Math.round(n)) : null;
}

function isRecord(value) {
    return !!value && typeof value === 'object' && !Array.isArray(value);
}

export function sanitizeAbsenceDriftState(raw) {
    if (!isRecord(raw)) return null;
    const locationName = text(raw.locationName, 120);
    const arrivedAtMessage = finiteIndex(raw.arrivedAtMessage);
    if (!locationName || arrivedAtMessage === null) return null;
    const developments = (Array.isArray(raw.developments) ? raw.developments : [])
        .map(dev => (isRecord(dev)
            ? {
                name: text(dev.name, 100),
                agenda: text(dev.agenda, 300),
                lastNotes: text(dev.lastNotes, 400),
                visible: text(dev.visible, 240),
            }
            : null))
        .filter(dev => dev && dev.name && (dev.visible || dev.lastNotes || dev.agenda))
        .slice(0, 2);
    const symptom = isRecord(raw.frontSymptom) ? raw.frontSymptom : null;
    const frontSymptom = symptom && text(symptom.frontId, 60) && text(symptom.text, 240)
        ? {
            frontId: text(symptom.frontId, 60),
            maxIntensity: INTENSITY_LEVELS.includes(symptom.maxIntensity) ? symptom.maxIntensity : 'whispers',
            text: text(symptom.text, 240),
        }
        : null;
    return {
        locationName,
        arrivedAtMessage,
        awayDistance: finiteIndex(raw.awayDistance) ?? 0,
        developments,
        fact: text(raw.fact, 300),
        frontSymptom,
    };
}

export function sanitizeRegionalHearsayState(raw) {
    if (!isRecord(raw)) return null;
    const locationName = text(raw.locationName, 120);
    const arrivedAtMessage = finiteIndex(raw.arrivedAtMessage);
    if (!locationName || arrivedAtMessage === null) return null;
    const items = (Array.isArray(raw.items) ? raw.items : [])
        .map(item => (isRecord(item)
            ? { text: text(item.text, 300), grade: HEARSAY_GRADES.includes(item.grade) ? item.grade : 'secondhand' }
            : null))
        .filter(item => item && item.text)
        .slice(0, 4);
    if (items.length === 0) return null;
    return { locationName, arrivedAtMessage, items };
}

export function sanitizePendingAbsenceDrift(raw) {
    if (!isRecord(raw)) return null;
    const key = text(raw.key, 200);
    const locationName = text(raw.locationName, 120);
    const returnMessage = finiteIndex(raw.returnMessage);
    if (!key || !locationName || returnMessage === null) return null;
    return { key, locationName, awayDistance: finiteIndex(raw.awayDistance) ?? 0, returnMessage };
}

export function sanitizePendingRegionalFronts(raw) {
    if (!isRecord(raw)) return null;
    const key = text(raw.key, 200);
    const region = text(raw.region, 120);
    const locationName = text(raw.locationName, 120);
    if (!key || !region || !locationName) return null;
    return { key, region, locationName, atMessage: finiteIndex(raw.atMessage) ?? 0 };
}

export function sanitizePendingFrontAftermath(raw) {
    if (!isRecord(raw)) return null;
    const frontId = text(raw.frontId, 120);
    if (!frontId) return null;
    const resolvedAt = Number(raw.resolvedAt);
    return {
        frontId,
        title: text(raw.title, 160),
        resolvedAt: Number.isFinite(resolvedAt) ? resolvedAt : null,
    };
}

/**
 * Re-type the living-world sub-objects on a loaded `session`. Keys the save
 * never carried stay absent (no `null` is minted for a field that was
 * undefined) so healthy legacy saves round-trip byte-identically.
 */
export function sanitizeLivingWorldSession(session) {
    if (!isRecord(session)) return session;
    const next = { ...session };
    const fields = [
        ['absenceDrift', sanitizeAbsenceDriftState],
        ['regionalHearsay', sanitizeRegionalHearsayState],
        ['pendingAbsenceDrift', sanitizePendingAbsenceDrift],
        ['pendingRegionalFronts', sanitizePendingRegionalFronts],
        ['pendingFrontAftermath', sanitizePendingFrontAftermath],
    ];
    for (const [field, sanitize] of fields) {
        if (session[field] === undefined) continue;
        next[field] = sanitize(session[field]);
    }
    return next;
}
