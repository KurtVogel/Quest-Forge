/**
 * The blob split's pure half, on its own (2026-10-04 audit: the module was
 * covered only through persistence.js and cloudSync.js). One lane table, one
 * extract fold, one restore fold — read by both storage paths.
 */
import { describe, expect, it } from 'vitest';
import { BLOB_LANES, MAX_LANE_REFS, collectLaneRefs, extractLanes, restoreLanes, typedLaneRefs } from './portraitStore.js';

const portrait = (seed) => `data:image/jpeg;base64,${String(seed).repeat(3000)}`;

function makeState() {
    return {
        character: { name: 'Astra', portraitUrl: portrait('H'), portraitProvider: 'xai', portraitUpdatedAt: 5 },
        npcs: [
            { id: 'n1', name: 'Tammo', portraitUrl: portrait('T'), portraitProvider: 'gemini', portraitUpdatedAt: 9 },
            { id: 'n2', name: 'Ilse', portraitUrl: 'https://image.pollinations.ai/prompt/ilse' }, // a plain URL stays inline
            { id: 'n3', name: 'Twin', portraitUrl: portrait('T') }, // same bytes, one blob
        ],
        chronicle: [
            { id: 'ch-1', title: 'Chapter 1', text: 'The road bent north.', fromIndex: 0, toIndex: 9 },
            { id: 'ch-2', title: 'Chapter 2', text: 'The river took the bridge.', fromIndex: 10, toIndex: 19 },
        ],
        messages: [{ id: 'm1', role: 'user', content: 'Hello' }],
    };
}

const lookupFrom = (lanes) => {
    const byLane = new Map(lanes.map(lane => [lane.id, lane.blobs]));
    return (lane, key) => byLane.get(lane.id)?.get(key);
};

describe('extractLanes / restoreLanes', () => {
    it('moves every lane’s bytes out, lists the refs, and round-trips to the original state', () => {
        const state = makeState();
        const { state: slim, lanes } = extractLanes(state);
        expect(lanes.map(lane => lane.id)).toEqual(BLOB_LANES.map(lane => lane.id));
        const [portraits, chapters] = lanes;
        expect(portraits.refs).toHaveLength(2); // hero + one shared NPC picture
        expect(chapters.refs).toHaveLength(2);
        const stored = JSON.stringify(slim);
        expect(stored).not.toContain('base64');
        expect(stored).not.toContain('The road bent north');
        expect(stored).toContain('pollinations'); // a prompt URL is not a blob
        expect(slim.chronicle[0]).toMatchObject({ id: 'ch-1', title: 'Chapter 1', fromIndex: 0, toIndex: 9 });
        for (const lane of lanes) lane.refs.forEach(ref => expect(ref).toMatch(lane.keyPattern));

        expect(restoreLanes(slim, lookupFrom(lanes))).toEqual(state);
        expect(state.character.portraitUrl).toBe(portrait('H')); // non-mutating
    });

    it('collectLaneRefs names what a stored payload needs, lane by lane, and only lanes that need anything', () => {
        const { state: slim, lanes } = extractLanes(makeState());
        const wanted = collectLaneRefs(slim);
        expect(wanted.map(entry => entry.lane.id)).toEqual(['portraits', 'chronicleChapters']);
        wanted.forEach((entry, i) => expect(new Set(entry.refs)).toEqual(new Set(lanes[i].refs)));
        expect(collectLaneRefs({ character: { name: 'Bare' }, npcs: [], chronicle: [] })).toEqual([]);
        expect(collectLaneRefs(null)).toEqual([]);
    });

    it('a missing blob is a missing picture (stamps stripped) or a dropped chapter, never a ref in live state', () => {
        const { state: slim } = extractLanes(makeState());
        const restored = restoreLanes(slim, () => undefined);
        expect(restored.character).toEqual({ name: 'Astra' });
        expect(restored.npcs[0]).toEqual({ id: 'n1', name: 'Tammo' });
        expect(restored.npcs[1].portraitUrl).toContain('pollinations');
        expect(restored.chronicle).toEqual([]);
        expect(JSON.stringify(restored)).not.toMatch(/portraitRef|chapterRef/);
    });

    it('a lane never answers another lane’s key', () => {
        const { state: slim, lanes } = extractLanes(makeState());
        const crossed = (lane, key) => lanes.find(other => other.id !== lane.id).blobs.get(key);
        const restored = restoreLanes(slim, crossed);
        expect(restored.character.portraitUrl).toBeUndefined();
        expect(restored.chronicle).toEqual([]);
    });

    it('a non-object payload passes through untouched', () => {
        expect(extractLanes(null).state).toBeNull();
        expect(restoreLanes('junk', () => undefined)).toBe('junk');
    });
});

describe('collectLaneRefs is TYPED and BOUNDED (2026-10-30 audit P2: the rehydrate read any string as a ref)', () => {
    const validRef = (i) => `p-${i.toString(36).padStart(4, '0')}-${(i * 7).toString(36).padStart(5, '0')}-abc12`;

    it('drops a ref that is not a key of the lane\'s shape and caps the list at MAX_LANE_REFS, deduped', () => {
        const [portraits] = BLOB_LANES;
        const state = {
            character: { name: 'Astra', portraitRef: '../../x', portraitProvider: 'xai', portraitUpdatedAt: 5 },
            npcs: [
                ...Array.from({ length: 600 }, (_, i) => ({ id: `n${i}`, name: `N ${i}`, portraitRef: validRef(i) })),
                { id: 'dup', name: 'Dup', portraitRef: validRef(0) }, // the same key twice is one read
                { id: 'junk-1', name: 'J1', portraitRef: 'users/u2/portraits/p-1-1-1' }, // a path, not a key
                { id: 'junk-2', name: 'J2', portraitRef: 'p-' + 'z'.repeat(40) }, // over-long segments
                { id: 'junk-3', name: 'J3', portraitRef: 'c-1-1-1' }, // the OTHER lane's key shape
            ],
        };
        const wanted = collectLaneRefs(state);
        expect(wanted).toHaveLength(1);
        expect(wanted[0].lane.id).toBe('portraits');
        expect(wanted[0].refs).toHaveLength(MAX_LANE_REFS);
        expect(MAX_LANE_REFS).toBe(512);
        wanted[0].refs.forEach(ref => expect(ref).toMatch(portraits.keyPattern));
        expect(wanted[0].refs).not.toContain('../../x');
        expect(wanted[0].refs).not.toContain('c-1-1-1');
        expect(new Set(wanted[0].refs).size).toBe(wanted[0].refs.length);
        // Both storage paths read only this list, so the junk ref is never fetched; its record then
        // restores as a missing picture (stamps stripped), never a ref in live state.
        const restored = restoreLanes(state, () => undefined);
        expect(restored.character).toEqual({ name: 'Astra' });
        expect(JSON.stringify(restored)).not.toContain('portraitRef');
    });

    it('a payload with only junk refs names no lane at all — zero reads on either path', () => {
        expect(collectLaneRefs({ character: { portraitRef: '../../x' }, npcs: [{ portraitRef: 7 }, { portraitRef: '' }], chronicle: [{ chapterRef: 'p-1-1-1' }] })).toEqual([]);
    });

    it('typedLaneRefs is the one typing for a metadata claim list and a payload\'s refs', () => {
        const [portraits, chapters] = BLOB_LANES;
        expect(typedLaneRefs(['p-1-1-1', 'p-1-1-1', 'c-1-1-1', 7, null, '../../x'], portraits)).toEqual(['p-1-1-1']);
        expect(typedLaneRefs(['p-1-1-1', 'c-1-1-1'], chapters)).toEqual(['c-1-1-1']);
        expect(typedLaneRefs('p-1-1-1', portraits)).toEqual([]);
        expect(typedLaneRefs(Array.from({ length: 600 }, (_, i) => validRef(i)), portraits)).toHaveLength(MAX_LANE_REFS);
    });
});
