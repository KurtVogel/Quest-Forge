/**
 * Class definitions — simplified D&D 5e-inspired.
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
        features: {
            1: ['Second Wind (heal 1d10+level once per short rest)', 'Fighting Style'],
        },
        startingEquipment: [
            { name: 'Chain Mail', type: 'armor', armorType: 'heavy', baseAC: 16, weight: 55 },
            { name: 'Longsword', type: 'weapon', damage: '1d8', damageType: 'slashing', weight: 3 },
            { name: 'Shield', type: 'armor', isShield: true, weight: 6 },
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
        features: {
            1: ['Arcane Recovery (recover spell slots on short rest)', 'Spellcasting'],
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
        features: {
            1: ['Sneak Attack (1d6 extra damage)', 'Expertise (double proficiency on 2 skills)', "Thieves' Cant"],
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
        features: {
            1: ['Spellcasting', 'Divine Domain'],
        },
        startingEquipment: [
            { name: 'Scale Mail', type: 'armor', armorType: 'medium', baseAC: 14, weight: 45 },
            { name: 'Mace', type: 'weapon', damage: '1d6', damageType: 'bludgeoning', weight: 4 },
            { name: 'Shield', type: 'armor', isShield: true, weight: 6 },
            { name: "Priest's Pack", type: 'gear', weight: 10 },
            { name: 'Holy Symbol', type: 'gear', weight: 1 },
        ],
    },
    ranger: {
        name: 'Ranger',
        description: 'Skilled hunters and trackers who protect the wilds from threats.',
        hitDie: 10,
        primaryAbility: 'dexterity',
        savingThrows: ['strength', 'dexterity'],
        armorProficiencies: ['light', 'medium', 'shields'],
        weaponProficiencies: ['simple', 'martial'],
        skillChoices: ['animalHandling', 'athletics', 'insight', 'investigation', 'nature', 'perception', 'stealth', 'survival'],
        features: {
            1: ['Favoured Enemy', 'Natural Explorer'],
        },
        startingEquipment: [
            { name: 'Leather Armor', type: 'armor', armorType: 'light', baseAC: 11, weight: 10 },
            { name: 'Longbow', type: 'weapon', damage: '1d8', damageType: 'piercing', weight: 2 },
            { name: 'Shortsword', type: 'weapon', damage: '1d6', damageType: 'piercing', weight: 2 },
            { name: "Explorer's Pack", type: 'gear', weight: 10 },
            { name: 'Arrows (20)', type: 'ammunition', weight: 1 },
        ],
    },
    bard: {
        name: 'Bard',
        description: 'Charismatic performers who weave magic through music and words.',
        hitDie: 8,
        primaryAbility: 'charisma',
        savingThrows: ['dexterity', 'charisma'],
        armorProficiencies: ['light'],
        weaponProficiencies: ['simple', 'hand crossbows', 'longswords', 'rapiers', 'shortswords'],
        skillChoices: ['acrobatics', 'animalHandling', 'arcana', 'athletics', 'deception', 'history', 'insight', 'intimidation', 'investigation', 'medicine', 'nature', 'perception', 'performance', 'persuasion', 'religion', 'sleightOfHand', 'stealth', 'survival'],
        features: {
            1: ['Spellcasting', 'Bardic Inspiration (d6)'],
        },
        startingEquipment: [
            { name: 'Leather Armor', type: 'armor', armorType: 'light', baseAC: 11, weight: 10 },
            { name: 'Rapier', type: 'weapon', damage: '1d8', damageType: 'piercing', weight: 2 },
            { name: 'Lute', type: 'gear', weight: 2 },
            { name: "Entertainer's Pack", type: 'gear', weight: 10 },
        ],
    },
};

export const CLASS_LIST = Object.keys(CLASSES);
