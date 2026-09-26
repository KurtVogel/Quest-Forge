/**
 * 2026-09-25 spellcasting + inventory-economy Lap-3 (performance & token budget)
 * queue sweep — the prompt-side pins:
 *
 *  1. `## SPELLBOOK` ends the cached prefix (after HERO IDENTITY, before the
 *     first dynamic block): the catalog lines are a function of class + level
 *     only, so they change at level-up and never between. The slots / DC /
 *     attack line stays live in PLAYER CHARACTER.
 *  2. The caster rulebook (`## SPELLCASTING INSTRUCTIONS`) rides a Wizard's /
 *     Cleric's prompt only. Class is campaign-constant, so each class's prefix
 *     is still byte-stable — DECISIONS.md 2026-07-18 forbids LIVE state in the
 *     prefix, not campaign constants.
 *  3. INVENTORY renders stat annotations on Equipped rows only; every row keeps
 *     its value; the proficiency note stays on every weapon.
 */
import { describe, expect, it } from 'vitest';
import { buildSystemPrompt } from './promptBuilder.js';
import { buildSpellSlots } from '../engine/spellcasting.js';

function makeCharacter(overrides = {}) {
    return {
        name: 'Astra',
        race: 'human',
        class: 'fighter',
        level: 1,
        exp: 0,
        currentHP: 12,
        maxHP: 12,
        armorClass: 16,
        gold: 5,
        silver: 2,
        copper: 3,
        speed: 30,
        abilityScores: { strength: 16, dexterity: 12, constitution: 14, intelligence: 10, wisdom: 10, charisma: 8 },
        savingThrowProficiencies: ['strength', 'constitution'],
        skillProficiencies: ['athletics'],
        conditions: [],
        classResources: {},
        features: [],
        background: 'A disgraced lamplighter.',
        gender: 'woman',
        ...overrides,
    };
}

function wizard(level = 1, overrides = {}) {
    return makeCharacter({
        class: 'wizard',
        level,
        abilityScores: { strength: 8, dexterity: 12, constitution: 14, intelligence: 16, wisdom: 10, charisma: 10 },
        spellSlots: buildSpellSlots(level),
        ...overrides,
    });
}

function cleric(level = 3, overrides = {}) {
    return makeCharacter({
        class: 'cleric',
        level,
        abilityScores: { strength: 12, dexterity: 10, constitution: 14, intelligence: 10, wisdom: 16, charisma: 12 },
        spellSlots: buildSpellSlots(level),
        ...overrides,
    });
}

function prompt(overrides = {}) {
    return buildSystemPrompt({
        character: 'character' in overrides ? overrides.character : makeCharacter(),
        inventory: overrides.inventory ?? [],
        quests: overrides.quests ?? [],
        rollHistory: overrides.rollHistory ?? [],
        preset: 'classicFantasy',
        ruleset: 'simplified5e',
        customSystemPrompt: 'Grim, grounded tone.',
        journal: [],
        npcs: [],
        party: overrides.party ?? [],
        currentLocation: overrides.currentLocation ?? 'Jewelglade',
        combat: overrides.combat ?? { active: false },
        worldFacts: overrides.worldFacts ?? [],
        locations: [],
        fronts: [],
        storyMemory: [],
        retrievedMemories: [],
        premise: 'premise' in overrides ? overrides.premise : 'The barony of Kolkanmaa is starving and the toll-weirs keep failing.',
        recentRulings: [],
        messages: [],
        messageCount: 0,
        relationshipBeat: null,
    });
}

/** A `## HEADING` block: from its heading to the next `## ` heading (or the end). */
function block(text, heading) {
    const start = text.indexOf(heading);
    expect(start, `${heading} present`).toBeGreaterThan(0);
    const next = text.indexOf('\n## ', start + 1);
    return next === -1 ? text.slice(start) : text.slice(start, next);
}

const dynamicState = {
    party: [{ id: 'c1', name: 'Osma', hp: 9, maxHp: 18, ac: 16, level: 2, affinity: 60 }],
    quests: [{ id: 'q1', name: 'Find the wardens', status: 'active', description: 'x' }],
    worldFacts: [{ id: 'f1', fact: 'The Pike buys captives.', timestamp: 1 }],
    combat: { active: true, round: 2, enemies: [{ id: 'g1', name: 'Goblin', hp: 5, maxHp: 11, ac: 12 }], turnOrder: [] },
    rollHistory: [{ description: 'Stealth', total: 14, notation: '1d20+2', rolls: [12], modifier: 2 }],
    currentLocation: 'Elsewhere',
};

describe('SPELLBOOK ends the cached prefix (2026-09-25 spellcasting P2, extends DECISIONS.md 2026-07-18)', () => {
    it('sits immediately after HERO IDENTITY and ahead of every dynamic block; the live block keeps only the slots line', () => {
        const text = prompt({ character: cleric(3) });
        const identityAt = text.indexOf('## HERO IDENTITY');
        const spellbookAt = text.indexOf('## SPELLBOOK');
        const characterAt = text.indexOf('## PLAYER CHARACTER');
        expect(identityAt).toBeGreaterThan(0);
        expect(spellbookAt).toBeGreaterThan(identityAt);
        expect(spellbookAt).toBeLessThan(characterAt);
        // Nothing but the identity block between the two headings.
        expect(text.indexOf('\n## ', identityAt + 1)).toBe(spellbookAt - 1);

        const spellbook = block(text, '## SPELLBOOK');
        expect(spellbook).toContain('- Healing Word (level 2 slot, bonus action, ONE ally): ');
        expect(spellbook).toContain('- Cure Wounds (level 1 slot, ONE ally): ');
        expect(spellbook).toContain('- Guidance (cantrip, at will, self) [out of combat only]: ');
        expect(spellbook).not.toContain('Spell slots remaining');
        expect(spellbook).not.toContain('Spell save DC');

        const live = block(text, '## PLAYER CHARACTER');
        expect(live).toContain('- **SPELLCASTING (engine-owned — only the SPELLBOOK\'s spells exist mechanically):** Spell slots remaining: L1 4/4 · L2 2/2. Spell save DC 13, spell attack +5.');
        expect(live).not.toContain('- Healing Word');
        expect(live).not.toContain('- Cure Wounds');
    });

    it('keeps every byte through the spellbook identical across turns that spend slots, take damage, sustain a spell, and fight', () => {
        const base = wizard(5, { appearance: 'Scarred.' });
        const a = prompt({ character: base });
        const b = prompt({
            character: {
                ...base,
                currentHP: 3,
                exp: 6400,
                conditions: ['Poisoned'],
                appearance: 'Scarred, and now limping.',
                spellSlots: { 1: { used: 4, max: 4 }, 2: { used: 1, max: 3 }, 3: { used: 2, max: 2 } },
                sustainedSpell: { key: 'mageArmor', name: 'Mage Armor', acBonus: 3, targetType: 'self' },
            },
            ...dynamicState,
        });
        const spellbook = block(a, '## SPELLBOOK');
        const prefixEnd = a.indexOf(spellbook) + spellbook.length;
        expect(prefixEnd).toBeLessThan(a.indexOf('## PLAYER CHARACTER'));
        expect(b.slice(0, prefixEnd)).toBe(a.slice(0, prefixEnd));
        // The next heading after the spellbook is HERO SHEET (2026-09-26), the last block of the prefix.
        expect(a.indexOf('\n## ', a.indexOf('## SPELLBOOK') + 1)).toBeGreaterThanOrEqual(prefixEnd);
        // The live line moved with the state; the sustained spell rides the live block.
        expect(block(b, '## PLAYER CHARACTER')).toContain('Spell slots remaining: L1 0/4 · L2 2/3 · L3 0/2.');
        expect(block(b, '## PLAYER CHARACTER')).toContain('**Sustained spell active:** Mage Armor');
        expect(block(b, '## SPELLBOOK')).not.toContain('Mage Armor on');
    });

    it('changes only at level-up: the whole delta between L1 and L10 lands before PLAYER CHARACTER, the live block does not grow by a byte', () => {
        const l1 = prompt({ character: wizard(1) });
        const l10 = prompt({ character: wizard(10) });
        const spellbookDelta = block(l10, '## SPELLBOOK').length - block(l1, '## SPELLBOOK').length;
        expect(spellbookDelta).toBeGreaterThan(800);
        expect(block(l10, '## SPELLBOOK').split('\n').length).toBeGreaterThan(block(l1, '## SPELLBOOK').split('\n').length);
        // Same slots-line SHAPE at both levels — the live block differs only by the
        // slot / DC / level digits, never by catalog lines.
        const liveLines = text => block(text, '## PLAYER CHARACTER').split('\n').length;
        expect(liveLines(l10)).toBe(liveLines(l1));
        expect(block(l10, '## PLAYER CHARACTER')).not.toMatch(/^- (Fireball|Cone of Cold|Magic Missile)/m);
    });

    it('renders no spellbook for a non-caster or a caster without slots, and never throws on a hostile class', () => {
        expect(prompt()).not.toContain('## SPELLBOOK');
        expect(prompt({ character: makeCharacter({ class: 'wizard', level: 3 }) })).not.toContain('## SPELLBOOK');
        expect(prompt({ character: null })).not.toContain('## SPELLBOOK');
    });
});

describe('the caster rulebook is class-gated (2026-09-25 spellcasting P2 — a static block gated on a campaign constant is still prefix)', () => {
    it('a Fighter\'s prompt carries no SPELLCASTING INSTRUCTIONS; a Wizard\'s and a Cleric\'s do', () => {
        const fighter = prompt();
        expect(fighter).not.toContain('## SPELLCASTING INSTRUCTIONS');
        expect(fighter).not.toContain('Utility spells (Detect Magic, Knock, Guidance) are narrative-gated');
        for (const caster of [wizard(1), cleric(1)]) {
            const text = prompt({ character: caster });
            expect(text).toContain('## SPELLCASTING INSTRUCTIONS (Wizard / Cleric only)');
            expect(text).toContain('The SPELLBOOK section lists every spell that mechanically exists for this hero');
            expect(text).toContain('Only spells in the SPELLBOOK exist;');
            expect(text).toContain('"spell":"<spell name from the SPELLBOOK>"');
        }
    });

    it('the martial variant is the caster variant minus exactly the section, in place, between the roll rules and COMBAT NOTES', () => {
        const fighter = prompt();
        const caster = prompt({ character: wizard(1) });
        const sectionStart = caster.indexOf('## SPELLCASTING INSTRUCTIONS');
        const sectionEnd = caster.indexOf('COMBAT NOTES — INTENT ONLY');
        expect(sectionStart).toBeGreaterThan(0);
        expect(sectionEnd).toBeGreaterThan(sectionStart);
        // Everything before the section is shared byte-for-byte...
        expect(fighter.slice(0, sectionStart)).toBe(caster.slice(0, sectionStart));
        // ...and COMBAT NOTES follows directly for the Fighter, where the section was.
        expect(fighter.indexOf('COMBAT NOTES — INTENT ONLY')).toBe(sectionStart);
        const section = caster.slice(sectionStart, sectionEnd);
        expect(section.length).toBeGreaterThan(2000);
        expect(section.length).toBeLessThan(4000);
    });

    it('each class\'s prefix stays byte-identical across turns: two Fighters, two Wizards', () => {
        const stateA = { character: makeCharacter() };
        const stateB = { character: makeCharacter({ currentHP: 1, conditions: ['Poisoned'] }), ...dynamicState };
        const cut = text => text.indexOf('## HERO IDENTITY');
        const fa = prompt(stateA);
        const fb = prompt(stateB);
        expect(fb.slice(0, cut(fb))).toBe(fa.slice(0, cut(fa)));
        const wa = prompt({ character: wizard(2) });
        const wb = prompt({ character: wizard(2, { currentHP: 1 }), ...dynamicState });
        expect(wb.slice(0, cut(wb))).toBe(wa.slice(0, cut(wa)));
    });
});

describe('INVENTORY composition (2026-09-25 inventory-economy P2 — stats on Equipped only, value on every row)', () => {
    const inventory = [
        { id: 'i1', name: 'Chain Mail', type: 'armor', armorType: 'heavy', baseAC: 16, valueCp: 7500, equipped: true },
        { id: 'i2', name: 'Shield', type: 'shield', isShield: true, shieldAC: 2, valueCp: 1000, equipped: true },
        { id: 'i3', name: 'Longsword', type: 'weapon', category: 'martialMelee', damage: '1d8', damageType: 'slashing', attackBonus: 1, damageBonus: 1, valueCp: 1500, equipped: true },
        { id: 'c1', name: 'Greataxe', type: 'weapon', category: 'martialMelee', damage: '1d12', damageType: 'slashing', valueCp: 3000, equipped: false },
        { id: 'c2', name: 'Leather Armor', type: 'armor', armorType: 'light', baseAC: 11, valueCp: 1000, equipped: false },
        { id: 'c3', name: 'Shield', type: 'shield', isShield: true, shieldAC: 2, valueCp: 1000, equipped: false },
        { id: 'c4', name: 'Torch', type: 'gear', quantity: 3, valueCp: 1, equipped: false },
        { id: 'c5', name: 'Potion of Healing', type: 'consumable', consumableType: 'healing', healing: '2d4+2', valueCp: 5000, equipped: false },
    ];

    const lineOf = (text, label) => block(text, '## INVENTORY').split('\n').find(l => l.startsWith(label));

    it('equipped rows keep AC / dice / hit annotations; carried rows are name, count, and value', () => {
        const text = prompt({ character: makeCharacter({ class: 'fighter' }), inventory });
        const equipped = lineOf(text, '**Equipped:**');
        expect(equipped).toContain('Chain Mail [AC 16, heavy armor] [value 75 gp]');
        expect(equipped).toContain('Shield [+2 AC shield] [value 10 gp]');
        expect(equipped).toContain('Longsword [1d8 slashing, +1 hit, +1 dmg] [value 15 gp]');

        const carried = lineOf(text, '**Carried:**');
        expect(carried).toBe('**Carried:** Greataxe [value 30 gp], Leather Armor [value 10 gp], Shield [value 10 gp], Torch (x3) [value 1 cp], Potion of Healing [value 50 gp]');
        expect(carried).not.toContain('1d12');
        expect(carried).not.toContain('[AC ');
        expect(carried).not.toContain('AC shield');
        // The block says why.
        expect(text).toContain('## INVENTORY (carried rows list names and values only — the engine owns every item\'s stats)');
    });

    it('the proficiency note stays on every weapon, equipped or carried (equipping one is a choice the DM narrates)', () => {
        const text = prompt({ character: makeCharacter({ class: 'wizard', skillProficiencies: [] }), inventory });
        expect(lineOf(text, '**Equipped:**')).toContain('Longsword [1d8 slashing, +1 hit, +1 dmg] [value 15 gp] [NOT proficient');
        expect(lineOf(text, '**Carried:**')).toContain('Greataxe [value 30 gp] [NOT proficient');
    });

    it('measured: at 3 equipped + 25 carried catalog rows the carried line is under half its annotated size', () => {
        const carriedRows = Array.from({ length: 25 }, (_, i) => ({
            id: `r${i}`, name: `Longsword ${i}`, type: 'weapon', category: 'martialMelee', damage: '1d8', damageType: 'slashing', valueCp: 1500, equipped: false,
        }));
        const text = prompt({ character: makeCharacter({ class: 'fighter' }), inventory: [...inventory.slice(0, 3), ...carriedRows] });
        const carried = lineOf(text, '**Carried:**');
        const annotatedGuess = carriedRows.map(r => `${r.name} [1d8 slashing] [value 15 gp]`).join(', ').length;
        expect(carried.length).toBeLessThan(annotatedGuess * 0.75);
        expect(carried).not.toContain('1d8');
    });
});
