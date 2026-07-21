/**
 * Pure events-routing policy for a parsed DM response, extracted from ChatPanel's
 * handleSend closure (2026-07-21 strengthening finding: the malformed-output
 * routing switch was 0%-tested inside the component — a regression that let
 * in-combat requested_rolls fall through to a free LLM-authored enemy attack
 * would have passed the whole suite). ChatPanel owns the side effects (dispatch,
 * staging, follow-up calls); this module owns the DECISION of which one runs.
 *
 * Route priority is load-bearing and mirrors the old switch exactly:
 * 1. combatExchangeRejected — a malformed intent envelope must reject the plan,
 *    never fall through to any roll path.
 * 2. combatExchange (without a same-response combat_start) — the live-combat
 *    machine. With combat_start present the exchange rides START_COMBAT's
 *    queuedExchange instead, so routing falls through past this branch.
 * 3. requestedRolls while combat is live or starting — rejected. Active combat
 *    NEVER falls back to legacy LLM-authored roll batches; an invalid envelope
 *    costs nobody a turn and cannot produce a free enemy attack.
 * 4. requestedRolls outside combat — staged as a roleplay-check proposal (dice
 *    do not exist until the player accepts the public adjudication).
 * 5. _playerAuthorityRollRejected — every proposed roll was rejected as a
 *    player-authority override; request a no-roll roleplay response.
 * 6. Plain narrative — nothing to orchestrate.
 */

export const TURN_ROUTES = {
    COMBAT_REJECTED: 'combat_rejected',
    COMBAT_EXCHANGE: 'combat_exchange',
    IN_COMBAT_ROLLS_REJECTED: 'in_combat_rolls_rejected',
    ROLL_PROPOSAL: 'roll_proposal',
    AUTHORITY_CORRECTION: 'authority_correction',
    NARRATIVE: 'narrative',
};

/**
 * Loot the DM (incorrectly) attached to a roll-proposal response. It is never
 * granted client-side at this point — it rides the proposal as metadata and
 * returns to the DM as a grant-or-deny reminder in the post-roll outcome.
 *
 * @returns {{goldFound:number,silverFound:number,copperFound:number,itemsFound:Array}|null}
 */
export function extractProposalLoot(events) {
    if (!events) return null;
    const hasLoot = events.goldFound || events.silverFound || events.copperFound
        || events.itemsFound?.length;
    if (!hasLoot) return null;
    return {
        goldFound: events.goldFound || 0,
        silverFound: events.silverFound || 0,
        copperFound: events.copperFound || 0,
        itemsFound: events.itemsFound || [],
    };
}

/**
 * Decide how ChatPanel should orchestrate this response's events.
 *
 * @param {object|null} events - normalized events from parseResponse (with the
 *   underscore-prefixed orchestration flags ChatPanel stamps on them).
 * @param {object} opts
 * @param {boolean} opts.combatWasActive - combat.active when the response landed.
 * @returns {{ route: string, combatIntentHandled: boolean, reason?: string, proposalLoot?: object|null }}
 *   `reason` is the player-facing rejection reason for REJECT_COMBAT_EXCHANGE
 *   routes; `combatIntentHandled` tells a combat-intent turn whether to CANCEL.
 */
export function routeTurnEvents(events, { combatWasActive = false } = {}) {
    const combatStartedNow = !!events?.combatStart;
    if (events?.combatExchangeRejected) {
        return {
            route: TURN_ROUTES.COMBAT_REJECTED,
            combatIntentHandled: true,
            reason: 'The DM returned a malformed combat intent envelope.',
        };
    }
    if (events?.combatExchange && !combatStartedNow) {
        return { route: TURN_ROUTES.COMBAT_EXCHANGE, combatIntentHandled: true };
    }
    if (events?.requestedRolls?.length > 0 && (combatWasActive || combatStartedNow)) {
        return {
            route: TURN_ROUTES.IN_COMBAT_ROLLS_REJECTED,
            combatIntentHandled: true,
            reason: 'The DM requested legacy combat rolls instead of a committed action envelope.',
        };
    }
    if (events?.requestedRolls?.length > 0) {
        return {
            route: TURN_ROUTES.ROLL_PROPOSAL,
            combatIntentHandled: false,
            proposalLoot: extractProposalLoot(events),
        };
    }
    if (events?._playerAuthorityRollRejected) {
        return { route: TURN_ROUTES.AUTHORITY_CORRECTION, combatIntentHandled: false };
    }
    return { route: TURN_ROUTES.NARRATIVE, combatIntentHandled: false };
}

/**
 * JSON-only spell_cast backstop: some DMs answer "I cast Detect Magic" with
 * nothing but the event block (pattern-matching combat's two-phase flow), so the
 * engine spends the slot while the player stares at an empty message. True when
 * ChatPanel must request the missing narration explicitly. Roll-setup turns
 * defer the cast, and live combat has its own narration call — never here.
 */
export function needsSpellCastNarration(events, { dmNarrative, combatIntentHandled, combatActive }) {
    return !!(events?.spellCasts?.length > 0
        && !String(dmNarrative || '').trim()
        && !combatIntentHandled
        && !(events?.requestedRolls?.length > 0)
        && !combatActive);
}
