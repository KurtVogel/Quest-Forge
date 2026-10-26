/**
 * Strengthening queue 2026-10-26 (memory-journal, Lap 1): the cadence is a
 * campaign-STAMPED lane whose writes are RECORDED — a load between the read
 * and the Flash reply drops every write at the dispatcher (P1), the
 * post-journal verifier diffs the lane's replayed writes instead of the live
 * state (P2, the settled rule retired), a span has one journal row (nit).
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

const { KEEP_TAIL, maybeAutoSummarize, resetSummarizeFailureTracker } = await import('./worldJournal.js');
const { gameReducer, initialGameState } = await import('../state/gameReducer.js');

const settings = { apiKey: 'k', llmProvider: 'gemini' };
const rows = (count, prefix = 'm') => Array.from({ length: count }, (_, i) => ({
    id: `${prefix}-${i}`, role: i % 2 === 0 ? 'user' : 'assistant', content: `${prefix} line ${i}`,
}));
/** `count` summarizable rows followed by the kept tail: the batch is rows [0, count). */
const backlog = (count) => [...rows(count), ...rows(KEEP_TAIL, 'tail')];
const campaign = (id, loadNonce, extra = {}) => ({
    ...initialGameState,
    settings,
    session: { ...initialGameState.session, id, loadNonce },
    messages: backlog(12),
    journal: [],
    worldFacts: [],
    npcs: [],
    quests: [],
    currentLocation: null,
    ...extra,
});
const summary = (extra = {}) => JSON.stringify({
    summary: 'Orsa was hanged at the Toll Pike after the ledger came to light.',
    npcs_encountered: [],
    location: 'Toll Pike',
    key_decisions: ['The hero gave the ledger to the reeve'],
    consequences: ['The Pike has no factor'],
    world_facts: [{ fact: 'The Toll Pike has no factor since Orsa hanged.', category: 'event' }],
    ...extra,
});
const flush = () => new Promise(resolve => setTimeout(resolve, 0));

beforeEach(() => {
    sendMessageMock.mockReset();
    reflectionMock.mockReset();
    reflectionMock.mockResolvedValue(undefined);
    backgroundConfigMock.mockReset();
    backgroundConfigMock.mockReturnValue({ apiKey: 'k', provider: 'gemini', model: 'flash' });
    resetSummarizeFailureTracker();
});

describe('a cadence in flight when another campaign is loaded writes NOTHING into it (P1)', () => {
    it('every cadence dispatch carries the campaign it read; the dispatcher drops them all once campaign B is live', async () => {
        const stateA = campaign('campaign-a', 1);
        let live = stateA;
        const dispatch = vi.fn(action => { live = gameReducer(live, action); });
        sendMessageMock.mockImplementation(async () => {
            // The player ended the turn and Continued another save while
            // Flash was summarizing: campaign B is live, 60 rows, nothing
            // summarized, no location yet.
            live = campaign('campaign-b', 2, { messages: rows(60, 'b') });
            return summary();
        });

        const result = await maybeAutoSummarize(stateA, dispatch, 0);
        await flush();

        expect(result.index).toBe(12);
        expect(dispatch.mock.calls.length).toBeGreaterThanOrEqual(4);
        for (const [action] of dispatch.mock.calls) {
            expect(action.meta).toMatchObject({ sessionId: 'campaign-a', loadNonce: 1 });
        }
        // Campaign B is untouched: no foreign entry, no row flagged
        // summarized, no pruned count, no foreign fact, no location filled.
        expect(live.session.id).toBe('campaign-b');
        expect(live.journal).toEqual([]);
        expect(live.messages).toHaveLength(60);
        expect(live.messages.some(m => m.summarized)).toBe(false);
        expect(live.session.prunedMessageCount || 0).toBe(0);
        expect(live.worldFacts).toEqual([]);
        expect(live.currentLocation).toBeNull();
    });

    it('the same campaign, still live: the entry, the mark, the fact and the filled location all land (the stamp is not a gate on the happy path)', async () => {
        const stateA = campaign('campaign-a', 1);
        let live = stateA;
        const dispatch = vi.fn(action => { live = gameReducer(live, action); });
        sendMessageMock.mockResolvedValue(summary());

        await maybeAutoSummarize(stateA, dispatch, 0);
        await flush();

        expect(live.journal).toHaveLength(1);
        expect(live.journal[0].messageRange).toEqual([0, 12]);
        expect(live.messages.slice(0, 12).every(m => m.summarized)).toBe(true);
        expect(live.messages.slice(12).some(m => m.summarized)).toBe(false);
        expect(live.session.prunedMessageCount).toBe(12);
        expect(live.worldFacts.map(f => f.fact)).toEqual(['The Toll Pike has no factor since Orsa hanged.']);
        expect(live.currentLocation).toBe('Toll Pike');
    });

    it('the reflection\'s writes ride the same stamped dispatch', async () => {
        const stateA = campaign('campaign-a', 1);
        const dispatch = vi.fn();
        sendMessageMock.mockResolvedValue(summary());
        reflectionMock.mockImplementation(async ({ dispatch: lane }) => {
            lane({ type: 'UPDATE_NPC', payload: { name: 'Orsa', agenda: 'Dead.' }, meta: { presenceText: 'Orsa' } });
        });
        await maybeAutoSummarize(stateA, dispatch, 0);
        await flush();
        const update = dispatch.mock.calls.map(([a]) => a).find(a => a.type === 'UPDATE_NPC');
        expect(update.meta).toEqual({ sessionId: 'campaign-a', loadNonce: 1, presenceText: 'Orsa' });
    });
});

describe('the dispatcher judges a campaign stamp ONCE, for every handler', () => {
    const stale = { sessionId: 'campaign-a', loadNonce: 1 };
    const live = campaign('campaign-b', 2, { messages: rows(20, 'b') });

    it.each([
        ['MARK_MESSAGES_SUMMARIZED', 5],
        ['ADD_JOURNAL_ENTRY', { summary: 'Foreign.', messageRange: [0, 5] }],
        ['ADD_WORLD_FACTS', [{ fact: 'A foreign truth about the Pike.' }]],
        ['SET_LOCATION', { name: 'Toll Pike', fillOnly: true }],
        ['ADD_STORY_MEMORY_CARDS', [{ type: 'promise', subject: 'Orsa', text: 'The ledger vow.' }]],
        ['ADD_MESSAGE', { role: 'system', kind: 'error', content: '📓 Journal check — foreign.' }],
    ])('%s with a stale stamp is dropped, the same action with the live stamp or no stamp lands', (type, payload) => {
        expect(gameReducer(live, { type, payload, meta: stale })).toBe(live);
        expect(gameReducer(live, { type, payload, meta: { sessionId: 'campaign-b', loadNonce: 2 } })).not.toBe(live);
        expect(gameReducer(live, { type, payload })).not.toBe(live);
    });

    it('a stale stamp from an earlier LOAD of the same campaign is stale too; a stamp-less meta is not a stamp', () => {
        expect(gameReducer(live, { type: 'MARK_MESSAGES_SUMMARIZED', payload: 5, meta: { sessionId: 'campaign-b', loadNonce: 1 } })).toBe(live);
        expect(gameReducer(live, { type: 'MARK_MESSAGES_SUMMARIZED', payload: 5, meta: { presenceText: 'x', sourceMessage: 'm-1' } })).not.toBe(live);
    });

    it('ADD_CHRONICLE_CHAPTER keeps answering a stale stamp itself — the visible 📜 line, not a silent drop', () => {
        const next = gameReducer(live, { type: 'ADD_CHRONICLE_CHAPTER', payload: { title: 'Lost', text: 'Prose.', fromIndex: 0, toIndex: 10 }, meta: stale });
        expect(next).not.toBe(live);
        expect(next.chronicle || []).toEqual(live.chronicle || []);
        expect(next.messages.at(-1)).toMatchObject({ role: 'system', kind: 'error' });
        expect(next.messages.at(-1).content).toContain('📜');
    });
});

describe('the post-journal verifier diffs the LANE\'s replayed writes, never the live state (P2)', () => {
    const orsa = { id: 'npc-orsa', name: 'Orsa', rosterTier: 'character', kind: 'character', openThread: 'The ledger is still owed.', openThreadMessage: 3, bondMoments: [] };
    const base = () => campaign('campaign-a', 1, {
        npcs: [orsa],
        quests: [{ id: 'q1', name: 'Find the wardens', status: 'active', openedAtMessage: 2 }],
        worldFacts: [{ id: 'f-pin', fact: 'The Toll Pike is broken: its factor Orsa hanged.', pinned: true, atMessage: 4 }],
    });

    it('a thread the REFLECTION settled is reported; a quest PLAY completed between the snapshot and the diff is not', async () => {
        const stateA = base();
        let live = stateA;
        const dispatch = vi.fn(action => { live = gameReducer(live, action); });
        sendMessageMock.mockImplementation(async () => {
            // Play goes on under the Flash call: the DM's next reply completes
            // the quest (a live write, not the lane's).
            live = gameReducer(live, { type: 'COMPLETE_QUEST', payload: { id: 'q1', name: 'Find the wardens' } });
            return summary({ world_facts: [] });
        });
        reflectionMock.mockImplementation(async ({ dispatch: lane }) => {
            lane({ type: 'UPDATE_NPC', payload: { id: 'npc-orsa', name: 'Orsa', openThreadResolved: true, _seen: false }, meta: { presenceText: 'Orsa' } });
        });

        await maybeAutoSummarize(stateA, dispatch, 0);
        await flush();

        const lines = dispatch.mock.calls.map(([a]) => a).filter(a => a.type === 'ADD_MESSAGE' && a.payload?.content?.includes('📓 Journal check'));
        expect(lines).toHaveLength(1);
        expect(lines[0].payload.content).toContain('the open thread with "Orsa"');
        expect(lines[0].payload.content).not.toContain('quest');
        expect(lines[0].payload.content).not.toContain('pinned fact');
        // The live state shows both: the thread the lane closed and the quest play closed.
        expect(live.npcs.find(n => n.id === 'npc-orsa').openThread).toBe('');
        expect(live.quests.find(q => q.id === 'q1').status).toBe('completed');
    });

    it('a cadence whose writes keep every commitment posts no line — even when play moved everything meanwhile', async () => {
        const stateA = base();
        let live = stateA;
        const dispatch = vi.fn(action => { live = gameReducer(live, action); });
        sendMessageMock.mockImplementation(async () => {
            live = gameReducer(live, { type: 'COMPLETE_QUEST', payload: { id: 'q1', name: 'Find the wardens' } });
            live = gameReducer(live, { type: 'UPDATE_NPC', payload: { id: 'npc-orsa', name: 'Orsa', openThreadResolved: true }, meta: { presenceText: 'Orsa' } });
            return summary({ world_facts: [] });
        });
        await maybeAutoSummarize(stateA, dispatch, 0);
        await flush();
        expect(dispatch.mock.calls.map(([a]) => a).some(a => a.type === 'ADD_MESSAGE' && a.payload?.content?.includes('📓'))).toBe(false);
    });

    it('the summary\'s own FLIP of the pinned fact is reported (the lane negated a front\'s resolution)', async () => {
        const stateA = base();
        const dispatch = vi.fn();
        sendMessageMock.mockResolvedValue(summary({ world_facts: [{ fact: 'The Toll Pike is not broken: its factor Orsa was not hanged.', category: 'event' }] }));
        await maybeAutoSummarize(stateA, dispatch, 0);
        await flush();
        const line = dispatch.mock.calls.map(([a]) => a).find(a => a.type === 'ADD_MESSAGE' && a.payload?.content?.includes('📓'));
        expect(line).toBeDefined();
        expect(line.payload.content).toContain('the pinned fact');
    });

    it('a snapshot with nothing to lose runs no replay and posts no line', async () => {
        const stateA = campaign('campaign-a', 1);
        const dispatch = vi.fn();
        sendMessageMock.mockResolvedValue(summary());
        await maybeAutoSummarize(stateA, dispatch, 0);
        await flush();
        expect(dispatch.mock.calls.map(([a]) => a).some(a => a.type === 'ADD_MESSAGE')).toBe(false);
    });
});

describe('a span has ONE journal row (nit)', () => {
    it('a second entry over the same messageRange is refused; a different span lands', () => {
        const state = campaign('campaign-a', 1, { messages: rows(40, 'a') });
        const first = gameReducer(state, { type: 'ADD_JOURNAL_ENTRY', payload: { summary: 'First.', messageRange: [0, 12] } });
        expect(first.journal).toHaveLength(1);
        const echo = gameReducer(first, { type: 'ADD_JOURNAL_ENTRY', payload: { summary: 'The same cadence, committed twice.', messageRange: [0, 12] } });
        expect(echo).toBe(first);
        const next = gameReducer(first, { type: 'ADD_JOURNAL_ENTRY', payload: { summary: 'Second.', messageRange: [12, 24] } });
        expect(next.journal.map(e => e.summary)).toEqual(['First.', 'Second.']);
    });

    it('a fallback stub and a real entry over one span are one cadence — the stub stands', () => {
        const state = campaign('campaign-a', 1, { messages: rows(40, 'a') });
        const stub = gameReducer(state, { type: 'ADD_JOURNAL_ENTRY', payload: { summary: '(Auto-summary was unavailable…)', messageRange: [0, 12], fallback: true } });
        expect(gameReducer(stub, { type: 'ADD_JOURNAL_ENTRY', payload: { summary: 'Late.', messageRange: [0, 12] } })).toBe(stub);
    });
});
