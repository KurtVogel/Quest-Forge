/**
 * Race definitions — simplified D&D 5e-inspired.
 */

export const RACES = {
    human: {
        name: 'Human',
        description: 'Versatile and ambitious, humans are the most adaptable of all races.',
        abilityBonuses: { strength: 1, dexterity: 1, constitution: 1, intelligence: 1, wisdom: 1, charisma: 1 },
        speed: 30,
        traits: ['Versatile (+1 to all ability scores)', 'Extra language'],
        languages: ['Common', 'One extra language'],
    },
    elf: {
        name: 'Elf',
        description: 'Graceful and long-lived, elves are attuned to magic and nature.',
        abilityBonuses: { dexterity: 2 },
        speed: 30,
        traits: ['Darkvision (60 ft)', 'Keen Senses (Perception proficiency)', 'Fey Ancestry', 'Trance (4 hours rest)'],
        languages: ['Common', 'Elvish'],
    },
    dwarf: {
        name: 'Dwarf',
        description: 'Stout and sturdy, dwarves are master craftsmen and fierce warriors.',
        abilityBonuses: { constitution: 2 },
        speed: 25,
        traits: ['Darkvision (60 ft)', 'Dwarven Resilience (poison resistance)', 'Stonecunning'],
        languages: ['Common', 'Dwarvish'],
    },
    halfling: {
        name: 'Halfling',
        description: 'Small but brave, halflings are nimble and remarkably lucky.',
        abilityBonuses: { dexterity: 2 },
        speed: 25,
        traits: ['Lucky (reroll natural 1s on attacks/checks/saves)', 'Brave (advantage vs. frightened)', 'Halfling Nimbleness'],
        languages: ['Common', 'Halfling'],
    },
    halfOrc: {
        name: 'Half-Orc',
        description: 'Powerful and enduring, half-orcs combine human cunning with orcish might.',
        abilityBonuses: { strength: 2, constitution: 1 },
        speed: 30,
        traits: ['Darkvision (60 ft)', 'Menacing (Intimidation proficiency)', 'Relentless Endurance', 'Savage Attacks'],
        languages: ['Common', 'Orc'],
    },
    tiefling: {
        name: 'Tiefling',
        description: 'Bearing the mark of an infernal heritage, tieflings are both feared and fascinating.',
        abilityBonuses: { intelligence: 1, charisma: 2 },
        speed: 30,
        traits: ['Darkvision (60 ft)', 'Hellish Resistance (fire resistance)', 'Infernal Legacy (Thaumaturgy cantrip)'],
        languages: ['Common', 'Infernal'],
    },
    dragonborn: {
        name: 'Dragonborn',
        description: 'Proud and honourable, dragonborn carry the blood of dragons.',
        abilityBonuses: { strength: 2, charisma: 1 },
        speed: 30,
        traits: ['Draconic Ancestry', 'Breath Weapon', 'Damage Resistance (based on ancestry)'],
        languages: ['Common', 'Draconic'],
    },
    gnome: {
        name: 'Gnome',
        description: 'Curious and inventive, gnomes delight in life and discovery.',
        abilityBonuses: { intelligence: 2 },
        speed: 25,
        traits: ['Darkvision (60 ft)', 'Gnome Cunning (advantage on INT/WIS/CHA saves vs. magic)'],
        languages: ['Common', 'Gnomish'],
    },
};

export const RACE_LIST = Object.keys(RACES);
