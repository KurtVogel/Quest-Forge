/**
 * Persistence layer using LocalStorage (settings) and IndexedDB (game saves).
 */

const SETTINGS_KEY = 'rpg-client-settings';
const DB_NAME = 'rpg-client-saves';
const DB_VERSION = 1;
const STORE_NAME = 'saves';
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
        };
    });
}

/**
 * Save game state to a named slot.
 */
export async function saveGame(slotId, gameState) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readwrite');
        const store = tx.objectStore(STORE_NAME);

        const saveData = {
            slotId,
            name: gameState.session?.name || 'Unnamed Save',
            characterName: gameState.character?.name || 'Unknown',
            characterLevel: gameState.character?.level || 1,
            characterClass: gameState.character?.class || 'Unknown',
            savedAt: Date.now(),
            messageCount: gameState.messages?.length || 0,
            // Store the full state minus UI and transient data
            state: {
                character: gameState.character,
                inventory: gameState.inventory,
                messages: gameState.messages,
                rollHistory: gameState.rollHistory,
                quests: gameState.quests,
                journal: gameState.journal || [],
                npcs: gameState.npcs || [],
                currentLocation: gameState.currentLocation || null,
                combat: gameState.combat || { active: false, enemies: [], turnOrder: [], currentTurn: 0, round: 1 },
                session: gameState.session,
                settings: gameState.settings,
            },
        };

        const request = store.put(saveData);
        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
        tx.oncomplete = () => db.close();
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
        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
        tx.oncomplete = () => db.close();
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
