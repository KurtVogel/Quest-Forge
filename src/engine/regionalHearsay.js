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
import { listPublicTells } from './heroTells.js';

export const HEARSAY_MAX_ITEMS = 2;
/** A deed from ELSEWHERE needs this conversational age to have traveled here. */
export const HEARSAY_MIN_TRAVEL_DISTANCE = 12;
/** Beyond this conversational age, distant retellings go legend-grade. */
export const HEARSAY_LEGEND_DISTANCE = 60;
/** How long (conversational messages after arrival) the prompt line stays up. */
export const HEARSAY_WINDOW_MESSAGES = 10;
export const RECENT_HEARSAY_LIMIT = 30;
/** A deed stops TRAVELING after this many tellings (its own ground still tells it). */
export const HEARSAY_MAX_TELLINGS = 3;
/** …or once it is this old in conversational messages — stale news is no news. */
export const HEARSAY_RETIRE_DISTANCE = 200;

const GRADE_GUIDANCE = {
    firsthand: 'locals witnessed it themselves or heard it first-hand — the details they repeat are accurate',
    secondhand: 'second-hand news — mostly true, but exactly ONE concrete detail is wrong (a name, the place, the numbers, or who struck the final blow)',
    legend: 'distant folklore — names garbled or wrong, the scale exaggerated at least twofold, motives possibly inverted; the teller is confident anyway',
};

// Type-strict (2026-09-08): an object `enemies`/`resolution` on a source must
// never travel as "[object Object]" hearsay.
function cleanText(value, max = 200) {
    if (typeof value !== 'string' && !(typeof value === 'number' && Number.isFinite(value))) return '';
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

function countTellings(recentHearsay, deedKey) {
    return (Array.isArray(recentHearsay) ? recentHearsay : [])
        .filter(entry => typeof entry === 'string' && entry.startsWith(`${deedKey}|`)).length;
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
    heroTells = [],
    locations = [],
    locationName,
    messages = null,
    messageIndex = 0,
} = {}) {
    const here = cleanText(locationName, 120);
    if (!here) return { items: [], ledgerEntries: [] };
    const locKey = locationKey(locations, here);
    const hereRecord = keyToRecord(locations, locKey);

    // Candidates from every source are gathered FIRST and ranked together
    // (2026-09-20 audit P1): the old walk filled the two slots in source
    // order — resolved fronts first, in array order — and a resolved front
    // never aged out, so every new town was offered the campaign's two OLDEST
    // victories as legend forever while the fresh victory, a salience-5
    // witnessed moment, and last week's fight never traveled anywhere.
    const candidates = [];
    const consider = (source, deedKey, { local, age, text }) => {
        // A deed retires as a TRAVELING source once it has been told enough
        // or grown old; its own ground keeps telling it firsthand.
        const tellings = countTellings(recentHearsay, deedKey);
        if (!local && (age > HEARSAY_RETIRE_DISTANCE || tellings >= HEARSAY_MAX_TELLINGS)) return;
        if (ledgerHas(recentHearsay, deedKey, locKey, locations)) return;
        candidates.push({ source, deedKey, age, tellings, item: { text, grade: gradeFor({ local, age }) } });
    };

    // Campaign-scale deeds: a front the player ENDED is region-wide news.
    for (const front of Array.isArray(fronts) ? fronts : []) {
        if (front?.status !== 'resolved' || !Number.isFinite(front.resolvedAtMessage)) continue;
        // At the front's own retired theater the locals WITNESSED the ending
        // (2026-08-31 P2: hardcoded local:false had them retelling the hero's
        // victory secondhand — "one detail wrong", garbled names — about an
        // event in their own square). Firsthand there, like fights and cards.
        // resolvedTheaterIds is stamped at resolution, because resolution
        // frees the records' own theaterFrontIds for future fronts.
        const local = !!hereRecord && (front.resolvedTheaterIds || []).includes(hereRecord.id);
        const age = distanceSince(messages, front.resolvedAtMessage, messageIndex);
        if (!local && age < HEARSAY_MIN_TRAVEL_DISTANCE) continue;
        consider('front', `front:${front.id}`, {
            local,
            age,
            text: `the hero ending the pressure known as "${cleanText(front.title, 90)}"${front.resolution ? ` (${cleanText(front.resolution, 160)})` : ''}`,
        });
    }

    // Witnessed story moments (DECISIONS.md 2026-08-05 ×2): a public
    // accusation, a wedding vow, a market-square humiliation — the Scribe marks
    // `witnessed` at extraction, so non-combat deeds travel too. Secrets
    // (knownBy) never do, whatever their salience.
    const publicMoments = (Array.isArray(storyMemory) ? storyMemory : [])
        .filter(card => card && card.witnessed && card.text
            && !(Array.isArray(card.knownBy) && card.knownBy.length > 0)
            && (card.salience || 0) >= HEARSAY_MIN_CARD_SALIENCE
            && card.status !== 'dormant'
            && Number.isFinite(card.firstSeenMessage));
    for (const card of publicMoments) {
        const local = card.location ? sameSpot(locations, card.location, here) : false;
        const age = distanceSince(messages, card.firstSeenMessage, messageIndex);
        if (!local && age < HEARSAY_MIN_TRAVEL_DISTANCE) continue;
        consider('card', `card:${card.id}`, { local, age, text: cleanText(card.text, 220) });
    }

    // Fights — a battle in a market square travels; a deal in a crypt does
    // not (hostile sites have no gossiping witnesses).
    const fights = (Array.isArray(recentEncounters) ? recentEncounters : [])
        .filter(entry => entry && entry.enemies && entry.location
            && Number.isFinite(entry.messageIndex)
            && ['victory', 'defeat'].includes(entry.outcome));
    for (const fight of fights) {
        const originIdx = findLocationRecord(locations || [], fight.location);
        if (originIdx !== -1 && locations[originIdx].type === 'hostile_site') continue;
        const local = sameSpot(locations, fight.location, here);
        const age = distanceSince(messages, fight.messageIndex, messageIndex);
        if (!local && age < HEARSAY_MIN_TRAVEL_DISTANCE) continue;
        const deed = fight.outcome === 'victory'
            ? `the hero cutting down ${cleanText(fight.enemies, 120)} at ${cleanText(fight.location, 90)}`
            : `the hero being beaten and driven off by ${cleanText(fight.enemies, 120)} at ${cleanText(fight.location, 90)}`;
        consider('fight', `fight:${fight.messageIndex}`, { local, age, text: deed });
    }

    // The hero's MANNER travels too (hero tells, slice 2 — 2026-09-23): a
    // pattern people watched form before bystanders ("never draws first")
    // precedes the hero as reputation, distortion-graded like a deed. It is
    // never local (a habit has no place) and never intimate (secrets never
    // travel); its age is the last sighting, so a dropped habit stops
    // traveling with the fade.
    for (const { tell, age } of listPublicTells(heroTells, { messages, messageCount: messageIndex })) {
        if (age < HEARSAY_MIN_TRAVEL_DISTANCE) continue;
        consider('tell', `tell:${tell.id}`, {
            local: false,
            age,
            text: `the hero's known manner — ${cleanText(tell.text, 160)} (a habit people have watched, not a single deed; a teller may have seen it or only heard of it)`,
        });
    }

    // Untold news first, then freshest (stable sort: ties keep front → card →
    // fight) — so consecutive towns rotate through everything worth telling
    // instead of hearing the same two deeds. A resolved front holds at most
    // ONE slot while anything else could be told; a second front fills the
    // line only when nothing else is waiting.
    candidates.sort((a, b) => (a.tellings - b.tellings) || (a.age - b.age));
    const picked = [];
    for (const candidate of candidates) {
        if (picked.length >= HEARSAY_MAX_ITEMS) break;
        if (candidate.source === 'front' && picked.some(entry => entry.source === 'front')) continue;
        picked.push(candidate);
    }
    for (const candidate of candidates) {
        if (picked.length >= HEARSAY_MAX_ITEMS) break;
        if (!picked.includes(candidate)) picked.push(candidate);
    }
    const items = picked.map(candidate => candidate.item);
    const ledgerEntries = picked.map(candidate => `${candidate.deedKey}|${locKey}|${messageIndex}`);

    return { items, ledgerEntries };
}

/**
 * Does a live hearsay offer survive an arrival at `here` that selected nothing?
 * Intra-settlement movement (town square → its tavern) must keep the offer
 * (2026-08-31 P1 r3): the cluster rule guarantees the related arrival's own
 * selection is empty — the deeds are already ledger-burned for the whole
 * audience — so nulling on every empty selection destroyed the offer before
 * any NPC could voice it. Only arrival at an UNRELATED place drops it; the
 * render guard's location match and age window still gate display.
 */
export function hearsayOfferSurvivesArrival(regionalHearsay, locations, here) {
    const offerPlace = regionalHearsay?.locationName;
    if (!offerPlace || !here) return false;
    if (isSameLocation(offerPlace, here)) return true;
    const offerIdx = findLocationRecord(locations || [], offerPlace);
    const hereIdx = findLocationRecord(locations || [], here);
    if (offerIdx === -1 || hereIdx === -1) return false;
    return areRelatedPlaces(locations[offerIdx], locations[hereIdx]);
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
