import { describe, expect, it } from 'vitest';
import { buildSystemPrompt } from './promptBuilder.js';

const character = {
    name: 'Astra',
    race: 'human',
    class: 'fighter',
    level: 2,
    exp: 0,
    currentHP: 20,
    maxHP: 20,
    armorClass: 18,
    gold: 0,
    silver: 0,
    copper: 0,
    speed: 30,
    abilityScores: { strength: 16, dexterity: 12, constitution: 14, intelligence: 10, wisdom: 10, charisma: 8 },
    savingThrowProficiencies: ['strength', 'constitution'],
    skillProficiencies: ['athletics'],
    conditions: [],
    classResources: { actionSurge: { used: 1, max: 1 } },
    features: ['Second Wind', 'Action Surge'],
    pendingActionSurge: true,
};

describe('Action Surge prompt state', () => {
    it('injects an active Action Surge block when the next action should get an extra action', () => {
        const prompt = buildSystemPrompt({
            character,
            inventory: [],
            quests: [],
            rollHistory: [],
            preset: 'classicFantasy',
            ruleset: 'simplified5e',
            customSystemPrompt: '',
            journal: [],
            npcs: [],
            party: [],
            currentLocation: 'Road',
            combat: { active: false },
            worldFacts: [],
            retrievedMemories: [],
            premise: '',
        });

        expect(prompt).toContain('## ACTION SURGE ACTIVE');
        expect(prompt).toContain('Their next declared action gets one additional action');
        expect(prompt).toContain('do NOT emit resources_used');
    });

    it('includes bonus-action state and action cost for resources in combat', () => {
        const prompt = buildSystemPrompt({
            character: {
                ...character,
                pendingActionSurge: false,
                classResources: {
                    secondWind: { used: 0, max: 1 },
                    actionSurge: { used: 0, max: 1 },
                },
            },
            inventory: [],
            quests: [],
            rollHistory: [],
            preset: 'classicFantasy',
            ruleset: 'simplified5e',
            customSystemPrompt: '',
            journal: [],
            npcs: [],
            party: [],
            currentLocation: 'Road',
            combat: { active: true, bonusActionUsed: true },
            worldFacts: [],
            retrievedMemories: [],
            premise: '',
        });

        expect(prompt).toContain('secondWind: 1/1, bonus action');
        expect(prompt).toContain('Bonus Action This Turn:** used');
        expect(prompt).toContain('Second Wind is a bonus action');
    });
});
