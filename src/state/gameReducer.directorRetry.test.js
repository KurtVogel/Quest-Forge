/**
 * The background directors' give-up rule (2026-09-20 audit, living-world P1):
 * a `pending*` marker survives turns, departures and reloads by design — so a
 * failed director call must be counted, backed off, and finally CONSUMED, or a
 * deterministic failure costs one hidden DM-model call per turn forever and
 * the stuck marker (an exclusive gate) blocks its whole lane.
 */
import { describe, expect, it, vi } from 'vitest';
import { gameReducer, initialGameState } from './gameReducer.js';
import { ABSENCE_DRIFT_MIN_AWAY } from '../engine/worldTempo.js';
import {
    DIRECTOR_MAX_ATTEMPTS,
    DIRECTOR_RETRY_MIN_DISTANCE,
    isDirectorBackingOff,
    sanitizeDirectorFailures,
} from '../engine/directorRetry.js';

const msgs = n => Array.from({ length: n }, (_, i) => ({
    role: i % 2 ? 'assistant' : 'user',
    content: `m${i}`,
}));
const atMessages = (state, n) => ({ ...state, messages: msgs(n) });

const withSession = (session, messageCount = 20) => ({
    ...initialGameState,
    messages: msgs(messageCount),
    session: { ...initialGameState.session, id: 'campaign-1', ...session },
});
const fail = (state, name, key, sessionId = 'campaign-1') =>
    gameReducer(state, { type: 'DIRECTOR_ATTEMPT_FAILED', payload: { sessionId, name, key } });

const aftermath = { frontId: 'front-brood', title: 'The Mill Brood', resolvedAt: 1 };

describe('DIRECTOR_ATTEMPT_FAILED', () => {
    it('counts a failure against the pending marker and holds the key back for the backoff distance', () => {
        const state = fail(withSession({ pendingFrontAftermath: aftermath }), 'frontAftermath', 'front-brood');
        expect(state.session.directorFailures.frontAftermath).toEqual({ key: 'front-brood', attempts: 1, atMessage: 20 });
        expect(state.session.pendingFrontAftermath).toEqual(aftermath);

        expect(isDirectorBackingOff(state.session, 'frontAftermath', 'front-brood', state.messages)).toBe(true);
        const later = atMessages(state, 20 + DIRECTOR_RETRY_MIN_DISTANCE);
        expect(isDirectorBackingOff(later.session, 'frontAftermath', 'front-brood', later.messages)).toBe(false);
        // Another key (a newer resolution) is never held back by this tally.
        expect(isDirectorBackingOff(state.session, 'frontAftermath', 'front-other', state.messages)).toBe(false);
    });

    it('backoff is conversational: engine system lines do not age it', () => {
        const state = fail(withSession({ pendingFrontAftermath: aftermath }), 'frontAftermath', 'front-brood');
        const systemLines = Array.from({ length: 12 }, () => ({ role: 'system', content: 'engine line' }));
        const messages = [...state.messages, ...systemLines];
        expect(isDirectorBackingOff(state.session, 'frontAftermath', 'front-brood', messages)).toBe(true);
    });

    it('gives up on the third failure and consumes the marker as the quiet answer — every director', () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const cases = [
            ['frontAftermath', 'front-brood', { pendingFrontAftermath: aftermath }, 'pendingFrontAftermath'],
            ['absenceDrift', 'loc-a|50', { pendingAbsenceDrift: { key: 'loc-a|50', locationName: 'Aldermill', awayDistance: 40, returnMessage: 50 } }, 'pendingAbsenceDrift'],
            ['regionalFronts', 'the saltreach|12', { pendingRegionalFronts: { key: 'the saltreach|12', region: 'The Saltreach', locationName: 'Pikehold', atMessage: 12 } }, 'pendingRegionalFronts'],
            ['wonder', 'wonder|20', { pendingWonder: { key: 'wonder|20', requestedAtMessage: 20, onDemand: false } }, 'pendingWonder'],
        ];
        for (const [name, key, session, field] of cases) {
            let state = withSession(session);
            for (let i = 0; i < DIRECTOR_MAX_ATTEMPTS; i += 1) {
                expect(state.session[field], `${name} marker before failure ${i + 1}`).toBeTruthy();
                state = fail(state, name, key);
            }
            expect(state.session[field], `${name} marker consumed`).toBeNull();
            expect(state.session.directorFailures[name]).toBeUndefined();
        }
        // The region is marked seeded, like any empty regional install.
        let regional = withSession(cases[2][2]);
        for (let i = 0; i < DIRECTOR_MAX_ATTEMPTS; i += 1) regional = fail(regional, 'regionalFronts', 'the saltreach|12');
        expect(regional.session.seededRegions).toContain('The Saltreach');
        expect(regional.fronts).toEqual(withSession({}).fronts);
        warn.mockRestore();
    });

    it('ignores a failure for a marker that is no longer pending, another campaign, or an unknown director', () => {
        const state = withSession({ pendingFrontAftermath: aftermath });
        expect(fail(state, 'frontAftermath', 'front-stale')).toBe(state);
        expect(fail(state, 'frontAftermath', 'front-brood', 'other-campaign')).toBe(state);
        expect(fail(state, 'campaignFronts', 'campaign-1')).toBe(state);
        expect(fail(state, 'toString', 'front-brood')).toBe(state);
        expect(gameReducer(state, { type: 'DIRECTOR_ATTEMPT_FAILED', payload: null })).toBe(state);
    });

    it('a new key restarts the tally', () => {
        let state = fail(fail(withSession({ pendingFrontAftermath: aftermath }), 'frontAftermath', 'front-brood'), 'frontAftermath', 'front-brood');
        expect(state.session.directorFailures.frontAftermath.attempts).toBe(2);
        state = { ...state, session: { ...state.session, pendingFrontAftermath: { ...aftermath, frontId: 'front-next' } } };
        state = fail(state, 'frontAftermath', 'front-next');
        expect(state.session.directorFailures.frontAftermath).toMatchObject({ key: 'front-next', attempts: 1 });
    });
});

describe('pending markers and the tally across a reload', () => {
    it('both survive LOAD_GAME — the retry surface the give-up rule bounds', () => {
        const failed = fail(withSession({ pendingFrontAftermath: aftermath }), 'frontAftermath', 'front-brood');
        const { user: _user, ui: _ui, settings: _settings, ...payload } = failed;
        const loaded = gameReducer(initialGameState, { type: 'LOAD_GAME', payload: JSON.parse(JSON.stringify(payload)) });
        expect(loaded.session.pendingFrontAftermath).toMatchObject({ frontId: 'front-brood' });
        expect(loaded.session.directorFailures.frontAftermath).toEqual({ key: 'front-brood', attempts: 1, atMessage: 20 });
    });

    it('an aftermath / region / wonder marker survives turns and departures (only the drift is place-bound)', () => {
        let state = withSession({
            pendingFrontAftermath: aftermath,
            pendingRegionalFronts: { key: 'r|1', region: 'The Saltreach', locationName: 'Pikehold', atMessage: 1 },
            pendingWonder: { key: 'wonder|20', requestedAtMessage: 20, onDemand: false },
        });
        state = gameReducer(state, { type: 'SET_LOCATION', payload: 'Aldermill' });
        for (let i = 0; i < 30; i += 1) state = gameReducer(state, { type: 'ADD_MESSAGE', payload: { role: i % 2 ? 'assistant' : 'user', content: `turn ${i}` } });
        state = gameReducer(state, { type: 'SET_LOCATION', payload: 'Deep Fen' });
        expect(state.session.pendingFrontAftermath).toBeTruthy();
        expect(state.session.pendingRegionalFronts).toBeTruthy();
        expect(state.session.pendingWonder).toBeTruthy();
    });

    it('types a hostile tally at load: known names, complete entries, stamps clamped to the transcript', () => {
        expect(sanitizeDirectorFailures({
            frontAftermath: { key: 'front-brood', attempts: '2', atMessage: 9999 },
            absenceDrift: { key: { evil: true }, attempts: 1, atMessage: 3 },
            wonder: 'junk',
            regionalFronts: { key: 'r|1', attempts: 99, atMessage: 4 },
            constructor: { key: 'x', attempts: 1, atMessage: 1 },
        }, { maxMessageCount: 30 })).toEqual({
            frontAftermath: { key: 'front-brood', attempts: 2, atMessage: 30 },
            regionalFronts: { key: 'r|1', attempts: DIRECTOR_MAX_ATTEMPTS, atMessage: 4 },
        });
        expect(sanitizeDirectorFailures('junk')).toEqual({});
        expect(sanitizeDirectorFailures(null)).toEqual({});
    });
});

describe('a pending absence drift is cancelled when the hero leaves the return place (P2)', () => {
    const homecoming = () => {
        let state = gameReducer(atMessages(initialGameState, 0), { type: 'SET_LOCATION', payload: 'Aldermill' });
        state = gameReducer(atMessages(state, 10), { type: 'SET_LOCATION', payload: 'Deep Fen' });
        return gameReducer(atMessages(state, 10 + ABSENCE_DRIFT_MIN_AWAY + 5), { type: 'SET_LOCATION', payload: 'Aldermill' });
    };

    it('an unrelated arrival clears the marker', () => {
        const home = homecoming();
        expect(home.session.pendingAbsenceDrift).toMatchObject({ locationName: 'Aldermill' });
        const left = gameReducer(atMessages(home, 50), { type: 'SET_LOCATION', payload: 'Pikehold' });
        expect(left.session.pendingAbsenceDrift).toBeNull();
    });

    it('moving inside the same settlement keeps it', () => {
        const home = homecoming();
        const inside = gameReducer(atMessages(home, 50), { type: 'SET_LOCATION', payload: 'The Gilded Eel, Aldermill' });
        expect(inside.session.pendingAbsenceDrift).toMatchObject({ locationName: 'Aldermill' });
    });

    it('a stale marker no longer blocks the next homecoming from raising its own', () => {
        let state = homecoming();
        state = gameReducer(atMessages(state, 50), { type: 'SET_LOCATION', payload: 'Deep Fen' });
        expect(state.session.pendingAbsenceDrift).toBeNull();
        // A stuck marker for a place long left, then a genuine long return elsewhere.
        state = { ...state, session: { ...state.session, pendingAbsenceDrift: { key: 'gone|1', locationName: 'Pikehold', awayDistance: 40, returnMessage: 1 } } };
        state = gameReducer(atMessages(state, 50 + ABSENCE_DRIFT_MIN_AWAY + 30), { type: 'SET_LOCATION', payload: 'Aldermill' });
        expect(state.session.pendingAbsenceDrift).toMatchObject({ locationName: 'Aldermill' });
    });
});
