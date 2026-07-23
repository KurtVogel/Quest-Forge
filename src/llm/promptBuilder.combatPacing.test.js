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
        expect(text).toContain('Situational rulings preserve table negotiation');
        expect(text).toContain('The player\'s claim alone does not make the reason true');
        expect(text).toContain('Never emit `attack_roll`, `companion_attack`, or `npc_attack`');
        expect(text).toContain('player slots, companions, then one intent per still-active foe');
        expect(text).toContain('A defeated foe cannot act');
        expect(text).toContain('A question or clarification is not a committed action');
        expect(text).toContain('LIVE COMBAT STATE OVERRIDES any contradictory earlier narration');
        expect(text).toContain('with HP above 0 and active status is alive');
        expect(text).toContain('`enemy_condition_updates` synchronizes a condition already established');
        expect(text).toContain('`"on_success":{"target":"<living enemy id>","add":["prone"]}`');
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

describe('buildCombatBlock per-combatant rendering (queue 2026-07-16)', () => {
    it('renders every dynamic enemy field: atk/dmg, health, conditions, status, defending', () => {
        const text = prompt({
            combat: {
                active: true,
                round: 3,
                surprise: 'enemies',
                phase: 'awaiting_player',
                bonusActionUsed: false,
                currentTurn: 1,
                enemies: [
                    {
                        id: 'chief', name: 'Chief Kraul', hp: 9, maxHp: 28, ac: 14,
                        attackBonus: 4, damage: '1d8+2', condition: 'bloodied',
                        conditions: ['prone', 'frightened'],
                    },
                    {
                        id: 'runt', name: 'Goblin Runt', hp: 4, maxHp: 8, ac: 12,
                        condition: 'bloodied', combatStatus: 'fled', defending: true,
                    },
                ],
                turnOrder: [
                    { type: 'enemy', name: 'Chief Kraul', initiative: 17 },
                    { type: 'player', name: 'Astra', initiative: 12 },
                ],
            },
        });

        expect(text).toContain('## ACTIVE COMBAT — Round 3 | Phase: awaiting_player | Surprise: enemies');
        expect(text).toContain('- **Chief Kraul** (id: chief) | HP: 9/28 | AC: 14 | Atk: +4 | Dmg: 1d8+2 | Health: bloodied | Conditions: prone, frightened');
        expect(text).toContain('- **Goblin Runt** (id: runt) | HP: 4/8 | AC: 12 | Health: bloodied | Status: fled | DEFENDING');
        // Turn-order marker sits on the CURRENT combatant only.
        expect(text).toContain('  Chief Kraul (init: 17)');
        expect(text).toContain('→ Astra (init: 12)');
    });

    it('reports the Action Surge contract line from pendingActionSurge', () => {
        expect(prompt()).toContain('Action Surge: inactive — exactly one player_slot required');
        expect(prompt({ character: { pendingActionSurge: true } }))
            .toContain('Action Surge: ACTIVE — exactly two player_slots required');
    });

    it('renders placeholders for empty enemies and pending turn order', () => {
        const text = prompt({
            combat: { active: true, round: 1, bonusActionUsed: false, currentTurn: 0, enemies: [], turnOrder: [] },
        });
        expect(text).toContain('- No tracked enemies');
        expect(text).toContain('- Turn order pending');
    });
});
