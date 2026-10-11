/**
 * The 2026-10-11 strengthening queue, vector-memory half — pins for the row
 * composers (the live lane's text EQUALS the seed's for one record, a fact
 * the record refused is never embedded), the carried Scribe row, the
 * retracted combat narration, addMemory as a batch of one, and the
 * presence tokenizer's new shelf (SCHEDULED_STRENGTHENING.md, the 10-11 audit).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';

globalThis.IDBKeyRange = IDBKeyRange;

const { embedTextMock, embedTextsMock, SCHEMA } = vi.hoisted(() => ({
    embedTextMock: vi.fn(),
    embedTextsMock: vi.fn(),
    SCHEMA: 'gemini-embedding-2:search-retrieval-v1:768',
}));

vi.mock('../llm/providers/gemini.js', () => ({
    embedText: embedTextMock,
    embedTexts: embedTextsMock,
    GEMINI_EMBED_DIMENSIONS: 768,
    GEMINI_EMBED_SCHEMA: SCHEMA,
}));

import {
    addMemory,
    clearMemories,
    factMemoryItem,
    factMemoryText,
    findSubjectsInText as findSubjectsViaMemory,
    flushMemoryQueue,
    getMemoryTexts,
    journalMemoryItem,
    MEMORY_BATCH_WINDOW_MS,
    npcMemoryItem,
    queueMemoryItem,
    retractMemoriesFromMessage,
    sceneMemoryItem,
    seedMemories,
    storyCardMemoryItem,
} from './vectorMemory.js';
import { findSubjectsInText, nameTokensPresent, textWordSet } from './textMatch.js';
import { planWorldFactAdditions, sanitizeWorldFactPayload } from './worldFacts.js';
import { gameReducer, initialGameState } from '../state/gameReducer.js';

function unitVector(index) {
    const vector = Array(768).fill(0);
    vector[index] = 1;
    return vector;
}

beforeEach(async () => {
    vi.useRealTimers();
    globalThis.indexedDB = new IDBFactory();
    embedTextMock.mockReset();
    embedTextsMock.mockReset();
    let n = 1;
    embedTextMock.mockImplementation(async () => unitVector(n++ % 700));
    embedTextsMock.mockImplementation(async (apiKey, texts, options) =>
        Promise.all((texts || []).map(text => embedTextMock(apiKey, text, options))));
    await clearMemories();
});

describe('THE row composers: the live lane composes what the seed composes (P2)', () => {
    const wireShapes = [
        // a public fact with stray whitespace — the record has no tag and a trimmed text
        { fact: '  The ferry runs at dawn.  ', knownBy: 'public', category: 'location' },
        // an over-long fact — the record clamps at 400
        { fact: `The long road ${'winds on and on, '.repeat(60)}to the sea.`, category: 'location' },
        // a secret fact — the tag rides inside the text on both sides
        { fact: 'Orsa poisoned the well.', knownBy: ['Orsa', 'the hero'] },
    ];

    it('for every wire shape, the live lane text EQUALS the seed text of the record row it becomes', () => {
        const state = { ...initialGameState, messages: [{ id: 'u1', role: 'user', content: 'x' }, { id: 'a1', role: 'assistant', content: 'y' }] };
        const next = gameReducer(state, { type: 'ADD_WORLD_FACTS', payload: wireShapes, meta: { sourceMessage: 'a1' } });
        expect(next.worldFacts).toHaveLength(3);
        // The live lane: the same plan over the same captured record.
        const planned = planWorldFactAdditions(state.worldFacts, wireShapes, { messageCount: 2, sourceMessage: 'a1' });
        expect(planned.added).toHaveLength(3);
        const liveTexts = planned.added.map(f => factMemoryItem(f, { location: 'Saltmere', sourceMessage: 'a1' }).text);
        const seedTexts = next.worldFacts.map(f => factMemoryItem(f).text);
        expect(liveTexts).toEqual(seedTexts);
        // And none of them is the wire's own text.
        expect(liveTexts[0]).toBe('The ferry runs at dawn.');
        expect(liveTexts[0]).not.toContain('SECRET');
        expect(liveTexts[1].length).toBeLessThanOrEqual(400);
        expect(liveTexts[2]).toBe('[SECRET — known only to: Orsa, the hero] Orsa poisoned the well.');
        // The record rows carry the DM message that minted them.
        expect(next.worldFacts.every(f => f.sourceMessage === 'a1')).toBe(true);
    });

    it('a fact the record REFUSES is never embedded; an object fact never embeds "undefined"', () => {
        const held = [{ id: 'f1', fact: 'Odo Ferrin is dead, killed at the docks during the smuggler raid.', category: 'event' }];
        const planned = planWorldFactAdditions(held, [
            { fact: 'Odo Ferrin was killed at the docks.' }, // a restatement
            { text: 'The DM wrote the wrong key.' }, // an object without `fact`
            { fact: 'Serah now leads the dockworkers.' },
        ], { messageCount: 4 });
        expect(planned.added.map(f => f.fact)).toEqual(['Serah now leads the dockworkers.']);
        expect(planned.added.map(f => factMemoryText(f))).not.toContain('undefined');
        expect(planned.worldFacts).toHaveLength(2);
    });

    it('the reducer IS the plan committed: same rows, same supersession', () => {
        const state = { ...initialGameState, worldFacts: [{ id: 'f1', fact: 'The harbor road is flooded.', aspect: 'state', atMessage: 1 }], messages: Array(6).fill({ role: 'user', content: 'x' }) };
        const payload = [{ fact: 'The harbor road is not flooded.' }, { fact: 'The harbor road is still flooded.' }];
        const viaReducer = gameReducer(state, { type: 'ADD_WORLD_FACTS', payload }).worldFacts;
        const viaPlan = planWorldFactAdditions(state.worldFacts, payload, { messageCount: 6 }).worldFacts;
        const strip = rows => rows.map(({ id: _id, timestamp: _t, supersedes: _s, supersededBy: _by, ...rest }) => rest);
        expect(strip(viaReducer)).toEqual(strip(viaPlan));
        expect(viaReducer[0].supersededBy).toBe(viaReducer[1].id);
    });

    it('sanitizeWorldFactPayload lives on the engine shelf and the handlers re-export it', async () => {
        const shared = await import('../state/handlers/shared.js');
        expect(shared.sanitizeWorldFactPayload).toBe(sanitizeWorldFactPayload);
        expect(sanitizeWorldFactPayload({ fact: ' x ', knownBy: 'public' })).toEqual({ fact: 'x', category: 'general', knownBy: [] });
    });

    it('the scene, journal, npc and story composers write the texts the seed always wrote', () => {
        expect(sceneMemoryItem('A'.repeat(600), { location: 'Saltmere', sourceMessage: 'a1' })).toEqual({
            text: `[Location: Saltmere] ${'A'.repeat(500)}`, category: 'narrative', location: 'Saltmere', subjects: null, sourceMessage: 'a1',
        });
        expect(sceneMemoryItem('I draw my blade.', { category: 'player' }).text).toBe('I draw my blade.');
        expect(journalMemoryItem({ summary: 'Mira sold the ribbon.', location: 'Rimehollow' }, ['Mira', 'Tammo'])).toEqual({
            text: 'Mira sold the ribbon.', category: 'journal', location: 'Rimehollow', subjects: ['Mira'], sourceMessage: null,
        });
        expect(npcMemoryItem({ name: 'Tammo', disposition: 'wary', lastNotes: 'Keeps the ferry.', basedIn: 'The Ferry' })).toEqual({
            text: 'Tammo (wary): Keeps the ferry.', category: 'npc', location: 'The Ferry', subjects: ['Tammo'], sourceMessage: null,
        });
        expect(storyCardMemoryItem({ type: 'promise', subject: 'The ribbon', text: 'Mira promised a ribbon.', knownBy: ['Mira'], linkedNpcNames: ['Mira'], location: 'Rimehollow' })).toEqual({
            text: '[SECRET — known only to: Mira] The ribbon: Mira promised a ribbon.', category: 'story_promise', location: 'Rimehollow', subjects: ['Mira'], sourceMessage: null,
        });
    });
});

describe('the lanes (P2)', () => {
    it('addMemory is a batch of one: it embeds through embedTexts and dedupes against the store', async () => {
        await seedMemories('key', [], 'sess-1');
        await addMemory('key', 'The reeve takes bribes.', 'world_fact', 'Saltmere');
        await addMemory('key', 'The reeve takes bribes.', 'world_fact', 'Saltmere');
        expect(embedTextsMock).toHaveBeenCalledTimes(1);
        expect(getMemoryTexts()).toEqual(['The reeve takes bribes.']);
    });

    it('✕ on a terminal combat narration drops its RAG row: the composed scene row carries the narration id', async () => {
        await seedMemories('key', [], 'sess-1');
        queueMemoryItem('key', sceneMemoryItem('The last bandit falls.', { location: 'The Ford', sourceMessage: 'narr-9' }));
        queueMemoryItem('key', sceneMemoryItem('Another beat.', { location: 'The Ford', sourceMessage: 'narr-10' }));
        await flushMemoryQueue();
        expect(getMemoryTexts()).toHaveLength(2);
        expect(await retractMemoriesFromMessage('narr-9')).toBe(1);
        expect(getMemoryTexts()).toEqual(['[Location: The Ford] Another beat.']);
    });

    it('a CARRIED row never arms the batch window; it rides the next flush', async () => {
        await seedMemories('key', [], 'sess-1');
        vi.useFakeTimers();
        queueMemoryItem('key', factMemoryItem({ fact: 'The mill burned.', category: 'event', knownBy: [] }, { sourceMessage: 'a1' }), { carry: true });
        await vi.advanceTimersByTimeAsync(MEMORY_BATCH_WINDOW_MS * 3);
        expect(embedTextsMock).not.toHaveBeenCalled();
        // The next ordinary row arms the window for the whole batch.
        queueMemoryItem('key', sceneMemoryItem('The next turn.', { location: 'Saltmere' }));
        await vi.advanceTimersByTimeAsync(MEMORY_BATCH_WINDOW_MS + 10);
        expect(embedTextsMock).toHaveBeenCalledTimes(1);
        expect(embedTextsMock.mock.calls[0][1]).toEqual(['The mill burned.', '[Location: Saltmere] The next turn.']);
        vi.useRealTimers();
    });

    it('the presence tokenizer lives in textMatch.js and vectorMemory re-exports the tagging helper', () => {
        expect(findSubjectsViaMemory).toBe(findSubjectsInText);
        expect(findSubjectsInText('Lady Celeste frowned at Ash.', ['Lady Celeste Jewelglade', 'Ash', 'Tammo'])).toEqual(['Lady Celeste Jewelglade', 'Ash']);
        expect(nameTokensPresent(textWordSet('the ashes settle'), 'Ash')).toBe(false);
        expect(nameTokensPresent(textWordSet('nothing here'), 'The Lady')).toBeNull();
    });
});
