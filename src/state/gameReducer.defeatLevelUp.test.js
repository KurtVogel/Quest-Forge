/**
 * A level crossed at a DEFEAT terminal keeps the hero down (2026-09-07 audit
 * P1). END_COMBAT's slainXpOnly award used to run the level-up heal with revive
 * semantics: "**Astra is defeated.** … capture, rob, spare" followed at once by
 * "Level Up! … Fully healed — back on your feet" while the narration prompt
 * told the DM to narrate the collapse; a STABILIZED hero got full HP with
 * Unconscious still set. Pure reducer — END_COMBAT rolls no dice.
 */
import { describe, expect, it } from 'vitest';
import { gameReducer, initialGameState } from './gameReducer.js';

// raw = hp*2 + ac*3 = 300 → the ordinary per-enemy ceiling = the whole L1 threshold.
const slainOgre = { id: 'ogre-1', name: 'Ogre', hp: 0, maxHp: 120, ac: 20, condition: 'dead', combatStatus: 'dead' };

function makeState(character) {
    return {
        ...initialGameState,
        character: {
            name: 'Astra',
            race: 'human',
            class: 'fighter',
            level: 1,
            exp: 0,
            maxHP: 12,
            currentHP: 0,
            abilityScores: { strength: 16, dexterity: 14, constitution: 14, intelligence: 10, wisdom: 10, charisma: 8 },
            features: [],
            classResources: {},
            hitDice: { total: 1, remaining: 1, die: 10 },
            deathSaves: { successes: 0, failures: 0 },
            ...character,
        },
        party: [],
        messages: [],
        combat: {
            ...initialGameState.combat,
            active: true,
            enemies: [slainOgre],
            turnOrder: [{ type: 'player', id: 'player' }, { type: 'enemy', id: 'ogre-1' }],
        },
    };
}

describe('END_COMBAT defeat: the slain-foe level-up never stands the hero back up', () => {
    it('low-level-solo setback: the level lands, the hero stays defeated at 0 HP', () => {
        const state = makeState({ lowLevelDefeat: true, dying: false, conditions: ['unconscious'] });
        const next = gameReducer(state, { type: 'END_COMBAT', payload: { defeat: true, slainXpOnly: true } });
        expect(next.combat.active).toBe(false);
        expect(next.character.level).toBe(2);
        expect(next.character.maxHP).toBeGreaterThan(12);
        expect(next.character.currentHP).toBe(0);
        expect(next.character.lowLevelDefeat).toBe(true);
        expect(next.character.conditions).toContain('unconscious');
        const levelLine = next.messages.find(m => (m.content || '').includes('Level Up!'));
        expect(levelLine).toBeTruthy();
        expect(levelLine.content).toContain('still down');
        expect(next.messages.some(m => /Fully healed/.test(m.content || ''))).toBe(false);
    });

    it('stabilized hero (3 successes, 0 HP, Unconscious): no full HP + Unconscious limbo', () => {
        const state = makeState({ dying: false, deathSaves: { successes: 3, failures: 1 }, conditions: ['unconscious'] });
        const next = gameReducer(state, { type: 'END_COMBAT', payload: { defeat: true, slainXpOnly: true } });
        expect(next.character.level).toBe(2);
        expect(next.character.currentHP).toBe(0);
        expect(next.character.conditions).toContain('unconscious');
    });

    it('a dying hero (with an ally, mid death saves) keeps dying — the clock is not erased', () => {
        const state = makeState({ dying: true, deathSaves: { successes: 1, failures: 2 }, conditions: ['unconscious'] });
        const next = gameReducer(state, { type: 'END_COMBAT', payload: { escaped: true, slainXpOnly: true } });
        expect(next.character.level).toBe(2);
        expect(next.character.dying).toBe(true);
        expect(next.character.deathSaves).toEqual({ successes: 1, failures: 2 });
        expect(next.character.currentHP).toBe(0);
    });

    it('a victory level-up still fully heals (unchanged)', () => {
        const state = makeState({ currentHP: 3, conditions: [] });
        const next = gameReducer(state, { type: 'END_COMBAT', payload: { autoVictory: true } });
        expect(next.character.level).toBe(2);
        expect(next.character.currentHP).toBe(next.character.maxHP);
    });
});
