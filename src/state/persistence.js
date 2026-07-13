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
        return true;
    } catch (e) {
        // Quota exceeded / private browsing / disabled storage. Settings carries the
        // player's LLM API key — callers must surface this, or the player believes
        // they configured a key that never actually persisted.
        console.warn('Failed to save settings:', e);
        return false;
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

/** How long a blocked open may stall before we fail loudly instead of hanging forever. */
const OPEN_BLOCKED_TIMEOUT_MS = 8000;

function openDB() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION);
        // A DB_VERSION bump while another tab holds an older connection fires
        // `blocked` instead of resolving — without this, every save/load (autosave
        // included) awaits forever with no error to surface. Fail loudly instead.
        let blockedTimer = null;
        const clearBlocked = () => { if (blockedTimer) { clearTimeout(blockedTimer); blockedTimer = null; } };
        request.onblocked = () => {
            console.error('[Persistence] IndexedDB open is blocked by another tab holding an older connection. Close other Quest Forge tabs.');
            if (!blockedTimer) {
                blockedTimer = setTimeout(() => {
                    reject(new Error('Save storage is blocked by another open tab. Close other Quest Forge tabs and try again.'));
                }, OPEN_BLOCKED_TIMEOUT_MS);
            }
        };
        request.onerror = () => { clearBlocked(); reject(request.error); };
        request.onsuccess = () => { clearBlocked(); resolve(request.result); };
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
 * Save-format version stamped into every persisted state payload. Bump it when
 * the shape changes in a way loaders must branch on; `validateSaveState` keeps
 * normalizing defensively either way.
 */
export const SAVE_VERSION = 2;

/**
 * Build the persistable snapshot of the game state. Shared by BOTH save paths
 * (local IndexedDB here, cloud Firestore in cloudSync.js).
 *
 * This is deliberately spread-plus-strip, NOT a field whitelist: every new
 * top-level state field must persist by default. A whitelist here is how
 * `fronts` and `pendingRoleplayCheck` silently vanished from local saves —
 * the hidden-fronts system was dead in every reloaded campaign until 2026-07-03.
 * Excluded on purpose:
 *  - `user`: live auth session, never restored from a save (LOAD_GAME keeps the live one)
 *  - `ui`: transient panel/modal state
 *  - secrets in `settings`: API keys / Firebase config persist separately via saveSettings()
 */
export function serializeGameState(gameState) {
    const { user: _user, ui: _ui, ...persisted } = gameState;
    return {
        ...persisted,
        saveVersion: SAVE_VERSION,
        rollHistory: (gameState.rollHistory || []).slice(-MAX_SAVED_ROLLS),
        combat: gameState.combat || { active: false, enemies: [], turnOrder: [], currentTurn: 0, round: 1 },
        settings: { ...gameState.settings, apiKey: undefined, geminiApiKey: undefined, imageApiKey: undefined, firebaseConfig: undefined },
    };
}

/** Shared slot-list metadata for a save (local and cloud add their own savedAt/slot fields). */
export function buildSaveMetadata(gameState) {
    return {
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
    };
}

/**
 * Save game state to a named slot.
 * Keeps the FULL message history (IndexedDB has no practical size cap) and caps rollHistory.
 */
export async function saveGame(slotId, gameState) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readwrite');
        const store = tx.objectStore(STORE_NAME);

        const savedMessages = gameState.messages || [];
        // prunedMessageCount indexes into the array we actually persist. Summarized messages
        // are always a contiguous prefix, so their count IS the boundary index.
        const prunedMessageCount = savedMessages.filter(m => m.summarized).length;

        const saveData = {
            slotId,
            ...buildSaveMetadata(gameState),
            savedAt: Date.now(),
            messageCount: savedMessages.length,
            state: {
                ...serializeGameState(gameState),
                session: { ...gameState.session, prunedMessageCount },
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
        // Close on abort too — a read error otherwise leaks the connection open,
        // and leaked connections are what make a future versioned open hang blocked.
        tx.onabort = () => { db.close(); reject(tx.error || request.error); };
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
        tx.onabort = () => { db.close(); reject(tx.error || request.error); };
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
        tx.onabort = () => { db.close(); reject(tx.error || request.error); };
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
 * Auto-save (uses a reserved slot). Returns whether the save actually landed —
 * callers surface failures to the player instead of showing a false success toast.
 */
export async function autoSave(gameState) {
    try {
        await saveGame(AUTOSAVE_SLOT, gameState);
        return true;
    } catch (e) {
        console.warn('Auto-save failed:', e);
        return false;
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
