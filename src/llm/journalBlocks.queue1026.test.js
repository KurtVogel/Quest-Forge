/**
 * Strengthening queue 2026-10-26 (memory-journal P2): LOCATION TRANSITION
 * HISTORY renders only when the trail ENDS at the current place — on a
 * return before the next cadence the backward scan used to land on the
 * previous visit's run and present its arrival as this one's.
 */
import { describe, expect, it } from 'vitest';
import { buildTransitionHistoryBlock } from './journalBlocks.js';

const entry = (location, summary) => ({ location, summary });

describe('buildTransitionHistoryBlock — the trail must end here', () => {
    it('a RETURN before the next cadence renders nothing (the previous visit\'s arrival is not this one\'s)', () => {
        const journal = [
            entry('Harbor', 'Harbor dealings with the smugglers.'),
            entry('Rimehollow', 'First arrival at Rimehollow; met Orsa.'),
            entry('Rimehollow', 'The ledger changes hands.'),
            entry('Saltmarsh', 'The marsh road.'),
            entry('Saltmarsh', 'A night in the salt sheds.'),
        ];
        // The hero walked back into Rimehollow from Saltmarsh; no cadence yet.
        expect(buildTransitionHistoryBlock(journal, 'Rimehollow')).toBe('');
    });

    it('a trail that ends here renders the arrival entry of THIS stay and the entry right before it', () => {
        const journal = [
            entry('Harbor', 'Harbor dealings with the smugglers.'),
            entry('Rimehollow', 'First arrival at Rimehollow; met Orsa.'),
            entry('Rimehollow', 'The ledger changes hands.'),
        ];
        const block = buildTransitionHistoryBlock(journal, 'Rimehollow');
        expect(block).toContain('## LOCATION TRANSITION HISTORY');
        expect(block).toContain('**Right before entering:** Entry 1 (at Harbor) in SESSION HISTORY above.');
        expect(block).toContain('**Arrival at Rimehollow:** Entry 2 in SESSION HISTORY above.');
    });

    it('a second stay renders ITS OWN arrival once the cadence has recorded the return', () => {
        const journal = [
            entry('Harbor', 'Harbor dealings.'),
            entry('Rimehollow', 'First arrival at Rimehollow.'),
            entry('Saltmarsh', 'The marsh road.'),
            entry('Saltmarsh', 'A night in the salt sheds.'),
            entry('Rimehollow', 'Back in Rimehollow; the well is dry.'),
        ];
        const block = buildTransitionHistoryBlock(journal, 'Rimehollow');
        expect(block).toContain('**Right before entering:** Entry 4 (at Saltmarsh) in SESSION HISTORY above.');
        expect(block).toContain('**Arrival at Rimehollow:** Entry 5 in SESSION HISTORY above.');
        expect(block).not.toContain('Entry 2');
    });

    it('an entry with no location says nothing about place: skipped at the tail and inside the run', () => {
        const tail = [entry('Harbor', 'Harbor.'), entry('Rimehollow', 'Arrived.'), entry(null, 'A conversation, place unrecorded.')];
        expect(buildTransitionHistoryBlock(tail, 'Rimehollow')).toContain('**Arrival at Rimehollow:** Entry 2');
        const gap = [entry('Harbor', 'Harbor.'), entry('Rimehollow', 'Arrived.'), entry(null, 'Place unrecorded.'), entry('Rimehollow', 'Still here.')];
        expect(buildTransitionHistoryBlock(gap, 'Rimehollow')).toContain('**Arrival at Rimehollow:** Entry 2');
        // A trail of ONLY location-less entries shows no trail.
        expect(buildTransitionHistoryBlock([entry(null, 'x'), entry(null, 'y')], 'Rimehollow')).toBe('');
    });
});
