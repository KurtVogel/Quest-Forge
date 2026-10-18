/**
 * The combat predicates — the three questions every layer asks of a fight
 * (the prompt, applyEvents, the load heal, the resolver, the reducer handlers,
 * the Combat panel) plus the phase names. Split out of combatExchange.js on
 * 2026-10-05: eight files imported the whole 2,500-line exchange engine for
 * these few lines.
 */
import { enemyOutcome } from './enemyStats.js';
import { getIncapacitatingCondition } from './rules.js';

export const COMBAT_PHASES = Object.freeze({
    OPENING: 'opening',
    AWAITING_PLAYER: 'awaiting_player',
    AWAITING_INTENT: 'awaiting_intent',
    AWAITING_NARRATION: 'awaiting_narration',
});

/** Still a combatant: above 0 HP, not dead, not fled, not surrendered. */
export function isEnemyActive(enemy) {
    return !!enemy && enemyOutcome(enemy) === 'active';
}

export function isCompanionActive(companion) {
    return !!companion
        && (companion.hp ?? 0) > 0
        && companion.status !== 'downed'
        && companion.status !== 'dead';
}

/**
 * THE low-level-solo predicate — the one answer to "is this 0-HP moment a
 * non-lethal setback or real dying/death?" (DECISIONS.md 2026-07-17, 2026-09-02).
 * "Solo" means no companion who can actually fight: a party whose only
 * companion is downed leaves the hero exactly as exposed as having none.
 * Every consumer (TAKE_DAMAGE, DEATH_SAVE_RESULT, the exchange's post-state
 * snapshot on BOTH the not-yet-dying and the dying branch, applyEvents'
 * player_death, the out-of-combat death-save resolver, the prompt safety
 * block) must ask this LIVE at its decision point — never cache it in a flag
 * and never re-derive it with a local party check.
 */
export function isLowLevelSolo(character, party = []) {
    return !!character && (character.level ?? 1) <= 2 && !(party || []).some(isCompanionActive);
}

/**
 * The hero's OWN incapacity (2026-10-17 audit P1 + P2): a STABLE hero — 0 HP,
 * not dying (three successful death saves), not the low-level defeat — or one
 * carrying a stunned / paralyzed / unconscious condition at HP above 0 cannot
 * act. It is the predicate the enemy phase asks of every foe and CAST_SPELL
 * asks of the hero out of combat; the exchange validator, START_COMBAT and the
 * prompt's STATUS line read it here. Dead / defeated / dying heroes have their
 * own branches (the death save is a dying hero's one legal slot) and read
 * null. Returns `{ kind: 'stable' | 'condition', condition, text }` or null.
 */
export function describeHeroIncapacity(character) {
    if (!character || typeof character !== 'object') return null;
    if (character.isDead || character.lowLevelDefeat || character.dying) return null;
    const name = heroName(character);
    if (Number.isFinite(character.currentHP) && character.currentHP <= 0) {
        return { kind: 'stable', condition: 'unconscious', text: `${name} is unconscious at 0 HP (stable, not dying)` };
    }
    const condition = getIncapacitatingCondition(character.conditions);
    if (condition) return { kind: 'condition', condition, text: `${name} is ${condition}` };
    return null;
}

const heroName = (character) => (typeof character.name === 'string' && character.name.trim() ? character.name.trim() : 'The hero');

/**
 * Every state in which the hero cannot ACT (2026-10-18 roll-resolution P2):
 * dead, the low-level defeat, dying, and `describeHeroIncapacity`'s stable /
 * condition cases. The out-of-combat check lane reads it — a DYING hero asked
 * for an Athletics check used to roll `1d20+6` at full modifier, a stable or
 * paralyzed hero both Extra Attack strikes — the third actor site of the 10-17
 * rule (CAST_SPELL, the exchange validator, now the resolver). Saving throws
 * are NOT gated by it (a CON save against poison while dying is legitimate);
 * death saves have their own lane. Returns `{ kind, text }` or null.
 */
export function describeHeroCannotAct(character) {
    if (!character || typeof character !== 'object') return null;
    const name = heroName(character);
    if (character.isDead) return { kind: 'dead', text: `${name} is dead` };
    if (character.lowLevelDefeat) return { kind: 'defeated', text: `${name} is down at 0 HP (defeated)` };
    if (character.dying) return { kind: 'dying', text: `${name} is dying at 0 HP` };
    return describeHeroIncapacity(character);
}
