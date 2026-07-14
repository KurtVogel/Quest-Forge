/**
 * Reducer tests for the world-tempo pacing system: location registry wiring,
 * the recent-encounters ledger, tempo directives, and emergent fronts.
 */
import { describe, expect, it } from 'vitest';
import { gameReducer, initialGameState } from './gameReducer.js';

const front = (overrides = {}) => ({
    id: 'front-v2-1',
    title: 'The River Blockade',
    goal: 'Starve the town',
    stakes: 'Aldermill starves',
    grimPortents: ['One', 'Two', 'Three'],
    clock: 2,
    maxClock: 6,
    stage: 0,
    status: 'active',
    publicHints: [],
    faction: { name: 'Mud-Dredge Gang', goal: 'Extort river trade' },
    ...overrides,
});

describe('SET_LOCATION registry wiring', () => {
    it('registers new places and folds variants as aliases', () => {
        let state = gameReducer(initialGameState, { type: 'SET_LOCATION', payload: 'Clockwork Tower' });
        expect(state.currentLocation).toBe('Clockwork Tower');
        expect(state.locations).toHaveLength(1);

        state = gameReducer(state, { type: 'SET_LOCATION', payload: 'Library landing, Clockwork Tower' });
        expect(state.locations).toHaveLength(1);
        expect(state.locations[0].aliases).toContain('Library landing, Clockwork Tower');

        state = gameReducer(state, { type: 'SET_LOCATION', payload: 'Sunlit Orchard' });
        expect(state.locations).toHaveLength(2);
    });

    it('accepts an object payload with a profile and rejects empty names', () => {
        let state = gameReducer(initialGameState, {
            type: 'SET_LOCATION',
            payload: { name: 'Aldermill', profile: { type: 'settlement', danger: 'low' } },
        });
        expect(state.locations[0]).toMatchObject({ name: 'Aldermill', type: 'settlement', danger: 'low' });
        expect(gameReducer(state, { type: 'SET_LOCATION', payload: null })).toBe(state);
        expect(gameReducer(state, { type: 'SET_LOCATION', payload: {} })).toBe(state);
    });

    it('UPDATE_LOCATION_PROFILE enriches a known place without changing currentLocation', () => {
        let state = gameReducer(initialGameState, { type: 'SET_LOCATION', payload: 'Old Crypt' });
        state = gameReducer(state, {
            type: 'UPDATE_LOCATION_PROFILE',
            payload: { name: 'Old Crypt', profile: { type: 'hostile_site', danger: 'high', theaterFrontIds: ['front-v2-1'] } },
        });
        expect(state.locations[0]).toMatchObject({ type: 'hostile_site', danger: 'high', theaterFrontIds: ['front-v2-1'] });
        expect(state.currentLocation).toBe('Old Crypt');
    });
});

describe('END_COMBAT encounter ledger', () => {
    it('records the fight with enemies, location, and outcome', () => {
        const state = {
            ...initialGameState,
            currentLocation: 'Old Crypt',
            messages: [{ role: 'user' }, { role: 'assistant' }],
            combat: {
                ...initialGameState.combat,
                active: true,
                xpAwarded: true,
                enemies: [{ name: 'Ghoul 1', hp: 0 }, { name: 'Ghoul 2', hp: 0 }],
            },
        };
        const next = gameReducer(state, { type: 'END_COMBAT', payload: {} });
        expect(next.combat.active).toBe(false);
        expect(next.recentEncounters).toHaveLength(1);
        expect(next.recentEncounters[0]).toMatchObject({
            enemies: '2× Ghoul', location: 'Old Crypt', outcome: 'victory', messageIndex: 2,
        });

        const fled = gameReducer({ ...state, recentEncounters: next.recentEncounters }, {
            type: 'END_COMBAT', payload: { escaped: true, slainXpOnly: true },
        });
        expect(fled.recentEncounters).toHaveLength(2);
        expect(fled.recentEncounters[1].outcome).toBe('escaped');
    });
});

describe('APPLY_TEMPO_DIRECTIVE', () => {
    const base = {
        ...initialGameState,
        fronts: [front()],
        messages: Array.from({ length: 20 }, () => ({})),
        settings: { ...initialGameState.settings, paceDial: 'standard' },
    };

    it('stores an engine-validated directive with the timing die applied', () => {
        const next = gameReducer(base, {
            type: 'APPLY_TEMPO_DIRECTIVE',
            payload: {
                cadenceId: 'journal-s1-20',
                timingDelay: 1,
                directive: { front_id: 'front-v2-1', max_intensity: 'confrontation', where: 'the docks' },
            },
        });
        expect(next.worldTempo.lastCadenceId).toBe('journal-s1-20');
        expect(next.worldTempo.directive).toMatchObject({
            frontId: 'front-v2-1',
            maxIntensity: 'indirect', // clock 2/6 band clamps the requested confrontation
            activatesAtMessage: 22,
        });
    });

    it('is idempotent per cadence and degrades garbage to quiet', () => {
        const first = gameReducer(base, {
            type: 'APPLY_TEMPO_DIRECTIVE',
            payload: { cadenceId: 'cad-1', directive: { front_id: 'front-v2-1' }, timingDelay: 0 },
        });
        expect(gameReducer(first, {
            type: 'APPLY_TEMPO_DIRECTIVE',
            payload: { cadenceId: 'cad-1', directive: { front_id: 'front-v2-1' }, timingDelay: 3 },
        })).toBe(first);

        const quiet = gameReducer(base, {
            type: 'APPLY_TEMPO_DIRECTIVE',
            payload: { cadenceId: 'cad-2', directive: { front_id: 'front-unknown' } },
        });
        expect(quiet.worldTempo.directive.frontId).toBeNull();
    });

    it('clamps to whispers away from a homed front, and grows theaters from directive placements', () => {
        // First directive places the front's symptom at the docks → the docks
        // become part of its home theater.
        let state = gameReducer(base, {
            type: 'APPLY_TEMPO_DIRECTIVE',
            payload: { cadenceId: 'cad-a', directive: { front_id: 'front-v2-1', max_intensity: 'indirect', where: 'River Docks' }, timingDelay: 0 },
        });
        const docks = state.locations.find(l => l.name === 'River Docks');
        expect(docks.theaterFrontIds).toEqual(['front-v2-1']);

        // Far from home, an intervening quiet cadence later, only news reaches.
        state = gameReducer(state, {
            type: 'APPLY_TEMPO_DIRECTIVE',
            payload: { cadenceId: 'cad-b', directive: { front_id: null } },
        });
        state = gameReducer(state, { type: 'SET_LOCATION', payload: 'Distant Icefield' });
        const next = gameReducer(state, {
            type: 'APPLY_TEMPO_DIRECTIVE',
            payload: { cadenceId: 'cad-c', directive: { front_id: 'front-v2-1', max_intensity: 'indirect' }, timingDelay: 0 },
        });
        expect(next.worldTempo.directive).toMatchObject({ frontId: 'front-v2-1', maxIntensity: 'whispers' });
    });
});

describe('ADD_EMERGENT_FRONT', () => {
    const proposal = {
        title: 'The Goblin Warrens',
        goal: 'Expand raids from the forest den',
        stakes: 'The forest roads become impassable',
        grim_portents: ['Traps appear', 'A patrol vanishes', 'A village burns'],
        faction: { name: 'Redfang Tribe', goal: 'Claim the forest' },
        reason: 'The player has raided the den twice; it keeps mattering.',
    };
    const base = { ...initialGameState, fronts: [front()], session: { id: 's1' } };

    it('adds a validated emergent front at clock 0 with no visible system line', () => {
        const next = gameReducer(base, {
            type: 'ADD_EMERGENT_FRONT',
            payload: { cadenceId: 'cad-9', proposal },
        });
        expect(next.fronts).toHaveLength(2);
        expect(next.fronts[1]).toMatchObject({ title: 'The Goblin Warrens', clock: 0, stage: 0, status: 'active' });
        expect(next.fronts[1].id).toMatch(/^front-em-/);
        expect(next.messages).toHaveLength(0);
        expect(next.session.frontDirector.lastEmergentCadenceId).toBe('cad-9');

        // Same cadence replayed: no second front.
        expect(gameReducer(next, { type: 'ADD_EMERGENT_FRONT', payload: { cadenceId: 'cad-9', proposal } })).toBe(next);
    });

    it('rejects incomplete proposals, duplicates, and enforces the active-front cap', () => {
        expect(gameReducer(base, {
            type: 'ADD_EMERGENT_FRONT',
            payload: { cadenceId: 'cad-1', proposal: { title: 'Half-formed' } },
        })).toBe(base);

        expect(gameReducer(base, {
            type: 'ADD_EMERGENT_FRONT',
            payload: { cadenceId: 'cad-2', proposal: { ...proposal, faction: { name: 'Mud-Dredge Gang', goal: 'x' } } },
        })).toBe(base);

        const crowded = {
            ...base,
            fronts: [front(), front({ id: 'f2', title: 'B', faction: { name: 'B2', goal: 'g' } }),
                front({ id: 'f3', title: 'C', faction: { name: 'C2', goal: 'g' } }),
                front({ id: 'f4', title: 'D', faction: { name: 'D2', goal: 'g' } })],
        };
        expect(gameReducer(crowded, {
            type: 'ADD_EMERGENT_FRONT',
            payload: { cadenceId: 'cad-3', proposal },
        })).toBe(crowded);
    });
});
