/**
 * Queue sweep 2026-09-17 — story-memory Lap-2 hostile-input pins at the TWO
 * reducer entry points: the Scribe/reflection batch (ADD_STORY_MEMORY_CARDS)
 * and LOAD_GAME. The engine-level readers are pinned in
 * engine/storyMemory.queue0917.test.js.
 */
import { describe, expect, it } from 'vitest';
import { gameReducer, initialGameState } from './gameReducer.js';
import { curateStoryMemory } from '../engine/storyMemory.js';

const transcript = (n) => Array.from({ length: n }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', content: `Beat ${i}` }));

describe('P1: a null element in a batch', () => {
    it('ADD_STORY_MEMORY_CARDS skips it and keeps every card after it', () => {
        const next = gameReducer(initialGameState, {
            type: 'ADD_STORY_MEMORY_CARDS',
            payload: [
                { text: 'First beat.', type: 'callback' },
                null,
                'not a card',
                ['nor this'],
                { text: 'Second beat.', type: 'promise' },
            ],
        });
        expect(next.storyMemory.map(c => c.text)).toEqual(['First beat.', 'Second beat.']);
    });

    it('ADD_STORY_MEMORY_CARD with a null payload is a no-op', () => {
        expect(gameReducer(initialGameState, { type: 'ADD_STORY_MEMORY_CARD', payload: null })).toBe(initialGameState);
    });

    it('a non-array batch payload is a no-op', () => {
        expect(gameReducer(initialGameState, { type: 'ADD_STORY_MEMORY_CARDS', payload: { text: 'x' } })).toBe(initialGameState);
    });
});

describe('P1/P2: LOAD_GAME', () => {
    const load = (storyMemory, extra = {}) => gameReducer(initialGameState, {
        type: 'LOAD_GAME',
        payload: {
            character: { ...initialGameState.character, name: 'Tess', race: 'human', class: 'rogue' },
            inventory: [],
            messages: transcript(51),
            storyMemory,
            ...extra,
        },
    });

    it('a null / scalar element no longer makes the campaign un-loadable', () => {
        const next = load([null, 'junk', 7, { text: 'Oren owes the hero a boat.', type: 'promise' }]);
        expect(next.storyMemory.map(c => c.text)).toEqual(['Oren owes the hero a boat.']);
    });

    it('future message stamps clamp to the transcript so the promise is curatable again', () => {
        const next = load([{ id: 'mem-p', text: 'Oren owes the hero a boat.', type: 'promise', salience: 5, lastUsedMessage: 1e9, lastSeenMessage: 1e9, firstSeenMessage: 1e9 }]);
        const [card] = next.storyMemory;
        expect(card).toMatchObject({ lastUsedMessage: 51, lastSeenMessage: 51, firstSeenMessage: 51 });
        // The cooldown counts from message 51; after 8+ conversational messages the card scores.
        const later = { ...next, messages: transcript(70) };
        const curated = curateStoryMemory({ memories: later.storyMemory, query: 'boat', messages: later.messages });
        expect(curated[0]?.id).toBe('mem-p');
    });

    it('junk wall-clock stamps load typed (no NaN into dormancy)', () => {
        const next = load([{ text: 'A quiet beat.', salience: 2, firstSeenAt: 'junk', lastSeenAt: 'junk', lastUsedAt: {} }]);
        const [card] = next.storyMemory;
        expect(Number.isFinite(card.firstSeenAt)).toBe(true);
        expect(Number.isFinite(card.lastSeenAt)).toBe(true);
        expect(card.lastUsedAt).toBeNull();
    });

    it('a scalar knownBy on a stored card loads as one knower (the secret stays secret)', () => {
        const next = load([{ text: 'The hero buried the seal.', knownBy: 'the hero', witnessed: 'true' }]);
        expect(next.storyMemory[0].knownBy).toEqual(['the hero']);
        expect(next.storyMemory[0].witnessed).toBeUndefined();
    });

    it('a journal summary is typed and clamped at load (the RAG seed source)', () => {
        const next = load([], { journal: [{ summary: 'S'.repeat(5000), timestamp: 1 }, { summary: { nested: true }, timestamp: 2 }] });
        expect(next.journal[0].summary).toHaveLength(2000);
        expect(next.journal[1].summary).toBe('');
    });
});
