import { describe, expect, it } from 'vitest';
import {
    applyArcaneRecovery,
    buildSustainedSpell,
    dedupeCastTargets,
    describeRecipientClamp,
    resolveSpellRecipients,
    sanitizeSustainedSpell,
    MAX_CAST_TARGETS,
    buildSpellSlots,
    cantripDiceCount,
    chooseSlotLevel,
    describeSpellbookForPrompt,
    describeSpellSlotsForPrompt,
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
            expect(['enemy', 'ally', 'self', 'any']).toContain(spell.targeting.side);
            // 'any' is the narrative-only target side (Spare the Dying): never a combat spell.
            if (spell.targeting.side === 'any') expect(spell.combatAvailable).toBe(false);
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

    it('renders the two prompt halves for casters only', () => {
        const slots = describeSpellSlotsForPrompt(cleric(3));
        const book = describeSpellbookForPrompt(cleric(3));
        expect(slots).toContain('Spell save DC');
        expect(slots).toContain('L1 4/4');
        expect(book).toContain('Healing Word');
        expect(book).toContain('bonus action');
        expect(describeSpellSlotsForPrompt({ class: 'rogue', level: 5 })).toBe('');
        expect(describeSpellbookForPrompt({ class: 'rogue', level: 5 })).toBe('');
    });
});

describe('resolveSpellRecipients — THE recipient ladder for both casting lanes (2026-10-08 Lap-4 P2)', () => {
    const hero = { name: 'Maren', class: 'cleric', level: 5 };
    const party = [
        { id: 'jorun', name: 'Jorun', status: 'healthy' },
        { id: 'mika', name: 'Mika', status: 'bloodied' },
        { id: 'pell', name: 'Pell', status: 'dead' },
    ];
    const spell = key => resolveSpellForCharacter({ class: key === 'mageArmor' ? 'wizard' : 'cleric', level: 5 }, key);

    it('a self-only spell lands on the caster whatever was named, and says so', () => {
        const out = resolveSpellRecipients(spell('mageArmor'), hero, party, ['Jorun']);
        expect(out.recipients).toEqual([{ type: 'self' }]);
        expect(out.redirected).toBe('Jorun');
        expect(describeRecipientClamp(spell('mageArmor'), out)).toMatch(/can only settle on the caster — "Jorun" is unaffected/);
        expect(resolveSpellRecipients(spell('mageArmor'), hero, party, ['self']).redirected).toBeNull();
    });

    it("the hero's aliases and own name resolve to self; a dead companion is never a recipient on any side", () => {
        for (const ref of ['', 'self', 'me', 'player', 'maren', undefined]) {
            expect(resolveSpellRecipients(spell('cureWounds'), hero, party, [ref]).recipients).toEqual([{ type: 'self' }]);
        }
        expect(resolveSpellRecipients(spell('cureWounds'), hero, party, ['Pell'])).toMatchObject({ recipients: [], invalid: ['Pell'] });
        // Spare the Dying (side: any) may name an NPC outside the party — but not the dead companion.
        expect(resolveSpellRecipients(spell('spareTheDying'), hero, party, ['Pell'])).toMatchObject({ recipients: [], invalid: ['Pell'] });
        expect(resolveSpellRecipients(spell('spareTheDying'), hero, party, ['the ferryman']).recipients).toEqual([{ type: 'other', name: 'the ferryman' }]);
        // An ally-side spell never resolves a stranger.
        expect(resolveSpellRecipients(spell('cureWounds'), hero, party, ['the ferryman']).invalid).toEqual(['the ferryman']);
    });

    it("dedupes by identity THEN caps at the spell's limit — invalid names never cost a slot", () => {
        const out = resolveSpellRecipients(spell('massHealingWord'), hero, party, ['self', 'Nobody', 'jorun', 'Jorun', 'Mika', 'self']);
        expect(out.recipients.map(r => r.type === 'self' ? 'self' : r.companion.id)).toEqual(['self', 'jorun', 'mika']);
        expect(out).toMatchObject({ invalid: ['Nobody'], overflow: 0 });
        const over = resolveSpellRecipients(spell('cureWounds'), hero, party, ['Mika', 'Jorun']);
        expect(over.recipients.map(r => r.companion.id)).toEqual(['mika']);
        expect(over.overflow).toBe(1);
        expect(describeRecipientClamp(spell('cureWounds'), over)).toMatch(/affects only one recipient; extra targets are unaffected/);
        expect(describeRecipientClamp(spell('cureWounds'), { overflow: 0 })).toBeNull();
    });

    it("companion recipients are the caller's own objects (the exchange mutates its working copies)", () => {
        const out = resolveSpellRecipients(spell('cureWounds'), hero, party, ['Mika']);
        expect(out.recipients[0].companion).toBe(party[1]);
    });
});

describe('dedupeCastTargets — one dedupe-then-cap for both wires (2026-10-08)', () => {
    it('keeps the first of a repeated name, drops junk, caps at MAX_CAST_TARGETS from a bounded scan', () => {
        const toRef = v => (typeof v === 'string' && v.trim() ? v.trim() : null);
        expect(dedupeCastTargets(['self', 'Jorun', 'Jorun', 42, null, 'Mika'], toRef)).toEqual(['self', 'Jorun', 'Mika']);
        expect(dedupeCastTargets(Array.from({ length: 40 }, (_, i) => `a${i}`), toRef)).toHaveLength(MAX_CAST_TARGETS);
        expect(dedupeCastTargets('not a list', toRef)).toEqual([]);
    });
});

describe('buildSustainedSpell — ONE composer for both casting lanes and the load twin (2026-10-08 Lap-4 P2)', () => {
    const shield = resolveSpellForCharacter({ class: 'cleric', level: 5 }, 'shieldOfFaith');

    it('composes the record from the catalog, typed target fields, and the load twin reproduces it', () => {
        const live = buildSustainedSpell(shield, { id: 'jorun', name: 'Jorun' });
        expect(live).toEqual({ key: 'shieldOfFaith', name: 'Shield of Faith', acBonus: 2, targetType: 'companion', targetId: 'jorun', targetName: 'Jorun' });
        expect(sanitizeSustainedSpell(live)).toEqual(live);
        const { targetName: _dropped, ...withoutName } = live;
        expect(sanitizeSustainedSpell({ ...live, acBonus: 30, targetName: { evil: true } })).toEqual(withoutName);
        expect(buildSustainedSpell(shield)).toEqual({ key: 'shieldOfFaith', name: 'Shield of Faith', acBonus: 2, targetType: 'self' });
        expect(buildSustainedSpell(shield, { id: 'x'.repeat(200), name: 'y'.repeat(200) }).targetId).toHaveLength(100);
    });

    it('a non-sustained or unknown spell composes nothing', () => {
        expect(buildSustainedSpell(resolveSpellForCharacter({ class: 'cleric', level: 5 }, 'cureWounds'))).toBeNull();
        expect(buildSustainedSpell(null)).toBeNull();
    });
});

describe('isSpellcaster reads the catalog, not a class list (2026-10-08)', () => {
    it('a class is a caster when the spell catalog lists it', () => {
        expect(isSpellcaster('wizard')).toBe(true);
        expect(isSpellcaster('cleric')).toBe(true);
        expect(isSpellcaster('fighter')).toBe(false);
        expect(isSpellcaster('rogue')).toBe(false);
        expect(isSpellcaster(undefined)).toBe(false);
        expect(isSpellcaster({ class: 'wizard' })).toBe(false);
    });
});
