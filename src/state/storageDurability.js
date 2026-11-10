/**
 * Ask the browser to KEEP this site's storage (2026-11-11, review queue item
 * 1). Everything a device holds — the autosave behind Continue, every local
 * save, the memory index, portraits, the settings with the API keys — is
 * "best effort" storage until `navigator.storage.persist()` is granted: under
 * storage pressure the browser may evict the whole site's data without the
 * player clearing anything. Chrome grants or refuses silently (by how much
 * the site is used); Firefox asks the player. A grant does not survive a
 * deliberate "clear site data" — the campaign file is the answer to that.
 *
 * Every call degrades to `{ supported: false }` where the API is missing
 * (an old browser, an insecure context, the test runner).
 */

const storageManager = () => globalThis.navigator?.storage;

/** Ask (or confirm) persistence. Resolves `{ supported, persisted }`; never rejects. */
export async function requestPersistentStorage({ storage = storageManager() } = {}) {
    try {
        if (typeof storage?.persist !== 'function') return { supported: false, persisted: false };
        if (typeof storage.persisted === 'function' && await storage.persisted()) return { supported: true, persisted: true };
        return { supported: true, persisted: (await storage.persist()) === true };
    } catch (e) {
        console.warn('[Storage] The persistent-storage request failed:', e);
        return { supported: false, persisted: false };
    }
}

let askedThisPage = false;

/**
 * The automatic ask: once per page, at the first save that lands. A browser
 * that refused silently is asked again on the next visit (Chrome's answer
 * changes as the site is used more).
 */
export function requestPersistentStorageOnce(options) {
    if (askedThisPage) return;
    askedThisPage = true;
    void requestPersistentStorage(options);
}

/** What Settings shows: is the storage kept, and how much of the quota is used. Never rejects. */
export async function readStorageStatus({ storage = storageManager() } = {}) {
    const status = { supported: false, persisted: false, usage: null, quota: null };
    try {
        if (typeof storage?.persisted === 'function') {
            status.supported = typeof storage.persist === 'function';
            status.persisted = (await storage.persisted()) === true;
        }
        if (typeof storage?.estimate === 'function') {
            const estimate = await storage.estimate();
            if (Number.isFinite(estimate?.usage) && estimate.usage >= 0) status.usage = estimate.usage;
            if (Number.isFinite(estimate?.quota) && estimate.quota > 0) status.quota = estimate.quota;
        }
    } catch (e) {
        console.warn('[Storage] The storage status could not be read:', e);
    }
    return status;
}

/** A byte count for a status line: "812 KB", "18 MB", "9.8 GB". */
export function formatBytes(bytes) {
    if (!Number.isFinite(bytes) || bytes < 0) return '';
    if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
    if (bytes < 1024 * 1024 * 1024) return `${Math.round(bytes / (1024 * 1024))} MB`;
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}
