/**
 * recentExpAwards replay ledger (2026-08-26). Vesa's live report: the DM was
 * asked for XP it forgot, promised it "on your next action", then awarded the
 * SAME amount on the two next turns. The DECISIONS.md 2026-07-21 exemption for
 * exp_awarded ended on that observation, per its own escape clause.
 */
import { describe, expect, it } from 'vitest';
import { gameReducer, initialGameState } from './gameReducer.js';

const hero = {
    name: 'Astra',
    race: 'human',
    class: 'fighter',
    level: 3,
    exp: 0,
    maxHP: 28,
    currentHP: 28,
    abilityScores: { strength: 16, dexterity: 12, constitution: 14, intelligence: 10, wisdom: 10, charisma: 8 },
    features: [],
    classResources: {},
    hitDice: { total: 3, remaining: 3, die: 10 },
};

const message = (i, role = 'assistant') => ({ id: `m-${i}`, role, content: `turn ${i}`, timestamp: i });

function makeState(messageCount = 2) {
    return {
        ...initialGameState,
        character: { ...hero },
        messages: Array.from({ length: messageCount }, (_, i) => message(i)),
    };
}

const dmExp = (amount, meta = {}) => ({
    type: 'ADD_EXP',
    payload: { amount, _meta: meta },
});

function passTurns(state, count) {
    return {
        ...state,
        messages: [...state.messages, ...Array.from({ length: count }, (_, i) => message(state.messages.length + i))],
    };
}

describe('recentExpAwards replay ledger — the reported double-award', () => {
    it('applies a first DM award and suppresses the identical re-emission on the next turn', () => {
        let state = gameReducer(makeState(), dmExp(150, { sourceId: 'msg-10', playerMessage: 'You forgot to give me the XP for the ambush.' }));
        expect(state.character.exp).toBe(150);
        expect(state.messages.at(-1).content).toContain('+150 XP');

        state = passTurns(state, 2);
        const replay = gameReducer(state, dmExp(150, { sourceId: 'msg-11', playerMessage: 'I keep walking toward the mill.' }));
        expect(replay.character.exp).toBe(150); // unchanged
        expect(replay.messages.at(-1).content).toContain('Duplicate XP award ignored');
    });

    it('suppresses the third echo too — every re-emission inside the window is caught', () => {
        let state = gameReducer(makeState(), dmExp(150, { sourceId: 'msg-10' }));
        state = passTurns(state, 1);
        state = gameReducer(state, dmExp(150, { sourceId: 'msg-11' }));
        state = passTurns(state, 1);
        const third = gameReducer(state, dmExp(150, { sourceId: 'msg-12' }));
        expect(third.character.exp).toBe(150);
    });

    it('honors explicit player repeat intent ("another 150 xp")', () => {
        let state = gameReducer(makeState(), dmExp(150, { sourceId: 'msg-10' }));
        state = passTurns(state, 1);
        const repeat = gameReducer(state, dmExp(150, { sourceId: 'msg-11', playerMessage: 'That second haul deserves another 150 xp, DM.' }));
        expect(repeat.character.exp).toBe(300);
    });

    it('never honors a repeat from the SAME sourceId even with repeat phrasing (re-parse of one narration)', () => {
        let state = gameReducer(makeState(), dmExp(150, { sourceId: 'msg-10', playerMessage: 'another 150 xp please' }));
        const replay = gameReducer(state, dmExp(150, { sourceId: 'msg-10', playerMessage: 'another 150 xp please' }));
        expect(replay.character.exp).toBe(150);
    });

    it('a DIFFERENT amount is a fresh award, never suppressed', () => {
        let state = gameReducer(makeState(), dmExp(150, { sourceId: 'msg-10' }));
        state = passTurns(state, 1);
        const fresh = gameReducer(state, dmExp(75, { sourceId: 'msg-11' }));
        expect(fresh.character.exp).toBe(225);
    });

    it('two identical legitimate awards OUTSIDE the window both pay', () => {
        let state = gameReducer(makeState(), dmExp(150, { sourceId: 'msg-10' }));
        state = passTurns(state, 8); // well past the 4-conversational-message window
        const later = gameReducer(state, dmExp(150, { sourceId: 'msg-20' }));
        expect(later.character.exp).toBe(300);
    });

    it('leaves engine-path bare-number dispatches completely unguarded', () => {
        // Engine XP (combat, quests, fronts) is one-shot by construction — two
        // identical engine awards back to back are always genuine.
        let state = gameReducer(makeState(), { type: 'ADD_EXP', payload: 150 });
        const again = gameReducer(state, { type: 'ADD_EXP', payload: 150 });
        expect(again.character.exp).toBe(300);
        expect(again.recentExpAwards).toHaveLength(0);
    });
});

describe('recentExpAwards guards the LEVEL_UP lane', () => {
    const dmLevelUp = (bonusExp, meta = {}) => ({
        type: 'LEVEL_UP',
        payload: { bonusExp, reason: 'milestone', _meta: meta },
    });

    it('suppresses a milestone level_up re-emitted inside the window', () => {
        let state = gameReducer(makeState(), dmLevelUp(0, { sourceId: 'msg-10' }));
        expect(state.character.level).toBe(4);
        state = passTurns(state, 2);
        const echo = gameReducer(state, dmLevelUp(0, { sourceId: 'msg-11' }));
        expect(echo.character.level).toBe(4); // no double level
        expect(echo.messages.at(-1).content).toContain('Duplicate level-up ignored');
    });

    it('catches the reported echo when the recap turn upgrades exp_awarded to level_up + bonus', () => {
        // Turn N: plain exp_awarded 150. Turn N+1: the DM recaps with
        // level_up: true and the same 150 riding as bonusExp — the level-up is
        // new (applies), but the duplicated bonus XP must not pay again.
        let state = gameReducer(makeState(), dmExp(150, { sourceId: 'msg-10' }));
        state = passTurns(state, 1);
        const echo = gameReducer(state, dmLevelUp(150, { sourceId: 'msg-11' }));
        expect(echo.character.level).toBe(4);
        expect(echo.character.exp).toBe(150); // the first award only
        expect(echo.messages.some(m => (m.content || '').includes('Duplicate XP award ignored'))).toBe(true);
    });

    it('leaves meta-less LEVEL_UP dispatches unguarded (engine/legacy path)', () => {
        let state = gameReducer(makeState(), { type: 'LEVEL_UP', payload: { bonusExp: 0, reason: 'milestone' } });
        const again = gameReducer(state, { type: 'LEVEL_UP', payload: { bonusExp: 0, reason: 'milestone' } });
        expect(again.character.level).toBe(5);
    });
});

describe('recentExpAwards persistence', () => {
    it('LOAD_GAME normalizes the ledger and drops junk entries', () => {
        const loaded = gameReducer(initialGameState, {
            type: 'LOAD_GAME',
            payload: {
                character: { ...hero },
                messages: [message(0)],
                recentExpAwards: [
                    { signature: 'exp|150', itemKey: 'exp-award', name: '150 XP', quantity: 1, priceCp: 150, sourceId: 'msg-10', messageIndex: 0, timestamp: 1, status: 'applied' },
                    'junk-string',
                    { noSignature: true },
                ],
            },
        });
        expect(loaded.recentExpAwards).toHaveLength(1);
        expect(loaded.recentExpAwards[0].signature).toBe('exp|150');
    });

    it('LOAD_GAME tolerates pre-ledger saves with no recentExpAwards field', () => {
        const loaded = gameReducer(initialGameState, {
            type: 'LOAD_GAME',
            payload: { character: { ...hero }, messages: [] },
        });
        expect(loaded.recentExpAwards).toEqual([]);
    });
});
