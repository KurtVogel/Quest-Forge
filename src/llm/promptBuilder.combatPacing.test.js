import { describe, expect, it } from 'vitest';
import { buildSystemPrompt } from './promptBuilder.js';

const fighter = {
    name: 'Astra',
    race: 'human',
    class: 'fighter',
    level: 2,
    exp: 0,
    currentHP: 18,
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
    classResources: {
        secondWind: { used: 0, max: 1 },
        actionSurge: { used: 0, max: 1 },
    },
    features: ['Second Wind', 'Fighting Style', 'Action Surge'],
};

function prompt(overrides = {}) {
    return buildSystemPrompt({
        character: { ...fighter, ...(overrides.character || {}) },
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
        combat: overrides.combat ?? {
            active: true,
            round: 1,
            bonusActionUsed: false,
            enemies: [{ id: 'enemy-1', name: 'Goblin', hp: 7, maxHp: 7, ac: 13, condition: 'healthy' }],
            turnOrder: [{ type: 'player', name: 'Astra', initiative: 12 }],
            currentTurn: 0,
        },
        worldFacts: [],
        retrievedMemories: [],
        premise: '',
    });
}

describe('combat pacing prompt contract', () => {
    it('asks the DM to batch a whole combat exchange instead of splitting enemy turns', () => {
        const text = prompt();

        expect(text).toContain('request the whole exchange in ONE JSON');
        expect(text).toContain('Resolve a whole exchange in ONE response');
        expect(text).toContain('do not split ordinary enemy counterattacks into a second avoidable roll request');
        expect(text).not.toContain('YOU then narrate enemy turns');
    });

    it('tells the DM not to duplicate engine-applied HP and to pair victory with XP', () => {
        const text = prompt();

        expect(text).toContain('do NOT also send enemy_updates or damage_taken');
        expect(text).toContain('Do NOT repeat those HP changes with enemy_updates');
        expect(text).toContain('combat_end: true plus exp_awarded');
        expect(text).toContain('Include "exp_awarded" in that same victory response');
    });

    it('makes Action Surge dice batching explicit', () => {
        const text = prompt({
            character: {
                pendingActionSurge: true,
                classResources: {
                    secondWind: { used: 0, max: 1 },
                    actionSurge: { used: 1, max: 1 },
                },
            },
        });

        expect(text).toContain('## ACTION SURGE ACTIVE');
        expect(text).toContain('put all of those rolls in the same requested_rolls block');
        expect(text).toContain('Do not split Action Surge into a second DM response');
    });

    it('frames Second Wind as bonus-action recovery with the main action still available', () => {
        const text = prompt({ combat: { active: true, round: 1, bonusActionUsed: true, enemies: [], turnOrder: [], currentTurn: 0 } });

        expect(text).toContain('Bonus Action This Turn:** used');
        expect(text).toContain('Second Wind was used as a bonus action');
        expect(text).toContain('fighter still has their main action');
    });
});
