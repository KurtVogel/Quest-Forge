/**
 * The campaign FILE (2026-11-11, review queue item 1): one JSON file that
 * holds a campaign as a save writes it — the `serializeGameState` payload,
 * with portraits and chronicle chapters inline — inside a small versioned
 * envelope. A backup without Firebase, a way to move a campaign between
 * devices, and the copy that survives "clear site data".
 *
 * Never in the file: `settings` (the API keys live there), `user`, `ui` —
 * `serializeGameState` strips them on the way out, and the reader strips
 * them again on the way in (a legacy payload embedded a settings copy; a
 * hand-edited file can carry anything). Not in the file either: the
 * embedding cache, which rebuilds on the first load.
 *
 * A file is untrusted input. The reader only unwraps the envelope; the state
 * it returns goes through LOAD_GAME's `validateSaveState` and the migration
 * pipeline like every other save.
 *
 * Pure. The browser calls (download, file read) are
 * components/Settings/campaignFileIO.js.
 */
import { asSaveObject, buildSaveMetadata, serializeGameState } from './persistence.js';

export const CAMPAIGN_FILE_FORMAT = 'quest-forge-campaign';
/** Bump only when the ENVELOPE changes shape; the state inside is versioned by its own `saveVersion`. */
export const CAMPAIGN_FILE_VERSION = 1;
/** A sanity bound on a file offered for loading (the megacampaign's file is ~4 MB). */
export const CAMPAIGN_FILE_MAX_BYTES = 200 * 1024 * 1024;

/**
 * Build the file object for a campaign. `stored: true` is a payload read
 * back from a slot (`loadGame`): it keeps its own `saveVersion` / `savedAt`
 * stamps, so an older save still runs its migrations when the file is loaded.
 */
export function buildCampaignFile(gameState, { stored = false, exportedAt = new Date().toISOString() } = {}) {
    const state = serializeGameState(gameState, { keepStamps: stored });
    const { name, characterName, characterLevel, characterClass, messageCount } = buildSaveMetadata(state);
    return {
        format: CAMPAIGN_FILE_FORMAT,
        formatVersion: CAMPAIGN_FILE_VERSION,
        exportedAt,
        // For a human opening the file; the loader never reads it.
        summary: { name, characterName, characterLevel, characterClass, messageCount },
        state,
    };
}

/** `questforge-campaign-<hero>-<YYYY-MM-DD>.json` (the hero file is `questforge-<hero>.json`). */
export function campaignFileName(file) {
    const slug = String(file?.summary?.characterName || '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 40);
    // The day in the player's own time zone (the stamp itself is UTC).
    const at = typeof file?.exportedAt === 'string' ? new Date(file.exportedAt) : null;
    const pad = (n) => String(n).padStart(2, '0');
    const day = at && Number.isFinite(at.getTime()) ? `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}` : '';
    return ['questforge-campaign', slug || 'hero', day].filter(Boolean).join('-') + '.json';
}

const refuse = (message) => ({ ok: false, message });

/**
 * Unwrap a campaign file's text. Returns `{ ok: true, state }` — a plain
 * object for `LOAD_GAME`, never validated here — or `{ ok: false, message }`
 * with a player-readable reason.
 */
export function parseCampaignFile(text) {
    let parsed = null;
    try {
        parsed = JSON.parse(text);
    } catch {
        return refuse('That file is not a Quest Forge campaign file (it is not valid JSON).');
    }
    const file = asSaveObject(parsed);
    if (!file || file.format !== CAMPAIGN_FILE_FORMAT) {
        return refuse('That file is not a Quest Forge campaign file. A hero file is imported on the New Game screen instead.');
    }
    if (!Number.isInteger(file.formatVersion) || file.formatVersion < 1) {
        return refuse('That campaign file has no readable format version.');
    }
    if (file.formatVersion > CAMPAIGN_FILE_VERSION) {
        return refuse('That campaign file was written by a newer Quest Forge. Reload this page to update, then load the file again.');
    }
    const stored = asSaveObject(file.state);
    if (!stored || !asSaveObject(stored.character)) {
        return refuse('That campaign file holds no campaign (no hero in it).');
    }
    const { user: _user, ui: _ui, settings: _settings, ...state } = stored;
    // A load never calls the DM. A campaign saved before its opening scene
    // carries `openingScenePending`, and ChatPanel would open the scene with
    // the player's key on the FILE's say-so: the player sends the first line.
    if (asSaveObject(state.session)?.openingScenePending) {
        state.session = { ...state.session, openingScenePending: false };
    }
    return { ok: true, state };
}
