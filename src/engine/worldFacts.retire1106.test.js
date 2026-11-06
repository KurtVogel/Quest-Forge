/**
 * A thing that moved keeps no old place (2026-11-06, Vesa reversing the 10-07
 * "a standing truth closes by a flip alone"). A flip is a negation and a move
 * is not, so "the sail is in the net-loft" stayed live canon after the sail
 * went aboard: the DM said net-loft in 3 of 7 Sol runs. The Scribe alone may
 * name the fact its new fact replaces; the id compares exactly, a pinned fact
 * refuses, and removing the replacing message gives the old fact back.
 */
import { describe, expect, it } from 'vitest';
import { findRetirableFact, liveWorldFacts, planWorldFactAdditions } from './worldFacts.js';
import { planRetraction } from './retraction.js';
import { handlers } from '../state/handlers/worldMemory.js';
import { buildKnownFacts } from '../llm/scribe.js';

const loft = { id: 'fact-loft', fact: "The Kittiwake's spare sail is in the rafters of Tammo's net-loft.", category: 'location', atMessage: 4, sourceMessage: 'm4' };
const moved = { fact: "The Kittiwake's spare sail is lashed under her foredeck.", category: 'location', supersedes: 'fact-loft' };

describe('the Scribe retires a standing fact by id', () => {
    it('closes the named fact, and the new fact says what it replaced', () => {
        const plan = planWorldFactAdditions([loft], [moved], { messageCount: 22, sourceMessage: 'm22', standingRefs: true });
        expect(liveWorldFacts(plan.worldFacts).map(f => f.fact)).toEqual([moved.fact]);
        const old = plan.worldFacts.find(f => f.id === 'fact-loft');
        expect(old.supersededBy).toBe(plan.added[0].id);
        expect(old.supersededAtMessage).toBe(22);
        expect(plan.added[0].supersedes).toBe('fact-loft');
    });

    it('stays on the record as history: nothing is deleted', () => {
        const plan = planWorldFactAdditions([loft], [moved], { standingRefs: true });
        expect(plan.worldFacts).toHaveLength(2);
    });

    it('still closes an open plan', () => {
        const plan = { id: 'fact-plan', fact: 'The Guild means to seize the mill.', aspect: 'intent', category: 'event' };
        const out = planWorldFactAdditions([plan], [{ fact: 'The Guild took the mill at dawn.', supersedes: 'fact-plan' }], { standingRefs: true });
        expect(liveWorldFacts(out.worldFacts).map(f => f.id)).not.toContain('fact-plan');
    });

    it('a restatement of another live line still retires what the ref names, onto that line', () => {
        const held = { id: 'fact-aboard', fact: moved.fact, category: 'location' };
        const plan = planWorldFactAdditions([loft, held], [moved], { messageCount: 30, standingRefs: true });
        expect(plan.added).toHaveLength(0);
        expect(liveWorldFacts(plan.worldFacts).map(f => f.id)).toEqual(['fact-aboard']);
        expect(plan.worldFacts.find(f => f.id === 'fact-loft').supersededBy).toBe('fact-aboard');
    });

    it('a ref to the very line the fact restates retires nothing', () => {
        const held = { id: 'fact-aboard', fact: moved.fact, category: 'location' };
        const plan = planWorldFactAdditions([held], [{ fact: moved.fact, supersedes: 'fact-aboard' }], { standingRefs: true });
        expect(liveWorldFacts(plan.worldFacts).map(f => f.id)).toEqual(['fact-aboard']);
    });
});

describe('the bounds on the ref', () => {
    it('another lane reaches intents only: a standing truth ignores its ref', () => {
        const plan = planWorldFactAdditions([loft], [moved], {});
        expect(liveWorldFacts(plan.worldFacts)).toHaveLength(2);
        expect(plan.added[0].supersedes).toBeUndefined();
    });

    it('the reducer needs the Scribe lane\'s flag', () => {
        const state = { worldFacts: [loft], messages: [] };
        expect(liveWorldFacts(handlers.ADD_WORLD_FACTS(state, { payload: [moved] }).worldFacts)).toHaveLength(2);
        expect(liveWorldFacts(handlers.ADD_WORLD_FACTS(state, { payload: [moved], standingRefs: true }).worldFacts)).toHaveLength(1);
        expect(liveWorldFacts(handlers.ADD_WORLD_FACTS(state, { payload: [moved], standingRefs: 'true' }).worldFacts)).toHaveLength(2);
    });

    it('a pinned fact refuses, and the new fact still lands beside it', () => {
        const pinned = { ...loft, pinned: true };
        const plan = planWorldFactAdditions([pinned], [moved], { standingRefs: true });
        expect(liveWorldFacts(plan.worldFacts)).toHaveLength(2);
    });

    it('compares the id exactly: junk, near misses and a buried fact name nothing', () => {
        const buried = { id: 'fact-old', fact: 'x', supersededBy: 'fact-new' };
        for (const ref of ['fact-lof', 'FACT-LOFT', 'the net-loft', '', null, 7, {}, ['fact-loft'], 'fact-old']) {
            expect(findRetirableFact([loft, buried], ref)).toBeNull();
        }
    });
});

describe('a deleted turn gives the old fact back', () => {
    const state = () => {
        const plan = planWorldFactAdditions([loft], [moved], { messageCount: 22, sourceMessage: 'm22', standingRefs: true });
        return { worldFacts: plan.worldFacts, storyMemory: [], messages: [{ id: 'm4' }, { id: 'm22' }] };
    };

    it('the replacing fact retracts and the fact it closed is live again', () => {
        const plan = planRetraction(state(), 'm22');
        expect(liveWorldFacts(plan.worldFacts).map(f => f.id)).toEqual(['fact-loft']);
        const old = plan.worldFacts.find(f => f.id === 'fact-loft');
        expect(old.supersededBy).toBeUndefined();
        expect(old.supersededAtMessage).toBeUndefined();
    });

    it('a replacing fact a later message also said stays, and so does the retirement', () => {
        const s = state();
        s.worldFacts = s.worldFacts.map(f => (f.sourceMessage === 'm22' ? { ...f, witnesses: ['m4'] } : f));
        const plan = planRetraction(s, 'm22');
        expect(liveWorldFacts(plan.worldFacts).map(f => f.fact)).toEqual([moved.fact]);
    });

    it('a retraction that closes nothing changes no other row', () => {
        const other = { id: 'fact-other', fact: 'The light has gone dark.', sourceMessage: 'm9', category: 'event' };
        const plan = planRetraction({ worldFacts: [loft, other], storyMemory: [], messages: [{ id: 'm4' }, { id: 'm9' }] }, 'm9');
        expect(plan.worldFacts[0]).toBe(loft);
    });
});

describe('the Scribe can see what it may name', () => {
    it('KNOWN FACTS carries each line\'s id; a legacy row without one prints bare', () => {
        const block = buildKnownFacts({ worldFacts: [loft, { fact: 'The light has gone dark.' }] }, 'The sail.');
        expect(block).toContain(`- id: fact-loft | "${loft.fact}"`);
        expect(block).toContain('- "The light has gone dark."');
    });
});
