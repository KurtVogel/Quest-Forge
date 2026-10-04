/**
 * Give-up rule for the living-world background directors (2026-09-20 audit
 * P1). Every director is a fire-and-forget DM-model call keyed on a one-shot
 * `session.pending*` marker; a failed call used to clear its in-memory key and
 * re-fire on the very next message, forever — a deterministic failure (a
 * provider block on the context, a prose-answering DM, a dead key/quota) cost
 * one hidden DM-model call per turn for the rest of the campaign, and the
 * stuck marker (an exclusive gate) blocked its whole lane.
 *
 * The journal's failure-streak pattern, reducer-owned so it survives reloads:
 * `session.directorFailures[name] = { key, attempts, atMessage }`. A failed
 * key re-fires only after DIRECTOR_RETRY_MIN_DISTANCE conversational messages,
 * and at DIRECTOR_MAX_ATTEMPTS the reducer consumes the marker through the
 * director's own INSTALL_* action with an empty result — the quiet answer
 * every installer already treats as first-class.
 *
 * Lives in engine/ so reducer handlers never import from llm/.
 */
import { distanceSince } from './worldTempo.js';
import { isRecord } from './text.js';

export const DIRECTOR_RETRY_MIN_DISTANCE = 6;
export const DIRECTOR_MAX_ATTEMPTS = 3;

/**
 * THE registry of the marker-keyed directors — one row per director, read by
 * BOTH sides (2026-10-03 audit: ChatPanel's table and this one each declared
 * the same four install actions, and a director could be in one and not the
 * other). `pendingKey` reads the live marker's key, `install` builds the
 * director's INSTALL_* action, and `empty` is the quiet result — a give-up IS
 * `install(sessionId, key, empty)`. ChatPanel's rows add only what needs the
 * LLM (`generate`) and the log strings. `campaignFronts` has no marker and is
 * already self-limiting (it only fires inside the campaign's first two
 * messages), so it is not a row here by construction: no marker, no retry.
 */
export const RETRYABLE_DIRECTORS = {
    frontAftermath: {
        pendingKey: session => session?.pendingFrontAftermath?.frontId,
        install: (sessionId, key, fronts) => ({ type: 'INSTALL_AFTERMATH_FRONTS', payload: { sessionId, frontId: key, fronts } }),
        empty: [],
    },
    absenceDrift: {
        pendingKey: session => session?.pendingAbsenceDrift?.key,
        install: (sessionId, key, drift) => ({ type: 'INSTALL_ABSENCE_DRIFT', payload: { sessionId, key, drift } }),
        empty: {},
    },
    regionalFronts: {
        pendingKey: session => session?.pendingRegionalFronts?.key,
        install: (sessionId, key, fronts) => ({ type: 'INSTALL_REGIONAL_FRONTS', payload: { sessionId, key, fronts } }),
        empty: [],
    },
    wonder: {
        pendingKey: session => session?.pendingWonder?.key,
        install: (sessionId, key, hooks) => ({ type: 'INSTALL_WONDER', payload: { sessionId, key, hooks } }),
        empty: [],
    },
};

function sanitizeEntry(raw, maxMessageCount) {
    if (!isRecord(raw) || typeof raw.key !== 'string' || !raw.key) return null;
    const attempts = Math.floor(Number(raw.attempts));
    const atMessage = Math.floor(Number(raw.atMessage));
    if (!Number.isFinite(attempts) || attempts < 1 || !Number.isFinite(atMessage)) return null;
    const clampedAt = Math.max(0, Number.isFinite(maxMessageCount) ? Math.min(atMessage, maxMessageCount) : atMessage);
    return { key: raw.key.slice(0, 200), attempts: Math.min(attempts, DIRECTOR_MAX_ATTEMPTS), atMessage: clampedAt };
}

/** Load boundary: known director names only, complete-or-dropped entries. */
export function sanitizeDirectorFailures(raw, { maxMessageCount } = {}) {
    if (!isRecord(raw)) return {};
    const out = {};
    for (const name of Object.keys(RETRYABLE_DIRECTORS)) {
        if (!Object.hasOwn(raw, name)) continue;
        const entry = sanitizeEntry(raw[name], maxMessageCount);
        if (entry) out[name] = entry;
    }
    return out;
}

/** The failure entry for this exact (director, key), or null. */
export function getDirectorFailure(session, name, key) {
    if (!Object.hasOwn(RETRYABLE_DIRECTORS, name) || !isRecord(session?.directorFailures)) return null;
    const entry = sanitizeEntry(session.directorFailures[name]);
    return entry && entry.key === key ? entry : null;
}

/**
 * Should the effect hold this key back? True while a failed key is inside its
 * backoff distance (and at the attempt cap, as a belt — the reducer consumes
 * the marker there, so the key normally no longer exists).
 */
export function isDirectorBackingOff(session, name, key, messages) {
    const failure = getDirectorFailure(session, name, key);
    if (!failure) return false;
    if (failure.attempts >= DIRECTOR_MAX_ATTEMPTS) return true;
    const count = Array.isArray(messages) ? messages.length : 0;
    return distanceSince(messages, failure.atMessage, count) < DIRECTOR_RETRY_MIN_DISTANCE;
}
