/**
 * Reducer-side spellcasting v1: out-of-combat CAST_SPELL, rest slot recovery,
 * sustained-spell lifecycle, exchange commits, and save-load healing.
 */
import { describe, expect, it } from 'vitest';
import { gameReducer, initialGameState } from './gameReducer.js';
import { buildSpellSlots } from '../engine/spellcasting.js';
import { COMBAT_PHASES } from '../engine/combatExchange.js';

function clericState(overrides = {}) {
    return {
        ...initialGameState,
        character: {
            name: 'Maren',
            race: 'dwarf',
            class: 'cleric',
            level: 5,
            currentHP: 10,
            maxHP: 30,
            armorClass: 16,
            abilityScores: { strength: 12, dexterity: 10, constitution: 14, intelligence: 10, wisdom: 16, charisma: 12 },
            conditions: [],
            classResources: { channelDivinity: { used: 1, max: 1 } },
            hitDice: { total: 5, remaining: 5, die: 8 },
            spellSlots: buildSpellSlots(5),
            sustainedSpell: null,
            gold: 0, silver: 0, copper: 0,
            ...overrides.character,
        },
        inventory: overrides.inventory ?? [],
        party: overrides.party ?? [],
        messages: [],
        ...(overrides.state || {}),
    };
}

describe('CAST_SPELL (out of combat)', () => {
    it('heals the hero, spends the slot, and reports it', () => {
        const state = clericState();
        const next = gameReducer(state, {
            type: 'CAST_SPELL',
            payload: { spell: 'cure wounds', target: 'self', _meta: { sourceId: 'msg-1' } },
        });
        expect(next.character.currentHP).toBeGreaterThan(10);
        expect(next.character.spellSlots[1]).toEqual({ used: 1, max: 4 });
        expect(next.messages.at(-1).content).toMatch(/casts Cure Wounds/);
        expect(next.messages.at(-1).content).toMatch(/slots left/);
        expect(next.recentSpellCasts).toEqual(['msg-1|cureWounds']);
    });

    it('ignores an exact replay of the same casting from the same source message', () => {
        const state = clericState();
        const once = gameReducer(state, {
            type: 'CAST_SPELL',
            payload: { spell: 'cure wounds', _meta: { sourceId: 'msg-1' } },
        });
        const twice = gameReducer(once, {
            type: 'CAST_SPELL',
            payload: { spell: 'cure wounds', _meta: { sourceId: 'msg-1' } },
        });
        expect(twice).toBe(once);
    });

    it('rejects unknown spells and empty slot pools visibly, spending nothing', () => {
        const unknown = gameReducer(clericState(), { type: 'CAST_SPELL', payload: { spell: 'wish' } });
        expect(unknown.character.spellSlots[1].used).toBe(0);
        expect(unknown.messages.at(-1).content).toMatch(/not on Maren's engine-owned spell list/);

        const drained = clericState({
            character: {
                spellSlots: {
                    1: { used: 4, max: 4 }, 2: { used: 3, max: 3 }, 3: { used: 2, max: 2 },
                },
            },
        });
        const noSlots = gameReducer(drained, { type: 'CAST_SPELL', payload: { spell: 'cure wounds' } });
        expect(noSlots.character.currentHP).toBe(10);
        expect(noSlots.messages.at(-1).content).toMatch(/no level 1\+ spell slot remains/);
    });

    it('refuses spell_cast during active combat', () => {
        const state = {
            ...clericState(),
            combat: { ...initialGameState.combat, active: true },
        };
        const next = gameReducer(state, { type: 'CAST_SPELL', payload: { spell: 'cure wounds' } });
        expect(next.character.spellSlots[1].used).toBe(0);
        expect(next.messages.at(-1).content).toMatch(/combat exchange/);
    });

    it('sustains Shield of Faith on a companion and a later sustained cast replaces it', () => {
        const state = clericState({
            party: [{ id: 'jorun', name: 'Jorun', hp: 12, maxHp: 12, ac: 14, status: 'healthy', conditions: [] }],
        });
        const shielded = gameReducer(state, {
            type: 'CAST_SPELL',
            payload: { spell: 'shield of faith', target: 'Jorun' },
        });
        expect(shielded.character.sustainedSpell).toMatchObject({ key: 'shieldOfFaith', targetId: 'jorun', acBonus: 2 });
        expect(shielded.party[0].spellAcBonus).toBe(2);

        const swapped = gameReducer(shielded, {
            type: 'CAST_SPELL',
            payload: { spell: 'shield of faith', target: 'self' },
        });
        expect(swapped.character.sustainedSpell).toMatchObject({ key: 'shieldOfFaith', targetType: 'self' });
        expect(swapped.party[0].spellAcBonus).toBeUndefined();
        expect(swapped.character.armorClass).toBe(12); // unarmored 10 + DEX 0 + Shield of Faith 2, recomputed
    });

    it('cleanses conditions with restoration spells', () => {
        const state = clericState({ character: { conditions: ['Poisoned', 'Exhausted'] } });
        const next = gameReducer(state, { type: 'CAST_SPELL', payload: { spell: 'lesser restoration' } });
        expect(next.character.conditions).toEqual(['Exhausted']);
        expect(next.messages.at(-1).content).toMatch(/cleansed of: Poisoned/);
    });
});

describe('rest slot recovery and sustained lifecycle', () => {
    it('refills every slot on a long rest and ends the sustained spell', () => {
        const state = clericState({
            character: {
                spellSlots: { ...buildSpellSlots(5), 1: { used: 3, max: 4 } },
                sustainedSpell: { key: 'shieldOfFaith', name: 'Shield of Faith', acBonus: 2, targetType: 'self' },
            },
        });
        const next = gameReducer(state, { type: 'TAKE_REST', payload: 'long' });
        expect(next.character.spellSlots[1]).toEqual({ used: 0, max: 4 });
        expect(next.character.sustainedSpell).toBeNull();
        expect(next.messages.at(-1).content).toMatch(/Spell slots restored/);
    });

    it('gives a wizard Arcane Recovery on the first short rest per long-rest cycle only', () => {
        const wizard = clericState({
            character: {
                name: 'Imra', class: 'wizard', currentHP: 30,
                abilityScores: { strength: 8, dexterity: 12, constitution: 12, intelligence: 16, wisdom: 10, charisma: 10 },
                classResources: { arcaneRecovery: { used: 0, max: 1 } },
                hitDice: { total: 5, remaining: 5, die: 6 },
                spellSlots: { ...buildSpellSlots(5), 3: { used: 2, max: 2 } },
            },
        });
        const rested = gameReducer(wizard, { type: 'TAKE_REST', payload: 'short' });
        expect(rested.character.spellSlots[3].used).toBe(1); // ceil(5/2)=3 points → one 3rd-level slot
        expect(rested.character.classResources.arcaneRecovery.used).toBe(1);
        expect(rested.messages.at(-1).content).toMatch(/Arcane Recovery restores 3 slot levels/);

        const again = gameReducer(rested, { type: 'TAKE_REST', payload: 'short' });
        expect(again.character.spellSlots[3].used).toBe(1); // no second recovery
    });

    it('ends the sustained spell when combat ends, stripping the companion buff', () => {
        const state = {
            ...clericState({
                character: { sustainedSpell: { key: 'shieldOfFaith', name: 'Shield of Faith', acBonus: 2, targetType: 'companion', targetId: 'jorun' } },
                party: [{ id: 'jorun', name: 'Jorun', hp: 12, maxHp: 12, ac: 14, status: 'healthy', conditions: [], spellAcBonus: 2 }],
            }),
            combat: {
                ...initialGameState.combat,
                active: true,
                enemies: [{ id: 'e1', name: 'Ghoul', hp: 0, maxHp: 10, ac: 12, condition: 'dead', conditions: [], combatStatus: 'active' }],
                turnOrder: [{ type: 'player', name: 'Maren' }],
            },
        };
        const next = gameReducer(state, { type: 'END_COMBAT', payload: { llmAwardedXp: true } });
        expect(next.character.sustainedSpell).toBeNull();
        expect(next.party[0].spellAcBonus).toBeUndefined();
    });
});

describe('exchange commits and save loading', () => {
    it('APPLY_COMBAT_EXCHANGE commits healing before damage and spreads character updates', () => {
        const spentSlots = { ...buildSpellSlots(5), 2: { used: 1, max: 3 } };
        const state = {
            ...clericState(),
            combat: {
                ...initialGameState.combat,
                active: true,
                phase: COMBAT_PHASES.AWAITING_INTENT,
                enemies: [{ id: 'e1', name: 'Ghoul', hp: 10, maxHp: 10, ac: 12, condition: 'healthy', conditions: [], combatStatus: 'active' }],
                turnOrder: [{ type: 'player', name: 'Maren' }],
                resolvedExchangeIds: [],
            },
        };
        const next = gameReducer(state, {
            type: 'APPLY_COMBAT_EXCHANGE',
            payload: {
                exchangeId: 'x-1',
                result: { exchangeId: 'x-1', kind: 'exchange', terminal: null, events: [], summary: 'Healing Word lands.' },
                playerHealing: 8,
                playerDamage: 5,
                characterUpdates: { spellSlots: spentSlots },
                rolls: [],
            },
        });
        // 10 + 8 = 18, then -5 = 13 — never the other order (heal caps at max first).
        expect(next.character.currentHP).toBe(13);
        expect(next.character.spellSlots[2]).toEqual({ used: 1, max: 3 });
    });

    it('LOAD_GAME heals caster saves: missing slots rebuilt, junk sustained dropped', () => {
        const legacySave = {
            ...clericState(),
            character: {
                ...clericState().character,
                spellSlots: undefined,
                sustainedSpell: 'garbage',
            },
            session: { id: 'save-1', name: 'Legacy' },
        };
        const next = gameReducer(initialGameState, { type: 'LOAD_GAME', payload: legacySave });
        expect(next.character.spellSlots).toEqual(buildSpellSlots(5));
        expect(next.character.sustainedSpell).toBeNull();
    });
});
