/**
 * Asking the browser to keep the site's storage (2026-11-11, review queue
 * item 1): `navigator.storage.persist()` at the first save, and the status
 * line Settings shows. Every path degrades where the API is missing.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

let durability;

beforeEach(async () => {
    vi.resetModules();
    durability = await import('./storageDurability.js');
});

const storageManager = ({ persisted = false, grant = true, usage = 18_826_134, quota = 10_756_000_000 } = {}) => {
    const manager = {
        kept: persisted,
        persisted: vi.fn(async () => manager.kept),
        persist: vi.fn(async () => { manager.kept = manager.kept || grant; return manager.kept; }),
        estimate: vi.fn(async () => ({ usage, quota })),
    };
    return manager;
};

describe('requestPersistentStorage', () => {
    it('asks, and reports a grant', async () => {
        const storage = storageManager();
        expect(await durability.requestPersistentStorage({ storage })).toEqual({ supported: true, persisted: true });
        expect(storage.persist).toHaveBeenCalledTimes(1);
    });

    it('does not ask again when the storage is already kept', async () => {
        const storage = storageManager({ persisted: true });
        expect(await durability.requestPersistentStorage({ storage })).toEqual({ supported: true, persisted: true });
        expect(storage.persist).not.toHaveBeenCalled();
    });

    it('reports a refusal as a refusal', async () => {
        expect(await durability.requestPersistentStorage({ storage: storageManager({ grant: false }) })).toEqual({ supported: true, persisted: false });
    });

    it('a browser without the API, or one that throws, is "unsupported" — never a rejection', async () => {
        expect(await durability.requestPersistentStorage({ storage: undefined })).toEqual({ supported: false, persisted: false });
        expect(await durability.requestPersistentStorage({ storage: {} })).toEqual({ supported: false, persisted: false });
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const throwing = { persisted: async () => false, persist: async () => { throw new Error('denied'); } };
        expect(await durability.requestPersistentStorage({ storage: throwing })).toEqual({ supported: false, persisted: false });
        warn.mockRestore();
        // The default reads the global: the test runner has no storage manager.
        expect((await durability.requestPersistentStorage()).persisted).toBe(false);
    });
});

describe('requestPersistentStorageOnce — the automatic ask at the first save', () => {
    it('asks once per page however many saves land', async () => {
        const storage = storageManager();
        durability.requestPersistentStorageOnce({ storage });
        durability.requestPersistentStorageOnce({ storage });
        durability.requestPersistentStorageOnce({ storage });
        await Promise.resolve();
        await Promise.resolve();
        expect(storage.persist).toHaveBeenCalledTimes(1);
    });

    it('is safe where the API is missing', () => {
        expect(() => durability.requestPersistentStorageOnce({ storage: undefined })).not.toThrow();
    });
});

describe('readStorageStatus — what Settings shows', () => {
    it('reads whether the storage is kept and how much is used', async () => {
        expect(await durability.readStorageStatus({ storage: storageManager({ persisted: true }) }))
            .toEqual({ supported: true, persisted: true, usage: 18_826_134, quota: 10_756_000_000 });
        expect(await durability.readStorageStatus({ storage: storageManager() }))
            .toMatchObject({ supported: true, persisted: false });
    });

    it('junk estimates read as unknown, and a missing API as unsupported', async () => {
        const junk = { persisted: async () => false, persist: async () => false, estimate: async () => ({ usage: -1, quota: 'lots' }) };
        expect(await durability.readStorageStatus({ storage: junk })).toEqual({ supported: true, persisted: false, usage: null, quota: null });
        expect(await durability.readStorageStatus({ storage: undefined })).toEqual({ supported: false, persisted: false, usage: null, quota: null });
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const throwing = { persisted: async () => { throw new Error('nope'); } };
        expect(await durability.readStorageStatus({ storage: throwing })).toEqual({ supported: false, persisted: false, usage: null, quota: null });
        warn.mockRestore();
    });
});

describe('formatBytes', () => {
    it('reads as KB, MB or GB', () => {
        expect(durability.formatBytes(200)).toBe('1 KB');
        expect(durability.formatBytes(812 * 1024)).toBe('812 KB');
        expect(durability.formatBytes(18_826_134)).toBe('18 MB');
        expect(durability.formatBytes(10_756_000_000)).toBe('10.0 GB');
        expect(durability.formatBytes(NaN)).toBe('');
        expect(durability.formatBytes(-5)).toBe('');
    });
});
