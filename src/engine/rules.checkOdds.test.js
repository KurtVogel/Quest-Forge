/**
 * The odds on the card (WOW 2026-09-16, checks-and-consequence): the pure
 * helper that shows the hero's real modifier and success chance BEFORE dice
 * exist must agree with the resolver's own success rule — so the table below
 * derives every expected chance by brute force from the same rule
 * (`isCritical || total >= dc`, advantage keeps the high die, disadvantage
 * the low die) and pins the branch order + condition folding.
 */
import { describe, it, expect } from 'vitest';
import { canonicalRollKey, d20SuccessChance, describeCheckOdds, MAX_CHECK_DC } from './rules.js';

function bruteForceChance(mod, dc, { advantage = false, disadvantage = false } = {}) {
    const succeeds = face => face === 20 || face + mod >= dc;
    if (!advantage && !disadvantage) {
        let hits = 0;
        for (let f = 1; f <= 20; f += 1) if (succeeds(f)) hits += 1;
        return hits / 20;
    }
    let hits = 0;
    for (let a = 1; a <= 20; a += 1) {
        for (let b = 1; b <= 20; b += 1) {
            const kept = advantage ? Math.max(a, b) : Math.min(a, b);
            if (succeeds(kept)) hits += 1;
        }
    }
    return hits / 400;
}

function makeCharacter(overrides = {}) {
    return {
        name: 'Testo',
        class: 'rogue',
        level: 5,
        abilityScores: { strength: 10, dexterity: 18, constitution: 12, intelligence: 10, wisdom: 14, charisma: 8 },
        skillProficiencies: ['stealth', 'perception'],
        expertiseSkills: ['stealth'],
        savingThrowProficiencies: ['dexterity', 'intelligence'],
        conditions: [],
        ...overrides,
    };
}

describe('d20SuccessChance', () => {
    const table = [
        { mod: 0, dc: 10 },
        { mod: 7, dc: 12 },
        { mod: 7, dc: 12, advantage: true },
        { mod: 7, dc: 12, disadvantage: true },
        { mod: -1, dc: 15 },
        { mod: 3, dc: 0 },
        { mod: 3, dc: 30 },
        { mod: 12, dc: 30, advantage: true },
        { mod: -5, dc: 1, disadvantage: true },
    ];
    it.each(table)('matches the resolver success rule by brute force: %o', (row) => {
        const flags = { advantage: !!row.advantage, disadvantage: !!row.disadvantage };
        expect(d20SuccessChance(row.mod, row.dc, flags)).toBeCloseTo(bruteForceChance(row.mod, row.dc, flags), 12);
    });

    it('never drops below the natural-20 floor and never exceeds 1', () => {
        expect(d20SuccessChance(-20, 30)).toBeCloseTo(1 / 20, 12);
        expect(d20SuccessChance(-20, 30, { disadvantage: true })).toBeCloseTo(1 / 400, 12);
        expect(d20SuccessChance(30, 0)).toBe(1);
        expect(d20SuccessChance(30, 0, { advantage: true })).toBe(1);
    });

    it('clamps the DC to 0..MAX_CHECK_DC and defaults a non-finite DC to 10', () => {
        expect(d20SuccessChance(0, -40)).toBe(1);
        expect(d20SuccessChance(0, 999)).toBe(d20SuccessChance(0, MAX_CHECK_DC));
        expect(d20SuccessChance(0, 'nope')).toBe(d20SuccessChance(0, 10));
        expect(d20SuccessChance('nope', 10)).toBe(d20SuccessChance(0, 10));
    });

    it('advantage AND disadvantage cancel to the flat chance', () => {
        expect(d20SuccessChance(2, 12, { advantage: true, disadvantage: true })).toBe(d20SuccessChance(2, 12));
    });
});

describe('canonicalRollKey', () => {
    it('restores the SKILL_ABILITIES casing case-insensitively', () => {
        expect(canonicalRollKey('sleightofhand')).toBe('sleightOfHand');
        expect(canonicalRollKey('SleightOfHand')).toBe('sleightOfHand');
        expect(canonicalRollKey(' Stealth ')).toBe('stealth');
        expect(canonicalRollKey('animalhandling')).toBe('animalHandling');
    });
    it('lowercases unknown keys and rejects non-strings', () => {
        expect(canonicalRollKey('Dexterity')).toBe('dexterity');
        expect(canonicalRollKey('Attack')).toBe('attack');
        expect(canonicalRollKey('Basket Weaving')).toBe('basket weaving');
        expect(canonicalRollKey(null)).toBeNull();
        expect(canonicalRollKey(42)).toBeNull();
        expect(canonicalRollKey('   ')).toBeNull();
    });
});

describe('describeCheckOdds', () => {
    it('skill with expertise: level-5 rogue Stealth = +4 DEX + 2×3 prof', () => {
        const odds = describeCheckOdds(makeCharacter(), [], { type: 'skill_check', skill: 'stealth', dc: 12 });
        expect(odds).toMatchObject({ key: 'stealth', kind: 'check', ability: 'dexterity', modifier: 10, source: 'expertise', dc: 12, advantage: false, disadvantage: false });
        expect(odds.flatChance).toBeCloseTo(bruteForceChance(10, 12), 12);
        expect(odds.chance).toBe(odds.flatChance);
    });

    it('proficient skill and untrained skill report their sources', () => {
        const prof = describeCheckOdds(makeCharacter(), [], { type: 'skill_check', skill: 'perception', dc: 10 });
        expect(prof).toMatchObject({ modifier: 5, source: 'proficient', ability: 'wisdom' });
        const plain = describeCheckOdds(makeCharacter(), [], { type: 'skill_check', skill: 'athletics', dc: 10 });
        expect(plain).toMatchObject({ modifier: 0, source: 'ability', ability: 'strength' });
    });

    it('a camelCase skill in any casing resolves to the same odds the resolver rolls with', () => {
        const a = describeCheckOdds(makeCharacter({ skillProficiencies: ['sleightOfHand'], expertiseSkills: [] }), [], { type: 'skill_check', skill: 'sleightOfHand', dc: 14 });
        const b = describeCheckOdds(makeCharacter({ skillProficiencies: ['sleightOfHand'], expertiseSkills: [] }), [], { type: 'skill_check', skill: 'Sleight of Hand'.replace(/\s/g, '').toLowerCase(), dc: 14 });
        expect(a.modifier).toBe(7);
        expect(b).toEqual(a);
    });

    it('saving throw: ability modifier + proficiency when the class grants it', () => {
        const dex = describeCheckOdds(makeCharacter(), [], { type: 'saving_throw', skill: 'dexterity', dc: 15 });
        expect(dex).toMatchObject({ kind: 'save', ability: 'dexterity', modifier: 7, source: 'proficient' });
        const wis = describeCheckOdds(makeCharacter(), [], { type: 'saving_throw', skill: 'wisdom', dc: 15 });
        expect(wis).toMatchObject({ kind: 'save', ability: 'wisdom', modifier: 2, source: 'save' });
    });

    it('bare ability check uses the ability modifier alone', () => {
        const odds = describeCheckOdds(makeCharacter(), [], { type: 'skill_check', skill: 'dexterity', dc: 10 });
        expect(odds).toMatchObject({ kind: 'check', ability: 'dexterity', modifier: 4, source: 'ability' });
    });

    it('attack uses the weapon attack bonus (dagger: DEX + prof) and the attack condition lane', () => {
        const inventory = [{ name: 'Dagger', type: 'weapon', equipped: true, finesse: true, category: 'simple', damage: '1d4' }];
        const odds = describeCheckOdds(makeCharacter(), inventory, { type: 'attack_roll', skill: 'attack', dc: 13 });
        expect(odds).toMatchObject({ kind: 'attack', source: 'weapon' });
        expect(odds.modifier).toBe(4 + 3);
    });

    it('unknown skill is +0 untrained', () => {
        const odds = describeCheckOdds(makeCharacter(), [], { type: 'skill_check', skill: 'basket weaving', dc: 10 });
        expect(odds).toMatchObject({ modifier: 0, source: 'untrained', ability: null, kind: 'check' });
        expect(odds.flatChance).toBeCloseTo(bruteForceChance(0, 10), 12);
    });

    it('folds a condition through the resolver lane: frightened → disadvantage on checks', () => {
        const odds = describeCheckOdds(makeCharacter({ conditions: ['Frightened'] }), [], { type: 'skill_check', skill: 'stealth', dc: 12 });
        expect(odds.disadvantage).toBe(true);
        expect(odds.conditionSources).toEqual(['Frightened']);
        expect(odds.chance).toBeCloseTo(bruteForceChance(10, 12, { disadvantage: true }), 12);
        expect(odds.flatChance).toBeCloseTo(bruteForceChance(10, 12), 12);
    });

    it('a condition disadvantage and the ruling advantage cancel to a straight roll', () => {
        const odds = describeCheckOdds(makeCharacter({ conditions: ['frightened'] }), [], { type: 'skill_check', skill: 'stealth', dc: 12, advantage: true });
        expect(odds).toMatchObject({ advantage: false, disadvantage: false });
        expect(odds.chance).toBe(odds.flatChance);
    });

    it('the ruling advantage / disadvantage flags apply the 1-(1-p)² / p² formulas', () => {
        const adv = describeCheckOdds(makeCharacter(), [], { type: 'skill_check', skill: 'stealth', dc: 12, advantage: true });
        expect(adv.advantage).toBe(true);
        expect(adv.chance).toBeCloseTo(1 - (1 - adv.flatChance) ** 2, 12);
        const dis = describeCheckOdds(makeCharacter(), [], { type: 'skill_check', skill: 'stealth', dc: 12, disadvantage: true });
        expect(dis.disadvantage).toBe(true);
        expect(dis.chance).toBeCloseTo(dis.flatChance ** 2, 12);
    });

    it('DC 0 is certain, DC 30 is the natural-20 floor for a +0 hero, junk DC defaults to 10', () => {
        const hero = makeCharacter();
        expect(describeCheckOdds(hero, [], { type: 'skill_check', skill: 'athletics', dc: 0 }).chance).toBe(1);
        expect(describeCheckOdds(hero, [], { type: 'skill_check', skill: 'athletics', dc: 30 }).chance).toBeCloseTo(1 / 20, 12);
        expect(describeCheckOdds(hero, [], { type: 'skill_check', skill: 'athletics', dc: '12' }).dc).toBe(10);
        expect(describeCheckOdds(hero, [], { type: 'skill_check', skill: 'athletics', dc: 200 }).dc).toBe(MAX_CHECK_DC);
    });

    it('returns null for a roll the resolver skips (initiative) or junk input', () => {
        expect(describeCheckOdds(makeCharacter(), [], { type: 'skill_check', skill: 'initiative', dc: 10 })).toBeNull();
        expect(describeCheckOdds(null, [], { skill: 'stealth' })).toBeNull();
        expect(describeCheckOdds(makeCharacter(), [], null)).toBeNull();
    });
});
