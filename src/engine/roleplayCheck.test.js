import { describe, expect, it } from 'vitest';
import { buildRoleplayChallengePrompt, buildRoleplayCheckProposal, sanitizePendingRoleplayCheck } from './roleplayCheck.js';

const roll = {
    type: 'skill_check',
    skill: 'persuasion',
    dc: 12,
    description: 'Secure passage through the gate',
    reason: 'The guard is uncertain and actively refusing entry',
    opposition: 'A guard under strict orders',
    failureStakes: 'Entry is refused and the route closes',
    difficultyReason: 'Meaningful opposition with plausible leverage',
    advantage: true,
    advantageReason: 'The player presents a signed writ',
};

describe('roleplay check proposals', () => {
    it('stores a bounded reload-safe proposal before dice exist', () => {
        const proposal = buildRoleplayCheckProposal([roll], 'I present the signed writ.', { challengeUsed: false });
        expect(proposal).toMatchObject({
            rolls: [roll],
            playerAction: 'I present the signed writ.',
            challengeUsed: false,
        });
        expect(proposal.id).toMatch(/^roleplay-check-/);
    });

    it('rejects malformed restored proposals', () => {
        expect(sanitizePendingRoleplayCheck(null)).toBeNull();
        expect(sanitizePendingRoleplayCheck({ rolls: [] })).toBeNull();
    });

    it('builds a one-challenge public adjudication request', () => {
        const proposal = buildRoleplayCheckProposal([roll], 'I present the signed writ.');
        const prompt = buildRoleplayChallengePrompt(proposal, 'The signed writ should remove uncertainty.');
        expect(prompt).toContain('before any dice exist');
        expect(prompt).toContain('one allowed challenge');
        expect(prompt).toContain('WITHDRAW');
        expect(prompt).toContain('REVISE');
        expect(prompt).toContain('UPHOLD');
        expect(prompt).toContain('Never reveal private chain-of-thought');
        expect(prompt).not.toContain('declared potential loot');
    });

    it('reminds a challenged ruling about declared-but-unapplied loot', () => {
        const proposal = buildRoleplayCheckProposal([roll], 'I pry open the reliquary.', {
            loot: { goldFound: 15, itemsFound: [{ name: 'Silver Ring', quantity: 2 }] },
        });
        const prompt = buildRoleplayChallengePrompt(proposal, 'The lock is already broken.');
        expect(prompt).toContain('declared potential loot');
        expect(prompt).toContain('15 gold');
        expect(prompt).toContain('2x Silver Ring');
        expect(prompt).toContain('NOT applied');
    });
});
