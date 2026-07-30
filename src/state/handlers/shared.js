/**
 * Helpers shared by multiple reducer domains and the save-migration pipeline
 * (migrations.js). Single-domain helpers live in their domain module instead.
 */
import { isCompanionActive } from '../../engine/combatExchange.js';

export function systemMessage(content, extra = {}) {
    return {
        id: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        timestamp: Date.now(),
        role: 'system',
        content,
        ...extra,
    };
}

/** Mark a character as dead (3 failed death saves or a fatal narrative event). */
export function applyDeath(character) {
    return { ...character, isDead: true, dying: false, deathSaves: { successes: 0, failures: 0 } };
}

export function isLowLevelSolo(character, party = []) {
    // "Solo" means no companion who can actually fight — a party whose only
    // companion is downed leaves the hero exactly as exposed as having none.
    // Must match terminalState's semantic in combatExchange.js, or the exchange
    // can close combat as a defeat-setback while this reducer starts death saves.
    return !!character && (character.level ?? 1) <= 2 && !(party || []).some(isCompanionActive);
}

export function withCondition(character, condition) {
    const conditions = character.conditions || [];
    if (conditions.some(c => c.toLowerCase() === condition.toLowerCase())) return character;
    return { ...character, conditions: [...conditions, condition] };
}

/** Convert an early low-level knockout into a setback instead of campaign-ending death. */
export function applyEarlyDefeat(character) {
    return withCondition({
        ...character,
        currentHP: 0,
        dying: false,
        lowLevelDefeat: true,
        deathSaves: { successes: 0, failures: 0 },
    }, 'Unconscious');
}

/** Bring a dying/stable character back to consciousness (healing or a nat-20 death save). */
export function reviveCharacter(character) {
    return {
        ...character,
        dying: false,
        lowLevelDefeat: false,
        deathSaves: { successes: 0, failures: 0 },
        conditions: (character.conditions || []).filter(c => c.toLowerCase() !== 'unconscious'),
    };
}
