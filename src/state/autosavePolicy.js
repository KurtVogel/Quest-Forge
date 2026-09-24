/**
 * Pure autosave policy, extracted from GameContext so the inverted-trigger
 * diff (DECISIONS.md 2026-07-30: ANY persisted-field change schedules a save),
 * the action-replay flush (the fix that ended the chronicle-class silent-loss
 * bugs), and snapshot stamping are unit-testable outside React — the
 * turnVisibility.js pattern.
 */
import { gameReducer } from './gameReducer.js';

/**
 * Fields whose changes never schedule an autosave: `user`/`ui` are stripped by
 * serializeGameState; `settings` persists separately via saveSettings and is
 * stripped from the snapshot entirely (DECISIONS.md 2026-08-27 — device-local
 * by design, LOAD_GAME never restored it). Must mirror serializeGameState's
 * exclusions.
 */
const AUTOSAVE_IGNORED_FIELDS = new Set(['user', 'ui', 'settings']);

/**
 * Did anything the serializer persists change between two states? A change
 * touching ONLY ignored fields must neither schedule a save nor reset a
 * pending debounce timer. A missing `prev` (first render) counts as changed.
 */
export function hasGameplayChange(prev, next) {
    if (!prev) return true;
    for (const key of new Set([...Object.keys(prev), ...Object.keys(next)])) {
        if (AUTOSAVE_IGNORED_FIELDS.has(key)) continue;
        if (prev[key] !== next[key]) return true;
    }
    return false;
}

/**
 * The two autosave lanes (2026-09-23 audit P2: five full-snapshot writes per
 * ordinary turn, four per combat round — the 2 s debounce collapses bursts,
 * not the turn's PHASES, which sit 3–5 s apart). A change to one of these
 * fields is the turn the player would lose to a killed tab: it takes the
 * 2 s lane. Every other persisted field — the Scribe's roster/fact/card
 * waves, the journal cadence, the reflection pass, tempo, fronts, the replay
 * ledgers — is derived from play that is already on disk and takes the slow
 * lane (`AUTOSAVE_BACKGROUND_DEBOUNCE_MS` in autosaveRuntime.js); the next
 * foreground write carries it, and the hide/unload flush still protects it.
 * A field NOT listed here is background by default: that is the cheap
 * failure (a slower write), never a lost turn.
 */
export const AUTOSAVE_FOREGROUND_FIELDS = new Set(['messages', 'character', 'combat', 'inventory']);

/**
 * Is `next` a background-lane change from `prev` — nothing the foreground
 * lane owns moved? The journal cadence's MARK_MESSAGES_SUMMARIZED re-minted
 * every summarized row (a flag flip on rows already on disk), so a `messages`
 * change whose rows differ ONLY by the `summarized` flag stays background.
 * A missing `prev` (first render, a load) is foreground.
 */
export function isBackgroundOnlyChange(prev, next) {
    if (!prev || !next) return false;
    for (const key of AUTOSAVE_FOREGROUND_FIELDS) {
        if (prev[key] === next[key]) continue;
        if (key === 'messages' && messagesDifferOnlyBySummaryFlag(prev.messages, next.messages)) continue;
        return false;
    }
    return true;
}

function messagesDifferOnlyBySummaryFlag(prev, next) {
    if (!Array.isArray(prev) || !Array.isArray(next) || prev.length !== next.length) return false;
    for (let i = 0; i < prev.length; i++) {
        const a = prev[i];
        const b = next[i];
        if (a === b) continue;
        if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return false;
        const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
        for (const key of keys) {
            if (key === 'summarized') continue;
            if (a[key] !== b[key]) return false;
        }
    }
    return true;
}

/** Only a live campaign autosaves — no session or no character means nothing to persist. */
export function isAutosavableState(state) {
    return !!(state?.session?.id && state.character);
}

/**
 * Build the snapshot an autosave should persist, or null when there is nothing
 * to save. When `action` is passed (the flush path), it is the SAME action the
 * caller just dispatched, replayed through the pure reducer — the caller's
 * state ref predates the re-render, so a bare flush would persist stale state.
 * Replay works for ANY action, unlike the old named-hint chain where an
 * unknown hint was a silent no-op (DECISIONS.md 2026-07-26 → 2026-07-30).
 */
export function buildAutosaveSnapshot(state, { action = null, reduce = gameReducer } = {}) {
    if (!isAutosavableState(state)) return null;
    const current = action ? reduce(state, action) : state;
    return {
        ...current,
        session: { ...current.session, updatedAt: new Date().toISOString() },
    };
}
