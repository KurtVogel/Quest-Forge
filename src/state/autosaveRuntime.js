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
 */
import { buildAutosaveSnapshot, hasGameplayChange } from './autosavePolicy.js';

export const AUTOSAVE_DEBOUNCE_MS = 2000;

export function createAutosaveRuntime({ getState, autoSave, showSaveToast }) {
    let timer = null;
    let dirty = false;

    const clearTimer = () => {
        if (timer) {
            clearTimeout(timer);
            timer = null;
        }
    };

    const flush = async ({ action = null } = {}) => {
        const snapshot = buildAutosaveSnapshot(getState(), { action });
        if (!snapshot) return;
        clearTimer();
        const source = getState();
        const saved = await autoSave(snapshot);
        // Only a flush without a replay can prove the live state is clean: with
        // an action, the action's own re-render marks dirty again anyway.
        if (saved && !action && getState() === source) dirty = false;
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

    const noteStateChange = (prev, state) => {
        if (!state.session.id || !state.character) return;
        if (prev && !hasGameplayChange(prev, state)) return;
        dirty = true;
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

    return {
        flush,
        flushOnHide,
        noteStateChange,
        dispose: clearTimer,
        isDirty: () => dirty,
        hasPendingDebounce: () => timer !== null,
    };
}
