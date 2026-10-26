/**
 * Region profiles (WOW 2026-10-26, slice 1): the typed record of a land's
 * face, written once, read by the prompt's Region line, the scene director's
 * setting line and the regional director's contrast list.
 */
import { describe, expect, it } from 'vitest';
import {
    MAX_REGION_PROFILES,
    REGION_PROFILE_FIELD_MAX,
    describeRegionForInterlude,
    describeRegionLine,
    describeRegionSetting,
    findRegionKey,
    findRegionProfile,
    listRegionProfiles,
    normalizeRegionProfile,
    regionOfPlace,
    rememberRegionProfile,
    sanitizeRegions,
} from './regionProfile.js';

const face = (over = {}) => ({
    terrain: 'Black shingle, sea ice to the horizon, a wind that never drops.',
    people: 'Sealers and salt-boilers who pay the Compact in oil',
    built: 'Driftwood halls roofed in turf; sealskin and bone toggles',
    dread: 'The drowned walk under the ice and knock from below',
    names: 'Short, hard, consonant-heavy — Kettu, Varra, Isk',
    ...over,
});

describe('normalizeRegionProfile — the one typing boundary', () => {
    it('keeps the five faces, clamps each, drops the terminal stop, and nulls an absent optional', () => {
        const profile = normalizeRegionProfile({ ...face({ built: undefined, names: 'x'.repeat(400) }), junk: 'no' });
        expect(profile.terrain).toBe('Black shingle, sea ice to the horizon, a wind that never drops');
        expect(profile.built).toBeNull();
        expect(profile.names).toHaveLength(REGION_PROFILE_FIELD_MAX);
        expect(Object.keys(profile).sort()).toEqual(['built', 'dread', 'names', 'people', 'terrain']);
    });

    it('is complete-or-nothing on the required faces and string-or-drop on every field', () => {
        expect(normalizeRegionProfile(face({ dread: '' }))).toBeNull();
        expect(normalizeRegionProfile(face({ people: { x: 1 } }))).toBeNull();
        expect(normalizeRegionProfile(face({ terrain: 42 }))).toBeNull();
        expect(normalizeRegionProfile('a land')).toBeNull();
        expect(normalizeRegionProfile(null)).toBeNull();
        expect(normalizeRegionProfile(face({ built: ['x'] })).built).toBeNull();
    });
});

describe('the record: written once, found by name, capped', () => {
    it('rememberRegionProfile writes a land once — a second write for the same land (any spelling) is a no-op', () => {
        const regions = rememberRegionProfile({}, 'The Icebound Coast', face(), { atMessage: 40 });
        expect(regions['The Icebound Coast']).toMatchObject({ atMessage: 40, terrain: expect.stringContaining('Black shingle') });
        const again = rememberRegionProfile(regions, 'the icebound coast', face({ terrain: 'Rewritten' }), { atMessage: 90 });
        expect(again).toBe(regions);
        // Junk writes nothing and returns the same object.
        expect(rememberRegionProfile(regions, 'New Land', { terrain: 'only' })).toBe(regions);
        expect(rememberRegionProfile(regions, '', face())).toBe(regions);
    });

    it('findRegionProfile reads the exact key first, then the same-region key', () => {
        const regions = rememberRegionProfile({}, 'The Icebound Coast', face(), { atMessage: 1 });
        expect(findRegionKey(regions, 'the Icebound Coast')).toBe('The Icebound Coast');
        expect(findRegionProfile(regions, 'The Icebound Coast')).toBe(regions['The Icebound Coast']);
        expect(findRegionProfile(regions, 'the Riverlands')).toBeNull();
        expect(findRegionProfile(null, 'x')).toBeNull();
        expect(findRegionProfile(regions, '')).toBeNull();
    });

    it('caps the record at MAX_REGION_PROFILES, the oldest leaving first; listRegionProfiles is newest first', () => {
        // Distinct meaningful tokens per land: `isSameRegion` folds digits
        // and one-letter tokens, so "Land 1" and "Land 0" would be ONE land.
        const land = i => `${'Q'}${'a'.repeat(i + 2)} Reach`;
        let regions = {};
        for (let i = 0; i < MAX_REGION_PROFILES + 3; i += 1) {
            regions = rememberRegionProfile(regions, land(i), face(), { atMessage: i });
        }
        expect(Object.keys(regions)).toHaveLength(MAX_REGION_PROFILES);
        expect(regions[land(0)]).toBeUndefined();
        expect(regions[land(2)]).toBeUndefined();
        expect(regions[land(MAX_REGION_PROFILES + 2)]).toBeTruthy();
        const listed = listRegionProfiles(regions, { limit: 2 });
        expect(listed.map(entry => entry.name)).toEqual([land(MAX_REGION_PROFILES + 2), land(MAX_REGION_PROFILES + 1)]);
        expect(listed[0]).toMatchObject({ terrain: expect.any(String), atMessage: MAX_REGION_PROFILES + 2 });
    });

    it('sanitizeRegions is the load twin: typed profiles, clamped stamps, junk entries dropped, the cap', () => {
        const loaded = sanitizeRegions({
            'The Icebound Coast': { ...face(), atMessage: 9999 },
            'Junk': { terrain: 'only' },
            '': face(),
            'The Riverlands': { ...face(), atMessage: 'x' },
        }, { maxMessageCount: 50 });
        expect(Object.keys(loaded).sort()).toEqual(['The Icebound Coast', 'The Riverlands']);
        expect(loaded['The Icebound Coast'].atMessage).toBe(50);
        expect(loaded['The Riverlands'].atMessage).toBe(0);
        expect(sanitizeRegions(null)).toEqual({});
        expect(sanitizeRegions(['x'])).toEqual({});
    });
});

describe('the readers', () => {
    const regions = rememberRegionProfile({}, 'The Icebound Coast', face(), { atMessage: 1 });

    it('regionOfPlace reads the current record\'s region', () => {
        const locations = [{ id: 'l1', name: 'Rime Quay', aliases: [], region: 'The Icebound Coast' }, { id: 'l2', name: 'Aldermill', aliases: [] }];
        expect(regionOfPlace(locations, 'Rime Quay')).toBe('The Icebound Coast');
        expect(regionOfPlace(locations, 'Aldermill')).toBeNull();
        expect(regionOfPlace(locations, 'Nowhere')).toBeNull();
    });

    it('describeRegionLine is ONE prompt line with every face and the rule it is for', () => {
        const line = describeRegionLine('The Icebound Coast', regions['The Icebound Coast']);
        expect(line.startsWith('**Region — The Icebound Coast**')).toBe(true);
        expect(line).toContain('every new place, person, foe and name here is drawn from it');
        expect(line).toContain('the land: Black shingle');
        expect(line).toContain('its dead and wilds: The drowned walk under the ice');
        expect(line).toContain('names here: Short, hard');
        expect(line.split('\n')).toHaveLength(1);
        expect(line.length).toBeLessThan(5 * REGION_PROFILE_FIELD_MAX + 260);
        expect(describeRegionLine('X', null)).toBe('');
        expect(describeRegionLine('', regions['The Icebound Coast'])).toBe('');
    });

    it('the setting line carries the terrain and the built look for the painter; the interlude line the whole face', () => {
        expect(describeRegionSetting('The Icebound Coast', regions['The Icebound Coast']))
            .toBe('Setting — The Icebound Coast: Black shingle, sea ice to the horizon, a wind that never drops; Driftwood halls roofed in turf; sealskin and bone toggles.');
        expect(describeRegionSetting('X', null)).toBe('');
        const interlude = describeRegionForInterlude('The Icebound Coast', regions['The Icebound Coast']);
        expect(interlude.startsWith('The Icebound Coast — the land:')).toBe(true);
        expect(interlude).toContain('its people:');
    });
});
