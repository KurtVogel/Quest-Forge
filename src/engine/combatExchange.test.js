import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
    COMBAT_PHASES,
    combatNarrationPrompt,
    exchangeEventLines,
    exchangeSummary,
    normalizeCombatExchange,
    planCombatExchange,
    planOpeningExchange,
    reconcileStartingCombatExchange,
} from './combatExchange.js';
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
        rollDice: (count) => Array.from({ length: count }, draw),
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

describe('hostile intent envelopes (2026-07-25 audit)', () => {
    it('rejects non-object top-level envelopes outright', () => {
        expect(normalizeCombatExchange(null)).toBeNull();
        expect(normalizeCombatExchange(undefined)).toBeNull();
        expect(normalizeCombatExchange('attack the goblin')).toBeNull();
        expect(normalizeCombatExchange(42)).toBeNull();
        expect(normalizeCombatExchange([{ player_slots: [{ action: 'attack' }] }])).toBeNull();
    });

    it('reconcileStartingCombatExchange returns null when normalization fails', () => {
        expect(reconcileStartingCombatExchange('garbage', [enemy('Goblin')])).toBeNull();
        expect(reconcileStartingCombatExchange({ player_slots: [] }, [enemy('Goblin')])).toBeNull();
    });

    it('caps flooded slot/intent arrays at their documented limits', () => {
        const flooded = normalizeCombatExchange({
            player_slots: Array.from({ length: 20 }, () => ({ action: 'attack', strikes: [{ target: 'Goblin' }] })),
            enemy_intents: Array.from({ length: 200 }, (_, i) => ({ enemy_id: `goblin-${i}`, action: 'attack', target: 'player' })),
            companion_intents: Array.from({ length: 40 }, (_, i) => ({ companion_id: `ally-${i}`, action: 'defend' })),
        });
        // 3 = two action slots (Surge/Cunning/bonus-cast lanes) + one second_wind;
        // validatePlayerSlots enforces the real per-lane rules on top.
        expect(flooded.playerSlots).toHaveLength(3);
        expect(flooded.enemyIntents).toHaveLength(30);
        expect(flooded.companionIntents).toHaveLength(4);
    });

    it('rejects the exchange when the save has no character (latent load-boundary guard)', () => {
        const noCharacter = { ...state(), character: null };
        expect(planCombatExchange(noCharacter, exchange())).toMatchObject({
            ok: false,
            error: expect.stringContaining('No active character'),
        });
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
        rollQueue.push(20, 8, 7); // nat 20 crit → 2d8+3 damage (8+7+3=18) fells the 5 HP goblin before its slot
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
        rollQueue.push(15, 7, 1); // player hits for 10; Cave-Worg misses
        const intent = normalizeCombatExchange({
            player_slots: [{ action: 'attack', strikes: [{ target: 'Cave-Worg' }] }],
            enemy_intents: [{ enemy_id: 'Cave-Worg', action: 'attack', target: 'player' }],
        });
        const plan = planCombatExchange(state({
            enemies: [enemy('Cave-Worg', { hp: 20, maxHp: 32, ac: 14 })],
        }), intent);

        expect(plan.payload.enemies[0].hp).toBe(10);
        expect(plan.payload.result.terminal).toBeNull();
        expect(exchangeSummary(plan.payload.result)).toContain('Cave-Worg remains alive at 10/32 HP');

        const prompt = combatNarrationPrompt(plan.payload.result);
        expect(prompt).toContain('The terminal state is mechanically authoritative: ongoing');
        expect(prompt).toContain('COMBAT IS STILL ACTIVE');
        expect(prompt).toContain('ALIVE AND ACTIVE: Cave-Worg — 10/32 HP');
        expect(prompt).toContain('Never describe an ALIVE AND ACTIVE combatant as dead');
    });

    it('stores events only on the result — the summary is derived, never persisted', () => {
        rollQueue.push(15, 7, 1);
        const intent = exchange();
        const plan = planCombatExchange(state(), intent);

        expect(plan.ok).toBe(true);
        expect(plan.payload.result).not.toHaveProperty('summary');
        expect(Array.isArray(plan.payload.result.events)).toBe(true);
        // The narration prompt's RESOLVED EVENTS block derives from the same events.
        expect(combatNarrationPrompt(plan.payload.result)).toContain(exchangeEventLines(plan.payload.result)[0]);
    });

    it('derives lines from a legacy summary-string result (pre-2026-08-04 in-flight saves)', () => {
        const legacy = { exchangeId: 'x', summary: '**A attacks B** — Hit.\n**B attacks A** — Miss.' };
        expect(exchangeEventLines(legacy)).toEqual(['**A attacks B** — Hit.', '**B attacks A** — Miss.']);
        expect(exchangeSummary(legacy)).toBe('**A attacks B** — Hit.\n**B attacks A** — Miss.');
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
        expect(exchangeSummary(plan.payload.result)).toContain('Wit threatens it from the opposite side');
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
        expect(exchangeSummary(plan.payload.result)).toContain('Success (Critical Success / Natural 20)');
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
        expect(exchangeSummary(plan.payload.result)).toContain('gives up their attack to shield the hero');
        expect(exchangeSummary(plan.payload.result)).toContain('guard — Torvald intercepts the blow meant for the hero');
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

        expect(exchangeSummary(plan.payload.result)).toContain('Torvald is stunned and cannot guard the hero');
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
        rollQueue.push(1, 20, 6, 2); // Fast nat-1 misses; Ally nat-20 crits Fast for 2d6+1 (6+2+1=9)
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

        // 1. Valid: 1 attack slot — player nat-1 misses; the Goblin's default
        // attack (2+4=6 vs the hero's unarmored AC 11) misses too.
        const oneSlot = normalizeCombatExchange({
            player_slots: [{ action: 'attack', strikes: [{ target: 'Goblin' }] }],
        });
        rollQueue.push(1, 2);
        expect(planCombatExchange(rogueL2, oneSlot).ok).toBe(true);

        // 2. Valid: 1 attack + 1 dash (Cunning Action) — same miss/miss dice.
        const attackAndDash = normalizeCombatExchange({
            player_slots: [
                { action: 'attack', strikes: [{ target: 'Goblin' }] },
                { action: 'dash' }
            ],
        });
        rollQueue.push(1, 2);
        expect(planCombatExchange(rogueL2, attackAndDash).ok).toBe(true);

        // 3. Valid: 1 attack + 1 stealth check (Cunning Action) — attack nat-1
        // misses, stealth d20 5, Goblin misses.
        const attackAndStealth = normalizeCombatExchange({
            player_slots: [
                { action: 'attack', strikes: [{ target: 'Goblin' }] },
                { action: 'check', skill: 'stealth', dc: 10 }
            ],
        });
        rollQueue.push(1, 5, 2);
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
        expect(exchangeSummary(plan.payload.result)).toContain('Includes **9** Sneak Attack damage');
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

        expect(exchangeSummary(plan.payload.result)).toContain('halved by Uncanny Dodge');
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
        // Both foes survive and default-attack the player: 2+4=6 misses AC 11 twice.
        rollQueue.push(3, 3, 3, 3, 3, 3, 4, 18, 2, 2);
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
        expect(exchangeSummary(plan.payload.result)).toContain(`save vs Fireball`);
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
        // One save for the clamped target only — 2 + 2 = 4 vs DC, fail. A falls
        // unconscious and loses its action; B and C default-attack (2+4=6 misses AC 11).
        rollQueue.push(2, 2, 2);
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
        expect(exchangeSummary(plan.payload.result)).toContain(`Sleep affects only one target`);
        expect(plan.payload.characterUpdates.spellSlots[1].used).toBe(1);
    });

    it('lets a cleric pair a bonus-action heal with a normal action, but never two action spells', () => {
        // Sacred flame attack roll 15 (+6=21 hits), damage 2d8 (4,4), healing word 1d4 (3).
        // The wounded Goblin still default-attacks: 2+4=6 misses the cleric's AC 10.
        rollQueue.push(15, 4, 4, 3, 2);
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
        // Heal 1d4 = 2, +3 WIS = 5. The revived Jorun then default-attacks the Goblin
        // (3+2=5 misses AC 12) and the Goblin default-attacks (2+4=6 misses AC 10).
        rollQueue.push(2, 3, 2);
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
        // Both saves fail (3+2=5 vs DC 14). The frightened Wight still default-attacks
        // at disadvantage (two d20s: 2, 3 → keeps 2; 2+4=6 misses the cleric's AC 10).
        rollQueue.push(3, 3, 2, 3);
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

describe('standing flank persistence', () => {
    const flankedState = (overrides = {}) => state({
        party: [{ id: 'wit', name: 'Wit', hp: 10, maxHp: 10, ac: 13, attackBonus: 3, damage: '1d6+1', status: 'healthy' }],
        ...overrides,
        combat: { flankedEnemyIds: ['Goblin'], ...(overrides.combat || {}) },
    });

    it('normalizes flank_broken references from the intent envelope', () => {
        const intent = normalizeCombatExchange({
            player_slots: [{ action: 'attack', strikes: [{ target: 'Goblin' }] }],
            flank_broken: ['Goblin', 'Goblin', { target: 'Wolf' }],
        });
        expect(intent.flankBroken).toEqual(['Goblin', 'Wolf']);
    });

    it('records an established flank in the payload for the next exchange', () => {
        rollQueue.push(2, 3, 4, 18, 1);
        const plan = planCombatExchange(flankedState({ combat: { flankedEnemyIds: [] } }), normalizeCombatExchange({
            player_slots: [{
                action: 'attack',
                strikes: [{ target: 'Goblin' }],
                situational_ruling: { mode: 'advantage', reason: 'Wit flanks the goblin from the opposite side' },
            }],
            companion_intents: [{ companion_id: 'wit', action: 'attack', target: 'Goblin' }],
            enemy_intents: [{ enemy_id: 'Goblin', action: 'defend' }],
        }));
        expect(plan.payload.flankedEnemyIds).toEqual(['Goblin']);
        expect(plan.payload.result.events.some(event =>
            event.type === 'note' && /Flanking established against Goblin/.test(event.text))).toBe(true);
    });

    it('applies standing flank advantage to the player without a re-emitted ruling', () => {
        rollQueue.push(2, 18, 5, 3);
        const plan = planCombatExchange(flankedState(), normalizeCombatExchange({
            player_slots: [{ action: 'attack', strikes: [{ target: 'Goblin' }] }],
            companion_intents: [{ companion_id: 'wit', action: 'pass' }],
            enemy_intents: [{ enemy_id: 'Goblin', action: 'attack', target: 'player' }],
        }));
        const attack = plan.payload.result.events.find(event => event.type === 'attack' && event.actor === 'Vesa');
        expect(attack.mode).toContain('d20 2, 18');
        expect(attack.mode).toContain('DM ruling — advantage: flanking (standing)');
        expect(plan.payload.flankedEnemyIds).toEqual(['Goblin']);
    });

    it('shares a standing flank with companions attacking the same target', () => {
        rollQueue.push(4, 18, 1);
        const plan = planCombatExchange(flankedState(), normalizeCombatExchange({
            player_slots: [{ action: 'pass' }],
            companion_intents: [{ companion_id: 'wit', action: 'attack', target: 'Goblin' }],
            enemy_intents: [{ enemy_id: 'Goblin', action: 'defend' }],
        }));
        const companionAttack = plan.payload.result.events.find(event => event.actor === 'Wit');
        expect(companionAttack.mode).toContain('d20 4, 18');
        expect(companionAttack.mode).toContain('DM ruling — advantage: flanking');
    });

    it('lets an explicit slot ruling replace the standing flank', () => {
        rollQueue.push(18, 2, 3);
        const plan = planCombatExchange(flankedState(), normalizeCombatExchange({
            player_slots: [{
                action: 'attack',
                strikes: [{ target: 'Goblin' }],
                situational_ruling: { mode: 'disadvantage', reason: 'Smoke fills the room' },
            }],
            companion_intents: [{ companion_id: 'wit', action: 'pass' }],
            enemy_intents: [{ enemy_id: 'Goblin', action: 'attack', target: 'player' }],
        }));
        const attack = plan.payload.result.events.find(event => event.type === 'attack' && event.actor === 'Vesa');
        expect(attack.mode).toContain('DM ruling — disadvantage: Smoke fills the room');
        expect(attack.mode).not.toContain('standing');
    });

    it('clears the flank when the DM declares flank_broken', () => {
        rollQueue.push(18, 5, 3);
        const plan = planCombatExchange(flankedState(), normalizeCombatExchange({
            player_slots: [{ action: 'attack', strikes: [{ target: 'Goblin' }] }],
            companion_intents: [{ companion_id: 'wit', action: 'pass' }],
            enemy_intents: [{ enemy_id: 'Goblin', action: 'attack', target: 'player' }],
            flank_broken: ['Goblin'],
        }));
        const attack = plan.payload.result.events.find(event => event.type === 'attack' && event.actor === 'Vesa');
        expect(attack.mode).not.toContain('flanking');
        expect(plan.payload.flankedEnemyIds).toEqual([]);
        expect(plan.payload.result.events.some(event =>
            event.type === 'note' && /flank on Goblin is broken/.test(event.text))).toBe(true);
    });

    it('drops a flanked enemy from the list once it is overcome', () => {
        rollQueue.push(2, 18, 10);
        const plan = planCombatExchange(flankedState({ enemies: [enemy('Goblin', { hp: 3, maxHp: 10 })] }), normalizeCombatExchange({
            player_slots: [{ action: 'attack', strikes: [{ target: 'Goblin' }] }],
            companion_intents: [{ companion_id: 'wit', action: 'pass' }],
        }));
        expect(plan.payload.result.terminal).toBe('victory');
        expect(plan.payload.flankedEnemyIds).toEqual([]);
    });

    it('abandons standing flanks when the hero disengages', () => {
        rollQueue.push(3);
        const plan = planCombatExchange(flankedState(), normalizeCombatExchange({
            player_slots: [{ action: 'disengage' }],
            companion_intents: [{ companion_id: 'wit', action: 'pass' }],
            enemy_intents: [{ enemy_id: 'Goblin', action: 'attack', target: 'player' }],
        }));
        expect(plan.payload.flankedEnemyIds).toEqual([]);
    });

    it('ends the flank when no companion remains standing to hold it', () => {
        rollQueue.push(2, 18, 5, 3);
        const plan = planCombatExchange(flankedState({
            party: [{ id: 'wit', name: 'Wit', hp: 0, maxHp: 10, ac: 13, attackBonus: 3, damage: '1d6+1', status: 'downed' }],
        }), normalizeCombatExchange({
            player_slots: [{ action: 'attack', strikes: [{ target: 'Goblin' }] }],
            enemy_intents: [{ enemy_id: 'Goblin', action: 'attack', target: 'player' }],
        }));
        // The flank was still real at the start of this exchange; it just cannot persist.
        const attack = plan.payload.result.events.find(event => event.type === 'attack' && event.actor === 'Vesa');
        expect(attack.mode).toContain('advantage: flanking (standing)');
        expect(plan.payload.flankedEnemyIds).toEqual([]);
    });

    it('keeps a DM-adjudicated flank alive for a companionless party until broken', () => {
        rollQueue.push(2, 18, 5, 3);
        const plan = planCombatExchange(flankedState({ party: [] }), normalizeCombatExchange({
            player_slots: [{ action: 'attack', strikes: [{ target: 'Goblin' }] }],
            enemy_intents: [{ enemy_id: 'Goblin', action: 'attack', target: 'player' }],
        }));
        expect(plan.payload.flankedEnemyIds).toEqual(['Goblin']);
    });
});

describe('defend stance semantics (persisted vs same-exchange)', () => {
    it('a persisted enemy defend flag imposes disadvantage on this exchange\'s player attack, then resets', () => {
        // planCombatExchange copies `defending` straight from persisted combat.enemies
        // (~line 1425), so a defend committed LAST exchange bites now: the player's
        // attack rolls two d20s and keeps the LOW die — 18 would have hit (23 vs
        // AC 12), the kept 5 (10 vs AC 12) misses. The flag then resets for every
        // enemy before foes choose their new actions (~line 1503), so the goblin's
        // own attack this exchange is a normal single roll: 15+4=19 hits the hero's
        // unarmored AC 11 for 1d6(4)+2 = 6.
        rollQueue.push(18, 5, 15, 4);
        const plan = planCombatExchange(state({ enemies: [enemy('Goblin', { defending: true })] }), exchange());

        const playerAttack = plan.payload.result.events.find(e => e.type === 'attack' && e.actor === 'Vesa');
        expect(playerAttack).toMatchObject({ hit: false, natural: 5 });
        expect(playerAttack.mode).toContain('d20 18, 5');
        const goblinAttack = plan.payload.result.events.find(e => e.actor === 'Goblin');
        expect(goblinAttack).toMatchObject({ hit: true, damage: 6 });
        expect(plan.payload.playerDamage).toBe(6);
        // The enemy chose attack this exchange, so no defend flag persists onward.
        expect(plan.payload.enemies[0].defending).toBe(false);
    });

    it('an enemy defend declared THIS exchange protects only the NEXT exchange\'s attacks', () => {
        // Same-exchange: the player resolves BEFORE the enemy declares its stance,
        // so the attack is one straight d20 — 12+5=17 hits AC 12 for 1d8(3)+3 = 6.
        rollQueue.push(12, 3);
        const first = planCombatExchange(state(), exchange({
            enemy_intents: [{ enemy_id: 'Goblin', action: 'defend' }],
        }));
        const firstAttack = first.payload.result.events.find(e => e.type === 'attack');
        expect(firstAttack).toMatchObject({ hit: true, damage: 6, natural: 12 });
        expect(firstAttack.mode).toBe(''); // straight roll — no advantage/disadvantage detail
        expect(first.payload.enemies[0].defending).toBe(true); // lands in the committed post-state

        // Feed the committed enemies into the next exchange: NOW the defend bites —
        // two d20s, low kept (16 would have hit; the kept 3 → 8 misses AC 12).
        rollQueue.push(16, 3);
        const second = planCombatExchange(
            state({ enemies: first.payload.enemies }),
            exchange({ enemy_intents: [{ enemy_id: 'Goblin', action: 'defend' }] })
        );
        const secondAttack = second.payload.result.events.find(e => e.type === 'attack');
        expect(secondAttack).toMatchObject({ hit: false, natural: 3 });
        expect(secondAttack.mode).toContain('d20 16, 3');
    });

    it('a companion defend stance gives enemy attacks against it disadvantage in the SAME exchange', () => {
        // Companion stances are same-exchange (resolveCompanions sets the flag before
        // resolveEnemies reads it, ~line 1254) — the asymmetry with enemy defend above
        // is deliberate. Two d20s, low kept: 17 would hit Wit's AC 13, the kept 4 misses.
        rollQueue.push(17, 4);
        const plan = planCombatExchange(state({
            party: [{ id: 'wit', name: 'Wit', hp: 10, maxHp: 10, ac: 13, attackBonus: 3, damage: '1d6+1', status: 'healthy' }],
        }), normalizeCombatExchange({
            player_slots: [{ action: 'pass' }],
            companion_intents: [{ companion_id: 'wit', action: 'defend' }],
            enemy_intents: [{ enemy_id: 'Goblin', action: 'attack', target: 'wit' }],
        }));

        const attack = plan.payload.result.events.find(e => e.type === 'attack');
        expect(attack).toMatchObject({ actor: 'Goblin', target: 'Wit', hit: false, natural: 4 });
        expect(attack.mode).toContain('d20 17, 4');
        expect(plan.payload.party.find(c => c.id === 'wit').hp).toBe(10);
        expect(exchangeSummary(plan.payload.result)).toContain('Wit takes a defensive stance');
    });
});

describe('surrender and interact resolution', () => {
    it('an enemy surrender flips its status, denies it an attack, and ends the last-foe fight as victory', () => {
        const plan = planCombatExchange(state(), normalizeCombatExchange({
            player_slots: [{ action: 'pass' }],
            enemy_intents: [{ enemy_id: 'Goblin', action: 'surrender' }],
        }));

        expect(plan.ok).toBe(true);
        expect(plan.payload.enemies[0].combatStatus).toBe('surrendered');
        expect(plan.payload.result.events.some(e => e.type === 'attack')).toBe(false);
        expect(exchangeSummary(plan.payload.result)).toContain('Goblin surrenders and leaves the fight');
        // The surrendered goblin was the last active enemy → terminal victory,
        // with the snapshot keeping it alive at full HP.
        expect(plan.payload.result.terminal).toBe('victory');
        expect(plan.payload.result.postState.enemies[0]).toMatchObject({ status: 'surrendered', hp: 10 });
        expect(plan.payload.rolls).toHaveLength(0); // no dice existed anywhere in the exchange
    });

    it('a player interact slot resolves without dice as a narrative note', () => {
        const plan = planCombatExchange(state(), normalizeCombatExchange({
            player_slots: [{ action: 'interact', description: 'Wrench the portcullis lever' }],
            enemy_intents: [{ enemy_id: 'Goblin', action: 'defend' }],
        }));

        expect(plan.ok).toBe(true);
        // resolvePlayerSlots has no dedicated interact branch: it falls through to
        // the generic non-attack note.
        expect(plan.payload.result.events[0]).toMatchObject({
            type: 'note',
            text: 'Vesa uses their action to interact.',
        });
        expect(plan.payload.rolls).toHaveLength(0);
        expect(plan.payload.result.terminal).toBeNull();
    });
});

describe('critical hit dice doubling (live exchange path)', () => {
    it('a natural 20 doubles the weapon damage dice exactly', () => {
        // Longsword 1d8+3 crits as 2d8+3: queued crit dice 6 and 5 → 6+5+3 = 14.
        rollQueue.push(20, 6, 5);
        const plan = planCombatExchange(state({ enemies: [enemy('Goblin', { hp: 30, maxHp: 30 })] }), exchange({
            enemy_intents: [{ enemy_id: 'Goblin', action: 'defend' }],
        }));

        const attack = plan.payload.result.events.find(e => e.type === 'attack');
        expect(attack).toMatchObject({ critical: true, hit: true, damage: 14, remainingHp: 16, maxHp: 30 });
        expect(plan.payload.enemies[0].hp).toBe(16);
        // The single damage roll carries BOTH crit dice.
        const damageRoll = plan.payload.rolls[1];
        expect(damageRoll.rolls).toEqual([6, 5]);
        expect(damageRoll.total).toBe(14);
    });

    it('doubles Sneak Attack dice on a crit with exact totals', () => {
        const rogueL3 = state({
            character: { class: 'rogue', level: 3, abilityScores: { ...character().abilityScores, dexterity: 16 } },
            enemies: [enemy('Goblin', { hp: 30, maxHp: 30 })],
        });
        rogueL3.inventory = [{ id: 'dagger', name: 'Dagger', type: 'weapon', finesse: true, damage: '1d4', equipped: true }];
        // Advantage keeps the 20 → crit. Dagger 1d4 doubles to 2d4 (3+2), +3 DEX = 8.
        // Sneak Attack 2d6 doubles to saDiceCount = 4 d6 (6,5,4,3) = 18. Total 26.
        rollQueue.push(20, 5, 3, 2, 6, 5, 4, 3);
        const plan = planCombatExchange(rogueL3, normalizeCombatExchange({
            player_slots: [{
                action: 'attack',
                strikes: [{ target: 'Goblin' }],
                situational_ruling: { mode: 'advantage', reason: 'The goblin is blinded by lantern glare' },
            }],
            enemy_intents: [{ enemy_id: 'Goblin', action: 'defend' }],
        }));

        const attack = plan.payload.result.events.find(e => e.type === 'attack');
        expect(attack).toMatchObject({ critical: true, hit: true, damage: 26, remainingHp: 4 });
        expect(attack.sneakAttackDetail).toEqual({ diceCount: 4, rolls: [6, 5, 4, 3], total: 18 });
        expect(exchangeSummary(plan.payload.result)).toContain('Includes **18** Sneak Attack damage (4d6: 6, 5, 4, 3)');
        expect(plan.payload.enemies[0].hp).toBe(4);
    });
});

describe('Second Wind bonus-action lane (Codex 2026-08-09)', () => {
    const fighterState = (charOverrides = {}, combatOverrides = {}) => state({
        character: {
            currentHP: 8,
            classResources: { secondWind: { used: 0, max: 1 } },
            ...charOverrides,
        },
        combat: combatOverrides,
    });

    it('normalizes "Second Wind"/"secondWind" spellings into the documented key', () => {
        const spaced = normalizeCombatExchange({ player_slots: [{ action: 'Second Wind' }] });
        expect(spaced.playerSlots[0].action).toBe('second_wind');
        const camel = normalizeCombatExchange({ player_slots: [{ action: 'secondWind' }] });
        expect(camel.playerSlots[0].action).toBe('second_wind');
    });

    it('rides beside the normal action: heals, spends the resource, keeps the attack', () => {
        rollQueue.push(7, 15, 6, 1); // heal d10=7 (+2 level), attack 15 hits AC 12, 1d8=6 (+3 STR), goblin nat 1 miss
        const plan = planCombatExchange(fighterState(), normalizeCombatExchange({
            player_slots: [{ action: 'second_wind' }, { action: 'attack', strikes: [{ target: 'Goblin' }] }],
            enemy_intents: [{ enemy_id: 'Goblin', action: 'attack', target: 'player' }],
        }));

        expect(plan.ok).toBe(true);
        expect(plan.payload.playerHealing).toBe(9);
        expect(plan.payload.characterUpdates.classResources.secondWind).toEqual({ used: 1, max: 1 });
        const note = plan.payload.result.events.find(e => e.type === 'note' && /Second Wind/.test(e.text));
        expect(note.text).toContain('**9 HP**');
        expect(note.text).toContain('bonus action');
        expect(plan.payload.enemies[0].hp).toBe(1);
    });

    it('stands alone as a complete turn — the fighter catches their breath, foes still act', () => {
        rollQueue.push(5, 1); // heal d10=5 (+2), goblin nat 1 miss
        const plan = planCombatExchange(fighterState(), normalizeCombatExchange({
            player_slots: [{ action: 'second_wind' }],
            enemy_intents: [{ enemy_id: 'Goblin', action: 'attack', target: 'player' }],
        }));

        expect(plan.ok).toBe(true);
        expect(plan.payload.playerHealing).toBe(7);
        expect(plan.payload.result.terminal).toBeNull();
    });

    it('rides alongside both Action Surge slots (three-slot envelope)', () => {
        rollQueue.push(4, 15, 5, 14, 4); // heal, hit+damage (8), hit+damage (7) — goblin down before its slot
        const plan = planCombatExchange(fighterState({ pendingActionSurge: true }), normalizeCombatExchange({
            player_slots: [
                { action: 'second_wind' },
                { action: 'attack', strikes: [{ target: 'Goblin' }] },
                { action: 'attack', strikes: [{ target: 'Goblin' }] },
            ],
            enemy_intents: [{ enemy_id: 'Goblin', action: 'attack', target: 'player' }],
        }));

        expect(plan.ok).toBe(true);
        expect(plan.payload.playerHealing).toBe(6);
        expect(plan.payload.consumeActionSurge).toBe(true);
        expect(plan.payload.result.terminal).toBe('victory');
    });

    it('rejects a spent Second Wind before any dice exist', () => {
        const plan = planCombatExchange(
            fighterState({ classResources: { secondWind: { used: 1, max: 1 } } }),
            normalizeCombatExchange({ player_slots: [{ action: 'second_wind' }] })
        );
        expect(plan).toMatchObject({ ok: false, error: expect.stringContaining('already spent') });
        expect(rollQueue).toHaveLength(0);
    });

    it('rejects Second Wind for a character without the resource', () => {
        const plan = planCombatExchange(
            state({ character: { class: 'wizard', classResources: {} } }),
            normalizeCombatExchange({ player_slots: [{ action: 'second_wind' }] })
        );
        expect(plan).toMatchObject({ ok: false, error: expect.stringContaining('does not have') });
    });

    it('rejects Second Wind when the bonus action is already used this turn', () => {
        const plan = planCombatExchange(
            fighterState({}, { bonusActionUsed: true }),
            normalizeCombatExchange({ player_slots: [{ action: 'second_wind' }] })
        );
        expect(plan).toMatchObject({ ok: false, error: expect.stringContaining('bonus action is already used') });
    });

    it('a dying fighter cannot slip Second Wind beside the death save', () => {
        const plan = planCombatExchange(
            fighterState({ dying: true, currentHP: 0 }),
            normalizeCombatExchange({ player_slots: [{ action: 'second_wind' }, { action: 'death_save' }] })
        );
        expect(plan).toMatchObject({ ok: false, error: expect.stringContaining('death saving throw') });
    });
});
