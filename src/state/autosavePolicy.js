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
