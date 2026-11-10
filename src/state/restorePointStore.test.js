/**
 * Restore points — the IndexedDB half (2026-11-11, review queue item 1),
 * driven through `autoSave` the way the app drives it. fake-indexeddb gives
 * real IndexedDB semantics; a "page reload" is a fresh module graph over the
 * same database (`vi.resetModules`), since "the first autosave after a load"
 * is page memory.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';

const AUTOSAVE = '__autosave__';

let persistence;
let store;
let policy;

/** A new page over the same stored data. */
async function reloadPage() {
    vi.resetModules();
    vi.doUnmock('./restorePointStore.js');
    persistence = await import('./persistence.js');
    store = await import('./restorePointStore.js');
    policy = await import('./restorePoints.js');
}

beforeEach(async () => {
    globalThis.indexedDB = new IDBFactory();
    vi.spyOn(console, 'info').mockImplementation(() => {});
    await reloadPage();
});

const portrait = (seed) => `data:image/jpeg;base64,${String(seed).repeat(3000)}`;

function campaign({ id = 'camp-a', messages = 10, loadNonce = 0, ...overrides } = {}) {
    return {
        session: { id, name: `Campaign ${id}`, loadNonce },
        character: { name: 'Astra', level: 3, class: 'fighter', currentHP: 20, maxHP: 25, armorClass: 17 },
        inventory: [{ id: 'i1', name: 'Dagger' }],
        messages: Array.from({ length: messages }, (_, i) => ({ id: `m${i}`, role: i % 2 ? 'assistant' : 'user', content: `line ${i}` })),
        rollHistory: [],
        quests: [{ id: 'q1', status: 'active' }],
        journal: [{ id: 'j1', text: 'An entry' }],
        npcs: [],
        worldFacts: [{ id: 'f1', text: 'A fact' }],
        chronicle: [],
        settings: { apiKey: 'secret-key' },
        ...overrides,
    };
}

function withDatabase(run) {
    return new Promise((resolve, reject) => {
        const open = indexedDB.open('rpg-client-saves');
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
            const db = open.result;
            run(db, (value) => { db.close(); resolve(value); }, (error) => { db.close(); reject(error); });
        };
    });
}
const readStore = (storeName, mode = 'all') => withDatabase((db, resolve, reject) => {
    const objectStore = db.transaction(storeName, 'readonly').objectStore(storeName);
    const request = mode === 'keys' ? objectStore.getAllKeys() : objectStore.getAll();
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
});
const readRecord = (storeName, key) => withDatabase((db, resolve, reject) => {
    const request = db.transaction(storeName, 'readonly').objectStore(storeName).get(key);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
});
const writeRaw = (storeName, mutate) => withDatabase((db, resolve, reject) => {
    const tx = db.transaction(storeName, 'readwrite');
    mutate(tx.objectStore(storeName));
    tx.oncomplete = () => resolve();
    tx.onabort = () => reject(tx.error);
});

describe('the copy — the stored autosave, as stored', () => {
    it('the very first autosave has nothing to copy', async () => {
        expect(await persistence.autoSave(campaign())).toBe(true);
        expect(await persistence.listRestorePoints()).toEqual([]);
    });

    it('the first autosave after a load keeps the stored record before it is overwritten', async () => {
        await persistence.autoSave(campaign({ messages: 10 }));
        const storedMeta = await readRecord('saves', AUTOSAVE);
        const storedPayload = await readRecord('savePayloads', AUTOSAVE);

        await reloadPage();
        expect(await persistence.autoSave(campaign({ messages: 12, loadNonce: 1 }))).toBe(true);

        const points = await persistence.listRestorePoints();
        expect(points).toHaveLength(1);
        expect(points[0]).toMatchObject({ reason: policy.RESTORE_REASONS.LOAD, messageCount: 10, sessionId: 'camp-a', characterName: 'Astra', savedAt: storedMeta.savedAt });
        expect(policy.isRestoreSlot(points[0].slotId)).toBe(true);

        // The payload is the stored object, byte for byte — never a re-serialisation.
        const copy = await readRecord('savePayloads', points[0].slotId);
        expect(copy.state).toEqual(storedPayload.state);
        const copyMeta = await readRecord('saves', points[0].slotId);
        expect(copyMeta).toMatchObject({ ...storedMeta, slotId: points[0].slotId });
        expect(copyMeta.restorePoint.reason).toBe(policy.RESTORE_REASONS.LOAD);

        // It loads like any slot, and the autosave moved on.
        expect((await persistence.loadGame(points[0].slotId)).messages).toHaveLength(10);
        expect((await persistence.loadAutoSave()).messages).toHaveLength(12);

        // Ordinary play in the same page copies nothing more (until the interval).
        await persistence.autoSave(campaign({ messages: 14, loadNonce: 1 }));
        expect(await persistence.listRestorePoints()).toHaveLength(1);
    });

    it('a restore point is not a save the player made: listSaves never shows one', async () => {
        await persistence.saveGame('save-1', campaign());
        await persistence.autoSave(campaign({ messages: 10 }));
        await reloadPage();
        await persistence.autoSave(campaign({ messages: 12, loadNonce: 1 }));
        expect(await persistence.listRestorePoints()).toHaveLength(1);
        expect((await persistence.listSaves()).map(save => save.slotId)).toEqual(['save-1']);
    });

    it('a stored save older than this build is labelled "before update", with its own version intact', async () => {
        await persistence.autoSave(campaign({ messages: 10 }));
        // The record as an older build wrote it: an old stamp on the payload.
        const payload = await readRecord('savePayloads', AUTOSAVE);
        await writeRaw('savePayloads', objectStore => objectStore.put({ slotId: AUTOSAVE, state: { ...payload.state, saveVersion: 3 } }));

        await reloadPage();
        await persistence.autoSave(campaign({ messages: 10, loadNonce: 1 }));

        const [point] = await persistence.listRestorePoints();
        expect(point.reason).toBe(policy.RESTORE_REASONS.BEFORE_UPDATE);
        expect((await readRecord('savePayloads', point.slotId)).state.saveVersion).toBe(3);
        // The overwrite itself stamped the current version.
        const { CURRENT_SAVE_VERSION } = await import('./migrations.js');
        expect((await readRecord('savePayloads', AUTOSAVE)).state.saveVersion).toBe(CURRENT_SAVE_VERSION);
    });

    it('reloading without playing does not spend the rolling slots: each copy replaces its same-count twin', async () => {
        await persistence.autoSave(campaign({ messages: 10 }));
        for (let visit = 1; visit <= 4; visit++) {
            await reloadPage();
            await persistence.autoSave(campaign({ messages: 10, loadNonce: visit }));
        }
        const points = await persistence.listRestorePoints();
        expect(points).toHaveLength(1);
        // No payload outlives its record.
        expect((await readStore('savePayloads', 'keys')).filter(policy.isRestoreSlot)).toEqual([points[0].slotId]);
    });

    it('work done at the same message count is kept when an older save is loaded over it (a level-up, a closed chapter)', async () => {
        await persistence.autoSave(campaign({ messages: 40 }));
        await reloadPage();
        await persistence.autoSave(campaign({ messages: 40, loadNonce: 1 })); // the session's copy, at 40
        // Same transcript, a changed hero: the count does not move.
        await persistence.autoSave(campaign({ messages: 40, loadNonce: 1, character: { name: 'Astra', level: 4, class: 'fighter' } }));
        // An older save is loaded in the same page (the nonce moves) and overwrites the slot.
        await persistence.autoSave(campaign({ messages: 10, loadNonce: 2 }));

        const points = await persistence.listRestorePoints();
        expect(points).toHaveLength(1);
        expect(points[0].messageCount).toBe(40);
        expect((await persistence.loadGame(points[0].slotId)).character.level).toBe(4);
    });

    it('New Game, then loading the same campaign again in the same page, is a load like any other (through the real reducer)', async () => {
        const { gameReducer, initialGameState } = await import('./gameReducer.js');
        const { createAutosaveRuntime } = await import('./autosaveRuntime.js');
        const { createCharacter } = await import('../engine/characterUtils.js');
        const hero = createCharacter('Astra', 'human', 'fighter', { strength: 15, dexterity: 13, constitution: 14, intelligence: 10, wisdom: 12, charisma: 8 }, ['athletics', 'perception']);
        const save = (messages) => ({ session: { id: 'camp-a', name: 'A' }, character: hero, messages: Array.from({ length: messages }, (_, i) => ({ id: `m${i}`, role: i % 2 ? 'assistant' : 'user', content: `line ${i}` })) });
        // The runtime is what tells persistence the campaign closed.
        const runtime = createAutosaveRuntime({ getState: () => null, autoSave: async () => true, showSaveToast: () => {}, onCampaignClosed: persistence.forgetCoveredTimeline });

        const continued = gameReducer(initialGameState, { type: 'LOAD_GAME', payload: save(40) });
        await persistence.autoSave(continued);
        const closed = gameReducer(continued, { type: 'NEW_GAME' });
        runtime.noteStateChange(continued, closed);
        const reloaded = gameReducer(closed, { type: 'LOAD_GAME', payload: save(10) });
        // The reducer hands the second load the SAME timeline key as the first…
        expect(reloaded.session.loadNonce).toBe(continued.session.loadNonce);
        expect(reloaded.session.id).toBe(continued.session.id);
        runtime.dispose();

        // …and the 40-message autosave is still copied before the 10-message load overwrites it.
        await persistence.autoSave(reloaded);
        const points = await persistence.listRestorePoints();
        expect(points.map(p => p.messageCount)).toEqual([40]);
        expect((await persistence.loadAutoSave()).messages).toHaveLength(10);
    });

    it('a different campaign taking the slot keeps the previous one — pictures and chapters included', async () => {
        const first = campaign({
            id: 'camp-a',
            messages: 20,
            character: { name: 'Astra', level: 5, class: 'fighter', portraitUrl: portrait('H') },
            npcs: [{ id: 'n1', name: 'Mara', portraitUrl: portrait('M') }],
            chronicle: [{ id: 'ch1', title: 'Chapter One', text: 'The prose of chapter one.', fromIndex: 0, toIndex: 10 }],
        });
        await persistence.autoSave(first);
        await persistence.autoSave(campaign({ id: 'camp-b', messages: 2 }));

        const [point] = await persistence.listRestorePoints();
        expect(point).toMatchObject({ reason: policy.RESTORE_REASONS.PREVIOUS_CAMPAIGN, sessionId: 'camp-a', messageCount: 20 });
        expect((await persistence.loadAutoSave()).session.id).toBe('camp-b');

        // The copy's metadata lists its refs, so the orphan sweep kept the blobs alive.
        const copyMeta = await readRecord('saves', point.slotId);
        expect(copyMeta.portraitRefs).toHaveLength(2);
        expect(copyMeta.chapterRefs).toHaveLength(1);
        expect(await readStore('portraits', 'keys')).toHaveLength(2);
        expect(await readStore('chronicleChapters', 'keys')).toHaveLength(1);

        const restored = await persistence.loadGame(point.slotId);
        expect(restored.character.portraitUrl).toBe(portrait('H'));
        expect(restored.npcs[0].portraitUrl).toBe(portrait('M'));
        expect(restored.chronicle[0].text).toBe('The prose of chapter one.');
        expect(restored.messages).toHaveLength(20);
    });

    it('play copies every 50 messages; the hide flush leaves that copy to the next ordinary autosave', async () => {
        for (const messages of [10, 30, 59]) await persistence.autoSave(campaign({ messages }));
        expect(await persistence.listRestorePoints()).toHaveLength(0);

        // The stored record now holds 59 messages: a copy is due, but not on the urgent write.
        await persistence.autoSave(campaign({ messages: 60 }), { urgent: true });
        expect(await persistence.listRestorePoints()).toHaveLength(0);

        await persistence.autoSave(campaign({ messages: 61 }));
        const points = await persistence.listRestorePoints();
        expect(points).toHaveLength(1);
        expect(points[0]).toMatchObject({ reason: policy.RESTORE_REASONS.INTERVAL, messageCount: 60 });

        await persistence.autoSave(campaign({ messages: 80 }));
        expect(await persistence.listRestorePoints()).toHaveLength(1);
        await persistence.autoSave(campaign({ messages: 111 }));
        await persistence.autoSave(campaign({ messages: 112 }));
        expect((await persistence.listRestorePoints()).map(p => p.messageCount)).toEqual([111, 60]);
    });

    it('two overlapping autosaves copy the stored write once', async () => {
        await persistence.autoSave(campaign({ messages: 10 }));
        await reloadPage();
        const results = await Promise.all([
            persistence.autoSave(campaign({ messages: 12, loadNonce: 1 })),
            persistence.autoSave(campaign({ messages: 12, loadNonce: 1 })),
        ]);
        expect(results).toEqual([true, true]);
        expect(await persistence.listRestorePoints()).toHaveLength(1);
    });

    it('a legacy record with its state embedded in the metadata is copied in the split layout', async () => {
        await persistence.saveGame('save-1', campaign());
        const legacyState = { session: { id: 'camp-old' }, character: { name: 'Old' }, messages: [{ role: 'user', content: 'hi' }], npcs: [] };
        await writeRaw('saves', objectStore => objectStore.put({ slotId: AUTOSAVE, sessionId: 'camp-old', messageCount: 1, savedAt: 1_700_000_000_000, state: legacyState }));

        expect(await store.keepRestorePoint({ sessionId: 'camp-old', afterLoad: true })).toBe(policy.RESTORE_REASONS.BEFORE_UPDATE);
        const [point] = await persistence.listRestorePoints();
        expect((await readRecord('saves', point.slotId)).state).toBeUndefined();
        expect((await readRecord('savePayloads', point.slotId)).state).toEqual(legacyState);
        expect((await persistence.loadGame(point.slotId)).character.name).toBe('Old');
    });

    it('a stored payload that is not a save object is not worth a slot', async () => {
        await persistence.saveGame('save-1', campaign());
        await writeRaw('saves', objectStore => objectStore.put({ slotId: AUTOSAVE, sessionId: 'camp-a', messageCount: 5, savedAt: 1_700_000_000_000 }));
        await writeRaw('savePayloads', objectStore => objectStore.put({ slotId: AUTOSAVE, state: 'corrupted' }));
        expect(await store.keepRestorePoint({ sessionId: 'camp-a', afterLoad: true })).toBeNull();
        expect(await persistence.listRestorePoints()).toEqual([]);
    });
});

describe('the rotation in the store', () => {
    const T0 = 1_790_000_000_000;

    /** One "session": the autosave moves on, then a load copies it. */
    async function visit(n, state) {
        await persistence.saveGame(AUTOSAVE, state);
        return store.keepRestorePoint({ sessionId: state.session.id, afterLoad: true, now: T0 + n });
    }

    it('keeps five rolling copies plus the newest "before update" and the newest "previous campaign" — seven at most', async () => {
        // An old-version record first: its copy is the pinned "before update".
        await persistence.saveGame(AUTOSAVE, campaign({ messages: 1 }));
        const payload = await readRecord('savePayloads', AUTOSAVE);
        const { saveVersion: _version, ...oldMeta } = await readRecord('saves', AUTOSAVE);
        await writeRaw('saves', objectStore => objectStore.put(oldMeta));
        await writeRaw('savePayloads', objectStore => objectStore.put({ slotId: AUTOSAVE, state: { ...payload.state, saveVersion: 2 } }));
        expect(await store.keepRestorePoint({ sessionId: 'camp-a', afterLoad: true, now: T0 })).toBe(policy.RESTORE_REASONS.BEFORE_UPDATE);

        // Another campaign takes the slot: the pinned "previous campaign".
        expect(await store.keepRestorePoint({ sessionId: 'camp-b', afterLoad: true, now: T0 + 1 })).toBeNull(); // same stored write: already copied
        await persistence.saveGame(AUTOSAVE, campaign({ messages: 2 }));
        expect(await store.keepRestorePoint({ sessionId: 'camp-b', afterLoad: true, now: T0 + 2 })).toBe(policy.RESTORE_REASONS.PREVIOUS_CAMPAIGN);

        // Eight rolling copies of camp-b.
        for (let n = 1; n <= 8; n++) {
            expect(await visit(10 + n, campaign({ id: 'camp-b', messages: 100 + n }))).toBe(policy.RESTORE_REASONS.LOAD);
        }

        const points = await persistence.listRestorePoints();
        expect(points).toHaveLength(policy.RESTORE_ROLLING_KEEP + 2);
        expect(points.filter(p => p.reason === policy.RESTORE_REASONS.LOAD).map(p => p.messageCount)).toEqual([108, 107, 106, 105, 104]);
        expect(points.filter(p => p.reason === policy.RESTORE_REASONS.BEFORE_UPDATE)).toHaveLength(1);
        expect(points.filter(p => p.reason === policy.RESTORE_REASONS.PREVIOUS_CAMPAIGN)).toHaveLength(1);
        // Metadata and payload go together: no payload outlives its record.
        const payloadKeys = await readStore('savePayloads', 'keys');
        expect(payloadKeys.filter(policy.isRestoreSlot).sort()).toEqual(points.map(p => p.slotId).sort());
    });

    it('a dropped copy releases its pictures; a kept copy holds them', async () => {
        const withFace = (n, seed) => campaign({ messages: n, npcs: [{ id: 'n1', name: 'Mara', portraitUrl: portrait(seed) }] });
        await visit(1, withFace(1, 'A'));
        for (let n = 2; n <= 5; n++) await visit(n, withFace(n, 'B'));
        // Five copies: the first still names portrait A, though the autosave moved on to B.
        expect(await readStore('portraits', 'keys')).toHaveLength(2);

        await visit(6, withFace(6, 'B'));
        // The sixth copy pushed the first out, and with it the last record naming A.
        expect(await persistence.listRestorePoints()).toHaveLength(5);
        expect(await readStore('portraits', 'keys')).toHaveLength(1);
        expect((await persistence.loadGame(AUTOSAVE)).npcs[0].portraitUrl).toBe(portrait('B'));
    });
});

describe('a device clock that moved backwards', () => {
    it('the new copy is still the newest: kept, and not copied again on every autosave', async () => {
        const T0 = 1_790_000_000_000;
        // Five copies taken while the clock was ahead.
        for (let n = 1; n <= 5; n++) {
            await persistence.saveGame(AUTOSAVE, campaign({ messages: n }));
            await store.keepRestorePoint({ sessionId: 'camp-a', afterLoad: true, now: T0 + n });
        }
        // The clock is corrected; play reaches the interval.
        await persistence.saveGame(AUTOSAVE, campaign({ messages: 100 }));
        expect(await store.keepRestorePoint({ sessionId: 'camp-a', now: T0 - 1000 })).toBe(policy.RESTORE_REASONS.INTERVAL);

        const points = await persistence.listRestorePoints();
        expect(points).toHaveLength(5);
        expect(points[0]).toMatchObject({ messageCount: 100, reason: policy.RESTORE_REASONS.INTERVAL, takenAt: T0 + 6 });
        // The interval now measures from the copy just taken.
        await persistence.saveGame(AUTOSAVE, campaign({ messages: 101 }));
        expect(await store.keepRestorePoint({ sessionId: 'camp-a', now: T0 - 900 })).toBeNull();
    });
});

describe('a copy that cannot be taken never costs the save', () => {
    it('a copy transaction that aborts leaves the autosave record untouched, and the autosave still lands', async () => {
        const { IDBObjectStore } = await import('fake-indexeddb');
        await persistence.autoSave(campaign({ messages: 10 }));
        const before = { meta: await readRecord('saves', AUTOSAVE), payload: await readRecord('savePayloads', AUTOSAVE) };

        await reloadPage();
        const realPut = IDBObjectStore.prototype.put;
        // The copy's own writes fail (quota, a broken store); nothing else does.
        const put = vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (value, key) {
            if (policy.isRestoreSlot(value?.slotId)) throw new DOMException('quota', 'QuotaExceededError');
            return realPut.call(this, value, key);
        });
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

        await expect(store.keepRestorePoint({ sessionId: 'camp-a', afterLoad: true })).rejects.toBeTruthy();
        expect(await readRecord('saves', AUTOSAVE)).toEqual(before.meta);
        expect(await readRecord('savePayloads', AUTOSAVE)).toEqual(before.payload);
        expect(await persistence.listRestorePoints()).toEqual([]);

        // Through autoSave: the failure is logged, the player's turn is saved.
        expect(await persistence.autoSave(campaign({ messages: 12, loadNonce: 1 }))).toBe(true);
        expect((await persistence.loadAutoSave()).messages).toHaveLength(12);
        expect(warn).toHaveBeenCalled();
        expect(await persistence.listRestorePoints()).toEqual([]);

        // Once the store works again, the copy that is still owed is taken.
        put.mockRestore();
        await persistence.autoSave(campaign({ messages: 13, loadNonce: 1 }));
        expect((await persistence.listRestorePoints()).map(p => p.messageCount)).toEqual([12]);
        warn.mockRestore();
    });

    it('the hide flush on a covered timeline goes straight to the save — no restore-point transaction in front of it', async () => {
        vi.resetModules();
        const keepRestorePoint = vi.fn().mockResolvedValue(null);
        vi.doMock('./restorePointStore.js', () => ({ keepRestorePoint, readRestorePointRecords: async () => [] }));
        const page = await import('./persistence.js');

        await page.autoSave(campaign({ messages: 10, loadNonce: 1 }));
        expect(keepRestorePoint).toHaveBeenCalledTimes(1);
        await page.autoSave(campaign({ messages: 11, loadNonce: 1 }), { urgent: true });
        expect(keepRestorePoint).toHaveBeenCalledTimes(1);
        expect((await page.loadAutoSave()).messages).toHaveLength(11);
        // An ordinary autosave checks again.
        await page.autoSave(campaign({ messages: 12, loadNonce: 1 }));
        expect(keepRestorePoint).toHaveBeenCalledTimes(2);
    });

    it('the first save that lands asks the browser to keep the storage', async () => {
        vi.resetModules();
        const requestPersistentStorageOnce = vi.fn();
        vi.doMock('./storageDurability.js', () => ({ requestPersistentStorageOnce }));
        const page = await import('./persistence.js');
        expect(requestPersistentStorageOnce).not.toHaveBeenCalled();
        await page.saveGame('save-1', campaign());
        expect(requestPersistentStorageOnce).toHaveBeenCalledTimes(1);
        vi.doUnmock('./storageDurability.js');
    });

    it('the autosave lands and the copy is retried at the next one', async () => {
        await persistence.autoSave(campaign({ messages: 10 }));

        vi.resetModules();
        const keepRestorePoint = vi.fn()
            .mockRejectedValueOnce(new Error('quota'))
            .mockResolvedValue(null);
        vi.doMock('./restorePointStore.js', () => ({ keepRestorePoint, readRestorePointRecords: async () => [] }));
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const page = await import('./persistence.js');

        expect(await page.autoSave(campaign({ messages: 12, loadNonce: 1 }))).toBe(true);
        expect((await page.loadAutoSave()).messages).toHaveLength(12);
        expect(warn).toHaveBeenCalled();
        expect(keepRestorePoint).toHaveBeenLastCalledWith({ sessionId: 'camp-a', afterLoad: true, urgent: false });

        // Still owed: the next autosave asks again as "after a load"…
        await page.autoSave(campaign({ messages: 13, loadNonce: 1 }));
        expect(keepRestorePoint).toHaveBeenLastCalledWith({ sessionId: 'camp-a', afterLoad: true, urgent: false });
        // …and once the check has run, the timeline is covered.
        await page.autoSave(campaign({ messages: 14, loadNonce: 1 }));
        expect(keepRestorePoint).toHaveBeenLastCalledWith({ sessionId: 'camp-a', afterLoad: false, urgent: false });
        // A load in the same page (the nonce moves) is a new timeline.
        await page.autoSave(campaign({ messages: 14, loadNonce: 2 }), { urgent: true });
        expect(keepRestorePoint).toHaveBeenLastCalledWith({ sessionId: 'camp-a', afterLoad: true, urgent: true });
        warn.mockRestore();
    });
});
