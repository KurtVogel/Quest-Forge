/**
 * Tests for the persistence layer: localStorage settings + IndexedDB saves/roster.
 * Uses fake-indexeddb (real IndexedDB semantics, in-memory) and a minimal
 * localStorage stub since the vitest environment here is plain Node.
 */
import { describe, expect, it, beforeEach, vi } from 'vitest';
import { IDBFactory, IDBObjectStore } from 'fake-indexeddb';

function makeLocalStorageStub() {
    const store = new Map();
    return {
        getItem: (key) => (store.has(key) ? store.get(key) : null),
        setItem: (key, value) => store.set(key, String(value)),
        removeItem: (key) => store.delete(key),
        clear: () => store.clear(),
    };
}

beforeEach(() => {
    // Fresh, empty IndexedDB per test so saves/roster entries don't leak across tests.
    globalThis.indexedDB = new IDBFactory();
    globalThis.localStorage = makeLocalStorageStub();
});

const {
    saveSettings,
    loadSettings,
    saveGame,
    loadGame,
    listSaves,
    deleteSave,
    getSaveSessionId,
    saveRosterCharacter,
    listRosterCharacters,
    countRosterCharacters,
    loadRosterCharacter,
    deleteRosterCharacter,
    autoSave,
    loadAutoSave,
    projectSaveMetadata,
    SAVE_VERSION,
    serializeGameState,
} = await import('./persistence.js');

describe('settings (localStorage)', () => {
    it('round-trips settings through save/load', () => {
        saveSettings({ llmProvider: 'gemini', model: 'gemini-3.1-pro-preview' });
        expect(loadSettings()).toEqual({ llmProvider: 'gemini', model: 'gemini-3.1-pro-preview' });
    });

    it('returns null when nothing has been saved', () => {
        expect(loadSettings()).toBeNull();
    });

    it('returns null and does not throw on corrupt stored JSON', () => {
        globalThis.localStorage.setItem('rpg-client-settings', '{not valid json');
        expect(loadSettings()).toBeNull();
    });

    it('returns null when the stored value parses to a non-object (2026-07-25 audit)', () => {
        // A string would spread junk index keys into settings via GameContext's
        // `{...defaults, ...saved}` merge; arrays are equally not settings.
        globalThis.localStorage.setItem('rpg-client-settings', '"corrupted"');
        expect(loadSettings()).toBeNull();
        globalThis.localStorage.setItem('rpg-client-settings', '[1,2,3]');
        expect(loadSettings()).toBeNull();
        globalThis.localStorage.setItem('rpg-client-settings', '42');
        expect(loadSettings()).toBeNull();
    });
});

function makeGameState(overrides = {}) {
    return {
        session: { name: 'The Sundered Coast' },
        character: { name: 'Astra', level: 3, class: 'fighter', currentHP: 20, maxHP: 25, armorClass: 17, gold: 12, silver: 3, copper: 8 },
        inventory: [{ id: 'i1', name: 'Dagger' }],
        messages: [{ role: 'user', content: 'Hello', summarized: true }, { role: 'assistant', content: 'Hi there' }],
        rollHistory: Array.from({ length: 60 }, (_, i) => ({ id: `roll-${i}`, total: i })),
        quests: [{ id: 'q1', status: 'active' }, { id: 'q2', status: 'completed' }],
        journal: [],
        npcs: [],
        worldFacts: [],
        storyMemory: [],
        party: [{ id: 'c1' }],
        currentLocation: 'Oakhaven',
        combat: { active: false, enemies: [], turnOrder: [], currentTurn: 0, round: 1 },
        settings: { llmProvider: 'gemini', apiKey: 'secret-key', geminiApiKey: 'machinery-secret', imageApiKey: 'xai-secret', firebaseConfig: { apiKey: 'fb-secret' } },
        ...overrides,
    };
}

describe('portrait store — bytes that never change do not ride the record that changes every turn (2026-09-21 audit P1)', () => {
    const portrait = (seed) => `data:image/jpeg;base64,${String(seed).repeat(3000)}`;
    const withPortraits = (npcSeeds, overrides = {}) => makeGameState({
        character: { ...makeGameState().character, portraitUrl: portrait('H'), portraitProvider: 'xai', portraitUpdatedAt: 5 },
        npcs: npcSeeds.map(seed => ({ id: `npc-${seed}`, name: `NPC ${seed}`, portraitUrl: portrait(seed), portraitProvider: 'gemini', portraitUpdatedAt: 9 })),
        ...overrides,
    });
    const readStore = (storeName, mode = 'all') => new Promise((resolve, reject) => {
        const open = indexedDB.open('rpg-client-saves');
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
            const db = open.result;
            const store = db.transaction(storeName, 'readonly').objectStore(storeName);
            const request = mode === 'keys' ? store.getAllKeys() : store.getAll();
            request.onsuccess = () => { db.close(); resolve(request.result); };
            request.onerror = () => { db.close(); reject(request.error); };
        };
    });

    it('round-trips portraits while the stored payload carries refs, not bytes', async () => {
        const state = withPortraits(['A', 'B']);
        await saveGame('slot-p', state);

        const [payload] = await readStore('savePayloads');
        expect(JSON.stringify(payload)).not.toContain('data:image/');
        expect(payload.state.npcs[0].portraitRef).toMatch(/^p-/);
        expect(await readStore('portraits', 'keys')).toHaveLength(3);

        const loaded = await loadGame('slot-p');
        expect(loaded.character.portraitUrl).toBe(portrait('H'));
        expect(loaded.npcs.map(n => n.portraitUrl)).toEqual([portrait('A'), portrait('B')]);
        expect(loaded.npcs[0].portraitProvider).toBe('gemini');
        // A ref never reaches live state.
        expect(JSON.stringify(loaded)).not.toContain('portraitRef');
    });

    it('a steady-state resave writes no portrait bytes (the blob is put once)', async () => {
        const state = withPortraits(['A']);
        await saveGame('slot-p', state);
        const putSpy = vi.spyOn(IDBObjectStore.prototype, 'put');
        try {
            await saveGame('slot-p', { ...state, currentLocation: 'Elsewhere' });
            const portraitPuts = putSpy.mock.calls.filter(([value]) => typeof value === 'string');
            expect(portraitPuts).toHaveLength(0);
            expect(putSpy.mock.calls.length).toBe(2); // metadata + payload
        } finally {
            putSpy.mockRestore();
        }
    });

    it('sweeps a rerolled portrait, but never one another slot still shows', async () => {
        await saveGame('manual', withPortraits(['A']));
        await saveGame('auto', withPortraits(['A']));
        // Reroll in the live campaign: the autosave now points at A2.
        await saveGame('auto', withPortraits(['A2']));
        expect(await readStore('portraits', 'keys')).toHaveLength(3); // hero, A (manual), A2
        expect((await loadGame('manual')).npcs[0].portraitUrl).toBe(portrait('A'));

        await deleteSave('manual');
        expect(await readStore('portraits', 'keys')).toHaveLength(2); // hero, A2
        expect((await loadGame('auto')).npcs[0].portraitUrl).toBe(portrait('A2'));

        await deleteSave('auto');
        expect(await readStore('portraits', 'keys')).toHaveLength(0);
    });

    it('a pre-split payload with inline portraits still loads as-is, and a missing blob is a missing picture', async () => {
        await saveGame('slot-seed', makeGameState());
        await new Promise((resolve, reject) => {
            const open = indexedDB.open('rpg-client-saves');
            open.onerror = () => reject(open.error);
            open.onsuccess = () => {
                const db = open.result;
                const tx = db.transaction('savePayloads', 'readwrite');
                tx.objectStore('savePayloads').put({ slotId: 'inline', state: { character: { name: 'Old', portraitUrl: portrait('Z') }, npcs: [] } });
                tx.objectStore('savePayloads').put({ slotId: 'dangling', state: {
                    character: { name: 'Lost', portraitRef: 'p-gone', portraitProvider: 'xai', portraitUpdatedAt: 3 },
                    npcs: [{ id: 'n1', name: 'Ghost', portraitRef: 'p-gone-too', portraitProvider: 'xai' }],
                } });
                tx.oncomplete = () => { db.close(); resolve(); };
                tx.onabort = () => { db.close(); reject(tx.error); };
            };
        });
        expect((await loadGame('inline')).character.portraitUrl).toBe(portrait('Z'));
        const dangling = await loadGame('dangling');
        expect(dangling.character).toEqual({ name: 'Lost' });
        expect(dangling.npcs[0]).toEqual({ id: 'n1', name: 'Ghost' });
    });

    it('portraits are no share of the autosave payload at 40 NPC portraits', async () => {
        const big = (seed) => `data:image/jpeg;base64,${String(seed % 10).repeat(30_000)}${seed}`;
        const state = makeGameState({
            npcs: Array.from({ length: 40 }, (_, i) => ({ id: `npc-${i}`, name: `NPC ${i}`, portraitUrl: big(i) })),
        });
        await saveGame('slot-gallery', state);
        const [payload] = await readStore('savePayloads');
        // 40 × 30k = 1.2 MB of pictures; the record that changes every turn carries none of it.
        expect(JSON.stringify(payload).length).toBeLessThan(20_000);
        expect((await loadGame('slot-gallery')).npcs[39].portraitUrl).toBe(big(39));
    });
});

describe('saveGame / loadGame (IndexedDB)', () => {
    it('round-trips the full state for a named slot', async () => {
        await saveGame('slot-1', makeGameState());
        const loaded = await loadGame('slot-1');
        expect(loaded.character.name).toBe('Astra');
        expect(loaded.inventory).toEqual([{ id: 'i1', name: 'Dagger' }]);
        expect(loaded.currentLocation).toBe('Oakhaven');
    });

    it('returns null for a slot that was never saved', async () => {
        expect(await loadGame('never-saved')).toBeNull();
    });

    it('resolves null for a stored payload that is not a plain object (2026-09-11 persistence P2)', async () => {
        // The cloud loader got asSaveObject on 07-25; the local sibling passed a
        // string/array payload straight to LOAD_GAME, whose spread minted index
        // keys into live state with a null character — Load looked like a no-op.
        await saveGame('slot-seed', makeGameState());
        await new Promise((resolve, reject) => {
            const open = indexedDB.open('rpg-client-saves');
            open.onerror = () => reject(open.error);
            open.onsuccess = () => {
                const db = open.result;
                const tx = db.transaction(['saves', 'savePayloads'], 'readwrite');
                tx.objectStore('savePayloads').put({ slotId: 'junk-string', state: 'garbage' });
                tx.objectStore('savePayloads').put({ slotId: 'junk-array', state: [1, 2, 3] });
                tx.objectStore('saves').put({ slotId: 'junk-legacy', name: 'Legacy', savedAt: 1, state: 'garbage' });
                tx.oncomplete = () => { db.close(); resolve(); };
                tx.onabort = () => { db.close(); reject(tx.error); };
            };
        });
        expect(await loadGame('junk-string')).toBeNull();
        expect(await loadGame('junk-array')).toBeNull();
        expect(await loadGame('junk-legacy')).toBeNull();
    });

    it('falls back to a legacy embedded-state metadata record when no payload record exists (2026-08-27 audit)', async () => {
        // Pre-v3 records embedded the full state in the `saves` store; a record
        // whose payload never migrated/landed must still load through the belt.
        await saveGame('slot-seed', makeGameState()); // ensure the DB exists at v3
        await new Promise((resolve, reject) => {
            const open = indexedDB.open('rpg-client-saves');
            open.onerror = () => reject(open.error);
            open.onsuccess = () => {
                const db = open.result;
                const tx = db.transaction('saves', 'readwrite');
                tx.objectStore('saves').put({
                    slotId: 'legacy-slot',
                    name: 'Legacy',
                    savedAt: 1,
                    state: { character: { name: 'Old Hero' }, currentLocation: 'The Old Keep' },
                });
                tx.oncomplete = () => { db.close(); resolve(); };
                tx.onabort = () => { db.close(); reject(tx.error); };
            };
        });
        const loaded = await loadGame('legacy-slot');
        expect(loaded.character.name).toBe('Old Hero');
        expect(loaded.currentLocation).toBe('The Old Keep');
    });

    it('strips settings (secrets included) entirely from the snapshot — device-local by design (DECISIONS.md 2026-08-27)', async () => {
        await saveGame('slot-1', makeGameState());
        const loaded = await loadGame('slot-1');
        expect(loaded.settings).toBeUndefined();
    });

    it('caps persisted rollHistory at the most recent 50 entries', async () => {
        await saveGame('slot-1', makeGameState());
        const loaded = await loadGame('slot-1');
        expect(loaded.rollHistory).toHaveLength(50);
        expect(loaded.rollHistory[0].id).toBe('roll-10');
        expect(loaded.rollHistory.at(-1).id).toBe('roll-59');
    });

    it('derives prunedMessageCount from the contiguous summarized prefix', async () => {
        await saveGame('slot-1', makeGameState());
        const loaded = await loadGame('slot-1');
        expect(loaded.session.prunedMessageCount).toBe(1);
    });

    // Regression for the lost-fronts bug: the old field whitelist silently dropped
    // fronts and pendingRoleplayCheck, killing the hidden-fronts system on reload.
    it('persists fronts, pendingRoleplayCheck, appliedLootSourceIds, and recentPurchases', async () => {
        await saveGame('slot-1', makeGameState({
            fronts: [{ id: 'front-1', title: 'The Withering Tide', goal: 'Drown the coast', stakes: 'The port falls', clock: 3, grimPortents: ['a', 'b', 'c'] }],
            pendingRoleplayCheck: {
                id: 'check-1',
                rolls: [{ type: 'skill_check', skill: 'stealth', dc: 10, description: 'Slip past the guard' }],
                playerAction: 'I sneak by',
            },
            appliedLootSourceIds: ['msg-1'],
            recentPurchases: [{ signature: 'dagger|1|200', itemKey: 'dagger', name: 'Dagger', quantity: 1, priceCp: 200, sourceId: 'msg-buy-1', messageIndex: 4 }],
            recentSales: [{ signature: 'torch|2|1', itemKey: 'torch', name: 'Torch', quantity: 2, priceCp: 1, sourceId: 'msg-sell-1', messageIndex: 5 }],
        }));
        const loaded = await loadGame('slot-1');
        expect(loaded.fronts).toHaveLength(1);
        expect(loaded.fronts[0].id).toBe('front-1');
        expect(loaded.fronts[0].clock).toBe(3);
        expect(loaded.pendingRoleplayCheck.rolls).toHaveLength(1);
        expect(loaded.appliedLootSourceIds).toEqual(['msg-1']);
        expect(loaded.recentPurchases).toEqual([expect.objectContaining({ signature: 'dagger|1|200', itemKey: 'dagger' })]);
        expect(loaded.recentSales).toEqual([expect.objectContaining({ signature: 'torch|2|1', itemKey: 'torch' })]);
        expect(loaded.saveVersion).toBe(SAVE_VERSION);
    });

    it('persists future top-level state fields by default (spread, not whitelist)', async () => {
        await saveGame('slot-1', makeGameState({ someFutureSubsystem: { enabled: true } }));
        const loaded = await loadGame('slot-1');
        expect(loaded.someFutureSubsystem).toEqual({ enabled: true });
    });

    it('never persists live auth or transient ui state', async () => {
        await saveGame('slot-1', makeGameState({ user: { uid: 'u1' }, ui: { settingsOpen: true } }));
        const loaded = await loadGame('slot-1');
        expect(loaded.user).toBeUndefined();
        expect(loaded.ui).toBeUndefined();
    });

    it('re-saving the same slot overwrites the previous entry', async () => {
        await saveGame('slot-1', makeGameState({ currentLocation: 'Oakhaven' }));
        await saveGame('slot-1', makeGameState({ currentLocation: 'Galicia' }));
        const loaded = await loadGame('slot-1');
        expect(loaded.currentLocation).toBe('Galicia');
        expect(await listSaves()).toHaveLength(1);
    });
});

describe('listSaves', () => {
    it('lists saved slots sorted newest-first with summary metadata', async () => {
        await saveGame('slot-a', makeGameState({ character: { name: 'Astra', level: 3, class: 'fighter', currentHP: 20, maxHP: 25, armorClass: 17, gold: 0, silver: 0, copper: 0 } }));
        await new Promise(resolve => setTimeout(resolve, 2));
        await saveGame('slot-b', makeGameState({ character: { name: 'Borin', level: 1, class: 'cleric', currentHP: 10, maxHP: 10, armorClass: 15, gold: 0, silver: 0, copper: 0 } }));
        const saves = await listSaves();
        expect(saves.map(s => s.slotId)).toEqual(['slot-b', 'slot-a']);
        expect(saves[0].characterName).toBe('Borin');
        expect(saves[0].characterClass).toBe('cleric');
    });

    it('excludes the reserved autosave slot', async () => {
        await autoSave(makeGameState());
        await saveGame('slot-a', makeGameState());
        const saves = await listSaves();
        expect(saves.map(s => s.slotId)).toEqual(['slot-a']);
    });

    it('returns an empty list when there are no saves', async () => {
        expect(await listSaves()).toEqual([]);
    });

    it('projects the campaign sessionId stamp (null on legacy saves)', async () => {
        await saveGame('slot-a', makeGameState({ session: { id: 'campaign-1', name: 'Stamped' } }));
        await saveGame('slot-b', makeGameState()); // makeGameState session has no id
        const saves = await listSaves();
        expect(saves.find(s => s.slotId === 'slot-a').sessionId).toBe('campaign-1');
        expect(saves.find(s => s.slotId === 'slot-b').sessionId).toBeNull();
    });
});

describe('getSaveSessionId (embedding-purge support, 2026-08-06)', () => {
    it('reads a slot\'s campaign stamp from metadata alone — autosave slot included', async () => {
        await autoSave(makeGameState({ session: { id: 'campaign-live', name: 'Live' } }));
        expect(await getSaveSessionId('__autosave__')).toBe('campaign-live');
    });

    it('returns null for a missing slot and for legacy saves without the stamp', async () => {
        expect(await getSaveSessionId('never-saved')).toBeNull();
        await saveGame('slot-legacy', makeGameState());
        expect(await getSaveSessionId('slot-legacy')).toBeNull();
    });
});

describe('deleteSave', () => {
    it('removes a save so it no longer loads or lists', async () => {
        await saveGame('slot-1', makeGameState());
        await deleteSave('slot-1');
        expect(await loadGame('slot-1')).toBeNull();
        expect(await listSaves()).toEqual([]);
    });
});

/** Read a raw record straight from the store, bypassing the module's API. */
function readRawRecord(storeName, key) {
    return new Promise((resolve, reject) => {
        const req = globalThis.indexedDB.open('rpg-client-saves');
        req.onsuccess = () => {
            const db = req.result;
            const tx = db.transaction(storeName, 'readonly');
            const get = tx.objectStore(storeName).get(key);
            get.onsuccess = () => { db.close(); resolve(get.result); };
            get.onerror = () => { db.close(); reject(get.error); };
        };
        req.onerror = () => reject(req.error);
    });
}

describe('metadata/payload split (DB v3, 2026-08-04)', () => {
    it('stores the saves record metadata-only — the full state lives in savePayloads', async () => {
        // listSaves() used to materialize every save's multi-MB state at every
        // app boot and dialog open just to render ~15 metadata fields.
        await saveGame('slot-1', makeGameState());
        const metadata = await readRawRecord('saves', 'slot-1');
        expect(metadata.state).toBeUndefined();
        expect(metadata).toMatchObject({ slotId: 'slot-1', characterName: 'Astra', messageCount: 2 });
        const payload = await readRawRecord('savePayloads', 'slot-1');
        expect(payload.state.character.name).toBe('Astra');
    });

    it('migrates a v2 database in place: payload moves out, loads and lists keep working', async () => {
        // Hand-build a legacy v2 database with an embedded-state record.
        await new Promise((resolve, reject) => {
            const req = globalThis.indexedDB.open('rpg-client-saves', 2);
            req.onupgradeneeded = (event) => {
                const db = event.target.result;
                db.createObjectStore('saves', { keyPath: 'slotId' });
                db.createObjectStore('characters', { keyPath: 'id' });
            };
            req.onsuccess = () => {
                const db = req.result;
                const tx = db.transaction('saves', 'readwrite');
                tx.objectStore('saves').put({
                    slotId: 'legacy-slot', name: 'Old Save', characterName: 'Legacy Hero',
                    savedAt: 1, messageCount: 2,
                    state: { character: { name: 'Legacy Hero' }, currentLocation: 'Old Keep' },
                });
                tx.oncomplete = () => { db.close(); resolve(); };
                tx.onabort = () => { db.close(); reject(tx.error); };
            };
            req.onerror = () => reject(req.error);
        });

        // First module API call opens at v3 and runs the one-time migration.
        const loaded = await loadGame('legacy-slot');
        expect(loaded.currentLocation).toBe('Old Keep');
        const metadata = await readRawRecord('saves', 'legacy-slot');
        expect(metadata.state).toBeUndefined();
        expect(metadata.characterName).toBe('Legacy Hero');
        expect((await listSaves()).map(s => s.slotId)).toEqual(['legacy-slot']);
    });

    it('a failing payload copy leaves that one record legacy-but-loadable and still opens the DB (2026-09-02 P2)', async () => {
        // A quota abort inside the versionchange transaction used to fail the
        // open, re-run the upgrade on EVERY open, and fail every save/load/
        // autosave forever. Now the error is cancelled per record: the record
        // keeps its embedded state, loadGame's legacy fallback reads it, and
        // every other record migrates normally.
        const { vi } = await import('vitest');
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        await new Promise((resolve, reject) => {
            const req = globalThis.indexedDB.open('rpg-client-saves', 2);
            req.onupgradeneeded = (event) => {
                const db = event.target.result;
                db.createObjectStore('saves', { keyPath: 'slotId' });
                db.createObjectStore('characters', { keyPath: 'id' });
            };
            req.onsuccess = () => {
                const db = req.result;
                const tx = db.transaction('saves', 'readwrite');
                tx.objectStore('saves').put({
                    slotId: 'bad-slot', name: 'Doomed Save', characterName: 'Cursed Hero', savedAt: 1,
                    state: { character: { name: 'Cursed Hero' }, currentLocation: 'Quota Cliffs' },
                });
                tx.objectStore('saves').put({
                    slotId: 'good-slot', name: 'Fine Save', characterName: 'Lucky Hero', savedAt: 2,
                    state: { character: { name: 'Lucky Hero' }, currentLocation: 'Green Vale' },
                });
                tx.oncomplete = () => { db.close(); resolve(); };
                tx.onabort = () => { db.close(); reject(tx.error); };
            };
            req.onerror = () => reject(req.error);
        });

        // Force a REAL asynchronous request error on one record's payload copy:
        // a duplicate `add` raises ConstraintError as an error event, which —
        // unless cancelled — aborts the whole versionchange transaction.
        const originalPut = IDBObjectStore.prototype.put;
        IDBObjectStore.prototype.put = function patchedPut(value, key) {
            if (this.name === 'savePayloads' && value?.slotId === 'bad-slot') {
                this.add({ slotId: 'bad-slot' }); // stateless placeholder row
                return this.add(value, key);      // → ConstraintError (async)
            }
            return originalPut.call(this, value, key);
        };
        try {
            // The DB opens (the migration did not abort) and the failed record
            // loads through the legacy fallback.
            const bad = await loadGame('bad-slot');
            expect(bad.currentLocation).toBe('Quota Cliffs');
            const badMeta = await readRawRecord('saves', 'bad-slot');
            expect(badMeta.state).toBeDefined(); // never stripped: its copy never landed
            // The other record migrated normally.
            expect((await loadGame('good-slot')).currentLocation).toBe('Green Vale');
            expect((await readRawRecord('saves', 'good-slot')).state).toBeUndefined();
            expect((await listSaves()).map(s => s.slotId)).toEqual(['good-slot', 'bad-slot']);
            expect(warn).toHaveBeenCalledWith(expect.stringMatching(/payload copy for "bad-slot" failed/), expect.anything());
        } finally {
            IDBObjectStore.prototype.put = originalPut;
            warn.mockRestore();
        }
    });
});

describe('character roster', () => {
    function makeHero(overrides = {}) {
        return { id: 'hero-1', name: 'Astra', race: 'human', class: 'fighter', level: 3, ...overrides };
    }

    it('saves and lists a roster hero; the list row is metadata and the hero loads by id', async () => {
        await saveRosterCharacter(makeHero(), [{ id: 'i1', name: 'Dagger' }]);
        const roster = await listRosterCharacters();
        expect(roster).toHaveLength(1);
        expect(roster[0].name).toBe('Astra');
        expect(roster[0]).not.toHaveProperty('inventory');
        expect(roster[0]).not.toHaveProperty('character');
        const hero = await loadRosterCharacter('hero-1');
        expect(hero.character.name).toBe('Astra');
        expect(hero.inventory).toEqual([{ id: 'i1', name: 'Dagger' }]);
        expect(await loadRosterCharacter('nobody')).toBeNull();
    });

    it('re-saving a hero with the same id updates the existing roster entry', async () => {
        await saveRosterCharacter(makeHero(), []);
        await saveRosterCharacter(makeHero({ level: 5 }), []);
        const roster = await listRosterCharacters();
        expect(roster).toHaveLength(1);
        expect(roster[0].level).toBe(5);
    });

    it('projects roster rows to typed render fields and drops unkeyed/non-object records (2026-09-11 persistence P2)', async () => {
        await saveRosterCharacter(makeHero(), []);
        await new Promise((resolve, reject) => {
            const open = indexedDB.open('rpg-client-saves');
            open.onerror = () => reject(open.error);
            open.onsuccess = () => {
                const db = open.result;
                const tx = db.transaction('characters', 'readwrite');
                tx.objectStore('characters').put({ id: 'junk-1', name: { first: 'X' }, race: 7, class: null, level: 'abc', savedAt: 'later', character: 'nope', inventory: 'none' });
                tx.objectStore('characters').put({ id: 'junk-2', name: '', level: 2, savedAt: 5, character: { name: 'From Character' } });
                tx.oncomplete = () => { db.close(); resolve(); };
                tx.onabort = () => { db.close(); reject(tx.error); };
            };
        });
        const roster = await listRosterCharacters();
        expect(roster.map(entry => entry.id)).toEqual(['hero-1', 'junk-2', 'junk-1']);
        const junk = roster.find(entry => entry.id === 'junk-1');
        expect(junk).toEqual({ id: 'junk-1', name: 'Unnamed hero', race: '', class: '', level: 1, savedAt: 0 });
        expect(roster.find(entry => entry.id === 'junk-2').name).toBe('From Character');
        // The hydrated row types the same way: a junk character is null, a junk inventory [].
        expect(await loadRosterCharacter('junk-1')).toEqual({ id: 'junk-1', name: 'Unnamed hero', race: '', class: '', level: 1, savedAt: 0, character: null, inventory: [] });
        expect((await loadRosterCharacter('hero-1')).character.name).toBe('Astra');
    });

    it('generates an id when the character has none', async () => {
        const entry = await saveRosterCharacter({ name: 'No Id Hero', race: 'elf', class: 'wizard', level: 1 }, []);
        expect(entry.id).toMatch(/^char-/);
    });

    it('embeds a minted id into the stored character so callers can adopt it (2026-07-25 audit)', async () => {
        // Without adoption, a legacy pre-id-era hero duplicated a roster entry
        // on every "Save to Roster" click.
        const entry = await saveRosterCharacter({ name: 'No Id Hero', race: 'elf', class: 'wizard', level: 1 }, []);
        expect(entry.character.id).toBe(entry.id);
        const withId = await saveRosterCharacter(makeHero(), []);
        expect(withId.character.id).toBe('hero-1');
    });

    it('deletes a roster hero', async () => {
        await saveRosterCharacter(makeHero(), []);
        await deleteRosterCharacter('hero-1');
        expect(await listRosterCharacters()).toEqual([]);
    });
});

describe('roster rows carry no portrait bytes — the last inline-portrait store is split (2026-09-24 character-vault P2)', () => {
    const portrait = (seed) => `data:image/jpeg;base64,${String(seed).repeat(30_000)}`;
    const hero = (overrides = {}) => ({
        id: 'hero-1', name: 'Astra', race: 'human', class: 'fighter', level: 3,
        gender: 'woman', background: 'A disgraced lamplighter.', appearance: 'Scarred.',
        portraitUrl: portrait('H'), portraitProvider: 'gemini', portraitUpdatedAt: 5,
        ...overrides,
    });
    const readStore = (storeName, mode = 'all') => new Promise((resolve, reject) => {
        const open = indexedDB.open('rpg-client-saves');
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
            const db = open.result;
            const store = db.transaction(storeName, 'readonly').objectStore(storeName);
            const request = mode === 'keys' ? store.getAllKeys() : store.getAll();
            request.onsuccess = () => { db.close(); resolve(request.result); };
            request.onerror = () => { db.close(); reject(request.error); };
        };
    });
    const putRaw = (storeName, record) => new Promise((resolve, reject) => {
        const open = indexedDB.open('rpg-client-saves');
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
            const db = open.result;
            const tx = db.transaction(storeName, 'readwrite');
            tx.objectStore(storeName).put(record);
            tx.oncomplete = () => { db.close(); resolve(); };
            tx.onabort = () => { db.close(); reject(tx.error); };
        };
    });

    it('the stored row is a ref plus ~6k of hero; the picture sits once in the portraits store', async () => {
        await saveRosterCharacter(hero(), [{ id: 'i1', name: 'Dagger' }]);
        const [row] = await readStore('characters');
        const rowJson = JSON.stringify(row);
        expect(rowJson).not.toContain('data:image/');
        expect(rowJson.length).toBeLessThan(2_000); // was 97k on a live L5 wizard, 90k of it the portrait
        expect(row.character.portraitRef).toMatch(/^p-/);
        expect(row.portraitRefs).toEqual([row.character.portraitRef]);
        expect(row.character.portraitProvider).toBe('gemini');
        expect(await readStore('portraits', 'keys')).toEqual([row.character.portraitRef]);
    });

    it('the list is metadata with no portrait bytes; select / begin / export hydrate one row with the picture inline', async () => {
        await saveRosterCharacter(hero(), [{ id: 'i1', name: 'Dagger' }]);
        await saveRosterCharacter(hero({ id: 'hero-2', name: 'Borin', portraitUrl: portrait('B') }), []);
        const list = await listRosterCharacters();
        const listJson = JSON.stringify(list);
        expect(list.map(row => Object.keys(row).sort())).toEqual([
            ['class', 'id', 'level', 'name', 'race', 'savedAt'],
            ['class', 'id', 'level', 'name', 'race', 'savedAt'],
        ]);
        expect(listJson).not.toContain('data:image/');
        expect(listJson).not.toContain('portraitRef');

        const loaded = await loadRosterCharacter('hero-1');
        expect(loaded.character.portraitUrl).toBe(portrait('H'));
        expect(loaded.character.portraitProvider).toBe('gemini');
        expect(loaded.character.background).toBe('A disgraced lamplighter.');
        expect(loaded.inventory).toEqual([{ id: 'i1', name: 'Dagger' }]);
        // A ref never reaches the wizard.
        expect(JSON.stringify(loaded)).not.toContain('portraitRef');
    });

    it('the forge path reads no roster row: the start card count deserializes nothing', async () => {
        await saveRosterCharacter(hero(), []);
        await saveRosterCharacter(hero({ id: 'hero-2', name: 'Borin', portraitUrl: portrait('B') }), []);
        const spies = ['getAll', 'get', 'openCursor', 'getAllKeys'].map(method => vi.spyOn(IDBObjectStore.prototype, method));
        try {
            expect(await countRosterCharacters()).toBe(2);
            for (const spy of spies) expect(spy).not.toHaveBeenCalled();
        } finally {
            spies.forEach(spy => spy.mockRestore());
        }
    });

    it('a hero in a save slot AND the roster shares one blob; each side keeps it live for the other', async () => {
        const state = makeGameState({ character: hero() });
        await saveGame('slot-a', state);
        const putSpy = vi.spyOn(IDBObjectStore.prototype, 'put');
        try {
            await saveRosterCharacter(hero(), []);
            // The roster save wrote the row only — the campaign already holds the blob.
            expect(putSpy.mock.calls.filter(([value]) => typeof value === 'string')).toHaveLength(0);
        } finally {
            putSpy.mockRestore();
        }
        expect(await readStore('portraits', 'keys')).toHaveLength(1);

        // The slot goes: the roster still shows the picture, so the sweep keeps it.
        await deleteSave('slot-a');
        expect(await readStore('portraits', 'keys')).toHaveLength(1);
        expect((await loadRosterCharacter('hero-1')).character.portraitUrl).toBe(portrait('H'));

        // The roster hero goes: nothing shows it any more.
        await deleteRosterCharacter('hero-1');
        expect(await readStore('portraits', 'keys')).toHaveLength(0);
    });

    it('deleting the roster hero keeps a blob a slot still shows; a roster reroll releases the old one', async () => {
        await saveRosterCharacter(hero(), []);
        await saveGame('slot-a', makeGameState({ character: hero() }));
        await deleteRosterCharacter('hero-1');
        expect(await readStore('portraits', 'keys')).toHaveLength(1);
        expect((await loadGame('slot-a')).character.portraitUrl).toBe(portrait('H'));

        await saveRosterCharacter(hero({ id: 'hero-9', portraitUrl: portrait('X') }), []);
        await saveRosterCharacter(hero({ id: 'hero-9', portraitUrl: portrait('Y') }), []);
        const keys = await readStore('portraits', 'keys');
        expect(keys).toHaveLength(2); // H (slot-a) + Y; X was swept on the reroll
        expect((await loadRosterCharacter('hero-9')).character.portraitUrl).toBe(portrait('Y'));
    });

    it('a pre-split row with an inline portrait lists and loads as-is and splits on its next save; a missing blob is a missing picture', async () => {
        expect(await countRosterCharacters()).toBe(0); // creates the stores before the raw writes below
        await putRaw('characters', { id: 'legacy', name: 'Old', race: 'elf', class: 'wizard', level: 2, savedAt: 1, character: { id: 'legacy', name: 'Old', portraitUrl: portrait('L'), portraitProvider: 'xai' }, inventory: [] });
        await putRaw('characters', { id: 'dangling', name: 'Lost', race: 'elf', class: 'wizard', level: 2, savedAt: 1, portraitRefs: ['p-gone'], character: { id: 'dangling', name: 'Lost', portraitRef: 'p-gone', portraitProvider: 'xai', portraitUpdatedAt: 3 }, inventory: [] });
        expect((await listRosterCharacters()).map(row => row.name).sort()).toEqual(['Lost', 'Old']);
        const legacy = await loadRosterCharacter('legacy');
        expect(legacy.character.portraitUrl).toBe(portrait('L'));
        await saveRosterCharacter(legacy.character, legacy.inventory);
        const stored = (await readStore('characters')).find(row => row.id === 'legacy');
        expect(JSON.stringify(stored)).not.toContain('data:image/');
        expect(await readStore('portraits', 'keys')).toEqual([stored.character.portraitRef]);

        expect((await loadRosterCharacter('dangling')).character).toEqual({ id: 'dangling', name: 'Lost' });
    });
});

describe('autoSave / loadAutoSave', () => {
    it('round-trips through the reserved autosave slot and reports success', async () => {
        expect(await autoSave(makeGameState({ currentLocation: 'Galicia' }))).toBe(true);
        const loaded = await loadAutoSave();
        expect(loaded.currentLocation).toBe('Galicia');
    });

    it('loadAutoSave returns null when no autosave exists', async () => {
        expect(await loadAutoSave()).toBeNull();
    });

    it('autoSave reports failure instead of throwing, so the UI can warn the player', async () => {
        await expect(autoSave(null)).resolves.toBe(false);
    });

    it('autoSave(null) closes the connection it opened even though the snapshot build throws synchronously (2026-09-02 P2)', async () => {
        // `null.messages` throws INSIDE the executor before any request exists:
        // the old per-function close-on-complete/abort handlers never ran, so
        // the connection leaked (and a leaked connection blocks every other
        // tab's versioned open).
        const closed = { value: false };
        const db = {
            close: () => { closed.value = true; },
            transaction: () => ({ objectStore: () => ({ put: () => ({}) }) }),
        };
        globalThis.indexedDB = {
            open: () => {
                const req = {};
                queueMicrotask(() => { req.result = db; req.onsuccess?.(); });
                return req;
            },
        };
        await expect(autoSave(null)).resolves.toBe(false);
        expect(closed.value).toBe(true);
    });

    it('loadAutoSave REJECTS on a storage failure instead of resolving null like a missing autosave (2026-09-02 P1)', async () => {
        // The boot screen must be able to tell "nothing to continue" from
        // "could not look" — a swallowed failure rendered as no-autosave/no-saves.
        globalThis.indexedDB = {
            open: () => {
                const req = {};
                queueMicrotask(() => { req.error = new Error('storage evicted'); req.onerror?.(); });
                return req;
            },
        };
        await expect(loadAutoSave()).rejects.toThrow('storage evicted');
    });
});

describe('failure surfacing', () => {
    it('saveSettings returns true on success and false when localStorage throws', async () => {
        const { vi } = await import('vitest');
        expect(saveSettings({ llmProvider: 'gemini' })).toBe(true);

        globalThis.localStorage.setItem = vi.fn(() => { throw new Error('QuotaExceededError'); });
        expect(saveSettings({ llmProvider: 'gemini' })).toBe(false);
    });

    it('loadGame rejects and closes the connection when the read request errors', async () => {
        const closed = { value: false };
        const erroringDb = {
            close: () => { closed.value = true; },
            transaction: () => {
                const request = {};
                const tx = {
                    objectStore: () => ({ get: () => request, getAll: () => request }),
                };
                queueMicrotask(() => {
                    const err = new Error('disk failure');
                    request.error = err;
                    request.onerror?.();
                    tx.error = err;
                    tx.onabort?.();
                });
                return tx;
            },
        };
        globalThis.indexedDB = {
            open: () => {
                const req = {};
                queueMicrotask(() => {
                    req.result = erroringDb;
                    req.onsuccess?.();
                });
                return req;
            },
        };

        await expect(loadGame('slot-1')).rejects.toThrow('disk failure');
        expect(closed.value).toBe(true);
    });

    it('listSaves rejects and closes the connection when the read request errors', async () => {
        const closed = { value: false };
        const erroringDb = {
            close: () => { closed.value = true; },
            transaction: () => {
                const request = {};
                const tx = {
                    objectStore: () => ({ get: () => request, getAll: () => request }),
                };
                queueMicrotask(() => {
                    const err = new Error('read failed');
                    request.error = err;
                    request.onerror?.();
                    tx.error = err;
                    tx.onabort?.();
                });
                return tx;
            },
        };
        globalThis.indexedDB = {
            open: () => {
                const req = {};
                queueMicrotask(() => {
                    req.result = erroringDb;
                    req.onsuccess?.();
                });
                return req;
            },
        };

        await expect(listSaves()).rejects.toThrow('read failed');
        expect(closed.value).toBe(true);
    });

    it('a versionchange event from another tab closes the connection (2026-09-02 P2)', async () => {
        const closed = { value: false };
        const db = {
            close: () => { closed.value = true; },
            // A transaction that never settles — the connection is mid-read
            // when the other tab's versioned open fires versionchange at it.
            transaction: () => ({ objectStore: () => ({ get: () => ({}) }) }),
        };
        globalThis.indexedDB = {
            open: () => {
                const req = {};
                queueMicrotask(() => { req.result = db; req.onsuccess?.(); });
                return req;
            },
        };
        loadGame('slot-1'); // stays pending by construction
        await new Promise(resolve => setTimeout(resolve, 0));
        expect(typeof db.onversionchange).toBe('function');
        expect(closed.value).toBe(false);
        db.onversionchange();
        expect(closed.value).toBe(true);
    });

    it('rejects with a clear message instead of hanging forever when the open stays blocked', async () => {
        const { vi } = await import('vitest');
        vi.useFakeTimers();
        try {
            globalThis.indexedDB = {
                open: () => {
                    const req = {};
                    queueMicrotask(() => req.onblocked?.());
                    return req;
                },
            };
            const pending = loadGame('slot-1');
            const guarded = expect(pending).rejects.toThrow(/blocked by another open tab/);
            await vi.advanceTimersByTimeAsync(9000);
            await guarded;
        } finally {
            vi.useRealTimers();
        }
    });
});

describe('projectSaveMetadata — the ONE typed list row (2026-09-10 audit P1)', () => {
    it('types every rendered field: text string-or-fallback, counts finite, slotId falls back to the record key', () => {
        const row = projectSaveMetadata({
            name: { title: 'x' }, characterName: 7, characterLevel: '4', characterClass: null, characterHP: 'lots',
            gold: '12', location: ['Docks'], savedAt: { d: 1 }, messageCount: Infinity, sessionId: 5, state: { huge: true },
        }, 'doc-key');
        expect(row).toEqual({
            slotId: 'doc-key', sessionId: null, name: 'Unnamed Save', characterName: 'Unknown', characterLevel: 4,
            characterClass: 'Unknown', characterHP: 0, characterMaxHP: 0, characterAC: 10, gold: 12, silver: 0, copper: 0,
            inventoryCount: 0, location: null, questCount: 0, partySize: 0, messageCount: 0, savedAt: 0,
        });
        expect('state' in row).toBe(false);
    });

    it('keeps honest values and the stored slotId over the fallback', () => {
        const row = projectSaveMetadata({ slotId: 'slot-1', name: 'Coast', characterLevel: 3, location: 'Oakhaven', savedAt: 1700000000000 }, 'doc-key');
        expect(row).toMatchObject({ slotId: 'slot-1', name: 'Coast', characterLevel: 3, location: 'Oakhaven', savedAt: 1700000000000 });
        expect(projectSaveMetadata(null).slotId).toBeNull();
    });

    it('listSaves returns typed rows even when the saved state carried object text', async () => {
        await saveGame('slot-junk', makeGameState({ session: { id: 's1', name: { title: 'Campaign' } }, currentLocation: { name: 'Docks' } }));
        const [row] = await listSaves();
        expect(row.slotId).toBe('slot-junk');
        expect(row.name).toBe('Unnamed Save');
        expect(row.location).toBeNull();
    });
});

describe('loadSettings types every field (2026-09-16 providers-adapter P2 — the one persisted input without a heal)', () => {
    it('non-string keys become empty strings, unknown keys drop, and the whitelists hold', () => {
        globalThis.localStorage.setItem('rpg-client-settings', JSON.stringify({
            llmProvider: 'grokker', apiKey: 123, geminiApiKey: { k: 1 }, imageApiKey: '  xai-abc  ',
            model: ['gemini'], preset: 'nope', ruleset: 'simplified5e', paceDial: 'ludicrous',
            customSystemPrompt: 42, memoryInspector: 'yes', firebaseConfig: { apiKey: 'fb', projectId: 7, authDomain: 'x.app' },
            __proto__junk: 'x', evil: 'x'.repeat(10),
        }));
        expect(loadSettings()).toEqual({
            apiKey: '', geminiApiKey: '', imageApiKey: 'xai-abc', model: '', ruleset: 'simplified5e', customSystemPrompt: '',
            paceDial: 'standard', memoryInspector: false, firebaseConfig: { apiKey: 'fb', authDomain: 'x.app' },
        });
    });

    it('a well-formed blob round-trips unchanged, including a valid provider, preset, and pace', () => {
        const settings = { llmProvider: 'xai', apiKey: 'k', geminiApiKey: 'g', model: 'grok-4.3', preset: 'grimdark', paceDial: 'slow-burn', memoryInspector: true };
        saveSettings(settings);
        expect(loadSettings()).toEqual(settings);
    });

    it('an over-long custom prompt clamps instead of riding every DM call whole', () => {
        saveSettings({ customSystemPrompt: 'p'.repeat(30000) });
        expect(loadSettings().customSystemPrompt).toHaveLength(20000);
    });
});

describe('chronicle store — chapter prose does not ride the record that changes every turn (2026-09-23 persistence P2)', () => {
    const chapterText = (seed) => `The ${seed} chapter, retold. `.repeat(1800); // ~50k chars, the audit's 45k
    const chapter = (seed, i) => ({ id: `chapter-${seed}`, title: `Chapter ${seed}`, text: chapterText(seed), fromIndex: i * 10, toIndex: i * 10 + 9, createdAt: 1000 + i });
    const withChapters = (seeds, overrides = {}) => makeGameState({ chronicle: seeds.map((seed, i) => chapter(seed, i)), ...overrides });
    const portrait = (seed) => `data:image/jpeg;base64,${String(seed).repeat(3000)}`;
    const readStore = (storeName, mode = 'all') => new Promise((resolve, reject) => {
        const open = indexedDB.open('rpg-client-saves');
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
            const db = open.result;
            const store = db.transaction(storeName, 'readonly').objectStore(storeName);
            const request = mode === 'keys' ? store.getAllKeys() : store.getAll();
            request.onsuccess = () => { db.close(); resolve(request.result); };
            request.onerror = () => { db.close(); reject(request.error); };
        };
    });
    const putPayload = (slotId, state) => new Promise((resolve, reject) => {
        const open = indexedDB.open('rpg-client-saves');
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
            const db = open.result;
            const tx = db.transaction('savePayloads', 'readwrite');
            tx.objectStore('savePayloads').put({ slotId, state });
            tx.oncomplete = () => { db.close(); resolve(); };
            tx.onabort = () => { db.close(); reject(tx.error); };
        };
    });

    it('round-trips chapters while the stored payload carries refs (and the chapter\'s metadata), not prose', async () => {
        const state = withChapters(['A', 'B']);
        await saveGame('slot-c', state);

        const [payload] = await readStore('savePayloads');
        const stored = JSON.stringify(payload);
        expect(stored).not.toContain(chapterText('A').slice(0, 200));
        expect(payload.state.chronicle[0].chapterRef).toMatch(/^c-/);
        expect(payload.state.chronicle[0]).toEqual({ id: 'chapter-A', title: 'Chapter A', fromIndex: 0, toIndex: 9, createdAt: 1000, chapterRef: payload.state.chronicle[0].chapterRef });
        expect(await readStore('chronicleChapters', 'keys')).toHaveLength(2);
        const [metadata] = await readStore('saves');
        expect(metadata.chapterRefs).toEqual(payload.state.chronicle.map(c => c.chapterRef));

        const loaded = await loadGame('slot-c');
        expect(loaded.chronicle).toEqual(state.chronicle);
        // A ref never reaches live state.
        expect(JSON.stringify(loaded)).not.toContain('chapterRef');
    });

    it('a steady-state autosave moves zero chapter/portrait bytes and makes ZERO getKey probes (2026-09-23 P2 minor)', async () => {
        const state = withChapters(['A', 'B'], {
            character: { ...makeGameState().character, portraitUrl: portrait('H') },
            npcs: [{ id: 'npc-1', name: 'One', portraitUrl: portrait('1') }, { id: 'npc-2', name: 'Two', portraitUrl: portrait('2') }],
        });
        await saveGame('__autosave__', state);
        const getKeySpy = vi.spyOn(IDBObjectStore.prototype, 'getKey');
        const putSpy = vi.spyOn(IDBObjectStore.prototype, 'put');
        try {
            // The turn's ordinary change: nothing immutable moved.
            await saveGame('__autosave__', { ...state, currentLocation: 'Elsewhere' });
            expect(getKeySpy).not.toHaveBeenCalled();
            expect(putSpy.mock.calls.map(([value]) => typeof value)).toEqual(['object', 'object']); // metadata + payload

            // One new chapter: exactly one probe, one blob put, nothing else re-probed.
            getKeySpy.mockClear();
            putSpy.mockClear();
            await saveGame('__autosave__', { ...state, chronicle: [...state.chronicle, chapter('C', 2)] });
            expect(getKeySpy).toHaveBeenCalledTimes(1);
            expect(getKeySpy.mock.calls[0][0]).toMatch(/^c-/);
            expect(putSpy.mock.calls.filter(([value]) => typeof value === 'string')).toHaveLength(1);
        } finally {
            getKeySpy.mockRestore();
            putSpy.mockRestore();
        }
        expect(await readStore('chronicleChapters', 'keys')).toHaveLength(3);
        expect((await loadAutoSave()).chronicle.map(c => c.id)).toEqual(['chapter-A', 'chapter-B', 'chapter-C']);
    });

    it('a removed newest chapter is swept, but never one another slot still holds', async () => {
        await saveGame('manual', withChapters(['A', 'B']));
        await saveGame('auto', withChapters(['A', 'B']));
        // REMOVE_CHRONICLE_CHAPTER in the live campaign: the autosave drops B.
        await saveGame('auto', withChapters(['A']));
        expect(await readStore('chronicleChapters', 'keys')).toHaveLength(2); // A, B (manual)
        expect((await loadGame('manual')).chronicle.map(c => c.id)).toEqual(['chapter-A', 'chapter-B']);

        await deleteSave('manual');
        expect(await readStore('chronicleChapters', 'keys')).toHaveLength(1); // A
        expect((await loadGame('auto')).chronicle.map(c => c.id)).toEqual(['chapter-A']);

        await deleteSave('auto');
        expect(await readStore('chronicleChapters', 'keys')).toHaveLength(0);
    });

    it('a pre-split payload with inline chapters loads as-is, and a dangling chapter ref is a dropped chapter', async () => {
        await saveGame('slot-seed', makeGameState());
        await putPayload('inline', { character: { name: 'Old' }, npcs: [], chronicle: [chapter('Z', 0)] });
        await putPayload('dangling', {
            character: { name: 'Lost' },
            npcs: [],
            chronicle: [chapter('Y', 0), { id: 'chapter-gone', title: 'Gone', fromIndex: 10, toIndex: 19, createdAt: 2, chapterRef: 'c-gone' }],
        });
        expect((await loadGame('inline')).chronicle).toEqual([chapter('Z', 0)]);
        // The prose IS the chapter: the newest one's span re-opens for a fresh close.
        expect((await loadGame('dangling')).chronicle).toEqual([chapter('Y', 0)]);
    });

    it('payload composition: a mature payload carries zero portrait bytes and zero chapter bytes — the immutable share leaves the record', async () => {
        const big = (seed) => `data:image/jpeg;base64,${String(seed % 10).repeat(30_000)}${seed}`;
        const state = makeGameState({
            chronicle: Array.from({ length: 8 }, (_, i) => chapter(`M${i}`, i)),
            npcs: Array.from({ length: 40 }, (_, i) => ({ id: `npc-${i}`, name: `NPC ${i}`, portraitUrl: big(i) })),
        });
        const fullBytes = JSON.stringify(serializeGameState(state)).length;
        const chapterBytes = state.chronicle.reduce((n, c) => n + c.text.length, 0);
        const portraitBytes = state.npcs.reduce((n, npc) => n + npc.portraitUrl.length, 0);
        await saveGame('slot-mature', state);
        const [payload] = await readStore('savePayloads');
        const stored = JSON.stringify(payload);
        // 8 × 50k of prose + 40 × 30k of pictures; the record that changes every turn carries none of it.
        // (the refs that replace them are ~45 bytes a record)
        expect(fullBytes - stored.length).toBeGreaterThanOrEqual((chapterBytes + portraitBytes) * 0.99);
        expect(stored.length).toBeLessThan(25_000);
        expect(stored).not.toContain('data:image/');
        expect(stored).not.toContain('retold.');
        const loaded = await loadGame('slot-mature');
        expect(loaded.chronicle[7].text).toBe(chapterText('M7'));
        expect(loaded.npcs[39].portraitUrl).toBe(big(39));
    });

    it('the cloud path (serializeGameState) keeps chapters inline — only the local store splits them', () => {
        const state = withChapters(['A']);
        const serialized = serializeGameState(state);
        expect(serialized.chronicle[0].text).toBe(chapterText('A'));
        expect(serialized.chronicle[0]).not.toHaveProperty('chapterRef');
    });
});
