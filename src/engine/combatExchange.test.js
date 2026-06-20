import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
    COMBAT_PHASES,
    normalizeCombatExchange,
    planCombatExchange,
    planOpeningExchange,
} from './combatExchange.js';

const { rollQueue } = vi.hoisted(() => ({ rollQueue: [] }));

vi.mock('./dice.ts', () => {
    let id = 0;
    const draw = () => (rollQueue.length ? rollQueue.shift() : 10);
    const parseNotation = notation => {
        const match = String(notation).replace(/\s+/g, '').match(/^(\d+)d(\d+)([+-]\d+)?$/i);
        if (!match) throw new Error(`Invalid notation: ${notation}`);
        return {
            count: Number(match[1]),
            sides: Number(match[2]),
            modifier: match[3] ? Number(match[3]) : 0,
        };
    };
    return {
        parseNotation,
        rollWithModifier: (count, sides, modifier = 0, description = '') => {
            const rolls = Array.from({ length: count }, draw);
            const subtotal = rolls.reduce((sum, value) => sum + value, 0);
            return {
                id: `exchange-roll-${++id}`,
                timestamp: 0,
                notation: `${count}d${sides}`,
                dice: { count, sides },
                rolls,
                subtotal,
                modifier,
                total: subtotal + modifier,
                description,
                isCritical: count === 1 && sides === 20 && rolls[0] === 20,
                isCritFail: count === 1 && sides === 20 && rolls[0] === 1,
            };
        },
    };
});

const character = (overrides = {}) => ({
    name: 'Vesa',
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
    id,
    name: id,
    hp: 10,
    maxHp: 10,
    ac: 12,
    attackBonus: 4,
    damage: '1d6+2',
    condition: 'healthy',
    combatStatus: 'active',
    ...overrides,
});

function state(overrides = {}) {
    const enemies = overrides.enemies || [enemy('Goblin')];
    return {
        character: character(overrides.character),
        inventory: [{ id: 'sword', name: 'Longsword', type: 'weapon', category: 'martialMelee', damage: '1d8', equipped: true }],
        party: overrides.party || [],
        combat: {
            active: true,
            phase: COMBAT_PHASES.AWAITING_PLAYER,
            round: 1,
            enemies,
            turnOrder: [{ type: 'player', name: 'Vesa', initiative: 15 }],
            currentTurn: 0,
            ...(overrides.combat || {}),
        },
    };
}

const exchange = raw => normalizeCombatExchange({
    player_slots: [{ action: 'attack', strikes: [{ target: 'Goblin' }] }],
    enemy_intents: [{ enemy_id: 'Goblin', action: 'attack', target: 'player' }],
    ...raw,
});

beforeEach(() => {
    rollQueue.length = 0;
});

describe('combat exchange validation', () => {
    it('accepts only bounded intent actions and requires a player slot', () => {
        expect(normalizeCombatExchange({ enemy_intents: [] })).toBeNull();
        expect(normalizeCombatExchange({ player_slots: [{ action: 'cast_nuclear_fireball' }] })).toBeNull();
        expect(exchange()).toMatchObject({
            playerSlots: [{ action: 'attack', strikes: [{ target: 'Goblin' }] }],
            enemyIntents: [{ enemyId: 'Goblin', action: 'attack', target: 'player' }],
        });
    });

    it('rejects a missing or invalid combat target before rolling anyone', () => {
        const missing = exchange({ player_slots: [{ action: 'attack' }] });
        expect(planCombatExchange(state(), missing)).toMatchObject({ ok: false, error: expect.stringContaining('living target') });

        const invalid = exchange({ player_slots: [{ action: 'attack', strikes: [{ target: 'Ghost' }] }] });
        expect(planCombatExchange(state(), invalid)).toMatchObject({ ok: false, error: expect.stringContaining('not an active enemy') });
        expect(rollQueue).toHaveLength(0);
    });
});

describe('engine-owned exchange resolution', () => {
    it('resolves the player first and gives a slain foe no attack slot', () => {
        rollQueue.push(20, 8);
        const plan = planCombatExchange(state({ enemies: [enemy('Goblin', { hp: 5, maxHp: 5 })] }), exchange());

        expect(plan.ok).toBe(true);
        expect(plan.payload.result.events).toHaveLength(1);
        expect(plan.payload.result.events[0]).toMatchObject({ actor: 'Vesa', target: 'Goblin', hit: true });
        expect(plan.payload.enemies[0].hp).toBe(0);
        expect(plan.payload.playerDamage).toBe(0);
        expect(plan.payload.result.terminal).toBe('victory');
    });

    it('resolves a non-attack Dodge turn and imposes disadvantage on the enemy', () => {
        rollQueue.push(18, 3);
        const intent = exchange({ player_slots: [{ action: 'dodge' }] });
        const plan = planCombatExchange(state(), intent);

        expect(plan.ok).toBe(true);
        expect(plan.payload.result.events[0].text).toContain('Dodge');
        expect(plan.payload.result.events[1]).toMatchObject({ actor: 'Goblin', hit: false });
        expect(plan.payload.result.events[1].mode).toContain('18, 3');
        expect(plan.payload.playerDamage).toBe(0);
    });

    it('resolves a committed combat check before the enemy response', () => {
        rollQueue.push(12, 1); // Athletics 12+5 succeeds; enemy natural 1 misses
        const intent = exchange({
            player_slots: [{ action: 'check', skill: 'athletics', dc: 15, description: 'Topple the brazier' }],
        });
        const plan = planCombatExchange(state({ character: { skillProficiencies: ['athletics'] } }), intent);
        expect(plan.payload.result.events[0]).toMatchObject({ type: 'check', success: true, dc: 15 });
        expect(plan.payload.result.events[1]).toMatchObject({ actor: 'Goblin', hit: false });
    });

    it('treats Action Surge as exactly two arbitrary action slots and still grants each foe one slot', () => {
        const surgeState = state({ character: { pendingActionSurge: true } });
        expect(planCombatExchange(surgeState, exchange())).toMatchObject({
            ok: false,
            error: expect.stringContaining('exactly two'),
        });

        rollQueue.push(1, 2); // player misses, enemy misses
        const intent = exchange({
            player_slots: [
                { action: 'attack', strikes: [{ target: 'Goblin' }] },
                { action: 'dash' },
            ],
        });
        const plan = planCombatExchange(surgeState, intent);
        expect(plan.ok).toBe(true);
        expect(plan.payload.consumeActionSurge).toBe(true);
        expect(plan.payload.result.events.filter(event => event.actor === 'Goblin')).toHaveLength(1);
    });

    it('lets a foe flee without attacking and counts the threat as overcome', () => {
        rollQueue.push(1); // player misses
        const intent = exchange({ enemy_intents: [{ enemy_id: 'Goblin', action: 'flee' }] });
        const plan = planCombatExchange(state(), intent);
        expect(plan.payload.enemies[0].combatStatus).toBe('fled');
        expect(plan.payload.playerDamage).toBe(0);
        expect(plan.payload.result.terminal).toBe('victory');
    });

    it('ends a successful player retreat without enemy attacks or victory XP', () => {
        const intent = exchange({ player_slots: [{ action: 'flee' }] });
        const plan = planCombatExchange(state(), intent);
        expect(plan.ok).toBe(true);
        expect(plan.payload.playerDamage).toBe(0);
        expect(plan.payload.result.terminal).toBe('escaped');
        expect(plan.payload.result.events).toHaveLength(1);
    });

    it('drops an invalid companion target instead of redirecting the attack to the player', () => {
        rollQueue.push(1); // player misses; enemy action must roll nothing
        const intent = exchange({ enemy_intents: [{ enemy_id: 'Goblin', action: 'attack', target: 'missing-companion' }] });
        const plan = planCombatExchange(state(), intent);
        expect(plan.payload.playerDamage).toBe(0);
        expect(plan.payload.result.events.at(-1).text).toContain('dropped');
    });

    it('supports Extra Attack targets independently and does not retarget a defeated foe', () => {
        rollQueue.push(19, 8, 19, 8);
        const fighter = state({
            character: { level: 5 },
            enemies: [enemy('A', { hp: 5, maxHp: 5 }), enemy('B', { hp: 5, maxHp: 5 })],
        });
        const intent = normalizeCombatExchange({
            player_slots: [{ action: 'attack', strikes: [{ target: 'A' }, { target: 'B' }] }],
            enemy_intents: [],
        });
        const plan = planCombatExchange(fighter, intent);
        expect(plan.payload.enemies.map(e => e.hp)).toEqual([0, 0]);
        expect(plan.payload.result.terminal).toBe('victory');
    });

    it('uses a bounded engine-owned basic spell profile for core casters', () => {
        rollQueue.push(15, 7, 1); // spell hits/damages; enemy misses
        const wizard = state({
            character: { class: 'wizard', level: 1, abilityScores: { ...character().abilityScores, intelligence: 16 } },
        });
        const intent = normalizeCombatExchange({
            player_slots: [{ action: 'cast', spell: 'fire bolt', target: 'Goblin' }],
            enemy_intents: [{ enemy_id: 'Goblin', action: 'attack', target: 'player' }],
        });
        const plan = planCombatExchange(wizard, intent);
        expect(plan.ok).toBe(true);
        expect(plan.payload.result.events[0]).toMatchObject({ actor: 'Vesa', target: 'Goblin', hit: true, damage: 7 });

        const unsupported = normalizeCombatExchange({
            player_slots: [{ action: 'cast', spell: 'meteor swarm', target: 'Goblin' }],
        });
        expect(planCombatExchange(wizard, unsupported)).toMatchObject({ ok: false, error: expect.stringContaining('no engine-owned') });
    });

    it('keeps an unresolved death-save state in combat and lets a natural 20 resume play', () => {
        const dying = state({
            character: { level: 3, currentHP: 0, dying: true, deathSaves: { successes: 0, failures: 0 } },
        });
        const intent = normalizeCombatExchange({
            player_slots: [{ action: 'death_save' }],
            enemy_intents: [{ enemy_id: 'Goblin', action: 'defend' }],
        });
        rollQueue.push(12);
        const ongoing = planCombatExchange(dying, intent);
        expect(ongoing.payload.result.terminal).toBe('dying');

        rollQueue.push(20);
        const revived = planCombatExchange(dying, intent);
        expect(revived.payload.result.terminal).toBeNull();
        expect(revived.payload.deathSaveNatural).toBe(20);
    });
});

describe('Opening Initiative', () => {
    it('resolves only actors ahead of the player, in initiative order', () => {
        const openingState = state({
            enemies: [enemy('Fast'), enemy('Slow')],
            party: [{ id: 'ally', name: 'Ally', hp: 10, maxHp: 10, ac: 13, attackBonus: 3, damage: '1d6+1', status: 'healthy' }],
            combat: {
                phase: COMBAT_PHASES.OPENING,
                openingActorIds: ['Fast', 'ally'],
                turnOrder: [
                    { type: 'enemy', id: 'Fast', name: 'Fast', initiative: 19 },
                    { type: 'companion', id: 'ally', name: 'Ally', initiative: 17 },
                    { type: 'player', name: 'Vesa', initiative: 15 },
                    { type: 'enemy', id: 'Slow', name: 'Slow', initiative: 8 },
                ],
            },
        });
        rollQueue.push(1, 20, 6); // Fast misses; Ally crits and damages Fast
        const plan = planOpeningExchange(openingState);
        expect(plan.ok).toBe(true);
        expect(plan.payload.result.events.map(event => event.actor)).toEqual(['Fast', 'Ally']);
        expect(plan.payload.result.events.some(event => event.actor === 'Slow')).toBe(false);
    });
});
