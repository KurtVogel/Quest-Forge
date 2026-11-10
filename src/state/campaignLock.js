/**
 * The second-tab guard (2026-11-11, review queue item 1). There is ONE
 * autosave slot per browser, so two tabs with a campaign open overwrite each
 * other every two seconds: the tab that writes last wins, and the other
 * tab's turns are gone from Continue. The tab that holds a campaign takes a
 * Web Lock (`navigator.locks`); a tab that cannot get it is told the game is
 * open elsewhere and does not autosave.
 *
 * The lock is on the SLOT, not on one campaign: a second tab on a different
 * campaign overwrites Continue just the same (and would make every write a
 * "previous campaign" restore point).
 *
 * The browser releases a lock when its tab closes or crashes, so there is no
 * stale-lock cleanup. A refused tab never takes over on its own: by the time
 * the other tab closes, this one's state is behind the autosave it would
 * overwrite. It asks again the next time a campaign is opened here.
 *
 * Where the API is missing (an old browser, an insecure context, the test
 * runner) or throws, the status is `unsupported` and the tab autosaves as it
 * always did.
 */

export const AUTOSAVE_LOCK_NAME = 'quest-forge-autosave';

export const LOCK_STATUS = Object.freeze({
    HELD: 'held',
    ELSEWHERE: 'elsewhere',
    UNSUPPORTED: 'unsupported',
    RELEASED: 'released',
});

export function createCampaignLock({ locks = globalThis.navigator?.locks, name = AUTOSAVE_LOCK_NAME } = {}) {
    // The acquire in force (`{ status, release }`), or null. A request whose
    // callback runs after its acquire was released lets the lock go at once.
    let active = null;
    // Settles when the previous request has fully let go — a re-acquire right
    // after a release (React StrictMode's double effect) must not find this
    // tab's own lock still held and read it as "elsewhere".
    let settled = Promise.resolve();

    /** Take the lock if it is free. Resolves a `LOCK_STATUS`; never rejects. Idempotent while held or pending. */
    const acquire = () => {
        if (active) return active.status;
        const entry = { status: null, release: null };
        active = entry;
        if (typeof locks?.request !== 'function') {
            entry.status = Promise.resolve(LOCK_STATUS.UNSUPPORTED);
            return entry.status;
        }
        entry.status = settled.then(() => new Promise(resolveStatus => {
            if (active !== entry) { resolveStatus(LOCK_STATUS.RELEASED); return; }
            try {
                const request = locks.request(name, { ifAvailable: true }, lock => {
                    if (!lock) { resolveStatus(LOCK_STATUS.ELSEWHERE); return undefined; }
                    if (active !== entry) { resolveStatus(LOCK_STATUS.RELEASED); return undefined; }
                    resolveStatus(LOCK_STATUS.HELD);
                    // Held until `release()` resolves this.
                    return new Promise(done => { entry.release = done; });
                });
                settled = Promise.resolve(request).then(() => {}, () => { resolveStatus(LOCK_STATUS.UNSUPPORTED); });
            } catch {
                resolveStatus(LOCK_STATUS.UNSUPPORTED);
            }
        }));
        return entry.status;
    };

    /** Let the lock go (the campaign closed). Safe to call when nothing is held. */
    const release = () => {
        const entry = active;
        active = null;
        entry?.release?.();
    };

    return { acquire, release };
}
