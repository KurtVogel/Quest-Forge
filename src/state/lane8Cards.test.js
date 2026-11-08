/**
 * Identity by reference, lane 8 (2026-11-08): a story card is the id the
 * Scribe echoes or the same text under the same type — no word rung decides
 * whether two LLM-written cards mean one beat. KNOWN STORY CARDS adds the
 * cards nearest in MEANING to the turn (the vector store's `story_*` rows,
 * each stamped with its card id); the cadence reflection is shown pairs that
 * MAY be one beat (`possibleSameCard`) and folds a pair by id (`merge_cards`
 * → MERGE_STORY_CARDS); a callback landed when the DM's own `used` says so.
 */
import { describe, expect, it, vi } from 'vitest';

const { sendMessage, nearestStoryCards, queueMemoryItem } = vi.hoisted(() => ({
    sendMessage: vi.fn(),
    nearestStoryCards: vi.fn(() => Promise.resolve([])),
    queueMemoryItem: vi.fn(() => Promise.resolve()),
}));
vi.mock('../llm/adapter.js', async (importOriginal) => ({ ...(await importOriginal()), sendMessage }));
vi.mock('../engine/vectorMemory.js', async (importOriginal) => ({ ...(await importOriginal()), nearestStoryCards, queueMemoryItem }));

import { gameReducer, initialGameState } from './gameReducer.js';
import { findStoryMemoryMatch, mergeStoryCards, normalizeStoryMemoryCard, possibleSameCardPairs, SAME_CARD_PAIRS_CAP } from '../engine/storyMemory.js';
import { storyCardMemoryItem } from '../engine/vectorMemory.js';
import { buildKnownStoryCards, NEAR_STORY_CARD_CAP, REFLECTION_ANCHORS, runNpcFrontReflection, runScribe, SCRIBE_SYSTEM_PROMPT } from '../llm/scribe.js';

const talk = n => Array.from({ length: n }, (_, i) => ({ id: `m${i}`, role: i % 2 ? 'assistant' : 'user', content: `line ${i}` }));
const card = (id, text, extra = {}) => normalizeStoryMemoryCard({ id, type: 'promise', subject: 'x', text, status: 'active', firstSeenMessage: 4, lastSeenMessage: 4, ...extra });
const settings = { ...initialGameState.settings, llmProvider: 'gemini', apiKey: 'k', geminiApiKey: 'k' };

describe('findStoryMemoryMatch — the echoed id or the exact text under the same type, nothing else', () => {
    const held = card('c-1', 'Tammo owes the hero three silver from the dice game.');
    it('reads the id first, then the exact text under the same type; other words are a new card', () => {
        expect(findStoryMemoryMatch([held], { id: 'c-1', type: 'promise', text: 'Tammo still owes three silver.' })).toBe(0);
        expect(findStoryMemoryMatch([held], { type: 'promise', text: 'tammo owes the hero three silver from the dice game.' })).toBe(0);
        expect(findStoryMemoryMatch([held], { type: 'wound', text: 'Tammo owes the hero three silver from the dice game.' })).toBe(-1);
        expect(findStoryMemoryMatch([held], { type: 'promise', subject: 'x', text: 'Tammo owes the hero three silver pieces from the dice.' })).toBe(-1);
        expect(findStoryMemoryMatch([held], { id: 'c-1', type: 'wound', text: 'Tammo owes the hero three silver from the dice game.' })).toBe(-1); // another type under the id is not a continuation
        expect(findStoryMemoryMatch([held], { type: 'promise', text: '' })).toBe(-1);
    });
});

describe('possibleSameCardPairs — the shortlist the reflection is shown', () => {
    it('offers same-type active lane pairs that share meaning, older card first, newest pairs first, capped', () => {
        const a = card('a', 'Tammo owes the hero three silver from the dice game at the pier.', { linkedNpcNames: ['Tammo'], firstSeenMessage: 4, lastSeenMessage: 4 });
        const b = card('b', 'Old Tammo still owes three silver from the pier dice game.', { linkedNpcNames: ['Old Tammo'], firstSeenMessage: 30, lastSeenMessage: 40 });
        const c = card('c', 'Orsa promised a receipt for every copper paid on the berth.', { firstSeenMessage: 10, lastSeenMessage: 50 });
        const d = card('d', 'The harbormaster promised a receipt for each copper paid toward the berth.', { firstSeenMessage: 20, lastSeenMessage: 60 });
        const pairs = possibleSameCardPairs([a, b, c, d]);
        expect(pairs.map(pair => pair.ids)).toEqual([['c', 'd'], ['a', 'b']]);
        expect(pairs[1]).toEqual({ ids: ['a', 'b'], type: 'promise', texts: [a.text, b.text] });
        // Names alone never make a pair: the people's tokens are set aside.
        const e = card('e', 'Tammo struck the hero across the face.', { linkedNpcNames: ['Tammo'] });
        expect(possibleSameCardPairs([a, e])).toEqual([]);
        // The cap.
        const many = Array.from({ length: 8 }, (_, i) => card(`m${i}`, 'The hero swore to Oren to mend the cracked sundial before harvest.', { firstSeenMessage: i }));
        expect(possibleSameCardPairs(many)).toHaveLength(SAME_CARD_PAIRS_CAP);
        expect(possibleSameCardPairs(many, { cap: 2 })).toHaveLength(2);
        expect(possibleSameCardPairs(null)).toEqual([]);
    });
});

describe('MERGE_STORY_CARDS — the reflection\'s answer, by id', () => {
    const a = card('a', 'Tammo owes the hero three silver.', { salience: 2, tags: ['debt'], sourceMessage: 'm4', usedCount: 1 });
    const b = card('b', 'Old Tammo still owes the hero three silver from the pier dice game.', { salience: 4, tags: ['dice'], linkedNpcNames: ['Old Tammo'], sourceMessage: 'm30', firstSeenMessage: 30, lastSeenMessage: 30, usedCount: 2 });
    const state = () => ({ ...initialGameState, storyMemory: [a, b], messages: talk(40), session: { ...initialGameState.session, id: 's' } });

    it('folds the dropped card into the kept one and keeps the kept id', () => {
        const next = gameReducer(state(), { type: 'MERGE_STORY_CARDS', payload: { keepId: 'a', dropId: 'b' } });
        expect(next.storyMemory).toHaveLength(1);
        expect(next.storyMemory[0]).toMatchObject({ id: 'a', text: b.text, salience: 4, firstSeenMessage: 4, lastSeenMessage: 30, usedCount: 3, sourceMessage: 'm4', witnesses: ['m30'] });
        expect(next.storyMemory[0].tags).toEqual(expect.arrayContaining(['debt', 'dice']));
        expect(next.storyMemory[0].linkedNpcNames).toEqual(['Old Tammo']);
    });

    it('an unknown id, the same id twice, or a stale campaign stamp changes nothing', () => {
        const before = state();
        expect(gameReducer(before, { type: 'MERGE_STORY_CARDS', payload: { keepId: 'a', dropId: 'nope' } })).toBe(before);
        expect(gameReducer(before, { type: 'MERGE_STORY_CARDS', payload: { keepId: 'a', dropId: 'a' } })).toBe(before);
        expect(gameReducer(before, { type: 'MERGE_STORY_CARDS', payload: {} })).toBe(before);
        expect(gameReducer(before, { type: 'MERGE_STORY_CARDS', payload: { keepId: 'a', dropId: 'b' }, meta: { sessionId: 'other', loadNonce: 0 } })).toBe(before);
    });

    it('mergeStoryCards survives hostile shapes', () => {
        expect(mergeStoryCards(null, 'a', 'b')).toEqual([]);
        expect(mergeStoryCards([null, a, undefined, b], 'a', 'b').map(c => c && c.id)).toEqual([null, 'a', undefined]);
    });
});

describe('the reflection asks about possibleSameCard and merges only what it offered', () => {
    it('the anchors know merge_cards; an unoffered or malformed pair never merges; the prompt carries the rule', async () => {
        expect(REFLECTION_ANCHORS).toContain('merge_cards');
        sendMessage.mockReset();
        sendMessage.mockResolvedValue(JSON.stringify({
            npc_updates: [],
            merge_cards: [['a', 'b'], ['c', 'd'], ['a', 'a'], 'junk', ['a']],
            tempo_directive: { front_id: null },
        }));
        const dispatched = [];
        const state = {
            ...initialGameState,
            settings,
            session: { ...initialGameState.session, id: 's' },
            npcs: [{ id: 'npc-t', name: 'Old Tammo', rosterTier: 'character', kind: 'character', disposition: 'neutral', lastNotes: 'x' }],
            storyMemory: [
                card('a', 'Tammo owes the hero three silver from the dice game at the pier.', { linkedNpcNames: ['Tammo'] }),
                card('b', 'Old Tammo still owes three silver from the pier dice game.', { linkedNpcNames: ['Old Tammo'], firstSeenMessage: 30, lastSeenMessage: 30 }),
                card('c', 'Orsa promised a receipt for every copper paid.', { type: 'promise' }),
                card('d', 'Orsa slapped the hero at the tide-bell.', { type: 'relationship' }),
            ],
            fronts: [],
            messages: talk(40),
        };
        await runNpcFrontReflection({ state, dispatch: action => dispatched.push(action), cadence: null });
        expect(dispatched.filter(a => a.type === 'MERGE_STORY_CARDS').map(a => a.payload)).toEqual([{ keepId: 'a', dropId: 'b' }]);
        const call = sendMessage.mock.calls[0][0];
        expect(call.userMessage).toContain('possibleSameCard');
        expect(call.userMessage).toContain('"ids":["a","b"]');
        expect(call.userMessage).not.toContain('"ids":["c","d"]');
        expect(call.systemPrompt).toContain('MERGE CARDS');
        expect(call.systemPrompt).toContain('"merge_cards"');
    });
});

describe('KNOWN STORY CARDS — the presence picks plus the cards nearest in meaning', () => {
    const pool = {
        storyMemory: [
            { id: 'c-tammo', type: 'promise', status: 'active', subject: 'dice debt', text: 'Tammo owes the hero three silver.', linkedNpcNames: ['Tammo'], lastSeenMessage: 5 },
            { id: 'c-light', type: 'mystery', status: 'active', subject: 'the dark light', text: 'The Gannet Rock light has gone dark.', linkedNpcNames: [], lastSeenMessage: 7 },
            { id: 'c-far', type: 'npcAgenda', status: 'active', subject: 'Vasko run', text: 'Vasko plans a contraband run.', linkedNpcNames: ['Vasko'], lastSeenMessage: 3 },
        ],
    };

    it('the near ids join after the presence picks, once each, capped, and alone when the text names nobody', () => {
        const block = buildKnownStoryCards(pool, 'I ask Tammo about the lamp.', { near: ['c-light', 'c-tammo', 'nope'] });
        expect(block.indexOf('c-tammo')).toBeLessThan(block.indexOf('c-light'));
        expect(block.match(/c-tammo/g)).toHaveLength(1);
        expect(block).not.toContain('c-far');
        expect(buildKnownStoryCards(pool, 'Nothing here.', { near: ['c-far'] })).toContain('id: c-far');
        expect(buildKnownStoryCards(pool, 'Nothing here.', { near: [] })).toBeNull();
        expect(buildKnownStoryCards(pool, 'I ask Tammo about the lamp.')).toContain('c-tammo');
        const many = { storyMemory: Array.from({ length: 9 }, (_, i) => ({ id: `n${i}`, type: 'callback', status: 'active', text: `beat ${i}`, linkedNpcNames: [] })) };
        expect(buildKnownStoryCards(many, 'x', { near: many.storyMemory.map(c => c.id) }).split('\n')).toHaveLength(NEAR_STORY_CARD_CAP);
    });

    it('runScribe reads the nearest cards off the memory query and embeds the cards it minted or updated, by card id', async () => {
        sendMessage.mockReset();
        nearestStoryCards.mockReset();
        queueMemoryItem.mockReset();
        nearestStoryCards.mockResolvedValue([{ cardId: 'c-light', text: 'the dark light: The Gannet Rock light has gone dark.', score: 0.8 }]);
        sendMessage.mockResolvedValue(JSON.stringify({
            world_facts: [], npc_updates: [],
            story_memory: [
                { id: 'c-light', type: 'mystery', subject: 'the dark light', text: 'The Gannet Rock light has gone dark; Tammo thinks the keeper is dead.' },
                { type: 'promise', subject: 'the oilskin', text: 'The hero promised Tammo Reed the spare oilskin coat.', linkedNpcNames: ['Tammo Reed'] },
            ],
            location: null,
        }));
        const dispatched = [];
        await runScribe({
            playerMessage: 'I ask Tammo about the lamp.',
            dmNarrative: 'Tammo says the Gannet Rock light has been dark three nights.',
            settings,
            dispatch: action => dispatched.push(action),
            memoryQuery: 'I ask Tammo about the lamp. Location: Saltmere',
            memoryContext: { worldFacts: [], messageCount: 40, location: 'Saltmere', npcs: [], storyMemory: pool.storyMemory, campaign: { sessionId: 's', loadNonce: 0 } },
            knownStoryCards: buildKnownStoryCards(pool, 'I ask Tammo about the lamp.'),
        });
        expect(nearestStoryCards).toHaveBeenCalledWith('k', 'I ask Tammo about the lamp. Location: Saltmere', NEAR_STORY_CARD_CAP);
        const request = sendMessage.mock.calls[0][0];
        expect(request.userMessage).toContain('id: c-light');
        expect(request.userMessage).toContain('nearest in meaning');
        const cards = dispatched.find(a => a.type === 'ADD_STORY_MEMORY_CARDS');
        expect(cards.payload).toHaveLength(2);
        // The novel card carries the id it will be born under; the rows name their cards.
        expect(typeof cards.payload[1].id).toBe('string');
        const rows = queueMemoryItem.mock.calls.map(([, row]) => row);
        expect(rows.map(row => row.cardId)).toEqual(['c-light', cards.payload[1].id]);
        expect(rows[0].text).toContain('Tammo thinks the keeper is dead'); // the longer text, the merge's own rule
        expect(rows[1].category).toBe('story_promise');
        expect(storyCardMemoryItem({ id: 'z', type: 'wound', text: 't' }).cardId).toBe('z');
        expect(storyCardMemoryItem({ type: 'wound', text: 't' }).cardId).toBeUndefined();
    });

    it('the Scribe prompt still tells the lane to echo the id, and the DM lane\'s subject rung is untouched', () => {
        expect(SCRIBE_SYSTEM_PROMPT).toContain('never mint a second card');
    });
});

describe('a callback landed when the DM said so', () => {
    it('MARK_CALLBACK_PAYOFF after the DM\'s used at the same message is the chip alone', () => {
        const ribbon = card('card-ribbon', 'Mira promised a blue ribbon on the well road.', { subject: 'Mira ribbon' });
        const state = { ...initialGameState, storyMemory: [ribbon], messages: [...talk(40), { id: 'dm-41', role: 'assistant', content: 'x' }] };
        const dm = gameReducer(state, { type: 'UPDATE_STORY_MEMORY', payload: { id: 'card-ribbon', used: true } });
        const marked = gameReducer(dm, { type: 'MARK_CALLBACK_PAYOFF', payload: { messageId: 'dm-41', cardIds: ['card-ribbon'] } });
        expect(marked.storyMemory[0]).toMatchObject({ usedCount: 1, lastUsedMessage: 41 });
        expect(marked.messages.at(-1).bondMarks).toEqual([expect.objectContaining({ kind: 'callback', name: 'Mira ribbon' })]);
    });
});
