import { describe, expect, it } from 'vitest';
import { gameReducer, initialGameState } from './gameReducer.js';

const character = {
    name: 'Astra',
    race: 'human',
    class: 'fighter',
    level: 1,
    currentHP: 12,
    maxHP: 12,
    abilityScores: { strength: 16, dexterity: 12, constitution: 14, intelligence: 10, wisdom: 10, charisma: 8 },
    conditions: [],
};

describe('hidden campaign fronts', () => {
    it('seeds an initial hidden front when a campaign session starts', () => {
        const withCharacter = gameReducer(initialGameState, {
            type: 'START_CHARACTER',
            payload: { character, inventory: [] },
        });

        const next = gameReducer(withCharacter, {
            type: 'UPDATE_SESSION',
            payload: {
                id: 'session-1',
                name: 'Rain Road',
                premise: 'Astra reaches Jewelglade while people vanish on the north road.',
            },
        });

        expect(next.fronts).toHaveLength(1);
        expect(next.fronts[0]).toMatchObject({
            id: 'front-local-pressure',
            status: 'active',
            clock: 0,
        });
        expect(next.fronts[0].goal).toContain('Jewelglade');
    });

    it('merges structured front updates by id', () => {
        const state = {
            ...initialGameState,
            fronts: [{
                id: 'front-local-pressure',
                title: 'Trouble around Jewelglade',
                goal: 'A local threat gathers leverage.',
                stakes: 'Who suffers first?',
                grimPortents: ['A warning sign appears.'],
                clock: 0,
                maxClock: 6,
                stage: 0,
                status: 'active',
                publicHints: [],
            }],
        };

        const next = gameReducer(state, {
            type: 'UPDATE_FRONT',
            payload: {
                id: 'front-local-pressure',
                clock: 1,
                stage: 1,
                publicHints: ['Refugees avoid the north road.'],
            },
        });

        expect(next.fronts[0]).toMatchObject({
            id: 'front-local-pressure',
            title: 'Trouble around Jewelglade',
            clock: 1,
            stage: 1,
            publicHints: ['Refugees avoid the north road.'],
        });
    });
});
