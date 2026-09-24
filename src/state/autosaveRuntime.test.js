/**
 * Tests for the autosave runtime choreography (dirty flag + debounce timer),
 * extracted from GameContext.jsx 2026-08-27 — the three previously untested
 * ref-mutation sites: the debounced state-change trigger, the explicit flush,
 * and the visibilitychange/pagehide flush.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { AUTOSAVE_BACKGROUND_DEBOUNCE_MS, AUTOSAVE_DEBOUNCE_MS, createAutosaveRuntime } from './autosaveRuntime.js';
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

describe('two-tier debounce — writes per TURN on the audit\'s dispatch timeline (2026-09-23 persistence P2)', () => {
    // Every phase produces a fresh top-level object for the fields it touched
    // (the reducer's contract), so lane classification sees real identity diffs.
    const row = (role, content) => ({ id: `m-${content}`, role, content });
    const phase = (harness, mutate) => {
        const prev = harness.ctx.state;
        const next = mutate({ ...prev });
        harness.ctx.state = next;
        harness.runtime.noteStateChange(prev, next);
    };
    const recordLandings = (harness) => {
        const landed = [];
        harness.autoSave.mockImplementation(() => { landed.push(Date.now()); return Promise.resolve(true); });
        vi.setSystemTime(0);
        return landed;
    };

    it('an ordinary turn (player line, DM reply + events, Scribe wave, cadence, reflection) makes TWO writes, not five', async () => {
        const harness = makeHarness({ initialState: liveState({ npcs: [], worldFacts: [], storyMemory: [], journal: [], heroTells: [], quests: [] }) });
        const { autoSave } = harness;
        const landed = recordLandings(harness);

        // 0 s: the player's line.
        phase(harness, s => ({ ...s, messages: [...s.messages, row('user', 'I open the door.')] }));
        await vi.advanceTimersByTimeAsync(7000);
        // 7 s: the DM reply + the applyEvents burst (messages, character, inventory, quests, a fact).
        phase(harness, s => ({
            ...s,
            messages: [...s.messages, row('assistant', 'The door groans open.')],
            character: { ...s.character, currentHP: 9 },
            inventory: [{ id: 'key' }],
            quests: [{ id: 'q1', status: 'active' }],
            worldFacts: [{ id: 'f1', fact: 'The door was trapped.' }],
        }));
        await vi.advanceTimersByTimeAsync(4500);
        // 11.5 s: the Scribe wave (roster, facts, cards, tells).
        phase(harness, s => ({
            ...s,
            npcs: [{ id: 'n1', name: 'Oda' }],
            worldFacts: [...s.worldFacts, { id: 'f2', fact: 'Oda keeps the key.' }],
            storyMemory: [{ id: 'c1', text: 'The door.' }],
            heroTells: [{ id: 't1' }],
        }));
        await vi.advanceTimersByTimeAsync(3500);
        // 15 s: the journal cadence (entry + MARK_MESSAGES_SUMMARIZED re-mints the summarized rows + session stamp).
        phase(harness, s => ({
            ...s,
            journal: [{ id: 'j1', summary: 'A door.' }],
            messages: s.messages.map((m, i) => (i < 1 ? { ...m, summarized: true } : m)),
            session: { ...s.session, prunedMessageCount: 1 },
            storyMemory: s.storyMemory.map(c => ({ ...c })),
            npcs: s.npcs.map(n => ({ ...n })),
        }));
        await vi.advanceTimersByTimeAsync(4000);
        // 19 s: the reflection pass (story-memory cards).
        phase(harness, s => ({ ...s, storyMemory: [...s.storyMemory, { id: 'c2', text: 'Reflected.' }] }));
        await vi.advanceTimersByTimeAsync(5000); // → 24 s, the window the audit measured

        // The audit measured five writes at 2.0 / 9.0 / 13.8 / 17.0 / 21.0 s.
        expect(landed).toEqual([2000, 9000]);
        expect(harness.runtime.hasPendingBackgroundDebounce()).toBe(true);

        // 25 s: the next turn's player line — its 2 s write carries the whole
        // background lane, so the slow timer never fires in steady play.
        await vi.advanceTimersByTimeAsync(1000);
        phase(harness, s => ({ ...s, messages: [...s.messages, row('user', 'I step through.')] }));
        await vi.advanceTimersByTimeAsync(20000);
        expect(landed).toEqual([2000, 9000, 27000]);
        expect(harness.runtime.hasPendingDebounce()).toBe(false);
        expect(harness.runtime.isDirty()).toBe(false);
        // The one write that carried the background lane holds every phase's data.
        const last = autoSave.mock.calls.at(-1)[0];
        expect(last.journal).toHaveLength(1);
        expect(last.storyMemory).toHaveLength(2);
        expect(last.npcs).toHaveLength(1);
        expect(last.messages).toHaveLength(3);
    });

    it('a combat round (player line, APPLY, narration + COMPLETE, Scribe) makes THREE writes, not four — the Scribe\'s is the one that goes', async () => {
        const harness = makeHarness({ initialState: liveState({ combat: { active: true, round: 1, phase: 'awaiting_player' }, npcs: [] }) });
        const landed = recordLandings(harness);

        phase(harness, s => ({ ...s, messages: [...s.messages, row('user', 'I attack.')] }));
        await vi.advanceTimersByTimeAsync(4500);
        // 4.5 s: APPLY_COMBAT_EXCHANGE — exchange lines, the combat envelope, the hero's HP, rolls.
        phase(harness, s => ({
            ...s,
            messages: [...s.messages, row('system', 'Astra attacks bandit')],
            combat: { ...s.combat, phase: 'awaiting_narration' },
            character: { ...s.character, currentHP: 7 },
            rollHistory: [{ id: 'r1' }],
        }));
        await vi.advanceTimersByTimeAsync(6000);
        // 10.5 s: the narration lands + COMPLETE_EXCHANGE.
        phase(harness, s => ({
            ...s,
            messages: [...s.messages, row('assistant', 'Steel rings.')],
            combat: { ...s.combat, phase: 'awaiting_player', round: 2 },
        }));
        await vi.advanceTimersByTimeAsync(4000);
        // 14.5 s: the Scribe.
        phase(harness, s => ({ ...s, npcs: [{ id: 'n1', name: 'Bandit' }] }));
        await vi.advanceTimersByTimeAsync(6000); // → 20.5 s

        // The audit measured four (2.0 / 6.5 / 12.5 / 16.5 s). The player's
        // line, the exchange and the narration are each the turn the player
        // would lose (messages / combat / character) and sit 4–6 s apart, so
        // they stay; the Scribe's roster write rides the slow lane.
        expect(landed).toEqual([2000, 6500, 12500]);
        expect(harness.runtime.hasPendingBackgroundDebounce()).toBe(true);
    });

    it('a background-only change fires after the slow window, reset by further background changes', async () => {
        const harness = makeHarness({ initialState: liveState({ npcs: [] }) });
        const { autoSave } = harness;
        phase(harness, s => ({ ...s, npcs: [{ id: 'n1' }] }));
        expect(harness.runtime.hasPendingBackgroundDebounce()).toBe(true);
        await vi.advanceTimersByTimeAsync(AUTOSAVE_BACKGROUND_DEBOUNCE_MS - 1000);
        phase(harness, s => ({ ...s, npcs: [...s.npcs, { id: 'n2' }] }));
        await vi.advanceTimersByTimeAsync(AUTOSAVE_BACKGROUND_DEBOUNCE_MS - 1000);
        expect(autoSave).not.toHaveBeenCalled();
        await vi.advanceTimersByTimeAsync(1000);
        expect(autoSave).toHaveBeenCalledTimes(1);
        expect(autoSave.mock.calls[0][0].npcs).toHaveLength(2);
        expect(harness.runtime.isDirty()).toBe(false);
    });

    it('a background change never delays a pending foreground write; a foreground change supersedes a pending background timer', async () => {
        const harness = makeHarness({ initialState: liveState({ npcs: [] }) });
        const { autoSave } = harness;
        phase(harness, s => ({ ...s, messages: [row('user', 'hi')] }));
        await vi.advanceTimersByTimeAsync(1000);
        phase(harness, s => ({ ...s, npcs: [{ id: 'n1' }] }));
        expect(harness.runtime.hasPendingBackgroundDebounce()).toBe(false);
        await vi.advanceTimersByTimeAsync(1000);
        expect(autoSave).toHaveBeenCalledTimes(1); // still at 2 s
        expect(autoSave.mock.calls[0][0].npcs).toHaveLength(1);

        phase(harness, s => ({ ...s, worldFacts: [{ id: 'f1' }] }));
        expect(harness.runtime.hasPendingBackgroundDebounce()).toBe(true);
        await vi.advanceTimersByTimeAsync(5000);
        phase(harness, s => ({ ...s, character: { ...s.character, currentHP: 1 } }));
        expect(harness.runtime.hasPendingBackgroundDebounce()).toBe(false);
        await vi.advanceTimersByTimeAsync(AUTOSAVE_DEBOUNCE_MS);
        expect(autoSave).toHaveBeenCalledTimes(2);
    });

    it('the hide flush still protects a pending background change', async () => {
        const harness = makeHarness({ initialState: liveState({ npcs: [] }) });
        const { autoSave } = harness;
        phase(harness, s => ({ ...s, npcs: [{ id: 'n1' }] }));
        harness.runtime.flushOnHide();
        expect(autoSave).toHaveBeenCalledTimes(1);
        await vi.advanceTimersByTimeAsync(AUTOSAVE_BACKGROUND_DEBOUNCE_MS);
        expect(harness.runtime.isDirty()).toBe(false);
        expect(autoSave).toHaveBeenCalledTimes(1);
    });
});
