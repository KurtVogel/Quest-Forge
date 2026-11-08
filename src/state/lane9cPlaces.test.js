/**
 * Identity by reference, lane 9C (2026-11-08): two place records are one place
 * only when the cadence reflection says so, by id, from a shortlist it was
 * shown (`possibleSamePlacePairs` → `same_place` → MERGE_LOCATION_RECORDS); the
 * cap is 80 and eviction prefers a record nobody visited and nothing lies in.
 */
import { describe, expect, it, vi } from 'vitest';

const { sendMessage, nearestStoryCards, queueMemoryItem } = vi.hoisted(() => ({
    sendMessage: vi.fn(),
    nearestStoryCards: vi.fn(() => Promise.resolve([])),
    queueMemoryItem: vi.fn(() => Promise.resolve()),
}));
vi.mock('../llm/adapter.js', async (importOriginal) => ({ ...(await importOriginal()), sendMessage }));
vi.mock('../engine/vectorMemory.js', async (importOriginal) => ({ ...(await importOriginal()), nearestStoryCards, queueMemoryItem }));

import { gameReducer, initialGameState } from './gameReducer.js';
import { MAX_LOCATIONS, normalizeLocationRecord, possibleSamePlacePairs, SAME_PLACE_PAIRS_CAP, upsertLocation } from '../engine/locationRegistry.js';
import { REFLECTION_ANCHORS, runNpcFrontReflection } from '../llm/scribe.js';

const settings = { ...initialGameState.settings, llmProvider: 'gemini', apiKey: 'k', geminiApiKey: 'k' };
const rec = (id, name, extra = {}) => ({ ...normalizeLocationRecord({ name, ...extra }), id });
const talk = n => Array.from({ length: n }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', content: `m${i}` }));

describe('possibleSamePlacePairs — the shortlist', () => {
    it('offers names that contain one another whole, or share an alias; never a pair of one cluster; newest first; capped', () => {
        const town = rec('town', 'Bramblecross', { type: 'settlement' });
        const kettle = rec('kettle', 'Copper Kettle', { type: 'settlement' });
        const twin = rec('twin', 'The Copper Kettle, Bramblecross', { within: 'town' });
        const market = rec('market', 'Bramblecross market', { within: 'town' });
        const eel = rec('eel', 'The Gilded Eel', { aliases: ['Gilded Eel tavern, Harrowmere'] });
        const eelTwin = rec('eel2', 'Gilded Eel Tavern, Harrowmere');
        const kettleYard = rec('yard', 'Copper Kettle yard');
        const pairs = possibleSamePlacePairs([town, kettle, twin, market, eel, eelTwin, kettleYard]);
        const asKeys = pairs.map(p => p.ids.join('<'));
        expect(asKeys).toContain('kettle<twin'); // "copper kettle" whole inside the twin's key
        expect(asKeys).toContain('eel<eel2'); // the alias is the other's name
        expect(asKeys).toContain('kettle<yard');
        expect(asKeys).not.toContain('town<market'); // within the town: two places, never offered
        expect(asKeys).not.toContain('town<twin');
        expect(pairs.every(p => p.names.length === 2)).toBe(true);
        expect(possibleSamePlacePairs([kettle, twin, kettleYard, rec('k3', 'Copper Kettle cellar'), rec('k4', 'Copper Kettle loft'), rec('k5', 'Copper Kettle stable')])).toHaveLength(SAME_PLACE_PAIRS_CAP);
        expect(possibleSamePlacePairs([rec('a', 'Ash'), rec('b', 'Ashford')])).toEqual([]); // a word inside a word is nothing
        expect(possibleSamePlacePairs(undefined)).toEqual([]);
    });
});

describe('the cap and the eviction', () => {
    it('is 80, and the first to go is a record nobody visited and nothing lies in, oldest touch first; a town with children is last', () => {
        expect(MAX_LOCATIONS).toBe(80);
        let list = [];
        for (let i = 0; i < MAX_LOCATIONS; i += 1) list.push(rec(`r${i}`, `Place ${i}`, { lastVisitedAt: 1000 + i, lastVisitedMessage: 10 + i, visitCount: 1 }));
        // Two unvisited records: one is a container of a visited shop.
        list[5] = rec('r5', 'Place 5', { lastVisitedAt: 1005 });
        list[6] = rec('r6', 'Place 6', { lastVisitedAt: 1006 });
        list[7] = { ...list[7], within: 'r5' };
        // The theater is never the victim while a non-theater exists.
        list[0] = { ...list[0], theaterFrontIds: ['front-1'], lastVisitedAt: 1 };
        const next = upsertLocation(list, 'Newcomer');
        expect(next).toHaveLength(MAX_LOCATIONS);
        expect(next.some(r => r.name === 'Newcomer')).toBe(true);
        expect(next.some(r => r.id === 'r6')).toBe(false); // unvisited, childless: gone
        expect(next.some(r => r.id === 'r5')).toBe(true); // unvisited but a container: kept
        expect(next.some(r => r.id === 'r0')).toBe(true); // the theater
    });
});

describe('MERGE_LOCATION_RECORDS and the reflection', () => {
    const base = () => ({
        ...initialGameState,
        settings,
        session: { ...initialGameState.session, id: 's' },
        locations: [
            rec('town', 'Bramblecross', { type: 'settlement', region: 'The Ridge' }),
            rec('kettle', 'Copper Kettle', { type: 'settlement', signature: 'copper pans on every beam', visitCount: 3, lastVisitedMessage: 20 }),
            rec('twin', 'The Copper Kettle, Bramblecross', { within: 'town', lastState: 'full of drovers', visitCount: 1, lastVisitedMessage: 30 }),
            rec('ford', 'Larkspur Ford', { type: 'settlement' }),
            rec('yard', 'Larkspur Ford staging yard'),
        ],
        messages: talk(40),
    });

    it('folds by id with the registry rule and follows a held arrival onto the kept record; a stale campaign is refused', () => {
        let state = { ...base(), session: { ...base().session, pendingArrival: { recordId: 'twin', fromRecordId: 'kettle', atMessage: 36 } } };
        state = gameReducer(state, { type: 'MERGE_LOCATION_RECORDS', payload: { keepId: 'kettle', dropId: 'twin' } });
        expect(state.locations.map(r => r.id)).toEqual(['town', 'kettle', 'ford', 'yard']);
        const kettle = state.locations.find(r => r.id === 'kettle');
        expect(kettle).toMatchObject({ name: 'Copper Kettle', signature: 'copper pans on every beam', lastState: 'full of drovers', visitCount: 4, lastVisitedMessage: 30, within: 'town' });
        expect(kettle.aliases).toContain('The Copper Kettle, Bramblecross');
        expect(state.session.pendingArrival).toEqual({ recordId: 'kettle', fromRecordId: 'kettle', atMessage: 36 });
        const untouched = base();
        expect(gameReducer(untouched, { type: 'MERGE_LOCATION_RECORDS', payload: { keepId: 'kettle', dropId: 'nobody' } })).toBe(untouched);
        const stale = gameReducer(untouched, { type: 'MERGE_LOCATION_RECORDS', payload: { keepId: 'kettle', dropId: 'twin' }, meta: { sessionId: 'other', loadNonce: 0 } });
        expect(stale).toBe(untouched);
    });

    it('the reflection is shown the pairs with their particulars and folds only an offered pair; the yard-beside-the-ford answer is honored as two', async () => {
        sendMessage.mockReset();
        sendMessage.mockResolvedValue(JSON.stringify({
            npc_updates: [], front_advances: [], settled_cards: [], story_memory: [],
            same_place: [['kettle', 'twin'], ['town', 'ford'], ['kettle', 'kettle']],
            tempo_directive: { front_id: null },
        }));
        const dispatched = [];
        const state = { ...base(), npcs: [{ id: 'npc-h', name: 'Harl Demb', rosterTier: 'character', kind: 'character', disposition: 'neutral', lastNotes: 'x' }], fronts: [] };
        await runNpcFrontReflection({ state, dispatch: action => dispatched.push(action), cadence: null });
        expect(dispatched.filter(a => a.type === 'MERGE_LOCATION_RECORDS').map(a => a.payload)).toEqual([{ keepId: 'kettle', dropId: 'twin' }]);
        const call = sendMessage.mock.calls[0][0];
        const context = JSON.parse(call.userMessage.slice(call.userMessage.indexOf('{')));
        const offered = context.possibleSamePlace.map(p => p.ids.join('<'));
        expect(offered).toContain('kettle<twin');
        expect(offered).toContain('ford<yard'); // offered, and the reflection left it: two places
        expect(context.possibleSamePlace.find(p => p.ids.includes('twin')).records.find(r => r.id === 'twin')).toMatchObject({ within: 'Bramblecross', land: null });
        expect(context.knownLocations[0]).toMatchObject({ id: 'town', name: 'Bramblecross' });
        expect(REFLECTION_ANCHORS).toContain('same_place');
        expect(call.systemPrompt).toContain('"same_place"');
        expect(call.systemPrompt).toContain('SAME PLACE: possibleSamePlace');
    });
});
