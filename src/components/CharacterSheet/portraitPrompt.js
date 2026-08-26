/**
 * THE portrait style line, shared by every portrait prompt in the app —
 * the hero portrait (Character Profile + creation reveal), NPC portraits,
 * and SceneArt's focused-portrait mode (2026-08-20 audit P2: SceneArt carried
 * a drifted hand copy). A stated gender always rides beside the name as a
 * "(woman)"/"(man)" tag — the exact token the art director's inviolable-gender
 * rule keys on (DECISIONS.md 2026-07-25); the hero prompt used a bare prefix
 * that convention never covered.
 */
export const PORTRAIT_STYLE = 'Adult low-fantasy tabletop RPG portrait, grounded and believable, expressive face, sharp eyes, practical clothing and gear, moody painterly realism, dark neutral background, soft rim light, no text, no frame.';

export function buildPortraitPrompt(character, appearance, equippedItems = []) {
    const gear = equippedItems.length > 0 ? ` Wearing/carrying: ${equippedItems.join(', ')}.` : '';
    const gender = character.gender?.trim() ? ` (${character.gender.trim()})` : '';
    return [
        `Waist-up character portrait of ${character.name}${gender}, a ${character.race} ${character.class}.`,
        appearance,
        gear,
        PORTRAIT_STYLE,
    ].filter(Boolean).join(' ');
}

/**
 * Portrait prompt for a roster NPC, built from Scribe-captured continuity:
 * the registered gender rides beside the name ("(woman)" — the same
 * inviolable-gender convention as scene art) and the merged appearance
 * record is the likeness. lastNotes gives the painter role context;
 * privateNotes stays private by design.
 */
export function buildNpcPortraitPrompt(npc) {
    const gender = npc.gender?.trim() ? ` (${npc.gender.trim()})` : '';
    const role = String(npc.lastNotes || npc.notes || '').trim();
    return [
        `Waist-up character portrait of ${npc.name}${gender}.`,
        String(npc.appearance || '').trim(),
        role ? `Context: ${role.slice(0, 200)}` : '',
        PORTRAIT_STYLE,
    ].filter(Boolean).join(' ');
}
