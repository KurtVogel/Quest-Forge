import { describe, expect, it } from 'vitest';
import { getCombatStatus } from './combatStatus.js';

const combat = (overrides = {}) => ({
    active: true,
    enemies: [{ id: 'enemy-1', name: 'Goblin', hp: 5, maxHp: 7, condition: 'bloodied' }],
    turnOrder: [{ type: 'player', name: 'Astra', initiative: 12 }],
    currentTurn: 0,
    ...overrides,
});

describe('combat status helper', () => {
    it('prioritizes victory when every enemy is defeated', () => {
        const status = getCombatStatus({
            character: { pendingActionSurge: true, currentHP: 10 },
            combat: combat({
                enemies: [{ id: 'enemy-1', name: 'Goblin', hp: 0, maxHp: 7, condition: 'dead' }],
            }),
        });

        expect(status.variant).toBe('victory');
        expect(status.title).toContain('Victory');
    });

    it('shows death-save progress while dying', () => {
        const status = getCombatStatus({
            character: {
                currentHP: 0,
                dying: true,
                deathSaves: { successes: 1, failures: 2 },
            },
            combat: combat(),
        });

        expect(status.variant).toBe('danger');
        expect(status.detail).toContain('1/3 successes');
        expect(status.detail).toContain('2/3 failures');
    });

    it('shows low-level defeat before ordinary turn prompts', () => {
        const status = getCombatStatus({
            character: { currentHP: 0, lowLevelDefeat: true, pendingActionSurge: true },
            combat: combat(),
        });

        expect(status.variant).toBe('defeated');
        expect(status.title).toBe('Defeated, not dead');
    });

    it('shows Action Surge when the player is otherwise able to act', () => {
        const status = getCombatStatus({
            character: { currentHP: 12, pendingActionSurge: true },
            combat: combat({ bonusActionUsed: false }),
        });

        expect(status.variant).toBe('surge');
        expect(status.title).toBe('Action Surge active');
        expect(status.detail).toContain('Bonus action: available');
    });

    it('shows player turn bonus-action availability', () => {
        const available = getCombatStatus({
            character: { currentHP: 12 },
            combat: combat({ bonusActionUsed: false }),
        });
        const spent = getCombatStatus({
            character: { currentHP: 12 },
            combat: combat({ bonusActionUsed: true }),
        });

        expect(available.detail).toContain('Bonus action: available');
        expect(spent.detail).toContain('Bonus action: used');
    });

    it('identifies companion and enemy turns', () => {
        const allyStatus = getCombatStatus({
            character: { currentHP: 12 },
            party: [{ id: 'ally-1', name: 'Garrick', hp: 8, status: 'active' }],
            combat: combat({
                turnOrder: [{ type: 'companion', id: 'ally-1', name: 'Garrick', initiative: 10 }],
            }),
        });
        const enemyStatus = getCombatStatus({
            character: { currentHP: 12 },
            combat: combat({
                turnOrder: [{ type: 'enemy', id: 'enemy-1', name: 'Goblin', initiative: 9 }],
            }),
        });

        expect(allyStatus.variant).toBe('ally');
        expect(allyStatus.title).toBe('Garrick is ready');
        expect(enemyStatus.variant).toBe('enemy');
        expect(enemyStatus.title).toBe("Goblin's turn");
    });
});
