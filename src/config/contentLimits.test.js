import { describe, expect, it } from 'vitest';
import { CAMPAIGN_PREMISE_MAX_LENGTH, normalizeCampaignPremise } from './contentLimits.js';

describe('campaign premise limit', () => {
    it('keeps a hefty premise intact up to the shared limit', () => {
        const premise = `  ${'f'.repeat(CAMPAIGN_PREMISE_MAX_LENGTH)}  `;
        expect(normalizeCampaignPremise(premise)).toHaveLength(CAMPAIGN_PREMISE_MAX_LENGTH);
    });

    it('bounds oversized premise data before prompt injection', () => {
        const premise = 'x'.repeat(CAMPAIGN_PREMISE_MAX_LENGTH + 500);
        expect(normalizeCampaignPremise(premise)).toBe('x'.repeat(CAMPAIGN_PREMISE_MAX_LENGTH));
    });
});
