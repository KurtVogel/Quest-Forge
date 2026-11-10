/**
 * The second-tab guard (2026-11-11, review queue item 1): the tab holding a
 * campaign holds the autosave slot's Web Lock; a tab that cannot get it does
 * not autosave. Where the API is missing or fails, the tab autosaves as it
 * always did.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AUTOSAVE_LOCK_NAME, LOCK_STATUS, createCampaignLock } from './campaignLock.js';
import { createAutosaveRuntime, AUTOSAVE_DEBOUNCE_MS } from './autosaveRuntime.js';

/**
 * One browser's lock manager, shared by its "tabs": `request` with
 * `ifAvailable` calls back with a lock or null, holds the lock until the
 * callback's promise settles, and resolves its own promise after the release
 * — the Web Locks contract the guard relies on.
 */
function makeLockManager() {
    const held = new Set();
    return {
        held,
        request(name, options, callback) {
            return Promise.resolve().then(async () => {
                if (held.has(name)) {
                    if (options?.ifAvailable) return callback(null);
                    throw new Error('this fake only models ifAvailable requests');
                }
                held.add(name);
                try {
                    return await callback({ name, mode: 'exclusive' });
                } finally {
                    held.delete(name);
                }
            });
        },
    };
}

const settle = () => new Promise(resolve => setTimeout(resolve, 0));

describe('createCampaignLock', () => {
    it('the first tab holds the lock; a second tab is told the game is open elsewhere', async () => {
        const locks = makeLockManager();
        const first = createCampaignLock({ locks });
        const second = createCampaignLock({ locks });

        expect(await first.acquire()).toBe(LOCK_STATUS.HELD);
        expect(locks.held.has(AUTOSAVE_LOCK_NAME)).toBe(true);
        expect(await second.acquire()).toBe(LOCK_STATUS.ELSEWHERE);
    });

    it('acquire is idempotent while held', async () => {
        const locks = makeLockManager();
        const request = vi.spyOn(locks, 'request');
        const lock = createCampaignLock({ locks });
        expect(await lock.acquire()).toBe(LOCK_STATUS.HELD);
        expect(await lock.acquire()).toBe(LOCK_STATUS.HELD);
        expect(request).toHaveBeenCalledTimes(1);
    });

    it('releasing lets the lock go, and the other tab gets it the next time it opens a campaign', async () => {
        const locks = makeLockManager();
        const first = createCampaignLock({ locks });
        const second = createCampaignLock({ locks });
        await first.acquire();
        expect(await second.acquire()).toBe(LOCK_STATUS.ELSEWHERE);

        first.release();
        await settle();
        expect(locks.held.size).toBe(0);
        // A refused tab never takes over on its own; it asks again on its next campaign.
        second.release();
        expect(await second.acquire()).toBe(LOCK_STATUS.HELD);
    });

    it('a release followed at once by a re-acquire (React StrictMode\'s double effect) holds, never "elsewhere"', async () => {
        const locks = makeLockManager();
        const lock = createCampaignLock({ locks });
        const firstStatus = lock.acquire();
        lock.release();
        const secondStatus = lock.acquire();

        expect(await firstStatus).toBe(LOCK_STATUS.RELEASED);
        expect(await secondStatus).toBe(LOCK_STATUS.HELD);
        expect(locks.held.size).toBe(1);

        // …and again from a HELD lock.
        lock.release();
        expect(await lock.acquire()).toBe(LOCK_STATUS.HELD);
        lock.release();
        await settle();
        expect(locks.held.size).toBe(0);
    });

    it('release with nothing held is a no-op', () => {
        const lock = createCampaignLock({ locks: makeLockManager() });
        expect(() => { lock.release(); lock.release(); }).not.toThrow();
    });
});

describe('the fallback — no Web Locks, no guard, autosave as before', () => {
    it('a browser without navigator.locks is "unsupported"', async () => {
        // (`null`, not `undefined`: the default reads the global, and Node ships Web Locks.)
        expect(await createCampaignLock({ locks: null }).acquire()).toBe(LOCK_STATUS.UNSUPPORTED);
        expect(await createCampaignLock({ locks: {} }).acquire()).toBe(LOCK_STATUS.UNSUPPORTED);
        expect(await createCampaignLock({ locks: { request: 'not a function' } }).acquire()).toBe(LOCK_STATUS.UNSUPPORTED);
    });

    it('a lock manager that throws or rejects is "unsupported", never a hang or an unhandled rejection', async () => {
        const throwing = { request() { throw new DOMException('insecure', 'SecurityError'); } };
        expect(await createCampaignLock({ locks: throwing }).acquire()).toBe(LOCK_STATUS.UNSUPPORTED);
        const rejecting = { request: () => Promise.reject(new Error('not allowed')) };
        expect(await createCampaignLock({ locks: rejecting }).acquire()).toBe(LOCK_STATUS.UNSUPPORTED);
    });

    it('a re-acquire after a failed request still answers', async () => {
        const rejecting = { request: () => Promise.reject(new Error('not allowed')) };
        const lock = createCampaignLock({ locks: rejecting });
        await lock.acquire();
        lock.release();
        expect(await lock.acquire()).toBe(LOCK_STATUS.UNSUPPORTED);
    });
});

describe('a blocked tab writes nothing to the autosave slot (autosaveRuntime isBlocked)', () => {
    const liveState = (overrides = {}) => ({ session: { id: 'sess-1' }, character: { name: 'Astra' }, messages: [], ...overrides });

    function makeHarness({ blocked }) {
        const ctx = { state: liveState(), blocked };
        const autoSave = vi.fn(() => Promise.resolve(true));
        const showSaveToast = vi.fn();
        const runtime = createAutosaveRuntime({ getState: () => ctx.state, autoSave, showSaveToast, isBlocked: () => ctx.blocked });
        return { ctx, autoSave, showSaveToast, runtime };
    }

    beforeEach(() => { vi.useFakeTimers(); });
    afterEach(() => { vi.useRealTimers(); });

    it('no debounced write, no flush, no hide flush, no toast — and the state stays dirty', async () => {
        const { ctx, autoSave, showSaveToast, runtime } = makeHarness({ blocked: true });
        runtime.noteStateChange(null, ctx.state);
        await vi.advanceTimersByTimeAsync(AUTOSAVE_DEBOUNCE_MS * 3);
        await runtime.flush();
        await runtime.flush({ action: { type: 'ANYTHING' } });
        runtime.flushOnHide();
        await vi.runAllTimersAsync();

        expect(autoSave).not.toHaveBeenCalled();
        expect(showSaveToast).not.toHaveBeenCalled();
        expect(runtime.isDirty()).toBe(true);
    });

    it('an unblocked tab saves as before, and the hide flush marks its write urgent', async () => {
        const { ctx, autoSave, runtime } = makeHarness({ blocked: false });
        runtime.noteStateChange(null, ctx.state);
        await vi.advanceTimersByTimeAsync(AUTOSAVE_DEBOUNCE_MS);
        expect(autoSave).toHaveBeenCalledTimes(1);
        expect(autoSave.mock.calls[0]).toHaveLength(1);

        ctx.state = liveState({ messages: [{ role: 'user', content: 'hi' }] });
        runtime.noteStateChange(liveState(), ctx.state);
        runtime.flushOnHide();
        expect(autoSave).toHaveBeenCalledTimes(2);
        expect(autoSave.mock.calls[1][1]).toEqual({ urgent: true });
    });

    it('tells its owner when the campaign closes (New Game), and only then', () => {
        const onCampaignClosed = vi.fn();
        const runtime = createAutosaveRuntime({ getState: () => null, autoSave: vi.fn(), showSaveToast: vi.fn(), onCampaignClosed });
        const live = liveState();
        const closed = { session: { id: null }, character: null, messages: [] };
        runtime.noteStateChange(null, closed);       // the start screen at boot
        runtime.noteStateChange(closed, closed);     // a settings change on the start screen
        runtime.noteStateChange(closed, live);       // a load
        expect(onCampaignClosed).not.toHaveBeenCalled();
        runtime.noteStateChange(live, closed);       // New Game
        expect(onCampaignClosed).toHaveBeenCalledTimes(1);
        runtime.dispose();
    });

    it('once the block lifts, the next change is written', async () => {
        const { ctx, autoSave, runtime } = makeHarness({ blocked: true });
        runtime.noteStateChange(null, ctx.state);
        await vi.advanceTimersByTimeAsync(AUTOSAVE_DEBOUNCE_MS);
        expect(autoSave).not.toHaveBeenCalled();

        ctx.blocked = false;
        const next = liveState({ messages: [{ role: 'user', content: 'hi' }] });
        runtime.noteStateChange(ctx.state, next);
        ctx.state = next;
        await vi.advanceTimersByTimeAsync(AUTOSAVE_DEBOUNCE_MS);
        expect(autoSave).toHaveBeenCalledTimes(1);
    });
});
