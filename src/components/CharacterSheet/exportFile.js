/**
 * The hero file DOWNLOAD — the one browser call (`Blob`, `URL.createObjectURL`,
 * a synthetic `<a download>` click) the character vault needs, kept beside the
 * sheet like portraitPrompt.js (2026-10-06 character-vault P2: it was the only
 * `document` use under `src/engine/` and exactly the vault's uncovered lines).
 * What goes INTO the file — the rested template, the filename — stays in the
 * engine (`buildCharacterExport` / `characterExportFilename`).
 */
import { buildCharacterExport, characterExportFilename } from '../../engine/characterVault.js';

/** Trigger a browser download of a hero as a versioned JSON file. Throws the vault's own message when the hero cannot be templated. */
export function downloadCharacterExport(character, inventory) {
    const data = buildCharacterExport(character, inventory);
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = characterExportFilename(data.character);
    link.click();
    URL.revokeObjectURL(url);
}
