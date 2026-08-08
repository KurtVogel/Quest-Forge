/**
 * Regional hearsay — the "traveling rumor" half of the living-world system
 * (DECISIONS.md 2026-08-05, docs/IDEAS.md "the world keeps living while
 * you're away").
 *
 * The hero's witnessed deeds propagate as hearsay whose distortion grows with
 * distance and age. The ENGINE owns truth and scheduling — it deterministically
 * selects which deeds could plausibly have reached the place the hero just
 * arrived at, and stamps each with a distortion grade. The LLM owns only the
 * garbled retelling: the prompt line tells it to play the distortion inside
 * NPC dialogue, never as narration fact.
 *
 * Deed sources are structures the engine already trusts:
 *   - resolved fronts (title + resolution epitaph — the payoff canon), which
 *     get a second life as folklore instead of a 40-message echo that expires;
 *   - the recent-encounter ledger (fights with a location + outcome). Fights
 *     at a hostile_site never travel — no witnesses in a crypt.
 *
 * Selection happens ONCE, in the reducer, on genuine arrival at a canonical
 * location record; the result rides `session.regionalHearsay` and renders for
 * a short window while the hero is still there. A pipe ledger
 * ("deedKey|locationKey|messageIndex") keeps one deed from being offered at
 * the same place twice.
 */

import { areRelatedPlaces, findLocationRecord, isSameLocation } from './locationRegistry.js';
import { distanceSince } from './worldTempo.js';

export const HEARSAY_MAX_ITEMS = 2;
/** A deed from ELSEWHERE needs this conversational age to have traveled here. */
export const HEARSAY_MIN_TRAVEL_DISTANCE = 12;
/** Beyond this conversational age, distant retellings go legend-grade. */
export const HEARSAY_LEGEND_DISTANCE = 60;
/** How long (conversational messages after arrival) the prompt line stays up. */
export const HEARSAY_WINDOW_MESSAGES = 10;
export const RECENT_HEARSAY_LIMIT = 30;

const GRADE_GUIDANCE = {
    firsthand: 'locals witnessed it themselves or heard it first-hand — the details they repeat are accurate',
    secondhand: 'second-hand news — mostly true, but exactly ONE concrete detail is wrong (a name, the place, the numbers, or who struck the final blow)',
    legend: 'distant folklore — names garbled or wrong, the scale exaggerated at least twofold, motives possibly inverted; the teller is confident anyway',
};

function cleanText(value, max = 200) {
    return String(value || '').replace(/\s+/g, ' ').trim().slice(0, max);
}

/** Stable key a location contributes to ledger entries: record id when known. */
function locationKey(locations, name) {
    const idx = findLocationRecord(locations || [], name);
    return idx === -1 ? cleanText(name, 60).toLowerCase() : locations[idx].id;
}

function sameSpot(locations, a, b) {
    if (!a || !b) return false;
    const keyA = locationKey(locations, a);
    const keyB = locationKey(locations, b);
    if (keyA && keyA === keyB) return true;
    return isSameLocation(a, b);
}

function gradeFor({ local, age }) {
    if (local) return 'firsthand';
    return age >= HEARSAY_LEGEND_DISTANCE ? 'legend' : 'secondhand';
}

/** Resolve a ledger place key (record id or raw string) back to its record. */
function keyToRecord(locations, key) {
    if (!key) return null;
    const byId = (locations || []).find(record => record?.id === key);
    if (byId) return byId;
    const idx = findLocationRecord(locations || [], key);
    return idx === -1 ? null : locations[idx];
}

function ledgerHas(recentHearsay, deedKey, locKey, locations) {
    const hereRecord = keyToRecord(locations, locKey);
    return (Array.isArray(recentHearsay) ? recentHearsay : []).some(entry => {
        if (typeof entry !== 'string' || !entry.startsWith(`${deedKey}|`)) return false;
        const rest = entry.slice(deedKey.length + 1);
        const cut = rest.lastIndexOf('|');
        const entryKey = cut === -1 ? rest : rest.slice(0, cut);
        if (entryKey === locKey) return true;
        // Cluster rule (live playtest #8): the shop, its street, and the town it
        // stands in are one gossiping audience — a deed already offered at a
        // RELATED place must not be re-offered under every nested spelling (one
        // fight was cued at nine "places" inside the same few streets).
        const entryRecord = keyToRecord(locations, entryKey);
        if (entryRecord && hereRecord) return areRelatedPlaces(entryRecord, hereRecord);
        return isSameLocation(entryRecord ? entryRecord.name : entryKey, hereRecord ? hereRecord.name : locKey);
    });
}

/**
 * Deterministically pick ≤2 deeds that could plausibly be tavern talk at the
 * place the hero just arrived. Pure; the SET_LOCATION handler wires it.
 * Returns { items, ledgerEntries } — empty items means no line this arrival.
 */
/** Salience floor for a witnessed story moment to travel as gossip. */
export const HEARSAY_MIN_CARD_SALIENCE = 4;

export function selectRegionalHearsay({
    fronts = [],
    recentEncounters = [],
    recentHearsay = [],
    storyMemory = [],
    locations = [],
    locationName,
    messages = null,
    messageIndex = 0,
} = {}) {
    const here = cleanText(locationName, 120);
    if (!here) return { items: [], ledgerEntries: [] };
    const locKey = locationKey(locations, here);
    const items = [];
    const ledgerEntries = [];

    const consider = (deedKey, item) => {
        if (items.length >= HEARSAY_MAX_ITEMS || ledgerHas(recentHearsay, deedKey, locKey, locations)) return;
        items.push(item);
        ledgerEntries.push(`${deedKey}|${locKey}|${messageIndex}`);
    };

    // Campaign-scale deeds first: a front the player ENDED is region-wide news.
    for (const front of Array.isArray(fronts) ? fronts : []) {
        if (front?.status !== 'resolved' || !Number.isFinite(front.resolvedAtMessage)) continue;
        const age = distanceSince(messages, front.resolvedAtMessage, messageIndex);
        if (age < HEARSAY_MIN_TRAVEL_DISTANCE) continue;
        consider(`front:${front.id}`, {
            text: `the hero ending the pressure known as "${cleanText(front.title, 90)}"${front.resolution ? ` (${cleanText(front.resolution, 160)})` : ''}`,
            grade: gradeFor({ local: false, age }),
        });
    }

    // Witnessed story moments next (DECISIONS.md 2026-08-05 ×2): a public
    // accusation, a wedding vow, a market-square humiliation — the Scribe marks
    // `witnessed` at extraction, so non-combat deeds travel too. Secrets
    // (knownBy) never do, whatever their salience.
    const publicMoments = (Array.isArray(storyMemory) ? storyMemory : [])
        .filter(card => card && card.witnessed && card.text
            && !(Array.isArray(card.knownBy) && card.knownBy.length > 0)
            && (card.salience || 0) >= HEARSAY_MIN_CARD_SALIENCE
            && card.status !== 'dormant'
            && Number.isFinite(card.firstSeenMessage))
        .reverse();
    for (const card of publicMoments) {
        const local = card.location ? sameSpot(locations, card.location, here) : false;
        const age = distanceSince(messages, card.firstSeenMessage, messageIndex);
        if (!local && age < HEARSAY_MIN_TRAVEL_DISTANCE) continue;
        consider(`card:${card.id}`, {
            text: cleanText(card.text, 220),
            grade: gradeFor({ local, age }),
        });
    }

    // Then fights, newest first — a battle in a market square travels; a deal
    // in a crypt does not (hostile sites have no gossiping witnesses).
    const fights = (Array.isArray(recentEncounters) ? recentEncounters : [])
        .filter(entry => entry && entry.enemies && entry.location
            && Number.isFinite(entry.messageIndex)
            && ['victory', 'defeat'].includes(entry.outcome))
        .reverse();
    for (const fight of fights) {
        const originIdx = findLocationRecord(locations || [], fight.location);
        if (originIdx !== -1 && locations[originIdx].type === 'hostile_site') continue;
        const local = sameSpot(locations, fight.location, here);
        const age = distanceSince(messages, fight.messageIndex, messageIndex);
        if (!local && age < HEARSAY_MIN_TRAVEL_DISTANCE) continue;
        const deed = fight.outcome === 'victory'
            ? `the hero cutting down ${cleanText(fight.enemies, 120)} at ${cleanText(fight.location, 90)}`
            : `the hero being beaten and driven off by ${cleanText(fight.enemies, 120)} at ${cleanText(fight.location, 90)}`;
        consider(`fight:${fight.messageIndex}`, { text: deed, grade: gradeFor({ local, age }) });
    }

    return { items, ledgerEntries };
}

export function appendHearsayLedger(recentHearsay, ledgerEntries) {
    const previous = (Array.isArray(recentHearsay) ? recentHearsay : [])
        .filter(entry => typeof entry === 'string');
    return [...previous, ...(ledgerEntries || [])].slice(-RECENT_HEARSAY_LIMIT);
}

/** Hostile-save boundary for the loaded ledger. */
export function sanitizeRecentHearsay(value) {
    return (Array.isArray(value) ? value : [])
        .filter(entry => typeof entry === 'string')
        .slice(-RECENT_HEARSAY_LIMIT);
}

/**
 * The private prompt block. Renders only while the hero is still at the
 * arrival place and the window is open; the true events remain exactly what
 * the table played — the LLM performs the distortion, never records it.
 */
export function buildRegionalHearsayBlock(regionalHearsay, { currentLocation, messages = null, messageCount = 0 } = {}) {
    if (!regionalHearsay || typeof regionalHearsay !== 'object') return '';
    const items = (Array.isArray(regionalHearsay.items) ? regionalHearsay.items : [])
        .map(item => ({ text: cleanText(item?.text, 300), grade: GRADE_GUIDANCE[item?.grade] ? item.grade : 'secondhand' }))
        .filter(item => item.text)
        .slice(0, HEARSAY_MAX_ITEMS);
    if (items.length === 0) return '';
    if (!Number.isFinite(regionalHearsay.arrivedAtMessage)) return '';
    if (!sameSpot([], regionalHearsay.locationName, currentLocation)) return '';
    if (distanceSince(messages, regionalHearsay.arrivedAtMessage, messageCount) > HEARSAY_WINDOW_MESSAGES) return '';

    const lines = [];
    lines.push('## REGIONAL HEARSAY — PRIVATE');
    lines.push('Word of the hero\'s deeds has plausibly reached this place. If an NPC would naturally gossip, boast, warn, or recognize the hero, they may have heard:');
    for (const item of items) {
        lines.push(`- ${item.text} — ${GRADE_GUIDANCE[item.grade]}.`);
    }
    lines.push('Voice this ONLY through NPC dialogue and attitudes (a greeting, a raised tankard, suspicion, a wrong detail confidently retold) — never as narrator fact. At most one mention per scene, and only where the fiction invites it; the true events remain exactly what was played. When the retelling is distorted, play the distortion straight: the teller believes their version, and correcting it is the player\'s choice.');
    return lines.join('\n');
}
