/**
 * The 2026-10-18 roll-resolution queue (Lap 1 of the third cycle):
 *  - the hero's own actor gate on the out-of-combat check lane (a dying /
 *    stable / defeated / paralyzed hero rolls no check and swings no weapon;
 *    saving throws still roll; a dead hero rolls nothing);
 *  - `companion_attack` reads THE companion to-hit composer (stat + magic
 *    weapon), the number the exchange rolls with;
 *  - a notation-less `damage_roll` is dropped visibly, never a 1d4 printed as
 *    "(null)"; an unreadable notation says so;
 *  - the resolver's DC belts restate the parser's one default.
 * Dice are scripted through the queue mock the sibling file uses.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { resolveRolls, formatRollSummary } from './rollResolver.js';
import { companionAttackBonus, companionWeaponBonus } from './companionGear.js';
import { describeHeroCannotAct } from './combatPredicates.js';
import { DEFAULT_ROLL_DC } from '../config/contentLimits.js';

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
        name: 'Astra',
        class: 'fighter',
        level: 5, // Extra Attack: an ungated attack would draw TWO dice
        currentHP: 30,
        maxHP: 40,
        abilityScores: { strength: 16, dexterity: 12, constitution: 14, intelligence: 10, wisdom: 10, charisma: 8 },
        savingThrowProficiencies: ['strength', 'constitution'],
        skillProficiencies: ['athletics'],
        conditions: [],
        deathSaves: { successes: 0, failures: 0 },
        ...overrides,
    };
}

function run(rolls, { character = {}, party = [], inventory = [] } = {}) {
    const dispatch = vi.fn();
    const hero = makeCharacter(character);
    const { results } = resolveRolls(rolls, { character: hero, inventory, party, dispatch });
    const lines = dispatch.mock.calls.filter(([a]) => a.type === 'ADD_MESSAGE').map(([a]) => a.payload.content);
    const rolled = dispatch.mock.calls.filter(([a]) => a.type === 'ADD_ROLL').length;
    return { results, dispatch, lines, rolled };
}

beforeEach(() => { rollQueue.length = 0; });

const ATHLETICS = { type: 'skill_check', skill: 'athletics', dc: 12, description: 'Haul the gate chain' };
const ATTACK = { type: 'attack_roll', skill: 'attack', dc: 14, description: 'Cut the rope' };
const CON_SAVE = { type: 'saving_throw', skill: 'constitution', dc: 13, description: 'Resist the poison' };

describe('the hero actor gate on the check lane (roll-resolution P2, measured 2026-10-18)', () => {
    const states = {
        dying: { currentHP: 0, dying: true, conditions: ['Unconscious'], deathSaves: { successes: 0, failures: 1 } },
        stable: { currentHP: 0, dying: false, conditions: ['Unconscious'] },
        defeated: { currentHP: 0, lowLevelDefeat: true, level: 1 },
        paralyzed: { currentHP: 30, conditions: ['paralyzed'] },
    };

    for (const [name, character] of Object.entries(states)) {
        it(`a ${name} hero rolls no check: no die, a visible "Roll skipped" line, no result`, () => {
            const { results, lines, rolled } = run([ATHLETICS], { character });
            expect(results).toEqual([]);
            expect(rolled).toBe(0);
            expect(lines.join('\n')).toMatch(/\*\*Roll skipped:\*\* Astra is .* Haul the gate chain is not rolled/);
            expect(lines.join('\n')).toContain('saving throws still roll');
        });

        it(`a ${name} hero swings no weapon — neither Extra Attack strike is rolled`, () => {
            const { results, rolled } = run([ATTACK], { character });
            expect(results).toEqual([]);
            expect(rolled).toBe(0);
        });

        it(`a ${name} hero still rolls a saving throw (a CON save against poison while down is legitimate)`, () => {
            rollQueue.push(11);
            const { results, rolled } = run([CON_SAVE], { character });
            expect(rolled).toBe(1);
            expect(results[0]).toMatchObject({ type: 'saving_throw', dc: 13 });
        });
    }

    it('a dead hero rolls nothing — not even a save', () => {
        const { results, rolled, lines } = run([ATHLETICS, ATTACK, CON_SAVE], { character: { isDead: true, currentHP: 0 } });
        expect(results).toEqual([]);
        expect(rolled).toBe(0);
        expect(lines.filter(l => l.startsWith('**Roll skipped:** Astra is dead'))).toHaveLength(3);
    });

    it('a healthy hero is untouched by the gate: the check rolls at full modifier, the attack rolls both strikes', () => {
        rollQueue.push(10, 10, 10);
        const { results, rolled } = run([ATHLETICS, ATTACK]);
        expect(rolled).toBe(3);
        expect(results[0]).toMatchObject({ type: 'skill_check', rolled: 16, success: true }); // +3 STR +3 prof
        expect(results).toHaveLength(3);
    });

    it('the lone gated roll lands the proposal on the set-aside (the resolver returns no results)', () => {
        const { results } = run([ATHLETICS], { character: states.dying });
        expect(results).toHaveLength(0);
        expect(formatRollSummary(results)).toBe('');
    });

    it('describeHeroCannotAct names every state and reads null for a hero who can act', () => {
        expect(describeHeroCannotAct(makeCharacter(states.dying)).kind).toBe('dying');
        expect(describeHeroCannotAct(makeCharacter(states.stable)).kind).toBe('stable');
        expect(describeHeroCannotAct(makeCharacter(states.defeated)).kind).toBe('defeated');
        expect(describeHeroCannotAct(makeCharacter(states.paralyzed))).toMatchObject({ kind: 'condition', condition: 'paralyzed' });
        expect(describeHeroCannotAct(makeCharacter({ isDead: true })).kind).toBe('dead');
        expect(describeHeroCannotAct(makeCharacter())).toBeNull();
        expect(describeHeroCannotAct(null)).toBeNull();
    });
});

describe('companion_attack reads THE companion to-hit (stat + magic weapon) — roll-resolution P2, measured', () => {
    const bram = { id: 'c-bram', name: 'Bram', hp: 20, maxHp: 20, ac: 15, attackBonus: 4, weaponBonus: 2, status: 'active' };

    it('rolls Bram at +6 (attackBonus 4 + a +2 blade), the exchange\'s number — it used to roll +4', () => {
        rollQueue.push(10);
        const { results } = run([{ type: 'companion_attack', attackerId: 'c-bram', dc: 16, description: 'Bram hacks the rope' }], { party: [bram] });
        expect(results[0]).toMatchObject({ type: 'companion_attack', attacker: 'Bram', dc: 16, rolled: 16, success: true });
    });

    it('companionAttackBonus is the one composer: the exchange default (2) and the resolver fallback both go through it', () => {
        expect(companionAttackBonus(bram)).toBe(6);
        expect(companionAttackBonus({ attackBonus: '+4', weaponBonus: 1 })).toBe(5); // the numeric belt
        expect(companionAttackBonus({ weaponBonus: 2 })).toBe(4); // stat-less: the exchange's 2
        expect(companionAttackBonus({ weaponBonus: 2 }, 0)).toBe(2); // stat-less on the resolver with no DM number
        expect(companionAttackBonus({ attackBonus: 3, weaponBonus: 9 })).toBe(6); // the +3 ceiling
        expect(companionWeaponBonus({ weaponBonus: -2 })).toBe(0);
    });

    it('a +15 stat with a +3 blade is 18 — the engine\'s number is never re-judged against the DM band', () => {
        rollQueue.push(2);
        const { results } = run([{ type: 'companion_attack', attackerId: 'c-bram', dc: 20 }], { party: [{ ...bram, attackBonus: 15, weaponBonus: 3 }] });
        expect(results[0]).toMatchObject({ rolled: 20, success: true });
    });
});

describe('damage_roll honours its own drop rule (roll-resolution P2, nits)', () => {
    it('a notation-less damage roll is dropped with a visible line — no 1d4, no "(null)"', () => {
        const { results, lines, rolled } = run([{ type: 'damage_roll', notation: null, description: 'Falling rocks' }]);
        expect(results).toEqual([]);
        expect(rolled).toBe(0);
        expect(lines).toEqual(['**Roll skipped:** Falling rocks names no damage dice and could not be rolled.']);
        expect(lines.join('\n')).not.toContain('null');
    });

    it('an unreadable notation is dropped with a visible line naming the dice', () => {
        const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
        const { results, lines } = run([{ type: 'damage_roll', notation: 'banana d6', description: 'Nonsense' }]);
        expect(results).toEqual([]);
        expect(lines.join('\n')).toContain('**Roll skipped:** Nonsense — the damage dice "banana d6" could not be read.');
        errorSpy.mockRestore();
    });

    it('a real notation still rolls, and the chat line and summary print the notation', () => {
        rollQueue.push(3, 4);
        const { results, lines } = run([{ type: 'damage_roll', notation: '2d6', description: 'Falling rocks' }]);
        expect(results[0]).toMatchObject({ type: 'damage_roll', notation: '2d6', rolled: 7 });
        expect(lines.join('\n')).toContain('(2d6)');
        expect(formatRollSummary(results)).toContain('2d6');
    });
});

describe('the DC belts restate the parser\'s ONE default (roll-resolution P2, nits)', () => {
    it('an npc_save built without a dc reads DEFAULT_ROLL_DC (10), not the dead 12', () => {
        rollQueue.push(10);
        const { results } = run([{ type: 'npc_save', attacker: 'Cultist', description: 'Wisdom save' }]);
        expect(DEFAULT_ROLL_DC).toBe(10);
        expect(results[0]).toMatchObject({ type: 'npc_save', dc: DEFAULT_ROLL_DC, rolled: 10, success: true });
    });

    it('a hero check and a companion attack built without a dc read the same default', () => {
        rollQueue.push(7, 8);
        const { results } = run(
            [{ type: 'skill_check', skill: 'perception' }, { type: 'companion_attack', attackerId: 'c1' }],
            { party: [{ id: 'c1', name: 'Bo', hp: 9, maxHp: 9, ac: 12, attackBonus: 2, status: 'active' }] },
        );
        expect(results.map(r => r.dc)).toEqual([DEFAULT_ROLL_DC, DEFAULT_ROLL_DC]);
    });
});
