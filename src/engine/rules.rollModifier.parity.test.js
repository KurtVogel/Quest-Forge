/**
 * One modifier ladder, three lanes (2026-10-05 audit): the odds line on the
 * proposal card (`describeCheckOdds`), the out-of-combat resolver
 * (`resolveRolls`) and the combat exchange's check / save slots all read
 * `resolvePlayerRollModifier`. `rules.checkOdds.test.js` pins the CHANCE; this
 * file pins the thing it could not — that the modifier the card PRINTS is the
 * modifier the die GETS — by feeding the same rolls through all three.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { rollQueue } = vi.hoisted(() => ({ rollQueue: [] }));

vi.mock('./dice.ts', () => {
    let id = 0;
    const draw = () => {
        if (!rollQueue.length) throw new Error('dice queue exhausted — a test under-queued its rolls');
        return rollQueue.shift();
    };
    return {
        parseNotation: () => ({ count: 1, sides: 4, modifier: 0 }),
        rollWithModifier: (count, sides, modifier = 0, description = '') => {
            const rolls = Array.from({ length: count }, draw);
            const subtotal = rolls.reduce((sum, value) => sum + value, 0);
            return {
                id: `parity-roll-${++id}`, notation: `${count}d${sides}`, rolls, subtotal, modifier,
                total: subtotal + modifier, description,
                isCritical: count === 1 && sides === 20 && rolls[0] === 20,
                isCritFail: count === 1 && sides === 20 && rolls[0] === 1,
            };
        },
        rollDice: (count) => Array.from({ length: count }, draw),
    };
});

const { describeCheckOdds, resolvePlayerRollModifier } = await import('./rules.js');
const { resolveRolls } = await import('./rollResolver.js');
const { planCombatExchange } = await import('./combatExchange.js');
const { normalizeCombatExchange } = await import('./combatWire.js');
const { COMBAT_PHASES } = await import('./combatPredicates.js');

const hero = {
    name: 'Nix', class: 'rogue', level: 5, currentHP: 30, maxHP: 30, armorClass: 14,
    abilityScores: { strength: 8, dexterity: 18, constitution: 12, intelligence: 14, wisdom: 12, charisma: 10 },
    skillProficiencies: ['stealth', 'sleightOfHand', 'perception'],
    expertiseSkills: ['sleightOfHand'],
    savingThrowProficiencies: ['dexterity', 'intelligence'],
    conditions: [],
};
const inventory = [{ id: 'rapier', name: 'Rapier', type: 'weapon', category: 'martialMelee', damage: '1d8', finesse: true, equipped: true }];

const DIE = 10;
/** The modifier the out-of-combat resolver actually put on the d20. */
function resolverModifier(roll) {
    rollQueue.push(DIE);
    const { results } = resolveRolls([roll], { character: hero, inventory, party: [], dispatch: vi.fn() });
    return results[0].rolled - DIE;
}
/** The modifier the combat exchange actually put on the d20. */
function combatModifier(roll) {
    rollQueue.push(DIE);
    const plan = planCombatExchange({
        character: hero, inventory, party: [],
        combat: {
            active: true, phase: COMBAT_PHASES.AWAITING_PLAYER, round: 1,
            enemies: [{ id: 'gob', name: 'Goblin', hp: 10, maxHp: 10, ac: 12, condition: 'healthy', conditions: [], combatStatus: 'active' }],
            turnOrder: [{ type: 'player', name: 'Nix', initiative: 15 }],
        },
    }, normalizeCombatExchange({
        player_slots: [{ action: roll.type === 'saving_throw' ? 'save' : 'check', skill: roll.skill, dc: roll.dc }],
        enemy_intents: [{ enemy_id: 'gob', action: 'defend' }],
    }));
    if (!plan.ok) throw new Error(plan.error);
    return plan.payload.result.events.find(e => e.type === 'check' || e.type === 'save').rolled - DIE;
}

beforeEach(() => { rollQueue.length = 0; });

describe('the card, the resolver and the combat slot print one modifier', () => {
    it.each([
        [{ type: 'skill_check', skill: 'sleightOfHand', dc: 15 }, 4 + 6],  // expertise: DEX 4 + 2×3
        [{ type: 'skill_check', skill: 'Sleight of Hand', dc: 15 }, 10],
        [{ type: 'skill_check', skill: 'stealth', dc: 12 }, 4 + 3],        // proficient
        [{ type: 'skill_check', skill: 'athletics', dc: 12 }, -1],         // unproficient: STR 8
        [{ type: 'ability_check', skill: 'intelligence', dc: 10 }, 2],     // a bare ability: no proficiency
        [{ type: 'saving_throw', skill: 'dexterity', dc: 14 }, 4 + 3],     // proficient save
        [{ type: 'saving_throw', skill: 'wisdom', dc: 14 }, 1],            // unproficient save
    ])('%j → %i on every lane', (roll, expected) => {
        expect(describeCheckOdds(hero, inventory, roll).modifier).toBe(expected);
        expect(resolverModifier(roll)).toBe(expected);
        expect(combatModifier(roll)).toBe(expected);
    });

    it('an attack_roll reads the weapon on both out-of-combat readers (finesse rapier: DEX 4 + prof 3)', () => {
        for (const roll of [{ type: 'attack_roll', skill: 'attack', dc: 13 }, { type: 'attack_roll', skill: 'dexterity', dc: 13 }]) {
            const odds = describeCheckOdds(hero, inventory, roll);
            expect(odds).toMatchObject({ modifier: 7, kind: 'attack', source: 'weapon' });
            expect(resolverModifier(roll)).toBe(7);
        }
    });

    it('the LANE is one reading too: an attack_roll naming a skill resolves — and is priced — as an attack', () => {
        // The resolver always rolled this on the attack lane (weapon crit rule,
        // attack condition effects) while the card called it a check.
        const roll = { type: 'attack_roll', skill: 'stealth', dc: 12 };
        expect(resolvePlayerRollModifier(hero, inventory, roll)).toMatchObject({ kind: 'attack', modifier: 7, source: 'proficient' });
        expect(describeCheckOdds(hero, inventory, roll).kind).toBe('attack');
        expect(describeCheckOdds({ ...hero, conditions: ['poisoned'] }, inventory, roll).disadvantage).toBe(true);
    });

    it('an unknown key is +0 untrained everywhere, and a prototype name is not a skill', () => {
        for (const skill of ['lockpicking', 'constructor', '__proto__']) {
            const roll = { type: 'skill_check', skill, dc: 10 };
            expect(resolvePlayerRollModifier(hero, inventory, roll)).toMatchObject({ modifier: 0, source: 'untrained', kind: 'check' });
            expect(describeCheckOdds(hero, inventory, roll).modifier).toBe(0);
            expect(resolverModifier(roll)).toBe(0);
        }
    });
});
