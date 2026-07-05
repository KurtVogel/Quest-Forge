import { describe, expect, it } from 'vitest';
import {
    buildRollRulingRecord,
    buildRoleplayChallengePrompt,
    buildRoleplayCheckProposal,
    normalizeRollRuling,
    pruneRecentRulings,
    RECENT_RULING_LIMIT,
    RULING_MESSAGE_TTL,
    sanitizePendingRoleplayCheck,
} from './roleplayCheck.js';

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

    it('carries the withheld setup narration and message id, clamped and reload-safe', () => {
        const proposal = buildRoleplayCheckProposal([roll], 'I sprint for the archway.', {
            setupNarrative: 'The horde pours through the breach as the floor splinters beneath you.',
            setupMessageId: 'msg-123-abc',
        });
        expect(proposal.setupNarrative).toBe('The horde pours through the breach as the floor splinters beneath you.');
        expect(proposal.setupMessageId).toBe('msg-123-abc');

        const restored = sanitizePendingRoleplayCheck({ ...proposal, setupNarrative: 'x'.repeat(9000) });
        expect(restored.setupNarrative).toHaveLength(4000);

        const bare = buildRoleplayCheckProposal([roll], 'I sprint for the archway.');
        expect(bare.setupNarrative).toBe('');
        expect(bare.setupMessageId).toBeNull();
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

    it('records a ruling from a proposal and rejects malformed entries', () => {
        const proposal = buildRoleplayCheckProposal([roll], 'I present the signed writ.', { challengeUsed: true });
        const record = buildRollRulingRecord(proposal, 'set_aside', { messageCount: 10, location: 'Gate district' });
        expect(record).toMatchObject({
            objective: 'Secure passage through the gate',
            skill: 'persuasion',
            dc: 12,
            outcome: 'set_aside',
            finalRuling: true,
            atMessageCount: 10,
            location: 'Gate district',
        });

        expect(buildRollRulingRecord(null, 'withdrawn', {})).toBeNull();
        expect(normalizeRollRuling({ objective: 'x', outcome: 'rolled' })).toBeNull();
        expect(normalizeRollRuling({ outcome: 'withdrawn' })).toBeNull();
    });

    it('prunes rulings by message age, location, and cap', () => {
        const fresh = { objective: 'Ask the keeper', skill: 'persuasion', dc: 10, outcome: 'withdrawn', atMessageCount: 90, location: 'Tavern' };
        const stale = { ...fresh, objective: 'Old ask', atMessageCount: 90 - RULING_MESSAGE_TTL - 1 };
        const elsewhere = { ...fresh, objective: 'Dock ask', location: 'Docks' };
        const noLocation = { ...fresh, objective: 'Anywhere ask', location: null };

        const kept = pruneRecentRulings([stale, elsewhere, fresh, noLocation], { messageCount: 90, location: 'Tavern' });
        expect(kept.map(r => r.objective)).toEqual(['Ask the keeper', 'Anywhere ask']);

        const many = Array.from({ length: RECENT_RULING_LIMIT + 3 }, (_, i) => ({ ...fresh, objective: `Ask ${i}` }));
        expect(pruneRecentRulings(many, { messageCount: 90, location: 'Tavern' })).toHaveLength(RECENT_RULING_LIMIT);
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
