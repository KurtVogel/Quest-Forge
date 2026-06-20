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
    it('makes the full exchange engine-owned and limits the DM to intent', () => {
        const text = prompt();

        expect(text).toContain('COMBAT INTENT, NEVER COMBAT DICE');
        expect(text).toContain('Every committed player turn includes exactly one `combat_exchange`');
        expect(text).toContain('Never emit `attack_roll`, `companion_attack`, or `npc_attack`');
        expect(text).toContain('player slots, companions, then one intent per still-active foe');
        expect(text).toContain('A defeated foe cannot act');
        expect(text).toContain('A question or clarification is not a committed action');
        expect(text).toContain('LIVE COMBAT STATE OVERRIDES any contradictory earlier narration');
        expect(text).toContain('with HP above 0 and active status is alive');
    });

    it('keeps HP, terminal state, and XP entirely engine-owned', () => {
        const text = prompt();

        expect(text).toContain('HP, criticals, victory/defeat, XP, Action Surge consumption, and round advancement are engine-owned');
        expect(text).toContain('Never emit `combat_end`, `exp_awarded`, `damage_taken`, or `enemy_updates`');
        expect(text).toContain('Never invent a retaliation, counterattack, extra hit');
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
        expect(text).toContain('exactly two player_slots in one combat_exchange');
        expect(text).toContain('clears this state only after both validated slots commit successfully');
    });

    it('frames Second Wind as bonus-action recovery with the main action still available', () => {
        const text = prompt({ combat: { active: true, round: 1, bonusActionUsed: true, enemies: [], turnOrder: [], currentTurn: 0 } });

        expect(text).toContain('Bonus Action This Turn:** used');
        expect(text).toContain('Second Wind was used as a bonus action');
        expect(text).toContain('fighter still has their main action');
    });

    it('keeps ordinary DM turns short and leaves space for player input', () => {
        const text = prompt();

        expect(text).toContain('Default to 1-2 short paragraphs');
        expect(text).toContain('Never use 4+ paragraphs unless the player explicitly asks');
        expect(text).toContain('Leave space for the player');
        expect(text).not.toContain('aim for 2-4 paragraphs');
    });
});
