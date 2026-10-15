/**
 * Queue sweep 2026-10-14 (progression, Lap 4): the DM XP door keeps a DOWN
 * hero down (not only a dying one), the load replay does too, the two
 * "already awarded" guards nothing could arm are gone, each XP action is ONE
 * lane, and the revive is one function.
 */
import { describe, expect, it } from 'vitest';
import { gameReducer, initialGameState } from './gameReducer.js';
import { foldExperience, isHeroDown, reviveHero } from '../engine/progression.js';
import { reviveCharacter } from './handlers/shared.js';
import { systemMessage } from '../engine/text.js';

const SCORES = { strength: 16, dexterity: 12, constitution: 15, intelligence: 10, wisdom: 10, charisma: 8 };

const hero = (overrides = {}) => ({
    name: 'Astra', race: 'human', class: 'fighter', level: 1, exp: 0,
    currentHP: 12, maxHP: 12, armorClass: 12, conditions: [], abilityScores: { ...SCORES },
    ...overrides,
});

const stateWith = (character, extra = {}) => ({ ...initialGameState, character, inventory: [], messages: [], ...extra });

// A hero who STABILIZED: three successes, dying false, 0 HP, Unconscious.
const stabilized = (exp = 280) => stateWith(hero({ exp, currentHP: 0, dying: false, deathSaves: { successes: 0, failures: 0 }, conditions: ['Unconscious'] }));

describe('the DM XP door keeps a DOWN hero down (2026-10-14 P2, extends the 09-19 ruling)', () => {
    it('exp_awarded crossing a level on a stabilized hero grows the sheet and leaves them at 0 HP, Unconscious', () => {
        const next = gameReducer(stabilized(), { type: 'ADD_EXP', payload: { amount: 30, _meta: { sourceId: 'msg-1' } } });
        expect(next.character.level).toBe(2);
        expect(next.character.maxHP).toBeGreaterThan(12);
        expect(next.character.currentHP).toBe(0);
        expect(next.character.conditions).toContain('Unconscious');
        expect(next.messages.at(-1).content).toContain('still down');
    });

    it('level_up on a stabilized hero does the same', () => {
        const next = gameReducer(stabilized(), { type: 'LEVEL_UP', payload: { bonusExp: 0, _meta: { sourceId: 'msg-1' } } });
        expect(next.character.level).toBe(2);
        expect(next.character.currentHP).toBe(0);
        expect(next.character.conditions).toContain('Unconscious');
    });

    it('a standing hero still takes the full heal from a DM award that crosses a level', () => {
        const next = gameReducer(stateWith(hero({ exp: 280, currentHP: 3 })), { type: 'ADD_EXP', payload: { amount: 30, _meta: { sourceId: 'msg-1' } } });
        expect(next.character.level).toBe(2);
        expect(next.character.currentHP).toBe(next.character.maxHP);
    });
});

describe('the load replay keeps a down hero down (2026-10-14 P2, measured)', () => {
    it('a DYING hero with banked XP past the threshold levels on Continue without standing up', () => {
        const next = gameReducer(initialGameState, {
            type: 'LOAD_GAME',
            payload: {
                character: hero({ level: 1, exp: 300, currentHP: 0, maxHP: 12, dying: true, deathSaves: { successes: 1, failures: 2 }, conditions: ['unconscious'], levelBonusRetired: true }),
                // A battle-ready companion: the hero is not low-level solo, so the stranded-dying heal leaves the clock.
                party: [{ id: 'c1', name: 'Tammo', hp: 10, maxHp: 10, ac: 12, status: 'healthy' }],
                inventory: [],
                messages: [],
            },
        });
        expect(next.character.level).toBe(2);
        expect(next.character.currentHP).toBe(0);
        expect(next.character.dying).toBe(true);
        expect(next.character.deathSaves).toEqual({ successes: 1, failures: 2 });
    });
});

describe('one lane per XP action (2026-10-14 P2)', () => {
    it('ADD_EXP with a bare number or no payload is a no-op', () => {
        const state = stateWith(hero());
        expect(gameReducer(state, { type: 'ADD_EXP', payload: 150 })).toBe(state);
        expect(gameReducer(state, { type: 'ADD_EXP' })).toBe(state);
    });

    it('ADD_EXP without _meta is still the DM lane: capped at the quest tier and ledgered', () => {
        const next = gameReducer(stateWith(hero()), { type: 'ADD_EXP', payload: { amount: 10000 } });
        expect(next.character.exp).toBe(38); // 12.5 % of 300
        expect(next.messages.at(-1).content).toContain('capped from 10000');
        expect(next.recentExpAwards).toHaveLength(1);
    });

    it('foldExperience is the engine lane: unbounded, unledgered, and the receipts appended', () => {
        const next = foldExperience(stateWith(hero()), 10000, { reason: 'campaign milestone' });
        expect(next.character.level).toBeGreaterThan(4);
        expect(next.recentExpAwards).toHaveLength(0);
        expect(next.messages.every(m => m.dmVisible === true)).toBe(true);
    });
});

describe('the dead fight-XP guards are gone (2026-10-14 P2)', () => {
    const fight = () => ({
        ...stateWith(hero({ level: 3, exp: 0, currentHP: 20, maxHP: 28 })),
        combat: {
            ...initialGameState.combat,
            active: true,
            enemies: [{ id: 'e1', name: 'Goblin', hp: 0, maxHp: 7, ac: 13, condition: 'dead', conditions: [], combatStatus: 'active' }],
            turnOrder: [{ type: 'player', name: 'Astra', initiative: 10 }],
        },
    });

    it('START_COMBAT mints no xpAwarded key and the initial envelope has none', () => {
        expect('xpAwarded' in initialGameState.combat).toBe(false);
        const next = gameReducer(stateWith(hero()), { type: 'START_COMBAT', payload: { enemies: [{ name: 'Wolf', hp: 11, ac: 13 }] } });
        expect('xpAwarded' in next.combat).toBe(false);
    });

    it('END_COMBAT pays once whatever the payload claims; the idle envelope is a no-op after', () => {
        const ended = gameReducer(fight(), { type: 'END_COMBAT', payload: { llmAwardedXp: true } });
        expect(ended.character.exp).toBe(53);
        expect(gameReducer(ended, { type: 'END_COMBAT', payload: {} })).toBe(ended);
    });
});

describe('one revive (2026-10-14 P2)', () => {
    it('reviveHero clears the clock, the defeat flag and Unconscious in any casing, and never throws on junk', () => {
        const revived = reviveHero({ dying: true, lowLevelDefeat: true, deathSaves: { successes: 2, failures: 1 }, conditions: ['Unconscious', 'poisoned', 7, null, { x: 1 }] });
        expect(revived).toMatchObject({ dying: false, lowLevelDefeat: false, deathSaves: { successes: 0, failures: 0 } });
        expect(revived.conditions).not.toContain('Unconscious');
        expect(revived.conditions).toContain('poisoned');
        expect(reviveHero({ conditions: 'unconscious' }).conditions).toEqual([]);
    });

    it('the handlers\' reviveCharacter IS reviveHero', () => {
        expect(reviveCharacter).toBe(reviveHero);
    });

    it('a long rest clears the early defeat through the one revive', () => {
        const state = stateWith(hero({ currentHP: 0, lowLevelDefeat: true, deathSaves: { successes: 0, failures: 0 }, conditions: ['Unconscious', 'poisoned'] }));
        const next = gameReducer(state, { type: 'TAKE_REST', payload: 'long' });
        expect(next.character.currentHP).toBe(12);
        expect(next.character.lowLevelDefeat).toBe(false);
        expect(next.character.conditions).not.toContain('Unconscious');
        expect(isHeroDown(next.character)).toBe(false);
    });
});

describe('one system row composer (2026-10-14 P2)', () => {
    it('systemMessage mints an id and a timestamp and carries the extras', () => {
        const row = systemMessage('hello', { dmVisible: true, kind: 'error' });
        expect(row).toMatchObject({ role: 'system', content: 'hello', dmVisible: true, kind: 'error' });
        expect(typeof row.id).toBe('string');
        expect(Number.isFinite(row.timestamp)).toBe(true);
    });

    it('the progression receipts are dmVisible system rows', () => {
        const next = foldExperience(stateWith(hero({ exp: 290 })), 20, { reason: 'battle complete' });
        expect(next.messages.map(m => [m.role, m.dmVisible])).toEqual([['system', true], ['system', true]]);
        expect(next.messages[1].content).toContain('Average HP **6** from d10 + 2 CON = **+8 HP**');
    });
});
