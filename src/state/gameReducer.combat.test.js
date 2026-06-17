import { describe, expect, it, vi, beforeEach } from 'vitest';

const { rollQueue } = vi.hoisted(() => ({ rollQueue: [] }));

vi.mock('../engine/dice.ts', () => {
    let id = 0;
    const draw = () => (rollQueue.length ? rollQueue.shift() : 10);
    const makeResult = (rolls, modifier, description) => {
        const subtotal = rolls.reduce((sum, roll) => sum + roll, 0);
        return {
            id: `initiative-test-${++id}`,
            timestamp: 0,
            notation: '1d20',
            dice: { count: rolls.length, sides: 20 },
            rolls,
            subtotal,
            modifier,
            total: subtotal + modifier,
            description,
            isCritical: rolls.length === 1 && rolls[0] === 20,
            isCritFail: rolls.length === 1 && rolls[0] === 1,
        };
    };
    return {
        rollDie: () => draw(),
        rollWithModifier: (count, sides, modifier = 0, description = '') =>
            makeResult(Array.from({ length: count }, draw), modifier, description),
        rollNotation: (notation, description = '') => makeResult([draw()], 0, description || notation),
    };
});

const { gameReducer, initialGameState } = await import('./gameReducer.js');

function makeState() {
    return {
        ...initialGameState,
        character: {
            name: 'Astra',
            race: 'human',
            class: 'fighter',
            level: 1,
            currentHP: 12,
            maxHP: 12,
            abilityScores: {
                strength: 16,
                dexterity: 14,
                constitution: 14,
                intelligence: 10,
                wisdom: 10,
                charisma: 8,
            },
            conditions: [],
        },
        party: [{ id: 'companion-1', name: 'Garrick', hp: 10, maxHp: 10, status: 'healthy' }],
        messages: [],
        rollHistory: [],
    };
}

beforeEach(() => {
    rollQueue.length = 0;
});

describe('combat start initiative', () => {
    it('rolls player, companion, and enemy initiative in the engine instead of trusting DM values', () => {
        rollQueue.push(
            4,  // enemy initiative, despite DM sending 99
            12, // player initiative d20 + DEX 2 = 14
            9   // companion initiative
        );

        const next = gameReducer(makeState(), {
            type: 'START_COMBAT',
            payload: {
                playerInitiative: 1,
                enemies: [{ name: 'Goblin', hp: 7, ac: 13, initiative: 99 }],
            },
        });

        expect(next.combat.active).toBe(true);
        expect(next.combat.enemies[0]).toMatchObject({ name: 'Goblin', initiative: 4 });
        expect(next.combat.turnOrder.map(t => `${t.type}:${t.initiative}`)).toEqual([
            'player:14',
            'companion:9',
            'enemy:4',
        ]);
        expect(next.rollHistory[0]).toMatchObject({ description: 'Initiative', total: 14 });
        expect(next.messages.at(-1).content).toContain('Initiative');
    });
});

describe('combat victory finalization', () => {
    it('ends combat and awards fallback XP when all enemies are defeated', () => {
        const state = {
            ...makeState(),
            combat: {
                active: true,
                enemies: [{ id: 'enemy-1', name: 'Goblin', hp: 0, maxHp: 7, ac: 13, condition: 'dead' }],
                turnOrder: [{ type: 'player', name: 'Astra', initiative: 14 }],
                currentTurn: 0,
                round: 2,
                xpAwarded: false,
            },
        };

        const next = gameReducer(state, { type: 'FINALIZE_VICTORY' });

        expect(next.combat.active).toBe(false);
        expect(next.character.exp).toBeGreaterThan(0);
        expect(next.messages.some(m => m.content.includes('Experience gained'))).toBe(true);
    });

    it('does not end combat while any enemy is still alive', () => {
        const state = {
            ...makeState(),
            combat: {
                active: true,
                enemies: [
                    { id: 'enemy-1', name: 'Goblin', hp: 0, maxHp: 7, ac: 13, condition: 'dead' },
                    { id: 'enemy-2', name: 'Guard', hp: 5, maxHp: 11, ac: 14, condition: 'bloodied' },
                ],
                turnOrder: [{ type: 'player', name: 'Astra', initiative: 14 }],
                currentTurn: 0,
                round: 2,
                xpAwarded: false,
            },
        };

        const next = gameReducer(state, { type: 'FINALIZE_VICTORY' });

        expect(next).toBe(state);
    });

    it('resolves a combat exchange by advancing while enemies remain', () => {
        const state = {
            ...makeState(),
            combat: {
                active: true,
                enemies: [{ id: 'enemy-1', name: 'Guard', hp: 5, maxHp: 11, ac: 14, condition: 'bloodied' }],
                turnOrder: [{ type: 'player', name: 'Astra', initiative: 14 }],
                currentTurn: 0,
                round: 2,
                xpAwarded: false,
            },
        };

        const next = gameReducer(state, { type: 'RESOLVE_COMBAT_EXCHANGE' });

        expect(next.combat.active).toBe(true);
        expect(next.combat.round).toBe(3);
    });

    it('resolves a combat exchange by ending defeated combat without duplicate XP', () => {
        const state = {
            ...makeState(),
            character: { ...makeState().character, exp: 50 },
            combat: {
                active: true,
                enemies: [{ id: 'enemy-1', name: 'Goblin', hp: 0, maxHp: 7, ac: 13, condition: 'dead' }],
                turnOrder: [{ type: 'player', name: 'Astra', initiative: 14 }],
                currentTurn: 0,
                round: 2,
                xpAwarded: true,
            },
        };

        const next = gameReducer(state, { type: 'RESOLVE_COMBAT_EXCHANGE' });

        expect(next.combat.active).toBe(false);
        expect(next.character.exp).toBe(50);
        expect(next.messages.some(m => m.content.includes('Experience gained'))).toBe(false);
    });
});
