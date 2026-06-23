/**
 * Tests for roll resolution with deterministic dice — death save thresholds,
 * saving-throw proficiency wiring, and automatic condition advantage/disadvantage.
 * The dice module is mocked with a queue so outcomes are scripted, not random.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { canonicalizeCombatRollBatch, handleRequestedRolls, repairCombatRollBatch, resolveRolls, formatRollSummary } from './rollResolver.js';

const { rollQueue } = vi.hoisted(() => ({ rollQueue: [] }));

vi.mock('./dice.ts', () => {
    let id = 0;
    const makeResult = (rolls, modifier, description) => {
        const subtotal = rolls.reduce((a, b) => a + b, 0);
        return {
            id: `test-roll-${++id}`,
            timestamp: 0,
            notation: '',
            dice: { count: rolls.length, sides: 20 },
            rolls,
            subtotal,
            modifier,
            total: subtotal + modifier,
            description,
            isCritical: rolls.length === 1 && rolls[0] === 20,
            isCritFail: rolls.length === 1 && rolls[0] === 1,
        };
    };
    const draw = () => (rollQueue.length ? rollQueue.shift() : 10);
    const parseNotation = (notation) => {
        const m = String(notation).replace(/\s+/g, '').match(/^(\d+)d(\d+)([+-]\d+)?$/i);
        if (!m) throw new Error(`Invalid dice notation: "${notation}"`);
        return { count: parseInt(m[1], 10), sides: parseInt(m[2], 10), modifier: m[3] ? parseInt(m[3], 10) : 0 };
    };
    return {
        rollWithModifier: (count, sides, modifier = 0, description = '') =>
            makeResult(Array.from({ length: count }, draw), modifier, description),
        rollNotation: (notation, description = '') => {
            const { count, modifier } = parseNotation(notation);
            return makeResult(Array.from({ length: count }, draw), modifier, description);
        },
        parseNotation,
        rollDie: () => draw(),
        rollDice: (count) => Array.from({ length: count }, draw),
    };
});

function makeCharacter(overrides = {}) {
    return {
        name: 'Testo',
        class: 'fighter',
        level: 2,
        currentHP: 12,
        maxHP: 20,
        abilityScores: { strength: 16, dexterity: 12, constitution: 14, intelligence: 10, wisdom: 10, charisma: 8 },
        savingThrowProficiencies: ['strength', 'constitution'],
        skillProficiencies: [],
        conditions: [],
        ...overrides,
    };
}

function run(rolls, characterOverrides = {}) {
    const dispatch = vi.fn();
    const character = makeCharacter(characterOverrides);
    const { results } = resolveRolls(rolls, { character, inventory: [], combat: { enemies: [] }, party: [], dispatch });
    return { results, dispatch, character };
}

function runWithContext(rolls, ctx = {}) {
    const dispatch = vi.fn();
    const character = makeCharacter(ctx.character || {});
    const { results } = resolveRolls(rolls, {
        character,
        inventory: ctx.inventory || [],
        combat: ctx.combat || { enemies: [] },
        party: ctx.party || [],
        dispatch,
    });
    return { results, dispatch, character };
}

const messagesFrom = (dispatch) => dispatch.mock.calls
    .filter(([a]) => a.type === 'ADD_MESSAGE')
    .map(([a]) => a.payload.content)
    .join('\n');

beforeEach(() => { rollQueue.length = 0; });

describe('combat roll-batch safeguard', () => {
    const combat = {
        active: true,
        currentTurn: 0,
        turnOrder: [{ id: 'player', type: 'player', name: 'Testo', initiative: 18 }],
        enemies: [
            { id: 'chief', name: 'Chief Kraul', hp: 23, maxHp: 28, ac: 14, condition: 'healthy' },
            { id: 'runt', name: 'Goblin Runt', hp: 0, maxHp: 8, ac: 12, condition: 'dead' },
        ],
    };

    it('restores a declared player attack before an enemy-only batch', () => {
        const enemyRoll = { type: 'npc_attack', attackerId: 'chief', target: 'player', modifier: 4, damage: '1d8+2' };
        const result = repairCombatRollBatch([enemyRoll], {
            combat,
            character: makeCharacter(),
            playerAction: 'I attack it',
        });

        expect(result).toMatchObject({ repaired: true, blocked: false });
        expect(result.rolls).toEqual([
            expect.objectContaining({ type: 'attack_roll', skill: 'attack', target: 'chief', dc: 14 }),
            enemyRoll,
        ]);
    });

    it('restores both Attack actions when Action Surge is already active', () => {
        const result = repairCombatRollBatch(
            [{ type: 'npc_attack', attackerId: 'chief', target: 'player' }],
            {
                combat,
                character: makeCharacter({ pendingActionSurge: true }),
                playerAction: 'I attack again and use action surge',
            }
        );

        expect(result.rolls.filter(roll => roll.type === 'attack_roll')).toHaveLength(2);
        expect(result.rolls.slice(0, 2).every(roll => roll.target === 'chief')).toBe(true);
    });

    it('repairs an attack_roll missing skill and target instead of silently dropping it', () => {
        const malformedAttack = { type: 'attack_roll', skill: null, target: null, description: 'Sword strike' };
        const enemyRoll = { type: 'npc_attack', attackerId: 'chief', target: 'player', damage: '1d8+2' };
        const result = repairCombatRollBatch([malformedAttack, enemyRoll], {
            combat,
            character: makeCharacter(),
            playerAction: 'I attack the ghoul again',
        });

        expect(result).toMatchObject({ repaired: true, blocked: false });
        expect(result.rolls).toHaveLength(2);
        expect(result.rolls[0]).toMatchObject({
            type: 'attack_roll',
            skill: 'attack',
            target: 'chief',
            dc: 14,
            description: 'Sword strike',
        });
    });

    it('never runs repaired legacy batches during active combat', async () => {
        rollQueue.push(12, 12);
        const dispatch = vi.fn();
        const sendToLLM = vi.fn().mockResolvedValue({ requestedRolls: [] });

        const outcome = await handleRequestedRolls(
            [
                { type: 'attack_roll', skill: null, target: null, description: 'Vesa sword strike' },
                { type: 'npc_attack', attackerId: 'chief', attacker: 'Chief Kraul', target: 'player' },
            ],
            {
                getState: () => ({ character: makeCharacter(), inventory: [], combat, party: [] }),
                dispatch,
                sendToLLM,
                playerAction: 'I attack it again',
            }
        );

        expect(outcome).toEqual({ resolved: false, requiresCombatExchange: true });
        expect(dispatch).not.toHaveBeenCalled();
        expect(sendToLLM).not.toHaveBeenCalled();
    });

    it('does not treat a damage roll as the player attack that must precede an enemy', () => {
        const damageOnly = { type: 'damage_roll', notation: '1d8+3', description: 'Sword damage' };
        const enemyRoll = { type: 'npc_attack', attackerId: 'chief', target: 'player', damage: '1d8+2' };
        const result = repairCombatRollBatch([damageOnly, enemyRoll], {
            combat,
            character: makeCharacter(),
            playerAction: 'I attack again',
        });

        expect(result.repaired).toBe(true);
        expect(result.rolls.filter(roll => roll.type === 'attack_roll')).toEqual([
            expect.objectContaining({ skill: 'attack', target: 'chief', dc: 14 }),
        ]);
    });

    it('restores a missing second Action Surge attack when only one was requested', () => {
        const firstAttack = { type: 'attack_roll', skill: 'attack', target: 'chief', dc: 14 };
        const enemyRoll = { type: 'npc_attack', attackerId: 'chief', target: 'player' };
        const result = repairCombatRollBatch([firstAttack, enemyRoll], {
            combat,
            character: makeCharacter({ pendingActionSurge: true }),
            playerAction: 'I attack with action surge',
        });

        expect(result.repaired).toBe(true);
        expect(result.rolls.filter(roll => roll.type === 'attack_roll')).toHaveLength(2);
    });

    it('does not invent a target when multiple living enemies remain unnamed', () => {
        const ambiguousCombat = {
            ...combat,
            enemies: [
                ...combat.enemies,
                { id: 'archer', name: 'Goblin Archer', hp: 7, maxHp: 7, ac: 13, condition: 'healthy' },
            ],
        };
        const enemyRolls = [{ type: 'npc_attack', attackerId: 'chief', target: 'player' }];
        const result = repairCombatRollBatch(enemyRolls, {
            combat: ambiguousCombat,
            character: makeCharacter(),
            playerAction: 'I attack it',
        });

        expect(result).toEqual({ rolls: [], repaired: false, blocked: true });
    });

    it.each(['I cut at the chief', 'I hew the chief', 'I thrust at the chief', 'I chop the chief down', 'I lunge at the chief'])(
        'recognizes the attack verb in %p and restores the omitted player attack',
        (playerAction) => {
            const enemyRoll = { type: 'npc_attack', attackerId: 'chief', target: 'player', modifier: 4, damage: '1d8+2' };
            const result = repairCombatRollBatch([enemyRoll], { combat, character: makeCharacter(), playerAction });
            expect(result.repaired).toBe(true);
            expect(result.rolls[0]).toMatchObject({ type: 'attack_roll', skill: 'attack', target: 'chief' });
        }
    );

    it('leaves a complete batch unchanged', () => {
        const complete = [
            { type: 'attack_roll', skill: 'attack', target: 'chief' },
            { type: 'npc_attack', attackerId: 'chief', target: 'player' },
        ];
        expect(repairCombatRollBatch(complete, {
            combat,
            character: makeCharacter(),
            playerAction: 'I attack it',
        })).toEqual({ rolls: complete, repaired: false, blocked: false });
    });

    it('puts Action Surge attacks first and allows Kraul only one attack in the exchange', () => {
        const firstEnemyAttack = { type: 'npc_attack', attacker: 'Chief Kraul', target: 'player' };
        const firstPlayerAttack = { type: 'attack_roll', skill: 'attack', target: 'chief', description: 'First strike' };
        const secondPlayerAttack = { type: 'attack_roll', skill: 'attack', target: 'chief', description: 'Action Surge strike' };
        const duplicateEnemyAttack = { type: 'npc_attack', attackerId: 'chief', target: 'player', description: 'Counterattack' };

        const result = canonicalizeCombatRollBatch([
            firstEnemyAttack,
            firstPlayerAttack,
            secondPlayerAttack,
            duplicateEnemyAttack,
        ], combat);

        expect(result.rolls).toEqual([firstPlayerAttack, secondPlayerAttack, firstEnemyAttack]);
        expect(result.droppedEnemyAttacks).toBe(1);

        const chainedDuplicate = canonicalizeCombatRollBatch(
            [duplicateEnemyAttack],
            combat,
            result.enemyAttackersSeen
        );
        expect(chainedDuplicate.rolls).toEqual([]);
        expect(chainedDuplicate.droppedEnemyAttacks).toBe(1);
    });

    it('does not advance or roll enemies when the missing target is ambiguous', async () => {
        const dispatch = vi.fn();
        const ambiguousCombat = {
            ...combat,
            enemies: [
                ...combat.enemies,
                { id: 'archer', name: 'Goblin Archer', hp: 7, maxHp: 7, ac: 13, condition: 'healthy' },
            ],
        };
        const sendToLLM = vi.fn();

        const outcome = await handleRequestedRolls(
            [{ type: 'npc_attack', attackerId: 'chief', target: 'player' }],
            {
                getState: () => ({ character: makeCharacter(), inventory: [], combat: ambiguousCombat, party: [] }),
                dispatch,
                sendToLLM,
                playerAction: 'I attack it',
            }
        );

        expect(outcome).toEqual({ resolved: false, requiresCombatExchange: true });
        expect(sendToLLM).not.toHaveBeenCalled();
        expect(dispatch).not.toHaveBeenCalled();
    });

    it('does not process a chained legacy enemy attack in active combat', async () => {
        const dispatch = vi.fn();
        const sendToLLM = vi.fn().mockResolvedValue({ requestedRolls: [] });

        await handleRequestedRolls(
            [{ type: 'npc_attack', attackerId: 'chief', target: 'player' }],
            {
                getState: () => ({ character: makeCharacter(), inventory: [], combat, party: [] }),
                dispatch,
                sendToLLM,
                enemyAttackersSeen: new Set(['enemy:chief']),
            }
        );

        expect(dispatch).not.toHaveBeenCalled();
        expect(sendToLLM).not.toHaveBeenCalled();
    });
});

describe('active-combat isolation from the legacy roll resolver', () => {
    const playerTurnCombat = (enemies) => ({
        active: true,
        round: 1,
        currentTurn: 0,
        turnOrder: [{ id: 'player', type: 'player', name: 'Testo', initiative: 18 }],
        enemies,
    });

    it('rejects all legacy requested_rolls during active combat', async () => {
        const dispatch = vi.fn();
        const sendToLLM = vi.fn();
        const combat = playerTurnCombat([
            { id: 'gob', name: 'Goblin', hp: 7, maxHp: 7, ac: 13, attackBonus: 4, damage: '1d6+2', condition: 'healthy' },
        ]);
        const outcome = await handleRequestedRolls(
            [
                { type: 'attack_roll', skill: 'attack', target: 'gob', dc: 13 },
                { type: 'npc_attack', attackerId: 'gob', target: 'player', modifier: 99, damage: '50d100' },
            ],
            {
                getState: () => ({ character: makeCharacter(), inventory: [], combat, party: [] }),
                dispatch,
                sendToLLM,
                playerAction: 'I attack the goblin',
            }
        );
        expect(outcome).toEqual({ resolved: false, requiresCombatExchange: true });
        expect(sendToLLM).not.toHaveBeenCalled();
        expect(dispatch).not.toHaveBeenCalled();
    });
});

describe('player attack uses live enemy AC, not the DM dc', () => {
    it('hits an AC-11 foe on a roll that beats AC but not the bogus DM dc', () => {
        rollQueue.push(10, 3); // attack die 10 (+bonus beats AC 11), damage die
        const enemy = { id: 'gob', name: 'Goblin', hp: 7, maxHp: 7, ac: 11, condition: 'healthy' };
        const inventory = [{ type: 'weapon', category: 'martialMelee', name: 'Longsword', damage: '1d8', equipped: true }];
        const { results } = runWithContext(
            [{ type: 'attack_roll', skill: 'attack', target: 'gob', dc: 99, description: 'Strike' }],
            { combat: { enemies: [enemy] }, inventory }
        );
        // Resolved against the enemy's real AC (11), not the DM's dc: 99.
        expect(results[0].dc).toBe(11);
        expect(results[0].success).toBe(true);
    });

    it('falls back to roll.dc when the attack has no tracked enemy target', () => {
        rollQueue.push(20); // arbitrary
        const { results } = runWithContext(
            [{ type: 'attack_roll', skill: 'attack', dc: 15, description: 'Smash the door' }],
            { combat: { enemies: [] } }
        );
        expect(results[0].dc).toBe(15);
    });
});

describe('death saves', () => {
    const dyingChar = { currentHP: 0, dying: true, deathSaves: { successes: 0, failures: 0 }, conditions: ['Unconscious'] };

    it('10+ is a success and dispatches DEATH_SAVE_RESULT', () => {
        rollQueue.push(15);
        const { results, dispatch } = run([{ type: 'death_save' }], dyingChar);
        expect(results[0]).toMatchObject({ type: 'death_save', rolled: 15, outcome: 'success', successes: 1 });
        expect(dispatch).toHaveBeenCalledWith({ type: 'DEATH_SAVE_RESULT', payload: { die: 15 } });
    });

    it('below 10 is a failure; natural 1 counts twice', () => {
        rollQueue.push(7);
        expect(run([{ type: 'death_save' }], dyingChar).results[0]).toMatchObject({ outcome: 'failure', failures: 1 });
        rollQueue.push(1);
        expect(run([{ type: 'death_save' }], dyingChar).results[0]).toMatchObject({ outcome: 'failure', failures: 2 });
    });

    it('natural 20 revives', () => {
        rollQueue.push(20);
        expect(run([{ type: 'death_save' }], dyingChar).results[0].outcome).toBe('revived');
    });

    it('third success stabilizes, third failure kills', () => {
        rollQueue.push(11);
        expect(run([{ type: 'death_save' }], { ...dyingChar, deathSaves: { successes: 2, failures: 0 } }).results[0].outcome).toBe('stable');
        rollQueue.push(2);
        expect(run([{ type: 'death_save' }], { ...dyingChar, deathSaves: { successes: 0, failures: 2 } }).results[0].outcome).toBe('dead');
    });

    it('does not roll death saves for protected low-level defeat', () => {
        rollQueue.push(1);
        const { results, dispatch } = run(
            [{ type: 'death_save' }],
            { currentHP: 0, dying: false, lowLevelDefeat: true, conditions: ['Unconscious'] }
        );
        expect(results[0]).toMatchObject({
            type: 'note',
            text: expect.stringContaining('No death saving throw is rolled'),
        });
        expect(dispatch).not.toHaveBeenCalledWith({ type: 'DEATH_SAVE_RESULT', payload: { die: 1 } });
    });
});

describe('saving throws', () => {
    it('applies save proficiency (CON +2 mod, +2 prof at level 2)', () => {
        rollQueue.push(10);
        const { results } = run([{ type: 'saving_throw', skill: 'constitution', dc: 13 }]);
        expect(results[0]).toMatchObject({ rolled: 14, success: true });
    });

    it('uses the bare ability modifier without proficiency (DEX +1)', () => {
        rollQueue.push(10);
        const { results } = run([{ type: 'saving_throw', skill: 'dexterity', dc: 13 }]);
        expect(results[0]).toMatchObject({ rolled: 11, success: false });
    });
});

describe('condition effects on rolls', () => {
    it('applies explicit advantage to an outside-combat skill check', () => {
        rollQueue.push(4, 17); // advantage keeps 17; CHA -1 => 16
        const { results, dispatch } = run([
            { type: 'skill_check', skill: 'persuasion', dc: 12, advantage: true, description: 'Use the evidence convincingly' },
        ]);
        expect(results[0]).toMatchObject({ rolled: 16, success: true });
        expect(messagesFrom(dispatch)).toContain('advantage');
        expect(messagesFrom(dispatch)).toContain('kept 17');
    });

    it('poisoned imposes disadvantage on checks (two dice, lower kept)', () => {
        rollQueue.push(18, 6); // disadvantage keeps the 6
        const { results, dispatch } = run(
            [{ type: 'skill_check', skill: 'stealth', dc: 12 }],
            { conditions: ['Poisoned'] }
        );
        expect(results[0].rolled).toBe(7); // 6 + DEX 1
        expect(messagesFrom(dispatch)).toContain('poisoned');
        expect(messagesFrom(dispatch)).toContain('disadvantage');
    });

    it('poisoned does not affect saving throws', () => {
        rollQueue.push(10);
        const { results } = run(
            [{ type: 'saving_throw', skill: 'constitution', dc: 13 }],
            { conditions: ['Poisoned'] }
        );
        expect(results[0].rolled).toBe(14); // single die, no disadvantage
    });

    it('explicit advantage + condition disadvantage cancel to one die', () => {
        rollQueue.push(9);
        const { results } = run(
            [{ type: 'skill_check', skill: 'stealth', dc: 12, advantage: true }],
            { conditions: ['Poisoned'] }
        );
        expect(results[0].rolled).toBe(10); // straight roll: 9 + DEX 1
    });

    it('enemies attack a prone player with advantage', () => {
        rollQueue.push(5, 17); // advantage keeps the 17
        const { results, dispatch } = run(
            [{ type: 'npc_attack', attacker: 'Goblin', target: 'player', modifier: 2 }],
            { conditions: ['Prone'] }
        );
        // 17 + 2 = 19 vs live AC (10 + DEX 1 = 11, no armor equipped)
        expect(results[0]).toMatchObject({ rolled: 19, success: true });
        expect(messagesFrom(dispatch)).toContain('prone');
    });

    it('attacks against an invisible player have disadvantage', () => {
        rollQueue.push(15, 4); // disadvantage keeps the 4
        const { results } = run(
            [{ type: 'npc_attack', attacker: 'Goblin', target: 'player', modifier: 2 }],
            { conditions: ['Invisible'] }
        );
        expect(results[0]).toMatchObject({ rolled: 6, success: false });
    });
});

describe('companion attacks', () => {
    it('rolls companion attacks and applies enemy HP on a hit', () => {
        rollQueue.push(14, 5); // attack 14 + 4 = 18; damage 1d8+2 = 7
        const enemy = { id: 'enemy-1', name: 'Goblin', hp: 12, maxHp: 12, ac: 13, condition: 'healthy' };
        const companion = {
            id: 'companion-1',
            name: 'Garrick',
            hp: 18,
            maxHp: 18,
            ac: 14,
            attackBonus: 4,
            damage: '1d8+2',
            status: 'healthy',
        };

        const { results, dispatch } = runWithContext(
            [{ type: 'companion_attack', attackerId: companion.id, target: enemy.id, description: 'Garrick cuts at the goblin' }],
            { combat: { enemies: [enemy] }, party: [companion] }
        );

        expect(results[0]).toMatchObject({
            type: 'companion_attack',
            rolled: 18,
            success: true,
            damage: 7,
            targetHp: 5,
        });
        expect(dispatch).toHaveBeenCalledWith({
            type: 'UPDATE_ENEMY',
            payload: { id: enemy.id, hp: 5 },
        });
    });

    it('does not let a downed companion act', () => {
        const { results, dispatch } = runWithContext(
            [{ type: 'companion_attack', attackerId: 'companion-1', target: 'enemy-1' }],
            {
                combat: { enemies: [{ id: 'enemy-1', name: 'Goblin', hp: 12, maxHp: 12, ac: 13 }] },
                party: [{ id: 'companion-1', name: 'Garrick', hp: 0, maxHp: 18, status: 'downed' }],
            }
        );

        expect(results[0]).toMatchObject({ type: 'note', text: expect.stringContaining('cannot act') });
        expect(dispatch).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'UPDATE_ENEMY' }));
    });
});

describe('fighter fighting styles in roll resolution', () => {
    it('rerolls 1s and 2s on two-handed melee damage for Great Weapon Fighting', () => {
        rollQueue.push(10, 1, 2, 5, 6); // attack, two damage dice, then two rerolls
        const enemy = { id: 'enemy-1', name: 'Ogre', hp: 30, maxHp: 30, ac: 10, condition: 'healthy' };
        const inventory = [{
            type: 'weapon',
            category: 'martialMelee',
            name: 'Greatsword',
            damage: '2d6',
            twoHanded: true,
            equipped: true,
        }];

        const { results, dispatch } = runWithContext(
            [{ type: 'attack_roll', skill: 'attack', target: enemy.id, dc: enemy.ac }],
            {
                character: { fightingStyle: 'greatWeaponFighting' },
                combat: { enemies: [enemy] },
                inventory,
            }
        );

        expect(results[0]).toMatchObject({ type: 'attack_roll', success: true, damage: 15, targetHp: 15 });
        expect(messagesFrom(dispatch)).toContain('Great Weapon Fighting rerolls: 1->5, 2->6');
    });
});

describe('fighter Champion archetype', () => {
    it('makes a level 3 Champion crit on a natural 19 and doubles damage dice', () => {
        rollQueue.push(19, 4, 5); // attack, crit damage dice
        const enemy = { id: 'enemy-1', name: 'Ogre', hp: 20, maxHp: 20, ac: 30, condition: 'healthy' };
        const inventory = [{
            type: 'weapon',
            category: 'martialMelee',
            name: 'Longsword',
            damage: '1d8',
            equipped: true,
        }];

        const { results, dispatch } = runWithContext(
            [{ type: 'attack_roll', skill: 'attack', target: enemy.id, dc: enemy.ac }],
            {
                character: { level: 3, martialArchetype: 'champion' },
                combat: { enemies: [enemy] },
                inventory,
            }
        );

        expect(results[0]).toMatchObject({
            success: true,
            critical: true,
            damage: 14, // (4 + 5) crit dice + STR 3 + Fighter level bonus 2
            targetHp: 6,
        });
        expect(messagesFrom(dispatch)).toContain('Champion critical on natural 19');
        expect(messagesFrom(dispatch)).toContain('crit — dice doubled');
    });

    it('does not make a non-Champion natural 19 auto-hit', () => {
        rollQueue.push(19);
        const enemy = { id: 'enemy-1', name: 'Ogre', hp: 20, maxHp: 20, ac: 30, condition: 'healthy' };

        const { results, dispatch } = runWithContext(
            [{ type: 'attack_roll', skill: 'attack', target: enemy.id, dc: enemy.ac }],
            {
                character: { level: 3, martialArchetype: null },
                combat: { enemies: [enemy] },
                inventory: [{ type: 'weapon', category: 'martialMelee', damage: '1d8', equipped: true }],
            }
        );

        expect(results[0]).toMatchObject({ success: false, critical: false });
        expect(dispatch).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'UPDATE_ENEMY' }));
    });
});

describe('legacy combat roll isolation', () => {
    it('does not ask the DM to close combat from legacy attack rolls', async () => {
        rollQueue.push(18, 6);
        const enemy = { id: 'enemy-1', name: 'Goblin', hp: 6, maxHp: 6, ac: 13, condition: 'healthy' };
        const dispatch = vi.fn();
        const sendToLLM = vi.fn().mockResolvedValue({ requestedRolls: [] });

        await handleRequestedRolls(
            [{ type: 'attack_roll', skill: 'attack', target: enemy.id, dc: enemy.ac, damage: '1d8+3', description: 'Astra cuts at the goblin' }],
            {
                getState: () => ({
                    character: makeCharacter(),
                    inventory: [{ type: 'weapon', category: 'martialMelee', name: 'Longsword', damage: '1d8', equipped: true }],
                    combat: { active: true, enemies: [enemy] },
                    party: [],
                }),
                dispatch,
                sendToLLM,
            }
        );

        expect(sendToLLM).not.toHaveBeenCalled();
        expect(dispatch).not.toHaveBeenCalled();
    });
});

describe('natural 20 out-of-combat checks', () => {
    it('forces a skill check to succeed on a natural 20 regardless of DC', () => {
        rollQueue.push(20); // natural 20
        const { results, dispatch } = run(
            [{ type: 'skill_check', skill: 'athletics', dc: 30 }]
        );
        expect(results[0]).toMatchObject({
            success: true,
            critical: true,
            rolled: 23, // 20 + athletics mod (+3)
        });
        expect(messagesFrom(dispatch)).toContain('Natural 20!');
    });

    it('formats a natural 20 skill check outcome as a CRITICAL SUCCESS in the roll summary', () => {
        const summary = formatRollSummary([{
            type: 'skill_check',
            skill: 'stealth',
            dc: 25,
            rolled: 22,
            success: true,
            critical: true,
            description: 'Sneak past the giant',
        }]);
        expect(summary).toContain('SUCCESS (CRITICAL SUCCESS / NATURAL 20)');
    });
});

describe('Rogue Sneak Attack (out-of-combat)', () => {
    it('applies Sneak Attack damage on a hit with a finesse weapon when having advantage', () => {
        const rogue = {
            class: 'rogue',
            level: 3, // Sneak Attack is 2d6
            abilityScores: { strength: 10, dexterity: 16, constitution: 12, intelligence: 10, wisdom: 10, charisma: 10 },
            conditions: [],
        };
        const inventory = [
            { id: 'rapier', type: 'weapon', finesse: true, damage: '1d8', equipped: true },
        ];
        // We need:
        // 1. To-hit roll: d20 = 15 (success)
        // 2. Weapon damage roll: 1d8 = 5
        // 3. Sneak Attack rolls: 2d6 = 3, 4
        rollQueue.push(15, 5); // to-hit (advantage draws two)
        rollQueue.push(5);     // weapon damage
        rollQueue.push(3, 4);  // sneak attack rolls (2d6)

        const dispatch = vi.fn();
        const { results } = resolveRolls(
            [{ type: 'attack_roll', skill: 'attack', target: 'enemy-1', advantage: true }],
            {
                character: rogue,
                inventory,
                combat: {
                    enemies: [{ id: 'enemy-1', name: 'Orc', hp: 30, maxHp: 30, ac: 12 }]
                },
                party: [],
                dispatch,
            }
        );

        // Weapon damage (5) + DEX modifier (3) + Sneak Attack (7) = 15 total damage
        expect(results[0]).toMatchObject({
            success: true,
            damage: 15,
        });
        const msg = messagesFrom(dispatch);
        expect(msg).toContain('Sneak Attack');
        expect(msg).toContain('2d6');
    });
});
