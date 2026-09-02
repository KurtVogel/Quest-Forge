/**
 * Autosave runtime choreography — the dirty-flag + debounce-timer state
 * machine GameContext.jsx wires to React. Extracted 2026-08-27 (audit P2:
 * three ref-mutation sites at 0% coverage) following the autosavePolicy.js
 * precedent: the POLICY half (what to save, whether a change counts) already
 * lived there; this owns WHEN a write actually fires.
 *
 * Three entry points, matching GameContext's three triggers:
 *  - noteStateChange(prev, state): the debounced any-persisted-field trigger.
 *    A change touching only user/ui/settings neither schedules a save nor
 *    resets a pending debounce timer.
 *  - flush({ action }): the explicit flush. Cancels the debounce it supersedes
 *    (the snapshot replays the just-dispatched action through the pure
 *    reducer, so a timer scheduled by earlier changes is fully covered).
 *  - flushOnHide(): the visibilitychange/pagehide flush — dirty-gated so
 *    backgrounding an idle tab doesn't rewrite an unchanged multi-MB
 *    snapshot; a failed write restores the dirty flag.
 *
 * The dirty flag only goes clean when a save LANDS and the live state hasn't
 * moved while the write was in flight.
 *
 * Flush coverage (2026-09-02 audit, write amplification): an action flush
 * replays `action` from the caller's pre-render state, so the action's OWN
 * re-render used to arrive at noteStateChange as a fresh change — dirty again,
 * a new 2s timer, and a second full-snapshot write of state the flush had
 * just persisted. The flush now records the state it replayed from and the
 * top-level fields the replay changed; the first change after that base
 * whose changed fields are all among them IS the action's re-render and is
 * treated as covered by the flushed write. Once that write lands (and the
 * state hasn't moved past the re-render) the flag goes clean; if it fails,
 * the skipped re-render gets the ordinary dirty + debounce it would have had.
 */
import { buildAutosaveSnapshot, hasGameplayChange } from './autosavePolicy.js';

export const AUTOSAVE_DEBOUNCE_MS = 2000;

/**
 * Top-level persisted fields that differ between two states (by reference —
 * the reducer returns new objects for exactly the fields an action touched).
 * `session` is compared field-by-field minus `updatedAt`, which the snapshot
 * stamp always changes.
 */
function changedPersistedKeys(prev, next) {
    const keys = new Set();
    for (const key of new Set([...Object.keys(prev), ...Object.keys(next)])) {
        if (key === 'user' || key === 'ui' || key === 'settings') continue;
        if (key === 'session') {
            if (sessionChanged(prev.session, next.session)) keys.add(key);
            continue;
        }
        if (prev[key] !== next[key]) keys.add(key);
    }
    return keys;
}

function sessionChanged(prev = {}, next = {}) {
    for (const key of new Set([...Object.keys(prev || {}), ...Object.keys(next || {})])) {
        if (key === 'updatedAt') continue;
        if (prev?.[key] !== next?.[key]) return true;
    }
    return false;
}

export function createAutosaveRuntime({ getState, autoSave, showSaveToast }) {
    let timer = null;
    let dirty = false;
    // The most recent action flush: the state it replayed from, the fields the
    // replay changed, and — once its re-render is recognized — that state.
    let cover = null;

    const clearTimer = () => {
        if (timer) {
            clearTimeout(timer);
            timer = null;
        }
    };

    const scheduleDebounce = () => {
        clearTimer();
        timer = setTimeout(() => {
            timer = null;
            // Save the LATEST state at fire time, stamped so cross-device sync
            // can pick the newest file.
            const source = getState();
            const snapshot = buildAutosaveSnapshot(source);
            if (!snapshot) return;
            // Autosaves are deliberately local-per-device: each browser keeps
            // its own "Continue" session. Only manual saves sync to the cloud.
            // The toast must reflect reality: a quota error or broken IndexedDB
            // otherwise means silent progress loss behind a green checkmark.
            autoSave(snapshot).then(saved => {
                // Clean only if nothing changed while the write was in flight.
                if (saved && getState() === source) dirty = false;
                showSaveToast(saved ? 'local' : 'save-error');
            });
        }, AUTOSAVE_DEBOUNCE_MS);
    };

    const flush = async ({ action = null } = {}) => {
        const source = getState();
        const snapshot = buildAutosaveSnapshot(source, { action });
        if (!snapshot) return;
        clearTimer();
        const thisCover = action
            ? { source, keys: changedPersistedKeys(source, snapshot), coveredState: null, saved: null }
            : null;
        cover = thisCover;
        const saved = await autoSave(snapshot);
        if (thisCover) {
            thisCover.saved = saved;
            if (thisCover.coveredState) {
                // The action's re-render already arrived and was treated as covered.
                if (saved) {
                    if (getState() === thisCover.coveredState) dirty = false;
                } else {
                    // Nothing persisted it — give it the debounce it would have had.
                    dirty = true;
                    scheduleDebounce();
                }
            }
            // Without a re-render yet, the live state is still the pre-action
            // one: only the (skipped) re-render can prove it clean.
        } else if (saved && getState() === source) {
            dirty = false;
        }
        showSaveToast(saved ? 'local' : 'save-error');
    };

    const flushOnHide = () => {
        // Nothing changed since the last landed save → nothing to protect.
        if (!dirty) return;
        const snapshot = buildAutosaveSnapshot(getState());
        if (!snapshot) return;
        dirty = false;
        // If the write fails (and the page survives), the state is still dirty.
        autoSave(snapshot).then(saved => { if (!saved) dirty = true; });
    };

    /** Is this change the flushed action's own re-render — already written by the flush? */
    const isCoveredByFlush = (prev, state) => {
        if (!cover || cover.coveredState || prev !== cover.source) return false;
        for (const key of changedPersistedKeys(prev, state)) {
            if (!cover.keys.has(key)) return false;
        }
        return true;
    };

    const noteStateChange = (prev, state) => {
        if (!state.session.id || !state.character) return;
        if (prev && !hasGameplayChange(prev, state)) {
            // A settings/user/ui-only change between the flush and its
            // re-render must not break the lineage.
            if (cover && !cover.coveredState && prev === cover.source) cover.source = state;
            return;
        }
        if (prev && isCoveredByFlush(prev, state)) {
            cover.coveredState = state;
            if (cover.saved === true) {
                // The write landed before the re-render: this state is on disk.
                dirty = false;
            } else if (cover.saved === false) {
                // The write already failed: fall through to the ordinary path.
                cover = null;
                dirty = true;
                scheduleDebounce();
            }
            // Still in flight: flush() settles the flag when the write lands.
            return;
        }
        // Any other change moves past the flushed lineage (an in-flight flush
        // keeps its own reference and settles the flag against the live state).
        cover = null;
        dirty = true;
        scheduleDebounce();
    };

    return {
        flush,
        flushOnHide,
        noteStateChange,
        dispose: clearTimer,
        isDirty: () => dirty,
        hasPendingDebounce: () => timer !== null,
    };
}
