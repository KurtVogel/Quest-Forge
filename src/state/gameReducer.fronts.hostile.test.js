/**
 * UPDATE_FRONT under hostile DM shapes (2026-09-08 hidden-fronts audit): junk
 * clock/status must not soften or revive, hints accumulate, object notes mint
 * no canon.
 */
import { describe, expect, it } from 'vitest';
import { gameReducer, initialGameState } from './gameReducer.js';

const msgs = n => Array.from({ length: n }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', content: `m${i}` }));

const state = () => ({
    ...initialGameState,
    messages: msgs(30),
    fronts: [{
        id: 'known',
        title: 'The Mill Brood',
        goal: 'Own the mill',
        stakes: 'The town starves',
        grimPortents: ['a', 'b', 'c', 'd'],
        clock: 3,
        maxClock: 6,
        stage: 1,
        status: 'active',
        publicHints: ['old hint'],
    }],
});

describe('UPDATE_FRONT junk-means-omit and hint accumulation', () => {
    it('a null / "unchanged" clock never softens the front (P1)', () => {
        let next = state();
        for (const junk of [null, 'unchanged', '']) {
            next = gameReducer(next, { type: 'UPDATE_FRONT', payload: { id: 'known', clock: junk, stage: junk, notes: 'no change' } });
        }
        expect(next.fronts[0].clock).toBe(3);
        expect(next.fronts[0].stage).toBe(1);
        expect(next.fronts[0].notes).toBe('no change');
    });

    it('an unknown or null status never revives a dormant front', () => {
        const dormant = { ...state(), fronts: [{ ...state().fronts[0], status: 'dormant' }] };
        for (const junk of ['ongoing', null, 'escalating']) {
            expect(gameReducer(dormant, { type: 'UPDATE_FRONT', payload: { id: 'known', status: junk } }).fronts[0].status).toBe('dormant');
        }
    });

    it('a string hint APPENDS to the ledger (deduped) instead of replacing it', () => {
        const once = gameReducer(state(), { type: 'UPDATE_FRONT', payload: { id: 'known', publicHints: 'Refugees whisper' } });
        expect(once.fronts[0].publicHints).toEqual(['old hint', 'Refugees whisper']);
        const twice = gameReducer(once, { type: 'UPDATE_FRONT', payload: { id: 'known', publicHints: ['refugees whisper', 'A toll doubles'] } });
        expect(twice.fronts[0].publicHints).toEqual(['old hint', 'Refugees whisper', 'A toll doubles']);
        const empty = gameReducer(twice, { type: 'UPDATE_FRONT', payload: { id: 'known', publicHints: [] } });
        expect(empty.fronts[0].publicHints).toEqual(['old hint', 'Refugees whisper', 'A toll doubles']);
    });

    it('an object notes on a resolution mints no "[object Object]" canon', () => {
        const next = gameReducer(state(), { type: 'UPDATE_FRONT', payload: { id: 'known', status: 'resolved', notes: { how: 'burned' } } });
        expect(next.fronts[0].status).toBe('resolved');
        expect(next.fronts[0].resolution).toBe('');
        const canon = next.worldFacts.map(f => f.fact).join('\n') + next.messages.map(m => m.content).join('\n');
        expect(canon).not.toContain('[object Object]');
        expect(canon).toContain('"The Mill Brood"');
    });
});

describe('typed pending markers on the one-shot installers (P2)', () => {
    it('INSTALL_AFTERMATH_FRONTS refuses a string marker whose frontId is undefined on both sides', () => {
        const s = { ...state(), session: { ...initialGameState.session, id: 's1', pendingFrontAftermath: 'front-known' } };
        expect(gameReducer(s, { type: 'INSTALL_AFTERMATH_FRONTS', payload: { sessionId: 's1', frontId: undefined, fronts: [] } })).toBe(s);
    });

    it('INSTALL_REGIONAL_FRONTS refuses a string marker whose key is undefined on both sides', () => {
        const s = { ...state(), session: { ...initialGameState.session, id: 's1', pendingRegionalFronts: 'yes' } };
        expect(gameReducer(s, { type: 'INSTALL_REGIONAL_FRONTS', payload: { sessionId: 's1', key: undefined, fronts: [] } })).toBe(s);
    });
});
