/**
 * The combat predicates — the three questions every layer asks of a fight
 * (the prompt, applyEvents, the load heal, the resolver, the reducer handlers,
 * the Combat panel) plus the phase names. Split out of combatExchange.js on
 * 2026-10-05: eight files imported the whole 2,500-line exchange engine for
 * these few lines.
 */
import { enemyOutcome } from './enemyStats.js';

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
