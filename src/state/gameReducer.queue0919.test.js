/**
 * Queue sweep 2026-09-19 — reducer + load pins for progression and
 * chat-orchestration (Lap 2, hostile input): the idle END_COMBAT, the ASI's
 * shared downed predicate, the DM XP lanes against a death-save clock, and the
 * message rows' load heal with the window belt behind it.
 */
import { describe, expect, it } from 'vitest';
import { gameReducer, initialGameState } from './gameReducer.js';
import { buildMessageWindow } from '../components/Chat/turnVisibility.js';
import { MESSAGE_CONTENT_MAX } from '../config/contentLimits.js';

const SCORES = { strength: 16, dexterity: 12, constitution: 15, intelligence: 10, wisdom: 10, charisma: 8 };

const hero = (overrides = {}) => ({
    name: 'Astra', race: 'human', class: 'fighter', level: 1, exp: 0,
    currentHP: 12, maxHP: 12, armorClass: 12, conditions: [], abilityScores: { ...SCORES },
    ...overrides,
});

const stateWith = (character, extra = {}) => ({ ...initialGameState, character, inventory: [], messages: [], ...extra });

describe('END_COMBAT on an idle envelope (2026-09-19 P1)', () => {
    it('is a no-op: the sustained spell stays and no "fades" line is posted', () => {
        const state = stateWith(hero({
            class: 'cleric',
            sustainedSpell: { key: 'shieldOfFaith', name: 'Shield of Faith', acBonus: 2, targetType: 'self' },
        }));
        const next = gameReducer(state, { type: 'END_COMBAT', payload: { llmAwardedXp: false } });
        expect(next).toBe(state);
    });
});

describe('the ASI shares the level-up heal\'s downed predicate (2026-09-19 P2)', () => {
    it('a STABILIZED hero (0 HP, not dying, Unconscious) grows maxHP only', () => {
        const state = stateWith(hero({
            level: 4, currentHP: 0, maxHP: 28, dying: false, conditions: ['unconscious'],
            abilityScoreImprovementsApplied: 0, pendingAbilityScoreImprovements: 1,
        }));
        const next = gameReducer(state, {
            type: 'APPLY_ABILITY_SCORE_IMPROVEMENT',
            payload: { increases: { strength: 1, constitution: 1 } },
        });
        expect(next.character.maxHP).toBe(32);
        expect(next.character.currentHP).toBe(0);
        expect(next.character.conditions).toContain('unconscious');
    });
});

describe('no DM XP lane ends a death-save clock (2026-09-19 ruling)', () => {
    const dying = () => stateWith(hero({
        exp: 200, currentHP: 0, dying: true, deathSaves: { successes: 1, failures: 2 }, conditions: ['unconscious'],
    }));

    it('a DM level_up milestone that crosses a level while DYING grows the sheet and keeps the clock', () => {
        const next = gameReducer(dying(), { type: 'LEVEL_UP', payload: { bonusExp: 0, reason: 'milestone', _meta: { sourceId: 'msg-1' } } });
        expect(next.character.level).toBe(2);
        expect(next.character.maxHP).toBeGreaterThan(12);
        expect(next.character.currentHP).toBe(0);
        expect(next.character.dying).toBe(true);
        expect(next.character.deathSaves).toEqual({ successes: 1, failures: 2 });
    });

    it('a DM exp_awarded bonus that crosses a level while DYING keeps the clock too', () => {
        const state = dying();
        state.character.exp = 290;
        const next = gameReducer(state, { type: 'ADD_EXP', payload: { amount: 30, _meta: { sourceId: 'msg-1' } } });
        expect(next.character.level).toBe(2);
        expect(next.character.currentHP).toBe(0);
        expect(next.character.dying).toBe(true);
    });

    it('engine-computed XP (a bare number) keeps the 08-30 revive', () => {
        const state = dying();
        state.character.exp = 290;
        const next = gameReducer(state, { type: 'ADD_EXP', payload: 30 });
        expect(next.character.level).toBe(2);
        expect(next.character.dying).toBe(false);
        expect(next.character.currentHP).toBe(next.character.maxHP);
    });
});

describe('message rows at load (2026-09-19 P2)', () => {
    const load = (messages) => gameReducer(initialGameState, {
        type: 'LOAD_GAME',
        // levelBonusRetired: the one-time Fighter balance notice is not under test.
        payload: { character: hero({ level: 3, currentHP: 28, maxHP: 28, levelBonusRetired: true }), inventory: [], messages },
    });

    it('types content, the three flags, and the id; drops array rows', () => {
        const next = load([
            { id: 'm1', role: 'user', content: { evil: true } },
            { id: 'm2', role: 'assistant', content: 'Z'.repeat(300000) },
            { id: 'm3', role: 'assistant', content: 'Visible.', hidden: 'false', deleted: 'false', summarized: 'false' },
            { id: { x: 1 }, role: 'user', content: 'Object id.' },
            { id: 'm5', role: 'assistant', content: 'Hidden.', hidden: 'true' },
            ['not', 'a', 'row'],
        ]);
        expect(next.messages).toHaveLength(5);
        expect(next.messages[0].content).toBe('');
        expect(next.messages[1].content).toHaveLength(MESSAGE_CONTENT_MAX);
        expect(next.messages[2]).toMatchObject({ hidden: false, deleted: false, summarized: false });
        expect(typeof next.messages[3].id).toBe('string');
        expect(next.messages[3].id.length).toBeGreaterThan(0);
        expect(next.messages[4].hidden).toBe(true);
        const window = buildMessageWindow(next.messages, 20);
        expect(window.map(m => m.content)).not.toContain('Hidden.');
        expect(window.map(m => m.content)).toContain('Visible.');
        expect(window.every(m => typeof m.content === 'string')).toBe(true);
    });

    it('a well-formed row round-trips untouched (same object, whitespace kept)', () => {
        const row = { id: 'm1', role: 'assistant', content: '  The rain eases.\n', hidden: false };
        const next = load([row]);
        expect(next.messages[0]).toBe(row);
    });

    it('buildMessageWindow is the belt: a live non-string / oversized row never reaches a provider raw', () => {
        const window = buildMessageWindow([
            { role: 'user', content: { evil: true } },
            { role: 'assistant', content: 'Y'.repeat(MESSAGE_CONTENT_MAX + 500) },
        ], 20);
        expect(window[0].content).toBe('');
        expect(window[1].content).toHaveLength(MESSAGE_CONTENT_MAX);
    });
});
