/**
 * The combat narration prompt — the purpose-built user prompt of the
 * narration-only call that follows every committed exchange. The engine has
 * already resolved everything; this composes what the DM must narrate (the
 * resolved events, the authoritative post-exchange state) and the standing
 * prose rules of the lane (the telegraph, the cost). It lived in
 * engine/combatExchange.js until 2026-10-05 — an LLM prompt with rule text
 * inside the dice engine.
 */
import { describeDeathSaveCount } from '../engine/deathSaves.js';
import { exchangeEventLines } from '../engine/combatExchange.js';

/**
 * The narration prompt's PLAYER line (WOW 2026-09-30): the hero's status
 * after the exchange and, while dying, the count — so the DM plays the round
 * over the body knowing what the next die means. A result whose status a load
 * could not type renders the HP-only line.
 */
function describePlayerPostState(player) {
    const head = `${player.name} — ${player.hp}/${player.maxHp} HP`;
    switch (player.status) {
        case 'dying':
            return `- PLAYER DYING: ${head}; death saves ${describeDeathSaveCount(player.deathSaves)}. Unconscious: cannot act, speak, or be roused without healing.`;
        case 'stable':
            return `- PLAYER STABLE: ${head}; three successful death saves — unconscious, no longer dying. Not dead, not awake.`;
        case 'revived':
            return `- PLAYER REVIVED: ${head}; a natural-20 death save put them back on their feet — conscious and acting.`;
        case 'defeated':
            return `- PLAYER DEFEATED: ${head}; down but alive — a setback, never a death.`;
        case 'dead':
            return `- PLAYER DEAD: ${head}; the third failed death save. Dead — not dying, not unconscious, not coming back.`;
        default:
            return `- PLAYER: ${head}.`;
    }
}

const TELEGRAPH_RULE = 'THE FOE\'S NEXT MOVE IS ON THE PAGE: the passage\'s LAST beat is, for each ALIVE AND ACTIVE foe, its visible next move in the fiction (circling to a companion\'s blind side, nocking another arrow, backing toward the door, lowering the blade), grounded in the health word beside it — a bloodied foe fights like it, a critical foe with no reason to die fighting is on the edge of flight or plea, and the passage says which. That telegraph IS the situation returned to the player.';
const COST_RULE = 'Let the ending carry its cost: a wound the hero will feel tomorrow, named in the fiction; a companion\'s fall felt by those still standing; what was spent, remembered. Never add damage or alter the tally.';

/**
 * @param {object} result - the committed exchange result
 * @param {{ cost?: string|null, resonance?: string|null }} [options] - `cost`
 *   is `describeFightCost`'s line; it rides only a TERMINAL prompt (victory /
 *   defeat / escaped). `resonance` is `describeFightResonance`'s cue; it
 *   rides only an ONGOING one.
 */
export function combatNarrationPrompt(result, { cost = null, resonance = null } = {}) {
    const terminalEnd = ['victory', 'defeat', 'escaped'].includes(result.terminal);
    const ongoing = !result.terminal;
    // The engine terminal stays `defeat` for a dead hero (END_COMBAT's XP and
    // ledger rules are untouched); the PROMPT says DIED (WOW 2026-09-30).
    const heroDead = result.postState?.player?.status === 'dead';
    const ending = result.terminal === 'victory'
        ? 'The fight is mechanically won. Narrate the victory and its immediate fictional consequences.'
        : result.terminal === 'defeat'
            ? (heroDead
                ? `The player has DIED — the third failed death save. Narrate the death plainly and finally; the fight ends here. Do not add damage, a rescue, or a last-moment revival. SAY IT IN PLAIN WORDS — "${result.postState.player.name} is dead" or "dies" must appear in the prose; a fade to black, a last breath, or "the story ends" on its own is not the death. The count that killed them (three failed saving throws) may be named.`
                : 'The player is mechanically defeated. Narrate the setback or collapse without adding more damage.')
            : result.terminal === 'escaped'
                ? 'The player has mechanically escaped combat. Narrate the retreat without adding pursuit attacks or XP.'
            : result.terminal === 'dying'
                ? 'The player remains unconscious and dying. Narrate this round from the party\'s side — who does what over the body, and what the count means. Do not end combat or invent another attack.'
            : 'COMBAT IS STILL ACTIVE. End with the situation returned to the player for their next decision. Do not narrate victory or the end of the fight.';
    const enemyStates = result.postState?.enemies?.length
        ? result.postState.enemies.map(enemy => {
            if (enemy.status === 'defeated') return `- DEFEATED: ${enemy.name} — 0/${enemy.maxHp} HP.`;
            if (enemy.status === 'fled') return `- ALIVE, FLED: ${enemy.name} — ${enemy.hp}/${enemy.maxHp} HP.`;
            if (enemy.status === 'surrendered') return `- ALIVE, SURRENDERED: ${enemy.name} — ${enemy.hp}/${enemy.maxHp} HP.`;
            const conditions = enemy.conditions?.length ? `; conditions: ${enemy.conditions.join(', ')}` : '';
            return `- ALIVE AND ACTIVE: ${enemy.name} — ${enemy.hp}/${enemy.maxHp} HP (${enemy.condition || 'wounded'}${conditions}).`;
        })
        : result.events
            .filter(event => event.type === 'attack' && Number.isFinite(event.remainingHp))
            .map(event => event.remainingHp <= 0
                ? `- DEFEATED: ${event.target} — 0/${event.maxHp} HP.`
                : `- ALIVE AND ACTIVE: ${event.target} — ${event.remainingHp}/${event.maxHp} HP.`);
    const playerState = result.postState?.player ? describePlayerPostState(result.postState.player) : null;
    const companionStates = (result.postState?.companions || []).map(companion => (companion.hp ?? 0) <= 0
        ? `- COMPANION DOWN: ${companion.name} — 0/${companion.maxHp} HP (unconscious, not dead unless an event says so).`
        : `- COMPANION ALIVE: ${companion.name} — ${companion.hp}/${companion.maxHp} HP.`);
    const postState = [playerState, ...companionStates, ...enemyStates].filter(Boolean).join('\n');
    return [
        `[SYSTEM: Combat exchange ${result.exchangeId} has already been resolved completely by the engine.`,
        'Narrate these exact results once in one cohesive, vivid but concise passage.',
        'Do not roll, request rolls, change HP, add attacks, repeat actions, or emit JSON.',
        'Never turn a miss into a hit or invent a counterattack.',
        `The terminal state is mechanically authoritative: ${result.terminal || 'ongoing'}.`,
        'The POST-EXCHANGE STATE is absolute. Never describe an ALIVE AND ACTIVE combatant as dead, defeated, lifeless, finished, going slack, or collapsing permanently. Fled and surrendered foes may be overcome, but remain alive. Do not quote HP numbers in the prose.',
        'Do not introduce, remove, or imply a mechanical condition unless it appears in the POST-EXCHANGE STATE or resolved events.',
        ending,
        // WOW 2026-09-27 (combat-drama): the telegraph rides every ongoing
        // beat; the cost line rides the terminal one — both dynamic, once
        // per call, no new channel.
        ...(ongoing ? [TELEGRAPH_RULE] : []),
        ...(ongoing && typeof resonance === 'string' && resonance ? [resonance] : []),
        ...(terminalEnd && cost ? [cost, COST_RULE] : []),
        '',
        'POST-EXCHANGE STATE (AUTHORITATIVE):',
        postState || '- No combatant snapshot available; obey each event\'s remaining-HP statement exactly.',
        '',
        'RESOLVED EVENTS:',
        exchangeEventLines(result).join('\n'),
        ']'
    ].join('\n');
}
