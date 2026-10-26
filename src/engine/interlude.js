/**
 * The interlude — "the world turns" (WOW 2026-10-26, slice 3).
 *
 * Every bigger-picture channel we ship is routed through a character's mouth
 * (hearsay in NPC dialogue, callbacks said by someone present, tells by
 * witnesses, fronts as symptoms) and the ordinary turn's grammar is the
 * "door and a bearded guy" register by design. A good DM also zooms out —
 * rarely, at the right seam. This module owns WHEN and WHAT MATERIAL; the
 * DM owns the voice. Engine-triggered only, at seams the engine already
 * detects: crossing into a land it has not shown yet (the establishing shot,
 * read from the region profile), a hidden front's stage crossing (the
 * engine knows which portents came to pass off-screen; the passage speaks
 * their PUBLIC face, never the front), a front's conclusion a dozen rows
 * later (the world exhales), a long rest, and `OOC: interlude` on demand.
 *
 * Sourced ONLY from public material: the land's profile, passed portents as
 * news, other places' current state, a concluded front's canon outcome.
 * Never a title the player has not seen, a clock, a secret, a reproach, a
 * day count (we have no calendar and this must not grow one). Consumed by
 * the next narrative DM row; cooldown `INTERLUDE_COOLDOWN_MESSAGES`.
 */
import { cleanText, isRecord } from './text.js';
import { clampMessageStamp, conversationalDistance } from './replayLedger.js';
import { describeFrontPortents } from './fronts.js';
import { findLocationRecord, LOCATION_STATE_MAX } from './locationRegistry.js';
import { describeRegionForInterlude, findRegionProfile, REGION_NAME_MAX } from './regionProfile.js';

export const INTERLUDE_REASONS = Object.freeze(['region', 'turning', 'conclusion', 'rest', 'demand']);
/** Conversational rows between interludes (the demand ignores it). */
export const INTERLUDE_COOLDOWN_MESSAGES = 60;
/** Rows an opened interlude waits for a narrative DM row before it lapses. */
export const INTERLUDE_WINDOW_MESSAGES = 12;
/** A concluded front's interlude opens this many rows later — the world exhales after, not during. */
export const INTERLUDE_CONCLUSION_DELAY = 12;
/** The ledger of lands already given their establishing shot. */
export const INTERLUDED_REGIONS_CAP = 24;
const MATERIAL_MAX = 300;
const ELSEWHERE_PLACES = 2;
const PASSED_PORTENTS = 2;

const REQUEST_RE = /\b(?:interlude|bigger\s+picture|wider\s+world|zoom\s+out|wide\s+shot|what(?:'s| is)\s+happening\s+(?:in|around|out\s+in)\s+the\s+world)\b/i;

/** The player asking for the wide shot out of character — the one exempt case. */
export function isInterludeRequest(message) {
    return REQUEST_RE.test(String(message || ''));
}

function distance(messages, from, to) {
    if (!Number.isFinite(from) || !Number.isFinite(to) || to <= from) return 0;
    return Array.isArray(messages) ? conversationalDistance(messages, from - 1, to) : to - from;
}

/** Complete-or-null, stamps clamped to the transcript. */
export function sanitizeInterlude(raw, { maxMessageCount } = {}) {
    if (!isRecord(raw)) return null;
    const reason = INTERLUDE_REASONS.includes(raw.reason) ? raw.reason : null;
    const key = cleanText(raw.key, 200);
    const mintedAtMessage = clampMessageStamp(raw.mintedAtMessage, maxMessageCount);
    const opensAtMessage = clampMessageStamp(raw.opensAtMessage, maxMessageCount);
    if (!reason || !key || mintedAtMessage === null || opensAtMessage === null) return null;
    return {
        key,
        reason,
        mintedAtMessage,
        opensAtMessage: Math.max(mintedAtMessage, opensAtMessage),
        region: cleanText(raw.region, REGION_NAME_MAX) || null,
        frontId: cleanText(raw.frontId, 60) || null,
        title: cleanText(raw.title, 100) || null,
        material: cleanText(raw.material, MATERIAL_MAX) || null,
    };
}

/** Load twin for the lands ledger. */
export function sanitizeInterludedRegions(raw) {
    return (Array.isArray(raw) ? raw : [])
        .map(region => (typeof region === 'string' ? cleanText(region, REGION_NAME_MAX) : ''))
        .filter(Boolean)
        .slice(-INTERLUDED_REGIONS_CAP);
}

function onCooldown(session, messageCount, messages) {
    const last = session?.lastInterludeMessage;
    if (!Number.isFinite(last)) return false;
    return distance(messages, last, messageCount) < INTERLUDE_COOLDOWN_MESSAGES;
}

/**
 * Mint an interlude on the session, or return the session unchanged. The
 * cooldown is measured from the last MINT (a lapsed window still spent its
 * turn), an open interlude is never replaced except by the player's own
 * demand, and the caller gates combat. The cooldown stamp lands here.
 */
export function mintInterlude(session, {
    reason,
    messageCount = 0,
    messages = null,
    region = null,
    frontId = null,
    title = null,
    material = null,
    delay = 0,
    onDemand = false,
} = {}) {
    const base = isRecord(session) ? session : {};
    if (!INTERLUDE_REASONS.includes(reason)) return base;
    if (!onDemand && (base.interlude || onCooldown(base, messageCount, messages))) return base;
    const at = Math.max(0, Math.floor(Number(messageCount) || 0));
    const wait = Math.max(0, Math.floor(Number(delay) || 0));
    return {
        ...base,
        interlude: {
            key: `${reason}|${at}`,
            reason,
            mintedAtMessage: at,
            opensAtMessage: at + wait,
            region: cleanText(region, REGION_NAME_MAX) || null,
            frontId: cleanText(frontId, 60) || null,
            title: cleanText(title, 100) || null,
            material: cleanText(material, MATERIAL_MAX) || null,
        },
        lastInterludeMessage: at,
    };
}

/** Open: its delay has elapsed and its window has not. */
export function isInterludeOpen(interlude, messageCount, messages = null) {
    if (!isRecord(interlude)) return false;
    const opened = distance(messages, interlude.mintedAtMessage, messageCount) >= (interlude.opensAtMessage - interlude.mintedAtMessage);
    return opened && !isInterludeExpired(interlude, messageCount, messages);
}

export function isInterludeExpired(interlude, messageCount, messages = null) {
    if (!isRecord(interlude)) return true;
    return distance(messages, interlude.opensAtMessage, messageCount) > INTERLUDE_WINDOW_MESSAGES;
}

/**
 * A narrative DM row landed: an open interlude is spent (the reply carried
 * it or chose not to), a lapsed one is dropped. Same session object when
 * nothing is pending. Callers skip table-talk replies and combat rows.
 */
export function consumeInterlude(session, { messageCount = 0, messages = null } = {}) {
    if (!isRecord(session) || !session.interlude) return session;
    if (isInterludeOpen(session.interlude, messageCount, messages) || isInterludeExpired(session.interlude, messageCount, messages)) {
        return { ...session, interlude: null };
    }
    return session;
}

/** A land gets its establishing shot once. */
export function rememberInterludedRegion(list, region) {
    const name = cleanText(region, REGION_NAME_MAX);
    if (!name) return sanitizeInterludedRegions(list);
    const kept = sanitizeInterludedRegions(list).filter(known => known.toLowerCase() !== name.toLowerCase());
    return [...kept, name].slice(-INTERLUDED_REGIONS_CAP);
}

export function hasInterludedRegion(list, region) {
    const name = cleanText(region, REGION_NAME_MAX);
    return !!name && sanitizeInterludedRegions(list).some(known => known.toLowerCase() === name.toLowerCase());
}

/**
 * A hidden front's stage moved up between two front lists: the first such
 * front and the portents that came to pass with it, or null.
 */
export function detectFrontTurning(before = [], after = []) {
    const prior = new Map((Array.isArray(before) ? before : []).map(front => [front?.id, front]));
    for (const front of Array.isArray(after) ? after : []) {
        if (!front?.id || (front.status || 'active') !== 'active') continue;
        const was = prior.get(front.id);
        if (!was) continue;
        const stageBefore = Math.floor(Number(was.stage)) || 0;
        const stageAfter = Math.floor(Number(front.stage)) || 0;
        if (stageAfter <= stageBefore) continue;
        const portents = describeFrontPortents(front);
        const passed = (portents?.passed || []).slice(stageBefore, stageAfter);
        return { frontId: front.id, passed };
    }
    return null;
}

function elsewhere(locations, currentLocation) {
    const list = Array.isArray(locations) ? locations : [];
    const hereIdx = findLocationRecord(list, currentLocation);
    return list
        .map((record, idx) => ({ record, idx }))
        .filter(({ record, idx }) => idx !== hereIdx && record?.name && cleanText(record.lastState, LOCATION_STATE_MAX) && Number.isFinite(record.lastVisitedMessage))
        .sort((a, b) => b.record.lastVisitedMessage - a.record.lastVisitedMessage)
        .slice(0, ELSEWHERE_PLACES)
        .map(({ record }) => `${record.name}: ${cleanText(record.lastState, LOCATION_STATE_MAX).replace(/[.;,]\s*$/, '')}`);
}

function passedPortentsOf(fronts, { frontId = null } = {}) {
    const out = [];
    for (const front of Array.isArray(fronts) ? fronts : []) {
        if ((front?.status || 'active') !== 'active') continue;
        if (frontId && front.id !== frontId) continue;
        const portents = describeFrontPortents(front);
        for (const passed of (portents?.passed || []).slice(-PASSED_PORTENTS)) out.push(passed);
    }
    return out.slice(-PASSED_PORTENTS);
}

const OPENERS = Object.freeze({
    region: 'The hero has crossed into a land this story has not shown yet.',
    turning: 'Something in the world has moved on its own, off-screen.',
    conclusion: 'A pressure on this world has ended, and the world has had a little time to feel it.',
    rest: 'A night has passed, and the world did not stand still for it.',
    demand: 'The player has asked, out of character, for the wider world.',
});

/**
 * The private block, rendered only while the interlude is open and never in
 * combat. The material lines are the engine's; the voice is the DM's.
 */
export function buildInterludeBlock(interlude, {
    messageCount = 0,
    messages = null,
    combatActive = false,
    regions = {},
    locations = [],
    currentLocation = null,
    fronts = [],
} = {}) {
    if (combatActive || !isInterludeOpen(interlude, messageCount, messages)) return '';
    const material = [];
    if (interlude.reason === 'region' && interlude.region) {
        const profile = findRegionProfile(regions, interlude.region);
        const land = profile ? describeRegionForInterlude(interlude.region, profile) : '';
        material.push(land
            ? `The land: ${land}`
            : `The land: ${interlude.region} — its face is not yet on record; draw it from what the fiction has shown on arrival, and make it UNLIKE the lands before it.`);
    }
    if (interlude.reason === 'turning' || interlude.reason === 'demand') {
        const passed = interlude.reason === 'turning' && interlude.material
            ? [interlude.material]
            : passedPortentsOf(fronts, { frontId: interlude.reason === 'turning' ? interlude.frontId : null });
        for (const portent of passed) {
            material.push(`Has come to pass, somewhere off-screen (speak only its PUBLIC face — what people would have heard, as news or rumor, possibly a little wrong; never who is behind it): ${portent}.`);
        }
    }
    if (interlude.reason === 'conclusion' && interlude.title) {
        material.push(`Ended, and now canon: "${interlude.title}"${interlude.material ? ` — ${interlude.material}` : ''}. Show the world settling around that: who breathes easier or worse, what road reopens or stays shut, what people say of it.`);
    }
    for (const line of elsewhere(locations, currentLocation)) {
        material.push(`Elsewhere, as last seen: ${line}.`);
    }
    const lines = [
        '## AN INTERLUDE — THE WORLD TURNS (PRIVATE)',
        `${OPENERS[interlude.reason]} OPEN this reply with ONE set-apart passage in italics, 3–5 sentences, in the narrator's wide voice — the one place that voice is allowed: the land, the season's weather, the talk on the roads, the price of bread, what the world is doing while the hero does this. Then a blank line and the ordinary turn in its usual grammar (consequence, particular, motion, the ask).`,
        'Draw the passage ONLY from the material below and from what the fiction has already shown. Report, never reveal: no hidden names, clocks or motives, no secret anyone present could not know, no "you could have" toward the hero, and no count of days — say what CHANGED, not how long it took. Hearsay may be a little wrong.',
    ];
    if (material.length > 0) {
        lines.push('Material:', ...material.map(line => `- ${line}`));
    } else {
        lines.push('Material: nothing specific is on record — the passage is the land, the weather and the ordinary life around the hero, as the fiction has shown them.');
    }
    return lines.join('\n');
}
