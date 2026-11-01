import { describe, expect, it, vi } from 'vitest';
import { gameReducer, initialGameState } from '../state/gameReducer.js';
import { buildRepeatJudgeInput, describeReplay, judgePendingRepeats, parseRepeatVerdict, REPEAT_JUDGE_SYSTEM_PROMPT } from './repeatJudge.js';

// The repeat judge (2026-11-01 night): the one transaction question the
// engine's structural rules cannot settle goes to the machinery Flash, which
// reads the two turns — never a word list (Vesa: "things can be said in so
// many ways, typos etc.").

const settings = { llmProvider: 'gemini', apiKey: 'AIzaTESTKEY0000000000000000' };
const campaign = () => {
    let state = {
        ...initialGameState,
        settings,
        character: { ...initialGameState.character, gold: 0, silver: 0, copper: 0 },
        messages: [],
        npcs: [{ id: 'npc-hesk', name: 'Hesk Varro', rosterTier: 'character', kind: 'character' }],
    };
    const add = (message) => { state = gameReducer(state, { type: 'ADD_MESSAGE', payload: message }); };
    add({ id: 'u1', role: 'user', content: 'I shoulder a crate and carry it down the gangplank.' });
    add({ id: 'msg-3', role: 'assistant', content: 'Varro presses a silver piece into your palm.' });
    state = gameReducer(state, { type: 'ADD_COIN_GRANT', payload: { copper: 10, _meta: { sourceId: 'msg-3', party: 'Hesk Varro' } } });
    add({ id: 'u2', role: 'user', content: 'Next one. I grab it and haul.' });
    add({ id: 'msg-6', role: 'assistant', content: 'The second crate thumps onto the stack; Varro slaps a coin into your hand.' });
    state = gameReducer(state, { type: 'ADD_COIN_GRANT', payload: { copper: 10, _meta: { sourceId: 'msg-6', party: 'Hesk Varro', playerMessage: 'Next one. I grab it and haul.' } } });
    return state;
};
const repeatCard = (state) => state.messages.findLast(message => message.kind === 'recovery');

describe('the judge prompt', () => {
    it('reads both turns: what was recorded, what is asked, what each side said', () => {
        const state = campaign();
        const input = buildRepeatJudgeInput(state, repeatCard(state));
        expect(input).toContain('Recorded: the hero received 1 sp (Hesk Varro)');
        expect(input).toContain('Player said: I shoulder a crate and carry it down the gangplank.');
        expect(input).toContain('DM narrated: Varro presses a silver piece into your palm.');
        expect(input).toContain('1 player turn(s) passed in between.');
        expect(input).toContain('Asked: the hero receives 1 sp (Hesk Varro)');
        expect(input).toContain('Player said: Next one. I grab it and haul.');
        expect(input).toContain('DM narrated: The second crate thumps onto the stack');
        expect(REPEAT_JUDGE_SYSTEM_PROMPT).toMatch(/unvarnished/);
        expect(REPEAT_JUDGE_SYSTEM_PROMPT).toMatch(/Read meaning, not keywords/);
    });

    it('describes every replayable movement', () => {
        expect(describeReplay({ type: 'SELL_ITEM', payload: { name: 'Wolf pelts', quantity: 1, priceCp: 50 } }, 'Old Maud')).toBe('the hero sells Wolf pelts for 5 sp (Old Maud)');
        expect(describeReplay({ type: 'REMOVE_ITEM_BY_NAME', payload: { name: 'Torch' } })).toBe('Torch leaves the hero\'s pack');
        expect(describeReplay({ type: 'APPLY_COIN_LOSS', payload: { copper: 200 } })).toBe('the hero pays 2 gp');
    });

    it('parses a verdict, and anything unreadable is "unsure"', () => {
        expect(parseRepeatVerdict('{"verdict":"NEW","reason":"a second crate"}')).toEqual({ verdict: 'new', reason: 'a second crate' });
        expect(parseRepeatVerdict('```json\n{"verdict": "same", "reason": "retold"}\n```').verdict).toBe('same');
        expect(parseRepeatVerdict('{"verdict":"probably"}').verdict).toBe('unsure');
        expect(parseRepeatVerdict('I cannot help with that.').verdict).toBe('unsure');
    });
});

describe('judgePendingRepeats', () => {
    it('asks once per judging card and dispatches the verdict with the campaign stamp', async () => {
        const state = campaign();
        const dispatched = [];
        const send = vi.fn(async () => '{"verdict":"new","reason":"a second crate"}');
        const asked = await judgePendingRepeats({ state, dispatch: action => dispatched.push(action), send });
        expect(asked).toBe(1);
        expect(send).toHaveBeenCalledTimes(1);
        expect(send.mock.calls[0][0]).toMatchObject({ provider: 'gemini', temperature: 0, systemPrompt: REPEAT_JUDGE_SYSTEM_PROMPT });
        expect(dispatched).toEqual([{
            type: 'JUDGE_REPEAT',
            payload: { messageId: repeatCard(state).id, sourceId: 'msg-6', verdict: 'new', reason: 'a second crate' },
            meta: { sessionId: state.session?.id ?? null, loadNonce: 0 },
        }]);
        const booked = dispatched.reduce(gameReducer, state);
        expect(booked.character.silver * 10 + booked.character.copper).toBe(20);
    });

    it('a failed call is "unsure" — the player keeps the buttons', async () => {
        const state = campaign();
        const dispatched = [];
        await judgePendingRepeats({ state, dispatch: action => dispatched.push(action), send: async () => { throw new Error('503'); } });
        expect(dispatched[0].payload.verdict).toBe('unsure');
        expect(repeatCard(dispatched.reduce(gameReducer, state)).recovery.status).toBe('open');
    });

    it('does nothing without the machinery key or a judging card', async () => {
        const send = vi.fn();
        expect(await judgePendingRepeats({ state: { ...campaign(), settings: {} }, dispatch: () => {}, send })).toBe(0);
        expect(await judgePendingRepeats({ state: { ...initialGameState, settings, messages: [] }, dispatch: () => {}, send })).toBe(0);
        expect(send).not.toHaveBeenCalled();
    });
});
