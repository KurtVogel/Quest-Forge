/**
 * Strengthening queue 2026-10-26 (the cadence's rule, one lane over): the
 * per-turn Scribe's writes carry the campaign the pass READ when its context
 * names it, so a load between the read and the Flash reply drops them at the
 * dispatcher instead of landing them in the campaign Continued.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { sendMessage } from './adapter.js';
import { buildScribeContext, runScribe } from './scribe.js';
import { gameReducer, initialGameState } from '../state/gameReducer.js';

vi.mock('./adapter.js', () => ({ sendMessage: vi.fn() }));
vi.mock('../engine/vectorMemory.js', () => ({
    queueMemoryItem: vi.fn(() => Promise.resolve()),
    factMemoryItem: vi.fn(fact => ({ text: fact.fact })),
}));

const settings = { apiKey: 'test-key', llmProvider: 'gemini' };
const turns = n => Array.from({ length: n * 2 }, (_, i) => ({ id: `m${i}`, role: i % 2 ? 'assistant' : 'user', content: `line ${i}` }));
const actionsOf = dispatch => dispatch.mock.calls.map(([action]) => action);

beforeEach(() => sendMessage.mockReset());

describe('runScribe stamps its writes with the campaign it read', () => {
    it('every dispatch carries meta.sessionId / loadNonce from buildScribeContext, beside the source stamp', async () => {
        sendMessage.mockResolvedValue(JSON.stringify({
            world_facts: [{ fact: 'The Weirs ferry sank with the tithe chest aboard.', category: 'event' }],
            npc_updates: [{ name: 'Tammo', lastNotes: 'Lost his ferry.' }],
        }));
        const dispatch = vi.fn();
        const state = { ...initialGameState, session: { ...initialGameState.session, id: 'campaign-a', loadNonce: 3 }, npcs: [{ id: 'npc-tammo', name: 'Tammo', rosterTier: 'character', kind: 'character', bondMoments: [] }], messages: turns(10) };
        await runScribe({
            playerMessage: 'I ask about the ferry.', dmNarrative: 'Tammo tells you the ferry sank with the tithe chest.',
            settings, dispatch, sourceMessageId: 'm19', ...buildScribeContext(state, 'Tammo tells you the ferry sank with the tithe chest.'),
        });
        const actions = actionsOf(dispatch);
        expect(actions.length).toBeGreaterThan(0);
        for (const action of actions) {
            expect(action.meta, action.type).toMatchObject({ sessionId: 'campaign-a', loadNonce: 3 });
        }
        expect(actions.find(a => a.type === 'ADD_WORLD_FACTS').meta.sourceMessage).toBe('m19');
        // Through the dispatcher: the stamped writes land on the campaign they read…
        const landed = actions.reduce((s, a) => gameReducer(s, a), state);
        expect(landed.worldFacts.map(f => f.fact)).toEqual(['The Weirs ferry sank with the tithe chest aboard.']);
        // …and are dropped on a campaign loaded meanwhile.
        const other = { ...state, session: { ...state.session, id: 'campaign-b', loadNonce: 4 }, worldFacts: [] };
        expect(actions.reduce((s, a) => gameReducer(s, a), other)).toBe(other);
    });

    it('a caller without a campaign in its context keeps the raw dispatch (no stamp invented)', async () => {
        sendMessage.mockResolvedValue(JSON.stringify({ world_facts: [{ fact: 'The chandlery burned on the night of the levy.' }] }));
        const dispatch = vi.fn();
        await runScribe({ playerMessage: 'I look at the chandlery.', dmNarrative: 'The chandlery burned on the night of the levy.', settings, dispatch });
        const facts = actionsOf(dispatch).find(a => a.type === 'ADD_WORLD_FACTS');
        expect(facts).toBeDefined();
        expect(facts.meta?.sessionId).toBeUndefined();
    });
});
