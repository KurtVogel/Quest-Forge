/**
 * The turn's ORCHESTRATION flags — what the pipeline learned about a DM
 * response that is not a game event: a roll detected in prose, a check the
 * arbiter rejected, an outcome narrated before the dice, the id and
 * visibility of a withheld setup. They used to ride the events bag as six
 * underscore keys written in three files and read in four, surviving the
 * `{ ...events }` spreads by accident and handed into applyEvents beside the
 * DM's channels (2026-10-11 audit P2). Now they are ONE `turn` object on the
 * events bag, written through `markTurn` and read through `turnFlags` — one
 * shape, one writer, one reader; applyEvents never looks at it.
 *
 * Keys:
 * - textRollDetected — the roll request was read from prose, not JSON
 * - attackAsCheckRejected — the arbiter refused a declared attack staged as a check
 * - playerAuthorityRollRejected — every proposed roll was a player-authority override
 * - preNarratedOutcome — the setup narrated the result before the dice
 * - setupMessageId / setupHidden — the committed setup row and whether it was withheld
 * - combatWasActive — the ENTRY combat flag the call read (2026-10-13): the
 *   caller routes the events against it, never against a ref re-read after
 *   the dispatches
 */

const EMPTY = Object.freeze({});

/** Stamp flags onto the events bag (mutates and returns it; a null bag is left alone). */
export function markTurn(events, flags) {
    if (!events || typeof events !== 'object') return events;
    events.turn = { ...(events.turn || {}), ...flags };
    return events;
}

/** The turn flags of an events bag — always an object, never null. */
export function turnFlags(events) {
    const turn = events?.turn;
    return turn && typeof turn === 'object' ? turn : EMPTY;
}
