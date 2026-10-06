/**
 * The local character roster — heroes (character + inventory), NOT campaigns;
 * the save slots own those (see engine/characterVault.js for what a hero IS).
 * Split out of persistence.js on 2026-10-06 (seven exports with their own
 * sweep scope; the 10-05 "one file as four modules" precedent).
 *
 * The roster is a TEMPLATE, not an afterlife (DECISIONS.md 2026-09-03), and
 * since 2026-10-06 it holds ONE record shape: every write goes through the
 * vault's `toHeroTemplate` (rested, rebuilt, id kept), so a row saved from the
 * Character Sheet equals a row saved from an import of the same hero, and a
 * dead hero's row never reads `isDead: true`. A row is hydrated on select /
 * begin / export through `loadRosterCharacter`; the list is a projection.
 */
import { toHeroTemplate } from '../engine/characterVault.js';
import { collectLaneRefs, extractLanes, restoreLanes } from './portraitStore.js';
import {
    PORTRAIT_STORE,
    PORTRAIT_SWEEP_STORES,
    ROSTER_STORE,
    ensureLaneBlobs,
    metaNumber,
    metaText,
    metadataRefs,
    readLaneBlobs,
    sweepOrphanBlobs,
    withDb,
} from './idb.js';

/**
 * Save a hero to the roster. Keyed by `character.id`, so re-saving the same
 * hero updates its entry; a hero without an id is minted one by the template
 * (the caller writes it back into live state — see
 * CharacterSheet.handleSaveToRoster — or every later "Save to Roster" click
 * mints a fresh id and duplicates the entry). Rejects with the vault's own
 * message for a hero that cannot be templated.
 *
 * The hero's portrait rides the content-addressed `portraits` store, not the
 * row (2026-09-24 character-vault P2): the roster was the LAST inline-portrait
 * store — 93 % of a row was a second copy of the blob the campaign's save
 * already held. The row carries `character.portraitRef` + the lane's ref list
 * (`portraitRefs`, the sweep's metadata read, like a save slot); the blob is
 * put only when its key is absent, so a hero already in a slot moves zero
 * portrait bytes. Resolves the STORED row (slim); callers wanting the picture
 * use `loadRosterCharacter`.
 */
export async function saveRosterCharacter(character, inventory) {
    // Template BEFORE the transaction opens: a throw here is the vault's
    // message (as a rejection — every caller awaits inside a try), not a
    // dangling IndexedDB connection.
    const template = toHeroTemplate(character, inventory);
    return withDb((db, resolve, reject) => {
        const tx = db.transaction(PORTRAIT_SWEEP_STORES, 'readwrite');
        const store = tx.objectStore(ROSTER_STORE);
        // The roster row rides the lane table like a save slot: `{ character }`
        // is its payload, so the portrait lane extracts the hero's picture and
        // the chapter lane finds nothing to extract.
        const { state, lanes } = extractLanes({ character: template.character });
        const id = template.character.id;
        const entry = {
            id,
            name: template.character.name,
            race: template.character.race,
            class: template.character.class,
            level: template.character.level,
            savedAt: Date.now(),
            ...Object.fromEntries(lanes.map(lane => [lane.refsField, lane.refs])),
            character: state.character,
            inventory: template.inventory,
        };
        let request = null;
        // The row's PREVIOUS version is read first (the save slot's own order):
        // a ref it lists is on disk and live, so only new refs are probed, and a
        // reroll since the last roster save releases the old blob — unless a
        // slot still shows it, which the sweep checks.
        const previousRequest = store.get(id);
        previousRequest.onerror = () => reject(previousRequest.error);
        previousRequest.onsuccess = () => {
            const previous = previousRequest.result;
            let released = false;
            for (const lane of lanes) {
                const kept = new Set(lane.refs);
                if (metadataRefs(previous, lane.refsField).some(ref => !kept.has(ref))) released = true;
            }
            ensureLaneBlobs(tx, lanes, lane => new Set(metadataRefs(previous, lane.refsField)));
            request = store.put(entry);
            request.onsuccess = () => { if (released) sweepOrphanBlobs(tx); };
            request.onerror = () => reject(request.error);
        };
        // Resolve on COMMIT (see saveGame) so a list refresh right after sees the entry.
        tx.oncomplete = () => resolve(entry);
        tx.onabort = () => reject(tx.error || request?.error || previousRequest.error);
    });
}

/**
 * ONE typed projection for a roster LIST row (2026-09-11 persistence P2 — the
 * 09-10 "a render is a trust boundary" class, one list over): the hero picker
 * renders `name` / `level` / race / class as React children with no boundary
 * of its own. Text is string-or-fallback, level finite, savedAt a number; a
 * record without a string id (the store's key) or a non-object record is
 * dropped. A PROJECTION, not a split (2026-10-06 doc P2): the roster is ONE
 * store whose rows carry the hero whole — `listRosterCharacters` reads the
 * rows and hands out these fields only, so the picker never holds a
 * `character` / `inventory` it did not ask for; a row is hydrated on select /
 * begin / export through `loadRosterCharacter`. (The save slots are a real
 * split — `saves` + `savePayloads` — because a campaign is multi-MB; a hero
 * row is ~6k once its portrait rides the blob store, so no reason has
 * appeared to split the roster the same way.)
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
 * restored inline through `lookup(lane, key)`) and `inventory`. The embedded
 * `character` is otherwise untouched — the picker runs it through the vault's
 * sanitizeCharacter, which is the real gate.
 */
export function projectRosterHero(record, lookup = () => undefined) {
    const entry = projectRosterEntry(record);
    if (!entry) return null;
    const hydrated = restoreLanes({ character: record.character }, lookup);
    const character = hydrated.character && typeof hydrated.character === 'object' && !Array.isArray(hydrated.character)
        ? hydrated.character
        : null;
    return { ...entry, character, inventory: Array.isArray(record.inventory) ? record.inventory : [] };
}

/**
 * List all roster heroes, newest first — projected rows only. Reads no
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
            // Only the portrait lane can name a ref on `{ character }`, so the
            // read never touches a store outside this transaction's scope.
            readLaneBlobs(tx, collectLaneRefs({ character: record.character }), lookup => resolve(projectRosterHero(record, lookup)));
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
