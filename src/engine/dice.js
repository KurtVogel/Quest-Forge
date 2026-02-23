/**
 * Cryptographically random dice engine.
 * Uses crypto.getRandomValues() so the LLM can never influence results.
 */

let rollIdCounter = 0;

/**
 * Roll a single die with the given number of sides using crypto-random.
 * @param {number} sides - Number of sides (e.g., 20 for d20)
 * @returns {number} Result between 1 and sides (inclusive)
 */
export function rollDie(sides) {
  const array = new Uint32Array(1);
  crypto.getRandomValues(array);
  return (array[0] % sides) + 1;
}

/**
 * Roll multiple dice.
 * @param {number} count - Number of dice to roll
 * @param {number} sides - Number of sides per die
 * @returns {number[]} Array of individual roll results
 */
export function rollDice(count, sides) {
  const results = [];
  for (let i = 0; i < count; i++) {
    results.push(rollDie(sides));
  }
  return results;
}

/**
 * Roll dice with a modifier and return a detailed result object.
 * @param {number} count - Number of dice
 * @param {number} sides - Sides per die
 * @param {number} [modifier=0] - Flat modifier to add
 * @param {string} [description=''] - Description of what the roll is for
 * @returns {DiceRollResult}
 */
export function rollWithModifier(count, sides, modifier = 0, description = '') {
  const rolls = rollDice(count, sides);
  const subtotal = rolls.reduce((sum, r) => sum + r, 0);
  const total = subtotal + modifier;

  return {
    id: `roll-${Date.now()}-${++rollIdCounter}`,
    timestamp: Date.now(),
    notation: `${count}d${sides}${modifier >= 0 ? '+' + modifier : modifier}`,
    dice: { count, sides },
    rolls,
    subtotal,
    modifier,
    total,
    description,
    isCritical: sides === 20 && count === 1 && rolls[0] === 20,
    isCritFail: sides === 20 && count === 1 && rolls[0] === 1,
  };
}

/**
 * Roll a skill check (d20 + ability modifier + proficiency if applicable).
 */
export function rollSkillCheck(abilityModifier, proficiencyBonus = 0, isProficient = false, description = '') {
  const mod = abilityModifier + (isProficient ? proficiencyBonus : 0);
  return rollWithModifier(1, 20, mod, description || 'Skill Check');
}

/**
 * Roll initiative (d20 + DEX modifier).
 */
export function rollInitiative(dexModifier, description = '') {
  return rollWithModifier(1, 20, dexModifier, description || 'Initiative');
}

/**
 * Roll an ability check (d20 + ability modifier).
 */
export function rollAbilityCheck(abilityModifier, description = '') {
  return rollWithModifier(1, 20, abilityModifier, description || 'Ability Check');
}

/**
 * Roll a saving throw (d20 + ability modifier + proficiency if proficient).
 */
export function rollSavingThrow(abilityModifier, proficiencyBonus = 0, isProficient = false, description = '') {
  const mod = abilityModifier + (isProficient ? proficiencyBonus : 0);
  return rollWithModifier(1, 20, mod, description || 'Saving Throw');
}

/**
 * Parse dice notation string like "2d6+3", "1d20", "3d8-1".
 * @param {string} notation - Dice notation string
 * @returns {{ count: number, sides: number, modifier: number }}
 */
export function parseNotation(notation) {
  const match = String(notation).replace(/\s+/g, '').toLowerCase().match(/^(\d+)d(\d+)([+-]\d+)?$/);
  if (!match) {
    throw new Error(`Invalid dice notation: "${notation}"`);
  }
  return {
    count: parseInt(match[1], 10),
    sides: parseInt(match[2], 10),
    modifier: match[3] ? parseInt(match[3], 10) : 0,
  };
}

/**
 * Roll from a notation string like "2d6+3".
 */
export function rollNotation(notation, description = '') {
  const { count, sides, modifier } = parseNotation(notation);
  return rollWithModifier(count, sides, modifier, description);
}

/**
 * Standard die types available.
 */
export const DIE_TYPES = [4, 6, 8, 10, 12, 20, 100];

/**
 * @typedef {Object} DiceRollResult
 * @property {string} id - Unique roll identifier
 * @property {number} timestamp - Unix timestamp
 * @property {string} notation - Dice notation string
 * @property {{ count: number, sides: number }} dice - Dice configuration
 * @property {number[]} rolls - Individual die results
 * @property {number} subtotal - Sum of dice (before modifier)
 * @property {number} modifier - Flat modifier applied
 * @property {number} total - Final total (subtotal + modifier)
 * @property {string} description - What the roll was for
 * @property {boolean} isCritical - Natural 20 on a d20
 * @property {boolean} isCritFail - Natural 1 on a d20
 */
