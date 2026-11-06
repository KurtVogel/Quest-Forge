import { describe, expect, it } from 'vitest';
import { liveWorldFacts, planWorldFactAdditions } from './worldFacts.js';

// 2026-11-06 (night): the lane's `supersedes` id is read BEFORE the word
// judge. The containment rule used to run first, so a new fact that repeated
// the old fact's words was dropped as its restatement and nothing retired.

const seed = (rows) => rows.map((row, i) => ({ id: `fact-${i + 1}`, category: 'general', knownBy: 'public', atMessage: 2, ...row }));

describe('a named fact is retired even when the new fact repeats its words (2026-11-06)', () => {
    const facts = seed([{ fact: 'The spare sail is in the net-loft.' }]);

    it('the Scribe lane: "moved from the net-loft to the foredeck" replaces "is in the net-loft"', () => {
        const plan = planWorldFactAdditions(facts, [
            { fact: 'The spare sail was moved from the net-loft to the foredeck.', supersedes: 'fact-1' },
        ], { messageCount: 30, standingRefs: true });
        expect(plan.added).toHaveLength(1);
        expect(plan.added[0].supersedes).toBe('fact-1');
        expect(liveWorldFacts(plan.worldFacts).map(f => f.fact)).toEqual(['The spare sail was moved from the net-loft to the foredeck.']);
        expect(plan.worldFacts[0]).toMatchObject({ id: 'fact-1', supersededBy: plan.added[0].id, supersededAtMessage: 30 });
    });

    it('without the ref the same sentence is still the word judge\'s restatement (unchanged)', () => {
        const plan = planWorldFactAdditions(facts, [
            { fact: 'The spare sail was moved from the net-loft to the foredeck.' },
        ], { messageCount: 30, standingRefs: true });
        expect(plan.added).toHaveLength(0);
        expect(liveWorldFacts(plan.worldFacts)).toHaveLength(1);
    });

    it('a character-for-character copy carrying its own id is a restatement, never a retirement', () => {
        const plan = planWorldFactAdditions(facts, [
            { fact: 'the spare sail is in the net-loft', supersedes: 'fact-1' },
        ], { messageCount: 30, standingRefs: true });
        expect(plan.added).toHaveLength(0);
        expect(plan.worldFacts[0].supersededBy).toBeUndefined();
    });

    it('a pinned fact still refuses the ref, and the word judge then reads the pair as before', () => {
        const pinned = seed([{ fact: 'The spare sail is in the net-loft.', pinned: true }]);
        const plan = planWorldFactAdditions(pinned, [
            { fact: 'The spare sail was moved from the net-loft to the foredeck.', supersedes: 'fact-1' },
        ], { messageCount: 30, standingRefs: true });
        expect(plan.added).toHaveLength(0);
        expect(plan.worldFacts[0].supersededBy).toBeUndefined();
    });

    it('a lane without standing refs cannot retire a standing truth by naming it', () => {
        const plan = planWorldFactAdditions(facts, [
            { fact: 'The spare sail was moved from the net-loft to the foredeck.', supersedes: 'fact-1' },
        ], { messageCount: 30 });
        expect(plan.added).toHaveLength(0);
        expect(plan.worldFacts[0].supersededBy).toBeUndefined();
    });

    it('an open plan closes by ref on any lane even when the deed repeats the plan\'s words', () => {
        const plans = seed([{ fact: 'The baron will seize the mill.', aspect: 'intent' }]);
        const plan = planWorldFactAdditions(plans, [
            { fact: 'The baron did seize the mill, as he said he will.', supersedes: 'fact-1' },
        ], { messageCount: 30 });
        expect(plan.added).toHaveLength(1);
        expect(plan.worldFacts[0].supersededBy).toBe(plan.added[0].id);
    });

    it('the new truth already on record under another line: the named fact retires onto that line', () => {
        const two = seed([
            { fact: 'The spare sail is in the net-loft.' },
            { fact: 'The spare sail lies on the foredeck.' },
        ]);
        const plan = planWorldFactAdditions(two, [
            { fact: 'The spare sail lies on the foredeck now.', supersedes: 'fact-1' },
        ], { messageCount: 30, standingRefs: true });
        expect(plan.added).toHaveLength(0);
        expect(plan.worldFacts[0]).toMatchObject({ supersededBy: 'fact-2' });
        expect(liveWorldFacts(plan.worldFacts).map(f => f.id)).toEqual(['fact-2']);
    });

    it('a flip of a THIRD line closes that line and the named one, both under the new fact', () => {
        const two = seed([
            { fact: 'The spare sail is in the net-loft.' },
            { fact: 'The foredeck hatch is open.' },
        ]);
        const plan = planWorldFactAdditions(two, [
            { fact: 'The foredeck hatch is not open.', supersedes: 'fact-1' },
        ], { messageCount: 30, standingRefs: true });
        expect(plan.added).toHaveLength(1);
        const id = plan.added[0].id;
        expect(plan.worldFacts.filter(f => f.supersededBy === id).map(f => f.id)).toEqual(['fact-1', 'fact-2']);
    });
});
