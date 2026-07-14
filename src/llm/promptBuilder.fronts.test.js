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

const frontFixture = {
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
        fronts: overrides.fronts || [frontFixture],
        worldTempo: overrides.worldTempo ?? null,
        recentEncounters: overrides.recentEncounters || [],
        paceDial: overrides.paceDial || 'standard',
        messageCount: overrides.messageCount ?? 12,
        retrievedMemories: [],
        premise: '',
    });
}

describe('world tempo prompt contract (replaces the fronts dossier)', () => {
    it('shows tempo state and front stubs, never the private dossier', () => {
        const text = prompt();

        expect(text).toContain('## WORLD TEMPO — PRIVATE PACING STATE');
        expect(text).toContain('front-local-pressure (North Road Wardens)');
        expect(text).toContain('Pace target: standard');
        expect(text).toContain('front_updates');
        expect(text).toContain('private cadenced director');
        // The dossier is gone: no titles, clocks, portents, stakes, or hints.
        expect(text).not.toContain('## HIDDEN CAMPAIGN FRONTS');
        expect(text).not.toContain('Trouble around Jewelglade');
        expect(text).not.toContain('Grim portents');
        expect(text).not.toContain('A mule train arrived empty.');
        expect(text).not.toContain('Clock: 1/6');
    });

    it('defaults to a quiet world with no granted window', () => {
        const text = prompt();
        expect(text).toContain('QUIET this scene');
        expect(text).toContain('player-initiated risk');
        expect(text).not.toContain("THIS SCENE'S PERMISSION");
    });

    it('renders the single permitted symptom card when a window is active', () => {
        const text = prompt({
            worldTempo: {
                directive: {
                    frontId: 'front-local-pressure',
                    maxIntensity: 'indirect',
                    where: 'the north road',
                    suggestedSymptom: 'A mule train arrives empty.',
                    grantedAtMessage: 10,
                    activatesAtMessage: 12,
                    expiresAtMessage: 34,
                },
            },
            messageCount: 12,
        });
        expect(text).toContain("THIS SCENE'S PERMISSION");
        expect(text).toContain('Maximum intensity: indirect');
        expect(text).toContain('A mule train arrives empty.');
    });

    it('keeps the window closed while the timing die counts down', () => {
        const text = prompt({
            worldTempo: {
                directive: {
                    frontId: 'front-local-pressure',
                    maxIntensity: 'indirect',
                    grantedAtMessage: 10,
                    activatesAtMessage: 16,
                    expiresAtMessage: 34,
                },
            },
            messageCount: 12,
        });
        expect(text).not.toContain("THIS SCENE'S PERMISSION");
        expect(text).toContain('QUIET this scene');
    });

    it('lists recent fights for variety fatigue', () => {
        const text = prompt({
            recentEncounters: [{ enemies: '2× ghoul', location: 'Old Crypt', outcome: 'victory', messageIndex: 10 }],
        });
        expect(text).toContain('Recent fights: 2× ghoul (Old Crypt, victory)');
    });

    it('asks the DM to introduce possible companions when the player is alone', () => {
        const text = prompt({ party: [] });
        expect(text).toContain('The player is currently alone');
        expect(text).toContain('add_companions');
    });

    it('does not include solo companion guidance when a party exists', () => {
        const text = prompt({ party: [{ id: 'c1', name: 'Garrick' }] });
        expect(text).not.toContain('The player is currently alone');
    });
});
