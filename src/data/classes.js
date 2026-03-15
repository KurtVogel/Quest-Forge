/**
 * Class definitions — simplified D&D 5e-inspired.
 * Core four classes, each with distinct mechanical identity.
 *
 * `features` — text descriptions granted at each level (shown on character sheet, sent to LLM)
 * `resources` — tracked per-rest abilities with real mechanical backing
 * `numSkillChoices` — how many skills the player picks at character creation
 */

export const CLASSES = {
    fighter: {
        name: 'Fighter',
        description: 'Masters of martial combat, fighters excel with weapons and armor.',
        hitDie: 10,
        primaryAbility: 'strength',
        savingThrows: ['strength', 'constitution'],
        armorProficiencies: ['light', 'medium', 'heavy', 'shields'],
        weaponProficiencies: ['simple', 'martial'],
        skillChoices: ['acrobatics', 'athletics', 'intimidation', 'perception', 'survival', 'animalHandling'],
        numSkillChoices: 2,
        features: {
            1: ['Second Wind', 'Fighting Style'],
            2: ['Action Surge'],
            3: ['Martial Archetype'],
            4: ['Ability Score Improvement'],
            5: ['Extra Attack'],
        },
        resources: {
            secondWind: {
                label: 'Second Wind',
                description: 'Heal 1d10 + fighter level HP as a bonus action',
                max: 1,
                resetOn: 'short',
                minLevel: 1,
            },
            actionSurge: {
                label: 'Action Surge',
                description: 'Take one additional action on your turn',
                max: 1,
                resetOn: 'short',
                minLevel: 2,
            },
        },
        startingEquipment: [
            { name: 'Chain Mail', type: 'armor', armorType: 'heavy', baseAC: 16, weight: 55 },
            { name: 'Longsword', type: 'weapon', damage: '1d8', damageType: 'slashing', weight: 3 },
            { name: 'Shield', type: 'shield', isShield: true, weight: 6 },
            { name: "Explorer's Pack", type: 'gear', weight: 10 },
        ],
    },
    wizard: {
        name: 'Wizard',
        description: 'Scholarly magic-users who harness arcane power through study and intellect.',
        hitDie: 6,
        primaryAbility: 'intelligence',
        savingThrows: ['intelligence', 'wisdom'],
        armorProficiencies: [],
        weaponProficiencies: ['daggers', 'darts', 'slings', 'quarterstaffs', 'light crossbows'],
        skillChoices: ['arcana', 'history', 'insight', 'investigation', 'medicine', 'religion'],
        numSkillChoices: 2,
        features: {
            1: ['Spellcasting', 'Arcane Recovery'],
            2: ['Arcane Tradition'],
            3: ['2nd-Level Spells'],
            4: ['Ability Score Improvement'],
            5: ['3rd-Level Spells'],
        },
        resources: {
            arcaneRecovery: {
                label: 'Arcane Recovery',
                description: 'Recover spent spell energy during a short rest',
                max: 1,
                resetOn: 'long',
                minLevel: 1,
            },
        },
        startingEquipment: [
            { name: 'Quarterstaff', type: 'weapon', damage: '1d6', damageType: 'bludgeoning', weight: 4 },
            { name: 'Spellbook', type: 'gear', weight: 3 },
            { name: "Scholar's Pack", type: 'gear', weight: 10 },
            { name: 'Component Pouch', type: 'gear', weight: 2 },
        ],
    },
    rogue: {
        name: 'Rogue',
        description: 'Cunning and stealthy, rogues rely on skill, precision, and guile.',
        hitDie: 8,
        primaryAbility: 'dexterity',
        savingThrows: ['dexterity', 'intelligence'],
        armorProficiencies: ['light'],
        weaponProficiencies: ['simple', 'hand crossbows', 'longswords', 'rapiers', 'shortswords'],
        skillChoices: ['acrobatics', 'athletics', 'deception', 'insight', 'intimidation', 'investigation', 'perception', 'performance', 'persuasion', 'sleightOfHand', 'stealth'],
        numSkillChoices: 4, // Rogues are the skill class — they get 4
        features: {
            1: ['Sneak Attack (1d6)', 'Expertise', "Thieves' Cant"],
            2: ['Cunning Action'],
            3: ['Roguish Archetype', 'Sneak Attack (2d6)'],
            4: ['Ability Score Improvement'],
            5: ['Uncanny Dodge', 'Sneak Attack (3d6)'],
        },
        resources: {
            // Sneak Attack and Cunning Action are passive — no resource tracking needed
        },
        startingEquipment: [
            { name: 'Leather Armor', type: 'armor', armorType: 'light', baseAC: 11, weight: 10 },
            { name: 'Rapier', type: 'weapon', damage: '1d8', damageType: 'piercing', weight: 2 },
            { name: 'Shortbow', type: 'weapon', damage: '1d6', damageType: 'piercing', weight: 2 },
            { name: "Burglar's Pack", type: 'gear', weight: 10 },
            { name: "Thieves' Tools", type: 'gear', weight: 1 },
        ],
    },
    cleric: {
        name: 'Cleric',
        description: 'Divine spellcasters who channel the power of their deity to heal and protect.',
        hitDie: 8,
        primaryAbility: 'wisdom',
        savingThrows: ['wisdom', 'charisma'],
        armorProficiencies: ['light', 'medium', 'shields'],
        weaponProficiencies: ['simple'],
        skillChoices: ['history', 'insight', 'medicine', 'persuasion', 'religion'],
        numSkillChoices: 2,
        features: {
            1: ['Spellcasting', 'Divine Domain'],
            2: ['Channel Divinity'],
            3: ['2nd-Level Spells'],
            4: ['Ability Score Improvement'],
            5: ['Destroy Undead', '3rd-Level Spells'],
        },
        resources: {
            channelDivinity: {
                label: 'Channel Divinity',
                description: 'Channel divine energy for a powerful effect',
                max: 1,
                resetOn: 'short',
                minLevel: 2,
            },
        },
        startingEquipment: [
            { name: 'Scale Mail', type: 'armor', armorType: 'medium', baseAC: 14, weight: 45 },
            { name: 'Mace', type: 'weapon', damage: '1d6', damageType: 'bludgeoning', weight: 4 },
            { name: 'Shield', type: 'shield', isShield: true, weight: 6 },
            { name: "Priest's Pack", type: 'gear', weight: 10 },
            { name: 'Holy Symbol', type: 'gear', weight: 1 },
        ],
    },
};

export const CLASS_LIST = Object.keys(CLASSES);
