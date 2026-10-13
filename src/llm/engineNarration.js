/**
 * The two engine-triggered narration requests (2026-10-13 chat-orchestration
 * P2): the DM prompts for a mechanic the ENGINE resolved — a rest cue, a
 * potion, a JSON-only spell cast's missing prose. They lived as closures in
 * ChatPanel.jsx (the 0 %-covered component) while every sibling prompt is a
 * tested module export. Both ride the runner's `narration` lane: the reply's
 * events are discarded, the mechanics are already committed.
 */

/**
 * The felt beat of a resolved player-triggered mechanic (a rest, a potion, a
 * Second Wind — the reducer's `narrationCue` system lines).
 * @param {{ mechanic?: string, actionType?: string, effect?: string }} cue
 * @param {string} systemLine - the engine's own system line, interpreted fictionally
 * @param {{ combatActive?: boolean }} [opts]
 */
export function buildCueNarrationPrompt(cue = {}, systemLine = '', { combatActive = false } = {}) {
    const combatLine = combatActive
        ? 'Combat is active; do not advance enemy turns, request rolls, or resolve any enemy actions.'
        : 'Do not advance time or introduce a new challenge.';
    return [
        '[SYSTEM: The engine just resolved a player-triggered mechanic. Narrate only the felt fictional beat.',
        'Write one short paragraph maximum, usually one or two sentences.',
        'Do not mention JSON, UI, numbers, dice, HP totals, resources, or system messages.',
        'Do not apply healing, spend resources, request rolls, add items, alter combat, or emit JSON.',
        combatLine,
        'Do not end with "What do you do?" unless the scene genuinely needs a prompt.',
        `Mechanic: ${cue.mechanic}. Action type: ${cue.actionType || 'action'}. Effect: ${cue.effect}.`,
        `System result to interpret fictionally: ${systemLine}]`,
    ].join(' ');
}

/**
 * The missing prose of a JSON-only `spell_cast` reply (some DMs answer "I cast
 * Detect Magic" with nothing but the event block). Derived from the turn's own
 * events, never a same-task state read: the reducer's "casts X" lines have not
 * rendered yet, and the narration prompt forbids repeating numbers anyway, so
 * spell + target is the whole cue.
 * @param {Array<{ spell?: string, target?: string }>} spellCasts
 */
export function buildCastNarrationPrompt(spellCasts = []) {
    const castResults = (Array.isArray(spellCasts) ? spellCasts : [])
        .map(cast => `The hero casts ${cast.spell}${cast.target && !/^self$/i.test(cast.target) ? ` on ${cast.target}` : ''}.`)
        .join(' ');
    return [
        '[SYSTEM: Your previous response declared a spell casting but contained no prose — the player saw nothing.',
        'The engine has already resolved the mechanics; do not emit spell_cast again or any JSON.',
        'Narrate the casting and what the magic does, reveals, opens, or aids, in 1-3 short paragraphs, unvarnished, continuing the same scene.',
        'Do not state healing numbers or slot counts; the system line already reported them.',
        castResults ? `Engine result to interpret fictionally: ${castResults}]` : ']',
    ].join(' ');
}
