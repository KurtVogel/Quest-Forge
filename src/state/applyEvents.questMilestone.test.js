/**
 * A quest completion beside `level_up` pays BOTH, and that is the settled
 * ceiling, not a double pay (2026-11-10, answering the progression audit's
 * "decision" item): the 2026-09-07 ruling bounds one reply at the milestone
 * tier (50 %) plus the quest tier (12.5 %) = 62.5 % of a level. The quest
 * tier is paid ONCE — by the completion, or by a freeform `exp_awarded` when
 * there is none, never by both — so every pairing lands on the same number.
 * A front resolution is the other case: it IS the milestone, and `level_up`
 * beside it is dropped (`applyEvents.frontMilestone.test.js`).
 */
import { describe, expect, it } from 'vitest';
import { applyEvents } from './applyEvents.js';
import { normalizeEvents } from '../llm/eventChannels.js';
import { gameReducer, initialGameState } from './gameReducer.js';
import { getExperienceThreshold, getQuestCompletionXp, getStoryMilestoneXp } from '../engine/progression.js';

const rows = n => Array.from({ length: n }, (_, i) => ({ id: `m-${i}`, role: i % 2 ? 'assistant' : 'user', content: `row ${i}` }));

const baseState = () => ({
    ...initialGameState,
    character: { ...initialGameState.character, name: 'Rauha', class: 'fighter', level: 1, exp: 0, currentHP: 10, maxHP: 10 },
    messages: rows(8),
    quests: [{ id: 'q-bell', name: 'Find the bell', description: 'Find who stole the bell.', status: 'active', openedAtMessage: 1 }],
});

const play = (wire) => {
    let state = baseState();
    const dispatch = action => { state = gameReducer(state, action); };
    applyEvents(normalizeEvents(wire), dispatch, () => state);
    return state;
};

const close = { quest_updates: [{ id: 'q-bell', name: 'Find the bell', status: 'completed' }] };
const ceiling = getStoryMilestoneXp(1) + getQuestCompletionXp(1);

describe('one reply: a quest completion, a story milestone and a freeform bonus', () => {
    it('the ceiling is 62.5 % of a level (150 + 38 of 300 at L1)', () => {
        expect(ceiling).toBe(188);
        expect(ceiling / getExperienceThreshold(1)).toBeCloseTo(0.625, 2);
    });

    it('a completion beside level_up pays the quest tier and the milestone, and stays inside the level', () => {
        const state = play({ ...close, level_up: true });
        expect(state.quests[0].status).toBe('completed');
        expect(state.character.exp).toBe(ceiling);
        expect(state.character.level).toBe(1);
    });

    it('adding exp_awarded to that reply adds nothing — the completion already paid the quest tier', () => {
        expect(play({ ...close, level_up: true, exp_awarded: 500 }).character.exp).toBe(ceiling);
    });

    it('level_up with a freeform bonus and no quest lands on the same number', () => {
        expect(play({ level_up: true, exp_awarded: 500 }).character.exp).toBe(ceiling);
    });

    it('the completion alone pays the quest tier', () => {
        expect(play(close).character.exp).toBe(getQuestCompletionXp(1));
    });
});
