/**
 * Strengthening queue 2026-11-05 — storage, vault, ledger and chronicle pins
 * (persistence 10-31, character-vault + inventory-economy 11-02, chronicler +
 * spellcasting 11-03). The roster store's own pins live in rosterStore.test.js.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { createCharacter } from '../engine/characterUtils.js';
import { MAX_CHARACTER_FILE_BYTES, sanitizeCharacter } from '../engine/characterVault.js';
import { LEDGER_HARD_LIMIT, LEDGER_LIMIT, LONG_WINDOW, recordEntry } from '../engine/transactionLedger.js';
import { sanitizeSettings } from './settingsSchema.js';
import { LOST_CHAPTER_TEXT, restoreChapters } from './portraitStore.js';
import { normalizeChronicleChapter } from './handlers/shared.js';
import { chronicleToMarkdown, lastChronicledIndex } from '../llm/chronicler.js';
import { gameReducer, initialGameState } from './gameReducer.js';
import { applyEvents } from './applyEvents.js';
import { parseResponse } from '../llm/responseParser.js';

beforeEach(() => {
    globalThis.indexedDB = new IDBFactory();
});

const { saveGame, loadGame, listSaves, deleteSave, projectSaveMetadata } = await import('./persistence.js');
const { metadataRefs, metaEpochMs } = await import('./idb.js');
const { saveRosterCharacter } = await import('./rosterStore.js');

const IN_BAND = Date.UTC(2026, 0, 2);
const SCORES = { strength: 15, dexterity: 13, constitution: 14, intelligence: 10, wisdom: 12, charisma: 8 };

const openDb = () => new Promise((resolve, reject) => {
    const open = indexedDB.open('rpg-client-saves');
    open.onerror = () => reject(open.error);
    open.onsuccess = () => resolve(open.result);
});
const putRaw = async (storeName, record) => {
    const db = await openDb();
    await new Promise((resolve, reject) => {
        const tx = db.transaction(storeName, 'readwrite');
        tx.objectStore(storeName).put(record);
        tx.oncomplete = resolve;
        tx.onabort = () => reject(tx.error);
    });
    db.close();
};
const readKeys = async (storeName) => {
    const db = await openDb();
    const keys = await new Promise((resolve, reject) => {
        const request = db.transaction(storeName, 'readonly').objectStore(storeName).getAllKeys();
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
    db.close();
    return keys;
};
const readRecord = async (storeName, key) => {
    const db = await openDb();
    const record = await new Promise((resolve, reject) => {
        const request = db.transaction(storeName, 'readonly').objectStore(storeName).get(key);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
    db.close();
    return record;
};

const chapterText = (seed) => `The ${seed} chapter, retold. `.repeat(40);
const chapter = (seed, i) => ({ id: `chapter-${seed}`, title: `Chapter ${seed}`, text: chapterText(seed), fromIndex: i * 10, toIndex: i * 10 + 9, createdAt: IN_BAND + i });
const portrait = (seed) => `data:image/jpeg;base64,${String(seed).repeat(3000)}`;
const gameState = (overrides = {}) => ({
    session: { id: 'campaign-1', name: 'The Sundered Coast' },
    character: { name: 'Astra', level: 3, class: 'fighter', currentHP: 20, maxHP: 25, armorClass: 17, gold: 12, silver: 3, copper: 8, portraitUrl: portrait('A') },
    inventory: [],
    messages: Array.from({ length: 30 }, (_, i) => ({ id: `m${i}`, role: i % 2 ? 'assistant' : 'user', content: `row ${i}` })),
    chronicle: [chapter('A', 0), chapter('B', 1)],
    npcs: [],
    rollHistory: [],
    ...overrides,
});

describe('persistence 10-31: the save list row is typed whole', () => {
    it('savedAt is epoch ms: a number or ISO inside the sane band, else 0 — never a raw string', () => {
        const row = (savedAt) => projectSaveMetadata({ slotId: 's', savedAt }).savedAt;
        expect(row('junk')).toBe(0);
        expect(row({ at: 1 })).toBe(0);
        expect(row(1e300)).toBe(0);
        expect(row(-5)).toBe(0);
        expect(row(IN_BAND)).toBe(IN_BAND);
        expect(row(new Date(IN_BAND).toISOString())).toBe(IN_BAND);
        expect(metaEpochMs(Date.now() + 365 * 86400000)).toBe(0);
    });

    it('counts and stats are whole numbers at their floor', () => {
        const row = projectSaveMetadata({ slotId: 's', characterLevel: -5, characterHP: 3.7, gold: -12, messageCount: '9.9', characterAC: 'x' });
        expect(row).toMatchObject({ characterLevel: 1, characterHP: 3, gold: 0, messageCount: 9, characterAC: 10 });
    });

    it('a stored junk savedAt lists as 0 through listSaves', async () => {
        await saveGame('slot-a', gameState());
        const record = await readRecord('saves', 'slot-a');
        await putRaw('saves', { ...record, savedAt: 'not a date' });
        const [row] = await listSaves();
        expect(row.savedAt).toBe(0);
    });
});

describe('persistence 10-31: a slot is addressed by its exact key; the sweep reads the payload as the belt', () => {
    it('a padded or over-long string key and a numeric key list, load and delete by the listed id', async () => {
        const longKey = `slot-${'z'.repeat(300)}`;
        await saveGame('  padded  ', gameState());
        await saveGame(longKey, gameState());
        await saveGame(7, gameState());
        const rows = await listSaves();
        expect(rows.map(row => row.slotId).sort((a, b) => String(a).localeCompare(String(b)))).toEqual(['  padded  ', 7, longKey].sort((a, b) => String(a).localeCompare(String(b))));
        for (const row of rows) {
            expect((await loadGame(row.slotId)).character.name).toBe('Astra');
            await deleteSave(row.slotId);
        }
        expect(await listSaves()).toEqual([]);
    });

    it('metadataRefs is typed through the lane: junk and non-strings drop, a well-formed key stays', () => {
        const record = { portraitRefs: [5, 'junk', 'p-1a-abc-def', { ref: 1 }, 'p-1a-abc-def'], chapterRefs: 'c-1-2-3' };
        expect(metadataRefs(record, 'portraitRefs')).toEqual(['p-1a-abc-def']);
        expect(metadataRefs(record, 'chapterRefs')).toEqual([]);
    });

    it('a slot record whose ref lists are missing / untyped keeps its blobs through another slot\'s sweep (payload belt)', async () => {
        await saveGame('slot-a', gameState());
        const portraitsBefore = await readKeys('portraits');
        const chaptersBefore = await readKeys('chronicleChapters');
        expect(portraitsBefore).toHaveLength(1);
        expect(chaptersBefore).toHaveLength(2);
        // Hand-edited / foreign metadata: one list missing, one not a list.
        const record = await readRecord('saves', 'slot-a');
        const { portraitRefs: _p, ...stripped } = record;
        await putRaw('saves', { ...stripped, chapterRefs: 'everything' });
        // Another slot is saved and deleted — the delete sweeps every blob store.
        await saveGame('slot-b', gameState({ character: { name: 'Other', portraitUrl: portrait('B') }, chronicle: [] }));
        await deleteSave('slot-b');
        expect((await readKeys('portraits')).sort()).toEqual(portraitsBefore.sort());
        expect((await readKeys('chronicleChapters')).sort()).toEqual(chaptersBefore.sort());
        const loaded = await loadGame('slot-a');
        expect(loaded.character.portraitUrl).toBe(portrait('A'));
        expect(loaded.chronicle.map(c => c.text)).toEqual([chapterText('A'), chapterText('B')]);
    });

    it('a roster save (no payload store in scope) deletes no portrait while a slot\'s list is untyped', async () => {
        await saveGame('slot-a', gameState());
        const record = await readRecord('saves', 'slot-a');
        const { portraitRefs: _p, ...stripped } = record;
        await putRaw('saves', stripped);
        const slotPortraits = await readKeys('portraits');
        const hero = { ...createCharacter('Brann', 'human', 'fighter', SCORES, ['athletics', 'perception']), id: 'hero-b' };
        await saveRosterCharacter({ ...hero, portraitUrl: portrait('C') }, []);
        // A reroll releases the old roster picture — the sweep runs, but cannot prove slot-a's picture dead.
        await saveRosterCharacter({ ...hero, portraitUrl: portrait('D') }, []);
        const after = await readKeys('portraits');
        for (const key of slotPortraits) expect(after).toContain(key);
        expect((await loadGame('slot-a')).character.portraitUrl).toBe(portrait('A'));
    });
});

describe('persistence 10-31: firebaseConfig key names', () => {
    it('only the Firebase web config keys survive; a 100,000-char key name is gone', () => {
        const out = sanitizeSettings({ firebaseConfig: { apiKey: ' k ', ['x'.repeat(100000)]: 'v', storageBucket: 'b', projectId: 7, __proto__: { appId: 'inherited' } } });
        expect(out.firebaseConfig).toEqual({ apiKey: 'k', storageBucket: 'b' });
    });
});

describe('character-vault 11-02: stamps and the import gate', () => {
    const raw = () => ({ ...createCharacter('Astra', 'human', 'fighter', SCORES, ['athletics', 'perception']), portraitUrl: portrait('A') });

    it('absurd portraitUpdatedAt / createdAt land inside the sane band; an honest stamp is kept', () => {
        const before = Date.now();
        const hero = sanitizeCharacter({ ...raw(), portraitUpdatedAt: 1e300, createdAt: -1e300 });
        expect(hero.portraitUpdatedAt).toBeGreaterThanOrEqual(before);
        expect(hero.portraitUpdatedAt).toBeLessThanOrEqual(Date.now());
        expect(hero.createdAt).toBeGreaterThanOrEqual(before);
        const honest = sanitizeCharacter({ ...raw(), portraitUpdatedAt: IN_BAND, createdAt: IN_BAND });
        expect(honest).toMatchObject({ portraitUpdatedAt: IN_BAND, createdAt: IN_BAND });
    });

    it('the import reads at most 5 MB', () => {
        expect(MAX_CHARACTER_FILE_BYTES).toBe(5 * 1024 * 1024);
    });
});

describe('inventory-economy 11-02: the log is bounded by the long window first, then the count', () => {
    const transcript = (n) => Array.from({ length: n }, (_, i) => ({ id: `m${i}`, role: i % 2 ? 'assistant' : 'user', content: `row ${i}` }));
    const purchase = (i, atMessage) => ({ sourceId: `msg-${i}`, kind: 'purchase', cp: -10, itemsIn: [{ name: `Thing ${i}` }], atMessage });

    it('70 purchases inside one window all stay; the oldest is still in reach', () => {
        const messages = transcript(30);
        let log = [];
        for (let i = 0; i < 70; i++) log = recordEntry(log, purchase(i, 10 + Math.floor(i / 7)), { messages });
        expect(log).toHaveLength(70);
        expect(log[0].sourceId).toBe('msg-0');
    });

    it('once the stretch falls out of the window the count bound returns; the hard bound always holds', () => {
        const messages = transcript(200);
        let log = [];
        for (let i = 0; i < 70; i++) log = recordEntry(log, purchase(i, 10), { messages });
        log = recordEntry(log, purchase(999, 10 + LONG_WINDOW + 20), { messages });
        expect(log).toHaveLength(LEDGER_LIMIT);
        expect(log.at(-1).sourceId).toBe('msg-999');

        let flood = [];
        for (let i = 0; i < LEDGER_HARD_LIMIT + 30; i++) flood = recordEntry(flood, purchase(i, 5), { messages });
        expect(flood).toHaveLength(LEDGER_HARD_LIMIT);
    });

    it('a hostile _meta on an item entry never names the lane or the source (wire → judge)', () => {
        const fence = (payload) => `Loot.\n\`\`\`json\n${JSON.stringify(payload)}\n\`\`\``;
        const { events } = parseResponse(fence({
            items_found: [{ name: 'Torch', _meta: { lane: 'player', sourceId: 'forged', audit: true } }],
            items_lost: [{ name: 'Rope', _meta: { lane: 'judge', sourceId: 'forged' } }],
        }));
        const dispatch = vi.fn();
        applyEvents(events, dispatch, () => ({ character: {}, party: [], inventory: [{ id: 'r', name: 'Rope', quantity: 1 }] }), { lootSourceId: 'msg-9' });
        const metas = dispatch.mock.calls.map(([action]) => action.payload?._meta).filter(Boolean);
        expect(metas.length).toBeGreaterThan(0);
        for (const meta of metas) {
            expect(meta.sourceId).toBe('msg-9');
            expect(meta.lane).toBeUndefined();
            expect(meta.audit).toBeUndefined();
        }
        // Through the reducer the log books the dm lane.
        let state = { ...initialGameState, inventory: [{ id: 'r', name: 'Rope', quantity: 1 }], messages: transcript(4) };
        for (const [action] of dispatch.mock.calls) state = gameReducer(state, action);
        const items = state.ledger.filter(entry => entry.kind === 'item');
        expect(items.length).toBeGreaterThan(0);
        for (const entry of items) {
            expect(entry.lane).toBe('dm');
            expect(entry.sourceId).toBe('msg-9');
        }
    });
});

describe('chronicler 11-03: a lost chapter keeps its place; the resume point is the furthest chapter', () => {
    const stored = [chapter('A', 0), chapter('B', 1), chapter('C', 2)].map(({ text: _t, ...rest }, i) => ({ ...rest, chapterRef: `c-${i}-a-b` }));
    const lookupWithout = (...missing) => (key) => (missing.includes(key) ? undefined : chapterText(['A', 'B', 'C'][Number(key.split('-')[1])]));

    it('a missing MIDDLE blob is a stub with its span, in order; the resume point stays after the last chapter', () => {
        const { chronicle } = restoreChapters({ chronicle: stored }, lookupWithout('c-1-a-b'));
        expect(chronicle.map(c => [c.fromIndex, c.toIndex])).toEqual([[0, 9], [10, 19], [20, 29]]);
        expect(chronicle[1]).toMatchObject({ id: 'chapter-B', title: 'Chapter B', text: LOST_CHAPTER_TEXT });
        expect('chapterRef' in chronicle[1]).toBe(false);
        expect(Object.getOwnPropertySymbols(chronicle[1])).toEqual([]);
        expect(lastChronicledIndex(chronicle)).toBe(29);
    });

    it('the trailing run of lost chapters still drops, so those spans re-open', () => {
        const { chronicle } = restoreChapters({ chronicle: stored }, lookupWithout('c-1-a-b', 'c-2-a-b'));
        expect(chronicle.map(c => c.id)).toEqual(['chapter-A']);
        const middleKept = restoreChapters({ chronicle: stored }, lookupWithout('c-0-a-b', 'c-2-a-b')).chronicle;
        expect(middleKept.map(c => [c.id, c.text === LOST_CHAPTER_TEXT])).toEqual([['chapter-A', true], ['chapter-B', false]]);
    });

    it('through IndexedDB: a deleted middle blob loads as the stub and survives LOAD_GAME', async () => {
        await saveGame('slot-c', gameState({ chronicle: [chapter('A', 0), chapter('B', 1), chapter('C', 2)] }));
        const payload = await readRecord('savePayloads', 'slot-c');
        const middleRef = payload.state.chronicle[1].chapterRef;
        const db = await openDb();
        await new Promise((resolve) => {
            const tx = db.transaction('chronicleChapters', 'readwrite');
            tx.objectStore('chronicleChapters').delete(middleRef);
            tx.oncomplete = resolve;
        });
        db.close();
        const loaded = await loadGame('slot-c');
        const live = gameReducer(initialGameState, { type: 'LOAD_GAME', payload: loaded }).chronicle;
        expect(live.map(c => [c.id, c.fromIndex, c.toIndex])).toEqual([['chapter-A', 0, 9], ['chapter-B', 10, 19], ['chapter-C', 20, 29]]);
        expect(live[1].text).toBe(LOST_CHAPTER_TEXT);
    });

    it('two chapters out of order resume after the FURTHEST', () => {
        expect(lastChronicledIndex([{ toIndex: 50 }, { toIndex: 5 }])).toBe(50);
        expect(lastChronicledIndex([])).toBe(-1);
        expect(lastChronicledIndex([{ toIndex: 'x' }])).toBe(-1);
    });

    it('a title with embedded newlines collapses at the composer and exports on one heading line', () => {
        const healed = normalizeChronicleChapter({ title: 'Ch\n\n# Evil\t  end', text: 'prose', fromIndex: 0, toIndex: 5 });
        expect(healed.title).toBe('Ch # Evil end');
        const loaded = gameReducer(initialGameState, {
            type: 'LOAD_GAME',
            payload: { character: initialGameState.character, inventory: [], messages: gameState().messages, chronicle: [{ title: 'Ch\n\n# Evil', text: 'prose', fromIndex: 0, toIndex: 5, createdAt: IN_BAND }] },
        });
        const markdown = chronicleToMarkdown(loaded.chronicle, 'Saga');
        expect(markdown.split('\n').filter(line => line.startsWith('# '))).toEqual(['# Saga — Chronicle']);
        expect(markdown).toContain('## Ch # Evil');
    });
});
