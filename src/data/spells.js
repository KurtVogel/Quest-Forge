/**
 * Curated spell catalog for Wizard/Cleric spellcasting v1.
 *
 * Design contract (rpg-balance-master spec, 2026-07-17 — see
 * .claude/agent-memory/rpg-balance-master/spellcasting_v1_spec.md):
 * - Model TARGETS, not shapes: "fireball" hits up to 3 named foes, no geometry.
 * - Every spell resolves through existing engine primitives only: spell attack
 *   roll vs AC, engine-rolled enemy save (d20 + saveBonus) vs caster spell DC,
 *   auto effects (damage/heal), the nine supported enemy conditions, and a
 *   single sustained-buff slot per caster (the v1 replacement for concentration).
 * - Upcasting: +`upcastPerLevel` dice per slot level above the spell's base.
 *   Condition/sustained-only spells gain nothing from upcasting.
 * - Cantrips (level 0) never cost slots; their damage scales with character
 *   level (1/2/3/4 dice at 1/5/11/17) via `cantripScaling`.
 * - Out-of-combat "utility" spells are narrative-gated: the engine validates
 *   and spends the slot; the DM adjudicates what the magic reveals or opens.
 * - Death Ward was cut from v1 (its own spec flags it "cut first under scope
 *   pressure" — it needs a clamp check at every damage-application site).
 */

export const SPELLS = {
    // --- Wizard (damage/control) ---
    fireBolt: {
        key: 'fireBolt', name: 'Fire Bolt', level: 0, classes: ['wizard'], castTime: 'action',
        targeting: { side: 'enemy', mode: 'single' }, resolution: 'attack',
        damage: { dice: '1d10', upcastPerLevel: 0, cantripScaling: true },
        combatAvailable: true, outOfCombatAvailable: false,
        summary: 'At-will fire attack (d10s scale with level).',
    },
    rayOfFrost: {
        key: 'rayOfFrost', name: 'Ray of Frost', level: 0, classes: ['wizard'], castTime: 'action',
        targeting: { side: 'enemy', mode: 'single' }, resolution: 'attack',
        damage: { dice: '1d10', upcastPerLevel: 0, cantripScaling: true },
        combatAvailable: true, outOfCombatAvailable: false,
        summary: 'At-will cold attack (d10s scale with level).',
    },
    detectMagic: {
        key: 'detectMagic', name: 'Detect Magic', level: 0, classes: ['wizard'], castTime: 'action',
        targeting: { side: 'self', mode: 'self' }, resolution: 'auto',
        combatAvailable: false, outOfCombatAvailable: true,
        summary: 'Sense magic nearby; the DM describes what is revealed.',
    },
    magicMissile: {
        key: 'magicMissile', name: 'Magic Missile', level: 1, classes: ['wizard'], castTime: 'action',
        targeting: { side: 'enemy', mode: 'single' }, resolution: 'auto',
        damage: { dice: '3d4+3', upcastPerLevel: 1 },
        combatAvailable: true, outOfCombatAvailable: false,
        summary: 'Unerring force darts — never misses, no roll to hit.',
    },
    sleep: {
        key: 'sleep', name: 'Sleep', level: 1, classes: ['wizard'], castTime: 'action',
        targeting: { side: 'enemy', mode: 'single' }, resolution: 'save', saveEffect: 'negate',
        condition: 'unconscious',
        combatAvailable: true, outOfCombatAvailable: false,
        summary: 'One foe saves or falls unconscious (wakes on taking damage).',
    },
    mageArmor: {
        key: 'mageArmor', name: 'Mage Armor', level: 1, classes: ['wizard'], castTime: 'action',
        targeting: { side: 'self', mode: 'self' }, resolution: 'auto',
        sustained: true, acBonus: 3,
        combatAvailable: true, outOfCombatAvailable: true,
        summary: 'Sustained: +3 AC on yourself (one sustained spell at a time).',
    },
    scorchingRay: {
        key: 'scorchingRay', name: 'Scorching Ray', level: 2, classes: ['wizard'], castTime: 'action',
        targeting: { side: 'enemy', mode: 'upTo3' }, resolution: 'attack',
        damage: { dice: '2d6', upcastPerLevel: 1 },
        combatAvailable: true, outOfCombatAvailable: false,
        summary: 'Fire rays at up to 3 named foes — one attack roll each.',
    },
    holdPerson: {
        key: 'holdPerson', name: 'Hold Person', level: 2, classes: ['wizard'], castTime: 'action',
        targeting: { side: 'enemy', mode: 'single' }, resolution: 'save', saveEffect: 'negate',
        condition: 'paralyzed',
        combatAvailable: true, outOfCombatAvailable: false,
        summary: 'One foe saves or is paralyzed (lift it after ~1 round of struggle).',
    },
    invisibility: {
        key: 'invisibility', name: 'Invisibility', level: 2, classes: ['wizard'], castTime: 'action',
        targeting: { side: 'ally', mode: 'single' }, resolution: 'auto',
        sustained: true, condition: 'invisible',
        combatAvailable: true, outOfCombatAvailable: true,
        summary: 'Sustained: you or a companion turn invisible until it ends.',
    },
    fireball: {
        key: 'fireball', name: 'Fireball', level: 3, classes: ['wizard'], castTime: 'action',
        targeting: { side: 'enemy', mode: 'upTo3' }, resolution: 'save', saveEffect: 'half',
        damage: { dice: '6d6', upcastPerLevel: 1 },
        combatAvailable: true, outOfCombatAvailable: false,
        summary: 'Up to 3 named foes save for half of a 6d6 blast.',
    },
    fear: {
        key: 'fear', name: 'Fear', level: 3, classes: ['wizard'], castTime: 'action',
        targeting: { side: 'enemy', mode: 'upTo3' }, resolution: 'save', saveEffect: 'negate',
        condition: 'frightened',
        combatAvailable: true, outOfCombatAvailable: false,
        summary: 'Up to 3 named foes save or are frightened.',
    },
    iceStorm: {
        key: 'iceStorm', name: 'Ice Storm', level: 4, classes: ['wizard'], castTime: 'action',
        targeting: { side: 'enemy', mode: 'upTo3' }, resolution: 'save', saveEffect: 'half',
        damage: { dice: '6d8', upcastPerLevel: 1 },
        combatAvailable: true, outOfCombatAvailable: false,
        summary: 'Up to 3 named foes save for half of a 6d8 hail.',
    },
    knock: {
        key: 'knock', name: 'Knock', level: 4, classes: ['wizard'], castTime: 'action',
        targeting: { side: 'self', mode: 'self' }, resolution: 'auto',
        combatAvailable: false, outOfCombatAvailable: true,
        summary: 'Opens one lock, bar, or arcane seal the DM presents.',
    },
    coneOfCold: {
        key: 'coneOfCold', name: 'Cone of Cold', level: 5, classes: ['wizard'], castTime: 'action',
        targeting: { side: 'enemy', mode: 'upTo3' }, resolution: 'save', saveEffect: 'half',
        damage: { dice: '8d8', upcastPerLevel: 0 },
        combatAvailable: true, outOfCombatAvailable: false,
        summary: 'Capstone blast: up to 3 named foes save for half of 8d8.',
    },
    holdMonster: {
        key: 'holdMonster', name: 'Hold Monster', level: 5, classes: ['wizard'], castTime: 'action',
        targeting: { side: 'enemy', mode: 'single' }, resolution: 'save', saveEffect: 'negate',
        condition: 'paralyzed',
        combatAvailable: true, outOfCombatAvailable: false,
        summary: 'Any one foe saves or is paralyzed.',
    },

    // --- Cleric (heal/support/undead) ---
    sacredFlame: {
        key: 'sacredFlame', name: 'Sacred Flame', level: 0, classes: ['cleric'], castTime: 'action',
        targeting: { side: 'enemy', mode: 'single' }, resolution: 'attack',
        damage: { dice: '1d8', upcastPerLevel: 0, cantripScaling: true },
        combatAvailable: true, outOfCombatAvailable: false,
        summary: 'At-will radiant attack (d8s scale with level).',
    },
    guidance: {
        key: 'guidance', name: 'Guidance', level: 0, classes: ['cleric'], castTime: 'action',
        targeting: { side: 'self', mode: 'self' }, resolution: 'auto',
        combatAvailable: false, outOfCombatAvailable: true,
        summary: 'A whisper of divine aid on a task at hand; the DM weighs it.',
    },
    spareTheDying: {
        key: 'spareTheDying', name: 'Spare the Dying', level: 0, classes: ['cleric'], castTime: 'action',
        targeting: { side: 'ally', mode: 'single' }, resolution: 'auto',
        stabilizes: true,
        combatAvailable: true, outOfCombatAvailable: true,
        summary: 'Stabilize a dying ally at 0 HP — restores no hit points.',
    },
    cureWounds: {
        key: 'cureWounds', name: 'Cure Wounds', level: 1, classes: ['cleric'], castTime: 'action',
        targeting: { side: 'ally', mode: 'single' }, resolution: 'auto',
        healing: { dice: '1d8', upcastPerLevel: 1, addAbilityMod: true },
        combatAvailable: true, outOfCombatAvailable: true,
        summary: 'Touch heal: 1d8+WIS (revives a dying ally, never the dead).',
    },
    shieldOfFaith: {
        key: 'shieldOfFaith', name: 'Shield of Faith', level: 1, classes: ['cleric'], castTime: 'action',
        targeting: { side: 'ally', mode: 'single' }, resolution: 'auto',
        sustained: true, acBonus: 2,
        combatAvailable: true, outOfCombatAvailable: true,
        summary: 'Sustained: +2 AC on yourself or a companion.',
    },
    command: {
        key: 'command', name: 'Command', level: 1, classes: ['cleric'], castTime: 'action',
        targeting: { side: 'enemy', mode: 'single' }, resolution: 'save', saveEffect: 'negate',
        condition: 'prone',
        combatAvailable: true, outOfCombatAvailable: false,
        summary: 'One word of divine command: the foe saves or drops prone.',
    },
    healingWord: {
        key: 'healingWord', name: 'Healing Word', level: 2, classes: ['cleric'], castTime: 'bonus',
        targeting: { side: 'ally', mode: 'single' }, resolution: 'auto',
        healing: { dice: '1d4', upcastPerLevel: 1, addAbilityMod: true },
        combatAvailable: true, outOfCombatAvailable: true,
        summary: 'Bonus action heal at range: 1d4+WIS — pairs with a normal action.',
    },
    lesserRestoration: {
        key: 'lesserRestoration', name: 'Lesser Restoration', level: 2, classes: ['cleric'], castTime: 'action',
        targeting: { side: 'ally', mode: 'single' }, resolution: 'auto',
        removeConditions: ['poisoned', 'blinded', 'restrained', 'frightened'],
        combatAvailable: true, outOfCombatAvailable: true,
        summary: 'Cleanse poison, blindness, restraint, or fear from an ally.',
    },
    spiritualWeapon: {
        key: 'spiritualWeapon', name: 'Spiritual Weapon', level: 2, classes: ['cleric'], castTime: 'action',
        targeting: { side: 'enemy', mode: 'single' }, resolution: 'attack',
        damage: { dice: '1d8', upcastPerLevel: 1, addAbilityMod: true },
        combatAvailable: true, outOfCombatAvailable: false,
        summary: 'A spectral weapon strikes: 1d8+WIS force.',
    },
    massHealingWord: {
        key: 'massHealingWord', name: 'Mass Healing Word', level: 3, classes: ['cleric'], castTime: 'bonus',
        targeting: { side: 'ally', mode: 'upTo3' }, resolution: 'auto',
        healing: { dice: '1d4', upcastPerLevel: 1, addAbilityMod: true },
        combatAvailable: true, outOfCombatAvailable: true,
        summary: 'Bonus action: heal up to 3 allies 1d4+WIS each.',
    },
    bestowCurse: {
        key: 'bestowCurse', name: 'Bestow Curse', level: 3, classes: ['cleric'], castTime: 'action',
        targeting: { side: 'enemy', mode: 'single' }, resolution: 'save', saveEffect: 'negate',
        condition: 'poisoned',
        combatAvailable: true, outOfCombatAvailable: false,
        summary: 'A withering curse: the foe saves or fights at disadvantage.',
    },
    greaterRestoration: {
        key: 'greaterRestoration', name: 'Greater Restoration', level: 4, classes: ['cleric'], castTime: 'action',
        targeting: { side: 'ally', mode: 'single' }, resolution: 'auto',
        removeConditions: 'any',
        combatAvailable: true, outOfCombatAvailable: true,
        summary: 'Cleanse any affliction — even paralysis or unconsciousness.',
    },
    massCureWounds: {
        key: 'massCureWounds', name: 'Mass Cure Wounds', level: 5, classes: ['cleric'], castTime: 'action',
        targeting: { side: 'ally', mode: 'upTo3' }, resolution: 'auto',
        healing: { dice: '2d8', upcastPerLevel: 0, addAbilityMod: true },
        combatAvailable: true, outOfCombatAvailable: true,
        summary: 'Capstone heal: up to 3 allies recover 2d8+WIS each.',
    },
    flameStrike: {
        key: 'flameStrike', name: 'Flame Strike', level: 5, classes: ['cleric'], castTime: 'action',
        targeting: { side: 'enemy', mode: 'upTo3' }, resolution: 'save', saveEffect: 'half',
        damage: { dice: '6d8', upcastPerLevel: 0 },
        combatAvailable: true, outOfCombatAvailable: false,
        summary: 'A pillar of divine fire: up to 3 named foes save for half of 6d8.',
    },
};

export const SPELL_LIST = Object.values(SPELLS);

const spellRefKey = value => String(value || '').toLowerCase().replace(/[^a-z]/g, '');

// Legacy references the DM already uses from the old basicSpellProfile contract.
const SPELL_ALIASES = {
    arcanebolt: 'fireBolt',
    divinebolt: 'sacredFlame',
    radiantbolt: 'sacredFlame',
};

const SPELL_KEY_INDEX = (() => {
    const index = new Map();
    for (const spell of SPELL_LIST) {
        index.set(spellRefKey(spell.key), spell.key);
        index.set(spellRefKey(spell.name), spell.key);
    }
    for (const [alias, key] of Object.entries(SPELL_ALIASES)) index.set(alias, key);
    return index;
})();

/** Loose spell lookup by key, display name, or legacy alias. Returns the spell or null. */
export function findSpell(ref) {
    const key = SPELL_KEY_INDEX.get(spellRefKey(ref));
    return key ? SPELLS[key] : null;
}
