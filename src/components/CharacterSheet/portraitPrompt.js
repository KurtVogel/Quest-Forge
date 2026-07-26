/**
 * Hero portrait prompt template, shared by the Character Profile's portrait
 * section and the creation wizard's hero reveal. The gender prefix is the
 * same inviolable-gender signal the scene-art director uses (DECISIONS.md
 * 2026-07-25): a stated gender rides directly beside the identity.
 */
const PORTRAIT_STYLE = 'Adult low-fantasy tabletop RPG portrait, grounded and believable, expressive face, sharp eyes, practical clothing and gear, moody painterly realism, dark neutral background, soft rim light, no text, no frame.';

export function buildPortraitPrompt(character, appearance, equippedItems = []) {
    const gear = equippedItems.length > 0 ? ` Wearing/carrying: ${equippedItems.join(', ')}.` : '';
    const gender = character.gender?.trim() ? `${character.gender.trim()} ` : '';
    return [
        `Waist-up character portrait of ${character.name}, a ${gender}${character.race} ${character.class}.`,
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
