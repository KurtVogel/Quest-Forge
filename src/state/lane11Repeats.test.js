/**
 * Identity by reference, lane 11 (2026-11-08): the player's words decide no
 * repeat. The four lanes that kept a phrase rule — a same-value XP award, the
 * same spell on the same people, a rest of the same kind, the payment audit's
 * "names the amount" exception and the bundle strip's denomination words —
 * now book nothing on a twin from an earlier message and post the one
 * "Recorded once" card the repeat judge reads (llm/repeatJudge.js). "new"
 * books exactly that event on the judge lane; the XP, cast and rest cards
 * carry no Undo because those have no inverse.
 */
import { describe, expect, it } from 'vitest';
import { gameReducer, initialGameState } from './gameReducer.js';
import { judgeLatest } from './repeatJudge.testUtils.js';
import { describeReplay, REPEAT_JUDGE_SYSTEM_PROMPT } from '../llm/repeatJudge.js';
import { movementLabel, projectRepeatReplay } from './handlers/ledger.js';

const pair = (state, i) => ({
    ...state,
    messages: [...state.messages, { id: `u${i}`, role: 'user', content: `beat ${i}` }, { id: `a${i}`, role: 'assistant', content: `reply ${i}` }],
});
const turns = (state, n) => Array.from({ length: n }).reduce((s, _, i) => pair(s, `${s.messages.length}-${i}`), state);
const purse = (state) => state.character.gold * 100 + state.character.silver * 10 + state.character.copper;
const base = () => ({
    ...initialGameState,
    character: { ...initialGameState.character, name: 'Brenna', level: 2, exp: 300, maxHP: 20, currentHP: 20, gold: 0, silver: 0, copper: 0, abilityScores: { strength: 10, dexterity: 10, constitution: 10, intelligence: 10, wisdom: 10, charisma: 10 } },
    inventory: [],
    ledger: [],
    messages: [{ id: 'm0', role: 'user', content: 'x' }, { id: 'msg-1', role: 'assistant', content: 'The first grant.' }],
});
const card = (state) => state.messages.findLast(m => m?.kind === 'recovery');

describe('the registry and the words', () => {
    it('projects the three new replays to their known keys, a group cast\'s recipients included', () => {
        expect(projectRepeatReplay({ type: 'ADD_EXP', payload: { amount: 150, junk: 1 } })).toEqual({ type: 'ADD_EXP', payload: { amount: 150 } });
        expect(projectRepeatReplay({ type: 'CAST_SPELL', payload: { spell: 'Mass Healing Word', targets: ['Mika', 'Jorun', 7, ''], slotLevel: 2 } }))
            .toEqual({ type: 'CAST_SPELL', payload: { spell: 'Mass Healing Word', targets: ['Mika', 'Jorun'], slotLevel: 2 } });
        expect(projectRepeatReplay({ type: 'TAKE_REST', payload: { rest: 'long' } })).toEqual({ type: 'TAKE_REST', payload: { rest: 'long' } });
        expect(projectRepeatReplay({ type: 'LEVEL_UP', payload: {} })).toBeNull();
    });

    it('labels and describes them for the card and the judge', () => {
        expect(movementLabel({ type: 'ADD_EXP', payload: { amount: 150 } })).toBe('+150 XP');
        expect(movementLabel({ type: 'CAST_SPELL', payload: { spell: 'Cure Wounds', target: 'Mika' } })).toBe('Cure Wounds cast on Mika');
        expect(movementLabel({ type: 'TAKE_REST', payload: { rest: 'short' } })).toBe('a short rest');
        expect(describeReplay({ type: 'ADD_EXP', payload: { amount: 150 } })).toBe('the hero is awarded 150 XP');
        expect(describeReplay({ type: 'CAST_SPELL', payload: { spell: 'Mass Healing Word', targets: ['Mika', 'Jorun'] } })).toBe('the hero casts Mass Healing Word on Mika, Jorun');
        expect(describeReplay({ type: 'TAKE_REST', payload: { rest: 'long' } })).toBe('the hero takes a long rest');
        expect(REPEAT_JUDGE_SYSTEM_PROMPT).toContain('an award of experience points, a spell cast, or a rest');
        expect(REPEAT_JUDGE_SYSTEM_PROMPT).toContain('unvarnished');
    });
});

describe('the bundle strip asks instead of reading denomination words', () => {
    it('a bundle that swallows an earlier grant pays the remainder and puts the stripped part to the judge; "new" pays it too', () => {
        const first = gameReducer(base(), { type: 'ADD_COIN_GRANT', payload: { gold: 2, _meta: { sourceId: 'msg-1' } } });
        // 30 gp recapping the 2 gp inside it — the player's line names gold, which used to rescue the 2 gp.
        const bundle = gameReducer(turns(first, 2), { type: 'ADD_COIN_GRANT', payload: { gold: 30, _meta: { sourceId: 'msg-4', playerMessage: 'I take the thirty gold he owes me.' } } });
        expect(purse(bundle) - purse(first)).toBe(2800);
        const asked = card(bundle);
        expect(asked).toMatchObject({ dmVisible: true, recovery: { mode: 'repeat', status: 'judging', replay: { type: 'ADD_COIN_GRANT', payload: { copper: 200 } } } });
        expect(asked.content).toContain('Adjusted a bundled coin grant');
        expect(asked.recovery.judge.twinSourceId).toBe('msg-1');
        expect(purse(judgeLatest(bundle, 'new')) - purse(first)).toBe(3000);
        expect(purse(judgeLatest(bundle, 'same')) - purse(first)).toBe(2800);
    });

    it('a stripped part whose twin is this same reply stays a plain note', () => {
        const first = gameReducer(base(), { type: 'ADD_COIN_GRANT', payload: { gold: 2, _meta: { sourceId: 'msg-1' } } });
        const bundle = gameReducer(first, { type: 'ADD_COIN_GRANT', payload: { gold: 30, _meta: { sourceId: 'msg-1' } } });
        expect(purse(bundle) - purse(first)).toBe(2800);
        expect(card(bundle)).toBeUndefined();
        expect(bundle.messages.at(-2).content).toContain('Adjusted a bundled coin grant');
    });
});

describe('the judge lane is never second-guessed', () => {
    it('an XP booking on the judge lane lands even inside the window, and a "new" that cannot land leaves the card open', () => {
        let state = gameReducer(base(), { type: 'ADD_EXP', payload: { amount: 50, _meta: { sourceId: 'msg-1' } } });
        state = gameReducer(turns(state, 1), { type: 'ADD_EXP', payload: { amount: 50, _meta: { sourceId: 'msg-3' } } });
        expect(state.character.exp).toBe(300 + 50);
        const asked = card(state);
        expect(asked.recovery.what).toBe('+50 XP');
        const booked = judgeLatest(state, 'new');
        expect(booked.character.exp).toBe(300 + 100);
        // The same card cannot book twice.
        expect(gameReducer(booked, { type: 'JUDGE_REPEAT', payload: { messageId: asked.id, verdict: 'new' } })).toBe(booked);
    });

    it('a rest echo from the DM lane is a card; a Character Sheet rest is never one', () => {
        const rested = gameReducer({ ...base(), character: { ...base().character, currentHP: 6, class: 'fighter' } }, { type: 'TAKE_REST', payload: 'short', meta: { source: 'dm', sourceId: 'msg-1' } });
        const button = gameReducer(turns(rested, 1), { type: 'TAKE_REST', payload: 'short', meta: { narrate: true } });
        expect(card(button)).toBeUndefined();
        const echo = gameReducer(turns(rested, 1), { type: 'TAKE_REST', payload: 'short', meta: { source: 'dm', sourceId: 'msg-3' } });
        expect(card(echo)).toMatchObject({ recovery: { replay: { type: 'TAKE_REST', payload: { rest: 'short' } } } });
        expect(card(echo).recovery.judge.earlier).toBe('the hero took a short rest');
    });
});
