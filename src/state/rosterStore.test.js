/**
 * The hero roster store end to end on fake-indexeddb (2026-11-05 strengthening
 * P2, character-vault 11-02): the hero id is the roster's KEY, so it is bounded
 * at its three boundaries — the load heal, the vault template and the roster
 * write — and a row is listed by its EXACT key, so save → list → load → delete
 * by the LIST row's id always reaches the stored row. A 5,000-char id used to
 * list as 200 chars: `loadRosterCharacter(listId)` null, `deleteRosterCharacter`
 * a no-op — a permanent undeletable row.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { createCharacter, HERO_ID_MAX, isSaneHeroId } from '../engine/characterUtils.js';
import { toHeroTemplate } from '../engine/characterVault.js';
import { gameReducer, initialGameState } from './gameReducer.js';

beforeEach(() => {
    globalThis.indexedDB = new IDBFactory();
});

const { saveRosterCharacter, listRosterCharacters, loadRosterCharacter, deleteRosterCharacter } = await import('./rosterStore.js');

const SCORES = { strength: 15, dexterity: 13, constitution: 14, intelligence: 10, wisdom: 12, charisma: 8 };
const hero = (overrides = {}) => ({ ...createCharacter('Astra', 'human', 'fighter', SCORES, ['athletics', 'perception']), ...overrides });

const putRaw = (record) => new Promise((resolve, reject) => {
    // Open through the store module first so the schema exists.
    listRosterCharacters().then(() => {
        const open = indexedDB.open('rpg-client-saves');
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
            const db = open.result;
            const tx = db.transaction('characters', 'readwrite');
            tx.objectStore('characters').put(record);
            tx.oncomplete = () => { db.close(); resolve(); };
            tx.onabort = () => { db.close(); reject(tx.error); };
        };
    }, reject);
});

describe('save → list → load → delete by the LIST row\'s id', () => {
    it('a minted hero round-trips and deletes', async () => {
        const saved = await saveRosterCharacter(hero({ id: undefined }), []);
        expect(isSaneHeroId(saved.id)).toBe(true);
        const [row] = await listRosterCharacters();
        expect(row.id).toBe(saved.id);
        expect((await loadRosterCharacter(row.id)).character.name).toBe('Astra');
        await deleteRosterCharacter(row.id);
        expect(await listRosterCharacters()).toEqual([]);
    });

    it('a stored row with an over-long or space-padded key lists by its EXACT key, so it loads and deletes', async () => {
        const longId = 'x'.repeat(5000);
        const template = toHeroTemplate(hero(), []);
        await putRaw({ id: longId, name: 'Long', race: 'human', class: 'fighter', level: 1, savedAt: 1, character: template.character, inventory: [] });
        await putRaw({ id: '  padded  ', name: 'Padded', race: 'human', class: 'fighter', level: 1, savedAt: 2, character: template.character, inventory: [] });
        const rows = await listRosterCharacters();
        expect(rows.map(row => row.id).sort()).toEqual(['  padded  ', longId].sort());
        for (const row of rows) {
            expect(await loadRosterCharacter(row.id)).not.toBeNull();
            await deleteRosterCharacter(row.id);
        }
        expect(await listRosterCharacters()).toEqual([]);
    });

    it('a numeric key is addressable too', async () => {
        const template = toHeroTemplate(hero(), []);
        await putRaw({ id: 42, name: 'Numbered', race: 'human', class: 'fighter', level: 1, character: template.character, inventory: [] });
        const [row] = await listRosterCharacters();
        expect(row.id).toBe(42);
        expect((await loadRosterCharacter(row.id)).name).toBe('Numbered');
        await deleteRosterCharacter(row.id);
        expect(await listRosterCharacters()).toEqual([]);
    });
});

describe('the hero id is bounded at its three boundaries', () => {
    const bad = ['x'.repeat(HERO_ID_MAX + 1), 'hero <script>', 'a b', '', 42, { id: 1 }];

    it('the template mints a fresh id for an over-long / odd-charset / non-string id and keeps a sane one', () => {
        for (const id of bad) {
            const minted = toHeroTemplate(hero({ id }), []).character.id;
            expect(minted).not.toBe(id);
            expect(isSaneHeroId(minted)).toBe(true);
        }
        expect(toHeroTemplate(hero({ id: 'char-1767225600000-abcde' }), []).character.id).toBe('char-1767225600000-abcde');
        // A UUID-shaped id from an older build passes.
        expect(toHeroTemplate(hero({ id: '3f2b8c1e-0d4a-4c6e-9a7b-1c2d3e4f5a6b' }), []).character.id).toBe('3f2b8c1e-0d4a-4c6e-9a7b-1c2d3e4f5a6b');
    });

    it('the LOAD heal mints a fresh id the same way', () => {
        for (const id of bad) {
            const loaded = gameReducer(initialGameState, { type: 'LOAD_GAME', payload: { character: hero({ id }), inventory: [], messages: [] } });
            expect(loaded.character.id).not.toBe(id);
            expect(isSaneHeroId(loaded.character.id)).toBe(true);
        }
        const kept = gameReducer(initialGameState, { type: 'LOAD_GAME', payload: { character: hero({ id: 'char-7-abc' }), inventory: [], messages: [] } });
        expect(kept.character.id).toBe('char-7-abc');
    });

    it('the roster write stores the bounded id, and the row is reachable by it', async () => {
        const saved = await saveRosterCharacter(hero({ id: 'y'.repeat(5000) }), []);
        expect(saved.id.length).toBeLessThanOrEqual(HERO_ID_MAX);
        const [row] = await listRosterCharacters();
        expect(row.id).toBe(saved.id);
        await deleteRosterCharacter(row.id);
        expect(await listRosterCharacters()).toEqual([]);
    });
});
