/**
 * Tests for the persistence layer: localStorage settings + IndexedDB saves/roster.
 * Uses fake-indexeddb (real IndexedDB semantics, in-memory) and a minimal
 * localStorage stub since the vitest environment here is plain Node.
 */
import { describe, expect, it, beforeEach } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';

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
    saveRosterCharacter,
    listRosterCharacters,
    deleteRosterCharacter,
    autoSave,
    loadAutoSave,
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

    it('strips secrets (apiKey, geminiApiKey, imageApiKey, firebaseConfig) from the persisted settings', async () => {
        await saveGame('slot-1', makeGameState());
        const loaded = await loadGame('slot-1');
        expect(loaded.settings.apiKey).toBeUndefined();
        expect(loaded.settings.geminiApiKey).toBeUndefined();
        expect(loaded.settings.imageApiKey).toBeUndefined();
        expect(loaded.settings.firebaseConfig).toBeUndefined();
        expect(loaded.settings.llmProvider).toBe('gemini');
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
        expect(loaded.saveVersion).toBe(2);
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
});

describe('deleteSave', () => {
    it('removes a save so it no longer loads or lists', async () => {
        await saveGame('slot-1', makeGameState());
        await deleteSave('slot-1');
        expect(await loadGame('slot-1')).toBeNull();
        expect(await listSaves()).toEqual([]);
    });
});

describe('character roster', () => {
    function makeHero(overrides = {}) {
        return { id: 'hero-1', name: 'Astra', race: 'human', class: 'fighter', level: 3, ...overrides };
    }

    it('saves and lists a roster hero', async () => {
        await saveRosterCharacter(makeHero(), [{ id: 'i1', name: 'Dagger' }]);
        const roster = await listRosterCharacters();
        expect(roster).toHaveLength(1);
        expect(roster[0].name).toBe('Astra');
        expect(roster[0].inventory).toEqual([{ id: 'i1', name: 'Dagger' }]);
    });

    it('re-saving a hero with the same id updates the existing roster entry', async () => {
        await saveRosterCharacter(makeHero(), []);
        await saveRosterCharacter(makeHero({ level: 5 }), []);
        const roster = await listRosterCharacters();
        expect(roster).toHaveLength(1);
        expect(roster[0].level).toBe(5);
    });

    it('generates an id when the character has none', async () => {
        const entry = await saveRosterCharacter({ name: 'No Id Hero', race: 'elf', class: 'wizard', level: 1 }, []);
        expect(entry.id).toMatch(/^char-/);
    });

    it('deletes a roster hero', async () => {
        await saveRosterCharacter(makeHero(), []);
        await deleteRosterCharacter('hero-1');
        expect(await listRosterCharacters()).toEqual([]);
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
});
