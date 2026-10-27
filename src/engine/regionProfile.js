/**
 * Region profiles — the world has LANDS, not names (WOW 2026-10-26, slice 1).
 *
 * The location registry stores a place's `region` as a bare string, and that
 * was the whole record: the one moment the engine knew a new land began (a
 * registry-new region → the regional-fronts director) was spent entirely on
 * hidden pressures, with ten messages of the OLD land as the director's only
 * texture. Vesa sailed to another continent and found the same mud, pines
 * and eyeless ghoul. This module owns the record the contrast reads from:
 * a profile per region — terrain, people, how they build, what this land's
 * dead and wilds are like, how names sound — written once, where the
 * region is born, under a hard contrast rule against every other profile.
 *
 * Stored top-level as `regions: { [name]: profile }` (persisted by
 * construction; `sanitizeRegions` is the load twin). Read by the DM prompt's
 * one `Region:` line, the scene director's setting line, the director's
 * contrast context and the interlude's establishing shot.
 */
import { cleanText, isRecord } from './text.js';
import { findLocationRecord, isSameRegion, REGION_NAME_MAX } from './locationRegistry.js';
import { clampMessageStamp, conversationalDistance } from './replayLedger.js';

/** The five faces of a land, in render order. */
export const REGION_PROFILE_FIELDS = Object.freeze(['terrain', 'people', 'built', 'dread', 'names']);
/** A profile without these is not a profile (complete-or-nothing, the director rule). */
export const REGION_PROFILE_REQUIRED = Object.freeze(['terrain', 'people', 'dread']);
/** Per-field clamp — five fields at this cap is ~700 dynamic chars per turn. */
export const REGION_PROFILE_FIELD_MAX = 120;
/** A region's name, as the readers clamp it (the registry's own constant, re-exported). */
export { REGION_NAME_MAX };
/** The record's ceiling; the oldest profile leaves first past it. */
export const MAX_REGION_PROFILES = 24;
/** How many known lands the contrast context names (newest first). */
export const MAX_CONTRAST_REGIONS = 10;

const FIELD_LABELS = Object.freeze({
    terrain: 'the land',
    people: 'its people',
    built: 'built and worn',
    dread: 'its dead and wilds',
    names: 'names here',
});

/** A sentence-ish field: trimmed, clamped, its trailing stop dropped so it joins a line. */
function field(value) {
    if (typeof value !== 'string') return '';
    const text = cleanText(value, REGION_PROFILE_FIELD_MAX);
    return text ? text.replace(/[.;,]\s*$/, '') : '';
}

/**
 * The one typing boundary for a profile from ANY lane (the director's reply,
 * the installer, the load): known keys only, string-or-drop, clamped;
 * null unless every required face is present.
 */
export function normalizeRegionProfile(raw) {
    if (!isRecord(raw)) return null;
    const profile = {};
    for (const key of REGION_PROFILE_FIELDS) {
        const value = field(raw[key]);
        profile[key] = value || null;
    }
    if (REGION_PROFILE_REQUIRED.some(key => !profile[key])) return null;
    return profile;
}

/** Load twin: a typed map of region name → profile (+ `atMessage`, clamped to the transcript). */
export function sanitizeRegions(raw, { maxMessageCount } = {}) {
    if (!isRecord(raw)) return {};
    const out = {};
    for (const [name, value] of Object.entries(raw)) {
        const region = cleanText(name, REGION_NAME_MAX);
        // A `__proto__` key would SET the accumulator's prototype through the
        // bracket write (2026-10-27 nit) — never a land's name.
        if (!region || region === '__proto__' || Object.hasOwn(out, region)) continue;
        const profile = normalizeRegionProfile(value);
        if (!profile) continue;
        const atMessage = clampMessageStamp(value?.atMessage, maxMessageCount);
        out[region] = { ...profile, atMessage: atMessage === null ? 0 : atMessage };
    }
    return trimRegions(out);
}

function trimRegions(regions) {
    const names = Object.keys(regions);
    if (names.length <= MAX_REGION_PROFILES) return regions;
    const keep = names
        .sort((a, b) => (regions[b].atMessage || 0) - (regions[a].atMessage || 0))
        .slice(0, MAX_REGION_PROFILES);
    const out = {};
    for (const name of keep) out[name] = regions[name];
    return out;
}

/** The stored key for a region name: the exact key held, else the same-region key, else null. */
export function findRegionKey(regions, name) {
    if (!isRecord(regions)) return null;
    const region = cleanText(name, REGION_NAME_MAX);
    if (!region) return null;
    if (Object.hasOwn(regions, region)) return region;
    return Object.keys(regions).find(key => isSameRegion(key, region)) || null;
}

/** The profile on record for a region (by exact key, then `isSameRegion`), or null. */
export function findRegionProfile(regions, name) {
    const key = findRegionKey(regions, name);
    return key ? regions[key] : null;
}

/**
 * Write a region's profile ONCE: a land's face is canon like a place's
 * signature — a second director run (a re-fire, a replay) never rewrites it.
 * Returns the same object when nothing changes.
 */
export function rememberRegionProfile(regions, name, rawProfile, { atMessage = 0 } = {}) {
    const base = isRecord(regions) ? regions : {};
    const region = cleanText(name, REGION_NAME_MAX);
    const profile = normalizeRegionProfile(rawProfile);
    if (!region || !profile) return base;
    if (findRegionKey(base, region)) return base;
    const stamp = Number.isFinite(Number(atMessage)) ? Math.max(0, Math.floor(Number(atMessage))) : 0;
    return trimRegions({ ...base, [region]: { ...profile, atMessage: stamp } });
}

/** Every profile with its name, newest first — the director's contrast list and the inspector's view. */
export function listRegionProfiles(regions, { limit = Infinity } = {}) {
    if (!isRecord(regions)) return [];
    return Object.entries(regions)
        .map(([name, profile]) => ({ name, ...profile }))
        .sort((a, b) => (b.atMessage || 0) - (a.atMessage || 0))
        .slice(0, limit);
}

/** The region the hero stands in: the current location record's `region`, or null. */
export function regionOfPlace(locations, currentLocation) {
    const idx = findLocationRecord(locations || [], currentLocation);
    if (idx === -1) return null;
    return cleanText(locations[idx]?.region, REGION_NAME_MAX) || null;
}

/**
 * The land the DM should read for the hero's place (the 2026-10-27 live
 * proof): the current record's own region, else the region of the most
 * recently VISITED record that has one — most places in a land are never
 * tagged by the Scribe (a cistern, a road, a tavern), and the face vanished
 * from the prompt on three of the four far-land turns. `inherited` marks the
 * fallback so the line can hedge: between a crossing and the Scribe naming
 * the new land, the last land's face is the wrong one, and the hedge says so.
 */
export function regionForPrompt(locations, currentLocation) {
    const own = regionOfPlace(locations, currentLocation);
    if (own) return { name: own, inherited: false };
    const list = Array.isArray(locations) ? locations : [];
    const hereIdx = findLocationRecord(list, currentLocation);
    let best = null;
    for (let i = 0; i < list.length; i += 1) {
        if (i === hereIdx) continue;
        const record = list[i];
        const region = cleanText(record?.region, REGION_NAME_MAX);
        if (!region || !Number.isFinite(record.lastVisitedMessage)) continue;
        if (!best || record.lastVisitedMessage > best.lastVisitedMessage) best = { name: region, lastVisitedMessage: record.lastVisitedMessage };
    }
    return best ? { name: best.name, inherited: true } : null;
}

/** The faces as `label: text` clauses, in render order, empty faces skipped. */
function faceClauses(profile) {
    return REGION_PROFILE_FIELDS
        .filter(key => profile?.[key])
        .map(key => `${FIELD_LABELS[key]}: ${profile[key]}`);
}

/**
 * The DM prompt's ONE region line, under Current location. The Scribe
 * writes the particulars; the prompt tells the DM what they are FOR: this
 * is the land every new place, person, foe and name here is drawn from.
 */
export function describeRegionLine(name, profile, { inherited = false } = {}) {
    const region = cleanText(name, REGION_NAME_MAX);
    if (!region || !profile) return '';
    const clauses = faceClauses(profile);
    if (clauses.length === 0) return '';
    const standing = inherited
        ? 'the land last named for the hero — if the fiction has since crossed into another land, that land\'s face is not yet on record and this one must NOT be reused for it'
        : 'this land\'s own face';
    return `**Region — ${region}** (${standing}; every new place, person, foe and name here is drawn from it, never from another land's): ${clauses.join('; ')}.`;
}

/** The scene director's setting line: the land and what is built in it, for the painter. */
export function describeRegionSetting(name, profile) {
    const region = cleanText(name, REGION_NAME_MAX);
    if (!region || !profile) return '';
    const parts = ['terrain', 'built'].filter(key => profile[key]).map(key => profile[key]);
    if (parts.length === 0) return '';
    return `Setting — ${region}: ${parts.join('; ')}.`;
}

/** The interlude's establishing shot: the land in full, as a report of what a traveler finds. */
export function describeRegionForInterlude(name, profile) {
    const region = cleanText(name, REGION_NAME_MAX);
    if (!region || !profile) return '';
    const clauses = faceClauses(profile);
    return clauses.length ? `${region} — ${clauses.join('; ')}.` : '';
}

/*
 * THE FACE-ATTEMPT LEDGER (2026-10-27 living-world P2, measured). The face-
 * only marker used to re-mint on every classification of a faceless land,
 * and the give-up tally keys on the MARKER's key (new per mint) — so a
 * deterministic director failure cost up to three hidden DM-model calls per
 * classified place for the whole campaign, and an INCOMPLETE reply (a
 * required face missing) cleared the marker with no tally at all. The ledger
 * is per REGION: every failed call and every reply that brought no face
 * counts, a counted land waits REGION_FACE_RETRY_DISTANCE conversational
 * rows before it is asked again, and at REGION_FACE_MAX_ATTEMPTS it stays
 * faceless by decision (the Region line simply does not render; the seed
 * call, bought for its fronts, may still bring one).
 * Stored as `session.regionFaceAttempts: [{ region, attempts, atMessage }]`.
 */
export const REGION_FACE_MAX_ATTEMPTS = 3;
export const REGION_FACE_RETRY_DISTANCE = 6;
export const REGION_FACE_LEDGER_CAP = 12;

function typeFaceAttempt(raw, maxMessageCount) {
    if (!isRecord(raw)) return null;
    const region = cleanText(raw.region, REGION_NAME_MAX);
    const attempts = Math.floor(Number(raw.attempts));
    if (!region || !Number.isFinite(attempts) || attempts < 1) return null;
    const atMessage = clampMessageStamp(raw.atMessage, maxMessageCount);
    return { region, attempts: Math.min(attempts, REGION_FACE_MAX_ATTEMPTS), atMessage: atMessage === null ? 0 : atMessage };
}

/** Load twin: typed entries, one per region, newest kept past the cap. */
export function sanitizeRegionFaceAttempts(raw, { maxMessageCount } = {}) {
    if (!Array.isArray(raw)) return [];
    const out = [];
    for (const entry of raw) {
        const typed = typeFaceAttempt(entry, maxMessageCount);
        if (!typed) continue;
        const idx = out.findIndex(held => isSameRegion(held.region, typed.region));
        if (idx !== -1) out.splice(idx, 1);
        out.push(typed);
    }
    return out.slice(-REGION_FACE_LEDGER_CAP);
}

function findFaceAttempt(list, region) {
    const name = cleanText(region, REGION_NAME_MAX);
    if (!name || !Array.isArray(list)) return null;
    return sanitizeRegionFaceAttempts(list).find(entry => isSameRegion(entry.region, name)) || null;
}

/** One more call that brought no face for this land. */
export function recordRegionFaceAttempt(list, region, { atMessage = 0 } = {}) {
    const name = cleanText(region, REGION_NAME_MAX);
    const typed = sanitizeRegionFaceAttempts(list);
    if (!name) return typed;
    const held = typed.find(entry => isSameRegion(entry.region, name));
    const kept = typed.filter(entry => entry !== held);
    const stamp = Number.isFinite(Number(atMessage)) ? Math.max(0, Math.floor(Number(atMessage))) : 0;
    const attempts = Math.min((held?.attempts || 0) + 1, REGION_FACE_MAX_ATTEMPTS);
    return [...kept, { region: held?.region || name, attempts, atMessage: stamp }].slice(-REGION_FACE_LEDGER_CAP);
}

/** This land has used every attempt: faceless by decision. */
export function isRegionFaceExhausted(session, region) {
    return (findFaceAttempt(session?.regionFaceAttempts, region)?.attempts || 0) >= REGION_FACE_MAX_ATTEMPTS;
}

/** May a face-only call be bought for this land now (not exhausted, not inside its backoff)? */
export function mayAskRegionFace(session, region, messages) {
    const entry = findFaceAttempt(session?.regionFaceAttempts, region);
    if (!entry) return true;
    if (entry.attempts >= REGION_FACE_MAX_ATTEMPTS) return false;
    const list = Array.isArray(messages) ? messages : [];
    return conversationalDistance(list, entry.atMessage - 1, list.length) >= REGION_FACE_RETRY_DISTANCE;
}

/**
 * Is a face still COMING for this land — none on record and attempts left?
 * The establishing shot waits for it (2026-10-27 P2: the shot was minted by
 * the classification that requested the face and spent before the face
 * landed, so a first crossing never showed the land).
 */
export function isRegionFaceComing(state, region) {
    if (!cleanText(region, REGION_NAME_MAX)) return false;
    if (findRegionProfile(state?.regions, region)) return false;
    return !isRegionFaceExhausted(state?.session, region);
}
