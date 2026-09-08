/**
 * INSTALL_ABSENCE_DRIFT under hostile / ambiguous input (2026-09-08
 * living-world audit): the locality gate and the write must name the SAME
 * record, a string pending marker never installs, object fields mint no canon.
 */
import { describe, expect, it } from 'vitest';
import { gameReducer, initialGameState } from './gameReducer.js';

const msgs = n => Array.from({ length: n }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', content: `m${i}` }));

const pendingState = () => ({
    ...initialGameState,
    messages: msgs(50),
    session: {
        ...initialGameState.session,
        id: 'campaign-1',
        pendingAbsenceDrift: { key: 'loc-millhaven|50', locationName: 'Millhaven', awayDistance: 40, returnMessage: 50 },
    },
    locations: [
        { id: 'loc-millhaven', name: 'Millhaven', aliases: [], type: 'settlement', danger: 'low', theaterFrontIds: [] },
        { id: 'loc-fen', name: 'Deep Fen', aliases: [], type: 'wilderness', danger: 'high', theaterFrontIds: [] },
    ],
    npcs: [
        { id: 'npc-reeds', name: 'Maren of the Reeds', rosterTier: 'character', lastLocation: 'Deep Fen', lastNotes: 'fen witch', agenda: 'brew' },
        { id: 'npc-tallow', name: 'Maren Tallow', rosterTier: 'character', lastLocation: 'Millhaven', lastNotes: 'chandler' },
    ],
});

describe('INSTALL_ABSENCE_DRIFT resolves a development to the LOCAL matched record (P2)', () => {
    it('a bare shared first name rewrites the local NPC, never the first roster match elsewhere', () => {
        const state = pendingState();
        const next = gameReducer(state, {
            type: 'INSTALL_ABSENCE_DRIFT',
            payload: {
                sessionId: 'campaign-1',
                key: 'loc-millhaven|50',
                drift: { developments: [{ name: 'Maren', lastNotes: 'Married the miller', visible: 'A ring' }], worldFact: '', frontSymptom: '' },
            },
        });
        const reeds = next.npcs.find(npc => npc.id === 'npc-reeds');
        const tallow = next.npcs.find(npc => npc.id === 'npc-tallow');
        expect(reeds.lastNotes).toBe('fen witch');
        expect(tallow.lastNotes).toContain('Married the miller');
        expect(next.npcs).toHaveLength(2);
        // The stored development carries the resolved full name for the away block.
        expect(next.session.absenceDrift.developments[0].name).toBe('Maren Tallow');
    });

    it('a string pending marker never passes the key guard, so nothing installs', () => {
        const state = { ...pendingState(), session: { ...pendingState().session, pendingAbsenceDrift: 'yes' } };
        const next = gameReducer(state, {
            type: 'INSTALL_ABSENCE_DRIFT',
            payload: { sessionId: 'campaign-1', key: undefined, drift: { worldFact: 'A fact with no locality check' } },
        });
        expect(next).toBe(state);
    });

    it('object-shaped fact/symptom/development fields install nothing rather than "[object Object]"', () => {
        const state = pendingState();
        const next = gameReducer(state, {
            type: 'INSTALL_ABSENCE_DRIFT',
            payload: {
                sessionId: 'campaign-1',
                key: 'loc-millhaven|50',
                drift: {
                    developments: [{ name: { first: 'Maren' }, lastNotes: { x: 1 } }],
                    worldFact: { text: 'ferry runs' },
                    frontSymptom: { text: 'tolls' },
                },
            },
        });
        expect(next.session.pendingAbsenceDrift).toBeNull();
        expect(next.session.absenceDrift).toBeNull();
        expect(next.worldFacts.some(fact => fact.fact.includes('[object Object]'))).toBe(false);
        expect(next.npcs).toEqual(state.npcs);
    });
});
