/**
 * Tests for the character vault: export round-trips and, above all, the
 * import sanitizer — import files are hand-editable, so the engine must
 * validate identity fields and rebuild derived ones rather than trust them.
 */
import { describe, it, expect } from 'vitest';
import {
    EXPORT_FORMAT,
    EXPORT_VERSION,
    buildCharacterExport,
    characterExportFilename,
    sanitizeCharacter,
    sanitizeInventory,
    parseCharacterExport,
} from './characterVault.js';
import { createCharacter, createStartingInventory } from './characterUtils.js';
import { getProficiencyBonus } from './rules.js';

const BASE_SCORES = { strength: 15, dexterity: 13, constitution: 14, intelligence: 10, wisdom: 12, charisma: 8 };

function makeFighter() {
    const character = createCharacter('Borin', 'dwarf', 'fighter', BASE_SCORES, ['athletics', 'perception']);
    const inventory = createStartingInventory('fighter');
    return { character, inventory };
}

describe('export round-trip', () => {
    it('a freshly created character survives export → JSON → import', () => {
        const { character, inventory } = makeFighter();
        const file = JSON.stringify(buildCharacterExport(character, inventory));
        const imported = parseCharacterExport(file);

        expect(imported.character.name).toBe('Borin');
        expect(imported.character.race).toBe('dwarf');
        expect(imported.character.class).toBe('fighter');
        expect(imported.character.fightingStyle).toBe('defense');
        expect(imported.character.level).toBe(1);
        expect(imported.character.maxHP).toBe(character.maxHP);
        expect(imported.character.abilityScores).toEqual(character.abilityScores);
        expect(imported.character.skillProficiencies).toEqual(expect.arrayContaining(['athletics', 'perception']));
        expect(imported.inventory).toHaveLength(inventory.length);
    });

    it('imports arrive rested: full HP, no conditions, fresh resources', () => {
        const { character, inventory } = makeFighter();
        const wounded = {
            ...character,
            currentHP: 1,
            tempHP: 4,
            conditions: ['poisoned'],
            classResources: { secondWind: { used: 1, max: 1 } },
            hitDice: { total: 1, remaining: 0, die: 10 },
        };
        const imported = parseCharacterExport(JSON.stringify(buildCharacterExport(wounded, inventory)));

        expect(imported.character.currentHP).toBe(imported.character.maxHP);
        expect(imported.character.tempHP).toBe(0);
        expect(imported.character.conditions).toEqual([]);
        expect(imported.character.classResources.secondWind.used).toBe(0);
        expect(imported.character.hitDice).toEqual({ total: 1, remaining: 1, die: 10 });
    });

    it('assigns a fresh id so importing twice yields two roster entries', () => {
        const { character, inventory } = makeFighter();
        const file = JSON.stringify(buildCharacterExport(character, inventory));
        const a = parseCharacterExport(file);
        const b = parseCharacterExport(file);
        expect(a.character.id).not.toBe(b.character.id);
    });

    it('preserves confirmed appearance and safe portrait fields', () => {
        const { character, inventory } = makeFighter();
        const portraitUrl = 'data:image/jpeg;base64,/9j/4AAQSkZJRg==';
        const file = JSON.stringify(buildCharacterExport({
            ...character,
            appearance: 'Broad dwarf with a black braided beard and a broken nose.',
            portraitUrl,
            portraitPrompt: 'Waist-up dwarf fighter portrait.',
            portraitUpdatedAt: 12345,
        }, inventory));
        const imported = parseCharacterExport(file);

        expect(imported.character.appearance).toContain('black braided beard');
        expect(imported.character.portraitUrl).toBe(portraitUrl);
        expect(imported.character.portraitPrompt).toBe('Waist-up dwarf fighter portrait.');
        expect(imported.character.portraitUpdatedAt).toBe(12345);
    });
});

describe('parseCharacterExport rejections', () => {
    it('rejects non-JSON, foreign files, and unsupported versions', () => {
        expect(() => parseCharacterExport('not json {')).toThrow(/JSON/);
        expect(() => parseCharacterExport('{"foo": 1}')).toThrow(/Quest Forge/);
        expect(() => parseCharacterExport(JSON.stringify({ format: EXPORT_FORMAT, version: EXPORT_VERSION + 1, character: {} })))
            .toThrow(/version/);
    });

    it('rejects characters with cut/unknown races or classes', () => {
        const { character, inventory } = makeFighter();
        const asBard = buildCharacterExport({ ...character, class: 'bard' }, inventory);
        expect(() => parseCharacterExport(JSON.stringify(asBard))).toThrow(/class "bard"/);
        const asGnome = buildCharacterExport({ ...character, race: 'gnome' }, inventory);
        expect(() => parseCharacterExport(JSON.stringify(asGnome))).toThrow(/race "gnome"/);
    });

    it('rejects a character missing a name or an ability score', () => {
        const { character } = makeFighter();
        expect(() => sanitizeCharacter({ ...character, name: '   ' })).toThrow(/name/);
        const scores = { ...character.abilityScores };
        delete scores.wisdom;
        expect(() => sanitizeCharacter({ ...character, abilityScores: scores })).toThrow(/wisdom/);
    });
});

describe('sanitizeCharacter clamps and rebuilds', () => {
    it('clamps level, coin, and exp to sane ranges', () => {
        const { character } = makeFighter();
        const cheated = sanitizeCharacter({
            ...character,
            level: 99,
            gold: -50,
            silver: 10_000_000,
            exp: 999_999,
        });
        expect(cheated.level).toBe(20);
        expect(cheated.gold).toBe(0);
        expect(cheated.silver).toBe(1_000_000);
        // exp stays below the next-level threshold (level 20+ reuses the final D&D 5e increment, 50000)
        expect(cheated.exp).toBe(50000 - 1);
    });

    it('clamps maxHP to what the class could actually have rolled', () => {
        const { character } = makeFighter();
        // L1 dwarf fighter, CON 16 (+3): only legal value is 10 + 3 = 13
        expect(sanitizeCharacter({ ...character, maxHP: 999 }).maxHP).toBe(13);
        expect(sanitizeCharacter({ ...character, maxHP: -5 }).maxHP).toBe(13);
    });

    it('recomputes maxHP exactly for heroes created after the fixed-average-HP decision', () => {
        const { character } = makeFighter();
        // L5 fighter, CON 16 (+3): deterministic maxHP is 13 + 9*4 = 49. A hand-edited
        // 65 sat inside the legacy rolled-HP band and used to import undetected.
        const modern = sanitizeCharacter({
            ...character,
            level: 5,
            maxHP: 65,
            createdAt: Date.UTC(2026, 6, 1), // after the 2026-06-15 decision
        });
        expect(modern.maxHP).toBe(49);
        expect(modern.currentHP).toBe(49);
    });

    it('keeps the legacy rolled-HP band for pre-decision heroes', () => {
        const { character } = makeFighter();
        // Created before fixed-average HP: rolled level-ups made 65 genuinely reachable.
        const legacy = sanitizeCharacter({
            ...character,
            level: 5,
            maxHP: 65,
            createdAt: Date.UTC(2026, 0, 10),
        });
        expect(legacy.maxHP).toBe(65);
        // Values beyond the band still clamp.
        const inflated = sanitizeCharacter({
            ...character,
            level: 5,
            maxHP: 999,
            createdAt: Date.UTC(2026, 0, 10),
        });
        expect(inflated.maxHP).toBe(65);
    });

    it('rejects a correctly-shaped export whose character key is null', () => {
        const file = JSON.stringify({ format: EXPORT_FORMAT, version: EXPORT_VERSION, character: null, inventory: [] });
        expect(() => parseCharacterExport(file)).toThrow('No character data found in this file.');
        expect(() => sanitizeCharacter(null)).toThrow('No character data found in this file.');
        expect(() => sanitizeCharacter(undefined)).toThrow('No character data found in this file.');
    });

    it('rebuilds derived fields from class data instead of trusting the file', () => {
        const { character } = makeFighter();
        const tampered = sanitizeCharacter({
            ...character,
            level: 5,
            proficiencyBonus: 9,
            savingThrowProficiencies: ['charisma'],
            features: ['Wish'],
            speed: 90,
        });
        expect(tampered.proficiencyBonus).toBe(getProficiencyBonus(5));
        expect(tampered.savingThrowProficiencies).toEqual(['strength', 'constitution']);
        expect(tampered.fightingStyle).toBe('defense');
        expect(tampered.martialArchetype).toBe('champion');
        expect(tampered.pendingAbilityScoreImprovements).toBe(1);
        expect(tampered.features).toContain('Extra Attack');
        expect(tampered.features).not.toContain('Wish');
        expect(tampered.speed).toBe(25); // dwarf speed comes from race data
        expect(tampered.classResources.actionSurge).toBeDefined(); // L2+ resource present at L5
    });

    it('preserves already-applied Ability Score Improvements on import', () => {
        const { character } = makeFighter();
        const clean = sanitizeCharacter({
            ...character,
            level: 4,
            abilityScoreImprovementsApplied: 1,
            pendingAbilityScoreImprovements: 0,
            features: ['Second Wind', 'Fighting Style', 'Action Surge', 'Martial Archetype', 'Ability Score Improvement'],
        });

        expect(clean.abilityScoreImprovementsApplied).toBe(1);
        expect(clean.pendingAbilityScoreImprovements).toBe(0);
    });

    it('filters unknown skills and re-grants racial ones', () => {
        const { character } = makeFighter();
        const clean = sanitizeCharacter({
            ...character,
            race: 'elf',
            skillProficiencies: ['athletics', 'lockpicking', 'flying'],
            expertiseSkills: ['athletics', 'lockpicking'],
        });
        expect(clean.skillProficiencies).toEqual(expect.arrayContaining(['athletics', 'perception']));
        expect(clean.skillProficiencies).not.toContain('lockpicking');
        expect(clean.expertiseSkills).toEqual(['athletics']);
    });

    it('strips unsafe portrait URLs from imported files', () => {
        const { character } = makeFighter();
        const clean = sanitizeCharacter({
            ...character,
            portraitUrl: 'javascript:alert(1)',
        });

        expect(clean.portraitUrl).toBe('');
    });
});

describe('sanitizeInventory', () => {
    it('returns [] for junk and clamps magic bonuses via normalizeItem', () => {
        expect(sanitizeInventory(null)).toEqual([]);
        expect(sanitizeInventory('stuff')).toEqual([]);
        const [sword] = sanitizeInventory([{ name: 'Longsword', type: 'weapon', magicBonus: 7 }]);
        expect(sword.magicBonus).toBe(3);
    });

    it('keeps at most one equipped weapon, armor, and shield', () => {
        const items = sanitizeInventory([
            { name: 'Longsword', type: 'weapon', equipped: true },
            { name: 'Dagger', type: 'weapon', equipped: true },
            { name: 'Chain Mail', type: 'armor', baseAC: 16, equipped: true },
            { name: 'Leather Armor', type: 'armor', baseAC: 11, equipped: true },
        ]);
        const equippedWeapons = items.filter(i => i.type === 'weapon' && i.equipped);
        const equippedArmor = items.filter(i => i.type === 'armor' && i.equipped);
        expect(equippedWeapons).toHaveLength(1);
        expect(equippedWeapons[0].name).toBe('Longsword');
        expect(equippedArmor).toHaveLength(1);
        expect(equippedArmor[0].name).toBe('Chain Mail');
    });

    it('does not import a shield equipped with a two-handed weapon', () => {
        const items = sanitizeInventory([
            { name: 'Greatsword', type: 'weapon', twoHanded: true, equipped: true },
            { name: 'Shield', type: 'shield', isShield: true, equipped: true },
        ]);

        expect(items.find(i => i.name === 'Greatsword').equipped).toBe(true);
        expect(items.find(i => i.name === 'Shield').equipped).toBe(false);
    });
});

describe('characterExportFilename', () => {
    it('slugs the hero name and falls back gracefully', () => {
        expect(characterExportFilename({ name: "Sir Kael O'Brien" })).toBe('questforge-sir-kael-o-brien.json');
        expect(characterExportFilename({ name: '???' })).toBe('questforge-hero.json');
        expect(characterExportFilename(null)).toBe('questforge-hero.json');
    });
});
