import { describe, expect, it } from 'vitest';
import { gameReducer, initialGameState } from './gameReducer.js';

describe('LOAD_GAME fronts heal', () => {
    const healBase = {
        character: {
            name: 'Survivor', race: 'human', class: 'fighter', level: 1, exp: 0,
            currentHP: 12, maxHP: 12, conditions: [],
        },
        inventory: [],
        messages: [],
    };

    it('preserves saved fronts exactly when present', () => {
        const next = gameReducer(initialGameState, {
            type: 'LOAD_GAME',
            payload: {
                ...healBase,
                fronts: [{ id: 'front-tide', title: 'The Withering Tide', goal: 'Drown the coast', stakes: 'The port falls', clock: 4, grimPortents: ['a', 'b', 'c'] }],
            },
        });
        expect(next.fronts).toHaveLength(1);
        expect(next.fronts[0].id).toBe('front-tide');
        expect(next.fronts[0].clock).toBe(4);
    });

    it('reseeds a deterministic front when a pre-serializer save lost them', () => {
        const next = gameReducer(initialGameState, {
            type: 'LOAD_GAME',
            payload: { ...healBase, currentLocation: 'Oakhaven', session: { id: 's1', premise: 'A smugglers war brews.' } },
        });
        expect(next.fronts).toHaveLength(1);
        expect(next.fronts[0].id).toBe('front-local-pressure');
        expect(next.fronts[0].title).toContain('Oakhaven');
    });

    it('reopens the Dynamic World upgrade when healing, keeping cadence watermarks', () => {
        const next = gameReducer(initialGameState, {
            type: 'LOAD_GAME',
            payload: {
                ...healBase,
                session: {
                    id: 's1',
                    frontDirector: { version: 2, generationVersion: 2, source: 'fresh-campaign', lastCadenceId: 'journal-s1-30', lastJournalEnd: 30 },
                },
            },
        });
        expect(next.fronts).toHaveLength(1);
        expect(next.session.frontDirector.generationVersion).toBeUndefined();
        expect(next.session.frontDirector.source).toBeUndefined();
        expect(next.session.frontDirector.lastCadenceId).toBe('journal-s1-30');
        expect(next.session.frontDirector.lastJournalEnd).toBe(30);
    });

    it('does not seed fronts when the save has no character', () => {
        const next = gameReducer(initialGameState, {
            type: 'LOAD_GAME',
            payload: { character: null, inventory: [], messages: [] },
        });
        expect(next.fronts).toEqual([]);
    });
});

describe('LOAD_GAME fighter level-bonus retirement notice (DECISIONS.md 2026-07-19)', () => {
    const fighterSave = (character = {}) => ({
        character: {
            name: 'Veteran', race: 'human', class: 'fighter', level: 4, exp: 900,
            currentHP: 30, maxHP: 30, conditions: [],
            abilityScores: { strength: 16, dexterity: 12, constitution: 14, intelligence: 10, wisdom: 10, charisma: 8 },
            ...character,
        },
        inventory: [],
        messages: [],
    });

    it('shows the notice once for a legacy level-2+ fighter and stamps the flag', () => {
        const next = gameReducer(initialGameState, { type: 'LOAD_GAME', payload: fighterSave() });
        expect(next.messages.at(-1).content).toContain('flat level bonus to hit and damage has been retired');
        expect(next.character.levelBonusRetired).toBe(true);

        const again = gameReducer(initialGameState, {
            type: 'LOAD_GAME',
            payload: { ...fighterSave(), character: { ...next.character } },
        });
        expect(again.messages.some(m => (m.content || '').includes('has been retired'))).toBe(false);
    });

    it('stays quiet for level-1 fighters and non-fighters', () => {
        const l1 = gameReducer(initialGameState, { type: 'LOAD_GAME', payload: fighterSave({ level: 1, exp: 0 }) });
        expect(l1.messages.some(m => (m.content || '').includes('has been retired'))).toBe(false);

        const wizard = gameReducer(initialGameState, {
            type: 'LOAD_GAME',
            payload: fighterSave({ class: 'wizard', level: 4 }),
        });
        expect(wizard.messages.some(m => (m.content || '').includes('has been retired'))).toBe(false);
    });
});

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

    it('sanitizes the recentRests replay ledger from untrusted saves', () => {
        const next = gameReducer(initialGameState, {
            type: 'LOAD_GAME',
            payload: {
                character: { ...baseCharacter, exp: 0 },
                inventory: [],
                messages: [],
                recentRests: ['msg-1|long|4', { hostile: true }, 42, 'msg-2|short|6'],
            },
        });

        expect(next.recentRests).toEqual(['msg-1|long|4', 'msg-2|short|6']);

        const missing = gameReducer(initialGameState, {
            type: 'LOAD_GAME',
            payload: { character: { ...baseCharacter, exp: 0 }, inventory: [], messages: [] },
        });
        expect(missing.recentRests).toEqual([]);
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

    it('backfills all missed 5e-cadence ASIs (4/8/12/16/19) for a high-level save', () => {
        const next = gameReducer(initialGameState, {
            type: 'LOAD_GAME',
            payload: {
                character: {
                    ...baseCharacter,
                    level: 12,
                    exp: 0,
                    maxHP: 90,
                    currentHP: 90,
                    abilityScoreImprovementsApplied: 1,
                    pendingAbilityScoreImprovements: 0,
                },
                inventory: [],
                messages: [],
            },
        });

        expect(next.character.pendingAbilityScoreImprovements).toBe(2);
        expect(next.character.abilityScoreImprovementsApplied).toBe(1);
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

    it('hydrates appliedLootSourceIds and recentPurchases from save state and backfills missing arrays', () => {
        const withIds = gameReducer(initialGameState, {
            type: 'LOAD_GAME',
            payload: {
                character: { ...baseCharacter, exp: 0 },
                inventory: [],
                messages: [],
                appliedLootSourceIds: ['msg-1', 'msg-2'],
                recentPurchases: [{
                    signature: 'dagger|1|200',
                    itemKey: 'dagger',
                    name: 'Dagger',
                    quantity: 1,
                    priceCp: 200,
                    sourceId: 'msg-buy-1',
                    messageIndex: 4,
                    timestamp: 123,
                }],
            },
        });
        expect(withIds.appliedLootSourceIds).toEqual(['msg-1', 'msg-2']);
        expect(withIds.recentPurchases).toEqual([expect.objectContaining({
            signature: 'dagger|1|200',
            itemKey: 'dagger',
            priceCp: 200,
        })]);
        expect(withIds.recentSales).toEqual([]);

        const withoutIds = gameReducer(initialGameState, {
            type: 'LOAD_GAME',
            payload: {
                character: { ...baseCharacter, exp: 0 },
                inventory: [],
                messages: [],
            },
        });
        expect(withoutIds.appliedLootSourceIds).toEqual([]);
        expect(withoutIds.recentPurchases).toEqual([]);
        expect(withoutIds.recentSales).toEqual([]);
    });
});
