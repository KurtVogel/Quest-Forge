/**
 * Persistence layer using LocalStorage (settings) and IndexedDB (game saves).
 */
import { CURRENT_SAVE_VERSION } from './migrations.js';
import { sanitizeSettings } from './settingsSchema.js';
import {
    collectChapterRefs,
    collectPortraitRefs,
    extractChapters,
    extractPortraits,
    restoreChapters,
    restorePortraits,
} from './portraitStore.js';

const SETTINGS_KEY = 'rpg-client-settings';
const DB_NAME = 'rpg-client-saves';
// v3 (2026-08-04): save payloads split out of the metadata records so listing
// saves never materializes full campaign states (multi-MB on mature campaigns).
// v4 (2026-09-21): portrait bytes split out of the payloads into a
// content-addressed `portraits` store (state/portraitStore.js) — they were
// ~96 % of every autosave and never change. No data migration: a payload that
// still carries inline portraits loads as-is and is split on its next save.
// v5 (2026-09-24): chronicle chapter prose split the same way into a
// content-addressed `chronicleChapters` store — chapters are immutable and
// were 23–25 % of every autosave after the portrait split. Same no-migration
// rule: inline chapters load as-is and split on the next save.
const DB_VERSION = 5;
const STORE_NAME = 'saves';
const PAYLOAD_STORE = 'savePayloads';
const PORTRAIT_STORE = 'portraits';
const CHAPTER_STORE = 'chronicleChapters';
const ROSTER_STORE = 'characters';
const AUTOSAVE_SLOT = '__autosave__';

/**
 * The blob stores (the 09-21 portrait split, generalized by field name on
 * 2026-09-24): bytes that never change live under a content key, the payload
 * carries a ref, and the slot's metadata record lists its refs under
 * `refsField` so the orphan sweep never opens a payload.
 */
const BLOB_STORES = [
    { store: PORTRAIT_STORE, refsField: 'portraitRefs', extract: extractPortraits, collect: collectPortraitRefs, restore: restorePortraits },
    { store: CHAPTER_STORE, refsField: 'chapterRefs', extract: extractChapters, collect: collectChapterRefs, restore: restoreChapters },
];

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
                migrateEmbeddedPayloads(event.target.transaction);
            }
            if (!db.objectStoreNames.contains(PORTRAIT_STORE)) {
                // Out-of-line keys: the value IS the data URL string.
                db.createObjectStore(PORTRAIT_STORE);
            }
            if (!db.objectStoreNames.contains(CHAPTER_STORE)) {
                // Out-of-line keys: the value IS the chapter's prose.
                db.createObjectStore(CHAPTER_STORE);
            }
        };
    });
}

/**
 * v2 → v3: move each save's full state payload out of its metadata record,
 * one-time, inside the versionchange transaction (the open blocks until the
 * cursor finishes).
 *
 * Every step is per-record and NON-FATAL (2026-09-02 audit): a failed payload
 * put (quota — peak is ~2× every save inside this one transaction) used to
 * bubble up and abort the whole upgrade, which failed the open, re-ran the
 * upgrade on EVERY later open, and so failed every save/load/autosave forever.
 * Now a failing record simply stays legacy (state still embedded in its
 * metadata record — `loadGame`'s embedded-state fallback reads it, `listSaves`
 * strips it) and the metadata is only stripped AFTER its payload landed, so a
 * record can never lose its state to a put that never happened.
 */
function migrateEmbeddedPayloads(transaction) {
    const saves = transaction.objectStore(STORE_NAME);
    const payloads = transaction.objectStore(PAYLOAD_STORE);
    // Cancel the error's default action (aborting the transaction) and keep it
    // from bubbling to the transaction/database handlers.
    const keepGoing = (label) => (errorEvent) => {
        errorEvent.preventDefault?.();
        errorEvent.stopPropagation?.();
        console.warn(`[Persistence] Save migration: ${label} — the record stays in its legacy layout.`, errorEvent.target?.error);
    };
    const cursorRequest = saves.openCursor();
    cursorRequest.onerror = keepGoing('cursor failed');
    cursorRequest.onsuccess = (cursorEvent) => {
        const cursor = cursorEvent.target.result;
        if (!cursor) return;
        const record = cursor.value;
        if (!record?.state) {
            cursor.continue();
            return;
        }
        let putRequest = null;
        try {
            putRequest = payloads.put({ slotId: record.slotId, state: record.state });
        } catch (e) {
            // A synchronous throw (non-cloneable value) is the same outcome: legacy.
            console.warn('[Persistence] Save migration: payload copy threw — the record stays in its legacy layout.', e);
            cursor.continue();
            return;
        }
        putRequest.onerror = (errorEvent) => {
            keepGoing(`payload copy for "${record.slotId}" failed`)(errorEvent);
            cursor.continue();
        };
        putRequest.onsuccess = () => {
            // Strip the embedded state only now that its copy is in place; the
            // cursor is still positioned on this record (continue() not yet called).
            const { state: _state, ...metadata } = record;
            try {
                const updateRequest = cursor.update(metadata);
                // Both copies exist if this fails — loadGame prefers the payload.
                updateRequest.onerror = keepGoing(`metadata strip for "${record.slotId}" failed`);
            } catch (e) {
                console.warn('[Persistence] Save migration: metadata strip threw — both copies remain.', e);
            }
            cursor.continue();
        };
    };
}

/**
 * Open the database, run `execute(db, resolve, reject)` as a Promise
 * executor, and guarantee the connection is closed however it ends:
 * commit, abort, a request error, OR a synchronous throw inside the executor
 * (`DataCloneError` on a non-cloneable snapshot, `InvalidStateError` while the
 * connection is closing under a cross-tab versionchange, a plain `TypeError`
 * on a bad snapshot). The per-function `db.close()` calls used to live on the
 * complete/abort handlers only, so a sync throw rejected the promise and
 * leaked the connection — and a leaked connection is exactly what blocks
 * another tab's versioned open until the 8s `onblocked` timeout (2026-09-02
 * audit). Closing here is the ONE close site; `close()` on an already-closed
 * connection is a spec no-op, and closing with a transaction still running
 * merely flags close-pending — the transaction finishes first.
 */
async function withDb(execute) {
    const db = await openDB();
    // Another tab bumping DB_VERSION must not be held up by this connection.
    db.onversionchange = () => db.close();
    try {
        return await new Promise((resolve, reject) => execute(db, resolve, reject));
    } finally {
        db.close();
    }
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
        // Wall-clock stamp on the PAYLOAD (2026-09-16, the return card): the
        // slot metadata already carries one, but the loaded state never did,
        // so LOAD_GAME could not heal a pre-stamp campaign's lastPlayedAt.
        savedAt: Date.now(),
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

const META_TEXT_MAX = 200;
const metaText = (value, fallback) => {
    if (typeof value !== 'string') return fallback;
    const trimmed = value.trim().slice(0, META_TEXT_MAX);
    return trimmed || fallback;
};
const metaNumber = (value, fallback) => {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
};

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
        sessionId: metaText(record.sessionId, null), // absent on legacy saves
        name: metaText(record.name, 'Unnamed Save'),
        characterName: metaText(record.characterName, 'Unknown'),
        characterLevel: metaNumber(record.characterLevel, 1),
        characterClass: metaText(record.characterClass, 'Unknown'),
        characterHP: metaNumber(record.characterHP, 0),
        characterMaxHP: metaNumber(record.characterMaxHP, 0),
        characterAC: metaNumber(record.characterAC, 10),
        gold: metaNumber(record.gold, 0),
        silver: metaNumber(record.silver, 0),
        copper: metaNumber(record.copper, 0),
        inventoryCount: metaNumber(record.inventoryCount, 0),
        location: metaText(record.location, null),
        questCount: metaNumber(record.questCount, 0),
        partySize: metaNumber(record.partySize, 0),
        messageCount: metaNumber(record.messageCount, 0),
        savedAt,
    };
}

const metadataPortraitRefs = (record) =>
    (Array.isArray(record?.portraitRefs) ? record.portraitRefs.filter(ref => typeof ref === 'string') : []);

/**
 * Every store a transaction must include to sweep orphan PORTRAITS: the slot
 * metadata records, the roster (its rows carry their hero's ref since
 * 2026-09-24 — the roster was the last inline-portrait store, and a hero saved
 * to the roster and to a slot shares ONE blob, so both sides are live sets),
 * and the portraits themselves. Requests run in order, so the sweep's
 * `getAll`s already see the caller's own put/delete, and overlapping
 * readwrite transactions serialize, so a concurrent save can never have its
 * fresh blob swept between its blob put and its metadata put.
 */
const PORTRAIT_SWEEP_STORES = [STORE_NAME, ROSTER_STORE, PORTRAIT_STORE];

/**
 * Every store a transaction must include to sweep ALL blob stores (a save
 * slot's write/delete can orphan a portrait or a chapter). A transaction that
 * carries only some of them sweeps only those — a roster save's scope is
 * `PORTRAIT_SWEEP_STORES`, and a roster save cannot orphan a chapter.
 */
export const BLOB_SWEEP_STORES = [...PORTRAIT_SWEEP_STORES, CHAPTER_STORE];

const metadataRefs = (record, refsField) =>
    (Array.isArray(record?.[refsField]) ? record[refsField].filter(ref => typeof ref === 'string') : []);

/**
 * The 09-21 portrait sweep, generalized (2026-09-24) to every blob store the
 * transaction has in scope: live sets are read from every slot's metadata
 * record (+ a legacy embedded state) and, for portraits, every roster row.
 */
function sweepOrphanBlobs(tx) {
    const quiet = (event) => { event.preventDefault?.(); event.stopPropagation?.(); };
    const lanes = BLOB_STORES
        .filter(lane => tx.objectStoreNames.contains(lane.store))
        .map(lane => ({ ...lane, live: new Set() }));
    if (lanes.length === 0) return;
    const sweepStores = () => {
        for (const lane of lanes) {
            const store = tx.objectStore(lane.store);
            const keysRequest = store.getAllKeys();
            keysRequest.onerror = quiet;
            keysRequest.onsuccess = () => {
                for (const key of keysRequest.result || []) {
                    if (!lane.live.has(key)) store.delete(key).onerror = quiet;
                }
            };
        }
    };
    const allRequest = tx.objectStore(STORE_NAME).getAll();
    allRequest.onerror = quiet;
    allRequest.onsuccess = () => {
        for (const record of allRequest.result || []) {
            for (const lane of lanes) {
                metadataRefs(record, lane.refsField).forEach(ref => lane.live.add(ref));
                if (record?.state) lane.collect(record.state).forEach(ref => lane.live.add(ref));
            }
        }
        const portraitLane = lanes.find(lane => lane.store === PORTRAIT_STORE);
        if (!portraitLane) { sweepStores(); return; }
        const rosterRequest = tx.objectStore(ROSTER_STORE).getAll();
        rosterRequest.onerror = quiet;
        rosterRequest.onsuccess = () => {
            for (const record of rosterRequest.result || []) {
                metadataPortraitRefs(record).forEach(ref => portraitLane.live.add(ref));
                collectPortraitRefs({ character: record?.character }).forEach(ref => portraitLane.live.add(ref));
            }
            sweepStores();
        };
    };
}

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

        const savedMessages = gameState.messages || [];
        // prunedMessageCount indexes into the array we actually persist. Summarized messages
        // are always a contiguous prefix, so their count IS the boundary index.
        // `m?.` belt: a null entry in live state must not brick every autosave.
        const prunedMessageCount = savedMessages.filter(m => m?.summarized).length;

        // Portrait bytes ride the `portraits` store and chapter prose the
        // `chronicleChapters` store, not the payload (see portraitStore.js):
        // the payload carries refs, the metadata record lists them so the
        // orphan sweep never opens a payload.
        let slimState = {
            ...serializeGameState(gameState),
            session: { ...gameState.session, prunedMessageCount },
        };
        const lanes = BLOB_STORES.map(lane => {
            const extracted = lane.extract(slimState);
            slimState = extracted.state;
            return { ...lane, blobs: extracted.blobs, refs: extracted.refs };
        });

        const saves = tx.objectStore(STORE_NAME);
        let metadataRequest = null;
        let payloadRequest = null;

        // The slot's PREVIOUS record is read FIRST (2026-09-23 audit P2, minor):
        // a ref it lists is on disk and live (the sweep only ever deletes what
        // no record lists, inside serialized transactions), so only refs it
        // did NOT list are probed — a steady-state autosave makes zero
        // `getKey` requests. Its refs also decide whether anything can have
        // been orphaned (a reroll, a removed NPC, a dropped chapter, a
        // different campaign in the slot).
        const previousRequest = saves.get(slotId);
        previousRequest.onerror = () => reject(previousRequest.error);
        previousRequest.onsuccess = () => {
            const previous = previousRequest.result;
            let released = false;
            for (const lane of lanes) {
                const listed = new Set(metadataRefs(previous, lane.refsField));
                const kept = new Set(lane.refs);
                if ([...listed].some(ref => !kept.has(ref))) released = true;
                // A blob is immutable under its content key: write it only when
                // absent (getKey reads no bytes). A failed put aborts the
                // transaction — the save fails loudly rather than committing a
                // payload whose picture or chapter never landed.
                const store = tx.objectStore(lane.store);
                for (const [key, bytes] of lane.blobs) {
                    if (listed.has(key)) continue;
                    const probe = store.getKey(key);
                    probe.onsuccess = () => { if (probe.result === undefined) store.put(bytes, key); };
                }
            }

            const metadata = {
                slotId,
                ...buildSaveMetadata(gameState),
                savedAt: Date.now(),
                messageCount: savedMessages.length,
            };
            for (const lane of lanes) metadata[lane.refsField] = lane.refs;
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
        const tx = db.transaction([STORE_NAME, PAYLOAD_STORE, ...BLOB_STORES.map(lane => lane.store)], 'readonly');
        // Refs → inline bytes before the state leaves this module: live state,
        // the cloud upload loop, and LOAD_GAME never see a portraitRef or a
        // chapterRef. A blob that cannot be read is a missing picture / a
        // dropped chapter, never a failed load.
        const hydrate = (stored) => {
            const state = asSaveObject(stored);
            const lanes = BLOB_STORES.map(lane => ({ ...lane, refs: lane.collect(state), found: new Map() }));
            let pending = lanes.reduce((count, lane) => count + lane.refs.length, 0);
            if (pending === 0) { resolve(state); return; }
            const settle = () => {
                if (--pending > 0) return;
                resolve(lanes.reduce((restored, lane) => lane.restore(restored, key => lane.found.get(key)), state));
            };
            for (const lane of lanes) {
                for (const ref of lane.refs) {
                    const blobRequest = tx.objectStore(lane.store).get(ref);
                    blobRequest.onsuccess = () => { lane.found.set(ref, blobRequest.result); settle(); };
                    blobRequest.onerror = (event) => { event.preventDefault?.(); event.stopPropagation?.(); settle(); };
                }
            }
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
        tx.onabort = () => reject(tx.error || request.error);
    });
}

// === Character roster (heroes, not campaigns — see engine/characterVault.js) ===

/**
 * Save a hero snapshot (character + inventory) to the roster.
 * Keyed by character.id, so re-saving the same hero updates its entry;
 * imports get a fresh id and create a new entry.
 *
 * The hero's portrait rides the content-addressed `portraits` store, not the
 * row (2026-09-24 character-vault P2): the roster was the LAST inline-portrait
 * store — 93 % of a row was a second copy of the blob the campaign's save
 * already held. The row carries `character.portraitRef` + `portraitRefs`
 * (the sweep's metadata read, like a save slot); the blob is put only when
 * its key is absent, so a hero already in a slot moves zero portrait bytes.
 * Resolves the STORED row (slim); callers wanting the picture use
 * `loadRosterCharacter`.
 */
export function saveRosterCharacter(character, inventory) {
    return withDb((db, resolve, reject) => {
        const tx = db.transaction(PORTRAIT_SWEEP_STORES, 'readwrite');
        const store = tx.objectStore(ROSTER_STORE);
        // A legacy pre-id-era hero gets an id minted here; the caller must write it
        // back into live state (see CharacterSheet.handleSaveToRoster) or every
        // later "Save to Roster" click mints a fresh id and duplicates the entry.
        const id = character.id || `char-${Date.now()}`;
        const { state, blobs, refs } = extractPortraits({ character: character.id ? character : { ...character, id } });
        const entry = {
            id,
            name: character.name,
            race: character.race,
            class: character.class,
            level: character.level,
            savedAt: Date.now(),
            portraitRefs: refs,
            character: state.character,
            inventory: inventory || [],
        };
        const portraits = tx.objectStore(PORTRAIT_STORE);
        for (const [key, url] of blobs) {
            const probe = portraits.getKey(key);
            probe.onsuccess = () => { if (probe.result === undefined) portraits.put(url, key); };
        }
        // A reroll since the last roster save releases the old blob — unless a
        // slot still shows it, which the sweep checks.
        let released = false;
        const previousRequest = store.get(id);
        previousRequest.onsuccess = () => {
            const kept = new Set(refs);
            released = metadataPortraitRefs(previousRequest.result).some(ref => !kept.has(ref));
        };
        const request = store.put(entry);
        request.onsuccess = () => { if (released) sweepOrphanBlobs(tx); };
        // Resolve on COMMIT (see saveGame) so a list refresh right after sees the entry.
        request.onerror = () => reject(request.error);
        tx.oncomplete = () => resolve(entry);
        tx.onabort = () => reject(tx.error || request.error);
    });
}

/**
 * ONE typed projection for a roster LIST row (2026-09-11 persistence P2 — the
 * 09-10 "a render is a trust boundary" class, one list over): the hero picker
 * renders `name` / `level` / race / class as React children with no boundary
 * of its own. Text is string-or-fallback, level finite, savedAt a number; a
 * record without a string id (the store's key) or a non-object record is
 * dropped. Metadata ONLY (2026-09-24, the `saves`/`savePayloads` split's
 * pattern): the list never hands out `character`/`inventory` — a row is
 * hydrated on select / begin / export through `loadRosterCharacter`.
 */
export function projectRosterEntry(record) {
    if (!record || typeof record !== 'object' || Array.isArray(record)) return null;
    const id = metaText(record.id, null);
    if (!id) return null;
    const character = record.character && typeof record.character === 'object' && !Array.isArray(record.character)
        ? record.character
        : null;
    return {
        id,
        name: metaText(record.name, null) || metaText(character?.name, 'Unnamed hero'),
        race: metaText(record.race, ''),
        class: metaText(record.class, ''),
        level: metaNumber(record.level, 1),
        savedAt: metaNumber(record.savedAt, 0),
    };
}

/**
 * The full roster hero: the list row plus the stored `character` (portrait
 * restored inline) and `inventory`. The embedded `character` is otherwise
 * untouched — the picker runs it through the vault's sanitizeCharacter,
 * which is the real gate.
 */
export function projectRosterHero(record, lookup = () => undefined) {
    const entry = projectRosterEntry(record);
    if (!entry) return null;
    const hydrated = restorePortraits({ character: record.character }, lookup);
    const character = hydrated.character && typeof hydrated.character === 'object' && !Array.isArray(hydrated.character)
        ? hydrated.character
        : null;
    return { ...entry, character, inventory: Array.isArray(record.inventory) ? record.inventory : [] };
}

/**
 * List all roster heroes, newest first — metadata rows only. Reads no
 * portrait blob: the wizard mounts this on every hero pick and a live roster
 * row used to be 97k chars, 90k of it the picture.
 */
export function listRosterCharacters() {
    return withDb((db, resolve, reject) => {
        const tx = db.transaction(ROSTER_STORE, 'readonly');
        const store = tx.objectStore(ROSTER_STORE);
        const request = store.getAll();
        request.onsuccess = () => {
            resolve((Array.isArray(request.result) ? request.result : [])
                .map(projectRosterEntry)
                .filter(Boolean)
                .sort((a, b) => b.savedAt - a.savedAt));
        };
        request.onerror = () => reject(request.error);
        tx.onabort = () => reject(tx.error || request.error);
    });
}

/**
 * How many heroes the roster holds — the start card's "N in roster" — read
 * through `count()`, which deserializes no row. The Forge-a-New-Hero path
 * never needs a row (2026-09-24: the wizard `getAll()`ed the roster on mount
 * on BOTH paths).
 */
export function countRosterCharacters() {
    return withDb((db, resolve, reject) => {
        const tx = db.transaction(ROSTER_STORE, 'readonly');
        const request = tx.objectStore(ROSTER_STORE).count();
        request.onsuccess = () => resolve(metaNumber(request.result, 0));
        request.onerror = () => reject(request.error);
        tx.onabort = () => reject(tx.error || request.error);
    });
}

/**
 * Load ONE roster hero with its portrait restored inline (the row carries a
 * ref). Resolves null for an unknown id. A blob that cannot be read is a
 * missing picture (stamps stripped, see portraitStore), never a failed load;
 * a legacy row still carrying an inline portraitUrl loads as-is and is split
 * on its next save.
 */
export function loadRosterCharacter(id) {
    return withDb((db, resolve, reject) => {
        const tx = db.transaction([ROSTER_STORE, PORTRAIT_STORE], 'readonly');
        const request = tx.objectStore(ROSTER_STORE).get(id);
        request.onsuccess = () => {
            const record = request.result;
            if (!record || typeof record !== 'object') { resolve(null); return; }
            const refs = collectPortraitRefs({ character: record.character });
            if (refs.length === 0) { resolve(projectRosterHero(record)); return; }
            const found = new Map();
            let pending = refs.length;
            const settle = () => { if (--pending === 0) resolve(projectRosterHero(record, key => found.get(key))); };
            for (const ref of refs) {
                const blobRequest = tx.objectStore(PORTRAIT_STORE).get(ref);
                blobRequest.onsuccess = () => { found.set(ref, blobRequest.result); settle(); };
                blobRequest.onerror = (event) => { event.preventDefault?.(); event.stopPropagation?.(); settle(); };
            }
        };
        request.onerror = () => reject(request.error);
        tx.onabort = () => reject(tx.error || request.error);
    });
}

/**
 * Delete a roster hero. Its portrait goes with it unless a save slot (or
 * another roster row) still shows it.
 */
export function deleteRosterCharacter(id) {
    return withDb((db, resolve, reject) => {
        const tx = db.transaction(PORTRAIT_SWEEP_STORES, 'readwrite');
        const store = tx.objectStore(ROSTER_STORE);
        const request = store.delete(id);
        request.onsuccess = () => sweepOrphanBlobs(tx);
        request.onerror = () => reject(request.error);
        tx.oncomplete = () => resolve();
        tx.onabort = () => reject(tx.error || request.error);
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
