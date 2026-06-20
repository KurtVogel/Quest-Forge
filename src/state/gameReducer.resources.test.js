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
        const start = makeFighter();
        start.combat = {
            ...initialGameState.combat,
            active: true,
            phase: 'awaiting_player',
            turnOrder: [{ type: 'player', name: 'Astra', initiative: 12 }],
            currentTurn: 0,
        };
        const surged = gameReducer(start, {
            type: 'ACTIVATE_RESOURCE',
            payload: 'actionSurge',
        });

        expect(surged.character.classResources.actionSurge.used).toBe(1);
        expect(surged.character.pendingActionSurge).toBe(true);
        expect(surged.messages.at(-1).content).toContain('Action Surge');

        expect(surged.character.pendingActionSurge).toBe(true);
    });

    it('does not activate Action Surge off-turn or outside combat', () => {
        const outside = gameReducer(makeFighter(), { type: 'ACTIVATE_RESOURCE', payload: 'actionSurge' });
        expect(outside.character.classResources.actionSurge.used).toBe(0);

        const opening = makeFighter();
        opening.combat = { ...initialGameState.combat, active: true, phase: 'opening' };
        const blocked = gameReducer(opening, { type: 'ACTIVATE_RESOURCE', payload: 'actionSurge' });
        expect(blocked.character.classResources.actionSurge.used).toBe(0);

        const awaitingIntent = makeFighter();
        awaitingIntent.combat = { ...initialGameState.combat, active: true, phase: 'awaiting_intent' };
        const locked = gameReducer(awaitingIntent, { type: 'ACTIVATE_RESOURCE', payload: 'actionSurge' });
        expect(locked.character.classResources.actionSurge.used).toBe(0);
    });

    it('blocks rests during combat so resources cannot recharge mid-fight', () => {
        const start = makeFighter({
            classResources: {
                secondWind: { used: 1, max: 1 },
                actionSurge: { used: 1, max: 1 },
            },
        });
        start.combat = { ...initialGameState.combat, active: true, phase: 'awaiting_player' };
        const rested = gameReducer(start, { type: 'TAKE_REST', payload: 'short' });
        expect(rested.character.classResources.actionSurge.used).toBe(1);
        expect(rested.messages.at(-1).content).toContain('cannot take');
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

    it('Second Wind clears low-level defeat when it restores HP', () => {
        const next = gameReducer(makeFighter({
            level: 1,
            currentHP: 0,
            maxHP: 12,
            lowLevelDefeat: true,
            conditions: ['Unconscious'],
            deathSaves: { successes: 0, failures: 0 },
            classResources: {
                secondWind: { used: 0, max: 1 },
            },
        }), {
            type: 'ACTIVATE_RESOURCE',
            payload: 'secondWind',
        });

        expect(next.character.currentHP).toBeGreaterThan(0);
        expect(next.character.lowLevelDefeat).toBe(false);
        expect(next.character.conditions).not.toContain('Unconscious');
        expect(next.character.deathSaves).toEqual({ successes: 0, failures: 0 });
        expect(next.character.classResources.secondWind.used).toBe(1);
    });

    it('Second Wind spends the combat bonus action without ending the main action', () => {
        const start = makeFighter({
            currentHP: 10,
            classResources: {
                secondWind: { used: 0, max: 2 },
                actionSurge: { used: 0, max: 1 },
            },
        });
        start.combat = {
            active: true,
            enemies: [{ id: 'enemy-1', name: 'Goblin', hp: 7, maxHp: 7, ac: 13, condition: 'healthy' }],
            turnOrder: [{ type: 'player', name: 'Astra', initiative: 12 }],
            currentTurn: 0,
            round: 1,
            xpAwarded: false,
            bonusActionUsed: false,
        };

        const used = gameReducer(start, { type: 'ACTIVATE_RESOURCE', payload: 'secondWind' });
        const blocked = gameReducer(used, { type: 'ACTIVATE_RESOURCE', payload: 'secondWind' });
        const awaitingNarration = {
            ...used,
            combat: {
                ...used.combat,
                phase: 'awaiting_narration',
                lastExchangeResult: { exchangeId: 'exchange-reset', kind: 'exchange', terminal: null },
            },
        };
        const nextRound = gameReducer(awaitingNarration, {
            type: 'COMPLETE_COMBAT_NARRATION',
            payload: { exchangeId: 'exchange-reset' },
        });

        expect(used.combat.bonusActionUsed).toBe(true);
        expect(used.character.classResources.secondWind.used).toBe(1);
        expect(used.messages.at(-1).content).toContain('bonus action');
        expect(used.messages.at(-1).content).toContain('main action is still available');
        expect(used.messages.at(-1).narrationCue).toMatchObject({
            type: 'player_mechanic',
            mechanic: 'Second Wind',
            actionType: 'bonus action',
        });
        expect(blocked.character.classResources.secondWind.used).toBe(1);
        expect(blocked.messages.at(-1).content).toContain('Bonus action already used');
        expect(nextRound.combat.bonusActionUsed).toBe(false);
    });

    it('does not allow a bonus action resource outside the player combat turn', () => {
        const start = makeFighter({ currentHP: 10 });
        start.combat = {
            active: true,
            enemies: [{ id: 'enemy-1', name: 'Goblin', hp: 7, maxHp: 7, ac: 13, condition: 'healthy' }],
            turnOrder: [
                { type: 'enemy', id: 'enemy-1', name: 'Goblin', initiative: 13 },
                { type: 'player', name: 'Astra', initiative: 12 },
            ],
            currentTurn: 0,
            round: 1,
            xpAwarded: false,
            bonusActionUsed: false,
        };

        const next = gameReducer(start, { type: 'ACTIVATE_RESOURCE', payload: 'secondWind' });

        expect(next.character.classResources.secondWind.used).toBe(0);
        expect(next.combat.bonusActionUsed).toBe(false);
        expect(next.messages.at(-1).content).toContain('use it on your turn');
    });

    it('short rest does not grant free healing when no hit dice remain', () => {
        const next = gameReducer(makeFighter({
            currentHP: 4,
            hitDice: { total: 2, remaining: 0, die: 10 },
        }), {
            type: 'TAKE_REST',
            payload: 'short',
        });

        expect(next.character.currentHP).toBe(4);
        expect(next.character.hitDice.remaining).toBe(0);
        expect(next.messages.at(-1).content).toContain('Recovered 0 HP');
    });

    it('short rest hit dice healing revives a dying character', () => {
        const next = gameReducer(makeFighter({
            level: 3,
            currentHP: 0,
            dying: true,
            conditions: ['Unconscious'],
            deathSaves: { successes: 1, failures: 1 },
            hitDice: { total: 3, remaining: 1, die: 10 },
        }), {
            type: 'TAKE_REST',
            payload: 'short',
        });

        expect(next.character.currentHP).toBeGreaterThan(0);
        expect(next.character.dying).toBe(false);
        expect(next.character.conditions).not.toContain('Unconscious');
        expect(next.character.deathSaves).toEqual({ successes: 0, failures: 0 });
        expect(next.character.hitDice.remaining).toBe(0);
    });

    it('long rest does not revive a dead character', () => {
        const start = makeFighter({
            currentHP: 0,
            isDead: true,
            classResources: {
                secondWind: { used: 1, max: 1 },
                actionSurge: { used: 1, max: 1 },
            },
        });

        const next = gameReducer(start, {
            type: 'TAKE_REST',
            payload: 'long',
        });

        expect(next.character.currentHP).toBe(0);
        expect(next.character.isDead).toBe(true);
        expect(next.character.classResources.secondWind.used).toBe(1);
        expect(next.messages.at(-1).content).toContain('dead cannot recover');
    });
});
