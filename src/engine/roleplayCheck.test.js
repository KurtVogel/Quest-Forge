import { describe, expect, it } from 'vitest';
import {
    appendRecentCheck,
    buildRecentCheckEntry,
    buildRollRulingRecord,
    buildRoleplayChallengePrompt,
    buildRoleplayCheckProposal,
    normalizeRollRuling,
    pruneRecentRulings,
    RECENT_CHECK_LIMIT,
    RECENT_RULING_LIMIT,
    RULING_MESSAGE_TTL,
    sanitizePendingRoleplayCheck,
    sanitizeRecentChecks,
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

describe('recent-checks heat ledger', () => {
    it('builds an entry from the hardest roll and clamps a wild DC', () => {
        const proposal = buildRoleplayCheckProposal(
            [{ ...roll, dc: 10 }, { ...roll, skill: 'athletics', dc: 99 }],
            'I leap the gap while arguing.',
        );
        expect(buildRecentCheckEntry(proposal, 12)).toEqual({ messageIndex: 12, dc: 30, skill: 'persuasion' });
        expect(buildRecentCheckEntry(null, 12)).toBeNull();
    });

    it('caps the ledger and replaces a same-message re-proposal instead of double-counting', () => {
        let list = [];
        for (let i = 0; i < 12; i++) {
            list = appendRecentCheck(list, { messageIndex: i, dc: 10, skill: null });
        }
        expect(list).toHaveLength(RECENT_CHECK_LIMIT);
        expect(list[0].messageIndex).toBe(12 - RECENT_CHECK_LIMIT);

        const replaced = appendRecentCheck(list, { messageIndex: 11, dc: 15, skill: 'stealth' });
        expect(replaced).toHaveLength(RECENT_CHECK_LIMIT);
        expect(replaced.at(-1)).toEqual({ messageIndex: 11, dc: 15, skill: 'stealth' });
    });

    it('sanitizes hostile save payloads', () => {
        const cleaned = sanitizeRecentChecks([
            { messageIndex: 4, dc: 12, skill: 'insight' },
            { messageIndex: 'NaN', dc: 12 },
            'garbage',
            { messageIndex: -3, dc: 500, skill: 42 },
        ]);
        expect(cleaned).toEqual([
            { messageIndex: 4, dc: 12, skill: 'insight' },
            { messageIndex: 0, dc: 30, skill: '42' },
        ]);
        expect(sanitizeRecentChecks(null)).toEqual([]);
    });
});
