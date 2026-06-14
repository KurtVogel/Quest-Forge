/**
 * Tests for roll resolution with deterministic dice — death save thresholds,
 * saving-throw proficiency wiring, and automatic condition advantage/disadvantage.
 * The dice module is mocked with a queue so outcomes are scripted, not random.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { resolveRolls } from './rollResolver.js';

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

const messagesFrom = (dispatch) => dispatch.mock.calls
    .filter(([a]) => a.type === 'ADD_MESSAGE')
    .map(([a]) => a.payload.content)
    .join('\n');

beforeEach(() => { rollQueue.length = 0; });

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
