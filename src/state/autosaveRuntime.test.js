/**
 * Tests for the autosave runtime choreography (dirty flag + debounce timer),
 * extracted from GameContext.jsx 2026-08-27 — the three previously untested
 * ref-mutation sites: the debounced state-change trigger, the explicit flush,
 * and the visibilitychange/pagehide flush.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { AUTOSAVE_DEBOUNCE_MS, createAutosaveRuntime } from './autosaveRuntime.js';
import { gameReducer } from './gameReducer.js';

function liveState(overrides = {}) {
    return {
        session: { id: 'sess-1', name: 'Test Campaign' },
        character: { name: 'Astra' },
        messages: [],
        ...overrides,
    };
}

function makeHarness({ initialState = liveState(), saveResult = true } = {}) {
    const ctx = { state: initialState, saveResult };
    const autoSave = vi.fn(() => Promise.resolve(ctx.saveResult));
    const showSaveToast = vi.fn();
    const runtime = createAutosaveRuntime({
        getState: () => ctx.state,
        autoSave,
        showSaveToast,
    });
    return { ctx, autoSave, showSaveToast, runtime };
}

beforeEach(() => {
    vi.useFakeTimers();
});

afterEach(() => {
    vi.useRealTimers();
});

describe('noteStateChange (debounced trigger)', () => {
    it('schedules one debounced save, marks dirty, and cleans on a landed write', async () => {
        const { ctx, autoSave, showSaveToast, runtime } = makeHarness();
        runtime.noteStateChange(null, ctx.state);
        expect(runtime.isDirty()).toBe(true);
        expect(runtime.hasPendingDebounce()).toBe(true);
        expect(autoSave).not.toHaveBeenCalled();

        await vi.advanceTimersByTimeAsync(AUTOSAVE_DEBOUNCE_MS);
        expect(autoSave).toHaveBeenCalledTimes(1);
        // The snapshot is stamped for cross-device recency comparison.
        expect(autoSave.mock.calls[0][0].session.updatedAt).toBeTruthy();
        expect(runtime.isDirty()).toBe(false);
        expect(runtime.hasPendingDebounce()).toBe(false);
        expect(showSaveToast).toHaveBeenCalledWith('local');
    });

    it('does nothing without a live campaign (no session id / no character)', () => {
        const { runtime } = makeHarness();
        runtime.noteStateChange(null, liveState({ session: { id: null } }));
        runtime.noteStateChange(null, liveState({ character: null }));
        expect(runtime.hasPendingDebounce()).toBe(false);
        expect(runtime.isDirty()).toBe(false);
    });

    it('a settings/user/ui-only change neither schedules nor resets a pending debounce', async () => {
        const { ctx, autoSave, runtime } = makeHarness();
        runtime.noteStateChange(null, ctx.state);
        await vi.advanceTimersByTimeAsync(AUTOSAVE_DEBOUNCE_MS / 2);
        const settingsOnly = { ...ctx.state, settings: { paceDial: 'breakneck' } };
        runtime.noteStateChange(ctx.state, settingsOnly);
        // The original timer keeps its schedule: half the window later it fires.
        await vi.advanceTimersByTimeAsync(AUTOSAVE_DEBOUNCE_MS / 2);
        expect(autoSave).toHaveBeenCalledTimes(1);
    });

    it('a second gameplay change resets the debounce window', async () => {
        const { ctx, autoSave, runtime } = makeHarness();
        runtime.noteStateChange(null, ctx.state);
        await vi.advanceTimersByTimeAsync(AUTOSAVE_DEBOUNCE_MS / 2);
        const next = { ...ctx.state, messages: [{ role: 'user', content: 'hi' }] };
        runtime.noteStateChange(ctx.state, next);
        ctx.state = next;
        await vi.advanceTimersByTimeAsync(AUTOSAVE_DEBOUNCE_MS / 2);
        expect(autoSave).not.toHaveBeenCalled();
        await vi.advanceTimersByTimeAsync(AUTOSAVE_DEBOUNCE_MS / 2);
        expect(autoSave).toHaveBeenCalledTimes(1);
    });

    it('a failed write keeps the state dirty and surfaces the error toast', async () => {
        const { ctx, showSaveToast, runtime } = makeHarness({ saveResult: false });
        runtime.noteStateChange(null, ctx.state);
        await vi.advanceTimersByTimeAsync(AUTOSAVE_DEBOUNCE_MS);
        expect(runtime.isDirty()).toBe(true);
        expect(showSaveToast).toHaveBeenCalledWith('save-error');
    });

    it('stays dirty when the state moved while the write was in flight', async () => {
        const { ctx, autoSave, runtime } = makeHarness();
        autoSave.mockImplementation(() => {
            ctx.state = { ...ctx.state }; // a dispatch landed mid-write
            return Promise.resolve(true);
        });
        runtime.noteStateChange(null, ctx.state);
        await vi.advanceTimersByTimeAsync(AUTOSAVE_DEBOUNCE_MS);
        expect(runtime.isDirty()).toBe(true);
    });
});

describe('flush (explicit)', () => {
    it('cancels the pending debounce it supersedes and cleans the dirty flag', async () => {
        const { ctx, autoSave, showSaveToast, runtime } = makeHarness();
        runtime.noteStateChange(null, ctx.state);
        await runtime.flush();
        expect(autoSave).toHaveBeenCalledTimes(1);
        expect(runtime.hasPendingDebounce()).toBe(false);
        expect(runtime.isDirty()).toBe(false);
        expect(showSaveToast).toHaveBeenCalledWith('local');
        await vi.advanceTimersByTimeAsync(AUTOSAVE_DEBOUNCE_MS);
        expect(autoSave).toHaveBeenCalledTimes(1); // the debounce never double-fires
    });

    it('a flush with an action replay never cleans the dirty flag', async () => {
        const { ctx, autoSave, runtime } = makeHarness();
        runtime.noteStateChange(null, ctx.state);
        await runtime.flush({ action: { type: '__TEST_NOOP__' } });
        expect(autoSave).toHaveBeenCalledTimes(1);
        // The action's own re-render marks dirty again anyway — the flush must
        // not prematurely declare the live state clean.
        expect(runtime.isDirty()).toBe(true);
    });

    it('does nothing without a live campaign', async () => {
        const { autoSave, runtime } = makeHarness({ initialState: liveState({ character: null }) });
        await runtime.flush();
        expect(autoSave).not.toHaveBeenCalled();
    });

    it('a failed flush keeps dirty and shows the error toast', async () => {
        const { ctx, showSaveToast, runtime } = makeHarness({ saveResult: false });
        runtime.noteStateChange(null, ctx.state);
        await runtime.flush();
        expect(runtime.isDirty()).toBe(true);
        expect(showSaveToast).toHaveBeenCalledWith('save-error');
    });
});

describe('flush coverage — the flushed action\'s own re-render (2026-09-02 write amplification)', () => {
    const action = { type: 'ADD_MESSAGE', payload: { role: 'user', content: 'I open the door.' } };

    it('produces exactly one write when the re-render lands while the flush is in flight', async () => {
        const { ctx, autoSave, showSaveToast, runtime } = makeHarness();
        runtime.noteStateChange(null, ctx.state); // dirty + a pending debounce
        const base = ctx.state;
        const flushed = runtime.flush({ action }); // write in flight
        // React's re-render for the same dispatch: a fresh object from the same
        // reducer, arriving before the write settles.
        const rendered = gameReducer(base, action);
        ctx.state = rendered;
        runtime.noteStateChange(base, rendered);
        expect(runtime.hasPendingDebounce()).toBe(false); // no second timer
        await flushed;
        expect(autoSave).toHaveBeenCalledTimes(1);
        expect(autoSave.mock.calls[0][0].messages).toHaveLength(1);
        expect(runtime.isDirty()).toBe(false); // the landed write covers the live state
        expect(showSaveToast).toHaveBeenCalledWith('local');
        await vi.advanceTimersByTimeAsync(AUTOSAVE_DEBOUNCE_MS * 2);
        expect(autoSave).toHaveBeenCalledTimes(1);
    });

    it('produces exactly one write when the re-render lands after the flush already settled', async () => {
        const { ctx, autoSave, runtime } = makeHarness();
        runtime.noteStateChange(null, ctx.state);
        const base = ctx.state;
        await runtime.flush({ action });
        expect(runtime.isDirty()).toBe(true); // pre-render: only the re-render can prove it clean
        const rendered = gameReducer(base, action);
        ctx.state = rendered;
        runtime.noteStateChange(base, rendered);
        expect(runtime.isDirty()).toBe(false);
        expect(runtime.hasPendingDebounce()).toBe(false);
        await vi.advanceTimersByTimeAsync(AUTOSAVE_DEBOUNCE_MS * 2);
        expect(autoSave).toHaveBeenCalledTimes(1);
    });

    it('a failed flush still gives the skipped re-render its ordinary debounce', async () => {
        const { ctx, autoSave, runtime } = makeHarness({ saveResult: false });
        const base = ctx.state;
        const flushed = runtime.flush({ action });
        const rendered = gameReducer(base, action);
        ctx.state = rendered;
        runtime.noteStateChange(base, rendered);
        await flushed;
        expect(runtime.isDirty()).toBe(true);
        expect(runtime.hasPendingDebounce()).toBe(true);
        await vi.advanceTimersByTimeAsync(AUTOSAVE_DEBOUNCE_MS);
        expect(autoSave).toHaveBeenCalledTimes(2);
    });

    it('a failed flush that settled before the re-render marks it dirty and schedules the debounce', async () => {
        const { ctx, autoSave, runtime } = makeHarness({ saveResult: false });
        const base = ctx.state;
        await runtime.flush({ action });
        const rendered = gameReducer(base, action);
        ctx.state = rendered;
        runtime.noteStateChange(base, rendered);
        expect(runtime.isDirty()).toBe(true);
        expect(runtime.hasPendingDebounce()).toBe(true);
        await vi.advanceTimersByTimeAsync(AUTOSAVE_DEBOUNCE_MS);
        expect(autoSave).toHaveBeenCalledTimes(2);
    });

    it('a change touching fields the replay did not is NOT treated as covered', async () => {
        const { ctx, autoSave, runtime } = makeHarness();
        const base = ctx.state;
        const flushed = runtime.flush({ action });
        // Another dispatch batched into the same render: messages AND a location change.
        const rendered = { ...gameReducer(base, action), currentLocation: 'The Old Mill' };
        ctx.state = rendered;
        runtime.noteStateChange(base, rendered);
        await flushed;
        expect(runtime.isDirty()).toBe(true);
        expect(runtime.hasPendingDebounce()).toBe(true);
        await vi.advanceTimersByTimeAsync(AUTOSAVE_DEBOUNCE_MS);
        expect(autoSave).toHaveBeenCalledTimes(2);
        expect(autoSave.mock.calls[1][0].currentLocation).toBe('The Old Mill');
    });

    it('a state that moved past the covered re-render before the write landed stays dirty', async () => {
        const { ctx, autoSave, runtime } = makeHarness();
        const base = ctx.state;
        let settle;
        autoSave.mockImplementation(() => new Promise(resolve => { settle = resolve; }));
        const flushed = runtime.flush({ action });
        const rendered = gameReducer(base, action);
        ctx.state = rendered;
        runtime.noteStateChange(base, rendered);
        // A later, unrelated change while the flush write is still in flight.
        const later = { ...rendered, currentLocation: 'Riverbank' };
        ctx.state = later;
        runtime.noteStateChange(rendered, later);
        settle(true);
        await flushed;
        expect(runtime.isDirty()).toBe(true);
        expect(runtime.hasPendingDebounce()).toBe(true);
    });

    it('a settings-only change between the flush and its re-render does not break the lineage', async () => {
        const { ctx, autoSave, runtime } = makeHarness();
        const base = ctx.state;
        const flushed = runtime.flush({ action });
        const settingsOnly = { ...base, settings: { paceDial: 'slow-burn' } };
        runtime.noteStateChange(base, settingsOnly);
        const rendered = { ...gameReducer(base, action), settings: settingsOnly.settings };
        ctx.state = rendered;
        runtime.noteStateChange(settingsOnly, rendered);
        await flushed;
        expect(runtime.isDirty()).toBe(false);
        await vi.advanceTimersByTimeAsync(AUTOSAVE_DEBOUNCE_MS);
        expect(autoSave).toHaveBeenCalledTimes(1);
    });
});

describe('flushOnHide', () => {
    it('is a no-op while clean — backgrounding an idle tab never rewrites the snapshot', () => {
        const { autoSave, runtime } = makeHarness();
        runtime.flushOnHide();
        expect(autoSave).not.toHaveBeenCalled();
    });

    it('saves once when dirty and goes clean', async () => {
        const { ctx, autoSave, runtime } = makeHarness();
        runtime.noteStateChange(null, ctx.state);
        runtime.flushOnHide();
        expect(autoSave).toHaveBeenCalledTimes(1);
        expect(runtime.isDirty()).toBe(false);
        await vi.runAllTimersAsync();
        expect(runtime.isDirty()).toBe(false);
    });

    it('restores the dirty flag when the hide-write fails (page survived)', async () => {
        const { ctx, runtime } = makeHarness({ saveResult: false });
        runtime.noteStateChange(null, ctx.state);
        runtime.flushOnHide();
        await vi.runAllTimersAsync();
        expect(runtime.isDirty()).toBe(true);
    });
});
