/**
 * Tests for cloud saves — especially the chunked-payload path that removes
 * Firestore's 1 MiB document ceiling for very long campaigns.
 * Firestore is mocked with an in-memory path → data store.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../config/firebase.js', () => ({ db: { mock: true } }));

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
    return { collection, doc, setDoc, getDoc, getDocs, deleteDoc, writeBatch, __store: store, __fail };
});

const firestore = await import('firebase/firestore');
const { saveGameToCloud, loadGameFromCloud, listCloudSaves, deleteGameFromCloud } = await import('./cloudSync.js');

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
    it('round-trips a small save inline, keeping fronts and full messages, stripping secrets', async () => {
        expect(await saveGameToCloud('u1', 'slot-1', makeGameState())).toBe(true);
        const main = firestore.__store.get('users/u1/saves/slot-1');
        expect(main.payloadChunks).toBe(0);
        expect(chunkPaths()).toHaveLength(0);

        const loaded = await loadGameFromCloud('u1', 'slot-1');
        expect(loaded.fronts).toHaveLength(1);
        expect(loaded.messages).toHaveLength(2); // summarized messages are no longer trimmed
        expect(loaded.settings.apiKey).toBeUndefined();
        expect(loaded.settings.geminiApiKey).toBeUndefined();
        expect(loaded.user).toBeUndefined();
        expect(loaded.saveVersion).toBe(2);
    });

    it('splits an oversized save into chunks and reassembles it on load', async () => {
        expect(await saveGameToCloud('u1', 'slot-big', makeHugeGameState())).toBe(true);
        const main = firestore.__store.get('users/u1/saves/slot-big');
        expect(main.payload).toBeNull();
        expect(main.payloadChunks).toBeGreaterThanOrEqual(2);
        expect(chunkPaths()).toHaveLength(main.payloadChunks);

        const loaded = await loadGameFromCloud('u1', 'slot-big');
        expect(loaded.messages).toHaveLength(40);
        expect(loaded.messages[39].content).toBe('x'.repeat(20000));
        expect(loaded.character.name).toBe('Astra');
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

    it('clears stale chunks when a chunked save shrinks back to inline', async () => {
        await saveGameToCloud('u1', 'slot-1', makeHugeGameState());
        expect(chunkPaths().length).toBeGreaterThan(0);

        await saveGameToCloud('u1', 'slot-1', makeGameState());
        expect(chunkPaths()).toHaveLength(0);
        const main = firestore.__store.get('users/u1/saves/slot-1');
        expect(main.payloadChunks).toBe(0);
        expect((await loadGameFromCloud('u1', 'slot-1')).messages).toHaveLength(2);
    });

    it('fails loudly rather than returning a truncated campaign when a chunk is missing', async () => {
        await saveGameToCloud('u1', 'slot-big', makeHugeGameState());
        const [firstChunk] = chunkPaths();
        firestore.__store.delete(firstChunk);
        expect(await loadGameFromCloud('u1', 'slot-big')).toBeNull();
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
        expect(await saveGameToCloud('', 'slot-1', makeGameState())).toBe(false);
        expect(await loadGameFromCloud('', 'slot-1')).toBeNull();
        expect(await listCloudSaves('')).toEqual([]);
        expect(await deleteGameFromCloud('', 'slot-1')).toBe(false);
        expect(firestore.__store.size).toBe(0);
    });

    it('deleteGameFromCloud refuses a missing slotId', async () => {
        expect(await deleteGameFromCloud('u1', '')).toBe(false);
    });

    it('saveGameToCloud swallows a Firestore failure to false', async () => {
        firestore.__fail.getDoc = new Error('unavailable');
        expect(await saveGameToCloud('u1', 'slot-1', makeGameState())).toBe(false);
        expect(firestore.__store.size).toBe(0);
    });

    it('saveGameToCloud returns false on a permission-denied write (rules hint path)', async () => {
        const denied = new Error('Missing or insufficient permissions.');
        denied.code = 'permission-denied';
        firestore.__fail.setDoc = denied;
        expect(await saveGameToCloud('u1', 'slot-1', makeGameState())).toBe(false);
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
