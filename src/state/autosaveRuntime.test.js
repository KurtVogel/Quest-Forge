/**
 * Tests for the autosave runtime choreography (dirty flag + debounce timer),
 * extracted from GameContext.jsx 2026-08-27 — the three previously untested
 * ref-mutation sites: the debounced state-change trigger, the explicit flush,
 * and the visibilitychange/pagehide flush.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { AUTOSAVE_DEBOUNCE_MS, createAutosaveRuntime } from './autosaveRuntime.js';

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
