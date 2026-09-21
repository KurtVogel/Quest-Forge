/**
 * The place card (WOW 2026-09-16, exploration-travel W1): a Scribe-captured
 * signature (first-stated-wins, fragment appends, rewrite never replaces) and
 * lastState (current-state replace) on the location record, three derived
 * zero-LLM projections (residents, what happened here, in-fiction visits),
 * the whitelist projection extended, and the DM prompt's one-line place card.
 */
import { describe, it, expect } from 'vitest';
import {
    LOCATION_SIGNATURE_MAX,
    LOCATION_STATE_MAX,
    dedupeLocationRecords,
    describeCurrentPlace,
    describeLastHere,
    listVisitedPlaces,
    mergePlaceSignature,
    normalizeLocationRecord,
    upsertLocation,
} from './locationRegistry.js';
import { gameReducer, initialGameState } from '../state/gameReducer.js';

const SIGNATURE = 'The mill wheel turns though the river ran dry a generation ago';

describe('normalizeLocationRecord — signature / lastState / visitCount', () => {
    it('types and clamps both texts and defaults the visit count', () => {
        const record = normalizeLocationRecord({ name: 'Rimehollow', signature: `  ${'s'.repeat(400)}  `, lastState: 'x'.repeat(400), visitCount: 2.4 });
        expect(record.signature).toHaveLength(LOCATION_SIGNATURE_MAX);
        expect(record.lastState).toHaveLength(LOCATION_STATE_MAX);
        expect(record.visitCount).toBe(2);
        const bare = normalizeLocationRecord({ name: 'Rimehollow' });
        expect(bare).toMatchObject({ signature: null, lastState: null, visitCount: 0 });
    });

    it('never stores an object as "[object Object]" (load twin: the same normalizer)', () => {
        const record = normalizeLocationRecord({ name: 'Rimehollow', signature: { text: 'x' }, lastState: ['a'], visitCount: '3' });
        expect(record).toMatchObject({ signature: null, lastState: null, visitCount: 0 });
    });

    it('first-stated signature survives a later fragment (appended) and a later rewrite (ignored)', () => {
        const first = normalizeLocationRecord({ name: 'Rimehollow', signature: SIGNATURE });
        const withFragment = normalizeLocationRecord({ signature: 'a rope bridge' }, first);
        expect(withFragment.signature).toBe(`${SIGNATURE}; a rope bridge`);
        const withRewrite = normalizeLocationRecord({ signature: 'A quiet farming village with a broken mill and a wide grey river that never quite dried' }, withFragment);
        expect(withRewrite.signature).toBe(`${SIGNATURE}; a rope bridge`);
        const untouched = normalizeLocationRecord({ type: 'settlement' }, withRewrite);
        expect(untouched.signature).toBe(`${SIGNATURE}; a rope bridge`);
    });

    it('lastState is current-state replace: a new value replaces, absence keeps', () => {
        const first = normalizeLocationRecord({ name: 'Rimehollow', lastState: 'quiet; the market full' });
        const changed = normalizeLocationRecord({ lastState: 'half-burned; the mill silent' }, first);
        expect(changed.lastState).toBe('half-burned; the mill silent');
        expect(normalizeLocationRecord({ danger: 'low' }, changed).lastState).toBe('half-burned; the mill silent');
    });

    it('visitCount: an incoming value wins, otherwise the stored one is kept', () => {
        const first = normalizeLocationRecord({ name: 'Rimehollow', visitCount: 2 });
        expect(normalizeLocationRecord({ type: 'haven' }, first).visitCount).toBe(2);
        expect(normalizeLocationRecord({ visitCount: 3 }, first).visitCount).toBe(3);
        expect(normalizeLocationRecord({ visitCount: -4 }, first).visitCount).toBe(0);
    });
});

describe('mergePlaceSignature', () => {
    it('lands the first text, appends a novel fragment, drops a restated fragment, ignores a rewrite', () => {
        expect(mergePlaceSignature(null, SIGNATURE)).toBe(SIGNATURE);
        expect(mergePlaceSignature(SIGNATURE, '')).toBe(SIGNATURE);
        expect(mergePlaceSignature('', '')).toBeNull();
        expect(mergePlaceSignature(SIGNATURE, 'the dry river')).toBe(SIGNATURE);
        expect(mergePlaceSignature(SIGNATURE, 'a rope bridge')).toBe(`${SIGNATURE}; a rope bridge`);
        expect(mergePlaceSignature(SIGNATURE, 'A village whose mill wheel still turns above a river that ran dry long ago, with a rope bridge')).toBe(SIGNATURE);
    });

    it('never grows past the cap — an over-long append keeps the existing text', () => {
        const long = 'w'.repeat(150);
        expect(mergePlaceSignature(long, 'a bell tower')).toBe(long);
    });
});

describe('dedupeLocationRecords keeps the place card across a fold', () => {
    it('keeper signature wins, the more recently visited state is current, visits add up', () => {
        const a = normalizeLocationRecord({ name: 'Ashford', signature: 'the salt gate', lastState: 'calm', lastVisitedAt: 100, visitCount: 2 });
        const b = normalizeLocationRecord({ name: 'ashford', signature: 'the other', lastState: 'on fire', lastVisitedAt: 200, visitCount: 1 });
        const [kept] = dedupeLocationRecords([a, b]);
        expect(kept).toMatchObject({ signature: 'the salt gate', lastState: 'on fire', visitCount: 3 });
    });
});

describe('listVisitedPlaces — the place card projections', () => {
    const stamp = (record, at) => ({ ...record, lastVisitedMessage: at });
    const rimehollow = stamp(normalizeLocationRecord({ name: 'Rimehollow', signature: SIGNATURE, lastState: 'half-burned', visitCount: 3, theaterFrontIds: ['front-1'] }), 8);
    const ghyll = stamp(normalizeLocationRecord({ name: 'Ghyll' }), 30);
    const messages = Array.from({ length: 60 }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', content: `m${i}` }));

    it('extends the whitelist projection — and still never leaks theaterFrontIds', () => {
        const [place] = listVisitedPlaces([rimehollow], {});
        expect(place).not.toHaveProperty('theaterFrontIds');
        expect(Object.keys(place).sort()).toEqual([
            'aliases', 'danger', 'firstSeenAt', 'happenedHere', 'id', 'isCurrent', 'lastState', 'lastVisitedAt',
            'name', 'region', 'residents', 'signature', 'type', 'visits', 'ways',
        ]);
        expect(place.signature).toBe(SIGNATURE);
        expect(place.lastState).toBe('half-burned');
    });

    it('residents = roster NPCs whose basedIn resolves to the record; archived creatures and junk never count', () => {
        const npcs = [
            { name: 'Maren Voss', basedIn: 'Rimehollow' },
            { name: 'Old Tam', basedIn: 'the mill at Rimehollow' },
            { name: 'Ghost', basedIn: 'Rimehollow', rosterTier: 'archived_creature' },
            { name: 'Nobody', basedIn: 'Ghyll' },
            { name: { junk: true }, basedIn: 'Rimehollow' },
            { name: 'Wanderer', basedIn: null },
            { name: 'Maren Voss', basedIn: 'Rimehollow' },
        ];
        const places = listVisitedPlaces([rimehollow, ghyll], { npcs, currentLocation: 'Ghyll' });
        expect(places.find(p => p.name === 'Rimehollow').residents).toEqual(['Maren Voss', 'Old Tam']);
        expect(places.find(p => p.name === 'Ghyll').residents).toEqual(['Nobody']);
    });

    it('happenedHere = the newest 3 journal entries stamped at the record, newest first, summary only', () => {
        const journal = [
            { id: 'j1', summary: 'Arrived in Rimehollow.', location: 'Rimehollow', keyDecisions: ['x'] },
            { id: 'j2', summary: 'Rode to Ghyll.', location: 'Ghyll' },
            { id: 'j3', summary: 'The mill burned.', location: 'the mill at Rimehollow' },
            { id: 'j4', summary: 'Buried the miller.', location: 'Rimehollow' },
            { id: 'j5', summary: `Left town. ${'d'.repeat(400)}`, location: 'Rimehollow' },
            { id: 'j6', summary: { junk: true }, location: 'Rimehollow' },
        ];
        const places = listVisitedPlaces([rimehollow, ghyll], { journal });
        const here = places.find(p => p.name === 'Rimehollow');
        expect(here.happenedHere.map(e => e.id)).toEqual(['j5', 'j4', 'j3']);
        expect(here.happenedHere[0].summary).toHaveLength(240);
        expect(here.happenedHere[0]).not.toHaveProperty('keyDecisions');
        // The journal trail also proves the visit (legacy records without a stamp).
        expect(listVisitedPlaces([normalizeLocationRecord({ name: 'Ghyll' })], { journal }).map(p => p.name)).toEqual(['Ghyll']);
    });

    it('visits: arrival count + conversational distance since the hero was last here (null while here)', () => {
        const places = listVisitedPlaces([rimehollow, ghyll], { currentLocation: 'Ghyll', messages });
        const away = places.find(p => p.name === 'Rimehollow');
        // Stamped at message 8; 60 messages, none system → 52 conversational.
        expect(away.visits).toEqual({ count: 3, lastHereMessagesAgo: 52 });
        expect(places.find(p => p.name === 'Ghyll').visits).toEqual({ count: 0, lastHereMessagesAgo: null });
    });

    it('distance counts conversational messages only (system lines never age a visit)', () => {
        const noisy = messages.map((m, i) => (i > 8 && i % 3 === 0 ? { role: 'system', content: 'receipt' } : m));
        const [away] = listVisitedPlaces([rimehollow], { currentLocation: 'Ghyll', messages: noisy });
        expect(away.visits.lastHereMessagesAgo).toBe(52 - noisy.slice(8).filter(m => m.role === 'system').length);
    });

    it('a record with no stamp reports null distance; messageCount can stand in for the array', () => {
        const [legacy] = listVisitedPlaces([normalizeLocationRecord({ name: 'Ghyll' })], { journalLocations: ['Ghyll'], messages, currentLocation: 'Elsewhere' });
        expect(legacy.visits.lastHereMessagesAgo).toBeNull();
        const [counted] = listVisitedPlaces([rimehollow], { currentLocation: 'Ghyll', messageCount: 20 });
        expect(counted.visits.lastHereMessagesAgo).toBe(12);
    });
});

describe('describeLastHere / describeCurrentPlace', () => {
    it('renders turns ago from conversational distance (a line and its answer)', () => {
        expect(describeLastHere(40)).toBe('last here 20 turns ago');
        expect(describeLastHere(1)).toBe('last here 1 turn ago');
        expect(describeLastHere(3)).toBe('last here 2 turns ago');
        expect(describeLastHere(0)).toBe('last here moments ago');
        expect(describeLastHere(null)).toBe('');
        expect(describeLastHere(-3)).toBe('');
    });

    it('the DM line is name — signature. Now: state. and degrades to the bare name', () => {
        const locations = [normalizeLocationRecord({ name: 'Rimehollow', signature: `${SIGNATURE}.`, lastState: 'half-burned; the mill silent.' })];
        expect(describeCurrentPlace(locations, 'the mill at Rimehollow')).toBe(`the mill at Rimehollow — ${SIGNATURE}. Now: half-burned; the mill silent.`);
        expect(describeCurrentPlace([normalizeLocationRecord({ name: 'Ghyll', signature: 'the bell' })], 'Ghyll')).toBe('Ghyll — the bell.');
        expect(describeCurrentPlace([], 'Nowhere')).toBe('Nowhere');
        expect(describeCurrentPlace(locations, { name: 'x' })).toBe('');
    });
});

describe('SET_LOCATION counts genuine arrivals; UPDATE_LOCATION_PROFILE carries the card fields', () => {
    const base = { ...initialGameState, messages: [], locations: [], currentLocation: null };

    it('a first arrival is visit 1, an alias re-statement keeps it, a return counts again', () => {
        let state = gameReducer(base, { type: 'SET_LOCATION', payload: 'Rimehollow' });
        expect(state.locations.find(l => l.name === 'Rimehollow').visitCount).toBe(1);
        state = gameReducer(state, { type: 'SET_LOCATION', payload: 'the mill at Rimehollow' });
        expect(state.locations.find(l => l.name === 'Rimehollow').visitCount).toBe(1);
        state = gameReducer(state, { type: 'SET_LOCATION', payload: 'Ghyll' });
        state = gameReducer(state, { type: 'SET_LOCATION', payload: 'Rimehollow' });
        expect(state.locations.find(l => l.name === 'Rimehollow').visitCount).toBe(2);
        expect(state.locations.find(l => l.name === 'Ghyll').visitCount).toBe(1);
    });

    it('the Scribe profile lane fills signature / lastState without relocating the hero', () => {
        let state = gameReducer(base, { type: 'SET_LOCATION', payload: 'Rimehollow' });
        state = gameReducer(state, { type: 'SET_LOCATION', payload: 'Ghyll' });
        state = gameReducer(state, {
            type: 'UPDATE_LOCATION_PROFILE',
            payload: { name: 'Rimehollow', profile: { type: 'settlement', signature: SIGNATURE, lastState: 'half-burned' } },
        });
        expect(state.currentLocation).toBe('Ghyll');
        const record = state.locations.find(l => l.name === 'Rimehollow');
        expect(record).toMatchObject({ signature: SIGNATURE, lastState: 'half-burned', type: 'settlement' });
        state = gameReducer(state, {
            type: 'UPDATE_LOCATION_PROFILE',
            payload: { name: 'Rimehollow', profile: { signature: 'a totally new identity for the village that a later scribe pass made up', lastState: 'rebuilt' } },
        });
        expect(state.locations.find(l => l.name === 'Rimehollow')).toMatchObject({ signature: SIGNATURE, lastState: 'rebuilt' });
    });

    it('upsertLocation via a bare profile keeps the stored count', () => {
        const list = [normalizeLocationRecord({ name: 'Ghyll', visitCount: 4 })];
        expect(upsertLocation(list, 'Ghyll', { danger: 'low' })[0].visitCount).toBe(4);
    });
});
