/**
 * Queue sweep 2026-09-18 — memory-journal Lap-2 pins: the entry/mark PAIRING
 * (a throw after the entry can never un-mark it), non-object
 * `npcs_encountered` elements, a role-less batch message, and the unbounded
 * Flash `location`.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { sendMessageMock, backgroundConfigMock, reflectionMock } = vi.hoisted(() => ({
    sendMessageMock: vi.fn(),
    backgroundConfigMock: vi.fn(),
    reflectionMock: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../llm/adapter.js', () => ({ sendMessage: sendMessageMock }));
vi.mock('../llm/machinery.js', () => ({ getBackgroundConfig: backgroundConfigMock }));
vi.mock('../llm/scribe.js', () => ({ runNpcFrontReflection: reflectionMock }));

const { buildJournalContext, maybeAutoSummarize, normalizeJournalSummary, resetSummarizeFailureTracker } = await import('./worldJournal.js');

const makeMessages = (count) => Array.from({ length: count }, (_, i) => ({
    id: `m-${i}`, role: i % 2 === 0 ? 'user' : 'assistant', content: `Message ${i}`,
}));

const makeState = (messages) => ({
    messages,
    settings: { apiKey: 'k', llmProvider: 'gemini' },
    currentLocation: 'Brackwater',
    session: { id: 'session-1' },
});

const summaryJson = (extra = {}) => JSON.stringify({
    summary: 'The hero reached Brackwater and made enemies at the toll gate.',
    npcs_encountered: [],
    location: 'Brackwater',
    key_decisions: [],
    consequences: [],
    world_facts: [],
    ...extra,
});

const types = (dispatch) => dispatch.mock.calls.map(([action]) => action.type);

beforeEach(() => {
    sendMessageMock.mockReset();
    reflectionMock.mockClear();
    backgroundConfigMock.mockReset();
    backgroundConfigMock.mockReturnValue({ apiKey: 'k', provider: 'gemini', model: 'flash' });
    resetSummarizeFailureTracker();
});

describe('journal cadence commit order (2026-09-18 P1)', () => {
    it('a null / scalar npcs_encountered element is skipped: ONE entry, the mark lands, healthy neighbours still upsert', async () => {
        sendMessageMock.mockResolvedValue(summaryJson({
            npcs_encountered: [null, 'Reeve', 7, ['x'], { name: 'Reeve Holt', disposition: 'hostile', notes: 'Insulted at the gate' }],
        }));
        const dispatch = vi.fn();
        const result = await maybeAutoSummarize(makeState(makeMessages(12)), dispatch, 0);
        expect(result.index).toBe(12);
        const seen = types(dispatch);
        expect(seen.filter(t => t === 'ADD_JOURNAL_ENTRY')).toHaveLength(1);
        expect(seen.filter(t => t === 'MARK_MESSAGES_SUMMARIZED')).toHaveLength(1);
        const npcActions = dispatch.mock.calls.map(([a]) => a).filter(a => /NPC/.test(a.type));
        expect(npcActions).toHaveLength(1);
        expect(JSON.stringify(npcActions[0].payload)).toContain('Reeve Holt');
    });

    it('the mark immediately follows the entry — a throwing secondary dispatch can never un-mark a committed entry', async () => {
        sendMessageMock.mockResolvedValue(summaryJson({
            npcs_encountered: [{ name: 'Reeve Holt' }],
            world_facts: [{ fact: 'The toll doubled.', category: 'event' }],
        }));
        const dispatch = vi.fn((action) => {
            if (/NPC/.test(action.type) || action.type === 'ADD_WORLD_FACTS' || action.type === 'SET_LOCATION') {
                throw new Error(`boom in ${action.type}`);
            }
        });
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const result = await maybeAutoSummarize(makeState(makeMessages(12)), dispatch, 0);
        warn.mockRestore();
        const seen = types(dispatch);
        expect(seen.slice(0, 2)).toEqual(['ADD_JOURNAL_ENTRY', 'MARK_MESSAGES_SUMMARIZED']);
        expect(result.index).toBe(12);
        expect(result.journalEntry?.summary).toMatch(/Brackwater/);
        // The next cadence call has nothing left to re-summarize: no duplicate entry, no second Flash call.
        const again = await maybeAutoSummarize(makeState(makeMessages(12)), dispatch, result.index);
        expect(again).toEqual({ index: 12, journalEntry: null });
        expect(sendMessageMock).toHaveBeenCalledTimes(1);
    });

    it('a role-less / non-string-role message in the batch is labeled, not thrown on — the batch is summarized, not archived', async () => {
        sendMessageMock.mockResolvedValue(summaryJson());
        const messages = makeMessages(12);
        messages[3] = { id: 'm-3', content: 'A line with no role' };
        messages[5] = { id: 'm-5', role: { junk: true }, content: 'A line with an object role' };
        const dispatch = vi.fn();
        const result = await maybeAutoSummarize(makeState(messages), dispatch, 0);
        expect(sendMessageMock).toHaveBeenCalledTimes(1);
        expect(sendMessageMock.mock.calls[0][0].userMessage).toContain('[SYSTEM]: A line with no role');
        expect(result.journalEntry?.fallback).toBeUndefined();
        expect(result.index).toBe(12);
    });
});

describe('journal location is bounded (2026-09-18 P2)', () => {
    it('normalizeJournalSummary clamps the Flash location at the location-name cap', () => {
        const normalized = normalizeJournalSummary({ summary: 'Something happened.', location: `Rimehollow ${'Z'.repeat(100000)}` });
        expect(normalized.location.length).toBeLessThanOrEqual(200);
        expect(normalizeJournalSummary({ summary: 'Something happened.', location: 'null' }).location).toBeNull();
    });

    it('LOCATION TRANSITION HISTORY clamps a stored over-long previous location at render', () => {
        const journal = [
            { summary: 'Left the old place.', location: `Oldtown ${'Q'.repeat(100000)}`, keyDecisions: [], consequences: [] },
            { summary: 'Arrived at the fen.', location: 'Mirefen', keyDecisions: [], consequences: [] },
            { summary: 'Fen day two.', location: 'Mirefen', keyDecisions: [], consequences: [] },
            { summary: 'Fen day three.', location: 'Mirefen', keyDecisions: [], consequences: [] },
            { summary: 'Fen day four.', location: 'Mirefen', keyDecisions: [], consequences: [] },
        ];
        const context = buildJournalContext(journal, [], 'Mirefen');
        expect(context).toContain('LOCATION TRANSITION HISTORY');
        expect(context.length).toBeLessThan(5000);
    });
});

describe('KNOWN NPCs arc line belt (2026-09-18 P1)', () => {
    it('a null / object-from last relationshipHistory entry never throws and never prints [object Object]', () => {
        const npcs = [
            { name: 'Saima', rosterTier: 'character', disposition: 'wary', arcDisposition: 'wary', relationshipHistory: [{ from: 'friendly', to: 'wary' }, null] },
            { name: 'Orvo', rosterTier: 'character', disposition: 'wary', relationshipHistory: [{ from: { x: 1 }, to: 'wary' }] },
            { name: 'Tuuli', rosterTier: 'character', disposition: 'hostile', relationshipHistory: [{ from: 'neutral', to: 'hostile' }] },
        ];
        let context = '';
        expect(() => { context = buildJournalContext([], npcs, 'Mirefen'); }).not.toThrow();
        expect(context).not.toContain('[object Object]');
        expect(context).toContain('relationship: neutral → hostile');
    });
});
