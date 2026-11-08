/**
 * Identity by reference, lane 9B (2026-11-08): a provisional DM arrival HOLDS
 * its tail until the Scribe's `place_links` answer; `within` is the cluster;
 * regions compare exactly; a copy from KNOWN PLACES passes the evidence gate
 * on any one of its words; save version 7 seeds `within` from "<place>, <town>".
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
import { isLocationEvidencedInText, isSameRegion, normalizeLocationRecord } from '../engine/locationRegistry.js';
import { runScribe, SCRIBE_SYSTEM_PROMPT } from '../llm/scribe.js';

const settings = { ...initialGameState.settings, llmProvider: 'gemini', apiKey: 'k', geminiApiKey: 'k' };
const atMessages = (state, n) => ({ ...state, messages: Array.from({ length: n }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', content: `m${i}` })) });
const byName = (state, name) => state.locations.find(r => r.name === name);

describe('the held arrival', () => {
    const start = () => {
        let state = gameReducer(atMessages(initialGameState, 2), { type: 'SET_LOCATION', payload: 'Bramblecross market' });
        return gameReducer(atMessages(state, 10), { type: 'SET_LOCATION', payload: 'The Copper Kettle' });
    };

    it('a DM name no record answers to mints a provisional record with NO visit, NO departure stamp and NO road; the hero stands there', () => {
        const before = start();
        const held = gameReducer(atMessages(before, 20), { type: 'SET_LOCATION', payload: { name: 'The Kettle\'s back room', dm: true } });
        expect(held.currentLocation).toBe('The Kettle\'s back room');
        const room = byName(held, 'The Kettle\'s back room');
        expect(room).toMatchObject({ provisional: true, visitCount: 0, lastVisitedMessage: null, links: [] });
        expect(byName(held, 'The Copper Kettle').lastVisitedMessage).toBe(10); // no departure stamp
        expect(byName(held, 'The Copper Kettle').links.some(l => l.id === room.id)).toBe(false); // no road yet
        expect(held.session.pendingArrival).toEqual({ recordId: room.id, fromRecordId: byName(held, 'The Copper Kettle').id, atMessage: 20 });
    });

    it('"is" the place the hero was in: the fold, and no arrival at all', () => {
        const before = start();
        let state = gameReducer(atMessages(before, 20), { type: 'SET_LOCATION', payload: { name: 'The Kettle\'s back room', dm: true } });
        state = gameReducer(state, { type: 'LINK_PLACES', payload: { links: [{ name: 'The Kettle\'s back room', is: 'The Copper Kettle' }] } });
        expect(state.locations).toHaveLength(2);
        const kettle = byName(state, 'The Copper Kettle');
        expect(kettle.aliases).toContain('The Kettle\'s back room');
        expect(kettle).toMatchObject({ visitCount: 1, lastVisitedMessage: 10, links: [expect.objectContaining({ atMessage: 10 })] }); // untouched
        expect(state.session.pendingArrival).toBeNull();
        expect(state.currentLocation).toBe('The Kettle\'s back room');
    });

    it('"is" a DIFFERENT known place: the fold, then the arrival at it, at the message it happened', () => {
        const before = start(); // the hero is in the Kettle
        let state = gameReducer(atMessages(before, 20), { type: 'SET_LOCATION', payload: { name: 'the stalls by the well', dm: true } });
        // Lowercase furniture never mints: the DM's string is the current place with no record.
        expect(state.locations).toHaveLength(2);
        expect(state.session.pendingArrival).toBeUndefined();
        // A proper-cased phrasing mints and holds.
        state = gameReducer(atMessages(before, 20), { type: 'SET_LOCATION', payload: { name: 'The Well Stalls', dm: true } });
        expect(state.session.pendingArrival).toMatchObject({ atMessage: 20 });
        state = gameReducer(atMessages(state, 22), { type: 'LINK_PLACES', payload: { links: [{ name: 'The Well Stalls', is: 'Bramblecross market' }] } });
        const market = byName(state, 'Bramblecross market');
        expect(market.aliases).toContain('The Well Stalls');
        expect(market).toMatchObject({ visitCount: 2, lastVisitedMessage: 20, provisional: false });
        expect(byName(state, 'The Copper Kettle').lastVisitedMessage).toBe(20); // the departure stamp, at the held message
        expect(state.session.pendingArrival).toBeNull();
    });

    it('"new" confirms and runs the tail at the held message; moving on first settles it as new too', () => {
        const before = start();
        let state = gameReducer(atMessages(before, 20), { type: 'SET_LOCATION', payload: { name: 'Harl Demb\'s forge', dm: true } });
        const confirmed = gameReducer(atMessages(state, 22), { type: 'LINK_PLACES', payload: { links: [{ name: 'Harl Demb\'s forge', is: 'new' }] } });
        expect(byName(confirmed, 'Harl Demb\'s forge')).toMatchObject({ provisional: false, visitCount: 1, lastVisitedMessage: 20 });
        expect(byName(confirmed, 'The Copper Kettle').lastVisitedMessage).toBe(20);
        expect(byName(confirmed, 'The Copper Kettle').links.some(l => l.id === byName(confirmed, 'Harl Demb\'s forge').id)).toBe(true);
        expect(confirmed.session.pendingArrival).toBeNull();
        // The Scribe never answered; the hero walks on. The forge was new: its tail runs first.
        const movedOn = gameReducer(atMessages(state, 30), { type: 'SET_LOCATION', payload: 'Larkspur Ford' });
        expect(byName(movedOn, 'Harl Demb\'s forge')).toMatchObject({ provisional: false, visitCount: 1, lastVisitedMessage: 30 }); // arrived at 20, departed at 30
        expect(byName(movedOn, 'Larkspur Ford')).toMatchObject({ visitCount: 1, lastVisitedMessage: 30 });
        expect(movedOn.session.pendingArrival).toBeNull();
        expect(movedOn.currentLocation).toBe('Larkspur Ford');
    });

    it('a hold never survives a load', () => {
        const before = start();
        const held = gameReducer(atMessages(before, 20), { type: 'SET_LOCATION', payload: { name: 'Harl Demb\'s forge', dm: true } });
        const loaded = gameReducer(held, { type: 'LOAD_GAME', payload: { ...held, session: { ...held.session } } });
        expect(loaded.session.pendingArrival).toBeNull();
        expect(byName(loaded, 'Harl Demb\'s forge')?.provisional).toBe(true); // the Scribe may still link it
    });
});

describe('regions exact, the evidence gate, save version 7', () => {
    it('isSameRegion is the exact key', () => {
        expect(isSameRegion('the Rimefell Marches', 'The Rimefell  Marches.')).toBe(true);
        expect(isSameRegion('the Rimefell Marches', 'Rimefell Marches')).toBe(false);
        expect(isSameRegion('', 'x')).toBe(false);
    });

    it('a copy from KNOWN PLACES passes on one word; a new name still needs more than half', () => {
        expect(isLocationEvidencedInText('The Copper Kettle', 'You duck into the Kettle\'s back room.', { anyToken: true })).toBe(true);
        expect(isLocationEvidencedInText('The Copper Kettle', 'You duck into the Kettle\'s back room.')).toBe(false);
        expect(isLocationEvidencedInText('The Copper Kettle', 'You sit by the fire.', { anyToken: true })).toBe(false);
    });

    it('runScribe relocates on a known copy the narration names by one word, and not on an unknown name it barely names', async () => {
        sendMessage.mockReset();
        sendMessage.mockResolvedValue(JSON.stringify({ world_facts: [], npc_updates: [], story_memory: [], location: 'The Copper Kettle' }));
        const locations = [normalizeLocationRecord({ name: 'The Copper Kettle' }), normalizeLocationRecord({ name: 'Bramblecross market' })];
        let dispatched = [];
        await runScribe({
            playerMessage: 'I go into the Kettle.', dmNarrative: 'You duck into the Kettle\'s back room.', settings,
            dispatch: action => dispatched.push(action),
            knownLocations: 'The Copper Kettle; Bramblecross market',
            memoryContext: { worldFacts: [], messageCount: 6, location: 'Bramblecross market', locations, npcs: [], storyMemory: [], campaign: { sessionId: 's', loadNonce: 0 } },
        });
        expect(dispatched.find(a => a.type === 'SET_LOCATION')?.payload).toBe('The Copper Kettle');
        dispatched = [];
        sendMessage.mockResolvedValue(JSON.stringify({ world_facts: [], npc_updates: [], story_memory: [], location: 'The Brass Kettle Inn' }));
        await runScribe({
            playerMessage: 'I go in.', dmNarrative: 'You duck into the Kettle\'s back room.', settings,
            dispatch: action => dispatched.push(action),
            knownLocations: 'The Copper Kettle; Bramblecross market',
            memoryContext: { worldFacts: [], messageCount: 8, location: 'Bramblecross market', locations, npcs: [], storyMemory: [], campaign: { sessionId: 's', loadNonce: 0 } },
        });
        expect(dispatched.some(a => a.type === 'SET_LOCATION')).toBe(false);
        expect(SCRIBE_SYSTEM_PROMPT).toContain('"within"');
        expect(SCRIBE_SYSTEM_PROMPT).toContain('location_profile.within names the KNOWN PLACES entry this place lies INSIDE');
    });

    it('version 7 seeds within from "<place>, <town>" where the town is a record, never itself, never a cycle, never over a value held', () => {
        expect(CURRENT_SAVE_VERSION).toBe(7);
        expect(MIGRATIONS.find(m => m.toVersion === 7).description).toContain('lane 9B');
        const town = { ...normalizeLocationRecord({ name: 'Bramblecross', type: 'settlement' }), id: 'town' };
        const kettle = { ...normalizeLocationRecord({ name: 'The Copper Kettle, Bramblecross' }), id: 'kettle' };
        const forge = { ...normalizeLocationRecord({ name: 'Harl Demb\'s forge, bramblecross' }), id: 'forge' };
        const held = { ...normalizeLocationRecord({ name: 'Gatehouse Inn, Bramblecross', within: 'kettle' }), id: 'inn' };
        const orphan = { ...normalizeLocationRecord({ name: 'The Split Wedge, Dunmire' }), id: 'wedge' };
        // B already lies within "A, B": seeding "A, B" within B would close a cycle, so it is left alone.
        const loop1 = { ...normalizeLocationRecord({ name: 'Alder Yard, Brackwater' }), id: 'loop1' };
        const loop2 = { ...normalizeLocationRecord({ name: 'Brackwater', within: 'loop1' }), id: 'loop2' };
        const save = {
            saveVersion: 6,
            character: { name: 'Astra', race: 'human', class: 'rogue', level: 1, exp: 0, currentHP: 8, maxHP: 8, conditions: [], abilityScores: {} },
            inventory: [], messages: [],
            locations: [town, kettle, forge, held, orphan, loop1, loop2],
        };
        const migrated = migrateLoadedSave(save);
        expect(migrated.saveVersion).toBe(7);
        const get = id => migrated.locations.find(r => r.id === id);
        expect(get('kettle').within).toBe('town');
        expect(get('forge').within).toBe('town'); // the exact key, case aside
        expect(get('inn').within).toBe('kettle'); // a value held stays
        expect(get('wedge').within).toBeNull(); // Dunmire is no record
        expect(get('loop1').within).toBeNull(); // never a cycle
        expect(get('loop2').within).toBe('loop1');
        expect(migrateLoadedSave({ ...migrated, saveVersion: 6 }).locations).toEqual(migrated.locations);
    });
});
