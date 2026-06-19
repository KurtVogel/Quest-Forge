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

    it('installs contextual fronts once without changing established campaign state', () => {
        const inventory = [{ name: 'Longsword', equipped: true }];
        const state = {
            ...initialGameState,
            character,
            inventory,
            session: { id: 'old-campaign', premise: 'An old campaign.' },
            messages: [{ role: 'assistant', content: 'Established history.' }],
            fronts: [{
                id: 'front-local-pressure',
                title: 'Existing Pressure',
                goal: 'Preserve me.',
                stakes: 'Existing stakes.',
                grimPortents: ['One', 'Two', 'Three'],
                clock: 1,
                stage: 1,
            }],
        };
        const migrated = gameReducer(state, {
            type: 'MIGRATE_FRONTS',
            payload: {
                fronts: [{
                    id: 'front-migrated-1',
                    title: 'Consequences Gather',
                    goal: 'A surviving faction seeks leverage.',
                    stakes: 'Old allies come under pressure.',
                    grimPortents: ['A rumor spreads.', 'An ally is watched.', 'The faction acts openly.'],
                }],
                counts: { facts: 4, npcs: 2 },
            },
        });

        expect(migrated.fronts).toHaveLength(2);
        expect(migrated.fronts[0]).toBe(state.fronts[0]);
        expect(migrated.character).toBe(character);
        expect(migrated.inventory).toBe(inventory);
        expect(migrated.session.frontMigration).toMatchObject({ version: 1, contextCounts: { facts: 4, npcs: 2 } });
        expect(migrated.messages.at(-1).content).toContain('living world awakens');
        expect(migrated.messages.at(-1).content).not.toContain('Consequences Gather');

        const repeated = gameReducer(migrated, {
            type: 'MIGRATE_FRONTS',
            payload: { fronts: [{ id: 'replacement', title: 'Replacement' }] },
        });
        expect(repeated).toBe(migrated);
    });
});
