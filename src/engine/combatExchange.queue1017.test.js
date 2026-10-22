/**
 * The 2026-10-17 strengthening queue, engine half (dice-engine + combat-
 * exchange, Lap 1): a STABLE or incapacitated hero cannot act in a fight (one
 * gate, one `pass`), a stable hero's exchange is told from a fresh drop, a
 * foe's SAVE die never enters the hero's ledger, Sneak Attack dice are their
 * own ledger row, and `weapon_id` must name a weapon. The reducer twin is
 * `state/gameReducer.queue1017.test.js`.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { COMBAT_PHASES } from './combatPredicates.js';
import { normalizeCombatExchange } from './combatWire.js';
import { planCombatExchange, planOpeningExchange } from './combatExchange.js';
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

const tammo = (overrides = {}) => ({ id: 'tammo', name: 'Tammo', hp: 10, maxHp: 10, ac: 12, status: 'healthy', attackBonus: 3, damage: '1d6', ...overrides });

function state({ character = {}, party = [], enemies = [goblin()], inventory = null, combat = {} } = {}) {
    return {
        character: {
            name: 'Astra', class: 'fighter', level: 3, currentHP: 20, maxHP: 20, armorClass: 16,
            abilityScores: { strength: 16, dexterity: 12, constitution: 14, intelligence: 10, wisdom: 10, charisma: 8 },
            skillProficiencies: [], conditions: [], dying: false, deathSaves: { successes: 0, failures: 0 },
            ...character,
        },
        inventory: inventory || [
            { id: 'sword', name: 'Longsword', type: 'weapon', category: 'martialMelee', damage: '1d8', equipped: true },
            { id: 'torch', name: 'Torch', type: 'gear', equipped: false },
        ],
        party,
        combat: {
            active: true, phase: COMBAT_PHASES.AWAITING_PLAYER, round: 1, enemies,
            turnOrder: [{ type: 'player', name: 'Astra', initiative: 15 }], currentTurn: 0,
            ...combat,
        },
    };
}

const stableHero = { currentHP: 0, dying: false, conditions: ['Unconscious'], deathSaves: { successes: 0, failures: 0 } };
const attackIntent = (enemyAction = 'attack') => normalizeCombatExchange({
    player_slots: [{ action: 'attack', strikes: [{ target: 'Goblin' }] }],
    enemy_intents: [{ enemy_id: 'Goblin', action: enemyAction, target: 'player' }],
});
const passIntent = (enemyAction = 'attack') => normalizeCombatExchange({
    player_slots: [{ action: 'pass' }],
    enemy_intents: [{ enemy_id: 'Goblin', action: enemyAction, target: 'player' }],
});

beforeEach(() => { rollQueue.length = 0; });

describe('a STABLE hero cannot act (P1)', () => {
    it('an attack slot is rejected with the pass rule; a lone pass is the legal turn', () => {
        const stable = state({ character: stableHero });
        expect(planCombatExchange(stable, attackIntent())).toMatchObject({
            ok: false,
            error: 'Astra is unconscious at 0 HP (stable, not dying): the hero cannot act this exchange. Declare { "action": "pass" } as their only player slot — companions still act; a potion or healing wakes them.',
        });
        // Every other lane is shut too: a Second Wind, a cast, a check.
        expect(planCombatExchange(stable, normalizeCombatExchange({ player_slots: [{ action: 'second_wind' }] })).ok).toBe(false);
        expect(planCombatExchange(stable, normalizeCombatExchange({ player_slots: [{ action: 'check', skill: 'athletics', dc: 10 }] })).ok).toBe(false);
        // A death save is NOT a stable hero's slot either (the clock is not running).
        expect(planCombatExchange(stable, normalizeCombatExchange({ player_slots: [{ action: 'death_save' }] })).ok).toBe(false);

        const plan = planCombatExchange(stable, passIntent());
        expect(plan.ok).toBe(true);
        expect(rollQueue).toHaveLength(0); // the hero rolled nothing, the foe never struck
        expect(plan.payload.heroRolls).toEqual([]);
        expect(plan.payload.playerDamage).toBe(0);
        expect(plan.payload.result.events.some(e => e.type === 'note' && e.text.includes('does not make another attack against the already-defeated player'))).toBe(true);
    });

    it('the snapshot says STABLE (never a fresh `dying`), and with no companion standing the fight closes as a defeat', () => {
        const plan = planCombatExchange(state({ character: stableHero }), passIntent());
        expect(plan.payload.result.postState.player).toEqual({ name: 'Astra', hp: 0, maxHp: 20, status: 'stable', deathSaves: { successes: 0, failures: 0 } });
        expect(plan.payload.result.terminal).toBe('defeat');
        expect(plan.payload.deathSaveNatural).toBeNull();
        expect(plan.payload.deathSaveSkipped).toBe(false);
    });

    it('with a battle-ready companion the fight goes ON around the fallen hero — the companion acts, the terminal is open', () => {
        rollQueue.push(15, 4); // Tammo hits (attack + damage); the goblin's attack on the fallen hero never rolls
        const plan = planCombatExchange(state({ character: stableHero, party: [tammo()] }), passIntent());
        expect(plan.ok).toBe(true);
        expect(rollQueue).toHaveLength(0);
        expect(plan.payload.result.events.find(e => e.type === 'attack')).toMatchObject({ actor: 'Tammo', target: 'Goblin', hit: true, targetType: 'enemy' });
        expect(plan.payload.result.postState.player.status).toBe('stable');
        expect(plan.payload.result.terminal).toBeNull();
        // …and when the companion is down, the same exchange closes the fight.
        const downed = planCombatExchange(state({ character: stableHero, party: [tammo({ hp: 0, status: 'downed' })] }), passIntent());
        expect(downed.payload.result.terminal).toBe('defeat');
    });

    it('a dying hero who STABILIZES beside a standing companion keeps the fight open (the 09-30 fixture, party-aware)', () => {
        rollQueue.push(15, 10, 3); // the third success; Tammo hits (10 + 3 vs AC 12) for 3
        const plan = planCombatExchange(state({
            character: { ...stableHero, dying: true, deathSaves: { successes: 2, failures: 1 } },
            party: [tammo()],
        }), normalizeCombatExchange({ player_slots: [{ action: 'death_save' }], enemy_intents: [{ enemy_id: 'Goblin', action: 'defend' }] }));
        expect(plan.payload.result.postState.player).toMatchObject({ status: 'stable', deathSaves: { successes: 3, failures: 1 } });
        expect(plan.payload.result.terminal).toBeNull();
    });

    it('an OPENING over a stable hero with companions is not a terminal; alone it is the defeat', () => {
        rollQueue.push(2); // the goblin's opening blow is aimed at the fallen hero — skipped; Tammo's is a miss
        const withParty = state({
            character: stableHero, party: [tammo()],
            combat: { phase: COMBAT_PHASES.OPENING, openingActorIds: ['tammo', 'Goblin'], turnOrder: [
                { type: 'companion', id: 'tammo', name: 'Tammo', initiative: 18 },
                { type: 'enemy', id: 'Goblin', name: 'Goblin', initiative: 16 },
                { type: 'player', name: 'Astra', initiative: 3 },
            ] },
        });
        const opening = planOpeningExchange(withParty);
        expect(opening.ok).toBe(true);
        expect(opening.payload.result.postState.player.status).toBe('stable');
        expect(opening.payload.result.terminal).toBeNull();
        expect(opening.payload.playerDamage).toBe(0);
    });

    it('a fresh drop to 0 this exchange is still judged `dying` / `defeated` — the entry HP tells the two apart', () => {
        rollQueue.push(2, 5, 18, 6); // the hero misses; Tammo misses (5 + 3); the goblin hits for 6+2 = 8 → 8 − 8 = 0
        const plan = planCombatExchange(state({ character: { currentHP: 8 }, party: [tammo()] }), attackIntent());
        expect(plan.payload.result.postState.player).toMatchObject({ status: 'dying', hp: 0 });
        expect(plan.payload.result.terminal).toBe('dying');
    });
});

describe('the hero\'s own incapacitating condition is asked in a fight (P2)', () => {
    it('a paralyzed hero at full HP may only pass; the foes still strike them (with advantage)', () => {
        const paralyzed = state({ character: { conditions: ['paralyzed'] } });
        expect(planCombatExchange(paralyzed, attackIntent())).toMatchObject({
            ok: false, error: expect.stringContaining('Astra is paralyzed: the hero cannot act this exchange.'),
        });
        expect(planCombatExchange(paralyzed, normalizeCombatExchange({ player_slots: [{ action: 'cast', spell: 'fire bolt', target: 'Goblin' }] })).ok).toBe(false);
        // The goblin's attack draws TWO d20s (advantage against a paralyzed
        // target) + TWO damage dice: a melee hit on a helpless hero is a crit
        // (2026-10-22 enemy-stats P2 — 5e's ghoul rule, now the engine's).
        rollQueue.push(3, 17, 4, 2);
        const plan = planCombatExchange(paralyzed, passIntent());
        expect(plan.ok).toBe(true);
        expect(rollQueue).toHaveLength(0);
        expect(plan.payload.result.events.find(e => e.type === 'attack')).toMatchObject({ actor: 'Goblin', target: 'Astra', hit: true, critical: true, damage: 8, targetType: 'player' });
        expect(plan.payload.playerDamage).toBe(8);
        expect(plan.payload.heroRolls).toEqual([]);
    });

    it('a stunned foe still loses its action — the two gates are the one predicate', () => {
        rollQueue.push(15, 3, 5); // the hero's hit (advantage against a stunned foe draws two) + damage; the stunned goblin rolls nothing
        const plan = planCombatExchange(state({ enemies: [goblin({ conditions: ['stunned'] })] }), attackIntent());
        expect(plan.ok).toBe(true);
        expect(rollQueue).toHaveLength(0);
        expect(plan.payload.result.events.some(e => e.type === 'note' && e.text === 'Goblin is stunned and cannot act.')).toBe(true);
    });
});

describe('weapon_id names a WEAPON (P2)', () => {
    it('a torch as weapon_id rejects the turn; the sword stays in hand', () => {
        const plan = planCombatExchange(state(), normalizeCombatExchange({
            player_slots: [{ action: 'attack', weapon_id: 'Torch', strikes: [{ target: 'Goblin' }] }],
        }));
        expect(plan).toMatchObject({ ok: false, error: 'Attack weapon "Torch" is not a weapon in the player\'s inventory — name a weapon or omit weapon_id.' });
        // The pack-less case keeps its own message (the 10-05 pin).
        expect(planCombatExchange(state(), normalizeCombatExchange({
            player_slots: [{ action: 'attack', weapon_id: 'Vorpal Blade', strikes: [{ target: 'Goblin' }] }],
        }))).toMatchObject({ ok: false, error: 'Attack weapon "Vorpal Blade" is not in the player\'s inventory.' });
        // The same turn without weapon_id swings the longsword: 1d8 + STR 3.
        rollQueue.push(15, 6);
        const swung = planCombatExchange(state(), normalizeCombatExchange({
            player_slots: [{ action: 'attack', strikes: [{ target: 'Goblin' }] }],
            enemy_intents: [{ enemy_id: 'Goblin', action: 'defend' }],
        }));
        expect(swung.payload.result.events[0]).toMatchObject({ type: 'attack', hit: true, damage: 9, targetType: 'enemy' });
    });
});

describe('the ledger is the hero\'s: a foe\'s SAVE die never enters heroRolls (P2)', () => {
    const wizard = () => state({
        character: {
            class: 'wizard', level: 5, abilityScores: { strength: 8, dexterity: 12, constitution: 12, intelligence: 17, wisdom: 10, charisma: 10 },
            spellSlots: buildSpellSlots(5),
        },
        enemies: [goblin({ id: 'g1', name: 'Goblin One' }), goblin({ id: 'g2', name: 'Goblin Two' }), goblin({ id: 'g3', name: 'Goblin Three' })],
    });

    it('a Fireball on three foes ledgers ONE damage roll; the three saves ride the save events only', () => {
        rollQueue.push(3, 3, 3, 3, 3, 3, 15, 2, 19); // 6d6 damage, then three saves
        const plan = planCombatExchange(wizard(), normalizeCombatExchange({
            player_slots: [{ action: 'cast', spell: 'Fireball', targets: ['g1', 'g2', 'g3'] }],
            enemy_intents: [{ enemy_id: 'g1', action: 'defend' }, { enemy_id: 'g2', action: 'defend' }, { enemy_id: 'g3', action: 'defend' }],
        }));
        expect(plan.ok).toBe(true);
        expect(rollQueue).toHaveLength(0);
        expect(plan.payload.result.events.filter(e => e.type === 'save')).toHaveLength(3);
        expect(plan.payload.heroRolls.map(r => r.description)).toEqual(['Fireball damage']);
    });

    it('Turn Undead over three undead ledgers NOTHING — the cleric rolled no die', () => {
        rollQueue.push(4, 16, 9);
        const plan = planCombatExchange(state({
            character: { class: 'cleric', level: 5, abilityScores: { strength: 12, dexterity: 10, constitution: 14, intelligence: 10, wisdom: 16, charisma: 12 }, spellSlots: buildSpellSlots(5), classResources: { channelDivinity: { used: 0, max: 1 } } },
            enemies: [goblin({ id: 's1', name: 'Skeleton', isUndead: true }), goblin({ id: 's2', name: 'Wight', isUndead: true, maxHp: 45, hp: 45 }), goblin({ id: 's3', name: 'Ghoul', isUndead: true })],
        }), normalizeCombatExchange({
            player_slots: [{ action: 'channel' }],
            enemy_intents: [{ enemy_id: 's1', action: 'defend' }, { enemy_id: 's2', action: 'defend' }, { enemy_id: 's3', action: 'defend' }],
        }));
        expect(plan.ok).toBe(true);
        expect(rollQueue).toHaveLength(0);
        expect(plan.payload.result.events.filter(e => e.type === 'save')).toHaveLength(3);
        expect(plan.payload.heroRolls).toEqual([]);
    });
});

describe('a ledger row\'s total is its faces + modifier: Sneak Attack dice are their own row (P2)', () => {
    it('a rogue\'s hit ledgers the weapon row and a `— Sneak Attack` row; the attack event is unchanged', () => {
        const rogue = state({
            character: { class: 'rogue', level: 3, abilityScores: { strength: 10, dexterity: 16, constitution: 12, intelligence: 10, wisdom: 10, charisma: 10 } },
            inventory: [{ id: 'dagger', name: 'Dagger', type: 'weapon', finesse: true, damage: '1d4', equipped: true }],
        });
        rollQueue.push(15, 5, 1, 4, 5); // to-hit (advantage draws two), 1d4 = 1, Sneak Attack 2d6 = 4, 5
        const plan = planCombatExchange(rogue, normalizeCombatExchange({
            player_slots: [{ action: 'attack', strikes: [{ target: 'Goblin' }], situationalRuling: { mode: 'advantage', reason: 'flanking' } }],
            enemy_intents: [{ enemy_id: 'Goblin', action: 'defend' }],
        }));
        expect(plan.ok).toBe(true);
        const attack = plan.payload.result.events.find(e => e.type === 'attack');
        expect(attack).toMatchObject({ hit: true, damage: 1 + 3 + 9 });
        expect(attack.sneakAttackDetail).toEqual({ diceCount: 2, rolls: [4, 5], total: 9 });
        const [toHit, weapon, sneak] = plan.payload.heroRolls;
        expect(toHit.notation).toMatch(/^1d20/);
        expect(weapon).toMatchObject({ rolls: [1], modifier: 3, total: 4, description: 'Damage to Goblin' });
        expect(sneak).toMatchObject({ rolls: [4, 5], modifier: 0, total: 9, notation: '2d6+0', description: 'Damage to Goblin — Sneak Attack' });
        for (const row of plan.payload.heroRolls) {
            expect(row.total).toBe(row.rolls.reduce((sum, face) => sum + face, 0) + row.modifier);
        }
    });
});
