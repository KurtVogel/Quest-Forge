/**
 * Location registry — canonical location records for the world-tempo system
 * (DECISIONS.md 2026-07-14).
 *
 * DM location strings drift ("Clockwork Tower" / "Library landing, Clockwork
 * Tower" / "the tower library"), so gating anything on raw `currentLocation`
 * is hopeless. This registry folds variants into canonical records via
 * meaningful-token containment (the same heuristic family as the NPC dossier
 * merge and story-memory dedupe) and carries the profile the tempo system
 * gates on: place type, intrinsic danger, and front-theater membership.
 *
 * A place's INTRINSIC danger (a ghoul-warren is dangerous because it is a
 * ghoul-warren) is separate from IMPORTED front pressure — hostile sites stay
 * hostile without any front, and a haven being violated by a front is a rare
 * high-clock story event, never texture.
 */

import { containment, coverage, tokenSet } from './textMatch.js';

export const LOCATION_TYPES = ['haven', 'settlement', 'wilderness', 'frontier', 'hostile_site'];
export const DANGER_LEVELS = ['none', 'low', 'moderate', 'high', 'deadly'];
export const MAX_LOCATIONS = 60;
const MAX_ALIASES = 6;

// Only connective filler — direction/age words ("north", "old") stay meaningful:
// North Gate and South Gate are different places.
const STOP_WORDS = new Set(['the', 'a', 'an', 'of', 'in', 'at', 'on', 'to', 'by', 'near']);

function cleanText(value, max = 120) {
    return String(value || '').replace(/\s+/g, ' ').trim().slice(0, max);
}

function locationTokens(name) {
    return tokenSet(name, { stopWords: STOP_WORDS, minLength: 3 });
}

// A place NAME is short ("Candlemire", "the old salthouse"); a scene DESCRIPTION
// is a sentence ("a miserable but solid patch of raised earth beneath the
// sprawling, dead limbs of a drowned willow tree" — a real record from the
// 2026-07-15 playtest). Descriptions may still MATCH existing records, but they
// must never mint one: the place registers when a nameable name arrives.
const MAX_NAME_CHARS = 48;
const MAX_NAME_TOKENS = 5;

/** Filler strings a model emits for "location unchanged" — never canonical places. */
const JUNK_LOCATION_RE = /^(null|none|undefined|unknown|unchanged|same|same place|no change|current location|n\/a|-+)\.?$/i;

/**
 * Boundary for a model-reported current location (Scribe extraction, journal
 * summaries — both prompts invite a literal "null" for "unchanged"): drops
 * non-strings and the filler family. Returns the trimmed usable name or null.
 */
export function sanitizeExtractedLocation(value) {
    const text = typeof value === 'string' ? value.trim() : '';
    return text && !JUNK_LOCATION_RE.test(text) ? text : null;
}

/**
 * Evidence gate for a Scribe relocation (live playtest #6): the extraction runs
 * on ONE turn of text, so any place it claims the hero now stands in must
 * actually be named there — "market square" arrived from stale model context
 * while the narration walked the hero into her aunt's chandlery, relocating
 * her and forging living-world departure stamps. More than half of the name's
 * meaningful tokens must appear in the turn's text. A colloquial partial
 * mention ("the Kettle" for "The Copper Kettle") may lose the vote — dropping
 * an update self-heals on the next turn that names the place, while a wrong
 * relocation corrupts visit stamps permanently.
 */
export function isLocationEvidencedInText(name, turnText) {
    const tokens = locationTokens(name);
    if (tokens.size === 0) return false;
    return coverage(tokens, tokenSet(turnText, { minLength: 3 })) > 0.5;
}

export function isRegistrableLocationName(name) {
    const cleaned = cleanText(name, 200);
    if (!cleaned) return false;
    return cleaned.length <= MAX_NAME_CHARS && locationTokens(cleaned).size <= MAX_NAME_TOKENS;
}

/**
 * May this name MINT a brand-new record? Registrable shape PLUS a properness
 * gate (live playtest #5: "the freezing muck", "frosted grass" minted records):
 * a canonical place name carries at least one capital-initial non-filler word —
 * the Scribe copies proper nouns verbatim, so an all-lowercase name is a scene
 * description. Same rule the region boundary adopted 2026-08-06. Deliberately
 * NOT applied to the dedupe heal or alias filtering: legacy lowercase records
 * (possibly theaters) stay canon; descriptions still MATCH existing records via
 * containment — they just never mint one.
 */
export function isMintableLocationName(name) {
    if (!isRegistrableLocationName(name)) return false;
    return cleanText(name, 200).split(/\s+/)
        .some(word => !REGION_FILLER_WORDS.has(word.toLowerCase()) && /^\p{Lu}/u.test(word));
}

/** "Library landing, Clockwork Tower" names the same place as "Clockwork Tower". */
export function isSameLocation(a, b) {
    return containment(locationTokens(a), locationTokens(b)) >= 0.99;
}

export function normalizeLocationType(value) {
    const raw = cleanText(value, 30).toLowerCase().replace(/[\s-]+/g, '_');
    return LOCATION_TYPES.includes(raw) ? raw : null;
}

export function normalizeDangerLevel(value) {
    const raw = cleanText(value, 20).toLowerCase();
    return DANGER_LEVELS.includes(raw) ? raw : null;
}

export function normalizeLocationRecord(record = {}, existing = null) {
    const name = cleanText(record.name, 120) || existing?.name;
    if (!name) return null;
    return {
        id: cleanText(record.id, 60) || existing?.id || `loc-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        name,
        aliases: [...new Set([...(existing?.aliases || []), ...((record.aliases || []).map(a => cleanText(a, 120)))].filter(Boolean))].slice(-MAX_ALIASES),
        type: normalizeLocationType(record.type) || existing?.type || null,
        danger: normalizeDangerLevel(record.danger) || existing?.danger || null,
        theaterFrontIds: [...new Set([...(existing?.theaterFrontIds || []), ...((record.theaterFrontIds || []).map(id => cleanText(id, 60)))].filter(Boolean))].slice(0, 6),
        firstSeenAt: existing?.firstSeenAt || record.firstSeenAt || Date.now(),
        lastVisitedAt: record.lastVisitedAt || Date.now(),
        // Message-index visit stamp (living-world system, DECISIONS.md 2026-08-05):
        // only SET_LOCATION passes this — profile/theater upserts keep the old
        // stamp, so "how long was the hero away" measures real presence, not
        // bookkeeping touches. Legacy records read null until first re-visit.
        lastVisitedMessage: Number.isFinite(record.lastVisitedMessage)
            ? record.lastVisitedMessage
            : (Number.isFinite(existing?.lastVisitedMessage) ? existing.lastVisitedMessage : null),
        // The broader named land this place belongs to (Scribe-classified,
        // DECISIONS.md 2026-08-05 ×2) — drives regional front seeding. The
        // FIRST fiction-established value wins: a place's region is canon, and
        // a later re-classification must not mint a phantom "new region".
        // sanitizeRegionName rejects locality junk ("the docks") at every path,
        // including load-time re-normalization of polluted saves.
        region: sanitizeRegionName(existing?.region, name) || sanitizeRegionName(record.region, name) || null,
    };
}

/**
 * Generic place-noun heads a REGION name cannot consist of alone. The first
 * live playtest (2026-08-05) had the Scribe filling `region` with localities —
 * "the docks", "the coast", "the district" — which false-triggered regional
 * front seeding. A real region name ("Rimefell Marches", "Vale of Reeds")
 * always carries at least one distinctive proper token beyond these.
 */
const GENERIC_PLACE_TOKENS = new Set([
    'dock', 'docks', 'coast', 'coastline', 'shore', 'district', 'quarter', 'ward',
    'harbor', 'harbour', 'port', 'market', 'square', 'street', 'alley', 'waterfront',
    'town', 'city', 'village', 'outskirts', 'region', 'area', 'land', 'lands',
    'north', 'south', 'east', 'west', 'countryside', 'wilds', 'wilderness',
    'hills', 'mountains', 'forest', 'woods', 'river', 'valley', 'plains', 'fields',
]);

/** Function words that carry no properness signal in a region name. */
const REGION_FILLER_WORDS = new Set(['the', 'a', 'an', 'of', 'and']);

/**
 * Urban-locality head nouns a REGION name can never END in (live playtest #8):
 * "the Chandlers' quarter" and "the Guild Quarter" carry a proper token, so the
 * all-generic test waves them through — but a region is a LAND, and no land is
 * named after a street-level subdivision. Geographic heads (hills, marches,
 * fen, vale) stay legal: "the Whispering Hills" is a perfectly good region.
 */
const URBAN_LOCALITY_HEAD_TOKENS = new Set([
    'quarter', 'quarters', 'district', 'districts', 'ward', 'wards', 'street',
    'streets', 'lane', 'lanes', 'alley', 'alleys', 'square', 'squares', 'market',
    'markets', 'dock', 'docks', 'docklands', 'wharf', 'wharves', 'harbor',
    'harbour', 'harbors', 'harbours', 'port', 'ports', 'waterfront', 'gate',
    'gates', 'bridge', 'bridges', 'row', 'plaza', 'bazaar',
]);

/**
 * Boundary for a model-reported region: must be a short NAME (≤4 meaningful
 * tokens), must not be the classified place itself, must carry at least one
 * non-generic token, AND must read as a proper name — at least one non-filler
 * word capital-initial. The second live playtest (2026-08-06) had all-lowercase
 * descriptions ("the coastal artery", "the coastal mudflats") slip past the
 * generic-token test and seed native fronts; real region names are always
 * capitalized in the fiction they come from. Returns the cleaned region or null.
 */
export function sanitizeRegionName(value, placeName = '') {
    const region = cleanText(value, 60);
    if (!region || JUNK_LOCATION_RE.test(region)) return null;
    const tokens = locationTokens(region);
    if (tokens.size === 0 || tokens.size > 4) return null;
    if (placeName && isSameLocation(region, placeName)) return null;
    if ([...tokens].every(token => GENERIC_PLACE_TOKENS.has(token))) return null;
    // A region never ends in a street-level subdivision noun — "the Chandlers'
    // quarter" is a locality inside a town, whatever its capitalization.
    const words = region.toLowerCase().split(/[^a-z0-9']+/).filter(Boolean);
    if (words.length > 0 && URBAN_LOCALITY_HEAD_TOKENS.has(words[words.length - 1])) return null;
    const hasProperToken = region.split(/\s+/)
        .some(word => !REGION_FILLER_WORDS.has(word.toLowerCase()) && /^\p{Lu}/u.test(word));
    if (!hasProperToken) return null;
    return region;
}

/**
 * Backstory-region guard (DECISIONS.md 2026-08-06, live playtest #3): a region
 * named in the hero's player-authored background is where the hero CAME FROM —
 * the Scribe kept tagging the current place with it ("the Sorrow Fen", named
 * only in a backstory confession, passed every form check, became a registry
 * region, and its native fronts starved the genuinely new region). Properness
 * validation cannot catch this: the name IS proper; only its provenance is
 * wrong. A region the campaign premise also names is real world geography and
 * is never rejected (players routinely set their background in the campaign's
 * actual home region — stripping that would poison home-region detection
 * instead). Known limitation, accepted in the design call: a backstory land
 * the campaign later genuinely visits cannot become a registry region, so it
 * never seeds native fronts — its pressures are the hero's story anyway.
 */
export function isBackstoryRegion(region, { background = '', premise = '' } = {}) {
    const core = cleanText(region, 60).replace(/^the\s+/i, '').toLowerCase();
    if (core.length < 3) return false;
    const normalize = (text) => String(text || '').toLowerCase().replace(/\s+/g, ' ');
    if (!normalize(background).includes(core)) return false;
    return !normalize(premise).includes(core);
}

/** "the Icebound Coast" and "Icebound Coast, the frozen north" are one region. */
export function isSameRegion(a, b) {
    if (!a || !b) return false;
    return containment(locationTokens(a), locationTokens(b)) >= 0.99;
}

/**
 * Is this location string exactly a known REGION's name — not a place merely
 * inside one? Token-set EQUALITY, deliberately stricter than isSameRegion's
 * containment: "Ghyll, Rimefell Marches" contains the region's tokens but IS a
 * place and must mint a record; "the Rimefell Marches" IS the region and must
 * not (live playtest #3: region names minted location records that distorted
 * canonical folding and could swallow real places via containment).
 */
export function isRegionNameOnly(locations, name) {
    const nameTokens = locationTokens(name);
    if (nameTokens.size === 0) return false;
    return collectKnownRegions(locations).some(region => {
        const regionTokens = locationTokens(region);
        return regionTokens.size === nameTokens.size
            && containment(nameTokens, regionTokens) >= 0.99;
    });
}

/** Distinct region names known to the registry (first occurrence wins). */
export function collectKnownRegions(locations = []) {
    const regions = [];
    for (const record of locations || []) {
        const region = cleanText(record?.region, 60);
        if (region && !regions.some(known => isSameRegion(known, region))) regions.push(region);
    }
    return regions;
}

/**
 * Find the registry record a free-text location string belongs to (or -1).
 *
 * Exact name/alias equality anywhere in the list beats fuzzy containment on an
 * earlier record, and containment compares against record NAMES only — matching
 * against alias token sets chains places together transitively ("Gilded Eel
 * tavern, Harrowmere" as an alias must never make the tavern claim a later
 * lookup of "Harrowmere"; the 2026-07-14 playtest found the tavern record
 * swallowing the whole town that way, shadowing the real town record forever).
 */
export function findLocationRecord(locations = [], name) {
    const target = cleanText(name, 120);
    if (!target) return -1;
    const list = locations || [];
    const lower = target.toLowerCase();
    const exact = list.findIndex(record => record
        && (record.name?.toLowerCase() === lower
            || (record.aliases || []).some(alias => alias.toLowerCase() === lower)));
    if (exact !== -1) return exact;
    return list.findIndex(record => record && isSameLocation(record.name, target));
}

/**
 * Upsert on every SET_LOCATION: an unknown place gets a new record (profile
 * arrives later from the Scribe); a known place gains the variant as an alias
 * and a fresh lastVisitedAt. Never mutates its input.
 */
export function upsertLocation(locations = [], name, profile = null) {
    const target = cleanText(name, 120);
    if (!target) return locations;
    const list = Array.isArray(locations) ? locations : [];
    const idx = findLocationRecord(list, target);

    if (idx === -1) {
        // Scene descriptions never mint records — wait for a nameable name.
        if (!isMintableLocationName(target)) return list;
        const record = normalizeLocationRecord({ name: target, ...(profile || {}) });
        if (list.length < MAX_LOCATIONS) return [...list, record];
        // Evict the least-recently-visited NON-THEATER record. The old FIFO
        // slice evicted by first-seen order, so the founding town — the
        // likeliest theater — went first, and that front's intensity clamp
        // silently stopped applying everywhere (2026-08-02 audit). Theaters
        // are only evictable if every record is one.
        const evictable = list.filter(r => !(r.theaterFrontIds || []).length);
        const pool = evictable.length ? evictable : list;
        const lastTouch = r => r.lastVisitedAt || r.firstSeenAt || 0;
        const victim = pool.reduce((oldest, r) => (lastTouch(r) < lastTouch(oldest) ? r : oldest));
        return [...list.filter(r => r !== victim), record];
    }

    const existing = list[idx];
    // The shorter phrasing is the better canonical name ("Clockwork Tower"
    // over "Library landing, Clockwork Tower"); the longer becomes an alias.
    // But only a NAME-level match may rename the record — a variant that only
    // matched via a stored alias keeps the existing canonical name, otherwise
    // a composite alias ("Gilded Eel tavern, Harrowmere") lets the town name
    // rename the tavern record out from under itself.
    const nameLevelMatch = existing.name.toLowerCase() === target.toLowerCase()
        || isSameLocation(existing.name, target);
    // A bare region name may fold INTO a place record as an alias but never
    // rename it: "Rimefell Marches" is shorter than "Ghyll, Rimefell Marches",
    // and the shorter-wins rule let the region steal the town's canonical name
    // (live playtest #3 — the arrival town lost its record to its region).
    const keepExistingName = !nameLevelMatch
        || existing.name.length <= target.length
        || isRegionNameOnly(list, target);
    const merged = normalizeLocationRecord({
        ...(profile || {}),
        name: keepExistingName ? existing.name : target,
        aliases: existing.name.toLowerCase() === target.toLowerCase()
            ? []
            : [keepExistingName ? target : existing.name],
        lastVisitedAt: Date.now(),
    }, existing);
    return list.map((record, i) => (i === idx ? merged : record));
}

/**
 * Do two registry records plausibly name the same PLACE CLUSTER — a shop on a
 * street, a district of a town, a landing in a tower? Nested places fragment
 * into separate records whenever containment folding can't see the kinship
 * ("Tallow Lane" vs "E. Duskwell, Tallow & Tapers"), so any shared meaningful
 * token across their name+alias pools counts as related. Used to stop absence
 * drift from firing for a street the hero spent all morning ON because only its
 * child-shop record was being stamped (live playtest #7). Deliberately loose:
 * a false "related" merely skips one flavor beat, a false "unrelated" narrates
 * weeks of off-screen change for a place the hero never left.
 */
export function areRelatedPlaces(a, b) {
    const pool = (record) => {
        const tokens = new Set();
        for (const text of [record?.name, ...(record?.aliases || [])]) {
            for (const token of locationTokens(text)) tokens.add(token);
        }
        return tokens;
    };
    const poolA = pool(a);
    for (const token of pool(b)) {
        if (poolA.has(token)) return true;
    }
    return false;
}

/** The record for the hero's current location, if the registry knows it. */
export function getCurrentLocationRecord(locations = [], currentLocation) {
    const idx = findLocationRecord(locations, currentLocation);
    return idx === -1 ? null : locations[idx];
}

/**
 * Save-load heal: fold records that ended up with the same canonical name
 * (pre-fix saves could grow a shadowed duplicate — see findLocationRecord).
 * Keeps the earliest record's id/firstSeenAt, merges aliases and theaters,
 * prefers known type/danger over null, and keeps the latest lastVisitedAt.
 * Then strips any alias that exactly equals ANOTHER record's canonical name —
 * pre-fix alias chaining could leave "Harrowmere" as an alias of the tavern,
 * shadowing the real town record on every exact lookup.
 */
export function dedupeLocationRecords(locations = []) {
    const mergeInto = (kept, record) => normalizeLocationRecord({
        aliases: [record.name, ...(record.aliases || [])].filter(a => isRegistrableLocationName(a)),
        type: kept.type || record.type,
        danger: kept.danger || record.danger,
        theaterFrontIds: record.theaterFrontIds,
        lastVisitedAt: Math.max(kept.lastVisitedAt || 0, record.lastVisitedAt || 0),
    }, kept);

    // Pass 1: fold exact same-named duplicates.
    const byName = new Map();
    for (const record of locations || []) {
        if (!record?.name) continue;
        const key = record.name.toLowerCase();
        const kept = byName.get(key);
        byName.set(key, kept ? mergeInto(kept, record) : record);
    }

    // Pass 2: fold name-level containment fragments ("the plague-shrine at a
    // ring of drowned alders" is "the shrine" — 2026-07-15 playtest husks left
    // behind by renames), then drop scene-description records that match
    // nothing: they were junk the moment they were minted.
    const kept = [];
    for (const record of byName.values()) {
        const matchIdx = kept.findIndex(other => isSameLocation(other.name, record.name));
        if (matchIdx !== -1) {
            // Keep the shorter (better canonical) name of the pair.
            const other = kept[matchIdx];
            const keeper = other.name.length <= record.name.length ? other : record;
            const folded = keeper === other ? record : other;
            kept[matchIdx] = mergeInto(keeper, folded);
            continue;
        }
        if (!isRegistrableLocationName(record.name)) continue;
        // Pure-noise legacy heal (live playtest #7): pre-mint-gate saves carry
        // lowercase scene-fragment records ("the causeway", "the freezing muck")
        // whose stale visit stamps feed false absence drift and registry churn.
        // The 2026-08-07 "legacy lowercase records stay canon" call protected
        // possible THEATERS — so only records carrying nothing at all (no
        // theater, no profile, no region) are dropped.
        if (!isMintableLocationName(record.name)
            && !(record.theaterFrontIds || []).length
            && !record.type && !record.danger && !record.region) continue;
        kept.push(record);
    }

    const names = new Set(kept.map(record => record.name.toLowerCase()));
    return kept.map(record => {
        const cleaned = (record.aliases || []).filter(alias => {
            const lower = alias.toLowerCase();
            return lower === record.name.toLowerCase() || !names.has(lower);
        });
        return cleaned.length === (record.aliases || []).length
            ? record
            : { ...record, aliases: cleaned };
    });
}
