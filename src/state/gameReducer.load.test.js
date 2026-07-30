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

describe('LOAD_GAME entry-shape guards (queue 2026-07-29)', () => {
    // A JSON round-trip mints `null` from an undefined array hole (cloud saves are
    // one) — a single null entry in any of these crashed buildSystemPrompt on every
    // turn: q.status, buildPartyBlock's c.status, buildRecentRollsBlock's
    // r.rolls.join, the journal's consequences.join, namesMatch on an npc name.
    const poisonedSave = () => ({
        character: { ...baseCharacter },
        inventory: [],
        messages: [],
        quests: [null, { id: 'q1', name: 'Find the ledger', status: 'active' }],
        party: [null, { id: 'c1', name: 'Terho', hp: 10, maxHp: 10, ac: 13, level: 1, affinity: 50 }],
        rollHistory: [
            null,
            { description: 'Stealth check', total: 17, rolls: [15], modifier: 2 },
            { description: 'rolls went missing', total: 9 },
        ],
        journal: [
            null,
            { summary: 'Reached Brackwater.', consequences: 'The reeve remembers', keyDecisions: 'Refused the toll' },
            { summary: 'Fought wolves.', consequences: ['Pack scattered'], keyDecisions: [] },
        ],
        npcs: [null, { name: 42, disposition: 'wary' }, { name: '  ', disposition: 'wary' }, { name: 'Mother Sorsa', disposition: 'neutral' }],
    });

    it('drops null/malformed entries and heals legacy string-valued journal lists', () => {
        const next = gameReducer(initialGameState, { type: 'LOAD_GAME', payload: poisonedSave() });

        expect(next.quests).toHaveLength(1);
        expect(next.party).toHaveLength(1);
        expect(next.rollHistory).toHaveLength(1);
        expect(next.journal).toHaveLength(2);
        expect(next.journal[0].consequences).toEqual([]);
        expect(next.journal[0].keyDecisions).toEqual([]);
        expect(next.journal[1].consequences).toEqual(['Pack scattered']);
        // Junk npc entries dropped; the companion-parity heal minting Terho's
        // roster record is expected behavior (DECISIONS.md 2026-07-23).
        expect(next.npcs.map(n => n.name)).toEqual(['Mother Sorsa', 'Terho']);
    });

    it('heals a character with missing or non-object abilityScores to the six canonical scores', () => {
        const { abilityScores: _dropped, ...scoreless } = baseCharacter;
        const next = gameReducer(initialGameState, {
            type: 'LOAD_GAME',
            payload: { ...poisonedSave(), character: scoreless },
        });
        expect(next.character.abilityScores).toEqual({
            strength: 10, dexterity: 10, constitution: 10, intelligence: 10, wisdom: 10, charisma: 10,
        });

        const junkScores = gameReducer(initialGameState, {
            type: 'LOAD_GAME',
            payload: { ...poisonedSave(), character: { ...baseCharacter, abilityScores: { strength: '16', dexterity: {}, junk: 99 } } },
        });
        expect(junkScores.character.abilityScores).toEqual({
            strength: 16, dexterity: 10, constitution: 10, intelligence: 10, wisdom: 10, charisma: 10,
        });
    });

    it('builds a system prompt from the healed state without throwing', async () => {
        const { buildSystemPrompt } = await import('../llm/promptBuilder.js');
        const next = gameReducer(initialGameState, { type: 'LOAD_GAME', payload: poisonedSave() });
        const prompt = buildSystemPrompt({
            character: next.character,
            inventory: next.inventory,
            quests: next.quests,
            rollHistory: next.rollHistory,
            journal: next.journal,
            npcs: next.npcs,
            party: next.party,
            currentLocation: next.currentLocation,
            combat: next.combat,
            worldFacts: next.worldFacts,
            ruleset: 'simplified5e',
        });
        expect(prompt).toContain('Find the ledger');
        expect(prompt).toContain('Terho');
        expect(prompt).toContain('Stealth check');
        expect(prompt).toContain('Reached Brackwater.');
    });
});

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

describe('LOAD_GAME poisoned messages heal (2026-07-25 P1)', () => {
    const baseSave = {
        character: {
            name: 'Survivor', race: 'human', class: 'fighter', level: 1, exp: 0,
            currentHP: 12, maxHP: 12, conditions: [],
        },
        inventory: [],
    };

    it('drops null and non-object message entries instead of crashing the load', () => {
        // JSON.stringify([undefined]) === '[null]' — a cloud round-trip mints
        // exactly this poison, and `.filter(m => m.summarized)` then threw,
        // making the save permanently un-loadable.
        const next = gameReducer(initialGameState, {
            type: 'LOAD_GAME',
            payload: {
                ...baseSave,
                messages: [
                    null,
                    { role: 'user', content: 'Hello', summarized: true },
                    undefined,
                    'junk string',
                    42,
                    { role: 'assistant', content: 'Hi there' },
                ],
            },
        });
        expect(next.messages.map(m => m.content)).toEqual(['Hello', 'Hi there']);
        expect(next.session.prunedMessageCount).toBe(1);
    });

    it('still strips consumed narrationCues from surviving messages', () => {
        const next = gameReducer(initialGameState, {
            type: 'LOAD_GAME',
            payload: {
                ...baseSave,
                messages: [
                    null,
                    { role: 'system', content: 'Second Wind!', narrationCue: { kind: 'rest' } },
                ],
            },
        });
        expect(next.messages).toHaveLength(1);
        expect(next.messages[0].narrationCue).toBeUndefined();
    });
});

describe('LOAD_GAME progression-field heal (2026-07-28 audit)', () => {
    const corruptedSave = (character = {}) => ({
        character: {
            name: 'Survivor', race: 'human', class: 'fighter', level: 3, exp: 0,
            currentHP: 20, maxHP: 20, conditions: [],
            abilityScores: { strength: 16, dexterity: 12, constitution: 14, intelligence: 10, wisdom: 10, charisma: 8 },
            ...character,
        },
        inventory: [],
        messages: [],
    });

    it('numeric-coerces string-typed level/exp/maxHP/currentHP so XP math cannot string-concatenate', () => {
        const next = gameReducer(initialGameState, {
            type: 'LOAD_GAME',
            payload: corruptedSave({ level: '3', exp: '20', maxHP: '20', currentHP: '20' }),
        });

        expect(next.character.level).toBe(3);
        expect(next.character.exp).toBe(20);
        expect(next.character.maxHP).toBe(20);
        expect(next.character.currentHP).toBe(20);
    });

    it('falls back to sane floors for junk values and clamps out-of-band ones', () => {
        const next = gameReducer(initialGameState, {
            type: 'LOAD_GAME',
            payload: corruptedSave({ level: 'twelve', exp: { amount: 500 }, maxHP: -4, currentHP: 999 }),
        });

        expect(next.character.level).toBe(1);
        expect(next.character.exp).toBe(0);
        expect(next.character.maxHP).toBe(1);
        // currentHP clamps to the healed maxHP.
        expect(next.character.currentHP).toBe(1);
    });

    it('clamps a beyond-cap level back to the D&D maximum', () => {
        const next = gameReducer(initialGameState, {
            type: 'LOAD_GAME',
            payload: corruptedSave({ level: '99', maxHP: 200, currentHP: 200 }),
        });

        expect(next.character.level).toBe(20);
    });

    it('leaves an honest banked-XP save alone (the level-up-on-load path)', () => {
        const next = gameReducer(initialGameState, {
            type: 'LOAD_GAME',
            payload: corruptedSave({ level: 1, exp: 6500, maxHP: 12, currentHP: 12 }),
        });

        // The banked XP either stays banked or has been applied by the load path —
        // either way it must still be a number, never a string.
        expect(typeof next.character.exp).toBe('number');
        expect(next.character.level).toBeGreaterThanOrEqual(1);
    });
});
