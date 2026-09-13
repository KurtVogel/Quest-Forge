import { afterEach, describe, expect, it, vi } from 'vitest';
import {
    areRelatedPlaces,
    dedupeLocationRecords,
    findLocationRecord,
    findPlaceRecordByName,
    getCurrentLocationRecord,
    groupPlacesByRegion,
    listVisitedPlaces,
    describeTravelLink,
    isDirectionEvidencedInText,
    linkLocations,
    listKnownWays,
    normalizeTravelDirection,
    normalizeTravelLink,
    seedTravelLinksFromTrail,
    MAX_LINKS_PER_LOCATION,
    isLocationEvidencedInText,
    isMintableLocationName,
    isRegionEvidenced,
    isRegionNameOnly,
    isRegistrableLocationName,
    isSameLocation,
    resolvePlaceNamedRegion,
    sanitizeRegionName,
    normalizeLocationRecord,
    upsertLocation,
    MAX_LOCATIONS,
} from './locationRegistry.js';

describe('place-named regions (2026-08-20 playtest §5c: districts tagged region "Ashford" / "The Coast Road")', () => {
    it('sanitizeRegionName rejects travel-way heads — a road is a route through lands, never a land', () => {
        expect(sanitizeRegionName('The Coast Road')).toBeNull();
        expect(sanitizeRegionName("the King's Highway")).toBeNull();
        expect(sanitizeRegionName('the Karok Pass')).toBeNull();
        expect(sanitizeRegionName('the Old Ford')).toBeNull();
        // Geographic heads stay legal regions.
        expect(sanitizeRegionName('the Sundered Coast')).toBe('the Sundered Coast');
        expect(sanitizeRegionName('the Whispering Hills')).toBe('the Whispering Hills');
    });

    it('findPlaceRecordByName matches by token equality, never containment', () => {
        const town = normalizeLocationRecord({ name: 'Ashford', type: 'haven', region: 'Veyrmoor' });
        const fen = normalizeLocationRecord({ name: 'the Veyrmoor Fen', type: 'wilderness' });
        expect(findPlaceRecordByName([town, fen], 'ashford')).toBe(town);
        // "Veyrmoor" is contained in the fen's name but is not the fen.
        expect(findPlaceRecordByName([town, fen], 'Veyrmoor')).toBeNull();
    });

    it('resolvePlaceNamedRegion substitutes the named place\'s own region (district → town → land)', () => {
        const town = normalizeLocationRecord({ name: 'Ashford', type: 'haven', region: 'Veyrmoor' });
        expect(resolvePlaceNamedRegion([town], 'Ashford')).toBe('Veyrmoor');
    });

    it('resolvePlaceNamedRegion nulls a region naming a region-less place-scale record', () => {
        const town = normalizeLocationRecord({ name: 'Cold Harbor', type: 'settlement' });
        expect(resolvePlaceNamedRegion([town], 'Cold Harbor')).toBeNull();
    });

    it('an UNCLASSIFIED record named after a genuine region does not eat the proposal', () => {
        // Early campaigns can mint "The Veyrmoor" as a location record before any
        // region is known; the real land must survive that stale record.
        const stale = normalizeLocationRecord({ name: 'The Veyrmoor' });
        expect(resolvePlaceNamedRegion([stale], 'Veyrmoor')).toBe('Veyrmoor');
    });

    it('keeps a proposal naming no known place, and excludes the profiled record itself', () => {
        const town = normalizeLocationRecord({ name: 'Ashford', type: 'haven', region: 'Veyrmoor' });
        expect(resolvePlaceNamedRegion([town], 'the Harchwold')).toBe('the Harchwold');
        expect(resolvePlaceNamedRegion([town], 'Ashford', { excludeId: town.id })).toBe('Ashford');
    });

    it('sub-place records prove a name is a settlement even with no record of its own (playtest #10)', () => {
        // Live 2026-08-22: the Scribe tagged an inn with region "Stonebridge"
        // while the town had no record — only "The Stonebridge market square"
        // existed. The sub-place is the evidence: the region proposal dies.
        const square = normalizeLocationRecord({ name: 'The Stonebridge market square' });
        expect(resolvePlaceNamedRegion([square], 'Stonebridge')).toBeNull();
    });

    it('a sub-place with its own region hands the settlement its land (district → town → land)', () => {
        const square = { ...normalizeLocationRecord({ name: 'The Stonebridge market square' }), region: 'Marrowdal' };
        expect(resolvePlaceNamedRegion([square], 'Stonebridge')).toBe('Marrowdal');
    });

    it('geographic remainders are NOT settlement evidence — "Marrowdal valley" proves a land', () => {
        const valley = normalizeLocationRecord({ name: 'Marrowdal valley', type: 'wilderness' });
        expect(resolvePlaceNamedRegion([valley], 'Marrowdal')).toBe('Marrowdal');
    });

    it('dedupeLocationRecords heals place-named regions from pre-fix saves', () => {
        const town = normalizeLocationRecord({ name: 'Ashford', type: 'haven', region: 'Veyrmoor' });
        const district = { ...normalizeLocationRecord({ name: 'The Guildhall archives', type: 'haven' }), region: 'Ashford' };
        const healed = dedupeLocationRecords([town, district]);
        expect(healed.find(r => r.name === 'The Guildhall archives').region).toBe('Veyrmoor');
        expect(healed.find(r => r.name === 'Ashford').region).toBe('Veyrmoor');
    });
});

describe('settlementScale (2026-08-20 playtest: type flip settlement → haven must not re-fold districts)', () => {
    it('a settlement re-profiled as haven keeps its scale and its districts keep their own records', () => {
        let locations = upsertLocation([], 'Cold Harbor', { type: 'settlement' });
        locations = upsertLocation(locations, 'Cold Harbor', { type: 'haven' });
        expect(locations[0].type).toBe('haven'); // fiction may change a place's nature
        expect(locations[0].settlementScale).toBe(true); // but a town never becomes a room
        expect(findLocationRecord(locations, 'the docks of Cold Harbor')).toBe(-1);
        locations = upsertLocation(locations, 'The docks of Cold Harbor');
        expect(locations).toHaveLength(2);
    });

    it('site-scale places never gain the flag and keep the original fold', () => {
        let locations = upsertLocation([], 'Clockwork Tower', { type: 'haven' });
        expect(locations[0].settlementScale).toBe(false);
        locations = upsertLocation(locations, 'Library landing, Clockwork Tower');
        expect(locations).toHaveLength(1); // rooms and landings are still not places
    });
});

describe('isRegionEvidenced (queue P2, playtest #8 phantom regions)', () => {
    it('accepts a region named in the turn text, the premise, or a world fact', () => {
        expect(isRegionEvidenced('the Rimefell Marches', {
            turnText: 'You cross the last weir into the Rimefell Marches.',
        })).toBe(true);
        expect(isRegionEvidenced('the Harchwold', {
            premise: 'A low-fantasy tale set across the Harchwold.',
        })).toBe(true);
        expect(isRegionEvidenced('the Icebound Coast', {
            worldFacts: [{ fact: 'The Icebound Coast trade routes froze early this year.' }],
        })).toBe(true);
    });

    it('rejects a well-formed region name that appears nowhere in the fiction', () => {
        expect(isRegionEvidenced('the Rimefell Marches', {
            turnText: 'You enter the chandlery on Tallow Lane.',
            premise: 'A river town with debts.',
            worldFacts: [{ fact: 'The ferry sank in spring.' }],
        })).toBe(false);
        expect(isRegionEvidenced('the Rimefell Marches', {})).toBe(false);
    });
});

describe('isRegionNameOnly (2026-08-06 registry-noise guard)', () => {
    const locations = [
        { name: 'Aldermill', region: 'the Rimefell Marches' },
        { name: 'Saltmere', region: 'Vale of Reeds' },
    ];

    it('matches the bare region name, with or without the article', () => {
        expect(isRegionNameOnly(locations, 'the Rimefell Marches')).toBe(true);
        expect(isRegionNameOnly(locations, 'Rimefell Marches')).toBe(true);
        expect(isRegionNameOnly(locations, 'the Vale of Reeds')).toBe(true);
    });

    it('does NOT match a place merely inside a region (token equality, not containment)', () => {
        expect(isRegionNameOnly(locations, 'Ghyll, Rimefell Marches')).toBe(false);
        expect(isRegionNameOnly(locations, 'the Rimefell Marches borderlands')).toBe(false);
    });

    it('tolerates unknown names and empty registries', () => {
        expect(isRegionNameOnly(locations, 'Candlemire')).toBe(false);
        expect(isRegionNameOnly([], 'the Rimefell Marches')).toBe(false);
        expect(isRegionNameOnly(locations, '')).toBe(false);
    });
});

describe('location identity folding', () => {
    it('folds sub-location phrasings into the same place', () => {
        expect(isSameLocation('Clockwork Tower', 'Library landing, Clockwork Tower')).toBe(true);
        expect(isSameLocation('the Whispering Conservatory', 'Whispering Conservatory')).toBe(true);
        expect(isSameLocation('Sunlit Orchard', 'Whispering Conservatory')).toBe(false);
        expect(isSameLocation('', 'Clockwork Tower')).toBe(false);
    });

    it('keeps distinct named places apart even with shared generic words', () => {
        expect(isSameLocation('North Gate Tavern', 'South Gate Tavern')).toBe(false);
    });
});

describe('upsertLocation', () => {
    it('creates a record for a new place and merges variants as aliases', () => {
        let locations = upsertLocation([], 'Clockwork Tower');
        expect(locations).toHaveLength(1);
        expect(locations[0]).toMatchObject({ name: 'Clockwork Tower', type: null, danger: null });

        locations = upsertLocation(locations, 'Library landing, Clockwork Tower');
        expect(locations).toHaveLength(1);
        expect(locations[0].name).toBe('Clockwork Tower');
        expect(locations[0].aliases).toContain('Library landing, Clockwork Tower');
    });

    it('adopts the shorter phrasing as the canonical name', () => {
        let locations = upsertLocation([], 'Library landing, Clockwork Tower');
        locations = upsertLocation(locations, 'Clockwork Tower');
        expect(locations).toHaveLength(1);
        expect(locations[0].name).toBe('Clockwork Tower');
        expect(locations[0].aliases).toContain('Library landing, Clockwork Tower');
    });

    it('applies a Scribe profile without losing existing data, and clamps junk', () => {
        let locations = upsertLocation([], 'Aldermill');
        locations = upsertLocation(locations, 'Aldermill', { type: 'settlement', danger: 'low' });
        expect(locations[0]).toMatchObject({ name: 'Aldermill', type: 'settlement', danger: 'low' });

        locations = upsertLocation(locations, 'Aldermill', { type: 'volcano lair', danger: 'apocalyptic' });
        // Unknown enum values never overwrite known ones.
        expect(locations[0]).toMatchObject({ type: 'settlement', danger: 'low' });

        locations = upsertLocation(locations, 'Aldermill', { theaterFrontIds: ['front-v2-1'] });
        expect(locations[0].theaterFrontIds).toEqual(['front-v2-1']);
    });

    it('never mints a record from a scene-description string', () => {
        const description = 'a miserable but solid patch of raised earth beneath the sprawling, dead limbs of a drowned willow tree';
        expect(isRegistrableLocationName(description)).toBe(false);
        expect(isRegistrableLocationName('Candlemire')).toBe(true);
        expect(upsertLocation([], description)).toEqual([]);
        // All-lowercase short names are descriptions too (live playtest #5:
        // "the freezing muck" and "frosted grass" minted records) — a MINT
        // needs a proper capital-initial token; the registrable-shape check
        // stays lenient so legacy lowercase records survive the dedupe heal.
        expect(isMintableLocationName('the freezing muck')).toBe(false);
        expect(isMintableLocationName('frosted grass')).toBe(false);
        expect(isMintableLocationName('the old salthouse by the north locks')).toBe(false);
        expect(isMintableLocationName('The Weirs')).toBe(true);
        expect(isMintableLocationName('the docks of Karst')).toBe(true);
        expect(upsertLocation([], 'the freezing muck')).toEqual([]);
        // But descriptions still MATCH an existing record instead of vanishing.
        let locations = upsertLocation([], 'Drowned Willow tree');
        locations = upsertLocation(locations, description, { type: 'wilderness' });
        expect(locations).toHaveLength(1);
        expect(locations[0]).toMatchObject({ name: 'Drowned Willow tree', type: 'wilderness' });
    });

    it('evidence-gates a relocation on the turn text actually naming the place (live playtest #6)', () => {
        const shopTurn = 'I walk down Tallow Lane to my aunt\'s chandlery.\nThe bell above the shop door chimes as you step inside the chandlery.';
        // "market square" came from stale model context — neither word is in the turn.
        expect(isLocationEvidencedInText('market square', shopTurn)).toBe(false);
        expect(isLocationEvidencedInText('Tallow Lane', shopTurn)).toBe(true);
        // Majority vote: a compound name partially present passes...
        expect(isLocationEvidencedInText('The Gilded Eel taproom', 'The Gilded Eel is warm and loud.')).toBe(true);
        // ...but a bare half does not ("the Kettle" alone cannot place "The Copper Kettle").
        expect(isLocationEvidencedInText('Copper Kettle', 'You warm your hands at the Kettle.')).toBe(false);
        expect(isLocationEvidencedInText('Weatherby', 'You walk through Weatherby\'s gates.')).toBe(true);
        expect(isLocationEvidencedInText('', 'any text')).toBe(false);
        expect(isLocationEvidencedInText('Weatherby', '')).toBe(false);
    });

    it('caps the registry and ignores empty names', () => {
        let locations = [];
        for (let i = 0; i < MAX_LOCATIONS + 10; i++) {
            locations = upsertLocation(locations, `Distinct Hamlet Number${i}`);
        }
        expect(locations).toHaveLength(MAX_LOCATIONS);
        expect(upsertLocation(locations, '   ')).toBe(locations);
    });

    it('never evicts a theater record while non-theaters exist (2026-08-02 queue P2)', () => {
        // The old FIFO slice dropped the founding town — the likeliest theater —
        // first, silently disabling that front's intensity clamp everywhere.
        let locations = [normalizeLocationRecord({
            name: 'Founding Town', theaterFrontIds: ['front-1'], lastVisitedAt: 1,
        })];
        for (let i = 0; i < MAX_LOCATIONS + 5; i++) {
            locations = upsertLocation(locations, `Distinct Hamlet Number${i}`);
        }
        expect(locations).toHaveLength(MAX_LOCATIONS);
        expect(locations.some(r => r.name === 'Founding Town')).toBe(true);
    });

    it('evicts the least-recently-visited record, not the first-seen one', () => {
        // Monotonic clock: real Date.now ties at ms resolution inside a loop.
        let tick = 1000;
        vi.spyOn(Date, 'now').mockImplementation(() => ++tick);
        let locations = [];
        for (let i = 0; i < MAX_LOCATIONS; i++) {
            locations = upsertLocation(locations, `Distinct Hamlet Number${i}`);
        }
        // Revisit the oldest record so it becomes the freshest.
        locations = upsertLocation(locations, 'Distinct Hamlet Number0');
        locations = upsertLocation(locations, 'Brand New Village');
        expect(locations.some(r => r.name === 'Distinct Hamlet Number0')).toBe(true);
        expect(locations.some(r => r.name === 'Distinct Hamlet Number1')).toBe(false); // now the stalest
        expect(locations.some(r => r.name === 'Brand New Village')).toBe(true);
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });
});

describe('lookup', () => {
    it('finds records by name, alias, or containment and returns the current record', () => {
        // A site-scale record (tower, tavern, ruin): rooms and landings fold in.
        let locations = upsertLocation([], 'Clockwork Tower', { type: 'frontier' });
        locations = upsertLocation(locations, 'Library landing, Clockwork Tower');
        expect(findLocationRecord(locations, 'clockwork tower')).toBe(0);
        expect(findLocationRecord(locations, 'the Clockwork Tower stairwell')).toBe(0);
        expect(findLocationRecord(locations, 'Sunlit Orchard')).toBe(-1);
        expect(getCurrentLocationRecord(locations, 'Clockwork Tower')?.type).toBe('frontier');
        expect(getCurrentLocationRecord(locations, null)).toBeNull();
    });

    it('a classified settlement never absorbs its own districts (queue P2, playtest #7)', () => {
        let locations = upsertLocation([], 'Weatherby', { type: 'settlement' });
        // Sub-places of a TOWN mint their own records instead of folding in.
        locations = upsertLocation(locations, 'Guild Quarter, Weatherby');
        expect(locations).toHaveLength(2);
        expect(locations.some(r => r.name === 'Guild Quarter, Weatherby')).toBe(true);
        // The bare town name still resolves to the town record.
        expect(locations[findLocationRecord(locations, 'Weatherby')].name).toBe('Weatherby');
        // The cluster stays kin for drift/hearsay purposes.
        expect(areRelatedPlaces(locations[0], locations[1])).toBe(true);
        // An UNCLASSIFIED town (type null) keeps the legacy fold until its
        // first location_profile lands.
        let untyped = upsertLocation([], 'Millhaven');
        untyped = upsertLocation(untyped, 'Market Square, Millhaven');
        expect(untyped).toHaveLength(1);
        expect(untyped[0].aliases).toContain('Market Square, Millhaven');
    });

    it('the load-time dedupe never re-folds a district into its settlement', () => {
        const deduped = dedupeLocationRecords([
            { id: 'town', name: 'Weatherby', type: 'settlement', aliases: [] },
            { id: 'lane', name: 'Tallow Lane, Weatherby', type: null, aliases: [] },
        ]);
        expect(deduped).toHaveLength(2);
        expect(deduped.some(r => r.name === 'Tallow Lane, Weatherby')).toBe(true);
    });

    it('normalizeLocationRecord rejects nameless records', () => {
        expect(normalizeLocationRecord({})).toBeNull();
    });

    it('prefers an exact name match over an earlier fuzzy containment match', () => {
        // Playtest 2026-07-14: the tavern's composite alias must not shadow the town.
        let locations = upsertLocation([], 'The Gilded Eel');
        locations = upsertLocation(locations, 'Gilded Eel tavern, Harrowmere');
        locations = upsertLocation(locations, 'Harrowmere');
        expect(locations).toHaveLength(2);
        expect(locations[0].name).toBe('The Gilded Eel');
        expect(locations[1].name).toBe('Harrowmere');
        expect(findLocationRecord(locations, 'Harrowmere')).toBe(1);
        // Containment matches record names only — never chains through aliases.
        expect(findLocationRecord(locations, 'Back streets of Harrowmere')).toBe(1);
    });

    it('never renames a record from a variant that only matched via an alias', () => {
        let locations = upsertLocation([], 'The Gilded Eel');
        locations = upsertLocation(locations, 'Gilded Eel tavern, Harrowmere');
        // Exact alias lookup of the composite still hits the tavern but must not
        // adopt a new canonical name from it.
        locations = upsertLocation(locations, 'Gilded Eel tavern, Harrowmere');
        expect(locations).toHaveLength(1);
        expect(locations[0].name).toBe('The Gilded Eel');
    });
});

describe('dedupeLocationRecords', () => {
    it('folds same-named duplicates, merging aliases, theaters, and profiles', () => {
        const older = normalizeLocationRecord({
            id: 'loc-a', name: 'Harrowmere', aliases: ['The Gilded Eel'],
            theaterFrontIds: ['front-v2-1'], firstSeenAt: 100, lastVisitedAt: 200,
        });
        const newer = normalizeLocationRecord({
            id: 'loc-b', name: 'harrowmere', type: 'settlement', danger: 'moderate',
            firstSeenAt: 300, lastVisitedAt: 900,
        });
        const deduped = dedupeLocationRecords([older, newer]);
        expect(deduped).toHaveLength(1);
        expect(deduped[0]).toMatchObject({
            id: 'loc-a', name: 'Harrowmere', type: 'settlement', danger: 'moderate',
            theaterFrontIds: ['front-v2-1'], firstSeenAt: 100, lastVisitedAt: 900,
        });
        expect(deduped[0].aliases).toContain('The Gilded Eel');
    });

    it('leaves distinct places untouched', () => {
        const a = normalizeLocationRecord({ name: 'Harrowmere' });
        const b = normalizeLocationRecord({ name: 'Tanelorn' });
        expect(dedupeLocationRecords([a, b])).toHaveLength(2);
    });

    it('folds name-level containment fragments into the shorter canonical record', () => {
        // 2026-07-15 playtest: a rename left "the plague-shrine at a ring of
        // drowned alders" stranded next to "the shrine".
        const shrine = normalizeLocationRecord({
            name: 'the shrine', type: 'hostile_site', danger: 'deadly',
        });
        const husk = normalizeLocationRecord({
            name: 'the plague-shrine at a ring of drowned alders', theaterFrontIds: ['front-v2-1'],
        });
        const healed = dedupeLocationRecords([shrine, husk]);
        expect(healed).toHaveLength(1);
        expect(healed[0].name).toBe('the shrine');
        expect(healed[0].theaterFrontIds).toEqual(['front-v2-1']);
        expect(healed[0]).toMatchObject({ type: 'hostile_site', danger: 'deadly' });
    });

    it('drops scene-description records that match nothing', () => {
        const junk = normalizeLocationRecord({
            name: 'a miserable but solid patch of raised earth beneath the sprawling, dead limbs of a drowned willow tree',
        });
        const town = normalizeLocationRecord({ name: 'Vellastad' });
        const healed = dedupeLocationRecords([junk, town]);
        expect(healed).toHaveLength(1);
        expect(healed[0].name).toBe('Vellastad');
    });

    it('strips aliases that shadow another record\'s canonical name', () => {
        // Pre-fix chaining left "Harrowmere" as an alias of the salthouse record,
        // hijacking every exact lookup of the town.
        const salthouse = normalizeLocationRecord({
            name: 'salthouse', aliases: ['Harrowmere', 'the old salthouse'], theaterFrontIds: ['front-v2-1'],
        });
        const town = normalizeLocationRecord({ name: 'Harrowmere', type: 'settlement' });
        const healed = dedupeLocationRecords([salthouse, town]);
        expect(healed).toHaveLength(2);
        expect(healed[0].aliases).toEqual(['the old salthouse']);
        expect(healed[0].theaterFrontIds).toEqual(['front-v2-1']);
        expect(findLocationRecord(healed, 'Harrowmere')).toBe(1);
    });
});

describe('areRelatedPlaces (live playtest #7 nested-place kinship)', () => {
    it('relates a street to a shop on it through a shared name token', () => {
        const street = normalizeLocationRecord({ name: 'Tallow Lane' });
        const shop = normalizeLocationRecord({ name: 'E. Duskwell, Tallow & Tapers' });
        expect(areRelatedPlaces(street, shop)).toBe(true);
    });

    it('relates through aliases, not just canonical names', () => {
        const town = normalizeLocationRecord({
            name: 'Weatherby',
            aliases: ['E. Duskwell — Tallow & Tapers, Tallow Lane, Weatherby'],
        });
        const street = normalizeLocationRecord({ name: 'Tallow Lane' });
        expect(areRelatedPlaces(town, street)).toBe(true);
    });

    it('keeps genuinely distinct places unrelated', () => {
        const street = normalizeLocationRecord({ name: 'Tallow Lane' });
        const fen = normalizeLocationRecord({ name: 'The Weirs', aliases: ['The Weirs, Sallow Fen'] });
        expect(areRelatedPlaces(street, fen)).toBe(false);
        expect(areRelatedPlaces(street, null)).toBe(false);
    });
});

describe('dedupeLocationRecords pure-noise legacy heal (live playtest #7)', () => {
    it('drops pre-mint-gate scene fragments carrying nothing', () => {
        const junk1 = normalizeLocationRecord({ name: 'the freezing muck', lastVisitedMessage: 39 });
        const junk2 = normalizeLocationRecord({ name: 'the causeway', lastVisitedMessage: 28 });
        const real = normalizeLocationRecord({ name: 'Tallow Lane' });
        const healed = dedupeLocationRecords([junk1, junk2, real]);
        expect(healed.map(r => r.name)).toEqual(['Tallow Lane']);
    });

    it('keeps lowercase legacy records that are theaters or carry a profile', () => {
        const theater = normalizeLocationRecord({ name: 'the drowned barrow', theaterFrontIds: ['front-v2-2'] });
        const profiled = normalizeLocationRecord({ name: 'the eel-weirs', type: 'wilderness' });
        const healed = dedupeLocationRecords([theater, profiled]);
        expect(healed.map(r => r.name)).toEqual(['the drowned barrow', 'the eel-weirs']);
    });
});

describe('sanitizeRegionName urban-locality heads (playtest #8: "the Chandlers\' quarter" became a region)', () => {
    it('rejects proper-cased names whose head noun is a street-level subdivision', () => {
        expect(sanitizeRegionName("the Chandlers' quarter")).toBeNull();
        expect(sanitizeRegionName('the Guild Quarter')).toBeNull();
        expect(sanitizeRegionName('River Wharves')).toBeNull();
        expect(sanitizeRegionName('the Lantern District')).toBeNull();
        expect(sanitizeRegionName('Weatherby Market Square')).toBeNull();
    });

    it('keeps real region names with geographic heads', () => {
        expect(sanitizeRegionName('the Whispering Hills')).toBe('the Whispering Hills');
        expect(sanitizeRegionName('the Harchwold')).toBe('the Harchwold');
        expect(sanitizeRegionName('the Sallow Fen')).toBe('the Sallow Fen');
        expect(sanitizeRegionName('Vale of Reeds')).toBe('Vale of Reeds');
    });
});

describe('listVisitedPlaces / groupPlacesByRegion (player-facing Places tab, 2026-08-30)', () => {
    const stamp = (record, lastVisitedMessage) => ({ ...record, lastVisitedMessage });

    it('includes only visited records: theater-only records never reach the projection', () => {
        const town = stamp(normalizeLocationRecord({ name: 'Ashford', type: 'settlement', region: 'Veyrmoor' }), 12);
        // A tempo directive placed a symptom here — the hero has never been.
        const theater = normalizeLocationRecord({ name: 'The Sunken Chapel', theaterFrontIds: ['front-1'] });
        const places = listVisitedPlaces([town, theater], {});
        expect(places.map(p => p.name)).toEqual(['Ashford']);
    });

    it('never leaks theaterFrontIds even on a visited record (whitelist projection)', () => {
        const visited = stamp(normalizeLocationRecord({ name: 'Ashford', theaterFrontIds: ['front-1'] }), 8);
        const [place] = listVisitedPlaces([visited], {});
        expect(place).not.toHaveProperty('theaterFrontIds');
        expect(Object.keys(place).sort()).toEqual([
            'aliases', 'danger', 'firstSeenAt', 'id', 'isCurrent', 'lastVisitedAt', 'name', 'region', 'type', 'ways',
        ]);
    });

    it('counts the current location as visited even without a stamp, and flags it', () => {
        const here = normalizeLocationRecord({ name: 'The Copper Kettle' });
        const places = listVisitedPlaces([here], { currentLocation: 'the Copper Kettle' });
        expect(places).toHaveLength(1);
        expect(places[0].isCurrent).toBe(true);
    });

    it('heals legacy stamp-less records through the journal transition trail', () => {
        const legacy = normalizeLocationRecord({ name: 'Blackwater Weirs' });
        const theater = normalizeLocationRecord({ name: 'The Sunken Chapel', theaterFrontIds: ['front-1'] });
        const places = listVisitedPlaces([legacy, theater], {
            journalLocations: ['Blackwater Weirs', null, ''],
        });
        expect(places.map(p => p.name)).toEqual(['Blackwater Weirs']);
    });

    it('sorts the current place first, then by last-visit recency', () => {
        const old = { ...stamp(normalizeLocationRecord({ name: 'Ashford' }), 5), lastVisitedAt: 100 };
        const fresh = { ...stamp(normalizeLocationRecord({ name: 'Cold Harbor' }), 30), lastVisitedAt: 900 };
        const here = { ...stamp(normalizeLocationRecord({ name: 'The Copper Kettle' }), 44), lastVisitedAt: 500 };
        const places = listVisitedPlaces([old, fresh, here], { currentLocation: 'The Copper Kettle' });
        expect(places.map(p => p.name)).toEqual(['The Copper Kettle', 'Cold Harbor', 'Ashford']);
    });

    it('strips an alias that merely restates the canonical name', () => {
        const record = stamp(normalizeLocationRecord({
            name: 'Clockwork Tower',
            aliases: ['clockwork tower', 'Library landing, Clockwork Tower'],
        }), 3);
        const [place] = listVisitedPlaces([record], {});
        expect(place.aliases).toEqual(['Library landing, Clockwork Tower']);
    });

    it('groups by region with fuzzy region identity, unregioned places trailing', () => {
        const a = { name: 'Ashford', region: 'the Veyrmoor', isCurrent: false, lastVisitedAt: 3 };
        const b = { name: 'Ghyll', region: 'Veyrmoor', isCurrent: false, lastVisitedAt: 2 };
        const c = { name: 'The Copper Kettle', region: null, isCurrent: false, lastVisitedAt: 9 };
        const d = { name: 'Rimehollow', region: 'Rimefell Marches', isCurrent: false, lastVisitedAt: 1 };
        const groups = groupPlacesByRegion([c, a, b, d]);
        expect(groups.map(g => g.region)).toEqual(['the Veyrmoor', 'Rimefell Marches', null]);
        expect(groups[0].places.map(p => p.name)).toEqual(['Ashford', 'Ghyll']);
        expect(groups[2].places.map(p => p.name)).toEqual(['The Copper Kettle']);
    });

    it('tolerates empty and malformed input', () => {
        expect(listVisitedPlaces(undefined, {})).toEqual([]);
        expect(listVisitedPlaces([null, {}], { currentLocation: null })).toEqual([]);
        expect(groupPlacesByRegion(undefined)).toEqual([]);
    });
});

describe('travel links — geography as canon (2026-09-14)', () => {
    const rec = (name, extra = {}) => normalizeLocationRecord({ name, ...extra });
    const stamp = (record, lastVisitedMessage) => ({ ...record, lastVisitedMessage });

    it('normalizeTravelDirection folds prose bearings to the compass whitelist and rejects the rest', () => {
        expect(normalizeTravelDirection('North')).toBe('north');
        expect(normalizeTravelDirection('to the north-east')).toBe('northeast');
        expect(normalizeTravelDirection('NE')).toBe('northeast');
        expect(normalizeTravelDirection('southward')).toBe('south');
        expect(normalizeTravelDirection('westerly')).toBe('west');
        expect(normalizeTravelDirection('up the river')).toBe('upriver');
        expect(normalizeTravelDirection('downstream')).toBe('downriver');
        expect(normalizeTravelDirection('uphill')).toBe('up');
        expect(normalizeTravelDirection('past the mill')).toBeNull();
        expect(normalizeTravelDirection('left')).toBeNull();
        expect(normalizeTravelDirection({ direction: 'north' })).toBeNull();
        expect(normalizeTravelDirection(null)).toBeNull();
    });

    it('isDirectionEvidencedInText accepts the prose forms of a bearing and nothing else', () => {
        expect(isDirectionEvidencedInText('north', 'You ride northward at dawn.')).toBe(true);
        expect(isDirectionEvidencedInText('northeast', 'The road bends to the north-east.')).toBe(true);
        expect(isDirectionEvidencedInText('upriver', 'Two days up the river.')).toBe(true);
        expect(isDirectionEvidencedInText('downriver', 'You drift downstream.')).toBe(true);
        expect(isDirectionEvidencedInText('north', 'The road bends to the north-east.')).toBe(false); // northeast is not north
        expect(isDirectionEvidencedInText('east', 'The road bends to the north east.')).toBe(false);
        expect(isDirectionEvidencedInText('east', 'The road bends east, then north.')).toBe(true);
        expect(isDirectionEvidencedInText('south', 'Southwold is a fine town.')).toBe(false);
        expect(isDirectionEvidencedInText('west', '')).toBe(false);
        expect(isDirectionEvidencedInText('sideways', 'sideways')).toBe(false);
    });

    it('an upsert payload can never wipe or displace an existing links list', () => {
        const a = rec('Ashford');
        const b = rec('Deep Fen');
        const linked = linkLocations([a, b], a.id, b.id, { direction: 'north' });
        const wiped = normalizeLocationRecord({ name: 'Ashford', links: [] }, linked[0]);
        expect(wiped.links).toEqual(linked[0].links);
        const flooded = normalizeLocationRecord({ name: 'Ashford', links: Array.from({ length: 20 }, (_, i) => ({ id: `junk-${i}` })) }, linked[0]);
        expect(flooded.links[0]).toEqual(linked[0].links[0]);
        expect(flooded.links).toHaveLength(MAX_LINKS_PER_LOCATION);
    });

    it('normalizeTravelLink types every field and drops junk without inventing detail', () => {
        expect(normalizeTravelLink(null)).toBeNull();
        expect(normalizeTravelLink('loc-1')).toBeNull();
        expect(normalizeTravelLink({ direction: 'north' })).toBeNull(); // no id
        expect(normalizeTravelLink({ id: 'loc-2', direction: 'sideways', travelTime: { days: 2 }, route: 42, atMessage: '7' })).toEqual({
            id: 'loc-2', direction: null, travelTime: null, route: null, atMessage: null,
        });
        const long = normalizeTravelLink({ id: 'loc-2', travelTime: 'x'.repeat(100), route: 'y'.repeat(100), atMessage: 7 });
        expect(long.travelTime).toHaveLength(40);
        expect(long.route).toHaveLength(60);
        expect(long.atMessage).toBe(7);
    });

    it('normalizeLocationRecord types the links list (dedupe by id, cap, junk entries dropped)', () => {
        const record = normalizeLocationRecord({
            name: 'Ashford',
            links: [null, 'x', { id: 'a', direction: 'north' }, { id: 'a', direction: 'south' }, { direction: 'east' },
                ...Array.from({ length: 12 }, (_, i) => ({ id: `b${i}` }))],
        });
        expect(record.links).toHaveLength(MAX_LINKS_PER_LOCATION);
        expect(record.links[0]).toEqual({ id: 'a', direction: 'north', travelTime: null, route: null, atMessage: null });
        // A profile re-upsert without links keeps the existing list.
        const reprofiled = normalizeLocationRecord({ name: 'Ashford', type: 'settlement' }, record);
        expect(reprofiled.links).toEqual(record.links);
        expect(normalizeLocationRecord({ name: 'Bare', links: 'north' }).links).toEqual([]);
    });

    it('linkLocations writes both ends with the opposite bearing and never mutates its input', () => {
        const a = rec('Ashford');
        const b = rec('Deep Fen');
        const list = [a, b];
        const linked = linkLocations(list, a.id, b.id, { direction: 'north', travelTime: 'half a day', route: 'the Coast Road', atMessage: 12 });
        expect(list[0].links).toEqual([]);
        expect(linked[0].links).toEqual([{ id: b.id, direction: 'north', travelTime: 'half a day', route: 'the Coast Road', atMessage: 12 }]);
        expect(linked[1].links).toEqual([{ id: a.id, direction: 'south', travelTime: 'half a day', route: 'the Coast Road', atMessage: 12 }]);
    });

    it('linkLocations is fill-only: first-stated geography wins, blanks fill, the earliest stamp is kept', () => {
        const a = rec('Ashford');
        const b = rec('Deep Fen');
        let list = linkLocations([a, b], a.id, b.id, { atMessage: 20 }); // bare arrival edge
        list = linkLocations(list, a.id, b.id, { direction: 'north', travelTime: 'a day', atMessage: 22 });
        list = linkLocations(list, a.id, b.id, { direction: 'west', route: 'the Old Ford', atMessage: 40 });
        expect(list[0].links).toEqual([{ id: b.id, direction: 'north', travelTime: 'a day', route: 'the Old Ford', atMessage: 20 }]);
        expect(list[1].links[0]).toMatchObject({ id: a.id, direction: 'south', route: 'the Old Ford' });
        expect(list[0].links).toHaveLength(1);
    });

    it('linkLocations no-ops on an unknown id, a self-link, or one place cluster', () => {
        const town = rec('Harrowmere');
        const tavern = rec('The Gilded Eel', { aliases: ['Gilded Eel tavern, Harrowmere'] });
        const fen = rec('Deep Fen');
        const list = [town, tavern, fen];
        expect(linkLocations(list, town.id, 'nope')).toBe(list);
        expect(linkLocations(list, town.id, town.id)).toBe(list);
        expect(linkLocations(list, town.id, tavern.id, { direction: 'north' })).toBe(list); // shares a name token via alias
        expect(linkLocations(undefined, town.id, fen.id)).toEqual([]);
    });

    it('over the cap a bare link is evicted before a detailed one, oldest first', () => {
        const here = rec('Hub');
        const others = Array.from({ length: MAX_LINKS_PER_LOCATION + 1 }, (_, i) => rec(`Spoke ${i}`));
        let list = [here, ...others];
        // Spoke 0 is detailed and oldest; Spoke 1 is bare and oldest of the bare.
        list = linkLocations(list, here.id, others[0].id, { direction: 'north', atMessage: 1 });
        for (let i = 1; i < others.length; i += 1) {
            list = linkLocations(list, here.id, others[i].id, { atMessage: i + 1 });
        }
        const ids = list[0].links.map(l => l.id);
        expect(ids).toHaveLength(MAX_LINKS_PER_LOCATION);
        expect(ids).toContain(others[0].id);
        expect(ids).not.toContain(others[1].id);
    });

    it('seedTravelLinksFromTrail mints bare edges between consecutive DIFFERENT records, idempotently', () => {
        const a = rec('Ashford');
        const b = rec('Deep Fen');
        const c = rec('Rimehollow');
        const trail = ['Ashford', 'Ashford', 'the Deep Fen', 'an unknown swamp', 'Rimehollow', 'Deep Fen'];
        const once = seedTravelLinksFromTrail([a, b, c], trail);
        expect(once[0].links.map(l => l.id)).toEqual([b.id]);
        expect(once[1].links.map(l => l.id).sort()).toEqual([a.id, c.id].sort());
        expect(once[2].links.map(l => l.id)).toEqual([b.id]);
        expect(once[1].links.every(l => l.direction === null && l.atMessage === null)).toBe(true);
        expect(seedTravelLinksFromTrail(once, trail)).toEqual(once);
        expect(seedTravelLinksFromTrail(undefined, trail)).toEqual([]);
    });

    it('describeTravelLink + listKnownWays render detailed ways first and skip orphaned ids', () => {
        const here = rec('Ashford');
        const fen = rec('Deep Fen');
        const hollow = rec('Rimehollow');
        let list = [here, fen, hollow];
        list = linkLocations(list, here.id, fen.id, { atMessage: 30 });
        list = linkLocations(list, here.id, hollow.id, { direction: 'north', travelTime: 'half a day', route: 'the Coast Road', atMessage: 10 });
        list[0] = { ...list[0], links: [...list[0].links, { id: 'evicted', direction: 'east', travelTime: null, route: null, atMessage: 99 }] };
        const ways = listKnownWays(list, 'Library landing, Ashford');
        expect(ways.map(w => describeTravelLink(w, w.name))).toEqual([
            'Rimehollow (north, half a day, by the Coast Road)',
            'Deep Fen',
        ]);
        expect(listKnownWays(list, 'Nowhere')).toEqual([]);
        expect(listKnownWays(list, 'Ashford', { limit: 1 })).toHaveLength(1);
    });

    it('listVisitedPlaces projects ways toward VISITED records only — a theater-only target never renders', () => {
        const here = stamp(rec('Ashford'), 5);
        const fen = stamp(rec('Deep Fen'), 9);
        const theater = rec('The Sunken Chapel', { theaterFrontIds: ['front-1'] });
        let list = [here, fen, theater];
        list = linkLocations(list, here.id, fen.id, { direction: 'south' });
        // A hostile save could carry a link to the theater; the projection must still hide it.
        list[0] = { ...list[0], links: [...list[0].links, { id: theater.id, direction: 'north', travelTime: null, route: null, atMessage: null }] };
        const places = listVisitedPlaces(list, {});
        const ashford = places.find(p => p.name === 'Ashford');
        expect(ashford.ways).toEqual([{ id: fen.id, name: 'Deep Fen', direction: 'south', travelTime: null, route: null }]);
        expect(JSON.stringify(places)).not.toContain('Sunken Chapel');
    });

    it('dedupeLocationRecords re-aims links at a folded duplicate\'s keeper and drops dangling / self links', () => {
        const keeper = { ...rec('Clockwork Tower'), id: 'keep' };
        const dupe = { ...rec('Library landing, Clockwork Tower'), id: 'dupe' };
        const fen = { ...rec('Deep Fen'), id: 'fen', links: [{ id: 'dupe', direction: 'north' }, { id: 'keep' }, { id: 'gone' }, { id: 'fen' }] };
        const healed = dedupeLocationRecords([keeper, dupe, fen]);
        expect(healed.map(r => r.id).sort()).toEqual(['fen', 'keep']);
        expect(healed.find(r => r.id === 'fen').links).toEqual([{ id: 'keep', direction: 'north', travelTime: null, route: null, atMessage: null }]);
    });
});
