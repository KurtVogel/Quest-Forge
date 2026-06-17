/**
 * Persistence layer using LocalStorage (settings) and IndexedDB (game saves).
 */

const SETTINGS_KEY = 'rpg-client-settings';
const DB_NAME = 'rpg-client-saves';
const DB_VERSION = 2;
const STORE_NAME = 'saves';
const ROSTER_STORE = 'characters';
const AUTOSAVE_SLOT = '__autosave__';

// === LocalStorage (Settings) ===

export function saveSettings(settings) {
    try {
        // Don't persist API key in plain localStorage in production,
        // but for a personal local tool this is acceptable
        localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
    } catch (e) {
        console.warn('Failed to save settings:', e);
    }
}

export function loadSettings() {
    try {
        const stored = localStorage.getItem(SETTINGS_KEY);
        return stored ? JSON.parse(stored) : null;
    } catch (e) {
        console.warn('Failed to load settings:', e);
        return null;
    }
}

// === IndexedDB (Game Saves) ===

function openDB() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION);
        request.onerror = () => reject(request.error);
        request.onsuccess = () => resolve(request.result);
        request.onupgradeneeded = (event) => {
            const db = event.target.result;
            if (!db.objectStoreNames.contains(STORE_NAME)) {
                db.createObjectStore(STORE_NAME, { keyPath: 'slotId' });
            }
            if (!db.objectStoreNames.contains(ROSTER_STORE)) {
                db.createObjectStore(ROSTER_STORE, { keyPath: 'id' });
            }
        };
    });
}

/** Max roll history entries to persist. Only last 5 are ever shown in prompt. */
const MAX_SAVED_ROLLS = 50;

/**
 * Save game state to a named slot.
 * Trims summarized messages (captured in journal) and caps rollHistory.
 */
export async function saveGame(slotId, gameState) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readwrite');
        const store = tx.objectStore(STORE_NAME);

        // Local saves keep the FULL message history — IndexedDB has no practical size cap,
        // so readable scrollback survives a reload. Only the cloud path trims summarized
        // messages (to stay under Firestore's ~1MB doc limit) — see cloudSync.js.
        const savedMessages = gameState.messages || [];
        // Cap: keep only the most recent rolls
        const trimmedRolls = (gameState.rollHistory || []).slice(-MAX_SAVED_ROLLS);
        // prunedMessageCount indexes into the array we actually persist. Summarized messages
        // are always a contiguous prefix, so their count IS the boundary index.
        const prunedMessageCount = savedMessages.filter(m => m.summarized).length;

        const saveData = {
            slotId,
            name: gameState.session?.name || 'Unnamed Save',
            characterName: gameState.character?.name || 'Unknown',
            characterLevel: gameState.character?.level || 1,
            characterClass: gameState.character?.class || 'Unknown',
            characterHP: gameState.character?.currentHP || 0,
            characterMaxHP: gameState.character?.maxHP || 0,
            characterAC: gameState.character?.armorClass || 10,
            gold: gameState.character?.gold || 0,
            silver: gameState.character?.silver || 0,
            copper: gameState.character?.copper || 0,
            inventoryCount: gameState.inventory?.length || 0,
            location: gameState.currentLocation || null,
            questCount: gameState.quests?.filter(q => q.status === 'active')?.length || 0,
            partySize: gameState.party?.length || 0,
            savedAt: Date.now(),
            messageCount: savedMessages.length,
            // Store the full state minus UI and transient data
            state: {
                character: gameState.character,
                inventory: gameState.inventory,
                messages: savedMessages,
                rollHistory: trimmedRolls,
                quests: gameState.quests,
                journal: gameState.journal || [],
                npcs: gameState.npcs || [],
                worldFacts: gameState.worldFacts || [],
                storyMemory: gameState.storyMemory || [],
                party: gameState.party || [],
                currentLocation: gameState.currentLocation || null,
                combat: gameState.combat || { active: false, enemies: [], turnOrder: [], currentTurn: 0, round: 1 },
                session: { ...gameState.session, prunedMessageCount },
                // Strip secrets from local saves — keys are persisted separately via saveSettings()
                settings: { ...gameState.settings, apiKey: undefined, imageApiKey: undefined, firebaseConfig: undefined },
            },
        };

        const request = store.put(saveData);
        // Resolve on COMMIT (tx.oncomplete), not on the put's onsuccess. Otherwise a read
        // fired right after (e.g. the saves dialog refreshing itself) can race the
        // not-yet-committed write and miss it — the list looks unchanged, so you click
        // Save again... and again. (See SettingsModal handleSave.)
        request.onerror = () => reject(request.error);
        tx.oncomplete = () => { db.close(); resolve(); };
        tx.onabort = () => { db.close(); reject(tx.error || request.error); };
    });
}

/**
 * Load game state from a slot.
 */
export async function loadGame(slotId) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readonly');
        const store = tx.objectStore(STORE_NAME);
        const request = store.get(slotId);
        request.onsuccess = () => {
            resolve(request.result?.state || null);
        };
        request.onerror = () => reject(request.error);
        tx.oncomplete = () => db.close();
    });
}

/**
 * List all save slots with metadata.
 */
export async function listSaves() {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readonly');
        const store = tx.objectStore(STORE_NAME);
        const request = store.getAll();
        request.onsuccess = () => {
            const saves = request.result
                .filter(s => s.slotId !== AUTOSAVE_SLOT)
                .sort((a, b) => b.savedAt - a.savedAt)
                .map(s => ({
                    slotId: s.slotId,
                    name: s.name,
                    characterName: s.characterName,
                    characterLevel: s.characterLevel,
                    characterClass: s.characterClass,
                    characterHP: s.characterHP,
                    characterMaxHP: s.characterMaxHP,
                    characterAC: s.characterAC,
                    gold: s.gold,
                    silver: s.silver,
                    copper: s.copper,
                    inventoryCount: s.inventoryCount,
                    location: s.location,
                    questCount: s.questCount,
                    partySize: s.partySize,
                    savedAt: s.savedAt,
                    messageCount: s.messageCount,
                }));
            resolve(saves);
        };
        request.onerror = () => reject(request.error);
        tx.oncomplete = () => db.close();
    });
}

/**
 * Delete a save slot.
 */
export async function deleteSave(slotId) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readwrite');
        const store = tx.objectStore(STORE_NAME);
        const request = store.delete(slotId);
        // Resolve on COMMIT (see saveGame) so a refresh read after a delete sees it gone.
        request.onerror = () => reject(request.error);
        tx.oncomplete = () => { db.close(); resolve(); };
        tx.onabort = () => { db.close(); reject(tx.error || request.error); };
    });
}

// === Character roster (heroes, not campaigns — see engine/characterVault.js) ===

/**
 * Save a hero snapshot (character + inventory) to the roster.
 * Keyed by character.id, so re-saving the same hero updates its entry;
 * imports get a fresh id and create a new entry.
 */
export async function saveRosterCharacter(character, inventory) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(ROSTER_STORE, 'readwrite');
        const store = tx.objectStore(ROSTER_STORE);
        const entry = {
            id: character.id || `char-${Date.now()}`,
            name: character.name,
            race: character.race,
            class: character.class,
            level: character.level,
            savedAt: Date.now(),
            character,
            inventory: inventory || [],
        };
        const request = store.put(entry);
        // Resolve on COMMIT (see saveGame) so a list refresh right after sees the entry.
        request.onerror = () => reject(request.error);
        tx.oncomplete = () => { db.close(); resolve(entry); };
        tx.onabort = () => { db.close(); reject(tx.error || request.error); };
    });
}

/**
 * List all roster heroes, newest first. Entries are small (no messages),
 * so this returns them whole — character and inventory included.
 */
export async function listRosterCharacters() {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(ROSTER_STORE, 'readonly');
        const store = tx.objectStore(ROSTER_STORE);
        const request = store.getAll();
        request.onsuccess = () => {
            resolve(request.result.sort((a, b) => b.savedAt - a.savedAt));
        };
        request.onerror = () => reject(request.error);
        tx.oncomplete = () => db.close();
    });
}

/**
 * Delete a roster hero.
 */
export async function deleteRosterCharacter(id) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(ROSTER_STORE, 'readwrite');
        const store = tx.objectStore(ROSTER_STORE);
        const request = store.delete(id);
        request.onerror = () => reject(request.error);
        tx.oncomplete = () => { db.close(); resolve(); };
        tx.onabort = () => { db.close(); reject(tx.error || request.error); };
    });
}

/**
 * Auto-save (uses a reserved slot).
 */
export async function autoSave(gameState) {
    try {
        await saveGame(AUTOSAVE_SLOT, gameState);
    } catch (e) {
        console.warn('Auto-save failed:', e);
    }
}

/**
 * Load auto-save.
 */
export async function loadAutoSave() {
    try {
        return await loadGame(AUTOSAVE_SLOT);
    } catch (e) {
        console.warn('Failed to load auto-save:', e);
        return null;
    }
}
