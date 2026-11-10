/**
 * One DM story milestone per level (2026-11-10, rpg-balance-master ruling):
 * the tier bounded what one `level_up` pays; nothing bounded how often it
 * fires outside the 12-row replay window.
 */
import { describe, expect, it } from 'vitest';
import { gameReducer, initialGameState } from './gameReducer.js';
import { migrateLoadedSave } from './migrations.js';
import { getStoryMilestoneXp } from '../engine/progression.js';

const rows = (n, from = 0) => Array.from({ length: n }, (_, i) => ({ id: `m-${from + i}`, role: (from + i) % 2 ? 'assistant' : 'user', content: `row ${from + i}` }));

const hero = (over = {}) => ({ ...initialGameState.character, name: 'Rauha', race: 'human', class: 'fighter', level: 1, exp: 0, currentHP: 10, maxHP: 10, ...over });
const start = (over = {}) => ({ ...initialGameState, character: hero(over), messages: rows(4) });

const milestone = (state, sourceId, bonusExp = 0) => gameReducer(state, { type: 'LEVEL_UP', payload: { bonusExp, _meta: { sourceId } } });
/** Thirty more rows: well past the replay window, so only the cap can refuse. */
const later = state => ({ ...state, messages: [...state.messages, ...rows(30, state.messages.length)] });
const lastLine = state => state.messages[state.messages.length - 1].content;

describe('LEVEL_UP: one DM milestone per level', () => {
    it('the first milestone at a level pays the tier and stamps the level it was paid at', () => {
        const state = milestone(start(), 'dm-1');
        expect(state.character.exp).toBe(getStoryMilestoneXp(1));
        expect(state.character.milestoneLevel).toBe(1);
    });

    it('a second at the same level, long after the replay window, pays nothing and says so to the DM', () => {
        const first = milestone(start(), 'dm-1');
        const second = milestone(later(first), 'dm-2');
        expect(second.character.exp).toBe(first.character.exp);
        expect(second.character.level).toBe(1);
        expect(lastLine(second)).toContain('already paid (one per level)');
        expect(second.messages[second.messages.length - 1].dmVisible).toBe(true);
    });

    it('the bonus riding a refused milestone still pays, bounded as ever', () => {
        const first = milestone(start(), 'dm-1');
        const second = milestone(later(first), 'dm-2', 20);
        expect(second.character.exp).toBe(first.character.exp + 20);
        expect(second.messages.some(m => /already paid \(one per level\)/.test(m.content))).toBe(true);
    });

    it('a new level owes a new milestone: the stamp is the level PAID at, read before the award crosses', () => {
        // 200 + 150 crosses into level 2 on the milestone itself.
        const crossed = milestone(start({ exp: 200 }), 'dm-1');
        expect(crossed.character.level).toBe(2);
        expect(crossed.character.milestoneLevel).toBe(1);
        const before = crossed.character.exp;
        const next = milestone(later(crossed), 'dm-2');
        expect(next.character.exp).toBe(before + getStoryMilestoneXp(2));
        expect(next.character.milestoneLevel).toBe(2);
    });

    it('two milestones can no longer make a level by themselves: four emissions at L1 pay one', () => {
        let state = start();
        for (let i = 0; i < 4; i++) state = milestone(later(state), `dm-${i}`);
        expect(state.character.level).toBe(1);
        expect(state.character.exp).toBe(getStoryMilestoneXp(1));
    });
});

describe('the stamp at load', () => {
    const load = (milestoneLevel) => migrateLoadedSave({
        ...initialGameState,
        character: { ...hero({ level: 3 }), ...(milestoneLevel !== undefined && { milestoneLevel }) },
    }).character;

    it('keeps a whole level the hero has reached', () => {
        expect(load(3).milestoneLevel).toBe(3);
        expect(load(2).milestoneLevel).toBe(2);
    });

    it.each(['3', 3.5, 0, -1, 9, {}, [3], true, null])('drops %j — no stamp, so the level\'s milestone is still owed', (junk) => {
        expect(load(junk)).not.toHaveProperty('milestoneLevel');
    });

    it('a save from before the cap carries none', () => {
        expect(load(undefined)).not.toHaveProperty('milestoneLevel');
    });
});
