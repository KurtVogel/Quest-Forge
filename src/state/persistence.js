/**
 * Persistence layer using LocalStorage (settings) and IndexedDB (game saves).
 */
import { CURRENT_SAVE_VERSION } from './migrations.js';

const SETTINGS_KEY = 'rpg-client-settings';
const DB_NAME = 'rpg-client-saves';
// v3 (2026-08-04): save payloads split out of the metadata records so listing
// saves never materializes full campaign states (multi-MB on mature campaigns).
const DB_VERSION = 3;
const STORE_NAME = 'saves';
const PAYLOAD_STORE = 'savePayloads';
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
        if (!stored) return null;
        const parsed = JSON.parse(stored);
        // A corrupted value parsing to a string/array would spread junk index keys
        // into settings via GameContext's `{...defaults, ...saved}` merge.
        return (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) ? parsed : null;
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
            if (!db.objectStoreNames.contains(PAYLOAD_STORE)) {
                db.createObjectStore(PAYLOAD_STORE, { keyPath: 'slotId' });
                // v2 → v3: move each save's full state payload out of its
                // metadata record, one-time, inside the versionchange
                // transaction (the open blocks until the cursor finishes).
                const saves = event.target.transaction.objectStore(STORE_NAME);
                const payloads = event.target.transaction.objectStore(PAYLOAD_STORE);
                saves.openCursor().onsuccess = (cursorEvent) => {
                    const cursor = cursorEvent.target.result;
                    if (!cursor) return;
                    const record = cursor.value;
                    if (record?.state) {
                        payloads.put({ slotId: record.slotId, state: record.state });
                        const { state: _state, ...metadata } = record;
                        cursor.update(metadata);
                    }
                    cursor.continue();
                };
            }
        };
    });
}

/** Max roll history entries to persist. Only last 5 are ever shown in prompt. */
const MAX_SAVED_ROLLS = 50;

/**
 * Save-format version stamped into every persisted state payload. Owned by the
 * load-time migration pipeline (state/migrations.js), which version-gates its
 * one-time era migrations on this stamp; `validateSaveState` keeps normalizing
 * defensively either way. Kept under the historical SAVE_VERSION name for
 * existing consumers.
 */
export const SAVE_VERSION = CURRENT_SAVE_VERSION;

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
 *  - `settings`: device-local by design, persisted separately via saveSettings()
 *    (DECISIONS.md 2026-08-27: LOAD_GAME's "live settings win" rule always
 *    overrode the embedded copy, so it was write-only ballast — multi-KB of
 *    customSystemPrompt in every autosave — and is now stripped like user/ui)
 */
export function serializeGameState(gameState) {
    const { user: _user, ui: _ui, settings: _settings, ...persisted } = gameState;
    return {
        ...persisted,
        saveVersion: SAVE_VERSION,
        rollHistory: (gameState.rollHistory || []).slice(-MAX_SAVED_ROLLS),
        combat: gameState.combat || { active: false, enemies: [], turnOrder: [], currentTurn: 0, round: 1 },
    };
}

/** Shared slot-list metadata for a save (local and cloud add their own savedAt/slot fields). */
export function buildSaveMetadata(gameState) {
    return {
        // Campaign identity stamp: lets deletion decide whether any slot still
        // holds a campaign before purging its embedding cache (vectorMemory.js).
        sessionId: gameState.session?.id || null,
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
 * Save game state to a named slot: a metadata-only record in `saves` plus the
 * full state payload in `savePayloads`, committed in ONE transaction (listing
 * must never see a slot whose payload write failed). Keeps the FULL message
 * history (IndexedDB has no practical size cap) and caps rollHistory.
 */
export async function saveGame(slotId, gameState) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction([STORE_NAME, PAYLOAD_STORE], 'readwrite');

        const savedMessages = gameState.messages || [];
        // prunedMessageCount indexes into the array we actually persist. Summarized messages
        // are always a contiguous prefix, so their count IS the boundary index.
        // `m?.` belt: a null entry in live state must not brick every autosave.
        const prunedMessageCount = savedMessages.filter(m => m?.summarized).length;

        const metadataRequest = tx.objectStore(STORE_NAME).put({
            slotId,
            ...buildSaveMetadata(gameState),
            savedAt: Date.now(),
            messageCount: savedMessages.length,
        });
        const payloadRequest = tx.objectStore(PAYLOAD_STORE).put({
            slotId,
            state: {
                ...serializeGameState(gameState),
                session: { ...gameState.session, prunedMessageCount },
            },
        });

        // Resolve on COMMIT (tx.oncomplete), not on the puts' onsuccess. Otherwise a read
        // fired right after (e.g. the saves dialog refreshing itself) can race the
        // not-yet-committed write and miss it — the list looks unchanged, so you click
        // Save again... and again. (See SettingsModal handleSave.)
        metadataRequest.onerror = () => reject(metadataRequest.error);
        payloadRequest.onerror = () => reject(payloadRequest.error);
        tx.oncomplete = () => { db.close(); resolve(); };
        tx.onabort = () => { db.close(); reject(tx.error || metadataRequest.error || payloadRequest.error); };
    });
}

/**
 * Load game state from a slot.
 */
export async function loadGame(slotId) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction([STORE_NAME, PAYLOAD_STORE], 'readonly');
        const request = tx.objectStore(PAYLOAD_STORE).get(slotId);
        request.onsuccess = () => {
            if (request.result?.state) {
                resolve(request.result.state);
                return;
            }
            // Belt: a record whose payload never migrated/landed still loads
            // from the legacy embedded-state metadata record.
            const legacyRequest = tx.objectStore(STORE_NAME).get(slotId);
            legacyRequest.onsuccess = () => resolve(legacyRequest.result?.state || null);
            legacyRequest.onerror = () => reject(legacyRequest.error);
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
                // Strip-`state` destructure instead of re-enumerating every
                // metadata field (a drop-prone duplicate of buildSaveMetadata's
                // list — 2026-08-27 audit). Post-v3 records are metadata-only;
                // `state` only exists on legacy records whose payload never
                // migrated out.
                .map(({ state: _state, ...meta }) => ({
                    ...meta,
                    sessionId: meta.sessionId || null, // absent on legacy saves
                }));
            resolve(saves);
        };
        request.onerror = () => reject(request.error);
        tx.oncomplete = () => db.close();
        tx.onabort = () => { db.close(); reject(tx.error || request.error); };
    });
}

/**
 * Read one slot's campaign identity from its metadata record alone — never
 * materializes the payload. Returns null for legacy saves (no stamp) or a
 * missing slot. Used by the delete flow to check whether the AUTOSAVE slot
 * (excluded from listSaves) still holds a campaign being deleted.
 */
export async function getSaveSessionId(slotId) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readonly');
        const request = tx.objectStore(STORE_NAME).get(slotId);
        request.onsuccess = () => resolve(request.result?.sessionId || null);
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
        const tx = db.transaction([STORE_NAME, PAYLOAD_STORE], 'readwrite');
        const request = tx.objectStore(STORE_NAME).delete(slotId);
        const payloadRequest = tx.objectStore(PAYLOAD_STORE).delete(slotId);
        // Resolve on COMMIT (see saveGame) so a refresh read after a delete sees it gone.
        request.onerror = () => reject(request.error);
        payloadRequest.onerror = () => reject(payloadRequest.error);
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
        // A legacy pre-id-era hero gets an id minted here; the caller must write it
        // back into live state (see CharacterSheet.handleSaveToRoster) or every
        // later "Save to Roster" click mints a fresh id and duplicates the entry.
        const id = character.id || `char-${Date.now()}`;
        const entry = {
            id,
            name: character.name,
            race: character.race,
            class: character.class,
            level: character.level,
            savedAt: Date.now(),
            character: character.id ? character : { ...character, id },
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
