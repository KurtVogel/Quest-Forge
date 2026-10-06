/**
 * Persistence layer: LocalStorage (settings) and IndexedDB (campaign save
 * slots). The database plumbing lives in idb.js and the hero roster in
 * rosterStore.js (split 2026-10-06 — this file was five concerns in 805 lines).
 */
import { CURRENT_SAVE_VERSION } from './migrations.js';
import { sanitizeSettings } from './settingsSchema.js';
import { ROLL_HISTORY_CAP } from '../config/contentLimits.js';
import { BLOB_LANES, collectLaneRefs, extractLanes, restoreLanes } from './portraitStore.js';
import {
    BLOB_SWEEP_STORES,
    PAYLOAD_STORE,
    STORE_NAME,
    ensureLaneBlobs,
    metaNumber,
    metaText,
    metadataRefs,
    readLaneBlobs,
    sweepOrphanBlobs,
    withDb,
} from './idb.js';

const SETTINGS_KEY = 'rpg-client-settings';
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
        // into settings via GameContext's `{...defaults, ...saved}` merge — and
        // since 2026-09-16 the FIELDS are typed too (sanitizeSettings): a
        // numeric API key used to crash the app shell in render.
        return sanitizeSettings(parsed);
    } catch (e) {
        console.warn('Failed to load settings:', e);
        return null;
    }
}

// === The save snapshot ===

/**
 * Build the persistable snapshot of the game state. Shared by BOTH save paths
 * (local IndexedDB here, cloud Firestore in cloudSync.js).
 *
 * This is deliberately spread-plus-strip, NOT a field whitelist: every new
 * top-level state field must persist by default. A whitelist here is how
 * `fronts` and `pendingRoleplayCheck` silently vanished from local saves —
 * the hidden-fronts system was dead in every reloaded campaign until 2026-07-03.
 * Excluded on purpose (`AUTOSAVE_IGNORED_FIELDS` in autosavePolicy.js is the
 * same set, pinned equal by its test):
 *  - `user`: live auth session, never restored from a save (LOAD_GAME keeps the live one)
 *  - `ui`: transient panel/modal state
 *  - `settings`: device-local by design, persisted separately via saveSettings()
 *    (DECISIONS.md 2026-08-27: LOAD_GAME's "live settings win" rule always
 *    overrode the embedded copy, so it was write-only ballast — multi-KB of
 *    customSystemPrompt in every autosave — and is now stripped like user/ui)
 *
 * The save-format version stamped here is owned by the load-time migration
 * pipeline (state/migrations.js), which version-gates its one-time era
 * migrations on it; `validateSaveState` keeps normalizing defensively either way.
 */
export function serializeGameState(gameState) {
    const { user: _user, ui: _ui, settings: _settings, ...persisted } = gameState;
    return {
        ...persisted,
        saveVersion: CURRENT_SAVE_VERSION,
        // Wall-clock stamp on the PAYLOAD (2026-09-16, the return card): the
        // slot metadata already carries one, but the loaded state never did,
        // so LOAD_GAME could not heal a pre-stamp campaign's lastPlayedAt.
        savedAt: Date.now(),
        rollHistory: (gameState.rollHistory || []).slice(-ROLL_HISTORY_CAP),
    };
}

// === Slot metadata: ONE field table for the write and the read ===

/**
 * THE slot metadata fields (2026-10-06 persistence P2): `read` is the typed
 * reader (`metaText` / `metaNumber`), `fallback` what an absent or junk value
 * becomes, `from` where the live state carries it. `buildSaveMetadata` writes
 * the table and `projectSaveMetadata` reads it back, so the two cannot drift
 * (the 08-27 queue fixed exactly that drift once, by hand). Local and cloud
 * add their own `slotId` / `savedAt` / lane ref lists around these.
 */
const SAVE_METADATA_FIELDS = [
    // Campaign identity stamp: lets deletion decide whether any slot still
    // holds a campaign before purging its embedding cache (vectorMemory.js).
    // Absent on legacy saves.
    { field: 'sessionId', read: metaText, fallback: null, from: s => s.session?.id },
    { field: 'name', read: metaText, fallback: 'Unnamed Save', from: s => s.session?.name },
    { field: 'characterName', read: metaText, fallback: 'Unknown', from: s => s.character?.name },
    { field: 'characterLevel', read: metaNumber, fallback: 1, from: s => s.character?.level },
    { field: 'characterClass', read: metaText, fallback: 'Unknown', from: s => s.character?.class },
    { field: 'characterHP', read: metaNumber, fallback: 0, from: s => s.character?.currentHP },
    { field: 'characterMaxHP', read: metaNumber, fallback: 0, from: s => s.character?.maxHP },
    { field: 'characterAC', read: metaNumber, fallback: 10, from: s => s.character?.armorClass },
    { field: 'gold', read: metaNumber, fallback: 0, from: s => s.character?.gold },
    { field: 'silver', read: metaNumber, fallback: 0, from: s => s.character?.silver },
    { field: 'copper', read: metaNumber, fallback: 0, from: s => s.character?.copper },
    { field: 'inventoryCount', read: metaNumber, fallback: 0, from: s => countOf(s.inventory) },
    { field: 'location', read: metaText, fallback: null, from: s => s.currentLocation },
    { field: 'questCount', read: metaNumber, fallback: 0, from: s => countOf(s.quests, q => q?.status === 'active') },
    { field: 'partySize', read: metaNumber, fallback: 0, from: s => countOf(s.party) },
    { field: 'messageCount', read: metaNumber, fallback: 0, from: s => countOf(s.messages) },
];

/** A list's count, or nothing for a non-list (a string has a `.length` too). */
function countOf(list, predicate = () => true) {
    return Array.isArray(list) ? list.filter(predicate).length : undefined;
}

/** Shared slot-list metadata for a save (local and cloud add their own savedAt/slot fields). Typed at the WRITE through the same table the read uses. */
export function buildSaveMetadata(gameState) {
    const state = gameState && typeof gameState === 'object' ? gameState : {};
    return Object.fromEntries(SAVE_METADATA_FIELDS.map(({ field, read, fallback, from }) => [field, read(from(state), fallback)]));
}

/**
 * ONE typed projection for a save-list row, shared by `listSaves` (IndexedDB)
 * and `listCloudSaves` (Firestore) — the start screen and the Settings Saves
 * tab render these fields as React children with no boundary of their own
 * (2026-09-10 audit P1): an object `name`/`location` in a stored record made
 * React throw "Objects are not valid as a React child", so Load Game crashed
 * the root boundary and EVERY save became unreachable from the UI. Text is
 * string-or-fallback, counts are finite numbers, and `slotId` falls back to
 * the record's own key (P2: a cloud doc without the field rendered as a
 * permanent phantom row that could be neither loaded nor deleted).
 */
export function projectSaveMetadata(data, fallbackSlotId = null) {
    const record = data && typeof data === 'object' && !Array.isArray(data) ? data : {};
    const slotId = metaText(record.slotId, null) || (typeof fallbackSlotId === 'string' && fallbackSlotId.trim() ? fallbackSlotId : null);
    const savedAt = typeof record.savedAt === 'number' || typeof record.savedAt === 'string' ? record.savedAt : 0;
    return {
        slotId,
        ...Object.fromEntries(SAVE_METADATA_FIELDS.map(({ field, read, fallback }) => [field, read(record[field], fallback)])),
        savedAt,
    };
}

/**
 * THE save prologue, shared by both storage paths (`saveGame` here,
 * `saveGameToCloud` in cloudSync.js): serialize, move every lane's immutable
 * bytes out of the payload, and assemble the slot's metadata record with each
 * lane's ref list. Each path used to write its own copy (2026-10-04 audit) —
 * and both copies stamped `session.prunedMessageCount`, a field
 * `deriveSessionBoundaries` recomputes from the loaded messages on every load;
 * the dead write is gone with the duplication. `savedAt` is the path's own
 * stamp shape (a number locally, an ISO string in Firestore).
 */
export function prepareSavePayload(slotId, gameState, savedAt) {
    const { state, lanes } = extractLanes(serializeGameState(gameState));
    const metadata = {
        slotId,
        ...buildSaveMetadata(gameState),
        savedAt,
        ...Object.fromEntries(lanes.map(lane => [lane.refsField, lane.refs])),
    };
    return { state, lanes, metadata };
}

// === IndexedDB (campaign save slots) ===

/**
 * Save game state to a named slot: a metadata-only record in `saves` plus the
 * full state payload in `savePayloads`, committed in ONE transaction (listing
 * must never see a slot whose payload write failed). Keeps the FULL message
 * history (IndexedDB has no practical size cap) and caps rollHistory.
 */
export function saveGame(slotId, gameState) {
    return withDb((db, resolve, reject) => {
        // Roster rows are in scope only for the orphan sweep's live-ref read.
        const tx = db.transaction([PAYLOAD_STORE, ...BLOB_SWEEP_STORES], 'readwrite');

        // Portrait bytes ride the `portraits` store and chapter prose the
        // `chronicleChapters` store, not the payload (see portraitStore.js):
        // the payload carries refs, the metadata record lists them so the
        // orphan sweep never opens a payload.
        const { state: slimState, lanes, metadata } = prepareSavePayload(slotId, gameState, Date.now());

        const saves = tx.objectStore(STORE_NAME);
        let metadataRequest = null;
        let payloadRequest = null;

        // The slot's PREVIOUS record is read FIRST (2026-09-23 audit P2, minor):
        // a ref it lists is on disk and live, so only refs it did NOT list are
        // probed (`ensureLaneBlobs`) — a steady-state autosave makes zero
        // `getKey` requests. Its refs also decide whether anything can have
        // been orphaned (a reroll, a removed NPC, a dropped chapter, a
        // different campaign in the slot).
        const previousRequest = saves.get(slotId);
        previousRequest.onerror = () => reject(previousRequest.error);
        previousRequest.onsuccess = () => {
            const previous = previousRequest.result;
            let released = false;
            for (const lane of lanes) {
                const kept = new Set(lane.refs);
                if (metadataRefs(previous, lane.refsField).some(ref => !kept.has(ref))) released = true;
            }
            ensureLaneBlobs(tx, lanes, lane => new Set(metadataRefs(previous, lane.refsField)));

            metadataRequest = saves.put(metadata);
            payloadRequest = tx.objectStore(PAYLOAD_STORE).put({ slotId, state: slimState });
            // Requests settle in order: the new metadata is in place by the
            // time this fires, so the sweep sees this slot's current refs.
            payloadRequest.onsuccess = () => { if (released) sweepOrphanBlobs(tx); };
            metadataRequest.onerror = () => reject(metadataRequest.error);
            payloadRequest.onerror = () => reject(payloadRequest.error);
        };

        // Resolve on COMMIT (tx.oncomplete), not on the puts' onsuccess. Otherwise a read
        // fired right after (e.g. the saves dialog refreshing itself) can race the
        // not-yet-committed write and miss it — the list looks unchanged, so you click
        // Save again... and again. (See SettingsModal handleSave.)
        // withDb closes the connection once this settles, whichever way.
        tx.oncomplete = () => resolve();
        tx.onabort = () => reject(tx.error || metadataRequest?.error || payloadRequest?.error || previousRequest.error);
    });
}

/**
 * Only a plain object is a save. A corrupted payload parsing to a number,
 * string, or array passes callers' truthy checks and reaches LOAD_GAME as a
 * primitive, where validateSaveState's spread mints index keys ("0".."3")
 * into live state with a null character — the app silently shows the start
 * screen again with the slot still listed, and the Upload-local-saves loop
 * ships the same junk to the cloud (2026-07-25 audit for the cloud path;
 * 2026-09-11 persistence P2 for the local one). Shared by both loaders.
 */
export function asSaveObject(parsed) {
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
}

/**
 * Load game state from a slot. Resolves null for a slot whose stored payload
 * is not a plain object — callers surface "could not be loaded".
 */
export function loadGame(slotId) {
    return withDb((db, resolve, reject) => {
        const tx = db.transaction([STORE_NAME, PAYLOAD_STORE, ...BLOB_LANES.map(lane => lane.id)], 'readonly');
        // Refs → inline bytes before the state leaves this module: live state,
        // the cloud upload loop, and LOAD_GAME never see a portraitRef or a
        // chapterRef. A blob that cannot be read is a missing picture / a
        // dropped chapter, never a failed load.
        const hydrate = (stored) => {
            const state = asSaveObject(stored);
            readLaneBlobs(tx, collectLaneRefs(state), lookup => resolve(state ? restoreLanes(state, lookup) : state));
        };
        const request = tx.objectStore(PAYLOAD_STORE).get(slotId);
        request.onsuccess = () => {
            if (request.result?.state) {
                hydrate(request.result.state);
                return;
            }
            // Belt: a record whose payload never migrated/landed still loads
            // from the legacy embedded-state metadata record.
            const legacyRequest = tx.objectStore(STORE_NAME).get(slotId);
            legacyRequest.onsuccess = () => hydrate(legacyRequest.result?.state);
            legacyRequest.onerror = () => reject(legacyRequest.error);
        };
        request.onerror = () => reject(request.error);
        // Reject on abort too — withDb closes the connection on settle either
        // way (leaked connections are what make a future versioned open hang blocked).
        tx.onabort = () => reject(tx.error || request.error);
    });
}

/**
 * List all save slots with metadata.
 */
export function listSaves() {
    return withDb((db, resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readonly');
        const store = tx.objectStore(STORE_NAME);
        const request = store.getAll();
        request.onsuccess = () => {
            // Typed projection (never the raw record — a legacy record still
            // carries its whole `state`, and the renderers trust every field).
            const saves = request.result
                .filter(s => s && typeof s === 'object' && s.slotId !== AUTOSAVE_SLOT)
                .map(record => projectSaveMetadata(record))
                .filter(save => save.slotId)
                .sort((a, b) => metaNumber(b.savedAt, 0) - metaNumber(a.savedAt, 0));
            resolve(saves);
        };
        request.onerror = () => reject(request.error);
        tx.onabort = () => reject(tx.error || request.error);
    });
}

/**
 * Read one slot's campaign identity from its metadata record alone — never
 * materializes the payload. Returns null for legacy saves (no stamp) or a
 * missing slot. Used by the delete flow to check whether the AUTOSAVE slot
 * (excluded from listSaves) still holds a campaign being deleted.
 */
export function getSaveSessionId(slotId) {
    return withDb((db, resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readonly');
        const request = tx.objectStore(STORE_NAME).get(slotId);
        request.onsuccess = () => resolve(request.result?.sessionId || null);
        request.onerror = () => reject(request.error);
        tx.onabort = () => reject(tx.error || request.error);
    });
}

/**
 * Delete a save slot.
 */
export function deleteSave(slotId) {
    return withDb((db, resolve, reject) => {
        const tx = db.transaction([PAYLOAD_STORE, ...BLOB_SWEEP_STORES], 'readwrite');
        const request = tx.objectStore(STORE_NAME).delete(slotId);
        const payloadRequest = tx.objectStore(PAYLOAD_STORE).delete(slotId);
        // The slot's pictures and chapters go with it unless another slot still holds them.
        payloadRequest.onsuccess = () => sweepOrphanBlobs(tx);
        // Resolve on COMMIT (see saveGame) so a refresh read after a delete sees it gone.
        request.onerror = () => reject(request.error);
        payloadRequest.onerror = () => reject(payloadRequest.error);
        tx.oncomplete = () => resolve();
        // Either delete's failure is the abort's reason (2026-10-06 P2: the
        // payload delete's error was never named here).
        tx.onabort = () => reject(tx.error || request.error || payloadRequest.error);
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
 * Load the auto-save. Resolves `null` ONLY when no autosave exists; a storage
 * failure (blocked open, quota/corruption, evicted DB) REJECTS so the caller
 * can tell "nothing to continue" from "could not look" — the boot screen used
 * to render a swallowed failure as "no autosave, no saves" while the campaign
 * sat intact on disk (2026-09-02 audit). Its one caller (App.jsx checkSaves)
 * catches and surfaces it.
 */
export function loadAutoSave() {
    return loadGame(AUTOSAVE_SLOT);
}
