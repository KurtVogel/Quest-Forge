import { describe, expect, it } from 'vitest';
import { judgeLatest } from './repeatJudge.testUtils.js';
import { gameReducer, initialGameState } from './gameReducer.js';

// 2026-11-04 inventory-economy P1: every internal lane denominates in COPPER,
// and the per-column clamp at MAX_COIN_EVENT capped all of them at 100 gp.
// The event ceiling (MAX_COIN_EVENT gold) is the one real cap.

const pair = (state, i) => ({
    ...state,
    messages: [...state.messages, { id: `u${i}`, role: 'user', content: `beat ${i}` }, { id: `a${i}`, role: 'assistant', content: `reply ${i}` }],
});
const turns = (state, n) => Array.from({ length: n }).reduce((s, _, i) => pair(s, `${s.messages.length}-${i}`), state);
const purse = (state) => state.character.gold * 100 + state.character.silver * 10 + state.character.copper;
const base = () => ({
    ...initialGameState,
    character: { ...initialGameState.character, name: 'Ilse', gold: 200, silver: 0, copper: 0 },
    inventory: [],
    messages: [],
    npcs: [{ id: 'npc-branock', name: 'Branock', rosterTier: 'character', kind: 'character' }],
});
const coin = (type, state, cp, sourceId, extra = {}) => gameReducer(state, { type, payload: { copper: cp, _meta: { sourceId, ...extra } } });

describe('copper-denominated coin lanes above 100 gp (2026-11-04)', () => {
    it('a 150 gp copper grant pays 150 gp, and a 150 gp copper charge takes 150 gp', () => {
        expect(purse(coin('ADD_COIN_GRANT', base(), 15000, 'msg-1')) - purse(base())).toBe(15000);
        expect(purse(base()) - purse(coin('APPLY_COIN_LOSS', base(), 15000, 'msg-1'))).toBe(15000);
    });

    it('a 150 gp "Narrated, not recorded" card pays 150 gp when accepted', () => {
        const card = {
            id: 'card-150', role: 'system', kind: 'recovery', content: '**Narrated, not recorded:** 150 gp.',
            recovery: { status: 'open', direction: 'in', coinCp: 15000, items: [], party: '' },
        };
        const posted = gameReducer(base(), { type: 'ADD_MESSAGE', payload: card });
        const accepted = gameReducer(posted, { type: 'RESOLVE_RECOVERY', payload: { messageId: 'card-150', accept: true } });
        expect(purse(accepted) - purse(posted)).toBe(15000);
    });

    it('a 120 gp wage judged new pays 120 gp, and its undo takes back 120 gp', () => {
        const paid = coin('ADD_COIN_GRANT', base(), 12000, 'msg-1', { party: 'Branock' });
        const recap = coin('ADD_COIN_GRANT', turns(paid, 2), 12000, 'msg-2', { party: 'Branock' });
        expect(purse(recap)).toBe(purse(paid));
        const judged = judgeLatest(recap, 'new');
        expect(purse(judged) - purse(recap)).toBe(12000);
        const card = judged.messages.findLast(message => message?.kind === 'recovery');
        expect(card.recovery.status).toBe('booked');
        const undone = gameReducer(judged, { type: 'UNDO_REPEAT', payload: { messageId: card.id } });
        expect(purse(undone)).toBe(purse(recap));
    });

    it('the event ceiling still holds: a copper grant past 10,000 gp pays exactly 10,000 gp', () => {
        expect(purse(coin('ADD_COIN_GRANT', base(), 5_000_000, 'msg-1')) - purse(base())).toBe(1_000_000);
    });
});
