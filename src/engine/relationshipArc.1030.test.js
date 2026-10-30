/**
 * Story-memory P2 (2026-10-30, the Opus playtest, measured): THE BOND HAS
 * TURNED for Sanna rode 24 DM prompts while she was four weeks of sea away.
 * A TURN beat renders only while its person is in the scene — on the party
 * line or named in the presence text by the KNOWN NPCs tokenizer. The
 * ABSENCE beat ("SOMEONE REACHES OUT") stays ungated: it is about someone
 * APART acting on their own initiative.
 */
import { describe, expect, it } from 'vitest';
import {
    BEAT_WINDOW_MESSAGES,
    buildRelationshipBeatBlock,
    detectBondTurn,
    mintRelationshipBeat,
    mintTurnBeat,
} from './relationshipArc.js';

const m = (text, kind, salience, atMessage) => ({ text, kind, salience, atMessage });
const bare = { id: 'npc-sanna', name: 'Sanna Aallotar', rosterTier: 'character', disposition: 'friendly' };
const rescue = m('Sanna Aallotar hauled the hero out of the surf and said nothing of it.', 'rescue', 5, 3);
const trusted = { ...bare, bondMoments: [rescue] };

describe('a turn beat renders only for a person in the scene (2026-10-30 P2)', () => {
    const beat = mintTurnBeat(trusted, detectBondTurn(bare, trusted), { messageCount: 40 });

    it('an open turn beat for an ABSENT NPC renders nothing — with no presence text, an unrelated one, or a look-alike token', () => {
        expect(buildRelationshipBeatBlock(beat, [trusted], { messageCount: 41 })).toBe('');
        expect(buildRelationshipBeatBlock(beat, [trusted], { messageCount: 41, presenceText: 'The quay is empty; Tammo mends a net.' })).toBe('');
        // Whole-word presence: "Sannas" / "Aallotarn" are not her.
        expect(buildRelationshipBeatBlock(beat, [trusted], { messageCount: 41, presenceText: 'The Sannas sail past the Aallotarn reef.' })).toBe('');
        expect(buildRelationshipBeatBlock(beat, [trusted], { messageCount: 41, presenceText: 42 })).toBe('');
    });

    it('the same beat renders once her name is in the presence text — either identifying token — and still never outside the window or in combat', () => {
        const block = buildRelationshipBeatBlock(beat, [trusted], { messageCount: 41, presenceText: 'Sanna steps off the gangplank and looks for the hero.' });
        expect(block).toContain('## THE BOND HAS TURNED — PRIVATE');
        expect(block).toContain('now trusted — earned by: Sanna Aallotar hauled the hero out of the surf');
        expect(buildRelationshipBeatBlock(beat, [trusted], { messageCount: 41, presenceText: '"Aallotar!" someone calls across the water.' })).toContain('THE BOND HAS TURNED');
        expect(buildRelationshipBeatBlock(beat, [trusted], { messageCount: 41, combatActive: true, presenceText: 'Sanna is here.' })).toBe('');
        expect(buildRelationshipBeatBlock(beat, [trusted], { messageCount: 41 + BEAT_WINDOW_MESSAGES + 1, presenceText: 'Sanna is here.' })).toBe('');
    });

    it('a party member is present whatever the presence text says', () => {
        const block = buildRelationshipBeatBlock(beat, [trusted], { messageCount: 41, party: [{ id: 'c1', name: 'Sanna' }] });
        expect(block).toContain('THE BOND HAS TURNED');
        expect(block).not.toContain('TRAVELLING WITH'); // the breaking point is the estranged / rival variant only
    });

    it('the ABSENCE beat still renders for an absent NPC — reaching out is what it is for', () => {
        const absence = mintRelationshipBeat({ npc: trusted, stage: 'trusted', thread: 'the debt at the well' }, { messageCount: 40 });
        const block = buildRelationshipBeatBlock(absence, [trusted], { messageCount: absence.opensAtMessage, presenceText: 'The quay is empty.' });
        expect(block).toContain('## SOMEONE REACHES OUT — PRIVATE');
        expect(buildRelationshipBeatBlock(absence, [trusted], { messageCount: absence.opensAtMessage })).toContain('SOMEONE REACHES OUT');
    });
});
