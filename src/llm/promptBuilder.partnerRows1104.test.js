/**
 * Memory-research M1 TRIAL (2026-11-04, D4): a retrieved exchange arrives
 * whole. With `partnerRows` on, a narrative row brings the player line that
 * prompted it and a player row the DM reply that answered it, read from the
 * transcript by `sourceMessage`, as one indented line; a deleted or hidden
 * partner is skipped, a pair retrieved together prints once, both lines
 * count as one row inside the UNMOVED ceiling, and the default (off) leaves
 * the block byte-identical. The gate's flag reader reads false in Node.
 */
import { describe, expect, it } from 'vitest';
import { buildRetrievedMemoriesBlock, findPartnerRow, RETRIEVED_MEMORIES_CHAR_CEILING, RETRIEVED_PARTNER_MAX, RETRIEVED_PARTNER_ROWS, RETRIEVED_PARTNER_SPAN } from './promptBuilder.js';
import { readDebugFlag } from './debugFlags.js';

const messages = [
    { id: 'p1', role: 'user', content: 'I ask the ferryman his price for the crossing.' },
    { id: 'd1', role: 'assistant', content: 'The ferryman names two silver and a favor owed.' },
    { id: 'p2', role: 'user', content: 'I pay him and ask about the far shore.' },
    { id: 's1', role: 'system', kind: 'error', content: 'An infrastructure line.' },
    { id: 'd2', role: 'assistant', content: 'He pockets the coin. "Marsh folk, mostly," he says.' },
    { id: 'p3', role: 'user', content: 'I roll to read his face.' },
    { id: 'd3', role: 'assistant', content: 'Roll Insight.' },
    { id: 'r1', role: 'system', content: 'Insight 14 vs DC 12 — success.' },
    { id: 'd4', role: 'assistant', content: 'He is hiding a grief, not a lie.' },
    { id: 'p4', role: 'user', content: 'Deleted question.', deleted: true },
    { id: 'd5', role: 'assistant', content: 'An answer whose question was removed.' },
];
const row = (text, category, sourceMessage) => ({ text, category, sourceMessage });

describe('a retrieved exchange arrives whole (2026-11-04 M1 trial, off by default)', () => {
    it('the flag is OFF by default and the block is byte-identical without it; the gate reader is false in Node and without debugState', () => {
        expect(RETRIEVED_PARTNER_ROWS).toBe(false);
        const rows = [row('The ferryman names two silver and a favor owed.', 'narrative', 'd1')];
        expect(buildRetrievedMemoriesBlock(rows, { messages })).toBe(buildRetrievedMemoriesBlock(rows, { messages, partnerRows: false }));
        expect(buildRetrievedMemoriesBlock(rows, { messages })).not.toContain('the player had said');
        expect(readDebugFlag('partnerRows')).toBe(false);
        expect(readDebugFlag('partnerRows', '?partnerRows=1')).toBe(false);
        expect(readDebugFlag('partnerRows', '?debugState=1&partnerRows=1')).toBe(true);
        expect(readDebugFlag('partnerRows', '?debugState=1')).toBe(false);
    });

    it('a narrative row brings its player line, a player row its DM reply; a dice turn\'s system rows are skipped within the span', () => {
        expect(findPartnerRow(row('x', 'narrative', 'd1'), messages)?.id).toBe('p1');
        expect(findPartnerRow(row('x', 'player', 'p2'), messages)?.id).toBe('d2');
        expect(findPartnerRow(row('x', 'narrative', 'd4'), messages)?.id).toBe('p3');
        expect(findPartnerRow(row('x', 'journal', 'd1'), messages)).toBeNull();
        expect(findPartnerRow(row('x', 'narrative', 'nope'), messages)).toBeNull();
        expect(findPartnerRow({ text: 'x', category: 'narrative' }, messages)).toBeNull();
        expect(RETRIEVED_PARTNER_SPAN).toBe(6);

        const block = buildRetrievedMemoriesBlock([
            row('The ferryman names two silver and a favor owed.', 'narrative', 'd1'),
            row('I pay him and ask about the far shore.', 'player', 'p2'),
        ], { messages, partnerRows: true });
        expect(block).toContain('- [narrative] The ferryman names two silver and a favor owed.\n  ↳ the player had said: "I ask the ferryman his price for the crossing."');
        expect(block).toContain('- [player statement/attempt — not automatically canon] I pay him and ask about the far shore.\n  ↳ the DM answered: "He pockets the coin. "Marsh folk, mostly," he says."');
    });

    it('a deleted partner is skipped (no line), a pair retrieved together prints once, the partner is clipped', () => {
        const alone = buildRetrievedMemoriesBlock([row('An answer whose question was removed.', 'narrative', 'd5')], { messages, partnerRows: true });
        expect(alone).not.toContain('↳');

        const pair = buildRetrievedMemoriesBlock([
            row('I ask the ferryman his price for the crossing.', 'player', 'p1'),
            row('The ferryman names two silver and a favor owed.', 'narrative', 'd1'),
        ], { messages, partnerRows: true });
        expect(pair).not.toContain('↳');

        const long = [{ id: 'q1', role: 'user', content: 'word '.repeat(80).trim() }, { id: 'a1', role: 'assistant', content: 'Reply.' }];
        const clipped = buildRetrievedMemoriesBlock([row('Reply.', 'narrative', 'a1')], { messages: long, partnerRows: true });
        const partnerLine = clipped.split('\n').find(line => line.startsWith('  ↳'));
        expect(partnerLine.length).toBeLessThanOrEqual(RETRIEVED_PARTNER_MAX + 40);
        expect(partnerLine.endsWith('…"')).toBe(true);
    });

    it('both lines count as one row inside the UNMOVED ceiling — a full block admits fewer rows, never more text', () => {
        expect(RETRIEVED_MEMORIES_CHAR_CEILING).toBe(8000);
        const big = [];
        const rows = [];
        for (let i = 0; i < 40; i += 1) {
            big.push({ id: `u${i}`, role: 'user', content: `Question ${i} ${'q'.repeat(150)}` });
            big.push({ id: `a${i}`, role: 'assistant', content: `Answer ${i} ${'a'.repeat(300)}` });
            rows.push(row(`Answer ${i} ${'a'.repeat(300)}`, 'narrative', `a${i}`));
        }
        const off = buildRetrievedMemoriesBlock(rows, { messages: big });
        const on = buildRetrievedMemoriesBlock(rows, { messages: big, partnerRows: true });
        const count = block => block.split('\n').filter(line => line.startsWith('- [')).length;
        // The ceiling governs the LINES (the header rides outside it, as before): the partner lines are inside it.
        const linesLength = block => block.split('\n').filter(line => line.startsWith('- [') || line.startsWith('  ↳')).join('\n').length;
        expect(linesLength(off)).toBeLessThanOrEqual(RETRIEVED_MEMORIES_CHAR_CEILING);
        expect(linesLength(on)).toBeLessThanOrEqual(RETRIEVED_MEMORIES_CHAR_CEILING);
        expect(on).toContain('↳ the player had said');
        expect(count(on)).toBeLessThan(count(off));
        expect(on).toContain('more relevant memories omitted for length');
    });
});
