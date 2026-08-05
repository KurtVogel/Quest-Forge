/**
 * Living-world reducer tests (DECISIONS.md 2026-08-05): arrival detection and
 * visit stamps on SET_LOCATION, the traveling-rumor selection + ledger, the
 * absence-drift pending marker, and the one-shot INSTALL_ABSENCE_DRIFT.
 */
import { describe, expect, it } from 'vitest';
import { gameReducer, initialGameState } from './gameReducer.js';
import { ABSENCE_DRIFT_MIN_AWAY } from '../engine/worldTempo.js';

const msgs = n => Array.from({ length: n }, (_, i) => ({
    role: i % 2 ? 'assistant' : 'user',
    content: `m${i}`,
}));

const atMessages = (state, n) => ({ ...state, messages: msgs(n) });

describe('SET_LOCATION visit stamps and arrival detection', () => {
    it('stamps lastVisitedMessage on mint and on the departed record when leaving', () => {
        let state = gameReducer(atMessages(initialGameState, 4), { type: 'SET_LOCATION', payload: 'Aldermill' });
        expect(state.locations[0].lastVisitedMessage).toBe(4);

        state = gameReducer(atMessages(state, 10), { type: 'SET_LOCATION', payload: 'Deep Fen' });
        const aldermill = state.locations.find(record => record.name === 'Aldermill');
        expect(aldermill.lastVisitedMessage).toBe(10); // departure stamp
        expect(state.locations.find(record => record.name === 'Deep Fen').lastVisitedMessage).toBe(10);
    });

    it('does not treat an alias re-statement of the current place as an arrival', () => {
        let state = gameReducer(atMessages(initialGameState, 2), { type: 'SET_LOCATION', payload: 'Clockwork Tower' });
        state = { ...state, session: { ...state.session, regionalHearsay: { locationName: 'Clockwork Tower', arrivedAtMessage: 2, items: [{ text: 'x', grade: 'firsthand' }] } } };
        const next = gameReducer(atMessages(state, 6), { type: 'SET_LOCATION', payload: 'Library landing, Clockwork Tower' });
        expect(next.locations).toHaveLength(1);
        // Not an arrival: hearsay state untouched, no pending drift.
        expect(next.session.regionalHearsay).toBe(state.session.regionalHearsay);
        expect(next.session.pendingAbsenceDrift).toBeUndefined();
    });
});

describe('absence-drift pending marker', () => {
    const travel = () => {
        let state = gameReducer(atMessages(initialGameState, 0), { type: 'SET_LOCATION', payload: 'Aldermill' });
        return gameReducer(atMessages(state, 10), { type: 'SET_LOCATION', payload: 'Deep Fen' });
    };

    it('raises the one-shot marker on a long-enough return', () => {
        const returnAt = 10 + ABSENCE_DRIFT_MIN_AWAY + 5;
        const state = gameReducer(atMessages(travel(), returnAt), { type: 'SET_LOCATION', payload: 'Aldermill' });
        expect(state.session.pendingAbsenceDrift).toMatchObject({
            locationName: 'Aldermill',
            returnMessage: returnAt,
        });
        expect(state.session.pendingAbsenceDrift.awayDistance).toBeGreaterThanOrEqual(ABSENCE_DRIFT_MIN_AWAY);
        expect(state.session.pendingAbsenceDrift.key).toContain(`|${returnAt}`);
    });

    it('stays quiet on a short hop, a first visit, or when one is already pending', () => {
        const short = gameReducer(atMessages(travel(), 20), { type: 'SET_LOCATION', payload: 'Aldermill' });
        expect(short.session.pendingAbsenceDrift).toBeUndefined();

        const first = gameReducer(atMessages(initialGameState, 60), { type: 'SET_LOCATION', payload: 'Brand New Town' });
        expect(first.session.pendingAbsenceDrift).toBeUndefined();

        const withPending = {
            ...travel(),
            session: { ...travel().session, pendingAbsenceDrift: { key: 'other|1', locationName: 'Elsewhere', awayDistance: 50, returnMessage: 1 } },
        };
        const kept = gameReducer(atMessages(withPending, 60), { type: 'SET_LOCATION', payload: 'Aldermill' });
        expect(kept.session.pendingAbsenceDrift.key).toBe('other|1');
    });
});

describe('traveling rumor on arrival', () => {
    const withDeeds = () => ({
        ...initialGameState,
        fronts: [{ id: 'front-brood', title: 'The Mill Brood', status: 'resolved', resolvedAtMessage: 0, resolution: 'burned out' }],
        messages: msgs(30),
    });

    it('installs hearsay + ledger on arrival, and never re-offers the same deed at the same place', () => {
        let state = gameReducer(withDeeds(), { type: 'SET_LOCATION', payload: 'Saltmarsh' });
        expect(state.session.regionalHearsay).toMatchObject({ locationName: 'Saltmarsh', arrivedAtMessage: 30 });
        expect(state.session.regionalHearsay.items[0].text).toContain('The Mill Brood');
        expect(state.recentHearsay).toHaveLength(1);
        expect(state.recentHearsay[0]).toMatch(/^front:front-brood\|/);

        // Leave and return: the ledger blocks the repeat, hearsay clears.
        state = gameReducer(atMessages(state, 34), { type: 'SET_LOCATION', payload: 'Deep Fen' });
        state = gameReducer(atMessages(state, 38), { type: 'SET_LOCATION', payload: 'Saltmarsh' });
        expect(state.session.regionalHearsay).toBeNull();
        expect(state.recentHearsay).toHaveLength(2); // Deep Fen arrival earned its own offer
    });
});

describe('INSTALL_ABSENCE_DRIFT', () => {
    const pendingState = () => ({
        ...initialGameState,
        messages: msgs(50),
        session: {
            ...initialGameState.session,
            id: 'campaign-1',
            pendingAbsenceDrift: { key: 'loc-aldermill|50', locationName: 'Aldermill', awayDistance: 40, returnMessage: 50 },
        },
        locations: [{ id: 'loc-aldermill', name: 'Aldermill', aliases: [], type: 'settlement', danger: 'low', theaterFrontIds: ['front-tithe'] }],
        fronts: [{ id: 'front-tithe', title: 'The Tithe Collectors', status: 'active', clock: 4, maxClock: 6, stage: 1, faction: { name: 'Grey Ledger' } }],
        npcs: [{ id: 'npc-marta', name: 'Marta', rosterTier: 'character', lastLocation: 'Aldermill', lastNotes: 'Worried about her brother' }],
    });

    const drift = {
        developments: [
            { name: 'Marta', agenda: 'Keep the new roof paid off', lastNotes: 'Married the ferryman; the inn thrives', visible: 'A wedding ring' },
            { name: 'Invented Stranger', lastNotes: 'Should be filtered out' },
        ],
        worldFact: 'The ferry runs again under a new pilot',
        frontSymptom: 'Toll receipts nailed to the notice board',
    };

    it('installs bounded NPC changes, the fact, and a band-clamped theater symptom, one-shot', () => {
        const state = pendingState();
        const next = gameReducer(state, { type: 'INSTALL_ABSENCE_DRIFT', payload: { sessionId: 'campaign-1', key: 'loc-aldermill|50', drift } });

        expect(next.session.pendingAbsenceDrift).toBeNull();
        const marta = next.npcs.find(npc => npc.name === 'Marta');
        expect(marta.lastNotes).toContain('Married the ferryman');
        expect(marta.agenda).toContain('new roof');
        expect(next.npcs.some(npc => npc.name === 'Invented Stranger')).toBe(false);
        expect(next.worldFacts.some(fact => fact.fact.includes('ferry runs again'))).toBe(true);
        expect(next.session.absenceDrift).toMatchObject({
            locationName: 'Aldermill',
            arrivedAtMessage: 50,
            frontSymptom: { frontId: 'front-tithe', maxIntensity: 'presence' },
        });
        expect(next.session.absenceDrift.developments).toHaveLength(1);

        // Replay of the same result is a no-op once the pending marker is spent.
        expect(gameReducer(next, { type: 'INSTALL_ABSENCE_DRIFT', payload: { sessionId: 'campaign-1', key: 'loc-aldermill|50', drift } })).toBe(next);
    });

    it('drops stale, cross-session, or mismatched results without mutation', () => {
        const state = pendingState();
        expect(gameReducer(state, { type: 'INSTALL_ABSENCE_DRIFT', payload: { sessionId: 'other', key: 'loc-aldermill|50', drift } })).toBe(state);
        expect(gameReducer(state, { type: 'INSTALL_ABSENCE_DRIFT', payload: { sessionId: 'campaign-1', key: 'loc-aldermill|1', drift } })).toBe(state);
    });

    it('treats a quiet proposal as a clean, install-nothing answer', () => {
        const state = pendingState();
        const next = gameReducer(state, {
            type: 'INSTALL_ABSENCE_DRIFT',
            payload: { sessionId: 'campaign-1', key: 'loc-aldermill|50', drift: { developments: [], worldFact: '', frontSymptom: '' } },
        });
        expect(next.session.pendingAbsenceDrift).toBeNull();
        expect(next.session.absenceDrift).toBeNull();
        expect(next.npcs).toBe(state.npcs);
    });

    it('drops a symptom when no active front holds the place', () => {
        const state = pendingState();
        state.fronts = [{ ...state.fronts[0], status: 'resolved' }];
        const next = gameReducer(state, {
            type: 'INSTALL_ABSENCE_DRIFT',
            payload: { sessionId: 'campaign-1', key: 'loc-aldermill|50', drift: { developments: [], worldFact: '', frontSymptom: 'Something ominous' } },
        });
        expect(next.session.absenceDrift).toBeNull();
    });
});

describe('LOAD_GAME sanitation', () => {
    it('sanitizes the hearsay ledger from hostile saves', () => {
        const loaded = gameReducer(initialGameState, {
            type: 'LOAD_GAME',
            payload: {
                ...initialGameState,
                session: { id: 'campaign-1' },
                character: { name: 'Hero', race: 'human', class: 'fighter', level: 1, maxHP: 10, currentHP: 10, abilityScores: { STR: 10, DEX: 10, CON: 10, INT: 10, WIS: 10, CHA: 10 } },
                recentHearsay: [null, 42, 'fight:1|town|1', {}],
            },
        });
        expect(loaded.recentHearsay).toEqual(['fight:1|town|1']);
    });
});
