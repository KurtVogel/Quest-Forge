/**
 * Roll-resolution hostile-input pins (2026-09-10 audit): the death-save chat
 * mirror reads the same typed tally as the reducer, the hero's DM-supplied
 * damage fallback passes the NPC lane's band check, and a skill-less roll is
 * skipped VISIBLY instead of vanishing.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { resolveRolls } from './rollResolver.js';

const { rollQueue } = vi.hoisted(() => ({ rollQueue: [] }));

vi.mock('./dice.ts', () => {
    let id = 0;
    const makeResult = (rolls, modifier, description) => {
        const subtotal = rolls.reduce((a, b) => a + b, 0);
        return {
            id: `test-roll-${++id}`, timestamp: 0, notation: '', dice: { count: rolls.length, sides: 20 },
            rolls, subtotal, modifier, total: subtotal + modifier, description,
            isCritical: rolls.length === 1 && rolls[0] === 20, isCritFail: rolls.length === 1 && rolls[0] === 1,
        };
    };
    const draw = () => {
        if (!rollQueue.length) throw new Error('dice queue exhausted — a test under-queued its rolls');
        return rollQueue.shift();
    };
    const parseNotation = (notation) => {
        const m = String(notation).replace(/\s+/g, '').match(/^(\d+)d(\d+)([+-]\d+)?$/i);
        if (!m) throw new Error(`Invalid dice notation: "${notation}"`);
        return { count: parseInt(m[1], 10), sides: parseInt(m[2], 10), modifier: m[3] ? parseInt(m[3], 10) : 0 };
    };
    return {
        rollWithModifier: (count, sides, modifier = 0, description = '') => makeResult(Array.from({ length: count }, draw), modifier, description),
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
        name: 'Testo', class: 'fighter', level: 5, currentHP: 12, maxHP: 40,
        abilityScores: { strength: 16, dexterity: 12, constitution: 14, intelligence: 10, wisdom: 10, charisma: 8 },
        savingThrowProficiencies: ['strength', 'constitution'], skillProficiencies: [], conditions: [],
        ...overrides,
    };
}

function run(rolls, ctx = {}) {
    const dispatch = vi.fn();
    const character = makeCharacter(ctx.character || {});
    const { results } = resolveRolls(rolls, {
        character, inventory: ctx.inventory || [], party: ctx.party || [], dispatch,
    });
    return { results, dispatch };
}

const messagesFrom = (dispatch) => dispatch.mock.calls
    .filter(([a]) => a.type === 'ADD_MESSAGE')
    .map(([a]) => a.payload.content)
    .join('\n');

beforeEach(() => { rollQueue.length = 0; });

describe('death-save mirror reads a typed tally', () => {
    const dyingChar = { currentHP: 0, dying: true, conditions: ['Unconscious'] };

    it('a string failure tally + a 5 is ONE more failure — never "the player is dead"', () => {
        rollQueue.push(5);
        const { results, dispatch } = run([{ type: 'death_save' }], { character: { ...dyingChar, deathSaves: { successes: '2', failures: '1' } } });
        expect(results[0]).toMatchObject({ outcome: 'failure', failures: 2, successes: 2 });
        // The shared countdown line names the death that is one failure away
        // ("One more and X dies." — WOW 2026-09-30); what must never appear is
        // the death itself.
        const line = messagesFrom(dispatch);
        expect(line).toContain('failure (2/3). One more and');
        expect(line).not.toContain('THE THIRD FAILURE');
        expect(line).not.toMatch(/is dead|character dies/i);
    });

    it('a negative tally clamps to zero before the die applies', () => {
        rollQueue.push(1);
        const { results } = run([{ type: 'death_save' }], { character: { ...dyingChar, deathSaves: { successes: 0, failures: -1000 } } });
        expect(results[0]).toMatchObject({ outcome: 'failure', failures: 2 });
    });
});

describe('a hero attack never rolls a wire damage notation', () => {
    // The inline-damage lane needed a tracked enemy, and none exists outside a
    // fight (2026-10-05): a hostile "100d1000+3" is not band-checked any more —
    // it is not read at all.
    it('"100d1000+3" beside an out-of-combat attack draws ONE die: the d20', () => {
        rollQueue.push(18);
        // Level 2: a level-5 fighter's Extra Attack would draw a second d20.
        const { results } = run([{ type: 'attack_roll', skill: 'attack', target: 'gob', dc: 10, damage: '100d1000+3' }], { character: { level: 2 } });
        expect(results[0].success).toBe(true);
        expect(results[0].damage).toBeUndefined();
        expect(rollQueue).toHaveLength(0);
    });
});

describe('a skill-less player roll is skipped visibly', () => {
    it('produces no result (the set-aside still fires) but posts a system line', () => {
        const { results, dispatch } = run([{ type: 'skill_check', skill: null, ability: null, dc: 12, description: 'Notice the ambush' }]);
        expect(results).toHaveLength(0);
        expect(messagesFrom(dispatch)).toContain('Roll skipped');
        expect(messagesFrom(dispatch)).toContain('Notice the ambush');
        expect(rollQueue).toHaveLength(0);
    });
});
