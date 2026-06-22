/**
 * Only brand-new campaigns explicitly marked by character creation may ask the DM
 * to open a scene automatically. Loaded campaigns must restore the transcript
 * without generating a new turn, even when older assistant messages were pruned.
 */
export function shouldPrimeCampaignOpening(state) {
    const visibleAssistantMessages = (state.messages || [])
        .filter(message => !message.hidden && message.role === 'assistant');

    return Boolean(
        state.character
        && state.settings?.apiKey
        && state.session?.openingScenePending === true
        && state.session?.premise?.trim()
        && visibleAssistantMessages.length === 0
    );
}

export function buildCampaignOpeningPrompt() {
    return `[SYSTEM: This is the opening of a brand-new campaign. Open the very first scene, drawing on the CAMPAIGN PREMISE in your context. Establish the setting and the character's immediate situation vividly, honoring every place, name, and detail in the premise as canon.

Before finishing, reconcile the premise with the current INVENTORY exactly once:
- For each concrete, portable item the premise explicitly establishes that the PLAYER CHARACTER already owns, carries, brought, wears, or wields, add it through starting_items only if an equivalent item is not already in INVENTORY. Match by identity and common synonyms, not just exact wording; the engine also rejects exact/catalog duplicates.
- Each starting_items entry uses { "name": "descriptive item name", "itemKey": "known catalog key only when certain", "description": "brief premise-grounded flavor", "equipped": false }. Set equipped true only when the premise explicitly says the character begins wearing or wielding it.
- Do not add items merely mentioned as belonging to an NPC, faction, place, shop, inheritance not yet received, desire, plan, or possible future reward. Do not turn buildings, land, titles, relationships, animals, or other non-portable assets into inventory.
- Preserve descriptive names and harmless flavor, but do not invent prices, magic bonuses, attack bonuses, damage, armor values, consumable effects, or other mechanics. Recognized catalog items receive mechanics from the engine.

Do NOT mention this reconciliation, game mechanics, saving, or that a game is starting. End with "What do you do?" as usual.]`;
}
