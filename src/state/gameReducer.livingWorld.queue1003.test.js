/**
 * 2026-10-03 living-world Lap-4 (simplification & design) queue sweep — the
 * reducer-side pins: a drift symptom lands under the front the director was
 * shown, the three one-shot markers are WRITTEN with exactly the keys that
 * have a reader, the "still at the offer's place" judgement is one predicate
 * at every site, and the director registry's install IS the give-up.
 */
import { describe, expect, it } from 'vitest';
import { gameReducer, initialGameState } from './gameReducer.js';
import { ABSENCE_DRIFT_MIN_AWAY, findDriftTheaterFront } from '../engine/worldTempo.js';
import { PENDING_MARKER_KEYS } from '../engine/livingWorldSession.js';
import { RETRYABLE_DIRECTORS } from '../engine/directorRetry.js';
import { isStillAtPlace } from '../engine/locationRegistry.js';
import { buildWhileYouWereAwayBlock, buildAbsenceDriftContext } from '../llm/absenceDrift.js';
import { buildSystemPromptParts } from '../llm/promptBuilder.js';

const msgs = n => Array.from({ length: n }, (_, i) => ({
    role: i % 2 ? 'assistant' : 'user',
    content: `m${i}`,
}));
const atMessages = (state, n) => ({ ...state, messages: msgs(n) });

const front = (id, factionName, clock) => ({
    id, title: `Pressure ${id}`, status: 'active', clock, maxClock: 6, stage: clock > 3 ? 2 : 0,
    grimPortents: ['a', 'b', 'c'], goal: 'g', stakes: 's', faction: { name: factionName, goal: 'Own the weir' },
});

describe('the drift symptom is bound to the front the director was shown', () => {
    const pendingState = () => ({
        ...initialGameState,
        messages: msgs(50),
        settings: { ...initialGameState.settings, apiKey: 'k' },
        session: {
            ...initialGameState.session,
            id: 'campaign-1',
            pendingAbsenceDrift: { key: 'loc-aldermill|50', locationName: 'Aldermill', awayDistance: 40, returnMessage: 50 },
        },
        locations: [{ id: 'loc-aldermill', name: 'Aldermill', aliases: [], type: 'settlement', danger: 'low', theaterFrontIds: ['front-quiet', 'front-loud'] }],
        // Two fronts hold the place, at different intensity bands.
        fronts: [front('front-quiet', 'The Quiet Hand', 1), front('front-loud', 'The Loud Hand', 6)],
        npcs: [{ id: 'npc-marta', name: 'Marta', rosterTier: 'character', lastLocation: 'Aldermill' }],
    });

    it('context and installer name the same front, so the symptom installs under ITS id and band', () => {
        const state = pendingState();
        const shown = buildAbsenceDriftContext(state).offScreenPressureHoldingThisPlace;
        const next = gameReducer(state, {
            type: 'INSTALL_ABSENCE_DRIFT',
            payload: { sessionId: 'campaign-1', key: 'loc-aldermill|50', drift: { developments: [], worldFact: '', frontSymptom: 'Toll receipts on the notice board' } },
        });
        const installed = next.session.absenceDrift.frontSymptom;
        const installedFront = state.fronts.find(f => f.id === installed.frontId);
        expect(installedFront.faction.name).toBe(shown.faction);
        expect(installed.maxIntensity).toBe(shown.maximumIntensity);
        expect(installedFront).toBe(findDriftTheaterFront(state.fronts, state.locations[0]));
    });

    it('a resolved theater front is never the one shown or bound', () => {
        const state = pendingState();
        state.fronts[0] = { ...state.fronts[0], status: 'resolved' };
        expect(buildAbsenceDriftContext(state).offScreenPressureHoldingThisPlace.faction).toBe('The Loud Hand');
        const next = gameReducer(state, {
            type: 'INSTALL_ABSENCE_DRIFT',
            payload: { sessionId: 'campaign-1', key: 'loc-aldermill|50', drift: { frontSymptom: 'Tolls' } },
        });
        expect(next.session.absenceDrift.frontSymptom.frontId).toBe('front-loud');
    });
});

describe('the one-shot markers are written with exactly the keys that have a reader', () => {
    const keysOf = marker => Object.keys(marker).sort();

    it('pendingAbsenceDrift (a long-enough return)', () => {
        let state = gameReducer(atMessages(initialGameState, 0), { type: 'SET_LOCATION', payload: 'Aldermill' });
        state = gameReducer(atMessages(state, 10), { type: 'SET_LOCATION', payload: 'Deep Fen' });
        state = gameReducer(atMessages(state, 10 + ABSENCE_DRIFT_MIN_AWAY + 5), { type: 'SET_LOCATION', payload: 'Aldermill' });
        expect(keysOf(state.session.pendingAbsenceDrift)).toEqual([...PENDING_MARKER_KEYS.pendingAbsenceDrift].sort());
    });

    it('pendingFrontAftermath (a front resolved on screen) — no wall-clock stamp', () => {
        const state = gameReducer({
            ...initialGameState,
            messages: msgs(10),
            session: { ...initialGameState.session, id: 'campaign-1' },
            fronts: [{ ...front('front-brood', 'The Brood', 5), title: 'The Mill Brood' }],
        }, { type: 'UPDATE_FRONT', payload: { id: 'front-brood', status: 'resolved', notes: 'burned out of the cellar' } });
        expect(state.session.pendingFrontAftermath).toEqual({ frontId: 'front-brood', title: 'The Mill Brood' });
        expect(keysOf(state.session.pendingFrontAftermath)).toEqual([...PENDING_MARKER_KEYS.pendingFrontAftermath].sort());
    });

    it('pendingRegionalFronts (a genuinely new region) — the key already carries the index', () => {
        let state = {
            ...initialGameState,
            session: { ...initialGameState.session, id: 'campaign-1', premise: 'Trade wars run from the Riverlands to the Icebound Coast.' },
            messages: msgs(20),
        };
        state = gameReducer(state, { type: 'SET_LOCATION', payload: 'Aldermill' });
        state = gameReducer(state, { type: 'UPDATE_LOCATION_PROFILE', payload: { name: 'Aldermill', profile: { type: 'settlement', danger: 'low', region: 'the Riverlands' } } });
        state = gameReducer(state, { type: 'SET_LOCATION', payload: 'Fort Halla' });
        state = gameReducer(state, { type: 'UPDATE_LOCATION_PROFILE', payload: { name: 'Fort Halla', profile: { type: 'frontier', danger: 'moderate', region: 'the Icebound Coast' } } });
        expect(keysOf(state.session.pendingRegionalFronts)).toEqual([...PENDING_MARKER_KEYS.pendingRegionalFronts].sort());
        expect(state.session.pendingRegionalFronts.key).toBe('the icebound coast|20');
    });
});

describe('"is the hero still at that place" is ONE predicate', () => {
    const locations = [
        { id: 'loc-town', name: 'Stonebridge', aliases: [], type: 'settlement', settlementScale: true },
        { id: 'loc-eel', name: 'The Gilded Eel', aliases: ['The Gilded Eel, Stonebridge'], type: 'haven' },
        { id: 'loc-fen', name: 'Deep Fen', aliases: [], type: 'wilderness' },
    ];

    it('same name, same record, or one cluster — never an unrelated place, never junk', () => {
        expect(isStillAtPlace(locations, 'Stonebridge', 'Stonebridge')).toBe(true);
        expect(isStillAtPlace(locations, 'Stonebridge', 'The Gilded Eel')).toBe(true); // no shared token in the NAMES — the registry knows
        expect(isStillAtPlace([], 'Stonebridge', 'The Gilded Eel')).toBe(false);
        expect(isStillAtPlace(locations, 'Stonebridge', 'Deep Fen')).toBe(false);
        expect(isStillAtPlace(locations, '', 'Stonebridge')).toBe(false);
        expect(isStillAtPlace(locations, { name: 'Stonebridge' }, 'Stonebridge')).toBe(false);
        expect(isStillAtPlace(null, 'Stonebridge', 'Stonebridge')).toBe(true);
    });

    it('the away block follows the hero into the town\'s own tavern, and stops at an unrelated place', () => {
        const drift = {
            locationName: 'Stonebridge', arrivedAtMessage: 50, awayDistance: 40,
            developments: [], fact: 'The ferry runs again', frontSymptom: null,
        };
        const render = (currentLocation, registry) => buildWhileYouWereAwayBlock(drift, {
            currentLocation, locations: registry, messages: msgs(54), messageCount: 54,
        });
        expect(render('Stonebridge', locations)).toContain('## WHILE YOU WERE AWAY');
        expect(render('The Gilded Eel', locations)).toContain('## WHILE YOU WERE AWAY');
        expect(render('The Gilded Eel', [])).toBe('');
        expect(render('Deep Fen', locations)).toBe('');
    });

    it('the prompt builder hands BOTH living-world blocks the registry', () => {
        const state = {
            ...initialGameState,
            character: { name: 'Rauha', race: 'human', class: 'cleric', level: 3, currentHP: 20, maxHP: 20, conditions: [], abilityScores: { strength: 10, dexterity: 10, constitution: 10, intelligence: 10, wisdom: 14, charisma: 10 } },
            messages: msgs(54),
            currentLocation: 'The Gilded Eel',
            locations,
        };
        const parts = buildSystemPromptParts({
            ...state,
            preset: 'classicFantasy', ruleset: 'simplified5e', customSystemPrompt: '', retrievedMemories: [],
            messageCount: 54,
            absenceDrift: { locationName: 'Stonebridge', arrivedAtMessage: 50, awayDistance: 40, developments: [], fact: 'The ferry runs again', frontSymptom: null },
            regionalHearsay: { locationName: 'Stonebridge', arrivedAtMessage: 50, items: [{ text: 'The hero broke the toll gang', grade: 'firsthand' }] },
        });
        const text = JSON.stringify(parts);
        expect(text).toContain('WHILE YOU WERE AWAY');
        expect(text).toContain('REGIONAL HEARSAY');
    });

    it('the combat re-open reads the registry too: a fight in the tavern re-opens the town\'s offer', () => {
        const state = {
            ...initialGameState,
            messages: msgs(40),
            currentLocation: 'The Gilded Eel',
            locations,
            session: {
                ...initialGameState.session, id: 'campaign-1',
                regionalHearsay: { locationName: 'Stonebridge', arrivedAtMessage: 30, items: [{ text: 'x', grade: 'firsthand' }] },
            },
            combat: { ...initialGameState.combat, active: true, startedAtMessage: 32, enemies: [], turnOrder: [] },
        };
        const ended = gameReducer(state, { type: 'END_COMBAT', payload: { outcome: 'victory' } });
        expect(ended.session.regionalHearsay.arrivedAtMessage).toBe(40);
    });
});

describe('the director registry: install IS the give-up', () => {
    it('every marker-keyed director has a pending key, an install action, and a quiet result', () => {
        expect(Object.keys(RETRYABLE_DIRECTORS).sort()).toEqual(['absenceDrift', 'frontAftermath', 'regionalFronts', 'wonder']);
        for (const [name, row] of Object.entries(RETRYABLE_DIRECTORS)) {
            expect(typeof row.pendingKey, name).toBe('function');
            const action = row.install('campaign-1', 'key-1', row.empty);
            expect(action.type, name).toMatch(/^INSTALL_/);
            expect(action.payload.sessionId).toBe('campaign-1');
            expect(Object.values(action.payload)).toContain('key-1');
            expect(Object.values(action.payload)).toContain(row.empty);
        }
    });

    it('the quiet install consumes each marker and installs nothing', () => {
        const session = {
            ...initialGameState.session, id: 'campaign-1',
            pendingFrontAftermath: { frontId: 'front-x', title: 'X' },
            pendingAbsenceDrift: { key: 'loc|1', locationName: 'Aldermill', awayDistance: 40, returnMessage: 1 },
            pendingRegionalFronts: { key: 'coast|1', region: 'the Coast', locationName: 'Fort Halla' },
            pendingWonder: { key: 'wonder-1-lull', requestedAtMessage: 1, onDemand: false },
        };
        let state = { ...initialGameState, messages: msgs(10), session };
        for (const row of Object.values(RETRYABLE_DIRECTORS)) {
            const key = row.pendingKey(state.session);
            expect(key).toBeTruthy();
            state = gameReducer(state, row.install('campaign-1', key, row.empty));
            expect(row.pendingKey(state.session)).toBeFalsy();
        }
        expect(state.fronts || []).toEqual(initialGameState.fronts || []);
        expect(state.session.wonder ?? null).toBeNull();
    });
});
