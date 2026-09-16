/**
 * The promise in the outcome (WOW 2026-09-16, checks-and-consequence): the
 * card's stated failure stakes, the objective, and the roll margin ride the
 * [ROLL RESULT] line into the post-roll prompt. Pass/fail is untouched — the
 * bands are narration texture, and a natural 1 is never incompetence
 * (DECISIONS.md 2026-06-22).
 */
import { describe, it, expect, vi } from 'vitest';
import { resolveRolls, formatRollSummary } from './rollResolver.js';

const { rollQueue } = vi.hoisted(() => ({ rollQueue: [] }));

vi.mock('./dice.ts', () => {
    let id = 0;
    const draw = () => {
        if (!rollQueue.length) throw new Error('dice queue exhausted');
        return rollQueue.shift();
    };
    const makeResult = (rolls, modifier, description) => {
        const subtotal = rolls.reduce((a, b) => a + b, 0);
        return {
            id: `t-${++id}`, timestamp: 0, notation: '', dice: { count: rolls.length, sides: 20 },
            rolls, subtotal, modifier, total: subtotal + modifier, description,
            isCritical: rolls.length === 1 && rolls[0] === 20,
            isCritFail: rolls.length === 1 && rolls[0] === 1,
        };
    };
    return {
        rollWithModifier: (count, sides, modifier = 0, description = '') => makeResult(Array.from({ length: count }, draw), modifier, description),
        rollNotation: () => makeResult([draw()], 0, ''),
        parseNotation: () => ({ count: 1, sides: 6, modifier: 0 }),
        rollDie: () => draw(),
        rollDice: (count) => Array.from({ length: count }, draw),
    };
});

const character = {
    name: 'Testo', class: 'rogue', level: 1,
    abilityScores: { strength: 10, dexterity: 14, constitution: 10, intelligence: 10, wisdom: 10, charisma: 10 },
    skillProficiencies: [], expertiseSkills: [], savingThrowProficiencies: [], conditions: [],
};

function resolve(roll, die) {
    rollQueue.push(die);
    const { results } = resolveRolls([roll], { character, inventory: [], combat: { enemies: [] }, party: [], dispatch: vi.fn() });
    return results[0];
}

const stealth = {
    type: 'skill_check', skill: 'stealth', dc: 12,
    description: 'Slip past the patrol',
    failureStakes: 'The patrol notices the escape attempt.',
};

describe('resolvePlayerRoll carries the promise', () => {
    it('returns failureStakes, objective, margin, and the natural flags on a failure', () => {
        const r = resolve(stealth, 7); // 7 + 2 DEX = 9 vs DC 12
        expect(r).toMatchObject({ success: false, rolled: 9, margin: -3, failureStakes: 'The patrol notices the escape attempt.', objective: 'Slip past the patrol', naturalOne: false, naturalTwenty: false });
    });

    it('returns a positive margin on a success and flags a natural 20', () => {
        expect(resolve(stealth, 16)).toMatchObject({ success: true, margin: 6 });
        expect(resolve({ ...stealth, dc: 30 }, 20)).toMatchObject({ success: true, critical: true, naturalTwenty: true });
    });

    it('a natural 1 is flagged but pass/fail is still the total against the DC', () => {
        const r = resolve({ ...stealth, dc: 2 }, 1); // 1 + 2 = 3 >= 2: still a success
        expect(r).toMatchObject({ success: true, naturalOne: true, margin: 1 });
    });

    it('stakes are string-or-null', () => {
        expect(resolve({ ...stealth, failureStakes: { text: 'x' } }, 7).failureStakes).toBeNull();
    });
});

describe('formatRollSummary renders the promise and the margin', () => {
    const base = { type: 'skill_check', skill: 'stealth', dc: 12, description: 'Slip past the patrol', objective: 'Slip past the patrol', failureStakes: 'The patrol notices the escape attempt.' };

    it('failure by 3: quotes the stakes and demands exactly that consequence, one, then a live choice', () => {
        const line = formatRollSummary([{ ...base, rolled: 9, success: false, margin: -3 }]);
        expect(line).toBe('[ROLL RESULT: Slip past the patrol, DC 12, rolled 9 — FAILURE by 3. The ruling promised on failure: "The patrol notices the escape attempt.". Deliver exactly that consequence — one, proportionate — then a live choice.]');
    });

    it('near miss (short by 1-2) keeps a foothold; wide miss (5+) lands the stakes in full', () => {
        expect(formatRollSummary([{ ...base, rolled: 11, success: false, margin: -1 }])).toContain('FAILURE by 1 (near miss: the stated stakes land, but the hero keeps a foothold).');
        expect(formatRollSummary([{ ...base, rolled: 5, success: false, margin: -7 }])).toContain('FAILURE by 7 (wide miss: the stated stakes in full).');
    });

    it('natural 1 is the stakes plus one complication, never incompetence', () => {
        const line = formatRollSummary([{ ...base, rolled: 3, success: false, margin: -9, naturalOne: true }]);
        expect(line).toContain('NATURAL 1: the stakes plus ONE complication — never incompetence');
        expect(line).toContain('The ruling promised on failure: "The patrol notices the escape attempt."');
    });

    it('a failure with no stated stakes still demands one proportionate consequence', () => {
        const line = formatRollSummary([{ ...base, failureStakes: null, rolled: 9, success: false, margin: -3 }]);
        expect(line).toContain('No failure stakes were stated on the ruling — deliver ONE proportionate consequence, then a live choice.');
    });

    it('success by 6: delivers the win the ruling promised for the objective', () => {
        const line = formatRollSummary([{ ...base, rolled: 18, success: true, margin: 6 }]);
        expect(line).toBe('[ROLL RESULT: Slip past the patrol, DC 12, rolled 18 — SUCCESS by 6 (clean). Deliver the win the ruling promised for "Slip past the patrol" concretely.]');
    });

    it('a narrow success says so; a natural 20 keeps its critical verb without a texture', () => {
        expect(formatRollSummary([{ ...base, rolled: 12, success: true, margin: 0 }])).toContain('SUCCESS by 0 (narrow — the win holds, but only just).');
        const crit = formatRollSummary([{ ...base, rolled: 22, success: true, critical: true, margin: 10 }]);
        expect(crit).toContain('SUCCESS (CRITICAL SUCCESS / NATURAL 20) by 10. Deliver the win');
        expect(crit).not.toContain('(clean)');
    });

    it('bounds and single-lines the quoted texts', () => {
        const line = formatRollSummary([{ ...base, failureStakes: `a\n\n${'x'.repeat(400)}`, rolled: 9, success: false, margin: -3 }]);
        expect(line).not.toContain('\n');
        expect(line).toContain(`"a ${'x'.repeat(298)}"`);
    });

    it('a legacy result without a margin renders the old line unchanged; attacks never carry a promise', () => {
        expect(formatRollSummary([{ type: 'skill_check', skill: 'stealth', dc: 12, rolled: 9, success: false, description: 'Slip past the patrol' }]))
            .toBe('[ROLL RESULT: Slip past the patrol, DC 12, rolled 9 — FAILURE]');
        expect(formatRollSummary([{ type: 'attack_roll', dc: 14, rolled: 9, success: false, description: 'Swing', margin: -5, failureStakes: 'x' }]))
            .toBe('[ROLL RESULT: Swing, vs AC 14, rolled 9 — MISS]');
    });
});
