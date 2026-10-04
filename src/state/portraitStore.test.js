/**
 * The blob split's pure half, on its own (2026-10-04 audit: the module was
 * covered only through persistence.js and cloudSync.js). One lane table, one
 * extract fold, one restore fold — read by both storage paths.
 */
import { describe, expect, it } from 'vitest';
import { BLOB_LANES, collectLaneRefs, extractLanes, restoreLanes } from './portraitStore.js';

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
