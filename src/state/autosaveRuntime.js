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
 *  - flush({ action }): the explicit flush after a panel's dispatch. Cancels
 *    the debounce it supersedes and writes the action's LIVE result (below).
 *  - flushOnHide(): the visibilitychange/pagehide flush — dirty-gated so
 *    backgrounding an idle tab doesn't rewrite an unchanged multi-MB
 *    snapshot; a failed write restores the dirty flag.
 *
 * The dirty flag only goes clean when a save LANDS and the live state hasn't
 * moved while the write was in flight.
 *
 * The action flush writes the re-render, not a replay (2026-10-18 persistence
 * P2, revising 2026-09-02's "flush coverage"): the caller's state ref predates
 * the re-render, so the flush used to REPLAY the action through the pure
 * reducer and persist that — and then recognise the action's own re-render as
 * "covered" so it was not written again. A replay is a contract with the
 * reducer's determinism, and UPDATE_NPC rolls a crypto die (the bond-turn
 * beat's delay), mints ids and reads the clock: measured, half the replays of
 * one Deepen-memory action scheduled THE BOND HAS TURNED a scene apart from
 * the live state, and that divergent snapshot was what sat on disk. Now the
 * flush waits for the first gameplay change after the dispatch — the action's
 * re-render, by construction (React applies queued actions in order; whatever
 * was batched with it rides the same write) — up to `FLUSH_RENDER_GRACE_MS`,
 * and writes THAT state: one write, the live bytes. The replay remains the
 * fallback for an action whose re-render never comes (a reducer no-op, e.g. a
 * stale-campaign drop), where it equals the live state anyway. A newer action
 * flush supersedes a waiting one (its write carries both actions); a
 * re-render that arrives after the grace is an ordinary dirty change and gets
 * its own debounced write (an extra write in the slow case, never a stale
 * snapshot).
 */
import { buildAutosaveSnapshot, hasGameplayChange, isAutosavableState, isBackgroundOnlyChange } from './autosavePolicy.js';

export const AUTOSAVE_DEBOUNCE_MS = 2000;

/**
 * How long an action flush waits for the action's own re-render before it
 * falls back to the replay. React commits a dispatch from an async handler in
 * a later task (tens of milliseconds at most on a busy phone); the fallback
 * makes a missed grace cost a possibly-divergent snapshot, never a hang.
 */
export const FLUSH_RENDER_GRACE_MS = 250;

/** The settle value of a waiting flush that a newer action flush took over. */
const SUPERSEDED = Symbol('superseded');

/**
 * Two-tier debounce (2026-09-23 audit P2): a turn is five phases seconds apart
 * (the player's line, the DM reply + events, the Scribe wave, the journal
 * cadence, the reflection pass), so a single 2 s window wrote the whole
 * multi-MB snapshot five times per ordinary turn. A change the player would
 * lose (`AUTOSAVE_FOREGROUND_FIELDS` in autosavePolicy.js) keeps the 2 s
 * lane; a background-lane change waits this long, reset by further
 * background changes, and a pending FOREGROUND timer is never delayed by it
 * (that write carries the background change too). The next turn's own
 * foreground write usually lands first, so steady play makes two writes per
 * turn; the hide/unload flush protects the window when the tab goes away.
 */
export const AUTOSAVE_BACKGROUND_DEBOUNCE_MS = 15000;

export function createAutosaveRuntime({ getState, autoSave, showSaveToast }) {
    let timer = null;
    // Which lane the pending timer serves: a foreground timer (2 s) is never
    // pushed back by a background change; a background timer (15 s) is reset
    // by another background change and superseded by a foreground one.
    let timerBackground = false;
    let dirty = false;
    // The action flush still WAITING for its re-render: `{ resolve }`, settled
    // by the first gameplay change (the live result), by a newer action flush
    // (superseded — the newer write carries it), or by the grace timer (no
    // re-render came: the replay is written).
    let waiting = null;

    const clearTimer = () => {
        if (timer) {
            clearTimeout(timer);
            timer = null;
        }
        timerBackground = false;
    };

    const scheduleDebounce = ({ background = false } = {}) => {
        // A pending foreground write already covers a background change.
        if (background && timer && !timerBackground) return;
        clearTimer();
        timerBackground = background;
        timer = setTimeout(() => {
            timer = null;
            timerBackground = false;
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
        }, background ? AUTOSAVE_BACKGROUND_DEBOUNCE_MS : AUTOSAVE_DEBOUNCE_MS);
    };

    /**
     * Wait for the flushed action's own re-render — the LIVE result — up to
     * the grace. Resolves with that state, with `SUPERSEDED` when a newer
     * action flush took over, or with null when no re-render came.
     */
    const awaitRender = () => new Promise(resolve => {
        const entry = { resolve: null };
        const graceTimer = setTimeout(() => entry.resolve(null), FLUSH_RENDER_GRACE_MS);
        entry.resolve = (value) => {
            clearTimeout(graceTimer);
            if (waiting === entry) waiting = null;
            resolve(value);
        };
        waiting?.resolve(SUPERSEDED);
        waiting = entry;
    });

    const flush = async ({ action = null } = {}) => {
        const source = getState();
        const replay = buildAutosaveSnapshot(source, { action });
        if (!replay) return;
        clearTimer();
        if (!action) {
            const saved = await autoSave(replay);
            if (saved && getState() === source) dirty = false;
            showSaveToast(saved ? 'local' : 'save-error');
            return;
        }
        // The action flush writes the LIVE result (2026-10-18 persistence P2):
        // the replay is only the fallback for an action whose re-render never
        // comes (a reducer no-op). A newer action flush supersedes this one —
        // its write carries this action too, so writing here would race it
        // with a stale snapshot.
        const live = await awaitRender();
        if (live === SUPERSEDED) return;
        const snapshot = live ? buildAutosaveSnapshot(live) : replay;
        const saved = await autoSave(snapshot);
        if (live) {
            if (saved) {
                // The live result is on disk; a change that arrived while the
                // write was in flight has its own debounce already.
                if (getState() === live) { dirty = false; clearTimer(); }
            } else {
                // Nothing persisted it — give it the debounce it would have had.
                dirty = true;
                scheduleDebounce();
            }
        }
        // No re-render came and the replay was written: the live state is
        // still the pre-action one, so nothing here can prove it clean — only
        // the (late) re-render can, and it takes the ordinary path.
        showSaveToast(saved ? 'local' : 'save-error');
    };

    const flushOnHide = () => {
        // Nothing changed since the last landed save → nothing to protect.
        if (!dirty) return;
        const snapshot = buildAutosaveSnapshot(getState());
        if (!snapshot) return;
        // This write carries what the pending timer would have written (the
        // slow lane especially — 15 s is a long time for a hidden tab's timer
        // to duplicate a write that already landed).
        clearTimer();
        dirty = false;
        // If the write fails (and the page survives), the state is still dirty.
        autoSave(snapshot).then(saved => { if (!saved) dirty = true; });
    };

    const noteStateChange = (prev, state) => {
        // The policy's own predicate (a null `session` used to throw here).
        if (!isAutosavableState(state)) return;
        // A settings/user/ui-only change between the flush and its re-render
        // neither schedules a save nor settles the waiting flush.
        if (prev && !hasGameplayChange(prev, state)) return;
        if (waiting) {
            // The first gameplay change after an action flush IS that action's
            // re-render (the dispatch preceded the flush; React applies queued
            // actions in order) — whatever else was batched into it rides the
            // same write. The flush writes this state and settles the flag.
            waiting.resolve(state);
            return;
        }
        dirty = true;
        scheduleDebounce({ background: isBackgroundOnlyChange(prev, state) });
    };

    return {
        flush,
        flushOnHide,
        noteStateChange,
        dispose: () => { clearTimer(); waiting?.resolve(SUPERSEDED); },
        isDirty: () => dirty,
        hasPendingDebounce: () => timer !== null,
        /** Is the pending debounce (if any) the slow background lane? */
        hasPendingBackgroundDebounce: () => timer !== null && timerBackground,
    };
}
