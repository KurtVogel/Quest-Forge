/**
 * Tests for cloud saves — especially the chunked-payload path that removes
 * Firestore's 1 MiB document ceiling for very long campaigns.
 * Firestore is mocked with an in-memory path → data store.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

// `firestoreSdk` is the module `initializeFirebase` loaded on demand
// (2026-09-22): the mock hands cloudSync.js the mocked SDK the same way.
vi.mock('../config/firebase.js', async () => ({ db: { mock: true }, firestoreSdk: await import('firebase/firestore') }));

vi.mock('firebase/firestore', () => {
    const store = new Map(); // full doc path -> plain data object
    // One-shot failure injection: set a key to an Error to make that operation's
    // NEXT call reject, so each function's catch/error branch is testable.
    const __fail = { getDoc: null, getDocs: null, setDoc: null, commit: null };
    const maybeFail = (name) => {
        if (__fail[name]) {
            const error = __fail[name];
            __fail[name] = null;
            throw error;
        }
    };
    const collection = (db, path) => ({ path });
    const doc = (parent, id) => ({ path: `${parent.path}/${id}` });
    const setDoc = async (ref, data) => { maybeFail('setDoc'); store.set(ref.path, JSON.parse(JSON.stringify(data))); };
    const getDoc = async (ref) => {
        maybeFail('getDoc');
        return {
            exists: () => store.has(ref.path),
            data: () => store.get(ref.path),
        };
    };
    const getDocs = async (col) => {
        maybeFail('getDocs');
        const prefix = `${col.path}/`;
        const docs = [...store.entries()]
            .filter(([path]) => path.startsWith(prefix) && !path.slice(prefix.length).includes('/'))
            .map(([path, data]) => ({ id: path.slice(prefix.length), data: () => ({ ...data }) }));
        return { forEach: (cb) => docs.forEach(cb) };
    };
    const deleteDoc = async (ref) => { store.delete(ref.path); };
    const writeBatch = () => {
        const ops = [];
        return {
            set: (ref, data) => ops.push(() => store.set(ref.path, JSON.parse(JSON.stringify(data)))),
            delete: (ref) => ops.push(() => store.delete(ref.path)),
            commit: async () => { maybeFail('commit'); ops.forEach(op => op()); },
        };
    };
    // Buffers writes like the real transaction: nothing lands until the callback
    // resolves and the commit succeeds. Reuses the batch/getDoc failure keys so
    // failure-injection tests exercise the same branches as before.
    const runTransaction = async (_db, fn) => {
        const ops = [];
        const transaction = {
            get: async (ref) => {
                maybeFail('getDoc');
                return { exists: () => store.has(ref.path), data: () => store.get(ref.path) };
            },
            set: (ref, data) => { maybeFail('setDoc'); ops.push(() => store.set(ref.path, JSON.parse(JSON.stringify(data)))); },
            delete: (ref) => ops.push(() => store.delete(ref.path)),
        };
        const result = await fn(transaction);
        maybeFail('commit');
        ops.forEach(op => op());
        return result;
    };
    return { collection, doc, setDoc, getDoc, getDocs, deleteDoc, writeBatch, runTransaction, __store: store, __fail };
});

const firestore = await import('firebase/firestore');
const { saveGameToCloud, loadGameFromCloud, listCloudSaves, deleteGameFromCloud, CLOUD_SAVE_BYTE_LIMIT } = await import('./cloudSync.js');
const { SAVE_VERSION } = await import('./persistence.js');

function makeGameState(overrides = {}) {
    return {
        session: { id: 's1', name: 'The Sundered Coast' },
        character: { name: 'Astra', level: 3, class: 'fighter', currentHP: 20, maxHP: 25, armorClass: 17, gold: 12, silver: 0, copper: 0 },
        inventory: [{ id: 'i1', name: 'Dagger' }],
        messages: [{ id: 'm1', role: 'user', content: 'Hello', summarized: true }, { id: 'm2', role: 'assistant', content: 'Hi there' }],
        rollHistory: [],
        quests: [],
        journal: [],
        npcs: [],
        worldFacts: [],
        storyMemory: [],
        fronts: [{ id: 'front-1', title: 'The Withering Tide', goal: 'Drown the coast', stakes: 'The port falls', clock: 2, grimPortents: ['a', 'b', 'c'] }],
        party: [],
        currentLocation: 'Oakhaven',
        combat: { active: false, enemies: [], turnOrder: [], currentTurn: 0, round: 1 },
        settings: { llmProvider: 'gemini', apiKey: 'secret-key', geminiApiKey: 'machinery-secret', imageApiKey: 'xai-secret', firebaseConfig: { apiKey: 'fb' } },
        user: { uid: 'u1' },
        ui: { settingsOpen: true },
        ...overrides,
    };
}

/** A state whose JSON payload is guaranteed to exceed one chunk. */
function makeHugeGameState() {
    return makeGameState({
        messages: Array.from({ length: 40 }, (_, i) => ({
            id: `m${i}`, role: 'assistant', content: 'x'.repeat(20000),
        })),
    });
}

const chunkPaths = () => [...firestore.__store.keys()].filter(p => p.includes('/chunks/'));

beforeEach(() => {
    firestore.__store.clear();
});

describe('saveGameToCloud / loadGameFromCloud', () => {
    it('round-trips a small save as one chunk, keeping fronts and full messages, stripping secrets', async () => {
        expect((await saveGameToCloud('u1', 'slot-1', makeGameState())).ok).toBe(true);
        const main = firestore.__store.get('users/u1/saves/slot-1');
        expect(main.payloadChunks).toBe(1);
        expect(chunkPaths()).toHaveLength(1);

        const loaded = await loadGameFromCloud('u1', 'slot-1');
        expect(loaded.fronts).toHaveLength(1);
        expect(loaded.messages).toHaveLength(2); // summarized messages are no longer trimmed
        // Settings (secrets included) are stripped from the snapshot entirely —
        // device-local by design (DECISIONS.md 2026-08-27).
        expect(loaded.settings).toBeUndefined();
        expect(loaded.user).toBeUndefined();
        expect(loaded.saveVersion).toBe(SAVE_VERSION);
    });

    it('keeps the parent doc metadata-only: payload null + payloadChunks N, no payload content (2026-08-04)', async () => {
        // listCloudSaves used to download every save's full inline payload at
        // every boot just to delete it client-side.
        await saveGameToCloud('u1', 'slot-1', makeGameState());
        const main = firestore.__store.get('users/u1/saves/slot-1');
        expect(main.payload).toBeNull();
        expect(main.payloadChunks).toBe(1);
        // No state content may leak into the parent doc under any key.
        expect(JSON.stringify(main)).not.toContain('Hi there');
        expect(JSON.stringify(main)).not.toContain('Withering Tide');
    });

    it('splits an oversized save into chunks and reassembles it on load', async () => {
        expect((await saveGameToCloud('u1', 'slot-big', makeHugeGameState())).ok).toBe(true);
        const main = firestore.__store.get('users/u1/saves/slot-big');
        expect(main.payload).toBeNull();
        expect(main.payloadChunks).toBeGreaterThanOrEqual(2);
        expect(chunkPaths()).toHaveLength(main.payloadChunks);

        const loaded = await loadGameFromCloud('u1', 'slot-big');
        expect(loaded.messages).toHaveLength(40);
        expect(loaded.messages[39].content).toBe('x'.repeat(20000));
        expect(loaded.character.name).toBe('Astra');
    });

    it('returns null when the payload parses to a non-object (2026-07-25 audit)', async () => {
        // A corrupted payload parsing to a primitive/array passed callers'
        // truthy checks and reached LOAD_GAME as a non-save value.
        await saveGameToCloud('u1', 'slot-corrupt', makeGameState());
        const [chunkPath] = chunkPaths();
        for (const junk of ['"corrupted string"', '42', '[1,2,3]', 'null']) {
            firestore.__store.get(chunkPath).data = junk;
            expect(await loadGameFromCloud('u1', 'slot-corrupt')).toBeNull();
        }
    });

    it('still loads a legacy inline doc (payloadChunks 0, embedded payload) until it is re-saved', async () => {
        firestore.__store.set('users/u1/saves/legacy-slot', {
            slotId: 'legacy-slot', name: 'Old Cloud Save', payloadChunks: 0,
            payload: JSON.stringify({ character: { name: 'Legacy Hero' }, currentLocation: 'Old Keep' }),
        });
        const loaded = await loadGameFromCloud('u1', 'legacy-slot');
        expect(loaded.character.name).toBe('Legacy Hero');
        // A corrupt legacy inline payload still degrades to null.
        firestore.__store.get('users/u1/saves/legacy-slot').payload = '[1,2,3]';
        expect(await loadGameFromCloud('u1', 'legacy-slot')).toBeNull();
    });

    it('never splits a surrogate pair at a chunk boundary', async () => {
        // Emoji are two code units each; a naive fixed-size slice would cut pairs.
        await saveGameToCloud('u1', 'slot-emoji', makeGameState({
            messages: [{ id: 'm1', role: 'assistant', content: '💀'.repeat(200000) }],
        }));
        for (const path of chunkPaths()) {
            const { data } = firestore.__store.get(path);
            expect(/^[\uDC00-\uDFFF]/.test(data)).toBe(false); // no lone low surrogate at start
            expect(/[\uD800-\uDBFF]$/.test(data)).toBe(false); // no lone high surrogate at end
        }
        const loaded = await loadGameFromCloud('u1', 'slot-emoji');
        expect(loaded.messages[0].content).toBe('💀'.repeat(200000));
    });

    it('clears stale chunks when a large save shrinks back to a single chunk', async () => {
        await saveGameToCloud('u1', 'slot-1', makeHugeGameState());
        expect(chunkPaths().length).toBeGreaterThan(1);

        await saveGameToCloud('u1', 'slot-1', makeGameState());
        expect(chunkPaths()).toHaveLength(1);
        const main = firestore.__store.get('users/u1/saves/slot-1');
        expect(main.payloadChunks).toBe(1);
        expect((await loadGameFromCloud('u1', 'slot-1')).messages).toHaveLength(2);
    });

    it('fails loudly rather than returning a truncated campaign when a chunk is missing', async () => {
        await saveGameToCloud('u1', 'slot-big', makeHugeGameState());
        const [firstChunk] = chunkPaths();
        firestore.__store.delete(firstChunk);
        expect(await loadGameFromCloud('u1', 'slot-big')).toBeNull();
    });

    it('a mid-save failure leaves the previous save fully intact (one atomic transaction)', async () => {
        // The chunk-race P2 (2026-07-09): the old plain-getDoc read meant a save
        // could interleave with another device's write. Now the read and the whole
        // write share one transaction — a failed commit must change NOTHING.
        await saveGameToCloud('u1', 'slot-1', makeHugeGameState());
        const before = new Map(firestore.__store);

        firestore.__fail.commit = new Error('contention');
        expect((await saveGameToCloud('u1', 'slot-1', makeGameState())).ok).toBe(false);

        expect(firestore.__store.size).toBe(before.size);
        for (const [path, data] of before) {
            expect(firestore.__store.get(path)).toEqual(data);
        }
        expect((await loadGameFromCloud('u1', 'slot-1')).messages).toHaveLength(40);
    });

    it('maps the reserved __autosave__ slot to a legal doc id', async () => {
        await saveGameToCloud('u1', '__autosave__', makeGameState());
        expect(firestore.__store.has('users/u1/saves/autosave')).toBe(true);
        expect((await loadGameFromCloud('u1', '__autosave__')).character.name).toBe('Astra');
    });
});

describe('listCloudSaves / deleteGameFromCloud', () => {
    it('lists manual saves without payloads and excludes the autosave doc', async () => {
        await saveGameToCloud('u1', 'slot-1', makeGameState());
        await saveGameToCloud('u1', '__autosave__', makeGameState());
        const saves = await listCloudSaves('u1');
        expect(saves).toHaveLength(1);
        expect(saves[0].slotId).toBe('slot-1');
        expect(saves[0].payload).toBeUndefined();
        expect(saves[0].payloadChunks).toBeUndefined();
    });

    it('deletes the save document and all of its chunks', async () => {
        await saveGameToCloud('u1', 'slot-big', makeHugeGameState());
        expect(chunkPaths().length).toBeGreaterThan(0);
        expect(await deleteGameFromCloud('u1', 'slot-big')).toBe(true);
        expect(firestore.__store.size).toBe(0);
    });
});

describe('guards and failure surfacing', () => {
    it('all four functions refuse a missing uid without touching Firestore', async () => {
        expect(await saveGameToCloud('', 'slot-1', makeGameState())).toMatchObject({ ok: false, reason: 'signed-out' });
        expect(await loadGameFromCloud('', 'slot-1')).toBeNull();
        expect(await listCloudSaves('')).toEqual([]);
        expect(await deleteGameFromCloud('', 'slot-1')).toBe(false);
        expect(firestore.__store.size).toBe(0);
    });

    it('deleteGameFromCloud refuses a missing slotId', async () => {
        expect(await deleteGameFromCloud('u1', '')).toBe(false);
    });

    // 2026-09-02 audit: every failure used to collapse to `false`, so the UI could
    // only say "cloud upload failed". The result now carries a reason + a
    // player-readable message, and the two classes that need DIFFERENT player
    // actions (redeploy rules vs. the campaign outgrew one request) are distinct.
    it('saveGameToCloud reports a generic Firestore failure as reason "error" with the cause', async () => {
        firestore.__fail.getDoc = new Error('unavailable');
        const result = await saveGameToCloud('u1', 'slot-1', makeGameState());
        expect(result).toMatchObject({ ok: false, reason: 'error' });
        expect(result.message).toContain('unavailable');
        expect(firestore.__store.size).toBe(0);
    });

    it('saveGameToCloud maps permission-denied to its reason and the rules-deploy hint', async () => {
        const denied = new Error('Missing or insufficient permissions.');
        denied.code = 'permission-denied';
        firestore.__fail.setDoc = denied;
        const result = await saveGameToCloud('u1', 'slot-1', makeGameState());
        expect(result).toMatchObject({ ok: false, reason: 'permission-denied' });
        expect(result.message).toContain('firestore.rules');
        expect(result.message).toContain('chunks/{chunkId}');
        expect(result.message).toContain('portraits/{portraitId}');
    });

    it('saveGameToCloud refuses a payload over CLOUD_SAVE_BYTE_LIMIT before touching Firestore', async () => {
        // A full-history mature campaign crossing Firestore's ~10 MiB request
        // ceiling used to fail opaquely on every save, forever. The pre-flight
        // measures UTF-8 bytes (what Firestore meters), not JS chars.
        const overLimit = makeGameState({
            messages: Array.from({ length: 10 }, (_, i) => ({
                id: `m${i}`, role: 'assistant', content: 'x'.repeat(CLOUD_SAVE_BYTE_LIMIT / 10),
            })),
        });
        const result = await saveGameToCloud('u1', 'slot-huge', overLimit);
        expect(result).toMatchObject({ ok: false, reason: 'too-large' });
        expect(result.message).toMatch(/\d+\.\d MB, above the cloud limit of 9\.0 MB/);
        expect(result.message).toContain('saved locally only');
        expect(firestore.__store.size).toBe(0);
        // Exactly at the ceiling is fine — 9 MiB is already headroom under 10 MiB.
        expect(CLOUD_SAVE_BYTE_LIMIT).toBe(9 * 1024 * 1024);
    });

    it('the size pre-flight counts UTF-8 bytes, so multi-byte prose is measured honestly', async () => {
        // 3.2M chars of a 3-byte CJK glyph ≈ 9.6 MiB of UTF-8 — under the limit
        // by char count, over it by bytes.
        const cjk = makeGameState({
            messages: [{ id: 'm1', role: 'assistant', content: '龍'.repeat(3200000) }],
        });
        expect(await saveGameToCloud('u1', 'slot-cjk', cjk)).toMatchObject({ ok: false, reason: 'too-large' });
        expect(firestore.__store.size).toBe(0);
    });

    it('loadGameFromCloud swallows a Firestore failure to null', async () => {
        await saveGameToCloud('u1', 'slot-1', makeGameState());
        firestore.__fail.getDoc = new Error('unavailable');
        expect(await loadGameFromCloud('u1', 'slot-1')).toBeNull();
    });

    it('listCloudSaves re-throws so the caller can show the error', async () => {
        firestore.__fail.getDocs = new Error('unavailable');
        await expect(listCloudSaves('u1')).rejects.toThrow('unavailable');
    });

    it('deleteGameFromCloud swallows a Firestore failure to false and leaves the save intact', async () => {
        await saveGameToCloud('u1', 'slot-1', makeGameState());
        firestore.__fail.commit = new Error('unavailable');
        expect(await deleteGameFromCloud('u1', 'slot-1')).toBe(false);
        expect(firestore.__store.has('users/u1/saves/slot-1')).toBe(true);
    });
});

describe('hostile metadata docs (2026-09-10 audit)', () => {
    it('a junk payloadChunks on the existing doc never queues an unbounded sweep — save and delete both complete', async () => {
        for (const payloadChunks of [200000, Infinity, '12', -5, NaN]) {
            firestore.__store.clear();
            firestore.__store.set('users/u1/saves/slot-1', { slotId: 'slot-1', name: 'Old', payloadChunks, payload: null });
            const deletesDuringSave = [];
            const origDelete = firestore.__store.delete.bind(firestore.__store);
            firestore.__store.delete = (key) => { deletesDuringSave.push(key); return origDelete(key); };
            expect((await saveGameToCloud('u1', 'slot-1', makeGameState())).ok).toBe(true);
            firestore.__store.delete = origDelete;
            // At most the bounded sweep (64) touched stale chunk paths, never 199,999.
            expect(deletesDuringSave.filter(k => k.includes('/chunks/')).length).toBeLessThanOrEqual(64);
            expect(firestore.__store.get('users/u1/saves/slot-1').payloadChunks).toBe(1);

            firestore.__store.get('users/u1/saves/slot-1').payloadChunks = payloadChunks;
            expect(await deleteGameFromCloud('u1', 'slot-1')).toBe(true);
            expect(firestore.__store.has('users/u1/saves/slot-1')).toBe(false);
        }
    });

    it('list rows are typed: a doc without a slotId field is addressed by its doc id, object text falls back', async () => {
        firestore.__store.set('users/u1/saves/orphan-doc', { name: { title: 'x' }, characterName: ['a'], characterLevel: '3', location: { name: 'Docks' }, savedAt: '2026-09-10T00:00:00.000Z' });
        const [row] = await listCloudSaves('u1');
        expect(row).toMatchObject({ slotId: 'orphan-doc', name: 'Unnamed Save', characterName: 'Unknown', characterLevel: 3, location: null });
        expect(row.payload).toBeUndefined();
        expect(row.payloadChunks).toBeUndefined();
        // Addressable now: delete by the projected slotId removes the doc.
        expect(await deleteGameFromCloud('u1', row.slotId)).toBe(true);
        expect(firestore.__store.has('users/u1/saves/orphan-doc')).toBe(false);
    });

    it('an object session.name / currentLocation in the SAVED state never reaches the list as an object', async () => {
        await saveGameToCloud('u1', 'slot-obj', makeGameState({ session: { id: 's1', name: { title: 'Campaign' } }, currentLocation: { name: 'Docks' } }));
        const [row] = await listCloudSaves('u1');
        expect(row.name).toBe('Unnamed Save');
        expect(row.location).toBeNull();
    });
});

describe('cloud portrait collection (2026-09-22 audit P2)', () => {
    // ~100k-char data URLs, distinct per seed (a real xAI portrait is 30–110k).
    const portrait = (seed) => `data:image/jpeg;base64,${seed.toString(36).padStart(4, '0').repeat(25_000)}`;
    const gallery = (count, { seedOffset = 0 } = {}) => makeGameState({
        character: { ...makeGameState().character, portraitUrl: portrait(1000 + seedOffset), portraitProvider: 'xai', portraitUpdatedAt: 5 },
        npcs: Array.from({ length: count }, (_, i) => ({
            id: `npc-${i}`, name: `Villager ${i}`, portraitUrl: portrait(i + seedOffset), portraitProvider: 'xai', portraitUpdatedAt: 1000 + i,
        })),
    });
    const portraitPaths = () => [...firestore.__store.keys()].filter(p => p.includes('/portraits/'));
    const chunkData = () => chunkPaths().map(p => firestore.__store.get(p).data);
    /** Run `fn` while recording every store write (path + JSON size). */
    async function recordWrites(fn) {
        const writes = [];
        const origSet = firestore.__store.set.bind(firestore.__store);
        firestore.__store.set = (key, value) => { writes.push({ key, chars: JSON.stringify(value).length }); return origSet(key, value); };
        try { return { result: await fn(), writes }; } finally { firestore.__store.set = origSet; }
    }

    it('a save with N portraits carries ZERO portrait bytes in its chunks, one chunk, N blob docs, and portraitRefs on the metadata doc', async () => {
        // Measured pre-fix: 12 NPC portraits = 2.38 MiB per save, 47 % portraits, 9 chunk docs.
        const result = await saveGameToCloud('u1', 'slot-gallery', gallery(12));
        expect(result).toEqual({ ok: true, portraitsUploaded: 13, chaptersUploaded: 0 });
        const main = firestore.__store.get('users/u1/saves/slot-gallery');
        expect(main.payloadChunks).toBe(1);
        expect(main.portraitRefs).toHaveLength(13);
        main.portraitRefs.forEach(ref => expect(ref).toMatch(/^p-[0-9a-z]+-[0-9a-z]+-[0-9a-z]+$/));
        expect(portraitPaths()).toHaveLength(13);
        for (const data of chunkData()) {
            expect(data).not.toContain('data:image/');
            expect(data).toContain('"portraitRef"');
        }
        // The whole chunked payload is a few KB — the pictures were ~1.3 MB.
        expect(chunkData().reduce((n, d) => n + d.length, 0)).toBeLessThan(40_000);
        // Every blob doc is one portrait, far under Firestore's 1 MiB document cap.
        for (const path of portraitPaths()) {
            const blob = firestore.__store.get(path);
            expect(blob.data.startsWith('data:image/jpeg;base64,')).toBe(true);
            expect(blob.chars).toBe(blob.data.length);
        }
    });

    it('a steady-state re-save (same slot or a new one) writes ZERO portrait docs and re-uploads zero portrait bytes', async () => {
        await saveGameToCloud('u1', 'slot-a', gallery(12));
        const again = await recordWrites(() => saveGameToCloud('u1', 'slot-a', gallery(12)));
        expect(again.result).toEqual({ ok: true, portraitsUploaded: 0, chaptersUploaded: 0 });
        expect(again.writes.filter(w => w.key.includes('/portraits/'))).toHaveLength(0);
        expect(again.writes.reduce((n, w) => n + w.chars, 0)).toBeLessThan(40_000);
        // A second slot of the same campaign shares the blobs by content key.
        const other = await recordWrites(() => saveGameToCloud('u1', 'slot-b', gallery(12)));
        expect(other.result.portraitsUploaded).toBe(0);
        expect(other.writes.filter(w => w.key.includes('/portraits/'))).toHaveLength(0);
        expect(portraitPaths()).toHaveLength(13);
        // Only the NEW picture is uploaded when one NPC gets a portrait.
        const third = await recordWrites(() => saveGameToCloud('u1', 'slot-a', gallery(13)));
        expect(third.result.portraitsUploaded).toBe(1);
        expect(third.writes.filter(w => w.key.includes('/portraits/'))).toHaveLength(1);
    });

    it('the loader rehydrates every ref: portraitUrl on the hero and each NPC, no portraitRef in what LOAD_GAME receives', async () => {
        const state = gallery(12);
        await saveGameToCloud('u1', 'slot-gallery', state);
        const loaded = await loadGameFromCloud('u1', 'slot-gallery');
        expect(loaded.character.portraitUrl).toBe(state.character.portraitUrl);
        expect(loaded.character.portraitProvider).toBe('xai');
        loaded.npcs.forEach((npc, i) => {
            expect(npc.portraitUrl).toBe(state.npcs[i].portraitUrl);
            expect(npc.portraitUpdatedAt).toBe(1000 + i);
        });
        expect(JSON.stringify(loaded)).not.toContain('portraitRef');
    });

    it('a missing or corrupt blob doc is a missing picture (stamps stripped), never a failed load', async () => {
        const state = gallery(3);
        await saveGameToCloud('u1', 'slot-gallery', state);
        const main = firestore.__store.get('users/u1/saves/slot-gallery');
        // The first NPC's blob is gone; the second's is junk.
        const keyOf = (url) => main.portraitRefs.find(ref => firestore.__store.get(`users/u1/portraits/${ref}`)?.data === url);
        firestore.__store.delete(`users/u1/portraits/${keyOf(state.npcs[0].portraitUrl)}`);
        firestore.__store.get(`users/u1/portraits/${keyOf(state.npcs[1].portraitUrl)}`).data = 42;
        const loaded = await loadGameFromCloud('u1', 'slot-gallery');
        expect(loaded).not.toBeNull();
        expect(loaded.npcs[0]).toEqual({ id: 'npc-0', name: 'Villager 0' });
        expect(loaded.npcs[1]).toEqual({ id: 'npc-1', name: 'Villager 1' });
        expect(loaded.npcs[2].portraitUrl).toBe(state.npcs[2].portraitUrl);
        expect(loaded.character.portraitUrl).toBe(state.character.portraitUrl);
    });

    it("delete sweeps the slot's portraitRefs but keeps every blob another slot still claims", async () => {
        await saveGameToCloud('u1', 'slot-a', gallery(2)); // hero + npc-0 + npc-1
        await saveGameToCloud('u1', 'slot-b', gallery(1)); // hero + npc-0
        expect(portraitPaths()).toHaveLength(3);
        expect(await deleteGameFromCloud('u1', 'slot-a')).toBe(true);
        expect(portraitPaths()).toHaveLength(2);
        const bRefs = firestore.__store.get('users/u1/saves/slot-b').portraitRefs;
        expect(portraitPaths().map(p => p.split('/portraits/')[1]).sort()).toEqual([...bRefs].sort());
        // slot-b still loads whole.
        expect((await loadGameFromCloud('u1', 'slot-b')).npcs[0].portraitUrl).toBe(portrait(0));
        expect(await deleteGameFromCloud('u1', 'slot-b')).toBe(true);
        expect(firestore.__store.size).toBe(0);
    });

    it('an overwrite that releases a ref (a rerolled portrait) sweeps the old blob unless another slot claims it', async () => {
        await saveGameToCloud('u1', 'slot-a', gallery(1));
        const oldRefs = firestore.__store.get('users/u1/saves/slot-a').portraitRefs;
        // Reroll: new pictures for the hero and the NPC.
        const rerolled = await saveGameToCloud('u1', 'slot-a', gallery(1, { seedOffset: 50 }));
        expect(rerolled.portraitsUploaded).toBe(2);
        expect(portraitPaths()).toHaveLength(2);
        oldRefs.forEach(ref => expect(firestore.__store.has(`users/u1/portraits/${ref}`)).toBe(false));
        // With another slot still showing the old pictures, they stay.
        await saveGameToCloud('u1', 'slot-b', gallery(1));
        await saveGameToCloud('u1', 'slot-a', gallery(1));
        await saveGameToCloud('u1', 'slot-a', gallery(1, { seedOffset: 50 }));
        expect(portraitPaths()).toHaveLength(4);
        expect((await loadGameFromCloud('u1', 'slot-b')).npcs[0].portraitUrl).toBe(portrait(0));
    });

    it('100 portraits fit under the cloud limit with nothing dropped (the 2026-09-21 budget dropper is retired)', async () => {
        // ~10 MB of pictures used to be over the 9 MiB ceiling: 11 dropped and a second stringify.
        const state = gallery(100);
        const result = await saveGameToCloud('u1', 'slot-gallery', state);
        expect(result).toEqual({ ok: true, portraitsUploaded: 101, chaptersUploaded: 0 });
        expect(result.droppedPortraits).toBeUndefined();
        expect(firestore.__store.get('users/u1/saves/slot-gallery').payloadChunks).toBe(1);
        const loaded = await loadGameFromCloud('u1', 'slot-gallery');
        expect(loaded.npcs.filter(n => n.portraitUrl)).toHaveLength(100);
        expect(loaded.npcs[0].portraitUrl).toBe(portrait(0));
        expect(loaded.character.portraitUrl).toBe(state.character.portraitUrl);
    });

    it('the same picture on two records is one blob doc (content-addressed)', async () => {
        const state = gallery(2);
        state.npcs[1].portraitUrl = state.npcs[0].portraitUrl;
        const result = await saveGameToCloud('u1', 'slot-twins', state);
        expect(result.portraitsUploaded).toBe(2); // hero + the shared picture
        expect(firestore.__store.get('users/u1/saves/slot-twins').portraitRefs).toHaveLength(2);
        const loaded = await loadGameFromCloud('u1', 'slot-twins');
        expect(loaded.npcs[1].portraitUrl).toBe(loaded.npcs[0].portraitUrl);
    });

    it('a pre-split cloud doc with inline portraits loads as-is (no migration)', async () => {
        const inline = gallery(1);
        firestore.__store.set('users/u1/saves/legacy', { slotId: 'legacy', payloadChunks: 1, payload: null });
        firestore.__store.set('users/u1/saves/legacy/chunks/0', { index: 0, data: JSON.stringify({ character: inline.character, npcs: inline.npcs }) });
        const loaded = await loadGameFromCloud('u1', 'legacy');
        expect(loaded.character.portraitUrl).toBe(inline.character.portraitUrl);
        expect(loaded.npcs[0].portraitUrl).toBe(inline.npcs[0].portraitUrl);
        // Re-saving splits it.
        await saveGameToCloud('u1', 'legacy', { ...makeGameState(), character: loaded.character, npcs: loaded.npcs });
        expect(portraitPaths()).toHaveLength(2);
        expect(chunkData()[0]).not.toContain('data:image/');
    });

    it('a hostile portraitRefs on an existing doc never breaks a save or a delete, and the sweep is bounded', async () => {
        const junk = [
            ...Array.from({ length: 100_000 }, (_, i) => `p-${i.toString(36)}-abc-def`),
            { ref: 'x' }, 42, null, '../saves/slot-1', 'p-' + 'x'.repeat(50), '', 'users/u1/saves/slot-1',
        ];
        for (const portraitRefs of [junk, 'p-1-2-3', { 0: 'p-1-2-3' }, null]) {
            firestore.__store.clear();
            firestore.__store.set('users/u1/saves/slot-1', { slotId: 'slot-1', name: 'Old', payloadChunks: 1, payload: null, portraitRefs });
            const saved = await recordWrites(() => saveGameToCloud('u1', 'slot-1', makeGameState()));
            expect(saved.result.ok).toBe(true);
            expect(firestore.__store.get('users/u1/saves/slot-1').portraitRefs).toEqual([]);
            expect(firestore.__store.has('users/u1/saves/slot-1/chunks/0')).toBe(true);

            firestore.__store.get('users/u1/saves/slot-1').portraitRefs = portraitRefs;
            const deletes = [];
            const origDelete = firestore.__store.delete.bind(firestore.__store);
            firestore.__store.delete = (key) => { deletes.push(key); return origDelete(key); };
            expect(await deleteGameFromCloud('u1', 'slot-1')).toBe(true);
            firestore.__store.delete = origDelete;
            expect(deletes.filter(k => k.includes('/portraits/')).length).toBeLessThanOrEqual(512);
            // Only well-formed keys are ever addressed — never a path-shaped string.
            deletes.forEach(k => expect(k).toMatch(/^users\/u1\/(saves\/slot-1(\/chunks\/\d+)?|portraits\/p-[0-9a-z]{1,8}-[0-9a-z]{1,8}-[0-9a-z]{1,8})$/));
            expect(firestore.__store.has('users/u1/saves/slot-1')).toBe(false);
        }
    });

    it('a failed portrait sweep never fails the save or the delete that released the ref', async () => {
        await saveGameToCloud('u1', 'slot-a', gallery(1));
        // Overwriting with a portrait-less state releases both refs; the only
        // getDocs that save makes is the sweep's claimed-refs read.
        firestore.__fail.getDocs = new Error('unavailable');
        expect(await saveGameToCloud('u1', 'slot-a', makeGameState())).toEqual({ ok: true, portraitsUploaded: 0, chaptersUploaded: 0 });
        expect(portraitPaths()).toHaveLength(2); // orphans left behind, harmless
        await saveGameToCloud('u1', 'slot-b', gallery(1, { seedOffset: 50 }));
        firestore.__fail.getDocs = new Error('unavailable');
        expect(await deleteGameFromCloud('u1', 'slot-b')).toBe(true);
        expect(firestore.__store.has('users/u1/saves/slot-b')).toBe(false);
        expect(portraitPaths()).toHaveLength(4);
    });

    it('the list never carries portraitRefs or blob bytes', async () => {
        await saveGameToCloud('u1', 'slot-gallery', gallery(12));
        const [row] = await listCloudSaves('u1');
        expect(row.portraitRefs).toBeUndefined();
        expect(JSON.stringify(row)).not.toContain('data:image/');
    });
});
