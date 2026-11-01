import { describe, expect, it } from 'vitest';
import { gameReducer, initialGameState } from './gameReducer.js';
import { judgeLatest } from './repeatJudge.testUtils.js';

// Doubles — "the worst problem for the game, always" (Vesa, 2026-10-31). Two
// structural rules replace the per-name heuristics: one accountant per
// narration (scribe.test.js / scribeAudits) and ONE 12-message replay window
// for every gain, items matched across a renamed recap.

const pair = (state, i) => ({
    ...state,
    messages: [...state.messages, { id: `u${i}`, role: 'user', content: `beat ${i}` }, { id: `a${i}`, role: 'assistant', content: `reply ${i}` }],
});
const turns = (state, n) => Array.from({ length: n }).reduce((s, _, i) => pair(s, `${s.messages.length}-${i}`), state);
const base = () => ({ ...initialGameState, character: { ...initialGameState.character, name: 'Brenna', gold: 0, silver: 0, copper: 0 }, inventory: [], messages: [] });

describe('one replay window for every gain', () => {
    it('a coin reward recapped three turns later pays once', () => {
        const first = gameReducer(base(), { type: 'ADD_COIN_GRANT', payload: { gold: 20, _meta: { sourceId: 'msg-1' } } });
        const recap = gameReducer(turns(first, 3), { type: 'ADD_COIN_GRANT', payload: { gold: 20, _meta: { sourceId: 'msg-2' } } });
        expect(recap.character.gold).toBe(20);
        expect(recap.messages.at(-1).content).toMatch(/Duplicate/);
    });

    it('an XP award recapped three turns later pays once', () => {
        const award = (state, id) => gameReducer(state, { type: 'ADD_EXP', payload: { amount: 50, _meta: { sourceId: id } } });
        const first = award(base(), 'msg-1');
        const recap = award(turns(first, 3), 'msg-2');
        expect(recap.character.exp).toBe(first.character.exp);
    });

    it('an item recapped under another name three turns later is granted once; a different item is not', () => {
        const add = (state, name, id) => gameReducer(state, { type: 'ADD_ITEM', payload: { name, quantity: 1, _meta: { sourceId: id } } });
        const first = add(base(), 'Brass toll-token', 'msg-1');
        const recap = add(turns(first, 3), 'brass toll token', 'msg-2');
        expect(recap.inventory.filter(item => /toll/i.test(item.name))).toHaveLength(1);
        const other = add(turns(first, 3), 'Silver ring', 'msg-3');
        expect(other.inventory.map(item => item.name)).toContain('Silver ring');
    });

    it('the player asking again in their own words still pays — once the repeat judge reads it as new', () => {
        const first = gameReducer(base(), { type: 'ADD_COIN_GRANT', payload: { gold: 20, _meta: { sourceId: 'msg-1' } } });
        const again = judgeLatest(gameReducer(turns(first, 3), { type: 'ADD_COIN_GRANT', payload: { gold: 20, _meta: { sourceId: 'msg-2', playerMessage: 'I take another twenty gold from the second chest.' } } }));
        expect(again.character.gold).toBe(40);
    });
});
