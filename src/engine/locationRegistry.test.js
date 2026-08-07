import { afterEach, describe, expect, it, vi } from 'vitest';
import {
    dedupeLocationRecords,
    findLocationRecord,
    getCurrentLocationRecord,
    isMintableLocationName,
    isRegionNameOnly,
    isRegistrableLocationName,
    isSameLocation,
    normalizeLocationRecord,
    upsertLocation,
    MAX_LOCATIONS,
} from './locationRegistry.js';

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
        let locations = upsertLocation([], 'Clockwork Tower', { type: 'settlement' });
        locations = upsertLocation(locations, 'Library landing, Clockwork Tower');
        expect(findLocationRecord(locations, 'clockwork tower')).toBe(0);
        expect(findLocationRecord(locations, 'the Clockwork Tower stairwell')).toBe(0);
        expect(findLocationRecord(locations, 'Sunlit Orchard')).toBe(-1);
        expect(getCurrentLocationRecord(locations, 'Clockwork Tower')?.type).toBe('settlement');
        expect(getCurrentLocationRecord(locations, null)).toBeNull();
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
