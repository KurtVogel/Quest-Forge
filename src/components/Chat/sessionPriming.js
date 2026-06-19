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
