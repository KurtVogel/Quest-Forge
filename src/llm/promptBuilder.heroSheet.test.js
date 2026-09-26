/**
 * 2026-09-26 rules-math Lap-3 (performance & token budget) queue sweep — the
 * prompt-side pins:
 *
 *  1. `## HERO SHEET` ENDS the cached prefix (after SPELLBOOK for a caster,
 *     after HERO IDENTITY for a martial class; before the first dynamic
 *     block): race / class + level / proficiency bonus / stats / saves /
 *     skills / speed / style / archetype / traits / features change at
 *     level-up or an ASI and never between. PLAYER CHARACTER keeps the LIVE
 *     half only (HP / EXP / AC / wealth / conditions / resources / hit dice /
 *     appearance / slots). The fourth sighting of the pattern after the
 *     premise (07-18), the identity (09-24), and the spellbook (09-25).
 *  2. INVENTORY's armor / shield annotation reads the SAME number the engine
 *     credits (`describeArmorAc` / `describeShieldAc` behind `getArmorClass`):
 *     a non-catalog magic armor granted through the `magicBonus` channel used
 *     to show `[AC 15]` on its row while the hero's AC line said 17.
 */
import { describe, expect, it } from 'vitest';
import { buildSystemPrompt } from './promptBuilder.js';
import { buildSpellSlots } from '../engine/spellcasting.js';
import { computeACFromInventory, getArmorClass } from '../engine/rules.js';
import { normalizeItem } from '../data/items.js';

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
        skillProficiencies: ['athletics', 'intimidation'],
        conditions: [],
        classResources: { secondWind: { used: 0, max: 1 } },
        hitDice: { remaining: 1, total: 1, die: 10 },
        traits: ['Versatile'],
        features: ['Fighting Style', 'Second Wind'],
        fightingStyle: 'defense',
        background: 'A disgraced lamplighter.',
        gender: 'woman',
        appearance: 'Scarred.',
        ...overrides,
    };
}

function prompt(overrides = {}) {
    return buildSystemPrompt({
        character: 'character' in overrides ? overrides.character : makeCharacter(),
        inventory: overrides.inventory ?? [],
        quests: [],
        rollHistory: [],
        preset: 'classicFantasy',
        ruleset: 'simplified5e',
        customSystemPrompt: 'Grim, grounded tone.',
        journal: [],
        npcs: [],
        party: overrides.party ?? [],
        currentLocation: overrides.currentLocation ?? 'Jewelglade',
        combat: overrides.combat ?? { active: false },
        worldFacts: [],
        locations: [],
        fronts: [],
        storyMemory: [],
        retrievedMemories: [],
        premise: 'The barony of Kolkanmaa is starving and the toll-weirs keep failing.',
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

const SHEET_LINES = ['**Race:**', '**Class:**', '**Proficiency Bonus:**', '**Stats:**', '**Saving Throws:**', '**Skill Proficiencies:**', '**Speed:**', '**Fighting Style:**', '**Traits:**', '**Features:**'];
const LIVE_LINES = ['**HP:**', '**EXP:**', '**AC:**', '**Wealth:**', '**Conditions:**', '**Resources:**', '**Hit Dice:**', '**Appearance'];

describe('## HERO SHEET ends the cached prefix (2026-09-26 rules-math P2)', () => {
    it('sits after HERO IDENTITY (martial) and before the first dynamic block, and carries every level-constant line', () => {
        const text = prompt();
        const identityAt = text.indexOf('## HERO IDENTITY');
        const sheetAt = text.indexOf('## HERO SHEET');
        const characterAt = text.indexOf('## PLAYER CHARACTER');
        expect(identityAt).toBeGreaterThan(0);
        expect(sheetAt).toBeGreaterThan(identityAt);
        expect(sheetAt).toBeLessThan(characterAt);
        // A Fighter has no spellbook: the sheet is the very next heading after the identity.
        expect(text.indexOf('\n## ', identityAt + 1)).toBe(sheetAt - 1);

        const sheet = block(text, '## HERO SHEET');
        for (const line of SHEET_LINES) expect(sheet, line).toContain(line);
        expect(sheet).toContain('**Class:** Fighter (Level 1)');
        expect(sheet).toContain('**Stats:** STR: 16 (+3)');
        expect(sheet).toContain('STR +5*');
        expect(sheet).toContain('**Skill Proficiencies:** athletics, intimidation');
        expect(sheet).toContain('**Features:** Fighting Style: Defense, Second Wind');
        for (const line of LIVE_LINES) expect(sheet, `${line} is live`).not.toContain(line);

        const live = block(text, '## PLAYER CHARACTER');
        for (const line of LIVE_LINES) expect(live, line).toContain(line);
        for (const line of SHEET_LINES) expect(live, `${line} is constant`).not.toContain(line);
    });

    it('a caster: after SPELLBOOK, still before PLAYER CHARACTER', () => {
        const text = prompt({ character: makeCharacter({ class: 'wizard', level: 3, spellSlots: buildSpellSlots(3), features: ['Arcane Recovery'], fightingStyle: undefined }) });
        const spellbookAt = text.indexOf('## SPELLBOOK');
        const sheetAt = text.indexOf('## HERO SHEET');
        expect(spellbookAt).toBeGreaterThan(0);
        expect(text.indexOf('\n## ', spellbookAt + 1)).toBe(sheetAt - 1);
        expect(sheetAt).toBeLessThan(text.indexOf('## PLAYER CHARACTER'));
        expect(block(text, '## HERO SHEET')).toContain('**Class:** Wizard (Level 3)');
    });

    it('keeps every byte through the sheet identical across turns that take damage, earn XP, spend coin, gain a condition, spend a resource and hit dice, change AC, and change the look', () => {
        const base = makeCharacter();
        const a = prompt({ character: base });
        const b = prompt({
            character: {
                ...base,
                currentHP: 3,
                exp: 250,
                armorClass: 18,
                gold: 0,
                silver: 40,
                conditions: ['Poisoned'],
                classResources: { secondWind: { used: 1, max: 1 } },
                hitDice: { remaining: 0, total: 1, die: 10 },
                appearance: 'Scarred, and now limping.',
            },
            party: [{ id: 'c1', name: 'Osma', hp: 9, maxHp: 18, ac: 16, level: 2, affinity: 60 }],
            combat: { active: true, round: 2, bonusActionUsed: true, enemies: [], turnOrder: [], phase: 'awaiting_player' },
        });
        const sheet = block(a, '## HERO SHEET');
        const prefixEnd = a.indexOf(sheet) + sheet.length;
        expect(prefixEnd).toBeLessThan(a.indexOf('## PLAYER CHARACTER'));
        expect(b.slice(0, prefixEnd)).toBe(a.slice(0, prefixEnd));
        // The next heading after the sheet is already dynamic state.
        expect(a.indexOf('\n## ', a.indexOf('## HERO SHEET') + 1)).toBeGreaterThanOrEqual(prefixEnd);
        // The live block moved with the state.
        const live = block(b, '## PLAYER CHARACTER');
        expect(live).toContain('**HP:** 3/12');
        expect(live).toContain('**Conditions:** Poisoned');
        expect(live).toContain('**Bonus Action This Turn:** used');
    });

    it('a level-up or an ASI changes the sheet and nothing in the prefix before it; the live block keeps its line count', () => {
        const l1 = prompt({ character: makeCharacter() });
        const l5 = prompt({ character: makeCharacter({ level: 5, exp: 6500, maxHP: 44, currentHP: 44, abilityScores: { strength: 18, dexterity: 12, constitution: 14, intelligence: 10, wisdom: 10, charisma: 8 }, features: ['Fighting Style', 'Second Wind', 'Action Surge', 'Martial Archetype', 'Extra Attack'], martialArchetype: 'champion' }) });
        const sheetAt = l1.indexOf('## HERO SHEET');
        expect(l5.slice(0, sheetAt)).toBe(l1.slice(0, sheetAt));
        const sheet = block(l5, '## HERO SHEET');
        expect(sheet).toContain('**Class:** Fighter (Level 5)');
        expect(sheet).toContain('**Proficiency Bonus:** +3');
        expect(sheet).toContain('STR: 18 (+4)');
        expect(sheet).toContain('**Martial Archetype:** Champion');
        expect(sheet).toContain('Extra Attack');
        const liveLines = text => block(text, '## PLAYER CHARACTER').split('\n').length;
        expect(liveLines(l5)).toBe(liveLines(l1));
    });

    it('renders no sheet and never throws for a character without ability scores (hostile save)', () => {
        const text = prompt({ character: makeCharacter({ abilityScores: 'junk' }) });
        expect(text).not.toContain('## HERO SHEET');
        expect(text).toContain('## PLAYER CHARACTER');
    });
});

describe('INVENTORY armor annotation agrees with the engine (2026-09-26 rules-math P2, Lap-1/4 spill)', () => {
    const character = makeCharacter({ abilityScores: { strength: 14, dexterity: 14, constitution: 14, intelligence: 10, wisdom: 10, charisma: 8 } });
    const lineOf = (text, label) => block(text, '## INVENTORY').split('\n').find(l => l.startsWith(label));

    it('a non-catalog magic armor granted through magicBonus shows the AC the engine credits', () => {
        // The DM's channel: `magicBonus`, no `acBonus`. normalizeItem folds it only for CATALOG armor.
        const elven = normalizeItem({ name: 'Elven mail', type: 'armor', armorType: 'medium', baseAC: 15, magicBonus: 2, equipped: true, valueCp: 40000 });
        expect(elven.acBonus).toBe(0);
        const buckler = normalizeItem({ name: 'Runed buckler', type: 'shield', isShield: true, shieldAC: 2, magicBonus: 1, equipped: true, valueCp: 20000 });
        const inventory = [elven, buckler];
        const text = prompt({ character, inventory });
        const equipped = lineOf(text, '**Equipped:**');
        expect(equipped).toContain('Elven mail +2 [AC 17, medium armor]');
        expect(equipped).toContain('Runed buckler +1 [+3 AC shield]');
        // ONE number: the row's AC + DEX (capped at 2 for medium) + the shield = the engine's AC.
        expect(getArmorClass(2, elven, buckler)).toBe(17 + 2 + 3);
        expect(computeACFromInventory(inventory, character)).toBe(17 + 2 + 3 + 1); // + Defense style
    });

    it('a hostile row clamps in the annotation exactly as in the engine, and a junk baseAC advertises no number', () => {
        const runaway = { id: 'r', name: 'Godplate', type: 'armor', armorType: 'heavy', baseAC: 25, acBonus: 9, equipped: true, valueCp: 1 };
        const junk = { id: 'j', name: 'Mist robe', type: 'armor', armorType: 'light', baseAC: 'lots', equipped: true, valueCp: 1 };
        const text = prompt({ character, inventory: [runaway, junk] });
        const equipped = lineOf(text, '**Equipped:**');
        expect(equipped).toContain('Godplate [AC 21, heavy armor]');
        expect(getArmorClass(2, runaway)).toBe(21);
        expect(equipped).toContain('Mist robe [value');
        expect(equipped).not.toContain('Mist robe [AC');
    });
});
