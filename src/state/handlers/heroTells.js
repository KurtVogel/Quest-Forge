/**
 * Hero tells (WOW 2026-09-23): the Scribe's per-turn sightings of the
 * hero's manner land here; the journal cadence rolls WHEN one becomes a
 * pointed remark (rollHeroTellBeat, the relationship-beat pattern).
 */
import { rollDie } from '../../engine/dice.ts';
import { BEAT_TIMING_DIE_SIDES } from '../../engine/relationshipArc.js';
import {
    HERO_TELL_BEAT_COOLDOWN_MESSAGES,
    beatVoicedByFiction,
    isHeroTellBeatExpired,
    mintHeroTellBeat,
    recordHeroTells,
    sanitizeHeroTellBeat,
    selectAbsenceTellCandidate,
    selectHeroTellCandidate,
    setHeroTellDormant,
    stampTellVoiced,
} from '../../engine/heroTells.js';

/**
 * The cadence tick. An expired window stamps its tell as voiced (the cue
 * was on the DM's desk for the whole window — whether it landed is the
 * fiction's business; the stamp only rotates which tell comes next and
 * starts the cooldown). A pending unexpired beat blocks a new mint; so does
 * the cooldown since the last mint. The delay is an engine-rolled crypto
 * die of 0–4 scenes. Returns `{ session, heroTells }`.
 */
export function rollHeroTellBeat(state, { roll = () => rollDie(BEAT_TIMING_DIE_SIDES) - 1 } = {}) {
    let session = state.session || {};
    let heroTells = Array.isArray(state.heroTells) ? state.heroTells : [];
    const messages = state.messages || [];
    const messageCount = messages.length;
    const current = sanitizeHeroTellBeat(session.heroTellBeat);
    if (current && !isHeroTellBeatExpired(current, messageCount)) return { session, heroTells };
    if (current) {
        heroTells = stampTellVoiced(heroTells, current);
        session = { ...session, heroTellBeat: null };
    } else if (session.heroTellBeat) {
        // A malformed stored beat is junk: drop it rather than carry it.
        session = { ...session, heroTellBeat: null };
    }
    const last = Number.isFinite(session.lastHeroTellBeatMessage) ? session.lastHeroTellBeatMessage : null;
    if (last !== null && messageCount - last < HERO_TELL_BEAT_COOLDOWN_MESSAGES) return { session, heroTells };
    // A live tell first; when none is due, a habit the hero visibly dropped
    // may be remarked on instead (the absence beat, slice 4).
    const candidate = selectHeroTellCandidate(heroTells, state.npcs, { messages, messageCount })
        || selectAbsenceTellCandidate(heroTells, state.npcs, { messages, messageCount });
    if (!candidate) return { session, heroTells };
    const beat = mintHeroTellBeat(candidate, { messageCount, delayScenes: roll() });
    if (!beat) return { session, heroTells };
    return { session: { ...session, heroTellBeat: beat, lastHeroTellBeatMessage: messageCount }, heroTells };
}

export const handlers = {
    /** The Scribe's sightings for this turn (capped and merged by the engine). */
    ADD_HERO_TELLS(state, action) {
        const reports = Array.isArray(action.payload) ? action.payload : [];
        if (reports.length === 0) return state;
        const existing = Array.isArray(state.heroTells) ? state.heroTells : [];
        const heroTells = recordHeroTells(existing, reports, { messageCount: (state.messages || []).length });
        if (heroTells === existing) return state;
        // Voiced by the fiction (slice 3): a character said the open beat's
        // tell aloud — the window is spent, the exact turn is stamped.
        const session = beatVoicedByFiction(state.session?.heroTellBeat, heroTells)
            ? { ...state.session, heroTellBeat: null }
            : state.session;
        return { ...state, heroTells, session };
    },

    /** The player struck a tell on the sheet ("that's not me") or restored it. */
    SET_HERO_TELL_DORMANT(state, action) {
        const heroTells = setHeroTellDormant(state.heroTells, action.payload?.id, action.payload?.dormant !== false);
        return heroTells === state.heroTells ? state : { ...state, heroTells };
    },
};
