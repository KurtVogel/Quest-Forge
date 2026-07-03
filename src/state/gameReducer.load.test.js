import { describe, expect, it } from 'vitest';
import { gameReducer, initialGameState } from './gameReducer.js';

const baseCharacter = {
    name: 'Survivor',
    race: 'human',
    class: 'fighter',
    level: 1,
    exp: 350,
    currentHP: 12,
    maxHP: 12,
    abilityScores: {
        strength: 16,
        dexterity: 12,
        constitution: 14,
        intelligence: 10,
        wisdom: 10,
        charisma: 8,
    },
    conditions: [],
};

describe('LOAD_GAME progression migrations', () => {
    it('does not replay saved mechanic narration cues after Continue or Load', () => {
        const next = gameReducer(initialGameState, {
            type: 'LOAD_GAME',
            payload: {
                character: { ...baseCharacter, exp: 0 },
                inventory: [],
                messages: [{
                    id: 'second-wind-result',
                    role: 'system',
                    content: 'Second Wind restores 7 HP.',
                    narrationCue: {
                        mechanic: 'Second Wind',
                        actionType: 'bonus action',
                        effect: 'Vesa regains 7 HP',
                    },
                }, {
                    id: 'dm-flavor',
                    role: 'assistant',
                    content: 'Vesa catches his breath and finds his footing.',
                }],
            },
        });

        expect(next.messages).toHaveLength(2);
        expect(next.messages[0].content).toBe('Second Wind restores 7 HP.');
        expect(next.messages[0]).not.toHaveProperty('narrationCue');
        expect(next.messages[1].content).toContain('finds his footing');
    });

    it('applies pending level-ups for saves that crossed the new XP threshold', () => {
        const next = gameReducer(initialGameState, {
            type: 'LOAD_GAME',
            payload: {
                character: baseCharacter,
                inventory: [],
                messages: [],
            },
        });

        expect(next.character.level).toBe(2);
        expect(next.character.exp).toBe(50);
        expect(next.character.maxHP).toBe(20);
        expect(next.character.currentHP).toBe(next.character.maxHP);
        expect(next.character.hitDice).toEqual({ total: 2, remaining: 2, die: 10 });
        expect(next.messages.some(m => m.content.includes('Level Up'))).toBe(true);
    });

    it('defaults old fighter saves to Defense and recalculates AC with the style bonus', () => {
        const next = gameReducer(initialGameState, {
            type: 'LOAD_GAME',
            payload: {
                character: { ...baseCharacter, exp: 0, armorClass: 18 },
                inventory: [
                    { type: 'armor', baseAC: 16, armorType: 'heavy', equipped: true },
                    { type: 'shield', isShield: true, shieldAC: 2, equipped: true },
                ],
                messages: [],
            },
        });

        expect(next.character.fightingStyle).toBe('defense');
        expect(next.character.armorClass).toBe(19);
    });

    it('loads old two-handed weapon plus shield saves into a legal equipment state', () => {
        const next = gameReducer(initialGameState, {
            type: 'LOAD_GAME',
            payload: {
                character: { ...baseCharacter, exp: 0, armorClass: 18 },
                inventory: [
                    { type: 'weapon', name: 'Greatsword', damage: '2d6', twoHanded: true, equipped: true },
                    { type: 'armor', baseAC: 16, armorType: 'heavy', equipped: true },
                    { type: 'shield', isShield: true, shieldAC: 2, equipped: true },
                ],
                messages: [],
            },
        });

        const greatsword = next.inventory.find(i => i.name === 'Greatsword');
        const shield = next.inventory.find(i => i.type === 'shield');
        expect(greatsword.equipped).toBe(true);
        expect(shield.equipped).toBe(false);
        expect(next.character.armorClass).toBe(17); // chain mail 16 + Defense, no shield
    });

    it('defaults old level 3+ fighter saves to Champion', () => {
        const next = gameReducer(initialGameState, {
            type: 'LOAD_GAME',
            payload: {
                character: {
                    ...baseCharacter,
                    level: 3,
                    exp: 0,
                    maxHP: 28,
                    currentHP: 28,
                    features: ['Second Wind', 'Fighting Style', 'Action Surge', 'Martial Archetype'],
                },
                inventory: [],
                messages: [],
            },
        });

        expect(next.character.martialArchetype).toBe('champion');
    });

    it('backfills a pending ASI for old level 4+ saves', () => {
        const next = gameReducer(initialGameState, {
            type: 'LOAD_GAME',
            payload: {
                character: {
                    ...baseCharacter,
                    level: 4,
                    exp: 0,
                    maxHP: 36,
                    currentHP: 36,
                    features: ['Second Wind', 'Fighting Style', 'Action Surge', 'Martial Archetype', 'Ability Score Improvement'],
                },
                inventory: [],
                messages: [],
            },
        });

        expect(next.character.pendingAbilityScoreImprovements).toBe(1);
        expect(next.character.abilityScoreImprovementsApplied).toBe(0);
    });

    it('backfills bonus-action combat state for old active combat saves', () => {
        const next = gameReducer(initialGameState, {
            type: 'LOAD_GAME',
            payload: {
                character: { ...baseCharacter, exp: 0 },
                inventory: [],
                messages: [],
                combat: {
                    active: true,
                    enemies: [],
                    turnOrder: [],
                    currentTurn: 0,
                    round: 1,
                    xpAwarded: false,
                },
            },
        });

        expect(next.combat.bonusActionUsed).toBe(false);
    });

    it('preserves bounded enemy conditions and narration post-state across reloads', () => {
        const next = gameReducer(initialGameState, {
            type: 'LOAD_GAME',
            payload: {
                character: { ...baseCharacter, exp: 0 },
                inventory: [],
                messages: [],
                combat: {
                    active: true,
                    phase: 'awaiting_narration',
                    enemies: [{
                        id: 'worg', name: 'Cave-Worg', hp: 9, maxHp: 32, ac: 14,
                        condition: 'critical', conditions: ['Prone', 'made-up'], combatStatus: 'active',
                    }],
                    turnOrder: [{ type: 'player', name: 'Survivor', initiative: 15 }],
                    currentTurn: 0,
                    round: 5,
                    lastExchangeResult: {
                        exchangeId: 'exchange-5',
                        kind: 'exchange',
                        round: 5,
                        terminal: null,
                        summary: 'Cave-Worg remains alive.',
                        events: [],
                        postState: {
                            player: { name: 'Survivor', hp: 12, maxHp: 12 },
                            enemies: [{ name: 'Cave-Worg', hp: 9, maxHp: 32, status: 'active', conditions: ['Prone'] }],
                            companions: [],
                        },
                    },
                },
            },
        });

        expect(next.combat.enemies[0].conditions).toEqual(['prone']);
        expect(next.combat.lastExchangeResult.postState.enemies[0].conditions).toEqual(['prone']);
    });

    it('hydrates appliedLootSourceIds from save state and backfills to empty array if missing', () => {
        const withIds = gameReducer(initialGameState, {
            type: 'LOAD_GAME',
            payload: {
                character: { ...baseCharacter, exp: 0 },
                inventory: [],
                messages: [],
                appliedLootSourceIds: ['msg-1', 'msg-2'],
            },
        });
        expect(withIds.appliedLootSourceIds).toEqual(['msg-1', 'msg-2']);

        const withoutIds = gameReducer(initialGameState, {
            type: 'LOAD_GAME',
            payload: {
                character: { ...baseCharacter, exp: 0 },
                inventory: [],
                messages: [],
            },
        });
        expect(withoutIds.appliedLootSourceIds).toEqual([]);
    });
});
