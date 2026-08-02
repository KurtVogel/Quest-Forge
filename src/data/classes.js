/**
 * Class definitions — simplified D&D 5e-inspired.
 * Core four classes, each with distinct mechanical identity.
 *
 * `features` — text descriptions granted at each level (shown on character sheet, sent to LLM)
 * `resources` — tracked per-rest abilities with real mechanical backing
 * `numSkillChoices` — how many skills the player picks at character creation
 * `abilityGuidance` — creation-time advice: `priority` orders all six abilities
 *   best-first for this class (the standard array is offered in that order), and
 *   `notes` explains WHY in terms of what this engine actually does with the score.
 *   Advice only — the player is free to ignore it.
 */

export const CLASSES = {
    fighter: {
        name: 'Fighter',
        description: 'Masters of martial combat, fighters excel with weapons and armor.',
        hitDie: 10,
        primaryAbility: 'strength',
        savingThrows: ['strength', 'constitution'],
        abilityGuidance: {
            priority: ['strength', 'constitution', 'dexterity', 'wisdom', 'charisma', 'intelligence'],
            notes: {
                strength: 'Your attack and damage rolls with melee weapons — how often you hit and how hard.',
                constitution: 'Hit points at every level, and one of your two saving-throw proficiencies.',
                dexterity: 'Initiative order. Your heavy armour ignores Dexterity for AC, so it matters less here.',
                wisdom: 'Perception, and the saves that resist fear and charm.',
                charisma: 'Intimidating or talking your way out of a fight.',
                intelligence: 'Rarely called for as a Fighter — the safest place for your lowest score.',
            },
            // Archery fights at range: the bow rolls off Dexterity, so the whole
            // spread flips. Chosen on the previous step, so it is known here.
            byFightingStyle: {
                archery: {
                    priority: ['dexterity', 'constitution', 'strength', 'wisdom', 'charisma', 'intelligence'],
                    notes: {
                        dexterity: 'Attack and damage with your bow (plus initiative) — Archery makes this your main stat.',
                        strength: 'Melee weapons, shoving and hauling — a backup once you fight at range.',
                    },
                },
            },
        },
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
            8: ['Ability Score Improvement'],
            12: ['Ability Score Improvement'],
            16: ['Ability Score Improvement'],
            19: ['Ability Score Improvement'],
        },
        fightingStyles: {
            defense: {
                label: 'Defense',
                description: '+1 AC while wearing armor',
            },
            dueling: {
                label: 'Dueling',
                description: '+2 damage with a one-handed melee weapon',
            },
            greatWeaponFighting: {
                label: 'Great Weapon Fighting',
                description: 'Reroll 1s and 2s on damage dice with two-handed melee weapons',
            },
            archery: {
                label: 'Archery',
                description: '+2 to attack rolls with ranged weapons',
            },
        },
        martialArchetypes: {
            champion: {
                label: 'Champion',
                description: 'Weapon attacks score a critical hit on a natural 19 or 20',
                minLevel: 3,
            },
        },
        resources: {
            secondWind: {
                label: 'Second Wind',
                description: 'Heal 1d10 + fighter level HP as a bonus action',
                max: 1,
                resetOn: 'short',
                minLevel: 1,
                actionType: 'bonus',
                effect: { kind: 'heal', dice: '1d10', addLevel: true },
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
        abilityGuidance: {
            priority: ['intelligence', 'constitution', 'dexterity', 'wisdom', 'charisma', 'strength'],
            notes: {
                intelligence: 'Your spell attack bonus and the save DC enemies must beat — every spell you cast runs on it.',
                constitution: 'You have the smallest hit die (d6); Constitution is what keeps you standing.',
                dexterity: 'You wear no armour, so your AC is 10 + Dexterity. Also initiative.',
                wisdom: 'Your second saving-throw proficiency, and Perception.',
                charisma: 'Only for social scenes — your magic never uses it.',
                strength: 'A Wizard almost never rolls Strength. The safest place for your lowest score.',
            },
        },
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
            8: ['Ability Score Improvement'],
            12: ['Ability Score Improvement'],
            16: ['Ability Score Improvement'],
            19: ['Ability Score Improvement'],
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
        abilityGuidance: {
            priority: ['dexterity', 'constitution', 'wisdom', 'intelligence', 'charisma', 'strength'],
            notes: {
                dexterity: 'Attack and damage with rapier and bow, your AC in light armour, initiative and Stealth.',
                constitution: 'Hit points at every level — you fight up close with a d8 hit die.',
                wisdom: 'Perception and Insight, the checks a scout makes most, plus the most common saves.',
                intelligence: 'Investigation, and your second saving-throw proficiency.',
                charisma: 'Deception and Persuasion, if you play the con artist rather than the burglar.',
                strength: 'Finesse weapons use Dexterity instead — safe to dump.',
            },
        },
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
            8: ['Ability Score Improvement'],
            12: ['Ability Score Improvement'],
            16: ['Ability Score Improvement'],
            19: ['Ability Score Improvement'],
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
        abilityGuidance: {
            priority: ['wisdom', 'constitution', 'strength', 'dexterity', 'charisma', 'intelligence'],
            notes: {
                wisdom: 'Your spell attack bonus, the save DC enemies must beat, and how much your healing restores.',
                constitution: 'Hit points at every level — you stand in the front line beside the fighters.',
                strength: 'Swinging your mace when the spell slots run dry.',
                dexterity: 'Your scale mail caps its AC bonus at +2, so a little goes a long way. Also initiative.',
                charisma: 'Persuasion, and your second saving-throw proficiency.',
                intelligence: 'Least used by a Cleric — the safest place for your lowest score.',
            },
        },
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
            8: ['Ability Score Improvement'],
            12: ['Ability Score Improvement'],
            16: ['Ability Score Improvement'],
            19: ['Ability Score Improvement'],
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
