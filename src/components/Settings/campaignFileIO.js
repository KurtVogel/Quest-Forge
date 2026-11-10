/**
 * The campaign file's two browser calls — the download (`Blob`, an object
 * URL, a synthetic `<a download>` click, like the hero file's exportFile.js)
 * and the read of a file the player picked. What goes INTO the file and what
 * is accepted OUT of one is state/campaignFile.js (pure, tested).
 */
import { CAMPAIGN_FILE_MAX_BYTES, buildCampaignFile, campaignFileName, parseCampaignFile } from '../../state/campaignFile.js';

/**
 * Download a campaign as one JSON file. `stored` marks a payload read back
 * from a slot (it keeps its own save stamps). Returns the file name.
 */
export function downloadCampaignFile(gameState, { stored = false } = {}) {
    const file = buildCampaignFile(gameState, { stored });
    const filename = campaignFileName(file);
    // Compact on purpose: a mature campaign is several MB before indentation.
    const blob = new Blob([JSON.stringify(file)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.click();
    // Not revoked in the same task: a multi-MB download reads the blob after the click.
    setTimeout(() => URL.revokeObjectURL(url), 60000);
    return filename;
}

/** Read a picked file. Resolves `parseCampaignFile`'s result (`{ ok, state }` / `{ ok: false, message }`); never rejects. */
export async function readCampaignFile(file) {
    if (!file) return { ok: false, message: 'No file was chosen.' };
    if (file.size > CAMPAIGN_FILE_MAX_BYTES) {
        return { ok: false, message: 'That file is too large to be a Quest Forge campaign file.' };
    }
    try {
        return parseCampaignFile(await file.text());
    } catch (e) {
        console.error('Failed to read the campaign file', e);
        return { ok: false, message: `That file could not be read — ${e?.message || 'details in the browser console'}.` };
    }
}
