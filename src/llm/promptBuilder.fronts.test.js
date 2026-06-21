import { describe, expect, it } from 'vitest';
import { buildSystemPrompt } from './promptBuilder.js';

const fighter = {
    name: 'Astra',
    race: 'human',
    class: 'fighter',
    level: 1,
    exp: 0,
    currentHP: 12,
    maxHP: 12,
    armorClass: 16,
    gold: 0,
    silver: 0,
    copper: 0,
    speed: 30,
    abilityScores: { strength: 16, dexterity: 12, constitution: 14, intelligence: 10, wisdom: 10, charisma: 8 },
    savingThrowProficiencies: ['strength', 'constitution'],
    skillProficiencies: ['athletics'],
    conditions: [],
    classResources: {},
    features: [],
};

function prompt(overrides = {}) {
    return buildSystemPrompt({
        character: fighter,
        inventory: [],
        quests: [],
        rollHistory: [],
        preset: 'classicFantasy',
        ruleset: 'simplified5e',
        customSystemPrompt: '',
        journal: [],
        npcs: [],
        party: overrides.party || [],
        currentLocation: 'Jewelglade',
        combat: { active: false },
        worldFacts: [],
        fronts: overrides.fronts || [{
            id: 'front-local-pressure',
            title: 'Trouble around Jewelglade',
            goal: 'The road wardens want to control the food road.',
            stakes: 'Who starves if nobody acts?',
            grimPortents: ['The north road goes quiet.', 'Food doubles in price.'],
            clock: 1,
            maxClock: 6,
            stage: 1,
            status: 'active',
            publicHints: ['A mule train arrived empty.'],
            faction: { name: 'North Road Wardens', goal: 'Control the grain road.', stance: 'Dismissive', relationships: ['They distrust the millers.'] },
        }],
        retrievedMemories: [],
        premise: '',
    });
}

describe('hidden fronts prompt contract', () => {
    it('injects private front state and structured update rules', () => {
        const text = prompt();

        expect(text).toContain('## HIDDEN CAMPAIGN FRONTS — PRIVATE DM STATE');
        expect(text).toContain('Trouble around Jewelglade');
        expect(text).toContain('front_updates');
        expect(text).toContain('Never reveal the front title, clock, stage, or grim portent list directly');
        expect(text).toContain('North Road Wardens');
        expect(text).toContain('private cadenced director');
    });

    it('asks the DM to introduce possible companions when the player is alone', () => {
        const text = prompt({ party: [] });

        expect(text).toContain('The player is currently alone');
        expect(text).toContain('Introduce potential companions organically');
        expect(text).toContain('Do not force them into the party');
        expect(text).toContain('emit add_companions');
    });

    it('does not include solo companion guidance when a party exists', () => {
        const text = prompt({ party: [{ id: 'c1', name: 'Garrick' }] });

        expect(text).not.toContain('The player is currently alone');
    });
});
