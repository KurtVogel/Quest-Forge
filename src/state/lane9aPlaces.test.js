/**
 * Identity by reference, lane 9A (2026-11-08): a place is an id, an exact
 * name or an exact alias. The DM and the Scribe copy from KNOWN PLACES; a DM
 * name no record answers to mints a PROVISIONAL record the Scribe's
 * `place_links` folds, aliases or confirms; the save-6 migration runs the old
 * containment rung once more, as aliases. No word rule folds two names.
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
import { CURRENT_SAVE_VERSION, migrateLoadedSave, MIGRATIONS } from './migrations.js';
import { legacyFindLocationRecord, legacyIsSameLocation, legacyPlaceNamesInSave } from './legacyPlaceIdentity.js';
import {
    findLocationRecord, isSameLocation, listKnownPlaceNames, MAX_ALIASES, mergeLocationRecords,
    normalizeLocationRecord, placeKey, samePlace, upsertLocation,
} from '../engine/locationRegistry.js';
import { isAbsenceDriftLocalNpc } from '../engine/worldTempo.js';
import { buildPlaceBlock } from '../llm/journalBlocks.js';
import { buildProvisionalPlace, buildScribeContext, runScribe, SCRIBE_ANCHORS, SCRIBE_SYSTEM_PROMPT } from '../llm/scribe.js';

const settings = { ...initialGameState.settings, llmProvider: 'gemini', apiKey: 'k', geminiApiKey: 'k' };
const rec = (name, extra = {}) => normalizeLocationRecord({ name, ...extra });
const atMessages = (state, n) => ({ ...state, messages: Array.from({ length: n }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', content: `m${i}` })) });

describe('the exact key and the record-aware reads', () => {
    it('samePlace is the same name or the same record, never word overlap', () => {
        const kettle = rec('The Copper Kettle', { aliases: ['the back room of the Kettle'] });
        const town = rec('Bramblecross');
        const list = [kettle, town];
        expect(samePlace(list, 'the copper kettle', 'The Copper Kettle')).toBe(true);
        expect(samePlace(list, 'the back room of the Kettle', 'The Copper Kettle')).toBe(true);
        expect(samePlace(list, 'The Copper Kettle, Bramblecross', 'The Copper Kettle')).toBe(false);
        expect(samePlace(list, 'Copper Kettle', 'The Copper Kettle')).toBe(false); // the article is part of the name
        expect(samePlace(list, kettle.id, 'The Copper Kettle')).toBe(true);
        expect(samePlace([], 'Nowhere', 'nowhere')).toBe(true);
        expect(samePlace(null, '', '')).toBe(false);
        expect(isSameLocation('A', 'a ')).toBe(true);
        expect(placeKey('Saltmere!!')).toBe('saltmere');
    });

    it('listKnownPlaceNames is the most recently visited names, the current record left out when asked', () => {
        const a = rec('Ashford', { lastVisitedAt: 100 });
        const b = rec('Deep Fen', { lastVisitedAt: 300, aliases: ['the fen'] });
        const c = rec('Rimehollow', { lastVisitedAt: 200 });
        expect(listKnownPlaceNames([a, b, c])).toEqual(['Deep Fen', 'Rimehollow', 'Ashford']);
        expect(listKnownPlaceNames([a, b, c], { limit: 2 })).toEqual(['Deep Fen', 'Rimehollow']);
        expect(listKnownPlaceNames([a, b, c], { exclude: 'the fen' })).toEqual(['Rimehollow', 'Ashford']);
        expect(listKnownPlaceNames([a, b, c], { exclude: 'Nowhere' })).toHaveLength(3);
        expect(listKnownPlaceNames(undefined)).toEqual([]);
        expect(MAX_ALIASES).toBe(12);
    });

    it('the DM place block lists Known places and the Scribe sees the same names', () => {
        const list = [rec('Ashford', { lastVisitedAt: 1 }), rec('Deep Fen', { lastVisitedAt: 3 }), rec('Rimehollow', { lastVisitedAt: 2 })];
        const block = buildPlaceBlock('Deep Fen', { locations: list });
        expect(block).toContain('**Known places (when the hero ends this turn in one of these under any phrasing');
        expect(block).toContain('Rimehollow; Ashford');
        expect(buildPlaceBlock('Deep Fen', { locations: [list[1]] })).not.toContain('Known places');
        const context = buildScribeContext({ ...initialGameState, locations: list, currentLocation: 'Deep Fen' });
        expect(context.knownLocations).toBe('Deep Fen; Rimehollow; Ashford');
    });

    it('a sighting under an alias on record is local to the place (the drift reads the registry)', () => {
        const list = [rec('Rimehollow', { aliases: ['the mill at Rimehollow'] })];
        expect(isAbsenceDriftLocalNpc({ name: 'Old Tam', lastLocation: 'the mill at Rimehollow' }, 'Rimehollow', list)).toBe(true);
        expect(isAbsenceDriftLocalNpc({ name: 'Old Tam', lastLocation: 'the mill at Rimehollow' }, 'Rimehollow')).toBe(false);
        expect(isAbsenceDriftLocalNpc({ name: 'Old Tam', basedIn: 'rimehollow' }, 'Rimehollow')).toBe(true);
    });
});

describe('mergeLocationRecords — the fold by id', () => {
    it('keeps the kept record\'s identity, carries the dropped one\'s names, theaters, links and visits, re-aims links', () => {
        const keep = { ...rec('The Copper Kettle', { type: 'haven', signature: 'copper pans', lastState: 'quiet', visitCount: 2, lastVisitedAt: 100, lastVisitedMessage: 10 }), id: 'keep' };
        const drop = { ...rec('Copper Kettle, Bramblecross', { danger: 'low', region: 'The Ridge', theaterFrontIds: ['f1'], lastState: 'full of drovers', visitCount: 1, lastVisitedAt: 200, lastVisitedMessage: 30, provisional: true, aliases: ['the Kettle'] }), id: 'drop' };
        const other = { ...rec('Bramblecross'), id: 'town', links: [{ id: 'drop', direction: 'north' }, { id: 'keep' }] };
        const merged = mergeLocationRecords([keep, drop, other], 'keep', 'drop');
        expect(merged.map(r => r.id)).toEqual(['keep', 'town']);
        const kept = merged[0];
        expect(kept).toMatchObject({ name: 'The Copper Kettle', type: 'haven', danger: 'low', region: 'The Ridge', signature: 'copper pans', lastState: 'full of drovers', visitCount: 3, lastVisitedMessage: 30, provisional: false });
        expect(kept.aliases).toEqual(expect.arrayContaining(['Copper Kettle, Bramblecross', 'the Kettle']));
        expect(kept.theaterFrontIds).toEqual(['f1']);
        expect(kept.lastVisitedAt).toBe(200);
        expect(merged[1].links.map(l => l.id)).toEqual(['keep']);
        expect(mergeLocationRecords([keep, drop], 'keep', 'nobody')).toEqual([keep, drop]);
        expect(mergeLocationRecords([keep, drop], 'keep', 'keep')).toEqual([keep, drop]);
    });
});

describe('SET_LOCATION and LINK_PLACES — the DM mints provisionally, the Scribe resolves', () => {
    const start = () => gameReducer(atMessages(initialGameState, 2), { type: 'SET_LOCATION', payload: 'The Copper Kettle' });

    it('the DM lane\'s unknown name mints a provisional record; the Scribe lane and a known name do not', () => {
        let state = start();
        expect(state.locations[0].provisional).toBe(false);
        state = gameReducer(atMessages(state, 4), { type: 'SET_LOCATION', payload: { name: 'The Kettle\'s back room', dm: true } });
        expect(state.locations).toHaveLength(2);
        expect(state.locations[1]).toMatchObject({ name: 'The Kettle\'s back room', provisional: true });
        // The DM naming a KNOWN place marks nothing.
        state = gameReducer(atMessages(state, 6), { type: 'SET_LOCATION', payload: { name: 'the copper kettle', dm: true } });
        expect(state.locations).toHaveLength(2);
        expect(state.locations[0].provisional).toBe(false);
        // The Scribe's own string mints a plain record.
        state = gameReducer(atMessages(state, 8), { type: 'SET_LOCATION', payload: 'Bramblecross market' });
        expect(state.locations[2]).toMatchObject({ name: 'Bramblecross market', provisional: false });
    });

    it('"is" a known place folds the provisional record into it; the hero\'s place still resolves', () => {
        let state = start();
        state = gameReducer(atMessages(state, 4), { type: 'SET_LOCATION', payload: { name: 'The Kettle\'s back room', dm: true } });
        state = gameReducer(state, { type: 'LINK_PLACES', payload: { links: [{ name: 'The Kettle\'s back room', is: 'The Copper Kettle' }] } });
        expect(state.locations).toHaveLength(1);
        expect(state.locations[0].aliases).toContain('The Kettle\'s back room');
        expect(state.currentLocation).toBe('The Kettle\'s back room');
        expect(findLocationRecord(state.locations, state.currentLocation)).toBe(0);
    });

    it('"new" confirms the record; a link that was not offered, or names an unknown place, is ignored', () => {
        let state = start();
        state = gameReducer(atMessages(state, 4), { type: 'SET_LOCATION', payload: { name: 'Harl Demb\'s forge', dm: true } });
        const unofferedKept = gameReducer(state, { type: 'LINK_PLACES', payload: { links: [{ name: 'The Copper Kettle', is: 'Harl Demb\'s forge' }] } });
        expect(unofferedKept).toBe(state); // the Kettle is not provisional and not the current unresolved place
        const unknownIs = gameReducer(state, { type: 'LINK_PLACES', payload: { links: [{ name: 'Harl Demb\'s forge', is: 'Nowhere Yet' }] } });
        expect(unknownIs).toBe(state); // never a mint from a link
        state = gameReducer(state, { type: 'LINK_PLACES', payload: { links: [{ name: 'Harl Demb\'s forge', is: 'new' }] } });
        expect(state.locations).toHaveLength(2);
        expect(state.locations[1].provisional).toBe(false);
        expect(gameReducer(state, { type: 'LINK_PLACES', payload: { links: [] } })).toBe(state);
        expect(gameReducer(state, { type: 'LINK_PLACES', payload: 'junk' })).toBe(state);
    });

    it('the Scribe echoing the provisional name itself is "new": confirmed, its held arrival run, and KNOWN PLACES never listed it (the 2026-11-08 lands playtest)', () => {
        let state = start();
        state = gameReducer(atMessages(state, 4), { type: 'SET_LOCATION', payload: { name: 'Gullmark Quays', dm: true } });
        expect(state.session.pendingArrival).toMatchObject({ atMessage: 4 });
        expect(listKnownPlaceNames(state.locations)).toEqual(['The Copper Kettle']); // the provisional record is the question, not an answer
        expect(buildScribeContext({ ...initialGameState, ...state }).knownLocations).toBe('The Copper Kettle');
        state = gameReducer(state, { type: 'LINK_PLACES', payload: { links: [{ name: 'Gullmark Quays', is: 'Gullmark Quays' }] } });
        expect(state.session.pendingArrival).toBeNull();
        expect(state.locations.find(r => r.name === 'Gullmark Quays')).toMatchObject({ provisional: false, visitCount: 1, lastVisitedMessage: 4 });
        expect(listKnownPlaceNames(state.locations)).toContain('Gullmark Quays');
    });

    it('a current place no record answers to (furniture under the mint gate) becomes an alias of the place it is', () => {
        let state = start();
        state = gameReducer(atMessages(state, 4), { type: 'SET_LOCATION', payload: { name: 'the back alcove', dm: true } });
        expect(state.locations).toHaveLength(1); // lowercase furniture never mints
        expect(state.currentLocation).toBe('the back alcove');
        state = gameReducer(state, { type: 'LINK_PLACES', payload: { links: [{ name: 'the back alcove', is: 'The Copper Kettle' }] } });
        expect(state.locations[0].aliases).toContain('the back alcove');
        expect(findLocationRecord(state.locations, 'the back alcove')).toBe(0);
    });
});

describe('save version 6 — the one run of the frozen place rung, as aliases', () => {
    it('is version 6, and the pipeline seeds an alias where the old rung resolved a stored string, folding nothing', () => {
        expect(CURRENT_SAVE_VERSION).toBe(7);
        expect(MIGRATIONS.find(m => m.toVersion === 6).description).toContain('lane 9A');
        const tower = { ...rec('Clockwork Tower', { type: 'frontier' }), id: 'tower' };
        const town = { ...rec('Weatherby', { type: 'settlement' }), id: 'town' };
        const save = {
            saveVersion: 5,
            character: { name: 'Astra', race: 'human', class: 'rogue', level: 1, exp: 0, currentHP: 8, maxHP: 8, conditions: [], abilityScores: {} },
            inventory: [], messages: [],
            locations: [tower, town],
            currentLocation: 'Library landing, Clockwork Tower',
            npcs: [{ id: 'n1', name: 'Maren', lastLocation: 'the Clockwork Tower stairwell', basedIn: 'Guild Quarter, Weatherby' }],
            storyMemory: [{ id: 'c1', type: 'promise', status: 'active', text: 'x', location: 'Sunlit Orchard' }],
            journal: [{ id: 'j1', summary: 's', location: 'weatherby' }],
        };
        const migrated = migrateLoadedSave(save);
        expect(migrated.saveVersion).toBe(7);
        const migratedTower = migrated.locations.find(r => r.id === 'tower');
        const migratedTown = migrated.locations.find(r => r.id === 'town');
        expect(migrated.locations).toHaveLength(2); // nothing folded
        expect(migratedTower.aliases).toEqual(expect.arrayContaining(['Library landing, Clockwork Tower', 'the Clockwork Tower stairwell']));
        // A settlement never claimed a place within it under the old rung either; an exact match seeds nothing; an unknown resolves to nothing.
        expect(migratedTown.aliases).toEqual([]);
        expect(migrated.locations.some(r => r.name === 'Sunlit Orchard')).toBe(false);
        // The live exact lookups now find every seeded string; the stamps were not touched.
        expect(findLocationRecord(migrated.locations, 'the Clockwork Tower stairwell')).toBe(0);
        expect(migratedTower.lastVisitedAt).toBe(tower.lastVisitedAt);
        // Idempotent: a second run finds every name answered to.
        expect(migrateLoadedSave({ ...migrated, saveVersion: 5 }).locations).toEqual(migrated.locations);
    });

    it('the frozen rung is the old behaviour, untouched by the live registry', () => {
        expect(legacyIsSameLocation('Clockwork Tower', 'Library landing, Clockwork Tower')).toBe(true);
        expect(legacyIsSameLocation('tunnel', 'Crown Way transit tunnel')).toBe(false);
        expect(legacyIsSameLocation('The Tunnel', 'tunnel')).toBe(true);
        const list = [rec('Weatherby', { type: 'settlement' }), rec('The Gilded Eel', { aliases: ['Gilded Eel tavern, Harrowmere'] })];
        expect(legacyFindLocationRecord(list, 'Guild Quarter, Weatherby')).toBe(-1); // the settlement no-fold
        expect(legacyFindLocationRecord(list, 'the Gilded Eel taproom')).toBe(1);
        expect(legacyFindLocationRecord(list, 'Harrowmere')).toBe(-1); // never through an alias
        expect(isSameLocation('Clockwork Tower', 'Library landing, Clockwork Tower')).toBe(false); // the live rule
        expect(legacyPlaceNamesInSave({
            currentLocation: 'A', npcs: [{ lastLocation: 'B', basedIn: 'C' }], storyMemory: [{ location: 'D' }], worldFacts: [{ location: 'E' }],
            journal: [{ location: 'F' }], fronts: [{ directives: [{ where: 'G' }] }],
        }).sort()).toEqual(['A', 'B', 'C', 'D', 'E', 'F', 'G']);
    });
});

describe('the Scribe: PLACE NAMED WITHOUT A RECORD and place_links', () => {
    it('buildProvisionalPlace is the provisional current record, or the unresolved current string, else null', () => {
        const kettle = rec('The Copper Kettle');
        const alcove = rec('The Alcove', { provisional: true });
        expect(buildProvisionalPlace({ locations: [kettle], currentLocation: 'The Copper Kettle' })).toBeNull();
        expect(buildProvisionalPlace({ locations: [kettle, alcove], currentLocation: 'the alcove' })).toBe('The Alcove');
        expect(buildProvisionalPlace({ locations: [kettle], currentLocation: 'the back alcove' })).toBe('the back alcove');
        expect(buildProvisionalPlace({ locations: [kettle], currentLocation: null })).toBeNull();
        expect(SCRIBE_ANCHORS).toContain('place_links');
        expect(SCRIBE_SYSTEM_PROMPT).toContain('"place_links"');
        expect(SCRIBE_SYSTEM_PROMPT).toContain('PLACE NAMED WITHOUT A RECORD is answered in place_links');
    });

    it('runScribe prints the provisional place and dispatches only offered-shaped links, bounded; nothing without a provisional place', async () => {
        sendMessage.mockReset();
        sendMessage.mockResolvedValue(JSON.stringify({
            world_facts: [], npc_updates: [], story_memory: [],
            location: null,
            place_links: [
                { name: 'The Alcove', is: 'The Copper Kettle' },
                { name: 7, is: 'x' },
                { name: 'Another', is: 'new' }, { name: 'Third', is: 'new' }, { name: 'Fourth', is: 'new' }, { name: 'Fifth', is: 'new' },
            ],
        }));
        const dispatched = [];
        await runScribe({
            playerMessage: 'I step into the alcove.',
            dmNarrative: 'You duck into the alcove behind the bar.',
            settings,
            dispatch: action => dispatched.push(action),
            knownLocations: 'The Copper Kettle; Bramblecross',
            provisionalPlace: 'The Alcove',
            memoryContext: { worldFacts: [], messageCount: 6, location: 'The Alcove', npcs: [], storyMemory: [], campaign: { sessionId: 's', loadNonce: 0 } },
        });
        const request = sendMessage.mock.calls[0][0];
        expect(request.userMessage).toContain('PLACE NAMED WITHOUT A RECORD');
        expect(request.userMessage).toContain('The Alcove');
        expect(request.userMessage).toContain('KNOWN PLACES (the places on record — the engine compares place names EXACTLY');
        const link = dispatched.find(a => a.type === 'LINK_PLACES');
        expect(link.payload.links).toHaveLength(4);
        expect(link.payload.links[0]).toEqual({ name: 'The Alcove', is: 'The Copper Kettle' });

        dispatched.length = 0;
        await runScribe({
            playerMessage: 'I sit.', dmNarrative: 'You sit by the fire.', settings,
            dispatch: action => dispatched.push(action),
            knownLocations: 'The Copper Kettle',
            memoryContext: { worldFacts: [], messageCount: 8, location: 'The Copper Kettle', npcs: [], storyMemory: [], campaign: { sessionId: 's', loadNonce: 0 } },
        });
        expect(sendMessage.mock.calls[1][0].userMessage).not.toContain('PLACE NAMED WITHOUT A RECORD');
        expect(dispatched.some(a => a.type === 'LINK_PLACES')).toBe(false);
    });

    it('upsertLocation keeps a provisional mark through a profile, and a profile can clear it', () => {
        let list = upsertLocation([], 'The Alcove', { provisional: true });
        list = upsertLocation(list, 'the alcove', { type: 'haven' });
        expect(list[0]).toMatchObject({ name: 'The Alcove', type: 'haven', provisional: true });
        list = upsertLocation(list, 'The Alcove', { provisional: false });
        expect(list[0].provisional).toBe(false);
    });
});
