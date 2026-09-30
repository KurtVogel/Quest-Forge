/**
 * The last chapter (WOW 2026-09-30, death-and-stakes W1): a hero's death is
 * an ENDING the game writes, not a "spirit/successor" prompt.
 *
 * On `isDead` by any route — the third failed death save in a fight (END_COMBAT
 * owns it there, after the terminal narration), the out-of-combat death save
 * or fatal blow (the character handlers own it there), or the DM's narrative
 * `player_death` (applyEvents) — the reducer's RECORD_HERO_DEATH posts ONE
 * engine epitaph line, stamps `session.heroDeath`, and raises the Chronicle
 * tab's chapter-close nudge with `reason: 'death'`. This module is the pure
 * half: the epitaph's wording, the cause derived from the fight tally, the
 * campaign-length count, and the load-boundary sanitizer (complete-or-null,
 * the livingWorldSession pattern). Zero LLM calls; the epilogue is the ending
 * card's one player-initiated table-talk call (llm/tableTalk.js).
 */
import { classDisplayName, raceDisplayName } from './characterUtils.js';
import { LOCATION_NAME_MAX } from '../config/contentLimits.js';

/** The clamp on a death's cause — a `player_death` description is DM prose. */
export const HERO_DEATH_CAUSE_MAX = 240;
const HERO_LEVEL_MAX = 20;
const MAX_NAMED_FOES = 3;

const text = (value, max) => (typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, max) : '');

/** Strip a trailing sentence stop so the epitaph can end the sentence itself. */
function unstop(value) {
    return value.replace(/[.!…]+$/u, '').trim();
}

function joinNames(names) {
    if (names.length <= 1) return names[0] || '';
    if (names.length === 2) return `${names[0]} and ${names[1]}`;
    return `${names.slice(0, -1).join(', ')}, and ${names[names.length - 1]}`;
}

/**
 * How many TURNS the campaign ran before the death — a turn is the player's
 * line plus the DM's answer (`describeTurnsAgo`'s own unit), so the count is
 * the player's committed lines up to `atMessage`. Deleted rows never count.
 */
export function countCampaignTurns(messages, atMessage) {
    if (!Array.isArray(messages)) return 0;
    const end = Number.isFinite(atMessage) ? Math.min(messages.length, Math.max(0, Math.floor(atMessage))) : messages.length;
    let turns = 0;
    for (let i = 0; i < end; i += 1) {
        const row = messages[i];
        if (row && typeof row === 'object' && row.role === 'user' && !row.deleted) turns += 1;
    }
    return turns;
}

/**
 * The cause of a death in a fight, from the tally and the pre-reset envelope:
 * the foe whose blow dropped the hero the last time (`heroDroppedBy`), else
 * the foes the hero fell fighting. Never `undefined` in the line.
 */
export function describeFightCause(tally, enemies) {
    const by = text(tally?.heroDroppedBy, 80);
    if (by) return `slain by ${by}`;
    const names = [...new Set((Array.isArray(enemies) ? enemies : [])
        .map(enemy => text(enemy?.name, 80))
        .filter(Boolean))];
    if (names.length === 0) return 'slain in battle';
    const shown = names.slice(0, MAX_NAMED_FOES);
    const rest = names.length - shown.length;
    return `slain fighting ${joinNames(shown)}${rest > 0 ? ` and ${rest} more` : ''}`;
}

/**
 * The stamp `session.heroDeath` carries: `{ atMessage, cause, location, level }`.
 * `atMessage` is the transcript index the epitaph lands at.
 */
export function buildHeroDeath(state, { cause } = {}) {
    const character = state?.character || {};
    const level = Number.isInteger(character.level) ? Math.min(HERO_LEVEL_MAX, Math.max(1, character.level)) : 1;
    return {
        atMessage: Array.isArray(state?.messages) ? state.messages.length : 0,
        cause: text(cause, HERO_DEATH_CAUSE_MAX),
        location: text(state?.currentLocation, LOCATION_NAME_MAX),
        level,
    };
}

/**
 * THE epitaph — the one engine line, and the ending card's headline:
 *   🪦 **Here ends the story of Astra**, level 4 human fighter — slain by the Cutter, at Rimehollow, after 212 turns.
 * The cause reads as given (a `player_death` description keeps its own words,
 * a fight's is `slain by …`); an unknown cause, place, or length is simply
 * absent — the line never prints a placeholder.
 */
export function describeEpitaph(heroDeath, state) {
    const character = state?.character || {};
    const name = text(character.name, 80) || 'The hero';
    const level = Number.isInteger(heroDeath?.level) ? heroDeath.level : (Number.isInteger(character.level) ? character.level : null);
    const who = [level ? `level ${level}` : '', text(raceDisplayName(character), 40).toLowerCase(), text(classDisplayName(character), 40).toLowerCase()]
        .filter(Boolean).join(' ');
    const cause = unstop(text(heroDeath?.cause, HERO_DEATH_CAUSE_MAX));
    const place = text(heroDeath?.location, LOCATION_NAME_MAX);
    const turns = countCampaignTurns(state?.messages, heroDeath?.atMessage);
    const tail = [];
    if (cause) tail.push(cause);
    if (place) tail.push(`at ${place}`);
    if (turns > 0) tail.push(`after ${turns} turn${turns === 1 ? '' : 's'}`);
    const head = `🪦 **Here ends the story of ${name}**${who ? `, ${who}` : ''}`;
    return tail.length > 0 ? `${head} — ${tail.join(', ')}.` : `${head}.`;
}

/**
 * The load twin: complete-or-null. `atMessage` clamps to the transcript,
 * `level` is an integer 1..20, `cause` and `location` are string-or-empty
 * (never `String(object)`).
 */
export function sanitizeHeroDeath(raw, { maxMessageCount } = {}) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
    const at = Number(raw.atMessage);
    if (!Number.isFinite(at)) return null;
    const level = Number(raw.level);
    if (!Number.isInteger(level) || level < 1 || level > HERO_LEVEL_MAX) return null;
    const floored = Math.max(0, Math.floor(at));
    const atMessage = Number.isFinite(maxMessageCount) ? Math.min(floored, Math.max(0, Math.floor(maxMessageCount))) : floored;
    return {
        atMessage,
        cause: text(raw.cause, HERO_DEATH_CAUSE_MAX),
        location: text(raw.location, LOCATION_NAME_MAX),
        level,
    };
}
