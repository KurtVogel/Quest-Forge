/**
 * Memory-research M0 (2026-10-28, D1 / D4 — built 2026-10-30): a retrieved
 * row that RESTATES a since-flipped fact carries its correction. A journal /
 * narrative / npc / general row holding ≥ STALE_ROW_CONTAINMENT of a
 * superseded fact's meaning tokens, whose restating clause is not already on
 * the live twin's side of the negation, ends ` — since changed: "<twin>"`.
 * Never a player row, never a world_fact row; a stamp-less fact set leaves the
 * block byte-identical; the tag counts toward the row max and the ceiling.
 */
import { describe, expect, it } from 'vitest';
import { buildRetrievedMemoriesBlock, RETRIEVED_MEMORIES_CHAR_CEILING, RETRIEVED_MEMORY_ROW_MAX, STALE_ROW_CONTAINMENT } from './promptBuilder.js';

const facts = [
    { id: 'f1', fact: 'The bridge at Ashford is passable.', category: 'geography', atMessage: 4, supersededBy: 'f2', supersededAtMessage: 30 },
    { id: 'f2', fact: 'The bridge at Ashford is not passable.', category: 'geography', atMessage: 30, supersedes: 'f1' },
    { id: 'f3', fact: 'Orsa keeps the countinghouse.', category: 'people', atMessage: 6 },
];
const tag = ' — since changed: "The bridge at Ashford is not passable."';

describe('a retrieved row restating a superseded fact says since changed (2026-10-30 M0)', () => {
    it('a journal row restating the old truth gets the tag; a row already saying the new truth does not; a player row never; the live fact itself never', () => {
        const rows = [
            { text: 'The party crossed into Ashford. The bridge at Ashford is passable, the ferryman said.', category: 'journal', location: 'Ashford' },
            { text: 'Word at the inn: the bridge at Ashford is not passable since the flood.', category: 'journal' },
            { text: 'The bridge at Ashford is passable, I tell the guard.', category: 'player' },
            { text: 'The bridge at Ashford is passable.', category: 'world_fact' },
            { text: 'Orsa keeps the countinghouse.', category: 'npc' },
        ];
        const block = buildRetrievedMemoriesBlock(rows, { worldFacts: facts });
        const lines = block.split('\n').filter(line => line.startsWith('- ['));
        expect(lines[0]).toBe(`- [journal — recorded at: Ashford] The party crossed into Ashford. The bridge at Ashford is passable, the ferryman said.${tag}`);
        expect(lines[1]).not.toContain('since changed');
        expect(lines[2]).not.toContain('since changed');
        expect(lines[3]).not.toContain('since changed');
        expect(lines[4]).not.toContain('since changed');
        expect(block.split('since changed').length - 1).toBe(1);
    });

    it('the tag rides before the age; the mirror flip (a negated old fact, a positive twin) tags the negated restatement and spares the positive one', () => {
        const messages = [{ role: 'user', content: 'a' }, { role: 'assistant', content: 'b' }, { role: 'user', content: 'c' }, { role: 'assistant', content: 'd' }];
        const aged = buildRetrievedMemoriesBlock([{ text: 'The bridge at Ashford is passable.', category: 'narrative', atMessage: 0 }], { messages, worldFacts: facts });
        expect(aged).toContain(`The bridge at Ashford is passable.${tag} — 2 turns ago`);

        const mirror = [
            { id: 'g1', fact: 'Tammo is not welcome at the Gull.', atMessage: 2, supersededBy: 'g2', supersededAtMessage: 20 },
            { id: 'g2', fact: 'Tammo is welcome at the Gull.', atMessage: 20, supersedes: 'g1' },
        ];
        const rows = [
            { text: 'Tammo is not welcome at the Gull, the keeper spat.', category: 'journal' },
            { text: 'Tammo is welcome at the Gull again.', category: 'journal' },
        ];
        const block = buildRetrievedMemoriesBlock(rows, { worldFacts: mirror });
        const lines = block.split('\n').filter(line => line.startsWith('- ['));
        expect(lines[0]).toContain(' — since changed: "Tammo is welcome at the Gull."');
        expect(lines[1]).not.toContain('since changed');
    });

    it('a same-polarity close (a plan closed by its deed) tags on the tokens alone; the newest change wins when two superseded facts match; a re-flipped chain tags only from a LIVE twin', () => {
        const plan = [
            { id: 'p1', fact: 'Tammo plans to sail for Odrana at dawn.', aspect: 'intent', atMessage: 3, supersededBy: 'p2', supersededAtMessage: 12 },
            { id: 'p2', fact: 'Tammo sailed for Odrana.', atMessage: 12, supersedes: 'p1' },
        ];
        const planned = buildRetrievedMemoriesBlock([{ text: 'Tammo plans to sail for Odrana at dawn, he says over the ale.', category: 'npc' }], { worldFacts: plan });
        expect(planned).toContain(' — since changed: "Tammo sailed for Odrana."');

        const twice = [
            { id: 'a', fact: 'The well at Rimehollow is poisoned.', atMessage: 2, supersededBy: 'b', supersededAtMessage: 10 },
            { id: 'b', fact: 'The well at Rimehollow is not poisoned.', atMessage: 10, supersededBy: 'c', supersededAtMessage: 40 },
            { id: 'c', fact: 'The well at Rimehollow is poisoned.', atMessage: 40 },
        ];
        const rows = [
            { text: 'The well at Rimehollow is poisoned, the reeve warned.', category: 'journal' }, // true again: a's twin b is not live
            { text: 'The well at Rimehollow is not poisoned, the reeve allowed.', category: 'journal' }, // b's twin c is live
        ];
        const block = buildRetrievedMemoriesBlock(rows, { worldFacts: twice });
        const lines = block.split('\n').filter(line => line.startsWith('- ['));
        expect(lines[0]).not.toContain('since changed');
        expect(lines[1]).toContain(' — since changed: "The well at Rimehollow is poisoned."');

        // Two superseded facts the same row restates: the newest change's twin is the one quoted.
        const pair = [
            { id: 'o1', fact: 'The gate is open.', atMessage: 1, supersededBy: 'o2', supersededAtMessage: 5 },
            { id: 'o2', fact: 'The gate is not open.', atMessage: 5 },
            { id: 'q1', fact: 'The gate is open to all.', atMessage: 2, supersededBy: 'q2', supersededAtMessage: 9 },
            { id: 'q2', fact: 'The gate is not open to all.', atMessage: 9 },
        ];
        const newest = buildRetrievedMemoriesBlock([{ text: 'The gate is open to all comers.', category: 'journal' }], { worldFacts: pair });
        expect(newest.split('since changed').length - 1).toBe(1);
        expect(newest).toContain('since changed: "The gate is not open to all."');
    });

    it('a stamp-less fact set, a retracted stale fact, a missing twin, or no facts leaves the block byte-identical; the threshold is exported', () => {
        const rows = [{ text: 'The bridge at Ashford is passable.', category: 'journal', atMessage: 1 }];
        const plain = buildRetrievedMemoriesBlock(rows);
        expect(buildRetrievedMemoriesBlock(rows, { worldFacts: null })).toBe(plain);
        expect(buildRetrievedMemoriesBlock(rows, { worldFacts: [] })).toBe(plain);
        expect(buildRetrievedMemoriesBlock(rows, { worldFacts: [facts[1], facts[2]] })).toBe(plain);
        expect(buildRetrievedMemoriesBlock(rows, { worldFacts: [{ ...facts[0], retractedAtMessage: 31 }, facts[1]] })).toBe(plain);
        expect(buildRetrievedMemoriesBlock(rows, { worldFacts: [facts[0]] })).toBe(plain);
        expect(buildRetrievedMemoriesBlock(rows, { worldFacts: [null, 'junk', { id: 'x', fact: 7, supersededBy: 'y' }, { id: 'y', fact: 'y' }] })).toBe(plain);
        expect(STALE_ROW_CONTAINMENT).toBe(0.8);
        // A row sharing fewer than 80 % of the fact's tokens is not a restatement.
        expect(buildRetrievedMemoriesBlock([{ text: 'A bridge somewhere was passable once.', category: 'journal' }], { worldFacts: facts })).not.toContain('since changed');
    });

    it('the tag counts toward the row max and the ceiling: a tagged row never exceeds RETRIEVED_MEMORY_ROW_MAX of text + tag, and the ceiling holds', () => {
        const long = `The bridge at Ashford is passable. ${'Filler sentence about the market. '.repeat(40)}`;
        const one = buildRetrievedMemoriesBlock([{ text: long, category: 'journal' }], { worldFacts: facts });
        const line = one.split('\n').find(l => l.startsWith('- ['));
        expect(line).toContain(tag);
        expect(line.length - '- [journal] '.length).toBeLessThanOrEqual(RETRIEVED_MEMORY_ROW_MAX);

        const rows = Array.from({ length: 16 }, () => ({ text: long, category: 'journal' }));
        const block = buildRetrievedMemoriesBlock(rows, { worldFacts: facts });
        const lines = block.split('\n').filter(l => l.startsWith('- ['));
        const used = lines.filter(l => !l.startsWith('- (+')).reduce((sum, l) => sum + l.length + 1, 0);
        expect(used).toBeLessThanOrEqual(RETRIEVED_MEMORIES_CHAR_CEILING);
        expect(block).toMatch(/\(\+\d+ more relevant memories omitted for length\)/);
    });
});
