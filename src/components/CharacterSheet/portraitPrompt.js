/**
 * Hero portrait prompt template, shared by the Character Profile's portrait
 * section and the creation wizard's hero reveal. The gender prefix is the
 * same inviolable-gender signal the scene-art director uses (DECISIONS.md
 * 2026-07-25): a stated gender rides directly beside the identity.
 */
export function buildPortraitPrompt(character, appearance, equippedItems = []) {
    const gear = equippedItems.length > 0 ? ` Wearing/carrying: ${equippedItems.join(', ')}.` : '';
    const gender = character.gender?.trim() ? `${character.gender.trim()} ` : '';
    return [
        `Waist-up character portrait of ${character.name}, a ${gender}${character.race} ${character.class}.`,
        appearance,
        gear,
        'Adult low-fantasy tabletop RPG portrait, grounded and believable, expressive face, sharp eyes, practical clothing and gear, moody painterly realism, dark neutral background, soft rim light, no text, no frame.',
    ].filter(Boolean).join(' ');
}
