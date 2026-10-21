/**
 * The 2026-10-20 spellcasting queue in the exchange engine: a bonus-action
 * spell leaves the action room for a cantrip only (DECISIONS.md 2026-10-21),
 * and the downgraded-upcast clause rides the exchange's cast note too.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { COMBAT_PHASES } from './combatPredicates.js';
import { normalizeCombatExchange } from './combatWire.js';
import { planCombatExchange } from './combatExchange.js';
import { buildSpellSlots } from './spellcasting.js';

const { rollQueue } = vi.hoisted(() => ({ rollQueue: [] }));

vi.mock('./dice.ts', () => {
    let id = 0;
    const draw = () => {
        if (!rollQueue.length) throw new Error('dice queue exhausted — a test under-queued its rolls');
        return rollQueue.shift();
    };
    const parseNotation = notation => {
        const match = String(notation).replace(/\s+/g, '').match(/^(\d+)d(\d+)([+-]\d+)?$/i);
        if (!match) throw new Error(`Invalid notation: ${notation}`);
        return { count: Number(match[1]), sides: Number(match[2]), modifier: match[3] ? Number(match[3]) : 0 };
    };
    return {
        parseNotation,
        rollWithModifier: (count, sides, modifier = 0, description = '') => {
            const rolls = Array.from({ length: count }, draw);
            const subtotal = rolls.reduce((sum, value) => sum + value, 0);
            return {
                id: `exchange-roll-${++id}`, timestamp: 0, notation: `${count}d${sides}`, dice: { count, sides },
                rolls, subtotal, modifier, total: subtotal + modifier, description,
                isCritical: count === 1 && sides === 20 && rolls[0] === 20,
                isCritFail: count === 1 && sides === 20 && rolls[0] === 1,
            };
        },
        rollDice: (count) => Array.from({ length: count }, draw),
    };
});

function clericState({ character: charOverrides = {} } = {}) {
    return {
        character: {
            name: 'Vesa', class: 'cleric', level: 5, currentHP: 12, maxHP: 20, armorClass: 10,
            abilityScores: { strength: 12, dexterity: 10, constitution: 14, intelligence: 10, wisdom: 16, charisma: 12 },
            skillProficiencies: [], conditions: [], classResources: { channelDivinity: { used: 0, max: 1 } },
            spellSlots: buildSpellSlots(5),
            ...charOverrides,
        },
        inventory: [],
        party: [],
        combat: {
            active: true, phase: COMBAT_PHASES.AWAITING_PLAYER, round: 1,
            enemies: [{ id: 'Goblin', name: 'Goblin', hp: 10, maxHp: 10, ac: 12, attackBonus: 4, damage: '1d6+2', condition: 'healthy', conditions: [], combatStatus: 'active' }],
            turnOrder: [{ type: 'player', name: 'Vesa', initiative: 15 }], currentTurn: 0,
        },
    };
}

const notes = (plan) => plan.payload.result.events.filter(e => e.type === 'note').map(e => e.text);

beforeEach(() => {
    rollQueue.length = 0;
    rollQueue.push(...Array(40).fill(3));
});

describe('a bonus-action spell leaves the action room for a cantrip only (2026-10-20 P2)', () => {
    it('Healing Word + Cure Wounds is refused with the rule, and no slot is spent', () => {
        const state = clericState();
        const plan = planCombatExchange(state, normalizeCombatExchange({
            player_slots: [
                { action: 'cast', spell: 'healing word', target: 'self' },
                { action: 'cast', spell: 'cure wounds', target: 'self' },
            ],
        }));
        expect(plan.ok).toBe(false);
        expect(plan.error).toMatch(/A bonus-action spell leaves room for a cantrip only — Cure Wounds is a leveled spell/);
        expect(state.character.spellSlots[1].used).toBe(0);
    });

    it('Healing Word + Spiritual Weapon (two level-2 slots) is refused the same way', () => {
        const plan = planCombatExchange(clericState(), normalizeCombatExchange({
            player_slots: [
                { action: 'cast', spell: 'spiritual weapon', target: 'Goblin' },
                { action: 'cast', spell: 'healing word', target: 'self' },
            ],
        }));
        expect(plan.ok).toBe(false);
        expect(plan.error).toMatch(/Spiritual Weapon is a leveled spell/);
    });

    it('Healing Word + Sacred Flame (a cantrip) plans, spending exactly one slot', () => {
        const plan = planCombatExchange(clericState(), normalizeCombatExchange({
            player_slots: [
                { action: 'cast', spell: 'healing word', target: 'self' },
                { action: 'cast', spell: 'sacred flame', target: 'Goblin' },
            ],
        }));
        expect(plan.ok).toBe(true);
        const slots = plan.payload.characterUpdates.spellSlots;
        expect(slots[2].used).toBe(1);
        expect(slots[1].used).toBe(0);
    });

    it('Healing Word + a weapon attack stays legal', () => {
        const plan = planCombatExchange(clericState(), normalizeCombatExchange({
            player_slots: [
                { action: 'cast', spell: 'healing word', target: 'self' },
                { action: 'attack', target: 'Goblin' },
            ],
        }));
        expect(plan.ok).toBe(true);
    });

    it('a lone leveled cast is the turn\'s one spell, as before', () => {
        const plan = planCombatExchange(clericState(), normalizeCombatExchange({
            player_slots: [{ action: 'cast', spell: 'cure wounds', target: 'self' }],
        }));
        expect(plan.ok).toBe(true);
        expect(plan.payload.characterUpdates.spellSlots[1].used).toBe(1);
    });
});

describe('the exchange\'s cast note names a downgraded upcast (2026-10-20 P2)', () => {
    it('slot_level 2 with every level-2 slot spent casts at level 1 and SAYS so', () => {
        const spellSlots = buildSpellSlots(5);
        spellSlots[2] = { ...spellSlots[2], used: spellSlots[2].max };
        const plan = planCombatExchange(clericState({ character: { spellSlots } }), normalizeCombatExchange({
            player_slots: [{ action: 'cast', spell: 'cure wounds', target: 'self', slot_level: 2 }],
        }));
        expect(plan.ok).toBe(true);
        expect(notes(plan)).toContainEqual(expect.stringContaining('casts Cure Wounds** (no level 2 slot left — cast at level 1)'));
        expect(plan.payload.characterUpdates.spellSlots[1].used).toBe(1);
    });

    it('an honored upcast keeps "using a level N slot"', () => {
        const plan = planCombatExchange(clericState(), normalizeCombatExchange({
            player_slots: [{ action: 'cast', spell: 'cure wounds', target: 'self', slot_level: 3 }],
        }));
        expect(plan.ok).toBe(true);
        expect(notes(plan)).toContainEqual(expect.stringContaining('casts Cure Wounds** using a level 3 slot'));
    });
});
