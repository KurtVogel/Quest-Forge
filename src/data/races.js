/**
 * Race definitions — simplified D&D 5e-inspired.
 * Core four races, each with distinct mechanical identity.
 */

export const RACES = {
    human: {
        name: 'Human',
        description: 'Versatile and ambitious, humans are the most adaptable of all races.',
        abilityBonuses: { strength: 1, dexterity: 1, constitution: 1 },
        speed: 30,
        skillProficiencies: [], // Humans get no bonus skill — their strength is stat flexibility
        traits: ['Versatile (+1 STR, DEX, CON)', 'Extra language'],
        languages: ['Common', 'One extra language'],
    },
    elf: {
        name: 'Elf',
        description: 'Graceful and long-lived, elves are attuned to magic and nature.',
        abilityBonuses: { dexterity: 2 },
        speed: 30,
        skillProficiencies: ['perception'], // Keen Senses — coded, not just flavor
        traits: ['Darkvision (60 ft)', 'Keen Senses (Perception proficiency)', 'Fey Ancestry (advantage vs. charm)', 'Trance (4 hours rest)'],
        languages: ['Common', 'Elvish'],
    },
    dwarf: {
        name: 'Dwarf',
        description: 'Stout and sturdy, dwarves are master craftsmen and fierce warriors.',
        abilityBonuses: { constitution: 2 },
        speed: 25,
        skillProficiencies: [],
        traits: ['Darkvision (60 ft)', 'Dwarven Resilience (poison resistance)'],
        languages: ['Common', 'Dwarvish'],
    },
    halfOrc: {
        name: 'Half-Orc',
        description: 'Powerful and enduring, half-orcs combine human cunning with orcish might.',
        abilityBonuses: { strength: 2, constitution: 1 },
        speed: 30,
        skillProficiencies: ['intimidation'], // Menacing — coded, not just flavor
        traits: ['Darkvision (60 ft)', 'Menacing (Intimidation proficiency)', 'Relentless Endurance (drop to 1 HP instead of 0, once per long rest)', 'Savage Attacks (extra crit damage die)'],
        languages: ['Common', 'Orc'],
    },
};

export const RACE_LIST = Object.keys(RACES);
