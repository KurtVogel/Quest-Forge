/**
 * Cryptographically random dice engine.
 * Uses crypto.getRandomValues() so the LLM can never influence results.
 */

export interface DiceRollResult {
  id: string;
  timestamp: number;
  notation: string;
  dice: { count: number; sides: number };
  rolls: number[];
  subtotal: number;
  modifier: number;
  total: number;
  description: string;
  isCritical: boolean;
  isCritFail: boolean;
}

let rollIdCounter = 0;

/**
 * Roll a single die with the given number of sides using crypto-random.
 */
export function rollDie(sides: number): number {
  const array = new Uint32Array(1);
  crypto.getRandomValues(array);
  return (array[0] % sides) + 1;
}

/**
 * Roll multiple dice.
 */
export function rollDice(count: number, sides: number): number[] {
  const results: number[] = [];
  for (let i = 0; i < count; i++) {
    results.push(rollDie(sides));
  }
  return results;
}

/**
 * Roll dice with a modifier and return a detailed result object.
 */
export function rollWithModifier(
  count: number,
  sides: number,
  modifier: number = 0,
  description: string = ''
): DiceRollResult {
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
export function rollSkillCheck(
  abilityModifier: number,
  proficiencyBonus: number = 0,
  isProficient: boolean = false,
  description: string = ''
): DiceRollResult {
  const mod = abilityModifier + (isProficient ? proficiencyBonus : 0);
  return rollWithModifier(1, 20, mod, description || 'Skill Check');
}

/**
 * Roll initiative (d20 + DEX modifier).
 */
export function rollInitiative(dexModifier: number, description: string = ''): DiceRollResult {
  return rollWithModifier(1, 20, dexModifier, description || 'Initiative');
}

/**
 * Roll an ability check (d20 + ability modifier).
 */
export function rollAbilityCheck(abilityModifier: number, description: string = ''): DiceRollResult {
  return rollWithModifier(1, 20, abilityModifier, description || 'Ability Check');
}

/**
 * Roll a saving throw (d20 + ability modifier + proficiency if proficient).
 */
export function rollSavingThrow(
  abilityModifier: number,
  proficiencyBonus: number = 0,
  isProficient: boolean = false,
  description: string = ''
): DiceRollResult {
  const mod = abilityModifier + (isProficient ? proficiencyBonus : 0);
  return rollWithModifier(1, 20, mod, description || 'Saving Throw');
}

/**
 * Parse dice notation string like "2d6+3", "1d20", "3d8-1".
 */
export function parseNotation(notation: string): { count: number; sides: number; modifier: number } {
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
export function rollNotation(notation: string, description: string = ''): DiceRollResult {
  const { count, sides, modifier } = parseNotation(notation);
  return rollWithModifier(count, sides, modifier, description);
}

/**
 * Standard die types available.
 */
export const DIE_TYPES: number[] = [4, 6, 8, 10, 12, 20, 100];
