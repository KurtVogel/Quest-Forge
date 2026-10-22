/**
 * The 2026-10-22 strengthening queue, Scribe half: the cadence reflection
 * never stamps a sighting (`_seen: false`), the classifier gate reads the
 * roster so a creature-tagged roster character still updates, the facts /
 * cards caps count ACCEPTED rows, the location gate reads the narration
 * alone, a narrated keepsake leaves the pack, and the two templates carry no
 * trust literal.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SCRIBE_SYSTEM_PROMPT, buildScribeContext, capAcceptedFacts, capNovelCards, runNpcFrontReflection, runScribe } from './scribe.js';
import { sendMessage } from './adapter.js';
import { dispatchClassifiedNpcUpdate } from '../engine/npcRoster.js';
import { planWorldFactAdditions } from '../engine/worldFacts.js';
import { gameReducer, initialGameState } from '../state/gameReducer.js';

vi.mock('./adapter.js', () => ({ sendMessage: vi.fn() }));
// The live embed lanes are not under test: a queued row would open IndexedDB.
vi.mock('../engine/vectorMemory.js', () => ({
    queueMemoryItem: vi.fn(() => Promise.resolve()),
    factMemoryItem: vi.fn(fact => ({ text: fact.fact })),
}));

const settings = { apiKey: 'test-key', llmProvider: 'gemini' };
const turns = n => Array.from({ length: n * 2 }, (_, i) => ({ id: `m${i}`, role: i % 2 ? 'assistant' : 'user', content: `line ${i}` }));
const rarg = { id: 'npc-rarg', name: 'Rarg', rosterTier: 'character', kind: 'character', disposition: 'hostile', trust: 72, stanceToPlayer: 'Hates the hero for the marsh.', lastSeenMessage: 2, bondMoments: [] };
const actionsOf = dispatch => dispatch.mock.calls.map(([action]) => action);

beforeEach(() => sendMessage.mockReset());

describe('the cadence reflection writes the off-screen — never a sighting (P1)', () => {
    it('its npc_updates dispatch with _seen: false, and the record\'s lastSeenMessage is untouched through the reducer', async () => {
        sendMessage.mockResolvedValue(JSON.stringify({
            npc_updates: [{ name: 'Rarg', agenda: 'Gathering goblins in the marsh.' }],
            front_advances: [], story_memory: [],
        }));
        const dispatch = vi.fn();
        const state = {
            ...initialGameState, settings, session: { id: 'campaign' }, npcs: [rarg], fronts: [], journal: [], worldFacts: [], party: [],
            messages: turns(20), currentLocation: 'The Weirs',
        };
        await runNpcFrontReflection({ state, dispatch, cadence: { id: 'journal-campaign-40', journalEnd: 40, summary: 'Quiet days.' } });
        const update = actionsOf(dispatch).find(a => a.type === 'UPDATE_NPC');
        expect(update.payload).toMatchObject({ name: 'Rarg', agenda: 'Gathering goblins in the marsh.', _seen: false });
        expect(update.payload.kind).toBe('character');

        const next = gameReducer(state, update);
        expect(next.npcs[0].agenda).toBe('Gathering goblins in the marsh.');
        expect(next.npcs[0].lastSeenMessage).toBe(2);
        // The reflection template carries no trust literal to echo.
        expect(sendMessage.mock.calls[0][0].systemPrompt).not.toMatch(/"trust": \d/);
    });
});

describe('the classifier gate reads the roster (P1)', () => {
    const laneMeta = { presenceText: 'Rarg fled into the marsh with the last of his goblins.' };

    it('dispatchClassifiedNpcUpdate: a roster character tagged creature still dispatches (as a character); a new creature does not', () => {
        const dispatch = vi.fn();
        const update = { name: 'Rarg', kind: 'creature', rosterEligible: false, lastNotes: 'Rarg fled into the marsh.', openThreadResolved: true };
        expect(dispatchClassifiedNpcUpdate(dispatch, update, laneMeta)).toBe(false); // without the roster: the old gate
        expect(dispatchClassifiedNpcUpdate(dispatch, update, laneMeta, { npcs: [rarg], messageCount: 40 })).toBe(true);
        expect(dispatch.mock.calls[0][0].payload).toMatchObject({ name: 'Rarg', kind: 'character', lastNotes: 'Rarg fled into the marsh.' });
        expect(dispatchClassifiedNpcUpdate(dispatch, { name: 'Marsh goblin', kind: 'creature', rosterEligible: false, lastNotes: 'Ran.' }, laneMeta, { npcs: [rarg], messageCount: 40 })).toBe(false);
        expect(dispatch).toHaveBeenCalledTimes(1);
    });

    it('end to end through runScribe with the context\'s roster: the named foe\'s record keeps updating on a fight turn', async () => {
        sendMessage.mockResolvedValue(JSON.stringify({
            world_facts: [],
            npc_updates: [{ name: 'Rarg', kind: 'creature', rosterEligible: false, lastNotes: 'Rarg fled into the marsh.' }],
        }));
        const dispatch = vi.fn();
        const state = { ...initialGameState, npcs: [rarg], messages: turns(20) };
        await runScribe({
            playerMessage: 'Combat exchange', dmNarrative: 'Rarg fled into the marsh with the last of his goblins.',
            settings, dispatch, ...buildScribeContext(state, 'Rarg fled into the marsh with the last of his goblins.'),
        });
        const update = actionsOf(dispatch).find(a => a.type === 'UPDATE_NPC');
        expect(update.payload).toMatchObject({ name: 'Rarg', kind: 'character', lastNotes: 'Rarg fled into the marsh.' });
        expect(gameReducer(state, update).npcs[0].lastNotes).toBe('Rarg fled into the marsh.');
    });
});

describe('the caps count ACCEPTED rows (P2)', () => {
    const record = [
        { id: 'f-1', fact: 'The mill wheel turns though the river is dry.', atMessage: 1 },
        { id: 'f-2', fact: 'The baron holds the harbor ledgers under seal.', atMessage: 2 },
        { id: 'f-3', fact: 'Tammo runs the only ferry across the Weirs.', atMessage: 3 },
    ];
    const restated = record.map(f => ({ fact: f.fact, category: 'lore' }));
    const novel = ['The Weirs ferry sank with the tithe chest aboard.', 'The chandlery burned on the night of the levy.', 'Old Hesk keeps the key to the tithe barn.', 'The Coast Road is closed past the ford.'];

    it('capAcceptedFacts: restatements ride free and the first three NOVEL facts are kept', () => {
        const candidates = [...restated, ...novel.map(fact => ({ fact }))];
        const plan = planWorldFactAdditions(record, candidates, { messageCount: 40 });
        const kept = capAcceptedFacts(candidates, plan);
        expect(kept.map(f => f.fact)).toEqual([...restated.map(f => f.fact), ...novel.slice(0, 3)]);
    });

    it('three restatements + one new fact: the new fact lands (it used to be cut before the dedupe)', async () => {
        sendMessage.mockResolvedValue(JSON.stringify({ world_facts: [...restated, { fact: novel[0], category: 'event' }] }));
        const dispatch = vi.fn();
        const state = { ...initialGameState, worldFacts: record, messages: turns(20) };
        await runScribe({ playerMessage: 'I ask about the ferry.', dmNarrative: 'The ferry sank with the tithe chest.', settings, dispatch, ...buildScribeContext(state, 'x') });
        const facts = actionsOf(dispatch).find(a => a.type === 'ADD_WORLD_FACTS');
        expect(facts.payload.map(f => f.fact)).toContain(novel[0]);
        const next = gameReducer(state, facts);
        expect(next.worldFacts).toHaveLength(4);
        expect(next.worldFacts[3].fact).toBe(novel[0]);
    });

    it('capNovelCards: a re-report of a card on record rides free beside three new cards; four new cards are three', () => {
        const pool = [{ id: 'card-1', type: 'promise', status: 'active', subject: 'the blue ribbon', text: 'Mira promised a blue ribbon on the well road if it turned unsafe.' }];
        const fresh = i => ({ type: 'mystery', subject: `riddle ${i}`, text: `Nobody knows who rang the chapel bell on night ${i}.` });
        const kept = capNovelCards([{ id: 'card-1', type: 'promise', subject: 'the blue ribbon', text: 'Mira promised the ribbon again.' }, fresh(1), fresh(2), fresh(3)], pool);
        expect(kept).toHaveLength(4);
        expect(capNovelCards([fresh(1), fresh(2), fresh(3), fresh(4)], pool).map(c => c.subject)).toEqual(['riddle 1', 'riddle 2', 'riddle 3']);
        // A subject + type match is a merge too (the reducer's own matcher).
        expect(capNovelCards([{ type: 'promise', subject: 'the blue ribbon', text: 'Another wording.' }, fresh(1), fresh(2), fresh(3)], pool)).toHaveLength(4);
    });
});

describe('the location gate reads the narration alone (P2)', () => {
    const extraction = { world_facts: [], location: 'Rimehollow' };
    it('a place only the player\'s line names does not relocate the hero; the DM\'s arrival does', async () => {
        sendMessage.mockResolvedValue(JSON.stringify(extraction));
        const stayed = vi.fn();
        await runScribe({ playerMessage: 'I pack up and set out for Rimehollow.', dmNarrative: 'The road is a day\'s walk; Tammo waves you off from the ferry.', settings, dispatch: stayed });
        expect(actionsOf(stayed).some(a => a.type === 'SET_LOCATION')).toBe(false);

        sendMessage.mockResolvedValue(JSON.stringify(extraction));
        const arrived = vi.fn();
        await runScribe({ playerMessage: 'I pack up and set out for Rimehollow.', dmNarrative: 'By dusk you reach Rimehollow, its one street lit.', settings, dispatch: arrived });
        const set = actionsOf(arrived).find(a => a.type === 'SET_LOCATION');
        expect(typeof set.payload === 'string' ? set.payload : set.payload?.name).toBe('Rimehollow');
    });
});

describe('a narrated keepsake leaves the pack (P2)', () => {
    const audit = inventory => ({
        sourceId: 'msg-9:scribe-loot', appliedEvents: null,
        getState: () => ({ party: [{ id: 'jorun', name: 'Jorun', status: 'healthy', ac: 12, weapon: 'Club' }], inventory, appliedLootSourceIds: [] }),
    });
    const extraction = { world_facts: [], missing_gear_handoffs: [{ companion: 'Jorun', item: "Mother's locket", kind: 'keepsake' }] };

    it('an owned keepsake is removed by name beside the companion\'s keepsake entry; an unowned one only lands as a keepsake', async () => {
        sendMessage.mockResolvedValue(JSON.stringify(extraction));
        const owned = vi.fn();
        await runScribe({
            playerMessage: 'I give Jorun my mother\'s locket.', dmNarrative: 'Jorun closes his hand around the locket.',
            settings, dispatch: owned, lootAudit: audit([{ id: 'locket', name: "Mother's locket", type: 'gear', quantity: 1 }]),
        });
        expect(actionsOf(owned)).toContainEqual({ type: 'REMOVE_ITEM_BY_NAME', payload: "Mother's locket" });
        expect(actionsOf(owned)).toContainEqual({ type: 'UPDATE_COMPANION', payload: { id: 'jorun', keepsake: "Mother's locket" } });

        sendMessage.mockResolvedValue(JSON.stringify(extraction));
        const unowned = vi.fn();
        await runScribe({
            playerMessage: 'I give Jorun the locket I found.', dmNarrative: 'Jorun closes his hand around the locket.',
            settings, dispatch: unowned, lootAudit: audit([]),
        });
        expect(actionsOf(unowned).some(a => a.type === 'REMOVE_ITEM_BY_NAME')).toBe(false);
        expect(actionsOf(unowned)).toContainEqual({ type: 'UPDATE_COMPANION', payload: { id: 'jorun', keepsake: "Mother's locket" } });
    });
});

describe('a schema placeholder is a sample reply (P2)', () => {
    it('the Scribe template carries no trust literal; the three flags are spelled as prose the readers fold', () => {
        expect(SCRIBE_SYSTEM_PROMPT).not.toMatch(/"trust": \d/);
        expect(SCRIBE_SYSTEM_PROMPT).toContain('"trust": "a number 0-100 ONLY when');
    });
});
