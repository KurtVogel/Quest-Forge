/**
 * 2026-09-26 chronicler Lap-3 (performance & token budget) queue sweep — the
 * cloud CHAPTER lane and the pin that the two "same snapshot" storage paths
 * list the same blob lanes.
 *
 * Measured pre-fix: the chronicle rode every manual cloud save inline — 18 %
 * of a 1,000-message payload with 3 chapters, re-uploaded on every save and
 * counted against the 9 MiB pre-flight although chapters never change. The
 * IndexedDB v5 chapter split (09-24) had no cloud twin because
 * `saveGameToCloud` extracted portraits only.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../config/firebase.js', async () => ({ db: { mock: true }, firestoreSdk: await import('firebase/firestore') }));

vi.mock('firebase/firestore', () => {
    const store = new Map(); // full doc path -> plain data object
    const collection = (db, path) => ({ path });
    const doc = (parent, id) => ({ path: `${parent.path}/${id}` });
    const setDoc = async (ref, data) => { store.set(ref.path, JSON.parse(JSON.stringify(data))); };
    const getDoc = async (ref) => ({ exists: () => store.has(ref.path), data: () => store.get(ref.path) });
    const getDocs = async (col) => {
        const prefix = `${col.path}/`;
        const docs = [...store.entries()]
            .filter(([path]) => path.startsWith(prefix) && !path.slice(prefix.length).includes('/'))
            .map(([path, data]) => ({ id: path.slice(prefix.length), data: () => ({ ...data }) }));
        return { forEach: (cb) => docs.forEach(cb) };
    };
    const deleteDoc = async (ref) => { store.delete(ref.path); };
    const runTransaction = async (_db, fn) => {
        const ops = [];
        const transaction = {
            get: async (ref) => ({ exists: () => store.has(ref.path), data: () => store.get(ref.path) }),
            set: (ref, data) => { ops.push(() => store.set(ref.path, JSON.parse(JSON.stringify(data)))); },
            delete: (ref) => ops.push(() => store.delete(ref.path)),
        };
        const result = await fn(transaction);
        ops.forEach(op => op());
        return result;
    };
    return { collection, doc, setDoc, getDoc, getDocs, deleteDoc, runTransaction, __store: store };
});

const firestore = await import('firebase/firestore');
const { saveGameToCloud, loadGameFromCloud, deleteGameFromCloud } = await import('./cloudSync.js');
const loadState = async (...args) => {
    const loaded = await loadGameFromCloud(...args);
    return loaded.ok ? loaded.state : null;
};
const { prepareSavePayload } = await import('./persistence.js');
const { BLOB_LANES } = await import('./portraitStore.js');

const chapterText = (n) => `Chapter ${n}. ${'The road bent north under a bruised sky, and Eero walked it. '.repeat(600)}`; // ~38k chars
function chapters(count, { offset = 0 } = {}) {
    return Array.from({ length: count }, (_, i) => ({
        id: `ch-${offset + i}`, title: `Chapter ${offset + i + 1}`, text: chapterText(offset + i), fromIndex: i * 10, toIndex: i * 10 + 9, createdAt: 1000 + i,
    }));
}
function makeGameState(overrides = {}) {
    return {
        session: { id: 's1', name: 'The Sundered Coast' },
        character: { name: 'Astra', level: 3, class: 'fighter', currentHP: 20, maxHP: 25, armorClass: 17, gold: 12, silver: 0, copper: 0 },
        inventory: [],
        messages: Array.from({ length: 30 }, (_, i) => ({ id: `m${i}`, role: i % 2 ? 'assistant' : 'user', content: `Beat ${i}` })),
        rollHistory: [], quests: [], journal: [], npcs: [], worldFacts: [], storyMemory: [], fronts: [], party: [],
        currentLocation: 'Oakhaven',
        combat: { active: false, enemies: [], turnOrder: [], currentTurn: 0, round: 1 },
        settings: { llmProvider: 'gemini', apiKey: 'secret-key' },
        user: { uid: 'u1' },
        ui: {},
        chronicle: chapters(3),
        ...overrides,
    };
}
const pathsUnder = (segment) => [...firestore.__store.keys()].filter(p => p.includes(`/${segment}/`));
const chunkData = () => pathsUnder('chunks').map(p => firestore.__store.get(p).data);
async function recordWrites(fn) {
    const writes = [];
    const origSet = firestore.__store.set.bind(firestore.__store);
    firestore.__store.set = (key, value) => { writes.push({ key, chars: JSON.stringify(value).length }); return origSet(key, value); };
    try { return { result: await fn(), writes }; } finally { firestore.__store.set = origSet; }
}

beforeEach(() => {
    firestore.__store.clear();
});

describe('the two storage paths share ONE lane table and ONE save prologue (2026-10-04 audit)', () => {
    // This suite used to pin that `CLOUD_BLOB_LANES` and persistence's
    // `BLOB_STORES` agreed lane for lane — a test whose job was to keep two
    // copies equal. There is one table now (`BLOB_LANES` in portraitStore.js),
    // so the pin is the module's own first-line claim instead: both paths
    // persist the SAME serialized state.
    it('the lane table is complete per lane: a store / collection id, a refs field, a label, a key pattern, and the extract / collect / restore triple', () => {
        expect(BLOB_LANES.map(lane => lane.id)).toEqual(['portraits', 'chronicleChapters']);
        expect(BLOB_LANES.map(lane => lane.refsField)).toEqual(['portraitRefs', 'chapterRefs']);
        for (const lane of BLOB_LANES) {
            expect(typeof lane.label, lane.id).toBe('string');
            expect(lane.keyPattern, lane.id).toBeInstanceOf(RegExp);
            for (const fn of ['extract', 'collect', 'restore']) expect(typeof lane[fn], `${lane.id} ${fn}`).toBe('function');
        }
    });

    it('the cloud payload IS the shared prologue\'s state, and the metadata doc carries the prologue\'s metadata — nothing path-specific but the stamp', async () => {
        const game = makeGameState({ character: { ...makeGameState().character, portraitUrl: `data:image/jpeg;base64,${'a'.repeat(5000)}` } });
        await saveGameToCloud('u1', 'slot-same', game);
        const local = prepareSavePayload('slot-same', game, 0);
        const { savedAt: _cloudPayloadStamp, ...cloudState } = JSON.parse(chunkData().join(''));
        const { savedAt: _localPayloadStamp, ...localState } = JSON.parse(JSON.stringify(local.state));
        expect(cloudState).toEqual(localState);
        // No secrets, no live-only fields, and the dead save-time stamp is gone.
        expect(cloudState.settings).toBeUndefined();
        expect(cloudState.user).toBeUndefined();
        expect(cloudState.session).toEqual(game.session);
        const { savedAt: _docStamp, payload: _payload, payloadChunks: _chunks, ...cloudMetadata } = firestore.__store.get('users/u1/saves/slot-same');
        const { savedAt: _localStamp, ...localMetadata } = local.metadata;
        expect(cloudMetadata).toEqual(localMetadata);
        for (const lane of BLOB_LANES) expect(cloudMetadata[lane.refsField].length, lane.id).toBeGreaterThan(0);
    });

    it('every lane key the extract mints passes that lane\'s own key pattern (a typed metadata doc must trust real keys)', () => {
        const state = makeGameState({ character: { ...makeGameState().character, portraitUrl: `data:image/jpeg;base64,${'a'.repeat(5000)}` } });
        for (const lane of BLOB_LANES) {
            const { refs } = lane.extract(state);
            expect(refs.length, lane.id).toBeGreaterThan(0);
            refs.forEach(ref => expect(ref, `${lane.id} ${ref}`).toMatch(lane.keyPattern));
        }
    });
});

describe('cloud chapter collection (2026-09-26 chronicler P2)', () => {
    it('a save with N chapters carries ZERO chapter prose in its chunks, N chapter docs, and chapterRefs on the metadata doc', async () => {
        const result = await saveGameToCloud('u1', 'slot-saga', makeGameState());
        expect(result).toEqual({ ok: true, uploaded: { portrait: 0, chapter: 3 } });
        const main = firestore.__store.get('users/u1/saves/slot-saga');
        expect(main.payloadChunks).toBe(1);
        expect(main.chapterRefs).toHaveLength(3);
        main.chapterRefs.forEach(ref => expect(ref).toMatch(/^c-[0-9a-z]+-[0-9a-z]+-[0-9a-z]+$/));
        expect(main.portraitRefs).toEqual([]);
        expect(pathsUnder('chronicleChapters')).toHaveLength(3);
        for (const data of chunkData()) {
            expect(data).not.toContain('The road bent north');
            expect(data).toContain('"chapterRef"');
            expect(data).toContain('"title":"Chapter 1"'); // the chapter's own metadata stays in the payload
        }
        // The payload is a few KB; the chapters were ~115k chars.
        expect(chunkData().reduce((n, d) => n + d.length, 0)).toBeLessThan(20_000);
        for (const path of pathsUnder('chronicleChapters')) {
            const blob = firestore.__store.get(path);
            expect(blob.data.startsWith('Chapter ')).toBe(true);
            expect(blob.chars).toBe(blob.data.length);
        }
    });

    it('a steady-state re-save (same slot or a new one) writes ZERO chapter docs and re-uploads zero chapter bytes', async () => {
        await saveGameToCloud('u1', 'slot-a', makeGameState());
        const again = await recordWrites(() => saveGameToCloud('u1', 'slot-a', makeGameState()));
        expect(again.result).toEqual({ ok: true, uploaded: { portrait: 0, chapter: 0 } });
        expect(again.writes.filter(w => w.key.includes('/chronicleChapters/'))).toHaveLength(0);
        expect(again.writes.reduce((n, w) => n + w.chars, 0)).toBeLessThan(20_000);
        // A new slot of the same campaign shares the same three docs.
        const other = await recordWrites(() => saveGameToCloud('u1', 'slot-b', makeGameState()));
        expect(other.result.uploaded.chapter).toBe(0);
        expect(pathsUnder('chronicleChapters')).toHaveLength(3);
        // A fourth chapter uploads exactly one doc.
        const closed = await saveGameToCloud('u1', 'slot-a', makeGameState({ chronicle: chapters(4) }));
        expect(closed.uploaded.chapter).toBe(1);
        expect(pathsUnder('chronicleChapters')).toHaveLength(4);
    });

    it('the loader rehydrates every chapter: text back, no chapterRef in what LOAD_GAME receives, order kept', async () => {
        await saveGameToCloud('u1', 'slot-a', makeGameState());
        const loaded = await loadState('u1', 'slot-a');
        expect(loaded.chronicle).toHaveLength(3);
        loaded.chronicle.forEach((chapter, i) => {
            expect(chapter.text).toBe(chapterText(i));
            expect(chapter.title).toBe(`Chapter ${i + 1}`);
            expect(chapter).not.toHaveProperty('chapterRef');
        });
        expect(JSON.stringify(loaded)).not.toContain('chapterRef');
    });

    it('a missing or corrupt chapter doc drops THAT chapter (its span re-opens), never the load', async () => {
        await saveGameToCloud('u1', 'slot-a', makeGameState());
        const [, second, third] = firestore.__store.get('users/u1/saves/slot-a').chapterRefs;
        firestore.__store.delete(`users/u1/chronicleChapters/${second}`);
        firestore.__store.set(`users/u1/chronicleChapters/${third}`, { data: { not: 'a string' } });
        const loaded = await loadState('u1', 'slot-a');
        expect(loaded).not.toBeNull();
        expect(loaded.chronicle.map(c => c.id)).toEqual(['ch-0']);
        expect(loaded.chronicle[0].text).toBe(chapterText(0));
    });

    it("delete sweeps the slot's chapter docs but keeps every doc another slot still claims", async () => {
        await saveGameToCloud('u1', 'slot-a', makeGameState({ chronicle: chapters(3) }));
        await saveGameToCloud('u1', 'slot-b', makeGameState({ chronicle: chapters(2, { offset: 1 }) })); // shares chapters 1 and 2
        const bRefs = firestore.__store.get('users/u1/saves/slot-b').chapterRefs;
        expect((await deleteGameFromCloud('u1', 'slot-a')).ok).toBe(true);
        expect(pathsUnder('chronicleChapters').map(p => p.split('/chronicleChapters/')[1]).sort()).toEqual([...bRefs].sort());
        expect((await loadState('u1', 'slot-b')).chronicle.map(c => c.text)).toEqual([chapterText(1), chapterText(2)]);
    });

    it('an overwrite that releases a ref (a removed chapter) sweeps its doc unless another slot claims it', async () => {
        await saveGameToCloud('u1', 'slot-a', makeGameState({ chronicle: chapters(3) }));
        await saveGameToCloud('u1', 'slot-b', makeGameState({ chronicle: chapters(3) }));
        // Remove the newest chapter in slot-a only: slot-b still claims its doc.
        await saveGameToCloud('u1', 'slot-a', makeGameState({ chronicle: chapters(2) }));
        expect(pathsUnder('chronicleChapters')).toHaveLength(3);
        // Now slot-b drops it too: the doc goes.
        await saveGameToCloud('u1', 'slot-b', makeGameState({ chronicle: chapters(2) }));
        expect(pathsUnder('chronicleChapters')).toHaveLength(2);
    });

    it('a hostile chapterRefs list on an existing metadata doc is typed: junk entries never reach the sweep or the load', async () => {
        await saveGameToCloud('u1', 'slot-a', makeGameState({ chronicle: chapters(1) }));
        const main = firestore.__store.get('users/u1/saves/slot-a');
        firestore.__store.set('users/u1/saves/slot-a', { ...main, chapterRefs: [42, null, '../escape', 'p-1-2-3', { ref: 'x' }, ...main.chapterRefs] });
        // A re-save with no chapters releases exactly the one real ref.
        await saveGameToCloud('u1', 'slot-a', makeGameState({ chronicle: [] }));
        expect(pathsUnder('chronicleChapters')).toHaveLength(0);
        expect(firestore.__store.get('users/u1/saves/slot-a').chapterRefs).toEqual([]);
        expect((await loadState('u1', 'slot-a')).chronicle).toEqual([]);
    });

    it('a pre-split inline payload (chapters with text, no refs) still loads as-is', async () => {
        await saveGameToCloud('u1', 'slot-a', makeGameState({ chronicle: [] }));
        const inline = JSON.stringify({ ...makeGameState(), settings: undefined, user: undefined, ui: undefined, saveVersion: 1 });
        firestore.__store.set('users/u1/saves/slot-legacy', { slotId: 'slot-legacy', payloadChunks: 0, payload: inline });
        const loaded = await loadState('u1', 'slot-legacy');
        expect(loaded.chronicle).toHaveLength(3);
        expect(loaded.chronicle[2].text).toBe(chapterText(2));
    });
});
