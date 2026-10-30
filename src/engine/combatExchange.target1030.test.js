/**
 * The 2026-10-30 strengthening findings on the exchange's targeting:
 * a foe aiming at the hero by NAME (P1), the wire's one silent redirect (P2),
 * the bare-list `player_condition_updates` (P2), the companion retarget
 * note's wording and same-named foes paired in order (nits).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { COMBAT_PHASES } from './combatPredicates.js';
import { normalizeCombatExchange } from './combatWire.js';
import { exchangeEventLines, planCombatExchange } from './combatExchange.js';
import { isHeroRef, resolveSpellRecipients } from './spellcasting.js';
import { findSpell } from '../data/spells.js';

const exchangeSummary = result => exchangeEventLines(result).join('\n');

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

const character = (overrides = {}) => ({
    name: 'Astra',
    class: 'fighter',
    level: 2,
    currentHP: 20,
    maxHP: 20,
    armorClass: 16,
    abilityScores: { strength: 16, dexterity: 12, constitution: 14, intelligence: 10, wisdom: 10, charisma: 8 },
    skillProficiencies: [],
    conditions: [],
    ...overrides,
});

const enemy = (id, overrides = {}) => ({
    id, name: id, hp: 10, maxHp: 10, ac: 12, attackBonus: 4, damage: '1d6+2',
    condition: 'healthy', conditions: [], combatStatus: 'active', ...overrides,
});

const companion = (id, overrides = {}) => ({
    id, name: id, hp: 10, maxHp: 10, ac: 13, attackBonus: 3, damage: '1d6+1', status: 'healthy', ...overrides,
});

function state(overrides = {}) {
    return {
        character: character(overrides.character),
        inventory: [{ id: 'sword', name: 'Longsword', type: 'weapon', category: 'martialMelee', damage: '1d8', equipped: true }],
        party: overrides.party || [],
        combat: {
            active: true,
            phase: COMBAT_PHASES.AWAITING_PLAYER,
            round: 1,
            enemies: overrides.enemies || [enemy('Goblin')],
            turnOrder: [{ type: 'player', name: 'Astra', initiative: 15 }],
            currentTurn: 0,
        },
    };
}

const goblinAttacks = plan => plan.payload.result.events.filter(e => e.type === 'attack' && e.actor === 'Goblin');

beforeEach(() => {
    rollQueue.length = 0;
});

describe('isHeroRef — THE "this ref means the hero" predicate (2026-10-30 P1)', () => {
    const hero = { name: 'Astra Vane' };

    it('reads the five spellings, case-folded and trimmed, and the empty string', () => {
        for (const ref of ['player', 'self', 'me', 'hero', 'the hero', 'the player', 'Player', ' THE HERO ', '']) {
            expect(isHeroRef(ref, hero), ref).toBe(true);
        }
    });

    it("reads the hero's own name — exact, any case, and the short form through namesMatch", () => {
        expect(isHeroRef('Astra Vane', hero)).toBe(true);
        expect(isHeroRef('astra vane', hero)).toBe(true);
        expect(isHeroRef('Astra', hero)).toBe(true);
        expect(isHeroRef('Astra', { name: 'Astra' })).toBe(true);
    });

    it('is false for another name, a non-string, and an absent ref (the caller states its own default)', () => {
        expect(isHeroRef('Brann', hero)).toBe(false);
        expect(isHeroRef({ evil: true }, hero)).toBe(false);
        expect(isHeroRef(null, hero)).toBe(false);
        expect(isHeroRef(undefined, hero)).toBe(false);
        expect(isHeroRef('Astra', { name: '' })).toBe(false);
        expect(isHeroRef('Astra', null)).toBe(false);
    });

    it("the cast ladder reads the same predicate — 'the hero' and the short name land on the caster; an exact companion name still outranks the hero's short-name match", () => {
        const cure = findSpell('cureWounds');
        const party = [companion('Mika')];
        expect(resolveSpellRecipients(cure, hero, party, ['the hero']).recipients).toEqual([{ type: 'self' }]);
        expect(resolveSpellRecipients(cure, hero, party, ['Astra']).recipients).toEqual([{ type: 'self' }]);
        const shared = resolveSpellRecipients(cure, { name: 'Mika Stone' }, party, ['Mika']);
        expect(shared.recipients[0].type).toBe('companion');
    });
});

describe("a foe aiming at the hero by name swings at the hero (2026-10-30 P1)", () => {
    it.each(['Astra', 'astra', 'Player', 'the hero', 'hero', 'self', 'the player'])('enemy target %j rolls an attack on the hero', (target) => {
        rollQueue.push(2, 15, 3); // the hero misses (2 + 5 vs AC 12); the goblin hits (15 + 4 vs AC 16) for 3 + 2
        const plan = planCombatExchange(state(), normalizeCombatExchange({
            player_slots: [{ action: 'attack', strikes: [{ target: 'Goblin' }] }],
            enemy_intents: [{ enemy_id: 'Goblin', action: 'attack', target }],
        }));
        expect(plan.ok).toBe(true);
        expect(rollQueue).toHaveLength(0);
        expect(goblinAttacks(plan)).toEqual([expect.objectContaining({ target: 'Astra', targetType: 'player', hit: true, damage: 5, remainingHp: 15 })]);
        expect(plan.payload.playerDamage).toBe(5);
        expect(exchangeSummary(plan.payload.result)).not.toContain('dropped rather than silently redirected');
    });

    it("the hero's short name reaches the hero when the sheet carries a full name", () => {
        rollQueue.push(2, 15, 3);
        const plan = planCombatExchange(state({ character: { name: 'Astra Vane' } }), normalizeCombatExchange({
            player_slots: [{ action: 'attack', strikes: [{ target: 'Goblin' }] }],
            enemy_intents: [{ enemy_id: 'Goblin', action: 'attack', target: 'Astra' }],
        }));
        expect(plan.ok).toBe(true);
        expect(goblinAttacks(plan)).toEqual([expect.objectContaining({ target: 'Astra Vane', targetType: 'player', hit: true })]);
    });

    it('a guarding companion still intercepts a blow aimed at the hero BY NAME', () => {
        rollQueue.push(2, 15, 3); // the goblin hits Tor (15 + 4 vs AC 13)
        const plan = planCombatExchange(state({ party: [companion('Tor')] }), normalizeCombatExchange({
            player_slots: [{ action: 'attack', strikes: [{ target: 'Goblin' }] }],
            companion_intents: [{ companion_id: 'Tor', action: 'guard' }],
            enemy_intents: [{ enemy_id: 'Goblin', action: 'attack', target: 'Astra' }],
        }));
        expect(plan.ok).toBe(true);
        expect(goblinAttacks(plan)).toEqual([expect.objectContaining({ target: 'Tor', targetType: 'companion', intercepted: true })]);
        expect(plan.payload.playerDamage).toBe(0);
    });

    it("an exact companion name beats the hero's short-name match on the enemy lane too", () => {
        rollQueue.push(2, 15, 3); // the goblin hits the companion Astra (AC 13)
        const plan = planCombatExchange(state({
            character: { name: 'Astra Vane' },
            party: [companion('Astra')],
        }), normalizeCombatExchange({
            player_slots: [{ action: 'attack', strikes: [{ target: 'Goblin' }] }],
            companion_intents: [{ companion_id: 'Astra', action: 'pass' }],
            enemy_intents: [{ enemy_id: 'Goblin', action: 'attack', target: 'Astra' }],
        }));
        expect(plan.ok).toBe(true);
        expect(goblinAttacks(plan)).toEqual([expect.objectContaining({ target: 'Astra', targetType: 'companion' })]);
        expect(plan.payload.playerDamage).toBe(0);
    });

    it('a name that is nobody still drops the slot with the note (the never-silently-redirected promise holds)', () => {
        rollQueue.push(2);
        const plan = planCombatExchange(state(), normalizeCombatExchange({
            player_slots: [{ action: 'attack', strikes: [{ target: 'Goblin' }] }],
            enemy_intents: [{ enemy_id: 'Goblin', action: 'attack', target: 'Brann' }],
        }));
        expect(plan.ok).toBe(true);
        expect(rollQueue).toHaveLength(0);
        expect(goblinAttacks(plan)).toHaveLength(0);
        expect(exchangeSummary(plan.payload.result)).toContain("Goblin's declared target is unavailable; its action is dropped rather than silently redirected.");
    });
});

describe("the wire's unreadable enemy target is null, not the hero (2026-10-30 P2)", () => {
    const targetOf = raw => normalizeCombatExchange({
        player_slots: [{ action: 'pass' }],
        enemy_intents: [{ enemy_id: 'Goblin', action: 'attack', ...raw }],
    }).enemyIntents[0].target;

    it('an ABSENT target (or a JSON null) is the DM\'s shorthand for the hero', () => {
        expect(targetOf({})).toBe('player');
        expect(targetOf({ target: null })).toBe('player');
    });

    it('an object or an empty-string target stays null on the wire', () => {
        expect(targetOf({ target: { evil: true } })).toBeNull();
        expect(targetOf({ target: '' })).toBeNull();
        expect(targetOf({ target: '   ' })).toBeNull();
        expect(targetOf({ target: 42 })).toBe('42');
    });

    it('the exchange drops a null-target slot with the note — no die, no damage', () => {
        rollQueue.push(2);
        const plan = planCombatExchange(state(), normalizeCombatExchange({
            player_slots: [{ action: 'attack', strikes: [{ target: 'Goblin' }] }],
            enemy_intents: [{ enemy_id: 'Goblin', action: 'attack', target: { evil: true } }],
        }));
        expect(plan.ok).toBe(true);
        expect(rollQueue).toHaveLength(0);
        expect(goblinAttacks(plan)).toHaveLength(0);
        expect(plan.payload.playerDamage).toBe(0);
        expect(exchangeSummary(plan.payload.result)).toContain("Goblin's declared target is unavailable; its action is dropped rather than silently redirected.");
    });
});

describe('player_condition_updates as a bare list (2026-10-30 P2)', () => {
    it('folds `["paralyzed"]` to `{ remove: ["paralyzed"] }` like the record form', () => {
        const asList = normalizeCombatExchange({
            player_slots: [{ action: 'attack', strikes: [{ target: 'Goblin' }] }],
            player_condition_updates: ['Paralyzed', 'frightened'],
        });
        const asRecord = normalizeCombatExchange({
            player_slots: [{ action: 'attack', strikes: [{ target: 'Goblin' }] }],
            player_condition_updates: { remove: ['Paralyzed', 'frightened'] },
        });
        expect(asList.playerConditionUpdates).toEqual({ remove: ['paralyzed', 'frightened'] });
        expect(asList.playerConditionUpdates).toEqual(asRecord.playerConditionUpdates);
    });

    it('a bare list frees a paralyzed hero so the same exchange is not a dead turn', () => {
        rollQueue.push(15, 4, 2); // the freed hero hits (15 + 5 vs AC 12) for 4 + 3; the goblin misses
        const plan = planCombatExchange(state({ character: { conditions: ['paralyzed'] } }), normalizeCombatExchange({
            player_slots: [{ action: 'attack', strikes: [{ target: 'Goblin' }] }],
            player_condition_updates: ['paralyzed'],
            enemy_intents: [{ enemy_id: 'Goblin', action: 'attack' }],
        }));
        expect(plan.ok).toBe(true);
        expect(plan.payload.result.events.find(e => e.type === 'attack' && e.actor === 'Astra')).toMatchObject({ hit: true, damage: 7 });
    });

    it('a string or a number is still no release', () => {
        for (const junk of ['paralyzed', 7, true]) {
            const intent = normalizeCombatExchange({
                player_slots: [{ action: 'pass' }],
                player_condition_updates: junk,
            });
            expect(intent.playerConditionUpdates, String(junk)).toBeUndefined();
        }
    });
});

describe('companion retarget note and same-named foes (2026-10-30 nits)', () => {
    it("a companion aimed at an ally is redirected to a standing foe, and the note says that — not 'target is down'", () => {
        rollQueue.push(2, 11, 4, 2); // hero misses; Tor hits the goblin (11 + 3 vs 12) for 4 + 1; the goblin misses
        const plan = planCombatExchange(state({ party: [companion('Tor'), companion('Mika')] }), normalizeCombatExchange({
            player_slots: [{ action: 'attack', strikes: [{ target: 'Goblin' }] }],
            companion_intents: [{ companion_id: 'Tor', action: 'attack', target: 'Mika' }, { companion_id: 'Mika', action: 'pass' }],
            enemy_intents: [{ enemy_id: 'Goblin', action: 'attack', target: 'player' }],
        }));
        expect(plan.ok).toBe(true);
        const summary = exchangeSummary(plan.payload.result);
        expect(summary).toContain('Tor\'s declared target "Mika" is not a standing foe; redirected to Goblin.');
        expect(summary).not.toContain('target is down');
        expect(plan.payload.result.events.find(e => e.type === 'attack' && e.actor === 'Tor')).toMatchObject({ target: 'Goblin', hit: true, damage: 5 });
        // Mika was never struck by an ally.
        expect(plan.payload.result.events.filter(e => e.type === 'attack' && e.target === 'Mika')).toHaveLength(0);
    });

    it('two same-named foes addressed by name pair with the intents in order (the second no longer defaults to an attack on the hero)', () => {
        rollQueue.push(2, 15, 3); // the hero misses Bandit; the FIRST bandit hits the hero; the second defends — no die
        const bandits = [enemy('enemy-1', { name: 'Bandit' }), enemy('enemy-2', { name: 'Bandit' })];
        const plan = planCombatExchange(state({ enemies: bandits }), normalizeCombatExchange({
            player_slots: [{ action: 'attack', strikes: [{ target: 'enemy-1' }] }],
            enemy_intents: [
                { enemy_id: 'Bandit', action: 'attack', target: 'player' },
                { enemy_id: 'Bandit', action: 'defend' },
            ],
        }));
        expect(plan.ok).toBe(true);
        expect(rollQueue).toHaveLength(0);
        const banditAttacks = plan.payload.result.events.filter(e => e.type === 'attack' && e.actor === 'Bandit');
        expect(banditAttacks).toHaveLength(1);
        expect(exchangeSummary(plan.payload.result).split('Bandit defends and gives up its attack.')).toHaveLength(2);
    });

    it('an exact id still wins over a same-named foe, and a second intent for the SAME id is skipped', () => {
        rollQueue.push(2); // the hero misses; both bandits defend
        const bandits = [enemy('enemy-1', { name: 'Bandit' }), enemy('enemy-2', { name: 'Bandit' })];
        const plan = planCombatExchange(state({ enemies: bandits }), normalizeCombatExchange({
            player_slots: [{ action: 'attack', strikes: [{ target: 'enemy-1' }] }],
            enemy_intents: [
                { enemy_id: 'enemy-2', action: 'defend' },
                { enemy_id: 'enemy-2', action: 'flee' },
                { enemy_id: 'Bandit', action: 'defend' },
            ],
        }));
        expect(plan.ok).toBe(true);
        expect(rollQueue).toHaveLength(0);
        const summary = exchangeSummary(plan.payload.result);
        expect(summary.split('Bandit defends and gives up its attack.')).toHaveLength(3); // both defend
        expect(summary).not.toContain('flees');
        expect(plan.payload.result.postState.enemies.every(e => e.status === 'active')).toBe(true);
    });
});
