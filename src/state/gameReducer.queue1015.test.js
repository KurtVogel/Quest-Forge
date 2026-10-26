/**
 * Queue sweep 2026-10-15 (hidden-fronts + living-world, Lap 1): an update
 * never renames a front, the theater grows only on an in-theater grant, a
 * resolved front's faction does not block its successor, the alternation
 * guard reads the previous JOURNAL cadence, a quiet drift still cools the
 * homecoming, a region met at a full web is deferred and seeded on the next
 * arrival, the drift symptom binds to the offered front, and the away block
 * yields its symptom under an open tempo window.
 */
import { describe, expect, it } from 'vitest';
import { gameReducer, initialGameState } from './gameReducer.js';
import { applyFrontAdvanceBatch, cadenceIdFor, normalizeFrontProposal, normalizeFrontUpdate } from '../engine/fronts.js';
import { ABSENCE_DRIFT_MIN_AWAY } from '../engine/worldTempo.js';
import { buildWhileYouWereAwayBlock } from '../llm/absenceDrift.js';

const msgs = n => Array.from({ length: n }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', content: `m${i}` }));
const atMessages = (state, n) => ({ ...state, messages: msgs(n) });

const front = (overrides = {}) => ({
    id: 'front-v2-1', title: 'The River Blockade', goal: 'Starve the town', stakes: 'Aldermill starves',
    grimPortents: ['One', 'Two', 'Three'], clock: 2, maxClock: 6, stage: 0, status: 'active', publicHints: [],
    faction: { name: 'Mud-Dredge Gang', goal: 'Extort river trade' },
    ...overrides,
});

const proposal = (overrides = {}) => ({
    title: 'The Second Tithe', goal: 'Bleed the weirs', stakes: 'The weirs fall silent',
    grim_portents: ['a', 'b', 'c'], faction: { name: 'The Saltmarsh Reavers', goal: 'Rule the marsh', stance: 'hostile' },
    ...overrides,
});

describe('an update never renames a front (2026-10-15 P2, measured)', () => {
    it('normalizeFrontUpdate drops `title` and refuses an id-less update', () => {
        expect(normalizeFrontUpdate({ id: 'front-v2-1', title: 'A Name The DM Invented', clock: 3 })).toEqual({ id: 'front-v2-1', clock: 3 });
        expect(normalizeFrontUpdate({ title: 'A Name The DM Invented', clock: 3 })).toBeNull();
    });

    it('UPDATE_FRONT with a title keeps the stored title, and the resolution fact carries it', () => {
        const state = { ...initialGameState, fronts: [front()], messages: msgs(6), character: { ...initialGameState.character, name: 'Astra', level: 3, exp: 0 } };
        const renamed = gameReducer(state, { type: 'UPDATE_FRONT', payload: { id: 'front-v2-1', title: 'A Name The DM Invented', notes: 'softened' } });
        expect(renamed.fronts[0].title).toBe('The River Blockade');
        const resolved = gameReducer(state, { type: 'UPDATE_FRONT', payload: { id: 'front-v2-1', title: 'A Name The DM Invented', status: 'resolved', notes: 'The blockade is broken.' } });
        expect(resolved.fronts[0].title).toBe('The River Blockade');
        expect(resolved.worldFacts.some(f => f.fact.includes('"The River Blockade"'))).toBe(true);
        expect(resolved.worldFacts.some(f => f.fact.includes('Invented'))).toBe(false);
    });
});

describe('the theater grows only on an in-theater grant (2026-10-15 P2, measured)', () => {
    const base = {
        ...initialGameState,
        fronts: [front({ clock: 4 })],
        messages: msgs(20),
        currentLocation: 'Icefield',
        locations: [
            { id: 'docks', name: 'Docks', aliases: [], theaterFrontIds: ['front-v2-1'] },
            { id: 'icefield', name: 'Icefield', aliases: [], theaterFrontIds: [] },
        ],
        settings: { ...initialGameState.settings, paceDial: 'standard' },
    };
    const grant = (state, cadenceId, where) => gameReducer(state, {
        type: 'APPLY_TEMPO_DIRECTIVE',
        payload: { cadenceId, timingDelay: 0, directive: { front_id: 'front-v2-1', max_intensity: 'presence', where } },
    });

    it('a grant clamped to whispers outside the theater does not make its place a theater', () => {
        const next = grant(base, 'c1', 'Icefield');
        expect(next.worldTempo.directive.maxIntensity).toBe('whispers');
        expect(next.worldTempo.directive.inTheater).toBe(false);
        expect(next.locations.find(r => r.name === 'Icefield').theaterFrontIds).toEqual([]);
        // …so the same ask one quiet cadence later is still whispers.
        const quiet = gameReducer(next, { type: 'APPLY_TEMPO_DIRECTIVE', payload: { cadenceId: 'c2', timingDelay: 0, directive: { front_id: null } } });
        const again = grant(quiet, 'c3', 'Icefield');
        expect(again.worldTempo.directive.maxIntensity).toBe('whispers');
    });

    it('an in-theater grant and a homeless front still grow the theater', () => {
        const inTheater = grant(base, 'c1', 'Docks');
        expect(inTheater.worldTempo.directive.inTheater).toBe(true);
        const homeless = grant({ ...base, locations: base.locations.map(r => ({ ...r, theaterFrontIds: [] })) }, 'c1', 'Icefield');
        expect(homeless.worldTempo.directive.inTheater).toBe(true);
        expect(homeless.locations.find(r => r.name === 'Icefield').theaterFrontIds).toEqual(['front-v2-1']);
    });
});

describe('the successor dedupe reads the LIVE web (2026-10-15 P2, measured)', () => {
    it('a resolved front\'s faction does not block its successor; an active one does; a title always does', () => {
        const resolved = front({ id: 'f-old', title: 'The Saltmarsh Tithe', status: 'resolved', faction: { name: 'The Saltmarsh Reavers', goal: 'x' } });
        expect(normalizeFrontProposal(proposal(), { existing: [resolved] })).not.toBeNull();
        expect(normalizeFrontProposal(proposal(), { existing: [{ ...resolved, status: 'active' }] })).toBeNull();
        expect(normalizeFrontProposal(proposal({ title: 'The Saltmarsh Tithe' }), { existing: [resolved] })).toBeNull();
    });

    it('INSTALL_AFTERMATH_FRONTS installs a successor driven by the resolved front\'s faction', () => {
        const resolved = front({ id: 'f-old', title: 'The Saltmarsh Tithe', status: 'resolved', resolvedAtMessage: 4, faction: { name: 'The Saltmarsh Reavers', goal: 'x' } });
        const state = {
            ...initialGameState, fronts: [resolved], messages: msgs(6),
            session: { ...initialGameState.session, id: 's1', pendingFrontAftermath: { frontId: 'f-old', title: 'The Saltmarsh Tithe' } },
        };
        const next = gameReducer(state, { type: 'INSTALL_AFTERMATH_FRONTS', payload: { sessionId: 's1', frontId: 'f-old', fronts: [proposal()] } });
        expect(next.fronts.map(f => f.title)).toContain('The Second Tithe');
    });
});

describe('the alternation guard reads the previous JOURNAL cadence (2026-10-15 nit)', () => {
    it('cadenceIdFor composes the id the reflection mints', () => {
        expect(cadenceIdFor('s1', 20)).toBe('journal-s1-20');
        expect(cadenceIdFor(undefined, 20)).toBe('journal-campaign-20');
    });

    it('a gain two cadences ago with a failed reflection between does not hold the clock', () => {
        const gained = applyFrontAdvanceBatch([front()], { cadenceId: 'journal-s1-10', advances: [{ id: 'front-v2-1', delta: 1, reason: 'r', symptom: 's' }] }).fronts;
        const state = {
            ...initialGameState, fronts: gained, messages: msgs(30),
            session: { ...initialGameState.session, id: 's1', frontDirector: { generationVersion: 2, lastCadenceId: 'journal-s1-10', lastJournalEnd: 10 } },
            // Three cadences: 10 (gained), 20 (its reflection FAILED — nothing applied), 30 (now).
            journal: [{ id: 'j1', summary: 'a', messageRange: [0, 10] }, { id: 'j2', summary: 'b', messageRange: [10, 20] }, { id: 'j3', summary: 'c', messageRange: [20, 30] }],
        };
        const next = gameReducer(state, { type: 'APPLY_FRONT_ADVANCE_BATCH', payload: { cadenceId: 'journal-s1-30', journalEnd: 30, advances: [{ id: 'front-v2-1', delta: 1, reason: 'r', symptom: 's' }] } });
        expect(next.fronts[0].clock).toBe(4);
        // The immediately previous cadence DID gain: held.
        const held = gameReducer({ ...state, journal: state.journal.slice(0, 1).concat([{ id: 'j3', summary: 'c', messageRange: [10, 30] }]) },
            { type: 'APPLY_FRONT_ADVANCE_BATCH', payload: { cadenceId: 'journal-s1-30', journalEnd: 30, advances: [{ id: 'front-v2-1', delta: 1, reason: 'r', symptom: 's' }] } });
        expect(held.fronts[0].clock).toBe(3);
    });
});

describe('a quiet drift still cools the homecoming (2026-10-15 P2, measured)', () => {
    const travel = () => {
        let state = gameReducer(atMessages(initialGameState, 0), { type: 'SET_LOCATION', payload: 'Millhaven' });
        state = gameReducer(atMessages(state, 2), { type: 'SET_LOCATION', payload: 'The Gilded Eel' });
        return gameReducer(atMessages(state, 10), { type: 'SET_LOCATION', payload: 'Deep Fen' });
    };

    it('an empty install stamps lastAbsenceDriftMessage and the next stale record in town raises no second marker', () => {
        const returnAt = 10 + ABSENCE_DRIFT_MIN_AWAY + 5;
        let state = gameReducer(atMessages(travel(), returnAt), { type: 'SET_LOCATION', payload: 'Millhaven' });
        const pending = state.session.pendingAbsenceDrift;
        expect(pending).toMatchObject({ locationName: 'Millhaven' });
        state = gameReducer(state, { type: 'INSTALL_ABSENCE_DRIFT', payload: { sessionId: state.session.id, key: pending.key, drift: { developments: [], worldFact: '', frontSymptom: '' } } });
        expect(state.session.pendingAbsenceDrift).toBeNull();
        expect(state.session.absenceDrift ?? null).toBeNull();
        expect(state.session.lastAbsenceDriftMessage).toBe(returnAt);
        const next = gameReducer(atMessages(state, returnAt + 2), { type: 'SET_LOCATION', payload: 'The Gilded Eel' });
        expect(next.session.pendingAbsenceDrift ?? null).toBeNull();
    });

    it('the stamp clamps to the transcript at load', () => {
        const loaded = gameReducer(initialGameState, {
            type: 'LOAD_GAME',
            payload: { character: { ...initialGameState.character, name: 'A', level: 3, currentHP: 10, maxHP: 10, levelBonusRetired: true }, inventory: [], messages: msgs(4), session: { id: 's1', lastAbsenceDriftMessage: 1e9, deferredRegions: ['the Icebound Coast', { junk: true }, 'x'.repeat(200)] } },
        });
        expect(loaded.session.lastAbsenceDriftMessage).toBe(4);
        expect(loaded.session.deferredRegions).toEqual(['the Icebound Coast', 'x'.repeat(120)]);
    });
});

describe('a region met at a full web is deferred and seeded on the next arrival (2026-10-15 P2, measured)', () => {
    const traveled = () => {
        let state = atMessages(initialGameState, 20);
        state = gameReducer(state, { type: 'SET_LOCATION', payload: 'Aldermill' });
        state = gameReducer(state, { type: 'UPDATE_LOCATION_PROFILE', payload: { name: 'Aldermill', profile: { type: 'settlement', danger: 'low', region: 'the Riverlands' }, evidenceText: 'Aldermill, in the Riverlands.' } });
        state = gameReducer(state, { type: 'SET_LOCATION', payload: 'Fort Halla' });
        return { ...state, fronts: Array.from({ length: 3 }, (_, i) => front({ id: `f${i}`, title: `F${i}` })) };
    };

    it('defers at a full web, then seeds when the hero next arrives in that land with a slot free', () => {
        let state = gameReducer(traveled(), { type: 'UPDATE_LOCATION_PROFILE', payload: { name: 'Fort Halla', profile: { type: 'frontier', danger: 'moderate', region: 'the Icebound Coast' }, evidenceText: 'Fort Halla, on the Icebound Coast.' } });
        // No SEED — the only marker is the home land's face-only call (2026-10-26).
        expect(state.session.pendingRegionalFronts).toMatchObject({ region: 'the Riverlands', profileOnly: true });
        expect(state.session.deferredRegions).toEqual(['the Icebound Coast']);
        // A second Coast place while still full: still deferred, no seed.
        state = gameReducer(atMessages(state, 30), { type: 'SET_LOCATION', payload: 'Rime Quay' });
        state = gameReducer(state, { type: 'UPDATE_LOCATION_PROFILE', payload: { name: 'Rime Quay', profile: { region: 'the Icebound Coast' }, evidenceText: 'Rime Quay, on the Icebound Coast.' } });
        expect(state.session.pendingRegionalFronts).toMatchObject({ region: 'the Riverlands', profileOnly: true });
        // A front resolves, the hero arrives at a Coast place: seeded, the ledger cleared.
        state = { ...state, fronts: state.fronts.map((f, i) => (i === 0 ? { ...f, status: 'resolved' } : f)) };
        state = gameReducer(atMessages(state, 40), { type: 'SET_LOCATION', payload: 'Fort Halla' });
        expect(state.session.pendingRegionalFronts).toMatchObject({ region: 'the Icebound Coast', locationName: 'Fort Halla' });
        expect(state.session.deferredRegions).toEqual([]);
    });
});

describe('the drift symptom binds to the front the context offered (2026-10-15 nit)', () => {
    const arrive = () => {
        let state = gameReducer(atMessages(initialGameState, 0), { type: 'SET_LOCATION', payload: 'Aldermill' });
        state = gameReducer(atMessages(state, 10), { type: 'SET_LOCATION', payload: 'Deep Fen' });
        state = gameReducer(atMessages(state, 10 + ABSENCE_DRIFT_MIN_AWAY + 5), { type: 'SET_LOCATION', payload: 'Aldermill' });
        const locations = state.locations.map(r => (r.name === 'Aldermill' ? { ...r, theaterFrontIds: ['f-a', 'f-b'] } : r));
        return { ...state, locations, fronts: [front({ id: 'f-a', title: 'A', status: 'resolved' }), front({ id: 'f-b', title: 'B', clock: 1 })] };
    };

    it('a symptom written for a front that resolved in between is dropped, never re-bound to the next theater front', () => {
        const state = arrive();
        const install = (frontId) => gameReducer(state, { type: 'INSTALL_ABSENCE_DRIFT', payload: { sessionId: state.session.id, key: state.session.pendingAbsenceDrift.key, drift: { developments: [], worldFact: '', frontSymptom: 'Reavers at the weir', frontId } } });
        expect(install('f-a').session.absenceDrift ?? null).toBeNull();
        expect(install('f-b').session.absenceDrift.frontSymptom).toMatchObject({ frontId: 'f-b', text: 'Reavers at the weir' });
    });
});

describe('the away block yields its symptom under an open tempo window (2026-10-15 nit)', () => {
    const drift = {
        locationName: 'Aldermill', arrivedAtMessage: 50, awayDistance: 40,
        developments: [{ name: 'Marta', visible: 'A wedding ring' }], fact: '',
        frontSymptom: { frontId: 'f-b', maxIntensity: 'whispers', text: 'Reavers at the weir' },
    };
    const render = (tempoWindowActive) => buildWhileYouWereAwayBlock(drift, {
        currentLocation: 'Aldermill', messages: msgs(54), messageCount: 54, fronts: [front({ id: 'f-b' })], npcs: [{ name: 'Marta' }], tempoWindowActive,
    });

    it('renders the symptom only while no tempo window is open', () => {
        expect(render(false)).toContain('Reavers at the weir');
        const yielded = render(true);
        expect(yielded).toContain('Marta: A wedding ring');
        expect(yielded).not.toContain('Pressure symptom');
    });
});
