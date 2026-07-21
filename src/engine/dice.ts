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

// Upper bound for hostile input at the notation boundary: LLM-authored damage/healing
// notations and hand-edited save/hero files are valid *syntax* at any size, so
// "9999999d6" must fail loudly like "1d0" does instead of looping the tab to death.
// 100 dice covers every legitimate game roll with a wide margin.
export const MAX_DICE_COUNT = 100;
// Looser engine-level backstop so internal doubling (crit rolls take parsed.count * 2)
// can never trip it — this catches programming errors, not LLM input.
const DICE_COUNT_BACKSTOP = 1000;

/**
 * Roll a single die with the given number of sides using crypto-random.
 */
export function rollDie(sides: number): number {
  // `x % 0` is NaN in JS and NaN is sticky through every downstream sum —
  // a corrupted "1d0" profile must fail loudly here, not poison HP math silently.
  if (!Number.isInteger(sides) || sides <= 0) {
    throw new Error(`Invalid die: d${sides}`);
  }
  // Rejection-sample away the modulo bias: raw Uint32 % sides slightly favors low
  // faces on non-power-of-2 dice (~1 in 2^32 — negligible, but the crypto-fair
  // guarantee should be exact). Values in the truncated final cycle are re-rolled;
  // for any playable die the rejection chance is < 1 in 60000 per draw.
  const limit = 0x100000000 - (0x100000000 % sides);
  const array = new Uint32Array(1);
  let value: number;
  do {
    crypto.getRandomValues(array);
    value = array[0];
  } while (value >= limit);
  return (value % sides) + 1;
}

/**
 * Roll multiple dice.
 */
export function rollDice(count: number, sides: number): number[] {
  if (!Number.isInteger(count) || count < 1 || count > DICE_COUNT_BACKSTOP) {
    throw new Error(`Invalid dice count: ${count}`);
  }
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
  const count = parseInt(match[1], 10);
  const sides = parseInt(match[2], 10);
  // The regex accepts "0d6", "1d0", and "9999999d6"; the first two would silently
  // produce empty or NaN rolls downstream, the last would freeze the tab rolling
  // millions of dice. Reject all of them like any other malformed notation.
  if (count < 1 || sides < 1 || count > MAX_DICE_COUNT) {
    throw new Error(`Invalid dice notation: "${notation}"`);
  }
  return {
    count,
    sides,
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
