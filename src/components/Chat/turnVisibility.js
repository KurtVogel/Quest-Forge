/**
 * Pure turn-orchestration policy, extracted from ChatPanel so the rules that
 * decide what the player SEES (withheld roll setups) and what the DM REMEMBERS
 * (the sliding message window) are unit-testable outside the component.
 *
 * Visibility and mutation deferral are separate concerns:
 * - hideSetup: should this response's narration be withheld from the chat?
 * - setupPhase: should outcome mutations be deferred until dice resolve?
 */

import { MESSAGE_CONTENT_MAX } from '../../config/contentLimits.js';

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
        || !!events?._playerAuthorityRollRejected
        // An attack staged as a check: the invalid setup narration is superseded
        // by the combat_start correction response, exactly like the no-dice case.
        || !!events?._attackAsCheckRejected;
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
 * from, and lines stamped `dmVisible` — coin/item movement receipts (grants,
 * charges, audit recoveries, duplicate suppressions). Without those the DM was
 * structurally blind to engine coin/loot accounting (2026-08-31 P1: victory
 * narration's reward was audit-granted invisibly, so the DM re-emitted it at
 * quest completion and double-paid). Combat-exchange result lines
 * (`exchangeLine`) are the exception to the roll-line exception (DECISIONS.md
 * 2026-08-04): the narration call receives them as RESOLVED EVENTS and the
 * narration prose then owns the fiction, so keeping them here starved the
 * window (~8 of 20 slots per round with a full field).
 * System lines travel as `user` role — providers only accept user/assistant.
 *
 * Consecutive receipts fold into ONE window row (2026-09-25 inventory-economy
 * Lap-3 P2): a six-purchase + reward response posted seven `dmVisible` lines,
 * and because the window counts ROWS, they held seven of the twenty slots for
 * the next ~3 turns (a third of the DM's history displaced by 227 chars) and
 * reached the provider as seven consecutive `user` turns. A run of receipts
 * with no fiction between them is one receipt, joined by newlines — the same
 * bytes, one slot, one turn. Roll lines and fiction break the run.
 *
 * The window never carries the line the call is about to send
 * (2026-10-01 chat-orchestration P1): the player's row is dispatched before
 * the turn starts, and whether it is already in `messages` when the window is
 * read depends on whether an `await` preceded the read (the query embed lets
 * React flush). When it was, both providers appended the same text again as
 * `userMessage` — the DM was told the action twice on every ordinary and
 * table-talk turn. `pendingUserMessage` names that line: the newest player row
 * with no DM reply after it is dropped when it is exactly this text, so the
 * result is the same whichever side of the flush the read lands on.
 *
 * @param {Array<object>} messages - full chat history from state.
 * @param {number} windowSize - max messages to keep (MESSAGE_WINDOW).
 * @param {object} [options]
 * @param {string|null} [options.pendingUserMessage] - the player row this
 *   call sends as its own `userMessage`.
 * @returns {Array<{role: string, content: string}>}
 */
export function buildMessageWindow(messages, windowSize, { pendingUserMessage = null } = {}) {
    const unsummarized = (messages || []).filter(m => {
        if (m.summarized || m.hidden || m.deleted || m.exchangeLine) return false;
        if (m.role === 'system') {
            return m.dmVisible === true || /rolled \*\*/i.test(m.content || '');
        }
        return true;
    });
    if (typeof pendingUserMessage === 'string' && pendingUserMessage) {
        // Every unanswered copy goes, not only the newest (grand playtest
        // 2026-10-02): a turn that failed (a provider 503 posts a `kind:
        // 'error'` line, which the window skips) leaves its player row behind,
        // and the player resends the same line — after four failures the DM
        // read the action five times. Walk back to the last DM reply; a
        // DIFFERENT unanswered line is the player's own words and stays.
        for (let i = unsummarized.length - 1; i >= 0; i--) {
            const m = unsummarized[i];
            if (m.role === 'assistant') break;
            if (m.role === 'user' && m.content === pendingUserMessage) unsummarized.splice(i, 1);
        }
    }
    // A resent line rides once, on every lane and every later turn (grand
    // playtest 2026-10-02): the pending-line drop above covers only the call
    // that sends it, and a combat narration call (its userMessage is the
    // engine's prompt) carried three failed copies of "I attack it again".
    // A player row identical to the NEXT player row with no DM reply between
    // them is a failed attempt — the later copy is the one that was answered.
    for (let i = unsummarized.length - 1; i >= 0; i--) {
        const m = unsummarized[i];
        if (m.role !== 'user') continue;
        for (let j = i + 1; j < unsummarized.length; j++) {
            const next = unsummarized[j];
            if (next.role === 'assistant') break;
            if (next.role === 'user') {
                if (next.content === m.content) unsummarized.splice(i, 1);
                break;
            }
        }
    }
    // The belt behind the LOAD_GAME row heal: the window never carries a
    // non-string or an unbounded row to a provider (2026-09-19 audit P2).
    const text = m => (typeof m.content === 'string' ? m.content.slice(0, MESSAGE_CONTENT_MAX) : '');
    const isReceipt = m => m.role === 'system' && m.dmVisible === true;
    const rows = [];
    for (const m of unsummarized) {
        const last = rows[rows.length - 1];
        if (isReceipt(m) && last?.receipt) {
            last.content = `${last.content}\n${text(m)}`.slice(0, MESSAGE_CONTENT_MAX);
            continue;
        }
        rows.push({ role: m.role, content: text(m), receipt: isReceipt(m) });
    }
    return rows.slice(-windowSize).map(m => ({
        role: m.role === 'system' ? 'user' : m.role,
        content: m.content,
    }));
}
