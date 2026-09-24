import { describe, expect, it } from 'vitest';
import { buildPresenceText, collectNarrativeEntries, collectNarrativeMessages, findLatestNarration } from './narrativeMessages.js';

const messages = [
    { id: 'a', role: 'system', content: 'Your tale begins.' },
    { id: 'b', role: 'user', content: 'I enter the tavern.' },
    { id: 'c', role: 'assistant', content: 'The tavern is loud.' },
    { id: 'd', role: 'user', content: 'DM: what was the innkeeper called?' },
    { id: 'e', role: 'assistant', content: 'At the table: Odo.' },
    { id: 'f', role: 'assistant', content: 'You rummage…', hidden: true },
    { id: 'g', role: 'assistant', content: 'I cannot continue.', deleted: true },
    { id: 'h', role: 'assistant', content: '   ' },
    { id: 'i', role: 'system', kind: 'error', content: 'Error resolving check: Failed to fetch' },
];

describe('THE narrative-eligibility predicate (2026-09-01 P1)', () => {
    it('drops infrastructure error lines (kind: "error") — "Failed to fetch" is not play (2026-09-04 audit)', () => {
        expect(collectNarrativeMessages(messages).some(m => m.kind === 'error')).toBe(false);
        // An ordinary table record (a dice line) without the stamp still counts.
        expect(collectNarrativeMessages([{ role: 'system', content: 'Astra rolled **17**.' }])).toHaveLength(1);
    });

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

    it('tracks the table-talk pairing from the transcript start, so a span opening on the DM reply still skips it (2026-09-06 journal batch)', () => {
        const span = [
            { id: 'ooc', role: 'user', content: 'OOC: recap please' },
            { id: 'reply', role: 'assistant', content: 'At the table: you were at the gate.' },
            { id: 'act', role: 'user', content: 'I push the gate open.' },
        ];
        expect(collectNarrativeMessages(span, 1).map(m => m.id)).toEqual(['act']);
        expect(collectNarrativeEntries(span, 1, 2).map(e => e.index)).toEqual([2]);
    });
});

describe('kind: "record" receipt lines (recall dossier, 2026-09-18)', () => {
    it('are bookkeeping, never story: excluded like error lines', () => {
        const messages = [
            { role: 'user', content: 'Saima, remember the ghouls?' },
            { role: 'system', kind: 'record', content: '📜 From the record for Saima Aallotar: 1 journal entry.' },
            { role: 'assistant', content: '"I remember," she says.' },
        ];
        expect(collectNarrativeMessages(messages).map(m => m.content)).toEqual([
            'Saima, remember the ghouls?',
            '"I remember," she says.',
        ]);
        expect(buildPresenceText(messages)).not.toContain('📜');
    });
});

describe('combat-exchange dice lines (`exchangeLine`, 2026-09-23 combat-exchange P1)', () => {
    const fight = [
        { id: 'u1', role: 'user', content: 'I attack the bandit.' },
        { id: 'x1', role: 'system', exchangeLine: true, content: '**Oda attacks Marsh bandit 4** — Rolled **20** vs AC 13; **Hit for 9 damage.** Marsh bandit 4 remains alive at 25/34 HP.' },
        { id: 'x2', role: 'system', exchangeLine: true, content: '**Marsh bandit 4 attacks Oda** — Rolled **7** vs AC 17; **Miss.**' },
        { id: 'x3', role: 'system', exchangeLine: true, content: '**Torvald attacks Marsh bandit 4** — Rolled **12** vs AC 13; **Miss.**' },
        { id: 'a1', role: 'assistant', content: 'Reeve Halvard shouts from the bank as steel rings in the reeds.' },
    ];

    it('are not narrative — out of collectNarrativeEntries — while an out-of-combat roll line keeps its seat', () => {
        expect(collectNarrativeEntries(fight).map(e => [e.message.id, e.index])).toEqual([['u1', 0], ['a1', 4]]);
        expect(collectNarrativeMessages([{ role: 'system', content: 'Stealth (DC 12): Rolled **14** — Success!' }])).toHaveLength(1);
    });

    it('never judge presence: after a commit the scene text is the prose around the dice, not the last three roll lines', () => {
        // The player's line, then three dice lines — the commit, before narration.
        expect(buildPresenceText(fight.slice(0, 4))).toBe('I attack the bandit.');
        expect(buildPresenceText(fight)).not.toContain('Rolled **');
        expect(buildPresenceText(fight)).toContain('Reeve Halvard');
    });
});
