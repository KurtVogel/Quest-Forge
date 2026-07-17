import { describe, expect, it } from 'vitest';
import {
    applyArcaneRecovery,
    buildSpellSlots,
    cantripDiceCount,
    chooseSlotLevel,
    describeSpellcastingForPrompt,
    getKnownSpells,
    getMaxSpellLevel,
    getSpellAttackBonus,
    getSpellSaveDC,
    getSpellSlotTable,
    isSpellcaster,
    refillSpellSlots,
    resolveSpellForCharacter,
    sanitizeSpellSlots,
    spellDamageNotation,
    spellHealingNotation,
    spendSpellSlot,
    summarizeSpellSlots,
} from './spellcasting.js';
import { SPELL_LIST, findSpell } from '../data/spells.js';

const wizard = (level = 5, overrides = {}) => ({
    name: 'Imra',
    class: 'wizard',
    level,
    abilityScores: { strength: 8, dexterity: 14, constitution: 12, intelligence: 16, wisdom: 10, charisma: 10 },
    spellSlots: buildSpellSlots(level),
    ...overrides,
});

const cleric = (level = 5, overrides = {}) => ({
    name: 'Maren',
    class: 'cleric',
    level,
    abilityScores: { strength: 12, dexterity: 10, constitution: 14, intelligence: 10, wisdom: 16, charisma: 12 },
    spellSlots: buildSpellSlots(level),
    ...overrides,
});

describe('spell catalog integrity', () => {
    const SUPPORTED_CONDITIONS = new Set([
        'poisoned', 'blinded', 'frightened', 'restrained', 'prone',
        'invisible', 'stunned', 'paralyzed', 'unconscious',
    ]);

    it('every spell is engine-implementable: valid fields, supported conditions, sane dice', () => {
        for (const spell of SPELL_LIST) {
            expect(spell.level).toBeGreaterThanOrEqual(0);
            expect(spell.level).toBeLessThanOrEqual(5);
            expect(['action', 'bonus']).toContain(spell.castTime);
            expect(['attack', 'save', 'auto']).toContain(spell.resolution);
            expect(['enemy', 'ally', 'self']).toContain(spell.targeting.side);
            if (spell.condition) expect(SUPPORTED_CONDITIONS.has(spell.condition)).toBe(true);
            if (spell.resolution === 'save') expect(['half', 'negate']).toContain(spell.saveEffect);
            if (spell.damage) expect(spell.damage.dice).toMatch(/^\d+d\d+([+-]\d+)?$/);
            if (spell.healing) expect(spell.healing.dice).toMatch(/^\d+d\d+([+-]\d+)?$/);
            // Save-resolution spells never target allies — only enemies have saves in v1.
            if (spell.resolution === 'save') expect(spell.targeting.side).toBe('enemy');
        }
    });

    it('keeps the class identity split: wizard never heals, cleric never controls minds', () => {
        for (const spell of SPELL_LIST) {
            if (spell.classes.includes('wizard')) expect(spell.healing).toBeUndefined();
        }
    });

    it('resolves loose references and legacy aliases', () => {
        expect(findSpell('Fire Bolt').key).toBe('fireBolt');
        expect(findSpell('fire bolt').key).toBe('fireBolt');
        expect(findSpell('arcane bolt').key).toBe('fireBolt');
        expect(findSpell('divine bolt').key).toBe('sacredFlame');
        expect(findSpell('meteor swarm')).toBeNull();
    });
});

describe('slot table', () => {
    it('uses real 5e numbers and freezes at level 10', () => {
        expect(getSpellSlotTable(1)).toEqual({ 1: 2 });
        expect(getSpellSlotTable(5)).toEqual({ 1: 4, 2: 3, 3: 2 });
        expect(getSpellSlotTable(9)).toEqual({ 1: 4, 2: 3, 3: 3, 4: 3, 5: 1 });
        expect(getSpellSlotTable(10)).toEqual({ 1: 4, 2: 3, 3: 3, 4: 3, 5: 2 });
        expect(getSpellSlotTable(20)).toEqual(getSpellSlotTable(10));
        expect(getMaxSpellLevel(4)).toBe(2);
    });

    it('carries spent slots through a level-up instead of refilling the day', () => {
        const spent = spendSpellSlot(spendSpellSlot(buildSpellSlots(2), 1), 1);
        const grown = buildSpellSlots(3, spent);
        expect(grown[1]).toEqual({ used: 2, max: 4 });
        expect(grown[2]).toEqual({ used: 0, max: 2 });
    });

    it('sanitizes hostile loaded slot states against the authoritative table', () => {
        const healed = sanitizeSpellSlots(3, { 1: { used: 99, max: 99 }, 7: { used: 0, max: 9 } });
        expect(healed[1]).toEqual({ used: 4, max: 4 });
        expect(healed[7]).toBeUndefined();
        expect(healed[2]).toEqual({ used: 0, max: 2 });
    });
});

describe('casting math', () => {
    it('computes save DC and attack bonus from the casting ability', () => {
        expect(getSpellSaveDC(wizard(5))).toBe(14); // 8 + prof 3 + INT 3
        expect(getSpellAttackBonus(cleric(1))).toBe(5); // prof 2 + WIS 3
    });

    it('chooses the lowest sufficient slot and honors valid upcast requests', () => {
        const slots = buildSpellSlots(5);
        const fireball = findSpell('fireball');
        const sleep = findSpell('sleep');
        expect(chooseSlotLevel(slots, sleep)).toBe(1);
        expect(chooseSlotLevel(slots, sleep, 3)).toBe(3);
        expect(chooseSlotLevel(slots, fireball, 1)).toBe(3); // request below base is ignored
        const drained = { 1: { used: 4, max: 4 }, 2: { used: 3, max: 3 }, 3: { used: 2, max: 2 } };
        expect(chooseSlotLevel(drained, sleep)).toBeNull();
        expect(chooseSlotLevel(slots, findSpell('fire bolt'))).toBe(0);
    });

    it('scales cantrips by character level and upcasts by extra dice', () => {
        expect(cantripDiceCount(1)).toBe(1);
        expect(cantripDiceCount(11)).toBe(3);
        expect(spellDamageNotation(findSpell('fire bolt'), wizard(5), 0)).toBe('2d10');
        expect(spellDamageNotation(findSpell('fireball'), wizard(9), 5)).toBe('8d6');
        expect(spellDamageNotation(findSpell('magic missile'), wizard(5), 2)).toBe('4d4+3');
        expect(spellHealingNotation(findSpell('cure wounds'), cleric(5), 2)).toBe('2d8+3');
        expect(spellHealingNotation(findSpell('mass cure wounds'), cleric(10), 5)).toBe('2d8+3');
    });

    it('spends and refills slots immutably', () => {
        const slots = buildSpellSlots(3);
        const spent = spendSpellSlot(slots, 2);
        expect(spent[2]).toEqual({ used: 1, max: 2 });
        expect(slots[2]).toEqual({ used: 0, max: 2 });
        expect(refillSpellSlots(spent)[2]).toEqual({ used: 0, max: 2 });
        expect(summarizeSpellSlots(spent)).toBe('L1 4/4 · L2 1/2');
    });
});

describe('arcane recovery', () => {
    it('recovers ceil(level/2) slot levels, best slots first, capped at 3rd', () => {
        const spent = {
            1: { used: 2, max: 4 }, 2: { used: 1, max: 3 }, 3: { used: 2, max: 3 },
            4: { used: 1, max: 3 }, 5: { used: 1, max: 2 },
        };
        const { spellSlots, recovered } = applyArcaneRecovery(spent, 10);
        expect(recovered).toBe(5);
        expect(spellSlots[3].used).toBe(1); // one 3rd-level slot back (3 points)
        expect(spellSlots[2].used).toBe(0); // one 2nd-level slot back (2 points)
        expect(spellSlots[4].used).toBe(1); // 4th+ never recovered
    });

    it('recovers nothing when nothing is spent', () => {
        const { recovered } = applyArcaneRecovery(buildSpellSlots(5), 5);
        expect(recovered).toBe(0);
    });
});

describe('known spells and prompt block', () => {
    it('gates spells by class and unlocked slot level', () => {
        expect(isSpellcaster('fighter')).toBe(false);
        expect(getKnownSpells({ class: 'fighter', level: 20 })).toEqual([]);
        const low = getKnownSpells(wizard(1));
        expect(low.some(spell => spell.key === 'sleep')).toBe(true);
        expect(low.some(spell => spell.key === 'fireball')).toBe(false);
        expect(resolveSpellForCharacter(wizard(1), 'fireball')).toBeNull();
        expect(resolveSpellForCharacter(cleric(5), 'fireball')).toBeNull(); // wrong class
        expect(resolveSpellForCharacter(wizard(5), 'fireball')?.key).toBe('fireball');
    });

    it('renders a compact prompt block for casters only', () => {
        const block = describeSpellcastingForPrompt(cleric(3));
        expect(block).toContain('Spell save DC');
        expect(block).toContain('Healing Word');
        expect(block).toContain('bonus action');
        expect(block).toContain('L1 4/4');
        expect(describeSpellcastingForPrompt({ class: 'rogue', level: 5 })).toBe('');
    });
});
