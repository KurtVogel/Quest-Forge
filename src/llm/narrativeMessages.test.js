import { describe, expect, it } from 'vitest';
import { collectNarrativeEntries, collectNarrativeMessages, findLatestNarration } from './narrativeMessages.js';

const messages = [
    { id: 'a', role: 'system', content: 'Your tale begins.' },
    { id: 'b', role: 'user', content: 'I enter the tavern.' },
    { id: 'c', role: 'assistant', content: 'The tavern is loud.' },
    { id: 'd', role: 'user', content: 'DM: what was the innkeeper called?' },
    { id: 'e', role: 'assistant', content: 'At the table: Odo.' },
    { id: 'f', role: 'assistant', content: 'You rummage…', hidden: true },
    { id: 'g', role: 'assistant', content: 'I cannot continue.', deleted: true },
    { id: 'h', role: 'assistant', content: '   ' },
];

describe('THE narrative-eligibility predicate (2026-09-01 P1)', () => {
    it('keeps visible play with raw indexes and drops hidden, deleted, blank, and table-talk pairs', () => {
        expect(collectNarrativeEntries(messages).map(e => [e.message.id, e.index]))
            .toEqual([['a', 0], ['b', 1], ['c', 2]]);
        expect(collectNarrativeMessages(messages).map(m => m.id)).toEqual(['a', 'b', 'c']);
    });

    it('honors a span window on raw indexes', () => {
        expect(collectNarrativeMessages(messages, 1, 2).map(m => m.id)).toEqual(['b', 'c']);
    });

    it('a table-talk reply skips only when it immediately follows the table-talk message', () => {
        const withPlayBetween = [
            { id: 'ooc', role: 'user', content: '(OOC) slower pacing please' },
            { id: 'act', role: 'user', content: 'I draw my sword.' },
            { id: 'narr', role: 'assistant', content: 'Steel rasps free.' },
        ];
        expect(collectNarrativeMessages(withPlayBetween).map(m => m.id)).toEqual(['act', 'narr']);
    });

    it('findLatestNarration returns the newest genuine DM narration or null', () => {
        expect(findLatestNarration(messages)?.id).toBe('c');
        expect(findLatestNarration([])).toBeNull();
        expect(findLatestNarration([{ role: 'user', content: 'hello' }])).toBeNull();
        expect(findLatestNarration(undefined)).toBeNull();
    });
});
