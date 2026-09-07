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

    // Since 2026-09-07 a DM milestone pays the front tier of XP (half the
    // current threshold: 900 at L3), never a whole level — see the bounded-lane
    // suite below. The ledger semantics these tests pin are unchanged.
    it('suppresses a milestone level_up re-emitted inside the window', () => {
        let state = gameReducer(makeState(), dmLevelUp(0, { sourceId: 'msg-10' }));
        expect(state.character.level).toBe(3);
        expect(state.character.exp).toBe(900);
        state = passTurns(state, 2);
        const echo = gameReducer(state, dmLevelUp(0, { sourceId: 'msg-11' }));
        expect(echo.character.exp).toBe(900); // no double milestone
        expect(echo.messages.at(-1).content).toContain('Duplicate level-up ignored');
    });

    it('catches the reported echo when the recap turn upgrades exp_awarded to level_up + bonus', () => {
        // Turn N: plain exp_awarded 150. Turn N+1: the DM recaps with
        // level_up: true and the same 150 riding as bonusExp — the milestone is
        // new (applies), but the duplicated bonus XP must not pay again.
        let state = gameReducer(makeState(), dmExp(150, { sourceId: 'msg-10' }));
        state = passTurns(state, 1);
        const echo = gameReducer(state, dmLevelUp(150, { sourceId: 'msg-11' }));
        expect(echo.character.level).toBe(3);
        expect(echo.character.exp).toBe(150 + 900); // the first award + the milestone only
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

/**
 * The two DM XP lanes are bounded engine-side (2026-09-07 audit P1,
 * rpg-balance-master ruling): `level_up` pays the front tier (half the current
 * threshold — two milestones = one level), `exp_awarded` is capped at the
 * quest tier (12.5%). Reproduced before the fix: four level_ups five messages
 * apart took a hero L1→L5 with zero suppression lines; one exp_awarded at the
 * 10000 parse clamp did the same; level_up + a big bonus double-levelled.
 */
describe('DM XP lanes are bounded engine-side (2026-09-07)', () => {
    const dmLevelUp = (bonusExp, meta = {}) => ({
        type: 'LEVEL_UP',
        payload: { bonusExp, reason: 'milestone', _meta: meta },
    });

    it('level_up pays the front tier, not a whole level', () => {
        const state = gameReducer(makeState(), dmLevelUp(0, { sourceId: 'msg-10' }));
        expect(state.character.level).toBe(3);
        expect(state.character.exp).toBe(900); // 50% of the L3→4 threshold (1800)
        expect(state.messages.at(-1).content).toContain('story milestone');
    });

    it('four milestones outside the echo window are two levels, not four', () => {
        let state = makeState();
        for (let i = 0; i < 4; i++) {
            state = gameReducer(state, dmLevelUp(0, { sourceId: `msg-${10 + i}` }));
            state = passTurns(state, 5); // outside the 4-message echo window
        }
        // L3 (1800) crossed by two milestones of 900, L4 (3800) by two of 1900.
        expect(state.character.level).toBe(5);
        expect(state.character.exp).toBe(0);
        expect(state.messages.some(m => (m.content || '').includes('Duplicate'))).toBe(false);
    });

    it('exp_awarded is capped at the quest tier with a visible note', () => {
        const state = gameReducer(makeState(), dmExp(10000, { sourceId: 'msg-10' }));
        expect(state.character.level).toBe(3);
        expect(state.character.exp).toBe(225); // 12.5% of 1800
        expect(state.messages.some(m => (m.content || '').includes('capped at **+225 XP**'))).toBe(true);
    });

    it('a capped oversized award still matches its own echo', () => {
        let state = gameReducer(makeState(), dmExp(10000, { sourceId: 'msg-10' }));
        state = passTurns(state, 1);
        const echo = gameReducer(state, dmExp(10000, { sourceId: 'msg-11' }));
        expect(echo.character.exp).toBe(225);
        expect(echo.messages.at(-1).content).toContain('Duplicate XP award ignored');
    });

    it('level_up plus a threshold-sized bonus can never double-level', () => {
        const state = gameReducer(makeState(), dmLevelUp(5000, { sourceId: 'msg-10' }));
        expect(state.character.level).toBe(3);
        expect(state.character.exp).toBe(900 + 225); // milestone + capped bonus
        expect(state.messages.some(m => (m.content || '').includes('capped at **+225 XP**'))).toBe(true);
    });

    it('a level-20 milestone posts a line instead of a silent no-op', () => {
        const base = makeState();
        const state = gameReducer(
            { ...base, character: { ...base.character, level: 20, maxHP: 150, currentHP: 150, hitDice: { total: 20, remaining: 20, die: 10 } } },
            dmLevelUp(0, { sourceId: 'msg-10' }),
        );
        expect(state.character.level).toBe(20);
        const line = state.messages.at(-1).content;
        expect(line).toContain('max level reached, no level gained');
        expect(line).toContain('Max level reached');
    });

    it('engine-path (meta-less) awards stay unbounded', () => {
        const state = gameReducer(makeState(), { type: 'ADD_EXP', payload: 10000 });
        expect(state.character.level).toBeGreaterThan(4);
        expect(state.messages.some(m => (m.content || '').includes('capped'))).toBe(false);
    });
});
