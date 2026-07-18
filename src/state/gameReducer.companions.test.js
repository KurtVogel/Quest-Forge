import { describe, expect, it } from 'vitest';
import { gameReducer, initialGameState } from './gameReducer.js';

function makeState(overrides = {}) {
    return {
        ...initialGameState,
        character: {
            name: 'Testo',
            race: 'human',
            class: 'fighter',
            level: 2,
            currentHP: 12,
            maxHP: 20,
            abilityScores: { strength: 16, dexterity: 12, constitution: 14, intelligence: 10, wisdom: 10, charisma: 8 },
            hitDice: { total: 2, remaining: 2, die: 10 },
            classResources: {},
            conditions: [],
        },
        messages: [],
        party: [],
        ...overrides,
    };
}

describe('companion state', () => {
    it('normalizes combat fields when adding a companion', () => {
        const next = gameReducer(makeState(), {
            type: 'ADD_COMPANION',
            payload: { name: 'Garrick', level: 2, weapon: 'Longsword' },
        });

        expect(next.party[0]).toMatchObject({
            name: 'Garrick',
            level: 2,
            hp: 20,
            maxHp: 20,
            ac: 12,
            weapon: 'Longsword',
            damage: '1d8+2',
            status: 'healthy',
        });
        expect(next.party[0].attackBonus).toBeGreaterThan(0);
    });

    it('enforces a four-companion party cap', () => {
        let state = makeState();
        for (const name of ['A', 'B', 'C', 'D', 'E']) {
            state = gameReducer(state, { type: 'ADD_COMPANION', payload: { name } });
        }

        expect(state.party).toHaveLength(4);
        expect(state.messages.some(m => m.content.includes('party is full'))).toBe(true);
    });

    it('recomputes companion status when HP changes', () => {
        const state = makeState({
            party: [{ id: 'c1', name: 'Garrick', level: 1, hp: 20, maxHp: 20, ac: 12, weapon: 'Dagger', status: 'healthy' }],
        });

        const next = gameReducer(state, {
            type: 'UPDATE_COMPANION',
            payload: { id: 'c1', hp: 0 },
        });

        expect(next.party[0]).toMatchObject({ hp: 0, status: 'downed' });
    });

    it('recovers living companions on rest', () => {
        const state = makeState({
            party: [
                { id: 'c1', name: 'Garrick', level: 1, hp: 3, maxHp: 20, ac: 12, weapon: 'Dagger', status: 'critical' },
                { id: 'c2', name: 'Mira', level: 1, hp: 0, maxHp: 12, ac: 11, weapon: 'Dagger', status: 'downed' },
            ],
        });

        const next = gameReducer(state, { type: 'TAKE_REST', payload: 'long' });

        expect(next.party[0]).toMatchObject({ hp: 20, status: 'healthy' });
        expect(next.party[1]).toMatchObject({ hp: 12, status: 'healthy' });
    });

    it('announces companion recovery in the rest message, marking a downed companion back on their feet', () => {
        const state = makeState({
            party: [
                { id: 'c1', name: 'Garrick', level: 1, hp: 3, maxHp: 20, ac: 12, weapon: 'Dagger', status: 'critical' },
                { id: 'c2', name: 'Mira', level: 1, hp: 0, maxHp: 12, ac: 11, weapon: 'Dagger', status: 'downed' },
            ],
        });

        const next = gameReducer(state, { type: 'TAKE_REST', payload: 'short' });
        const restLine = next.messages.at(-1).content;

        expect(restLine).toContain('Companions recover:');
        expect(restLine).toContain('Garrick 8/20 HP');
        expect(restLine).toContain('Mira 3/12 HP (back on their feet)');
    });

    it('leaves the rest message clean when no companion needed healing', () => {
        const state = makeState({
            party: [{ id: 'c1', name: 'Garrick', level: 1, hp: 20, maxHp: 20, ac: 12, weapon: 'Dagger', status: 'healthy' }],
        });

        const next = gameReducer(state, { type: 'TAKE_REST', payload: 'short' });

        expect(next.messages.at(-1).content).not.toContain('Companions recover:');
    });
});
