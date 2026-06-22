export const CAMPAIGN_PREMISE_MAX_LENGTH = 8000;

export function normalizeCampaignPremise(value) {
    return String(value || '').trim().slice(0, CAMPAIGN_PREMISE_MAX_LENGTH);
}
