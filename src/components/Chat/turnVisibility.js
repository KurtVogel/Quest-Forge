/**
 * Pure turn-orchestration policy, extracted from ChatPanel so the rules that
 * decide what the player SEES (withheld roll setups) and what the DM REMEMBERS
 * (the sliding message window) are unit-testable outside the component.
 *
 * Visibility and mutation deferral are separate concerns:
 * - hideSetup: should this response's narration be withheld from the chat?
 * - setupPhase: should outcome mutations be deferred until dice resolve?
 */

/**
 * Derive the withheld-setup flags for a parsed DM response.
 *
 * Any narration that still has PENDING ROLLS is a "setup" the post-roll
 * narration will supersede, so it is withheld: the DM narrates the whole beat
 * once, AFTER the dice resolve. This holds for CHAINED rolls too — keying on
 * pending rolls alone (never on it being the player's first action) is what
 * keeps chained setups hidden.
 *
 * EXCEPTION: a check the Scribe extracted from natural prose (no JSON) reads
 * like a real DM asking for a roll mid-scene. That narration is a complete
 * beat, not a withheld setup — hiding it would retroactively erase fiction the
 * player already read. It stays visible with the proposal staged beneath it,
 * unless it pre-narrated the outcome or was rejected as a player-authority
 * override.
 *
 * @param {object|null} events - normalized events from parseResponse (with the
 *   underscore-prefixed orchestration flags ChatPanel stamps on them).
 * @returns {{ proposalFromProse: boolean, setupPhase: boolean, hideSetup: boolean }}
 */
export function deriveSetupVisibility(events) {
    const proposalFromProse = !!events?._textRollDetected
        && !events?._preNarratedOutcome
        && !events?._playerAuthorityRollRejected
        && events?.requestedRolls?.length > 0;
    const setupPhase = events?.requestedRolls?.length > 0
        || !!events?.combatExchange
        || !!events?._playerAuthorityRollRejected;
    return { proposalFromProse, setupPhase, hideSetup: setupPhase && !proposalFromProse };
}

/**
 * Drop a combat_exchange the DM emitted while no combat is live. There is no
 * machine to resolve it (typical case: the hero is DYING after END_COMBAT and
 * the DM pattern-matches the in-combat death-save flow), and leaving it on the
 * events object would both hide the response's narration (the setup policy
 * above) and dead-end in a plan rejection the reducer silently ignores when
 * combat is inactive — swallowing the whole response. A combat_start in the
 * same response keeps its exchange: that is the legitimate in-medias-res
 * opening flow.
 *
 * @param {object|null} events - normalized events from parseResponse.
 * @param {boolean} combatActive - live combat.active at response time.
 * @returns {boolean} true when an orphan exchange was dropped (mutates events).
 */
export function dropOrphanCombatExchange(events, combatActive) {
    if (!events?.combatExchange || combatActive || events.combatStart) return false;
    delete events.combatExchange;
    return true;
}

/**
 * Build the sliding-window message history for the LLM.
 *
 * Drops summarized messages (the journal owns them), hidden messages (withheld
 * setups were intentionally superseded by authoritative roll/exchange results —
 * sending them back can bias the narrator toward a pre-rolled outcome), and
 * system chatter EXCEPT engine roll-result lines, which the DM needs to narrate
 * from. System lines travel as `user` role — providers only accept user/assistant.
 *
 * @param {Array<object>} messages - full chat history from state.
 * @param {number} windowSize - max messages to keep (MESSAGE_WINDOW).
 * @returns {Array<{role: string, content: string}>}
 */
export function buildMessageWindow(messages, windowSize) {
    const unsummarized = (messages || []).filter(m => {
        if (m.summarized || m.hidden) return false;
        if (m.role === 'system') {
            return /rolled \*\*/i.test(m.content || '');
        }
        return true;
    });
    return unsummarized.slice(-windowSize).map(m => ({
        role: m.role === 'system' ? 'user' : m.role,
        content: m.content,
    }));
}
