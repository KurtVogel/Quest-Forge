/**
 * The 2026-10-22 strengthening queue, engine half (enemy-stats-conditions,
 * Lap 1): the hero's own condition release through the exchange envelope
 * (`player_condition_updates`), the helpless-foe rules the engine now runs
 * (a sleeper wakes on damage, a melee hit on a paralyzed / unconscious target
 * is a crit, restrained costs a DEX save only — foe and hero alike), and the
 * silent sync said once. The reducer twin is `state/gameReducer.queue1022.test.js`.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { COMBAT_PHASES } from './combatPredicates.js';
import { normalizeCombatExchange } from './combatWire.js';
import { mergeCharacterUpdates, planCombatExchange } from './combatExchange.js';
import { buildSpellSlots } from './spellcasting.js';
import { CONDITION_EFFECTS, getConditionRollEffects, getIncapacitatingCondition, isHelpless } from './rules.js';

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
        MAX_DIE_SIDES: 1000,
        parseNotation,
        rollWithModifier: (count, sides, modifier = 0, description = '') => {
            const rolls = Array.from({ length: count }, draw);
            const subtotal = rolls.reduce((sum, value) => sum + value, 0);
            return {
                id: `q-roll-${++id}`, timestamp: 0, notation: `${count}d${sides}${modifier >= 0 ? '+' + modifier : modifier}`,
                dice: { count, sides }, rolls, subtotal, modifier, total: subtotal + modifier, description,
                isCritical: count === 1 && sides === 20 && rolls[0] === 20,
                isCritFail: count === 1 && sides === 20 && rolls[0] === 1,
            };
        },
        rollDice: (count) => Array.from({ length: count }, draw),
    };
});

const goblin = (overrides = {}) => ({
    id: 'Goblin', name: 'Goblin', hp: 10, maxHp: 10, ac: 12, attackBonus: 4, damage: '1d6+2',
    condition: 'healthy', conditions: [], combatStatus: 'active', ...overrides,
});

const SWORD = { id: 'sword', name: 'Longsword', type: 'weapon', category: 'martialMelee', damage: '1d8', equipped: true };
const BOW = { id: 'bow', name: 'Shortbow', type: 'weapon', category: 'simpleRanged', damage: '1d6', ranged: true, equipped: true };

function state({ character = {}, party = [], enemies = [goblin()], inventory = [SWORD] } = {}) {
    return {
        character: {
            name: 'Astra', class: 'fighter', level: 3, currentHP: 20, maxHP: 20, armorClass: 16,
            abilityScores: { strength: 16, dexterity: 12, constitution: 14, intelligence: 10, wisdom: 10, charisma: 8 },
            skillProficiencies: [], conditions: [], dying: false, deathSaves: { successes: 0, failures: 0 },
            ...character,
        },
        inventory,
        party,
        combat: {
            active: true, phase: COMBAT_PHASES.AWAITING_PLAYER, round: 1, enemies,
            turnOrder: [{ type: 'player', name: 'Astra', initiative: 15 }], currentTurn: 0,
        },
    };
}

const wizardState = (overrides = {}) => state({
    ...overrides,
    character: {
        class: 'wizard', level: 5, spellSlots: buildSpellSlots(5),
        abilityScores: { strength: 8, dexterity: 12, constitution: 14, intelligence: 16, wisdom: 10, charisma: 8 },
        ...(overrides.character || {}),
    },
});

const attackIntent = (extra = {}) => normalizeCombatExchange({
    player_slots: [{ action: 'attack', strikes: [{ target: 'Goblin' }] }],
    enemy_intents: [{ enemy_id: 'Goblin', action: 'attack', target: 'player' }],
    ...extra,
});
const passIntent = (extra = {}) => normalizeCombatExchange({
    player_slots: [{ action: 'pass' }],
    enemy_intents: [{ enemy_id: 'Goblin', action: 'attack', target: 'player' }],
    ...extra,
});
const notes = plan => plan.payload.result.events.filter(e => e.type === 'note').map(e => e.text);

beforeEach(() => { rollQueue.length = 0; });

describe('the hero\'s release rides the exchange envelope (P1)', () => {
    it('the wire reads player_condition_updates.remove in canonical form — a scalar is one entry, junk is no key', () => {
        expect(normalizeCombatExchange({ player_slots: [{ action: 'pass' }], player_condition_updates: { remove: 'Paralyzed' } }).playerConditionUpdates)
            .toEqual({ remove: ['paralyzed'] });
        expect(normalizeCombatExchange({ player_slots: [{ action: 'pass' }], player_condition_updates: { remove_conditions: [' Frightened ', 'prone'] } }).playerConditionUpdates)
            .toEqual({ remove: ['frightened', 'prone'] });
        expect(normalizeCombatExchange({ player_slots: [{ action: 'pass' }], player_condition_updates: { remove: [] } })).not.toHaveProperty('playerConditionUpdates');
        expect(normalizeCombatExchange({ player_slots: [{ action: 'pass' }], player_condition_updates: 'paralyzed' })).not.toHaveProperty('playerConditionUpdates');
        // Removal only: an `add` never reaches the engine.
        expect(normalizeCombatExchange({ player_slots: [{ action: 'pass' }], player_condition_updates: { add: ['poisoned'] } })).not.toHaveProperty('playerConditionUpdates');
    });

    it('a paralyzed hero the fiction frees this exchange ACTS this exchange; the release is committed through characterUpdates', () => {
        // Hero d20 (the goblin is healthy — one die) + damage; the goblin's
        // attack on the FREED hero draws one die (no advantage) and misses.
        rollQueue.push(15, 4, 5);
        const plan = planCombatExchange(state({ character: { conditions: ['paralyzed'] } }), attackIntent({
            player_condition_updates: { remove: ['Paralyzed'] },
        }));
        expect(plan.ok).toBe(true);
        expect(rollQueue).toHaveLength(0);
        expect(notes(plan)[0]).toBe('Astra is no longer: paralyzed.');
        expect(plan.payload.result.events.find(e => e.type === 'attack' && e.actor === 'Astra')).toMatchObject({ hit: true, damage: 7 });
        expect(plan.payload.result.events.find(e => e.type === 'attack' && e.actor === 'Goblin')).toMatchObject({ hit: false, mode: '' });
        expect(plan.payload.characterUpdates).toEqual({ removeConditions: ['paralyzed'] });
        // APPLY_COMBAT_EXCHANGE merges exactly this (the cast lane's channel).
        expect(mergeCharacterUpdates({ conditions: ['paralyzed', 'poisoned'] }, plan.payload.characterUpdates).conditions).toEqual(['poisoned']);
    });

    it('a release of a condition the hero does not carry frees nothing — the pass rule stands and the note says so', () => {
        const plan = planCombatExchange(state({ character: { conditions: ['paralyzed'] } }), attackIntent({
            player_condition_updates: { remove: ['prone'] },
        }));
        expect(plan.ok).toBe(false);
        expect(plan.error).toContain('"player_condition_updates": { "remove": ["paralyzed"] }');
        expect(plan.error).toContain('a potion heals HP but does not end a condition');

        rollQueue.push(3, 17, 4, 2); // the goblin strikes the still-paralyzed hero (advantage; a helpless crit → two damage dice)
        const passed = planCombatExchange(state({ character: { conditions: ['paralyzed'] } }), passIntent({
            player_condition_updates: { remove: ['prone'] },
        }));
        expect(passed.ok).toBe(true);
        expect(notes(passed)[0]).toBe('player_condition_updates: Astra does not carry prone — nothing to end.');
        expect(passed.payload.characterUpdates).toBeNull();
    });

    it('a non-incapacitating condition releases the same way, with no gate in play — the rest stay', () => {
        // Poisoned stays: the hero's attack still draws TWO d20s (disadvantage,
        // the lower kept) + damage; the goblin's attack draws one and misses.
        rollQueue.push(15, 9, 4, 5);
        const plan = planCombatExchange(state({ character: { conditions: ['frightened', 'poisoned'] } }), attackIntent({
            player_condition_updates: { remove: ['frightened'] },
        }));
        expect(plan.ok).toBe(true);
        expect(rollQueue).toHaveLength(0);
        expect(plan.payload.result.events.find(e => e.type === 'attack' && e.actor === 'Astra')).toMatchObject({ hit: true, rolled: 14 });
        expect(plan.payload.characterUpdates).toEqual({ removeConditions: ['frightened'] });
    });
});

describe('the helpless-foe rules run in the engine (P2)', () => {
    it('HELPLESS is the paralyzed / unconscious pair, never stunned', () => {
        expect(isHelpless(['Paralyzed'])).toBe(true);
        expect(isHelpless(['unconscious'])).toBe(true);
        expect(isHelpless(['stunned'])).toBe(false);
        expect(isHelpless('paralyzed')).toBe(true);
        expect(isHelpless(null)).toBe(false);
    });

    it('a melee hit on a sleeping foe is a crit, and the blow wakes it', () => {
        // Advantage against the unconscious foe (two d20s), a crit's two
        // damage dice, then the WOKEN goblin's own attack (one d20, a miss).
        rollQueue.push(12, 8, 3, 4, 5);
        const plan = planCombatExchange(state({ enemies: [goblin({ hp: 20, maxHp: 20, conditions: ['unconscious'] })] }), attackIntent());
        expect(plan.ok).toBe(true);
        expect(rollQueue).toHaveLength(0);
        const strike = plan.payload.result.events.find(e => e.type === 'attack' && e.actor === 'Astra');
        expect(strike).toMatchObject({ hit: true, critical: true, damage: 10, remainingHp: 10 });
        expect(plan.payload.heroRolls[0]).toMatchObject({ isCritical: true, criticalThreshold: 'helpless target' });
        expect(notes(plan)).toContain('Goblin is no longer: unconscious — the blow wakes it.');
        expect(plan.payload.enemies[0].conditions).toEqual([]);
        // Awake, it acted: no "cannot act" note, an attack event of its own.
        expect(notes(plan).some(text => text.includes('cannot act'))).toBe(false);
        expect(plan.payload.result.events.find(e => e.type === 'attack' && e.actor === 'Goblin')).toMatchObject({ hit: false });
    });

    it('a bow shot on the sleeper still wakes it but is no crit — the helpless rule is a reach rule', () => {
        rollQueue.push(12, 8, 3, 5);
        const plan = planCombatExchange(state({ inventory: [BOW], enemies: [goblin({ hp: 20, maxHp: 20, conditions: ['unconscious'] })] }), attackIntent());
        expect(plan.ok).toBe(true);
        expect(rollQueue).toHaveLength(0);
        expect(plan.payload.result.events.find(e => e.type === 'attack' && e.actor === 'Astra')).toMatchObject({ hit: true, critical: false });
        expect(plan.payload.enemies[0].conditions).toEqual([]);
    });

    it('a companion\'s blow on a paralyzed foe is a crit too; a stunned foe is hit normally', () => {
        // Hero at advantage vs the stunned goblin: d20 ×2 + damage ×1 (no crit).
        // Tammo at advantage vs the paralyzed ogre: d20 ×2 + damage ×2 (crit).
        // Neither foe acts (both incapacitated).
        rollQueue.push(12, 8, 3, 12, 8, 2, 2);
        const plan = planCombatExchange(state({
            party: [{ id: 'tammo', name: 'Tammo', hp: 10, maxHp: 10, ac: 12, status: 'healthy', attackBonus: 3, damage: '1d6' }],
            enemies: [goblin({ conditions: ['stunned'] }), goblin({ id: 'Ogre', name: 'Ogre', hp: 30, maxHp: 30, conditions: ['paralyzed'] })],
        }), normalizeCombatExchange({
            player_slots: [{ action: 'attack', strikes: [{ target: 'Goblin' }] }],
            companion_intents: [{ companion_id: 'tammo', action: 'attack', target: 'Ogre' }],
        }));
        expect(plan.ok).toBe(true);
        expect(rollQueue).toHaveLength(0);
        expect(plan.payload.result.events.find(e => e.type === 'attack' && e.actor === 'Astra')).toMatchObject({ hit: true, critical: false });
        expect(plan.payload.result.events.find(e => e.type === 'attack' && e.actor === 'Tammo')).toMatchObject({ hit: true, critical: true, damage: 4 });
    });

    it('restrained costs a DEX save only: Hold Person (WIS) draws one d20 from a restrained foe, Fireball (DEX) two', () => {
        // Hold Person: one save die (fails: 5 + 2 < DC 14), the goblin is
        // paralyzed and cannot act. One die in all.
        rollQueue.push(5);
        const held = planCombatExchange(wizardState({ enemies: [goblin({ conditions: ['restrained'] })] }), normalizeCombatExchange({
            player_slots: [{ action: 'cast', spell: 'hold person', target: 'Goblin' }],
        }));
        expect(held.ok).toBe(true);
        expect(rollQueue).toHaveLength(0);
        expect(held.payload.result.events.find(e => e.type === 'save')).toMatchObject({ actor: 'Goblin', success: false, mode: undefined });
        expect(held.payload.enemies[0].conditions).toEqual(['restrained', 'paralyzed']);

        // Fireball: 6d6 damage, then the restrained foe's DEX save at
        // disadvantage (two d20s, the lower kept); it survives at 30 - 12 = 18
        // and, restrained (attack disadvantage: two d20s), misses.
        rollQueue.push(2, 2, 2, 2, 2, 2, 18, 4, 7, 3);
        const burned = planCombatExchange(wizardState({ enemies: [goblin({ hp: 30, maxHp: 30, conditions: ['restrained'] })] }), normalizeCombatExchange({
            player_slots: [{ action: 'cast', spell: 'fireball', targets: ['Goblin'] }],
            enemy_intents: [{ enemy_id: 'Goblin', action: 'attack', target: 'player' }],
        }));
        expect(burned.ok).toBe(true);
        expect(rollQueue).toHaveLength(0);
        expect(burned.payload.result.events.find(e => e.type === 'save')).toMatchObject({ actor: 'Goblin', success: false });
        expect(burned.payload.result.events.find(e => e.type === 'save').mode).toMatch(/restrained/i);
    });

    it('the hero\'s own save: a restrained hero rolls a CON save flat and a DEX save at disadvantage', () => {
        // CON save: one d20; the goblin then strikes the restrained hero at
        // advantage (two d20s) and misses.
        rollQueue.push(15, 3, 4);
        const con = planCombatExchange(state({ character: { conditions: ['restrained'] } }), normalizeCombatExchange({
            player_slots: [{ action: 'save', skill: 'constitution', dc: 10 }],
            enemy_intents: [{ enemy_id: 'Goblin', action: 'attack', target: 'player' }],
        }));
        expect(con.ok).toBe(true);
        expect(rollQueue).toHaveLength(0);
        expect(con.payload.result.events.find(e => e.type === 'save')).toMatchObject({ success: true, mode: '' });

        rollQueue.push(15, 9, 3, 4);
        const dex = planCombatExchange(state({ character: { conditions: ['restrained'] } }), normalizeCombatExchange({
            player_slots: [{ action: 'save', skill: 'dexterity', dc: 10 }],
            enemy_intents: [{ enemy_id: 'Goblin', action: 'attack', target: 'player' }],
        }));
        expect(dex.ok).toBe(true);
        expect(rollQueue).toHaveLength(0);
        expect(dex.payload.result.events.find(e => e.type === 'save').mode).toMatch(/restrained/i);
    });

    it('the table says it: restrained.save is an ability-keyed object, read by ability or not at all', () => {
        expect(CONDITION_EFFECTS.restrained.save).toEqual({ dexterity: 'disadvantage' });
        expect(getConditionRollEffects(['restrained'], 'save', { ability: 'dexterity' }).disadvantage).toBe(true);
        expect(getConditionRollEffects(['restrained'], 'save', { ability: 'DEX' }).disadvantage).toBe(true);
        expect(getConditionRollEffects(['restrained'], 'save', { ability: 'wisdom' }).disadvantage).toBe(false);
        expect(getConditionRollEffects(['restrained'], 'save').disadvantage).toBe(false);
        expect(getConditionRollEffects(['restrained'], 'attack').disadvantage).toBe(true);
        // The scalar belt: a string is one condition, never its characters.
        expect(getConditionRollEffects('restrained', 'attack').disadvantage).toBe(true);
        expect(getIncapacitatingCondition('Paralyzed')).toBe('paralyzed');
        expect(getIncapacitatingCondition('p')).toBeNull();
    });
});

describe('a silent sync is said once (P2 nit)', () => {
    it('enemy_condition_updates to an unknown id or a downed foe posts a note instead of nothing', () => {
        rollQueue.push(15, 4, 5);
        const plan = planCombatExchange(state({
            enemies: [goblin(), goblin({ id: 'Dead', name: 'Dead Goblin', hp: 0, combatStatus: 'defeated', condition: 'dead' })],
        }), attackIntent({
            enemy_condition_updates: [
                { enemy_id: 'Nobody', add: ['prone'] },
                { enemy_id: 'Dead', add: ['prone'] },
            ],
        }));
        expect(plan.ok).toBe(true);
        expect(notes(plan)).toContain('enemy_condition_updates for "Nobody" ignored — no such foe.');
        expect(notes(plan)).toContain('enemy_condition_updates for "Dead" ignored — Dead Goblin is out of the fight.');
    });
});
