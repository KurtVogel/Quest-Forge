import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
    COMBAT_PHASES,
    combatNarrationPrompt,
    normalizeCombatExchange,
    planCombatExchange,
    planOpeningExchange,
    reconcileStartingCombatExchange,
} from './combatExchange.js';
import { buildSpellSlots } from './spellcasting.js';

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
    conditions: [],
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

describe('combat-start reference reconciliation', () => {
    it('maps readable same-response references to a single canonical foe', () => {
        const exchange = reconcileStartingCombatExchange({
            player_slots: [
                { action: 'attack', strikes: [{ target: 'goblin-duelist' }] },
                {
                    action: 'check', skill: 'athletics', dc: 14,
                    on_success: { target: 'goblin-duelist', add: ['prone'] },
                },
            ],
            enemy_intents: [{ enemy_id: 'goblin-duelist', action: 'attack', target: 'player' }],
        }, [{ id: 'enemy-goblin-duelist', name: 'Goblin Duelist', hp: 15, condition: 'healthy' }]);
        expect(exchange.playerSlots[0].strikes[0].target).toBe('enemy-goblin-duelist');
        expect(exchange.playerSlots[1].onSuccess.target).toBe('enemy-goblin-duelist');
        expect(exchange.enemyIntents[0].enemyId).toBe('enemy-goblin-duelist');
    });

    it('does not guess between multiple foes when a reference is unknown', () => {
        const exchange = reconcileStartingCombatExchange({
            player_slots: [{ action: 'attack', strikes: [{ target: 'unknown-foe' }] }],
        }, [
            { id: 'enemy-a', name: 'Goblin A', hp: 7, condition: 'healthy' },
            { id: 'enemy-b', name: 'Goblin B', hp: 7, condition: 'healthy' },
        ]);
        expect(exchange.playerSlots[0].strikes[0].target).toBe('unknown-foe');
    });
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

    it('accepts only reasoned, bounded situational roll rulings', () => {
        const accepted = normalizeCombatExchange({
            player_slots: [{
                action: 'attack',
                strikes: [{ target: 'Goblin' }],
                situational_ruling: { mode: 'advantage', reason: 'Wit already flanks the goblin' },
            }],
        });
        const unsupported = normalizeCombatExchange({
            player_slots: [{
                action: 'attack',
                strikes: [{ target: 'Goblin' }],
                situational_ruling: { mode: 'advantage' },
            }],
        });
        const inventedMode = normalizeCombatExchange({
            player_slots: [{
                action: 'attack',
                strikes: [{ target: 'Goblin' }],
                situational_ruling: { mode: 'triple-advantage', reason: 'because' },
            }],
        });

        expect(accepted.playerSlots[0].situationalRuling).toEqual({
            mode: 'advantage',
            reason: 'Wit already flanks the goblin',
        });
        expect(unsupported.playerSlots[0]).not.toHaveProperty('situationalRuling');
        expect(inventedMode.playerSlots[0]).not.toHaveProperty('situationalRuling');
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
        expect(plan.payload.result.postState.enemies[0]).toMatchObject({ name: 'Goblin', hp: 0, status: 'defeated' });
    });

    it('tells narration that a heavily wounded foe remains alive and combat is ongoing', () => {
        rollQueue.push(15, 7, 1); // player hits for 11; Cave-Worg misses
        const intent = normalizeCombatExchange({
            player_slots: [{ action: 'attack', strikes: [{ target: 'Cave-Worg' }] }],
            enemy_intents: [{ enemy_id: 'Cave-Worg', action: 'attack', target: 'player' }],
        });
        const plan = planCombatExchange(state({
            enemies: [enemy('Cave-Worg', { hp: 20, maxHp: 32, ac: 14 })],
        }), intent);

        expect(plan.payload.enemies[0].hp).toBe(9);
        expect(plan.payload.result.terminal).toBeNull();
        expect(plan.payload.result.summary).toContain('Cave-Worg remains alive at 9/32 HP');

        const prompt = combatNarrationPrompt(plan.payload.result);
        expect(prompt).toContain('The terminal state is mechanically authoritative: ongoing');
        expect(prompt).toContain('COMBAT IS STILL ACTIVE');
        expect(prompt).toContain('ALIVE AND ACTIVE: Cave-Worg — 9/32 HP');
        expect(prompt).toContain('Never describe an ALIVE AND ACTIVE combatant as dead');
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

    it('synchronizes an established prone foe and grants advantage on the player attack', () => {
        rollQueue.push(4, 12, 2); // advantage keeps 12; damage roll 2 + modifiers
        const intent = normalizeCombatExchange({
            player_slots: [{ action: 'attack', strikes: [{ target: 'Cave-Worg' }] }],
            enemy_intents: [{ enemy_id: 'Cave-Worg', action: 'defend' }],
            enemy_condition_updates: [{ enemy_id: 'Cave-Worg', add: ['prone'] }],
        });
        const plan = planCombatExchange(state({
            enemies: [enemy('Cave-Worg', { hp: 9, maxHp: 32, ac: 14 })],
        }), intent);

        const attack = plan.payload.result.events.find(event => event.type === 'attack');
        expect(attack.mode).toContain('d20 4, 12');
        expect(attack.rolled).toBeGreaterThanOrEqual(14);
        expect(plan.payload.enemies[0].conditions).toContain('prone');
        expect(plan.payload.result.postState.enemies[0].conditions).toContain('prone');
    });

    it('a stunned foe loses its action entirely instead of attacking at full effectiveness', () => {
        const intent = normalizeCombatExchange({
            player_slots: [{ action: 'pass' }],
            enemy_intents: [{ enemy_id: 'Goblin', action: 'attack', target: 'player' }],
        });
        const plan = planCombatExchange(state({
            enemies: [enemy('Goblin', { conditions: ['stunned'] })],
        }), intent);

        expect(plan.ok).toBe(true);
        expect(plan.payload.result.events.some(event => event.type === 'attack')).toBe(false);
        const note = plan.payload.result.events.find(event => event.type === 'note' && /cannot act/.test(event.text));
        expect(note.text).toContain('Goblin is stunned and cannot act');
        expect(plan.payload.playerDamage).toBe(0);
    });

    it('remove_conditions immediately before the action lets a recovered foe act again', () => {
        rollQueue.push(15, 2); // to-hit 15+4 vs AC 11; damage 2+2
        const intent = normalizeCombatExchange({
            player_slots: [{ action: 'pass' }],
            enemy_intents: [{ enemy_id: 'Goblin', action: 'attack', target: 'player', remove_conditions: ['stunned'] }],
        });
        const plan = planCombatExchange(state({
            enemies: [enemy('Goblin', { conditions: ['stunned'] })],
        }), intent);

        const attack = plan.payload.result.events.find(event => event.type === 'attack');
        expect(attack).toMatchObject({ actor: 'Goblin', hit: true, damage: 4 });
        expect(plan.payload.result.postState.enemies[0].conditions).not.toContain('stunned');
    });

    it('applies and exposes a DM-approved situational advantage ruling', () => {
        rollQueue.push(4, 12, 2);
        const intent = normalizeCombatExchange({
            player_slots: [{
                action: 'attack',
                strikes: [{ target: 'Goblin' }],
                situational_ruling: { mode: 'advantage', reason: 'Wit threatens it from the opposite side' },
            }],
            enemy_intents: [{ enemy_id: 'Goblin', action: 'defend' }],
        });
        const plan = planCombatExchange(state(), intent);
        const attack = plan.payload.result.events.find(event => event.type === 'attack');

        expect(attack.mode).toContain('d20 4, 12');
        expect(attack.mode).toContain('DM ruling — advantage: Wit threatens it from the opposite side');
        expect(plan.payload.result.summary).toContain('Wit threatens it from the opposite side');
    });

    it('cancels an accepted advantage against condition disadvantage', () => {
        rollQueue.push(15, 2);
        const intent = normalizeCombatExchange({
            player_slots: [{
                action: 'attack',
                strikes: [{ target: 'Goblin' }],
                situational_ruling: { mode: 'advantage', reason: 'The goblin is distracted' },
            }],
            enemy_intents: [{ enemy_id: 'Goblin', action: 'defend' }],
        });
        const plan = planCombatExchange(state({ character: { conditions: ['poisoned'] } }), intent);
        const attack = plan.payload.result.events.find(event => event.type === 'attack');

        expect(attack.natural).toBe(15);
        expect(attack.mode).not.toContain('d20 15,');
        expect(attack.mode).toContain('cancelled');
    });

    it('applies situational rulings symmetrically to companions and enemies', () => {
        rollQueue.push(2, 18, 1, 17, 3);
        const intent = normalizeCombatExchange({
            player_slots: [{ action: 'pass' }],
            companion_intents: [{
                companion_id: 'wit',
                action: 'attack',
                target: 'Goblin',
                situational_ruling: { mode: 'advantage', reason: 'Wit attacks from concealment' },
            }],
            enemy_intents: [{
                enemy_id: 'Goblin',
                action: 'attack',
                target: 'player',
                situational_ruling: { mode: 'disadvantage', reason: 'Smoke obscures Vesa' },
            }],
        });
        const plan = planCombatExchange(state({
            party: [{ id: 'wit', name: 'Wit', hp: 10, maxHp: 10, ac: 13, attackBonus: 3, damage: '1d6+1', status: 'healthy' }],
        }), intent);
        const companionAttack = plan.payload.result.events.find(event => event.actor === 'Wit');
        const enemyAttack = plan.payload.result.events.find(event => event.actor === 'Goblin');

        expect(companionAttack.mode).toContain('d20 2, 18');
        expect(companionAttack.mode).toContain('Wit attacks from concealment');
        expect(enemyAttack.mode).toContain('d20 17, 3');
        expect(enemyAttack.mode).toContain('Smoke obscures Vesa');
    });

    it('applies a companion weaponBonus to both the attack roll and the damage roll', () => {
        rollQueue.push(11, 4, 5); // companion d20 11, damage d6 4; enemy d20 5 misses the hero
        const intent = normalizeCombatExchange({
            player_slots: [{ action: 'pass' }],
            companion_intents: [{ companion_id: 'wit', action: 'attack', target: 'Goblin' }],
            enemy_intents: [{ enemy_id: 'Goblin', action: 'attack', target: 'player' }],
        });
        const plan = planCombatExchange(state({
            party: [{ id: 'wit', name: 'Wit', hp: 10, maxHp: 10, ac: 13, attackBonus: 3, damage: '1d6+1', weaponBonus: 1, status: 'healthy' }],
        }), intent);
        const companionAttack = plan.payload.result.events.find(event => event.actor === 'Wit');

        expect(companionAttack.rolled).toBe(15); // 11 + 3 attack bonus + 1 weapon bonus
        expect(companionAttack.hit).toBe(true);
        expect(companionAttack.damage).toBe(6); // d6 4 + 1 flat + 1 weapon bonus
    });

    it('shares explicit player flanking advantage with a companion on the same target', () => {
        rollQueue.push(2, 3, 4, 18, 1);
        const intent = normalizeCombatExchange({
            player_slots: [{
                action: 'attack',
                strikes: [{ target: 'Goblin' }],
                situational_ruling: { mode: 'advantage', reason: 'Wit flanks the goblin from the opposite side' },
            }],
            companion_intents: [{ companion_id: 'wit', action: 'attack', target: 'Goblin' }],
            enemy_intents: [{ enemy_id: 'Goblin', action: 'defend' }],
        });
        const plan = planCombatExchange(state({
            party: [{ id: 'wit', name: 'Wit', hp: 10, maxHp: 10, ac: 13, attackBonus: 3, damage: '1d6+1', status: 'healthy' }],
        }), intent);
        const companionAttack = plan.payload.result.events.find(event => event.actor === 'Wit');

        expect(companionAttack.mode).toContain('d20 4, 18');
        expect(companionAttack.mode).toContain('DM ruling — advantage: flanking');
    });

    it('does not share non-flanking player advantage with companions', () => {
        rollQueue.push(2, 3, 18, 1);
        const intent = normalizeCombatExchange({
            player_slots: [{
                action: 'attack',
                strikes: [{ target: 'Goblin' }],
                situational_ruling: { mode: 'advantage', reason: 'The goblin is distracted by falling debris' },
            }],
            companion_intents: [{ companion_id: 'wit', action: 'attack', target: 'Goblin' }],
            enemy_intents: [{ enemy_id: 'Goblin', action: 'defend' }],
        });
        const plan = planCombatExchange(state({
            party: [{ id: 'wit', name: 'Wit', hp: 10, maxHp: 10, ac: 13, attackBonus: 3, damage: '1d6+1', status: 'healthy' }],
        }), intent);
        const companionAttack = plan.payload.result.events.find(event => event.actor === 'Wit');

        expect(companionAttack.natural).toBe(18);
        expect(companionAttack.mode).not.toContain('flanking');
        expect(companionAttack.mode).not.toContain('d20 18,');
    });

    it('does not replace a companion-specific disadvantage ruling with inherited flanking', () => {
        rollQueue.push(2, 3, 18, 4);
        const intent = normalizeCombatExchange({
            player_slots: [{
                action: 'attack',
                strikes: [{ target: 'Goblin' }],
                situational_ruling: { mode: 'advantage', reason: 'Wit flanks the goblin from the opposite side' },
            }],
            companion_intents: [{
                companion_id: 'wit',
                action: 'attack',
                target: 'Goblin',
                situational_ruling: { mode: 'disadvantage', reason: 'Smoke obscures Wit' },
            }],
            enemy_intents: [{ enemy_id: 'Goblin', action: 'defend' }],
        });
        const plan = planCombatExchange(state({
            party: [{ id: 'wit', name: 'Wit', hp: 10, maxHp: 10, ac: 13, attackBonus: 3, damage: '1d6+1', status: 'healthy' }],
        }), intent);
        const companionAttack = plan.payload.result.events.find(event => event.actor === 'Wit');

        expect(companionAttack.mode).toContain('d20 18, 4');
        expect(companionAttack.mode).toContain('DM ruling — disadvantage: Smoke obscures Wit');
        expect(companionAttack.mode).not.toContain('advantage: flanking');
    });

    it('applies a bounded enemy condition only after its combat check succeeds', () => {
        rollQueue.push(14, 1, 2); // Athletics succeeds; prone enemy attacks with disadvantage and misses
        const intent = normalizeCombatExchange({
            player_slots: [{
                action: 'check',
                skill: 'athletics',
                dc: 15,
                description: 'Shove the Cave-Worg prone',
                on_success: { target: 'Cave-Worg', add: ['prone'] },
            }],
            enemy_intents: [{ enemy_id: 'Cave-Worg', action: 'attack', target: 'player' }],
        });
        const plan = planCombatExchange(state({
            character: { skillProficiencies: ['athletics'] },
            enemies: [enemy('Cave-Worg', { hp: 20, maxHp: 32, ac: 14 })],
        }), intent);

        expect(plan.payload.result.events[0]).toMatchObject({ type: 'check', success: true });
        expect(plan.payload.enemies[0].conditions).toContain('prone');
        const enemyAttack = plan.payload.result.events.find(event => event.actor === 'Cave-Worg' && event.type === 'attack');
        expect(enemyAttack.mode).toContain('d20 1, 2');
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
        expect(planCombatExchange(wizard, unsupported)).toMatchObject({ ok: false, error: expect.stringContaining('not on this character\'s engine-owned spell list') });
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

    it('forces a combat check/save slot to succeed on a natural 20 regardless of DC', () => {
        rollQueue.push(20); // natural 20
        const intent = normalizeCombatExchange({
            player_slots: [{ action: 'check', skill: 'stealth', dc: 35, description: 'Hide from the dragon' }],
            enemy_intents: [{ enemy_id: 'Goblin', action: 'defend' }],
        });
        const plan = planCombatExchange(state(), intent);
        expect(plan.ok).toBe(true);
        const checkEvent = plan.payload.result.events.find(event => event.type === 'check');
        expect(checkEvent).toMatchObject({
            success: true,
            rolled: 21, // 20 + stealth mod (+1)
            natural: 20,
        });
        expect(plan.payload.result.summary).toContain('Success (Critical Success / Natural 20)');
    });
});

describe('Guard stance', () => {
    const guardian = (overrides = {}) => ({
        id: 'tor', name: 'Torvald', hp: 18, maxHp: 18, ac: 14, attackBonus: 4, damage: '1d8+2', status: 'healthy', ...overrides,
    });

    it('redirects a player-targeted enemy attack into the guarding companion', () => {
        rollQueue.push(15, 4); // enemy d20 (15+4=19 hits AC 14), damage 1d6+2 = 6
        const intent = normalizeCombatExchange({
            player_slots: [{ action: 'pass' }],
            companion_intents: [{ companion_id: 'tor', action: 'guard' }],
            enemy_intents: [{ enemy_id: 'Goblin', action: 'attack', target: 'player' }],
        });
        const plan = planCombatExchange(state({ party: [guardian()] }), intent);

        expect(plan.ok).toBe(true);
        const attack = plan.payload.result.events.find(event => event.type === 'attack');
        expect(attack).toMatchObject({ actor: 'Goblin', target: 'Torvald', hit: true, damage: 6, intercepted: true });
        expect(plan.payload.playerDamage).toBe(0);
        expect(plan.payload.party.find(companion => companion.id === 'tor').hp).toBe(12);
        expect(plan.payload.result.summary).toContain('gives up their attack to shield the hero');
        expect(plan.payload.result.summary).toContain('guard — Torvald intercepts the blow meant for the hero');
    });

    it('also redirects the default missing-intent enemy attack', () => {
        rollQueue.push(15, 4);
        const intent = normalizeCombatExchange({
            player_slots: [{ action: 'pass' }],
            companion_intents: [{ companion_id: 'tor', action: 'guard' }],
        });
        const plan = planCombatExchange(state({ party: [guardian()] }), intent);
        const attack = plan.payload.result.events.find(event => event.type === 'attack');

        expect(attack).toMatchObject({ target: 'Torvald', intercepted: true });
        expect(plan.payload.playerDamage).toBe(0);
    });

    it('lets later attacks through to the player once the guardian drops mid-round', () => {
        // Enemy A downs the 5 HP guardian (15+4 hits AC 14, 1d6+2 = 8); enemy B then
        // finds no active guardian and strikes the hero (15+4=19 vs AC 16, 1d6+2 = 5).
        rollQueue.push(15, 6, 15, 3);
        const intent = normalizeCombatExchange({
            player_slots: [{ action: 'pass' }],
            companion_intents: [{ companion_id: 'tor', action: 'guard' }],
            enemy_intents: [
                { enemy_id: 'A', action: 'attack', target: 'player' },
                { enemy_id: 'B', action: 'attack', target: 'player' },
            ],
        });
        const plan = planCombatExchange(state({
            enemies: [enemy('A'), enemy('B')],
            party: [guardian({ hp: 5 })],
        }), intent);
        const attacks = plan.payload.result.events.filter(event => event.type === 'attack');

        expect(attacks[0]).toMatchObject({ actor: 'A', target: 'Torvald', intercepted: true });
        expect(attacks[1]).toMatchObject({ actor: 'B', target: 'Vesa', hit: true, damage: 5 });
        expect(attacks[1].intercepted).toBeUndefined();
        expect(plan.payload.party.find(companion => companion.id === 'tor')).toMatchObject({ hp: 0, status: 'downed' });
        expect(plan.payload.playerDamage).toBe(5);
    });

    it('does not intercept attacks declared against a different companion', () => {
        rollQueue.push(15, 4); // hits Wit's AC 13
        const intent = normalizeCombatExchange({
            player_slots: [{ action: 'pass' }],
            companion_intents: [
                { companion_id: 'tor', action: 'guard' },
                { companion_id: 'wit', action: 'pass' },
            ],
            enemy_intents: [{ enemy_id: 'Goblin', action: 'attack', target: 'wit' }],
        });
        const plan = planCombatExchange(state({
            party: [guardian(), { id: 'wit', name: 'Wit', hp: 10, maxHp: 10, ac: 13, attackBonus: 3, damage: '1d6+1', status: 'healthy' }],
        }), intent);
        const attack = plan.payload.result.events.find(event => event.type === 'attack');

        expect(attack).toMatchObject({ target: 'Wit', hit: true });
        expect(attack.intercepted).toBeUndefined();
        expect(plan.payload.party.find(companion => companion.id === 'tor').hp).toBe(18);
    });

    it('clears a stale guarding flag at the start of each exchange', () => {
        rollQueue.push(5, 15, 4); // companion default attack misses; enemy hits the hero for 6
        const intent = normalizeCombatExchange({
            player_slots: [{ action: 'pass' }],
            enemy_intents: [{ enemy_id: 'Goblin', action: 'attack', target: 'player' }],
        });
        const plan = planCombatExchange(state({ party: [guardian({ guarding: true })] }), intent);
        const attack = plan.payload.result.events.find(event => event.actor === 'Goblin');

        expect(attack).toMatchObject({ target: 'Vesa', hit: true, damage: 6 });
        expect(attack.intercepted).toBeUndefined();
        expect(plan.payload.playerDamage).toBe(6);
    });

    it('rejects a guard declaration from an incapacitated companion', () => {
        rollQueue.push(15, 4); // enemy attack proceeds against the unprotected hero
        const intent = normalizeCombatExchange({
            player_slots: [{ action: 'pass' }],
            companion_intents: [{ companion_id: 'tor', action: 'guard' }],
            enemy_intents: [{ enemy_id: 'Goblin', action: 'attack', target: 'player' }],
        });
        const plan = planCombatExchange(state({ party: [guardian({ conditions: ['stunned'] })] }), intent);
        const attack = plan.payload.result.events.find(event => event.type === 'attack');

        expect(plan.payload.result.summary).toContain('Torvald is stunned and cannot guard the hero');
        expect(attack).toMatchObject({ target: 'Vesa' });
        expect(attack.intercepted).toBeUndefined();
        expect(plan.payload.playerDamage).toBe(6);
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

    it('a paralyzed ambusher loses its opening slot while the other enemy still acts', () => {
        const openingState = state({
            enemies: [enemy('Frozen', { conditions: ['paralyzed'] }), enemy('Loose')],
            combat: {
                phase: COMBAT_PHASES.OPENING,
                openingActorIds: ['Frozen', 'Loose'],
                turnOrder: [
                    { type: 'enemy', id: 'Frozen', name: 'Frozen', initiative: 19 },
                    { type: 'enemy', id: 'Loose', name: 'Loose', initiative: 17 },
                    { type: 'player', name: 'Vesa', initiative: 15 },
                ],
            },
        });
        rollQueue.push(15, 2); // Loose only: to-hit, damage

        const plan = planOpeningExchange(openingState);
        expect(plan.ok).toBe(true);
        const attacks = plan.payload.result.events.filter(event => event.type === 'attack');
        expect(attacks.map(event => event.actor)).toEqual(['Loose']);
        expect(plan.payload.result.events.some(event =>
            event.type === 'note' && event.text.includes('Frozen is paralyzed and cannot act')
        )).toBe(true);
    });

    it('shares one Uncanny Dodge across all opening enemies against a level 5+ Rogue', () => {
        // Ambush: both enemies won initiative, each resolved by its own per-actor
        // resolveEnemies call — the once-per-turn reaction must still fire only once.
        const openingState = state({
            character: { class: 'rogue', level: 5, maxHP: 35, currentHP: 35 },
            enemies: [enemy('G1'), enemy('G2')],
            combat: {
                phase: COMBAT_PHASES.OPENING,
                openingActorIds: ['G1', 'G2'],
                turnOrder: [
                    { type: 'enemy', id: 'G1', name: 'G1', initiative: 19 },
                    { type: 'enemy', id: 'G2', name: 'G2', initiative: 17 },
                    { type: 'player', name: 'Vesa', initiative: 15 },
                ],
            },
        });
        rollQueue.push(15); // G1 to-hit
        rollQueue.push(2);  // G1 damage: 2 + 2 = 4, halved to 2
        rollQueue.push(15); // G2 to-hit
        rollQueue.push(2);  // G2 damage: 2 + 2 = 4, NOT halved

        const plan = planOpeningExchange(openingState);
        expect(plan.ok).toBe(true);

        const attacks = plan.payload.result.events.filter(e => e.type === 'attack' && e.target === 'Vesa');
        expect(attacks.length).toBe(2);
        expect(attacks[0]).toMatchObject({ actor: 'G1', hit: true, damage: 2, uncannyDodgeApplied: true });
        expect(attacks[1]).toMatchObject({ actor: 'G2', hit: true, damage: 4, uncannyDodgeApplied: false });
        expect(plan.payload.playerDamage).toBe(6);
    });
});

describe('Rogue Combat Features', () => {
    it('validates Cunning Action slot count for Rogue level 2+', () => {
        const rogueL2 = state({
            character: { class: 'rogue', level: 2 },
        });

        // 1. Valid: 1 attack slot
        const oneSlot = normalizeCombatExchange({
            player_slots: [{ action: 'attack', strikes: [{ target: 'Goblin' }] }],
        });
        expect(planCombatExchange(rogueL2, oneSlot).ok).toBe(true);

        // 2. Valid: 1 attack + 1 dash (Cunning Action)
        const attackAndDash = normalizeCombatExchange({
            player_slots: [
                { action: 'attack', strikes: [{ target: 'Goblin' }] },
                { action: 'dash' }
            ],
        });
        expect(planCombatExchange(rogueL2, attackAndDash).ok).toBe(true);

        // 3. Valid: 1 attack + 1 stealth check (Cunning Action)
        const attackAndStealth = normalizeCombatExchange({
            player_slots: [
                { action: 'attack', strikes: [{ target: 'Goblin' }] },
                { action: 'check', skill: 'stealth', dc: 10 }
            ],
        });
        expect(planCombatExchange(rogueL2, attackAndStealth).ok).toBe(true);

        // 4. Invalid: 2 attack slots (no Action Surge)
        const doubleAttack = normalizeCombatExchange({
            player_slots: [
                { action: 'attack', strikes: [{ target: 'Goblin' }] },
                { action: 'attack', strikes: [{ target: 'Goblin' }] }
            ],
        });
        expect(planCombatExchange(rogueL2, doubleAttack).ok).toBe(false);

        // 5. Invalid: 2 slots but neither is a Cunning Action (e.g. cast + dodge)
        const castAndDodge = normalizeCombatExchange({
            player_slots: [
                { action: 'cast', spell: 'fire bolt', target: 'Goblin' },
                { action: 'dodge' }
            ],
        });
        expect(planCombatExchange(rogueL2, castAndDodge).ok).toBe(false);

        // 6. Invalid: Level 1 Rogue trying to declare 2 slots
        const rogueL1 = state({
            character: { class: 'rogue', level: 1 },
        });
        expect(planCombatExchange(rogueL1, attackAndDash).ok).toBe(false);
    });

    it('applies Sneak Attack damage in combat when Rogue has advantage or companion', () => {
        const rogueL3 = state({
            character: { class: 'rogue', level: 3, abilityScores: { ...character().abilityScores, dexterity: 16 } },
        });
        // We equip a finesse weapon: dagger
        rogueL3.inventory = [{ id: 'dagger', name: 'Dagger', type: 'weapon', finesse: true, damage: '1d4', equipped: true }];

        const intent = normalizeCombatExchange({
            player_slots: [{ action: 'attack', strikes: [{ target: 'Goblin' }], situationalRuling: { mode: 'advantage', reason: 'flanking' } }],
            enemy_intents: [{ enemy_id: 'Goblin', action: 'defend' }],
        });

        // rolls needed:
        // 1. Player attack to-hit: d20 = 15 (hits AC 12)
        // 2. Weapon damage: 1d4 = 3
        // 3. Sneak Attack: 2d6 = 4, 5
        rollQueue.push(15, 5); // to-hit (advantage draws two)
        rollQueue.push(3);     // weapon damage
        rollQueue.push(4, 5);  // sneak attack damage

        const plan = planCombatExchange(rogueL3, intent);
        expect(plan.ok).toBe(true);

        const attackEvent = plan.payload.result.events.find(e => e.type === 'attack' && e.actor === 'Vesa');
        expect(attackEvent).toMatchObject({
            hit: true,
            // 3 (weapon) + 3 (DEX mod) + 9 (Sneak Attack) = 15
            damage: 15,
        });
        expect(attackEvent.sneakAttackDetail).toMatchObject({
            diceCount: 2,
            rolls: [4, 5],
            total: 9,
        });
        expect(plan.payload.result.summary).toContain('Includes **9** Sneak Attack damage');
    });

    it('applies Uncanny Dodge to the first hit on a level 5+ Rogue in an exchange', () => {
        const rogueL5 = state({
            character: { class: 'rogue', level: 5, maxHP: 35, currentHP: 35 },
            enemies: [enemy('G1'), enemy('G2')],
        });

        const intent = normalizeCombatExchange({
            player_slots: [{ action: 'pass' }],
            enemy_intents: [
                { enemy_id: 'G1', action: 'attack', target: 'player' },
                { enemy_id: 'G2', action: 'attack', target: 'player' }
            ],
        });

        // rolls needed:
        // 1. G1 to-hit: d20 = 15
        // 2. G1 damage: 1d6+2 = 4 (roll 2 + 2)
        // 3. G2 to-hit: d20 = 15
        // 4. G2 damage: 1d6+2 = 4 (roll 2 + 2)
        rollQueue.push(15); // G1 to-hit
        rollQueue.push(2);  // G1 damage
        rollQueue.push(15); // G2 to-hit
        rollQueue.push(2);  // G2 damage

        const plan = planCombatExchange(rogueL5, intent);
        expect(plan.ok).toBe(true);

        const attacks = plan.payload.result.events.filter(e => e.type === 'attack' && e.target === 'Vesa');
        expect(attacks.length).toBe(2);

        // First attack (G1): halved (4 -> 2)
        expect(attacks[0]).toMatchObject({
            actor: 'G1',
            hit: true,
            damage: 2,
            uncannyDodgeApplied: true,
        });

        // Second attack (G2): normal (4)
        expect(attacks[1]).toMatchObject({
            actor: 'G2',
            hit: true,
            damage: 4,
            uncannyDodgeApplied: false,
        });

        expect(plan.payload.result.summary).toContain('halved by Uncanny Dodge');
    });
});

describe('spellcasting v1 combat exchanges', () => {
    const wizardState = ({ character: charOverrides, ...rest } = {}) => state({
        character: {
            class: `wizard`, level: 5,
            abilityScores: { strength: 8, dexterity: 12, constitution: 12, intelligence: 16, wisdom: 10, charisma: 10 },
            spellSlots: buildSpellSlots(charOverrides?.level || 5),
            ...(charOverrides || {}),
        },
        ...rest,
    });

    const clericState = ({ character: charOverrides, ...rest } = {}) => state({
        character: {
            class: `cleric`, level: 5,
            abilityScores: { strength: 12, dexterity: 10, constitution: 14, intelligence: 10, wisdom: 16, charisma: 12 },
            spellSlots: buildSpellSlots(charOverrides?.level || 5),
            classResources: { channelDivinity: { used: 0, max: 1 } },
            ...(charOverrides || {}),
        },
        ...rest,
    });

    it('resolves a multi-target save spell with one shared damage roll, half on success', () => {
        // Damage 6d6 first (queue 6x3=18), then two saves: 4 (+2=6, fail) and 18 (+2=20, save).
        rollQueue.push(3, 3, 3, 3, 3, 3, 4, 18);
        const plan = planCombatExchange(
            wizardState({ enemies: [enemy(`A`, { hp: 30, maxHp: 30 }), enemy(`B`, { hp: 30, maxHp: 30 })] }),
            normalizeCombatExchange({
                player_slots: [{ action: `cast`, spell: `fireball`, targets: [`A`, `B`] }],
                enemy_intents: [],
            })
        );
        expect(plan.ok).toBe(true);
        expect(plan.payload.characterUpdates.spellSlots[3]).toEqual({ used: 1, max: 2 });
        const [a, b] = plan.payload.enemies;
        expect(a.hp).toBe(12); // failed save: full 18
        expect(b.hp).toBe(21); // saved: half of 18 = 9
        expect(plan.payload.result.summary).toContain(`save vs Fireball`);
    });

    it('applies a control condition on a failed save and rejects casts with no slots left', () => {
        rollQueue.push(2); // save 2 + 2 = 4 vs DC 14 — fail
        const drained = { 1: { used: 4, max: 4 }, 2: { used: 3, max: 3 }, 3: { used: 2, max: 2 } };
        const okPlan = planCombatExchange(wizardState(), normalizeCombatExchange({
            player_slots: [{ action: `cast`, spell: `sleep`, target: `Goblin` }],
            enemy_intents: [],
        }));
        expect(okPlan.ok).toBe(true);
        expect(okPlan.payload.enemies[0].conditions).toContain(`unconscious`);

        const noSlots = planCombatExchange(
            wizardState({ character: { spellSlots: drained } }),
            normalizeCombatExchange({ player_slots: [{ action: `cast`, spell: `sleep`, target: `Goblin` }] })
        );
        expect(noSlots).toMatchObject({ ok: false, error: expect.stringContaining(`No spell slot remains`) });
    });

    it('clamps an over-targeted single-target spell to its first target instead of rejecting the turn', () => {
        rollQueue.push(2); // one save for the clamped target only — 2 + 2 = 4 vs DC, fail
        const plan = planCombatExchange(
            wizardState({ enemies: [enemy(`A`), enemy(`B`), enemy(`C`)] }),
            normalizeCombatExchange({
                player_slots: [{ action: `cast`, spell: `sleep`, targets: [`A`, `B`, `C`] }],
                enemy_intents: [],
            })
        );
        expect(plan.ok).toBe(true);
        const [a, b, c] = plan.payload.enemies;
        expect(a.conditions).toContain(`unconscious`);
        expect(b.conditions || []).not.toContain(`unconscious`);
        expect(c.conditions || []).not.toContain(`unconscious`);
        expect(plan.payload.result.summary).toContain(`Sleep affects only one target`);
        expect(plan.payload.characterUpdates.spellSlots[1].used).toBe(1);
    });

    it('lets a cleric pair a bonus-action heal with a normal action, but never two action spells', () => {
        // Sacred flame attack roll 15 (+6=21 hits), damage 2d8 (4,4), healing word 1d4 (3).
        rollQueue.push(15, 4, 4, 3);
        const hurt = clericState({ character: { currentHP: 10 } });
        const plan = planCombatExchange(hurt, normalizeCombatExchange({
            player_slots: [
                { action: `cast`, spell: `sacred flame`, target: `Goblin` },
                { action: `cast`, spell: `healing word`, target: `self` },
            ],
            enemy_intents: [],
        }));
        expect(plan.ok).toBe(true);
        expect(plan.payload.playerHealing).toBe(6); // 1d4(3) + WIS 3
        expect(plan.payload.characterUpdates.spellSlots[2]).toEqual({ used: 1, max: 3 });

        const twoActions = planCombatExchange(clericState(), normalizeCombatExchange({
            player_slots: [
                { action: `cast`, spell: `sacred flame`, target: `Goblin` },
                { action: `cast`, spell: `cure wounds`, target: `self` },
            ],
        }));
        expect(twoActions.ok).toBe(false);
    });

    it('heals a downed companion back to their feet mid-exchange', () => {
        rollQueue.push(2); // 1d4 = 2, +3 WIS = 5
        const withCompanion = clericState({
            party: [{ id: `jorun`, name: `Jorun`, hp: 0, maxHp: 12, ac: 14, status: `downed`, conditions: [] }],
        });
        const plan = planCombatExchange(withCompanion, normalizeCombatExchange({
            player_slots: [{ action: `cast`, spell: `healing word`, target: `Jorun` }],
            enemy_intents: [],
        }));
        expect(plan.ok).toBe(true);
        const jorun = plan.payload.party.find(c => c.id === `jorun`);
        expect(jorun.hp).toBe(5);
        expect(jorun.status).toBe(`bloodied`); // 5/12 HP — up, but still hurt
    });

    it('sustains Mage Armor: +3 AC applies to enemy attacks in the same exchange', () => {
        // Enemy attack draw 9: 9+4=13 vs unarmored AC 11+3=14 — miss because of the buff.
        rollQueue.push(9);
        const unarmored = wizardState();
        unarmored.inventory = [];
        const plan = planCombatExchange(unarmored, normalizeCombatExchange({
            player_slots: [{ action: `cast`, spell: `mage armor` }],
            enemy_intents: [{ enemy_id: `Goblin`, action: `attack`, target: `player` }],
        }));
        expect(plan.ok).toBe(true);
        expect(plan.payload.characterUpdates.sustainedSpell).toMatchObject({ key: `mageArmor`, acBonus: 3, targetType: `self` });
        expect(plan.payload.playerDamage).toBe(0);
        const attackEvent = plan.payload.result.events.find(e => e.type === `attack`);
        expect(attackEvent).toMatchObject({ hit: false, dc: 14 });
    });

    it('turns undead: destroys weak undead at cleric 5, frightens the strong, spends Channel Divinity', () => {
        rollQueue.push(3, 3); // both saves fail (3+2=5 vs DC 14)
        const undeadFight = clericState({
            enemies: [
                enemy(`Skeleton`, { hp: 13, maxHp: 13, isUndead: true }),
                enemy(`Wight`, { hp: 45, maxHp: 45, isUndead: true }),
            ],
        });
        const plan = planCombatExchange(undeadFight, normalizeCombatExchange({
            player_slots: [{ action: `channel` }],
            enemy_intents: [],
        }));
        expect(plan.ok).toBe(true);
        expect(plan.payload.characterUpdates.classResources.channelDivinity.used).toBe(1);
        const [skeleton, wight] = plan.payload.enemies;
        expect(skeleton.condition).toBe(`dead`);
        expect(wight.conditions).toContain(`frightened`);

        const noUndead = planCombatExchange(clericState(), normalizeCombatExchange({
            player_slots: [{ action: `channel` }],
        }));
        expect(noUndead).toMatchObject({ ok: false, error: expect.stringContaining(`no undead`) });
    });

    it('rejects spells from the wrong class list and out-of-combat-only spells', () => {
        const wrongClass = planCombatExchange(clericState(), normalizeCombatExchange({
            player_slots: [{ action: `cast`, spell: `fireball`, target: `Goblin` }],
        }));
        expect(wrongClass.ok).toBe(false);

        // Knock is a 4th-level spell — use a wizard high enough to know it.
        const utility = planCombatExchange(wizardState({ character: { level: 9 } }), normalizeCombatExchange({
            player_slots: [{ action: `cast`, spell: `knock` }],
        }));
        expect(utility).toMatchObject({ ok: false, error: expect.stringContaining(`no combat effect`) });
    });
});
