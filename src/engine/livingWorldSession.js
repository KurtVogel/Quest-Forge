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
import { sanitizeRelationshipBeat } from './relationshipArc.js';
import { sanitizeHeroTellBeat } from './heroTells.js';
import { sanitizePendingWonder, sanitizeWonder } from './wonder.js';
import { sanitizeDirectorFailures } from './directorRetry.js';
import { sanitizeHeroDeath } from './heroDeath.js';

const HEARSAY_GRADES = ['firsthand', 'secondhand', 'legend'];

/** Why the Chronicle tab suggests a close: a front's fall, or the hero's death (2026-09-30). */
export const CHAPTER_CLOSE_REASONS = Object.freeze(['front', 'death']);

function text(value, max) {
    if (typeof value !== 'string') return '';
    return value.replace(/\s+/g, ' ').trim().slice(0, max);
}

function finiteIndex(value) {
    const n = Number(value);
    return Number.isFinite(n) ? Math.max(0, Math.round(n)) : null;
}

/** A finite, floored, non-negative stamp, clamped to the transcript when the caller knows its length. */
function finiteStamp(value, maxMessageCount) {
    const n = Number(value);
    if (!Number.isFinite(n)) return null;
    const floored = Math.max(0, Math.floor(n));
    return Number.isFinite(maxMessageCount) ? Math.min(floored, Math.max(0, Math.floor(maxMessageCount))) : floored;
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

/**
 * The Chronicle tab's ceremony nudge (2026-09-13 audit P2): ChronicleTab
 * renders `title` as a React child, and an object title survived LOAD_GAME
 * straight into the Journal panel's boundary. Complete-or-null.
 */
export function sanitizeChapterCloseSuggested(raw) {
    if (!isRecord(raw)) return null;
    // `reason` is whitelisted (the last chapter, 2026-09-30): absent = 'front',
    // the pre-2026-09-30 shape. A front nudge needs its frontId; a death nudge
    // carries the hero's name as its title.
    const reason = raw.reason === undefined ? 'front' : raw.reason;
    if (!CHAPTER_CLOSE_REASONS.includes(reason)) return null;
    const frontId = text(raw.frontId, 120);
    const title = text(raw.title, 160);
    if (!title) return null;
    if (reason === 'front' && !frontId) return null;
    const at = Number(raw.at);
    const out = { reason, title, at: Number.isFinite(at) ? at : null };
    if (frontId) out.frontId = frontId;
    return out;
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
 * The front director's marker, projected to the keys that have a READER
 * (2026-10-02 hidden-fronts Lap-4): `generationVersion` is the one generation
 * flag (a rich web landed — generation or the v2 upgrade), `lastJournalEnd` /
 * `lastCadenceId` are the cadence watermarks, `lastEmergentCadenceId` the
 * emergent-front one-shot. A legacy marker's `version` (three writers, two
 * meanings), `source`, `generatedAt`, `upgradedAt`, `contextCounts`,
 * `lastProcessedAt` and `lastAppliedCount` had no reader and are dropped.
 */
export function sanitizeFrontDirector(raw) {
    if (!isRecord(raw)) return null;
    const next = {};
    const generationVersion = finiteStamp(raw.generationVersion);
    if (generationVersion) next.generationVersion = generationVersion;
    if (raw.lastJournalEnd !== undefined) next.lastJournalEnd = finiteStamp(raw.lastJournalEnd) ?? 0;
    for (const key of ['lastCadenceId', 'lastEmergentCadenceId']) {
        if (typeof raw[key] === 'string' && raw[key]) next[key] = raw[key].slice(0, 160);
    }
    return next;
}

/**
 * Re-type the living-world sub-objects on a loaded `session`. Keys the save
 * never carried stay absent (no `null` is minted for a field that was
 * undefined) so healthy legacy saves round-trip byte-identically.
 */
export function sanitizeLivingWorldSession(session, { maxMessageCount } = {}) {
    if (!isRecord(session)) return session;
    const next = { ...session };
    const fields = [
        ['absenceDrift', sanitizeAbsenceDriftState],
        ['regionalHearsay', sanitizeRegionalHearsayState],
        ['pendingAbsenceDrift', sanitizePendingAbsenceDrift],
        ['pendingRegionalFronts', sanitizePendingRegionalFronts],
        ['pendingFrontAftermath', sanitizePendingFrontAftermath],
        ['chapterCloseSuggested', sanitizeChapterCloseSuggested],
        // NPC initiative window (2026-09-13 overhaul): complete-or-null.
        ['relationshipBeat', sanitizeRelationshipBeat],
        // The hero-tell window (2026-09-23): complete-or-null.
        ['heroTellBeat', sanitizeHeroTellBeat],
        // The wonder die (2026-09-18): the request marker and the chosen hook.
        ['pendingWonder', sanitizePendingWonder],
        ['wonder', sanitizeWonder],
        // The front director's marker (2026-10-02): readers' keys only.
        ['frontDirector', sanitizeFrontDirector],
    ];
    // The three beat cooldowns clamp to the transcript (2026-09-24 sweep):
    // a stamp past the end (`1e9`) used to survive LOAD_GAME and silence
    // that beat forever, since `messageCount - last < cooldown` holds for
    // any negative difference.
    for (const field of ['lastWonderMessage', 'lastHeroTellBeatMessage', 'lastRelationshipBeatMessage']) {
        if (session[field] === undefined) continue;
        next[field] = finiteStamp(session[field], maxMessageCount);
    }
    // The hero's death stamp (the last chapter, 2026-09-30): complete-or-null,
    // `atMessage` clamped to the transcript like the beat cooldowns.
    if (session.heroDeath !== undefined) {
        next.heroDeath = sanitizeHeroDeath(session.heroDeath, { maxMessageCount });
    }
    // The directors' give-up tally (2026-09-20): known names, typed entries.
    if (session.directorFailures !== undefined) {
        next.directorFailures = sanitizeDirectorFailures(session.directorFailures, { maxMessageCount });
    }
    for (const [field, sanitize] of fields) {
        if (session[field] === undefined) continue;
        next[field] = sanitize(session[field]);
    }
    return next;
}
