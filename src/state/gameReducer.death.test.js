/**
 * Tests for the engine-owned death/dying state machine in the reducer:
 * dropping to 0 HP, death save results, damage while dying, healing revival.
 */
import { describe, it, expect } from 'vitest';
import { gameReducer, initialGameState } from './gameReducer.js';

function makeState(characterOverrides = {}) {
    return {
        ...initialGameState,
        character: {
            name: 'Testo',
            race: 'human',
            class: 'fighter',
            level: 2,
            currentHP: 12,
            maxHP: 20,
            armorClass: 16,
            abilityScores: { strength: 16, dexterity: 12, constitution: 14, intelligence: 10, wisdom: 10, charisma: 8 },
            conditions: [],
            isDead: false,
            ...characterOverrides,
        },
        messages: [],
    };
}

const levelOneSolo = (overrides = {}) => makeState({
    level: 1,
    currentHP: 8,
    maxHP: 12,
    ...overrides,
});

const dying = (overrides = {}) => makeState({
    level: 3,
    currentHP: 0,
    dying: true,
    deathSaves: { successes: 0, failures: 0 },
    conditions: ['Unconscious'],
    ...overrides,
});

describe('dropping to 0 HP', () => {
    it('starts the dying state with fresh death saves and Unconscious above the protected levels', () => {
        const next = gameReducer(makeState({ level: 3 }), { type: 'TAKE_DAMAGE', payload: 15 });
        expect(next.character.currentHP).toBe(0);
        expect(next.character.dying).toBe(true);
        expect(next.character.deathSaves).toEqual({ successes: 0, failures: 0 });
        expect(next.character.conditions).toContain('Unconscious');
        expect(next.character.isDead).toBe(false);
        expect(next.messages.some(m => m.content.includes('DYING'))).toBe(true);
    });

    it('turns level-1 solo defeat into a non-lethal setback', () => {
        const next = gameReducer(levelOneSolo(), { type: 'TAKE_DAMAGE', payload: 99 });
        expect(next.character.currentHP).toBe(0);
        expect(next.character.dying).toBe(false);
        expect(next.character.lowLevelDefeat).toBe(true);
        expect(next.character.isDead).toBe(false);
        expect(next.character.deathSaves).toEqual({ successes: 0, failures: 0 });
        expect(next.character.conditions).toContain('Unconscious');
        expect(next.messages.some(m => m.content.includes('severe setback'))).toBe(true);
    });

    it('ordinary damage does not start dying', () => {
        const next = gameReducer(makeState(), { type: 'TAKE_DAMAGE', payload: 5 });
        expect(next.character.currentHP).toBe(7);
        expect(next.character.dying).toBeFalsy();
    });
});

describe('damage while dying', () => {
    it('counts as a death save failure', () => {
        const next = gameReducer(dying(), { type: 'TAKE_DAMAGE', payload: 4 });
        expect(next.character.deathSaves.failures).toBe(1);
        expect(next.character.isDead).toBe(false);
    });

    it('a third failure kills the character', () => {
        const start = dying({ level: 3, deathSaves: { successes: 1, failures: 2 } });
        const next = gameReducer(start, { type: 'TAKE_DAMAGE', payload: 4 });
        expect(next.character.isDead).toBe(true);
        expect(next.character.dying).toBe(false);
    });

    it('prevents a level-1 solo death-save spiral from killing the character', () => {
        const start = dying({ level: 1, deathSaves: { successes: 0, failures: 2 } });
        const next = gameReducer(start, { type: 'TAKE_DAMAGE', payload: 4 });
        expect(next.character.isDead).toBe(false);
        expect(next.character.dying).toBe(false);
        expect(next.character.lowLevelDefeat).toBe(true);
    });
});

describe('DEATH_SAVE_RESULT', () => {
    it('10+ is a success', () => {
        const next = gameReducer(dying(), { type: 'DEATH_SAVE_RESULT', payload: { die: 14 } });
        expect(next.character.deathSaves).toEqual({ successes: 1, failures: 0 });
        expect(next.character.dying).toBe(true);
    });

    it('three successes stabilize (unconscious at 0 HP, not dying)', () => {
        const start = dying({ deathSaves: { successes: 2, failures: 1 } });
        const next = gameReducer(start, { type: 'DEATH_SAVE_RESULT', payload: { die: 10 } });
        expect(next.character.dying).toBe(false);
        expect(next.character.isDead).toBe(false);
        expect(next.character.currentHP).toBe(0);
    });

    it('9 or lower is a failure', () => {
        const next = gameReducer(dying(), { type: 'DEATH_SAVE_RESULT', payload: { die: 9 } });
        expect(next.character.deathSaves.failures).toBe(1);
    });

    it('natural 1 counts as two failures', () => {
        const next = gameReducer(dying(), { type: 'DEATH_SAVE_RESULT', payload: { die: 1 } });
        expect(next.character.deathSaves.failures).toBe(2);
    });

    it('a third failure kills the character', () => {
        const start = dying({ deathSaves: { successes: 0, failures: 2 } });
        const next = gameReducer(start, { type: 'DEATH_SAVE_RESULT', payload: { die: 3 } });
        expect(next.character.isDead).toBe(true);
        expect(next.character.dying).toBe(false);
    });

    it('converts level-1 solo death saves into defeat instead of death', () => {
        const start = dying({ level: 1, deathSaves: { successes: 0, failures: 2 } });
        const next = gameReducer(start, { type: 'DEATH_SAVE_RESULT', payload: { die: 1 } });
        expect(next.character.isDead).toBe(false);
        expect(next.character.dying).toBe(false);
        expect(next.character.lowLevelDefeat).toBe(true);
        expect(next.messages.some(m => m.content.includes('Death save skipped'))).toBe(true);
    });

    it('natural 20 revives at 1 HP, clearing Unconscious', () => {
        const start = dying({ deathSaves: { successes: 1, failures: 2 } });
        const next = gameReducer(start, { type: 'DEATH_SAVE_RESULT', payload: { die: 20 } });
        expect(next.character.currentHP).toBe(1);
        expect(next.character.dying).toBe(false);
        expect(next.character.isDead).toBe(false);
        expect(next.character.conditions).not.toContain('Unconscious');
        expect(next.character.deathSaves).toEqual({ successes: 0, failures: 0 });
    });

    it('is a no-op when not dying or already dead', () => {
        const alive = makeState();
        expect(gameReducer(alive, { type: 'DEATH_SAVE_RESULT', payload: { die: 1 } })).toBe(alive);
        const dead = dying({ isDead: true, dying: false });
        expect(gameReducer(dead, { type: 'DEATH_SAVE_RESULT', payload: { die: 15 } })).toBe(dead);
    });
});

describe('healing while dying', () => {
    it('revives the character with the healed HP', () => {
        const next = gameReducer(dying(), { type: 'HEAL', payload: 6 });
        expect(next.character.currentHP).toBe(6);
        expect(next.character.dying).toBe(false);
        expect(next.character.conditions).not.toContain('Unconscious');
    });

    it('does nothing for a dead character', () => {
        const dead = dying({ isDead: true, dying: false });
        expect(gameReducer(dead, { type: 'HEAL', payload: 10 })).toBe(dead);
    });

    it('still respects max HP for the living', () => {
        const next = gameReducer(makeState({ currentHP: 18 }), { type: 'HEAL', payload: 10 });
        expect(next.character.currentHP).toBe(20);
    });

    it('applies the temporary combat compensation once without exceeding max HP', () => {
        const start = makeState({ currentHP: 4 });
        const repaired = gameReducer(start, { type: 'CLAIM_BUG_COMPENSATION' });
        const repeated = gameReducer(repaired, { type: 'CLAIM_BUG_COMPENSATION' });

        expect(repaired.character.currentHP).toBe(20);
        expect(repaired.session.bugCompensationClaimed).toBe(true);
        expect(repaired.messages.at(-1).content).toContain('Restored **16 HP**');
        expect(repeated).toBe(repaired);
    });

    it('clears low-level defeat when healing restores HP', () => {
        const start = levelOneSolo({
            currentHP: 0,
            lowLevelDefeat: true,
            conditions: ['Unconscious'],
        });
        const next = gameReducer(start, { type: 'HEAL', payload: 5 });
        expect(next.character.currentHP).toBe(5);
        expect(next.character.lowLevelDefeat).toBe(false);
        expect(next.character.conditions).not.toContain('Unconscious');
    });

    it('clears low-level defeat after a rest restores HP', () => {
        const start = levelOneSolo({
            currentHP: 0,
            lowLevelDefeat: true,
            conditions: ['Unconscious'],
            hitDice: { total: 1, remaining: 1, die: 10 },
            classResources: {},
        });
        const next = gameReducer(start, { type: 'TAKE_REST', payload: 'long' });
        expect(next.character.currentHP).toBe(next.character.maxHP);
        expect(next.character.lowLevelDefeat).toBe(false);
        expect(next.character.conditions).not.toContain('Unconscious');
    });
});

describe('PLAYER_DEFEAT', () => {
    it('records a non-lethal defeat without marking the character dead', () => {
        const next = gameReducer(levelOneSolo(), {
            type: 'PLAYER_DEFEAT',
            payload: { description: 'The captain has you dragged away.' },
        });
        expect(next.character.currentHP).toBe(0);
        expect(next.character.isDead).toBe(false);
        expect(next.character.dying).toBe(false);
        expect(next.character.lowLevelDefeat).toBe(true);
        expect(next.messages.some(m => m.content.includes('story setback'))).toBe(true);
    });
});
