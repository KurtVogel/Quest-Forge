/**
 * THE tolerant dice-notation reader (2026-11-05 strengthening P2, dice-engine
 * 10-31). Lives beside dice.ts (which re-exports it) so the notation
 * boundaries can read a notation without importing the RNG module — nineteen
 * test files mock `dice.ts` with a fixed export list.
 *
 * 5e's count-less shorthand `d8` / `d8+2` is one die, and a trailing damage
 * word ("2d6 + 3 fire", "1d8 (slashing)") is statblock spelling, not a
 * hallucination. The three notation boundaries read the SAME way —
 * `sanitizeEnemyDamage`, `boundHealingNotation` and `parseNotation` — then each
 * applies its OWN band; `d8` used to be the enemy's silent default die, a
 * heal's 2d4+2 fallback (more than written) and a thrown damage_roll.
 */

// An optional count, the die, an optional signed flat bonus, and an optional
// trailing damage TYPE that admits no digits — so multi-part damage
// ("1d8+2, plus 1d6 poison") is still not one notation.
const DICE_NOTATION_READER = /^(\d*)\s*d\s*(\d+)\s*(?:([+-])\s*(\d+))?\s*(\(?[a-z][a-z ,/()-]*)?$/i;

/**
 * One notation as written, or null when it is not one notation:
 * `{ notation, count, sides, modifier, suffix }` — `notation` is the canonical
 * spelling ("1d8", "2d6+3"; digits as written), `suffix` the dropped damage
 * word or ''. No band is applied here: a 9999999d6 reads, and the caller's
 * own band refuses it.
 */
export function normalizeDiceNotation(text) {
    if (typeof text !== 'string') return null;
    const m = text.trim().match(DICE_NOTATION_READER);
    if (!m) return null;
    const countText = m[1] || '1';
    return {
        notation: `${countText}d${m[2]}${m[3] ? `${m[3]}${m[4]}` : ''}`,
        count: parseInt(countText, 10),
        sides: parseInt(m[2], 10),
        modifier: m[3] ? parseInt(`${m[3]}${m[4]}`, 10) : 0,
        suffix: (m[5] || '').trim(),
    };
}
