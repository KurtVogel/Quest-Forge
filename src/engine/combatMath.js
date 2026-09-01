/**
 * Combat math kernel — the ONE implementation of the 5e attack/damage
 * mechanics shared by the exchange machine (combatExchange.js) and the
 * out-of-combat roll path (rollResolver.js).
 *
 * Before 2026-07-30 these existed as parallel copies in both files and had
 * already drifted: condition effects applied attacker-and-target-side in
 * combat but target-side-only (or not at all) out of combat, and Uncanny
 * Dodge existed only in the exchange machine. Every new class feature had to
 * be written twice. The kernel returns RAW data (kept dice, reroll pairs,
 * sneak-attack breakdowns); presentation strings stay with each caller, so
 * the two surfaces keep their established display formats.
 *
 * Rolls only ever go through rollWithModifier/parseNotation — the test dice
 * mocks queue per-die values against exactly those entry points.
 */

import { rollDice, rollWithModifier, parseNotation } from './dice.ts';
import { getEquippedWeapon, getSneakAttackDice, getConditionRollEffects, combineRollModifiers } from './rules.js';

/**
 * Combine base advantage/disadvantage with the condition effects of BOTH sides
 * of an attack (attacker's own conditions + the target's incoming-attack
 * conditions), with normal 5e cancellation.
 */
export function conditionAwareAttackModifiers(attackerConditions, targetConditions, baseAdvantage = false, baseDisadvantage = false) {
    const attacker = getConditionRollEffects(attackerConditions, 'attack');
    const target = getConditionRollEffects(targetConditions, 'incomingAttack');
    return combineRollModifiers(baseAdvantage, baseDisadvantage, {
        advantage: attacker.advantage || target.advantage,
        disadvantage: attacker.disadvantage || target.disadvantage,
        sources: [...attacker.sources, ...target.sources],
    });
}

/**
 * Roll a d20 with advantage/disadvantage (both cancel to a plain roll).
 * Returns the kept rollWithModifier result plus the raw naturals so callers
 * can build their own display strings:
 *   { roll, natural, first, second, detail }
 * `first`/`second` are null on a plain roll. `detail` is the exchange-machine
 * format ("d20 X, Y → Z"); rollResolver builds its own string from the
 * naturals. opts.secondDescription overrides the second die's description
 * (the exchange labels it "(second die)"; rollResolver keeps them identical
 * so the kept roll's history entry reads the same either way).
 */
export function rollD20Kept(modifier, description, advantage = false, disadvantage = false, { secondDescription } = {}) {
    if (advantage && disadvantage) {
        advantage = false;
        disadvantage = false;
    }
    if (!advantage && !disadvantage) {
        const roll = rollWithModifier(1, 20, modifier, description);
        return { roll, natural: roll.rolls[0], first: null, second: null, detail: '' };
    }
    const first = rollWithModifier(1, 20, modifier, description);
    const second = rollWithModifier(1, 20, modifier, secondDescription ?? `${description} (second die)`);
    const useFirst = advantage ? first.rolls[0] >= second.rolls[0] : first.rolls[0] <= second.rolls[0];
    const kept = useFirst ? first : second;
    return {
        roll: kept,
        natural: kept.rolls[0],
        first: first.rolls[0],
        second: second.rolls[0],
        detail: `d20 ${first.rolls[0]}, ${second.rolls[0]} → ${kept.rolls[0]}`,
    };
}

export function shouldUseGreatWeaponFighting(character, inventory = []) {
    if (character?.class !== 'fighter' || character.fightingStyle !== 'greatWeaponFighting') return false;
    const weapon = getEquippedWeapon(inventory);
    return !!weapon && !weapon.ranged && weapon.twoHanded;
}

/**
 * Is this natural die a critical hit for this character? 20 always; 19 for a
 * Champion Fighter (Martial Archetype, level 3+). The single source of the
 * crit rule — the exchange machine and rollResolver adapted subtly different
 * copies of this before the kernel.
 */
export function isCriticalNatural(character, natural) {
    return natural === 20 || (
        natural === 19
        && character?.class === 'fighter'
        && (character.level || 1) >= 3
        && character.martialArchetype === 'champion'
    );
}

/**
 * Stamp a d20 roll's display flags with THIS character's crit rule and return
 * whether it crit. dice.ts only knows the universal natural 20; a Champion's
 * 19 was rendered as a crit in the Dice Log out of combat but not in combat
 * (2026-08-20 audit P2 — rollResolver stamped, combatExchange pushed the roll
 * unstamped). Both attack paths now stamp through this single owner.
 */
export function stampCriticalRoll(character, roll, natural) {
    if (roll) {
        // Both attack paths pass through here, so this is where a d20 roll is
        // marked as an ATTACK: the prompt's RECENT ROLLS renders "CRITICAL
        // HIT!" only for kind 'attack' — checks, saves, initiative, and death
        // saves are plain natural 20s (2026-09-01 dice-engine P2).
        roll.kind = 'attack';
        if (!roll.isCritical && isCriticalNatural(character, natural)) {
            roll.isCritical = true;
            if (natural === 19) roll.criticalThreshold = 'Champion 19-20';
        }
    }
    return !!roll?.isCritical;
}

/**
 * Roll weapon/spell damage with crit doubling, Great Weapon Fighting rerolls,
 * and Rogue Sneak Attack. Returns raw data:
 *   { roll, total, notation, rerolls: ["2→5", ...], sneakAttackDetail: { diceCount, rolls, total } | null }
 * `roll.total` includes the sneak-attack damage (the dispatched roll-history
 * entry shows the full number).
 *
 * opts.onInvalid: 'fallback' (default) quietly rolls 1d4 for malformed
 * notation — combat must never dead-end on a bad string; 'throw' propagates,
 * for callers whose error path IS the contract (resolveDamageRoll).
 */
export function rollDamage(notation, description, {
    critical = false,
    character = null,
    inventory = [],
    advantage = false,
    disadvantage = false,
    hasAlly = false,
    onInvalid = 'fallback',
    // Generic (non-weapon-attack) damage rolls must not smuggle Sneak Attack in
    // just because the character is a rogue — only attack callers leave this on.
    includeSneakAttack = true,
} = {}) {
    let parsed;
    try {
        parsed = parseNotation(notation);
    } catch (e) {
        if (onInvalid === 'throw') throw e;
        parsed = { count: 1, sides: 4, modifier: 0 };
        notation = '1d4';
    }
    const roll = rollWithModifier(critical ? parsed.count * 2 : parsed.count, parsed.sides, parsed.modifier, description);
    const rerolls = [];
    if (character && shouldUseGreatWeaponFighting(character, inventory) && parsed.sides > 2) {
        roll.rolls = roll.rolls.map(value => {
            if (value > 2) return value;
            const replacement = rollWithModifier(1, parsed.sides, 0, `${description} reroll`).rolls[0];
            rerolls.push(`${value}→${replacement}`);
            return replacement;
        });
        roll.subtotal = roll.rolls.reduce((sum, value) => sum + value, 0);
        roll.total = roll.subtotal + parsed.modifier;
    }
    // Rogue Sneak Attack
    let sneakAttackDetail = null;
    if (includeSneakAttack && character && character.class === 'rogue') {
        const weapon = getEquippedWeapon(inventory);
        const sneakAttackDice = getSneakAttackDice(character, weapon, advantage, disadvantage, hasAlly);
        if (sneakAttackDice > 0) {
            const saDiceCount = critical ? sneakAttackDice * 2 : sneakAttackDice;
            const saRolls = rollDice(saDiceCount, 6);
            const saTotal = saRolls.reduce((sum, r) => sum + r, 0);
            roll.total += saTotal;
            sneakAttackDetail = {
                diceCount: saDiceCount,
                rolls: saRolls,
                total: saTotal,
            };
        }
    }

    return { roll, total: Math.max(0, roll.total), notation, rerolls, sneakAttackDetail };
}

/**
 * One attack-roll step: kept d20 vs AC with the crit rule stamped, the
 * natural-1 auto-miss, crit-beats-AC, and (on a hit) the damage roll. This
 * exact hit/crit/damage sequence was quadruplicated across the exchange
 * machine's player weapon strike, player spell attack, companion, and enemy
 * resolution (2026-08-27 audit); target HP bookkeeping and event fields stay
 * with each caller.
 *
 * `attacker` owns the crit rule (Champion 19-20 via stampCriticalRoll;
 * companions/enemies fall through to the universal natural 20). When `rolls`
 * is given, the attack roll (and the damage roll, if any) are pushed onto it.
 * `damage` is { notation, description, options } — rolled only on a hit,
 * with `critical` supplied here.
 */
export function resolveAttackRoll({ attacker = null, attackBonus, description, modifiers, targetAc, damage = null, rolls = null }) {
    const attack = rollD20Kept(attackBonus, description, modifiers.advantage, modifiers.disadvantage);
    if (rolls) rolls.push(attack.roll);
    const critical = stampCriticalRoll(attacker, attack.roll, attack.natural);
    const hit = attack.natural !== 1 && (critical || attack.roll.total >= targetAc);
    let damageTotal = 0;
    let damageRoll = null;
    if (hit && damage) {
        damageRoll = rollDamage(damage.notation, damage.description, { ...(damage.options || {}), critical });
        if (rolls) rolls.push(damageRoll.roll);
        damageTotal = damageRoll.total;
    }
    return { attack, natural: attack.natural, critical, hit, damage: damageTotal, damageRoll };
}

/**
 * Uncanny Dodge (Rogue 5+): halve incoming attack damage, once per turn/batch.
 * The caller owns the once-per-scope state object ({ used: boolean }).
 * Returns the (possibly halved) damage and whether it applied.
 */
export function applyUncannyDodge(character, damage, state) {
    if (
        character?.class === 'rogue'
        && (character?.level >= 5)
        && damage > 0
        && state && !state.used
    ) {
        state.used = true;
        return { damage: Math.floor(damage / 2), applied: true };
    }
    return { damage, applied: false };
}
