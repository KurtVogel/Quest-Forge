import { describe, expect, it } from 'vitest';
import { gameReducer, initialGameState } from './gameReducer.js';

function makeFighter(overrides = {}) {
    return {
        ...initialGameState,
        character: {
            name: 'Astra',
            race: 'human',
            class: 'fighter',
            level: 2,
            currentHP: 20,
            maxHP: 20,
            abilityScores: { strength: 16, dexterity: 12, constitution: 14, intelligence: 10, wisdom: 10, charisma: 8 },
            classResources: {
                secondWind: { used: 0, max: 1 },
                actionSurge: { used: 0, max: 1 },
            },
            hitDice: { total: 2, remaining: 2, die: 10 },
            conditions: [],
            ...overrides,
        },
        messages: [],
    };
}

describe('class resource activation', () => {
    it('marks Action Surge as pending until the next player action resolves', () => {
        const surged = gameReducer(makeFighter(), {
            type: 'ACTIVATE_RESOURCE',
            payload: 'actionSurge',
        });

        expect(surged.character.classResources.actionSurge.used).toBe(1);
        expect(surged.character.pendingActionSurge).toBe(true);
        expect(surged.messages.at(-1).content).toContain('Action Surge');

        const cleared = gameReducer(surged, { type: 'CLEAR_ACTION_SURGE' });
        expect(cleared.character.pendingActionSurge).toBe(false);
    });

    it('clears pending Action Surge on rest', () => {
        const rested = gameReducer(makeFighter({
            pendingActionSurge: true,
            classResources: {
                secondWind: { used: 1, max: 1 },
                actionSurge: { used: 1, max: 1 },
            },
        }), {
            type: 'TAKE_REST',
            payload: 'short',
        });

        expect(rested.character.pendingActionSurge).toBe(false);
        expect(rested.character.classResources.actionSurge.used).toBe(0);
    });
});
