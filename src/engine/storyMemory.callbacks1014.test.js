/**
 * WOW 2026-10-14 (memory-callbacks, W1 ×2): a callback is what the window
 * FORGOT — the block offers only cards older than the DM window, each line
 * carries its age and who could say it — and the engine judges the payoff.
 */
import { describe, expect, it } from 'vitest';
import {
    buildStoryMemoryPromptBlock, CALLBACK_MIN_AGE, curateStoryMemory,
    normalizeStoryMemoryCard, scoreStoryMemory, STORY_MEMORY_ENGINE_STAMPS,
} from './storyMemory.js';
import { MESSAGE_WINDOW } from '../llm/turnOrchestrator.js';
import { gameReducer, initialGameState } from '../state/gameReducer.js';

const transcript = n => Array.from({ length: n }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', content: `m${i}` }));

const ribbon = normalizeStoryMemoryCard({
    id: 'card-ribbon', type: 'promise', subject: 'Mira ribbon',
    text: 'Mira promised to leave a blue ribbon on the well road if it became unsafe.',
    salience: 4, emotionalCharge: 3, linkedNpcNames: ['Mira'], location: 'Millhaven', lastSeenMessage: 10,
});

describe('a callback is what the window forgot', () => {
    it('CALLBACK_MIN_AGE is the DM window\'s row count', () => {
        expect(CALLBACK_MIN_AGE).toBe(MESSAGE_WINDOW);
    });

    it('a card seen inside the window scores 0; past it the older the better, up to +3 (Mira here to say it)', () => {
        const inWindow = scoreStoryMemory(ribbon, { query: 'ribbon', npcs: [{ name: 'Mira' }], messages: transcript(10 + CALLBACK_MIN_AGE - 2) });
        expect(inWindow).toBe(0);
        const atEdge = scoreStoryMemory(ribbon, { query: 'ribbon', npcs: [{ name: 'Mira' }], messages: transcript(10 + CALLBACK_MIN_AGE) });
        expect(atEdge).toBeGreaterThan(0);
        const old = scoreStoryMemory(ribbon, { query: 'ribbon', npcs: [{ name: 'Mira' }], messages: transcript(10 + CALLBACK_MIN_AGE + 60) });
        expect(old - atEdge).toBeCloseTo(3, 5);
        const older = scoreStoryMemory(ribbon, { query: 'ribbon', npcs: [{ name: 'Mira' }], messages: transcript(400) });
        expect(older).toBe(old); // capped
    });

    it('curation carries the age in turns and the present linked people as speakers; the block prints both', () => {
        const curated = curateStoryMemory({ memories: [ribbon], query: 'the well road', npcs: [{ name: 'Mira' }, { name: 'Tammo' }], messages: transcript(10 + 40) });
        expect(curated).toHaveLength(1);
        expect(curated[0].ageTurns).toBe(20);
        expect(curated[0].speakers).toEqual(['Mira']);
        const block = buildStoryMemoryPromptBlock(curated);
        expect(block).toContain('— 20 turns ago · could say it: Mira');
        expect(block).toContain('only as a character present SAYS it');
        expect(block).toContain('never as narrator exposition');
        // Nobody linked is present: the hero's own passing thought.
        const alone = curateStoryMemory({ memories: [ribbon], query: 'the well road', npcs: [], messages: transcript(50) });
        expect(buildStoryMemoryPromptBlock(alone)).toContain('could say it: the hero (a passing thought)');
    });
});

// Flipped 2026-11-08 (identity by reference, lane 8): the word detector that
// read a card's tokens in the reply is gone — the DM's own memory_updates
// `used` (the id printed on the card's line) is the one landing. The engine
// action now only puts the chip on the row for those ids, and a card the
// DM's `used` already stamped this message is not stamped twice.
describe('the DM says when a callback landed; the engine shows it', () => {
    it('MARK_CALLBACK_PAYOFF after the DM\'s own used at the same message adds the chip and stamps nothing twice', () => {
        const state = {
            ...initialGameState,
            storyMemory: [ribbon],
            messages: [...transcript(40), { id: 'dm-41', role: 'assistant', content: 'Mira: "No blue ribbon on the well road."' }],
        };
        const dm = gameReducer(state, { type: 'UPDATE_STORY_MEMORY', payload: { id: 'card-ribbon', used: true } });
        const marked = gameReducer(dm, { type: 'MARK_CALLBACK_PAYOFF', payload: { messageId: 'dm-41', cardIds: ['card-ribbon'] } });
        expect(marked.storyMemory[0]).toMatchObject({ usedCount: 1, lastUsedMessage: 41 });
        expect(marked.messages.at(-1).bondMarks).toEqual([expect.objectContaining({ kind: 'callback', name: 'Mira ribbon' })]);
    });

    it('MARK_CALLBACK_PAYOFF rests and counts the card and puts a ↺ chip on the DM row', () => {
        const state = {
            ...initialGameState,
            storyMemory: [ribbon],
            messages: [...transcript(40), { id: 'dm-41', role: 'assistant', content: 'Mira: "No blue ribbon on the well road."' }],
        };
        const next = gameReducer(state, { type: 'MARK_CALLBACK_PAYOFF', payload: { messageId: 'dm-41', cardIds: ['card-ribbon', 'nope'] } });
        const card = next.storyMemory[0];
        expect(card.lastUsedMessage).toBe(41);
        expect(card.usedCount).toBe(1);
        expect(next.messages.at(-1).bondMarks).toEqual([{ name: 'Mira ribbon', kind: 'callback', label: expect.stringContaining('callback landed: Mira promised') }]);
        // The rested card is out of curation for the cooldown.
        expect(scoreStoryMemory(card, { query: 'ribbon', messages: next.messages })).toBe(0);
        // A second mark at the SAME message is the chip only (lane 8); a later message lands again. An unknown id or an empty list is a no-op.
        expect(gameReducer(next, { type: 'MARK_CALLBACK_PAYOFF', payload: { messageId: 'dm-41', cardIds: ['card-ribbon'] } }).storyMemory[0].usedCount).toBe(1);
        const later = { ...next, messages: [...next.messages, { id: 'u-42', role: 'user', content: 'x' }, { id: 'dm-43', role: 'assistant', content: 'y' }] };
        expect(gameReducer(later, { type: 'MARK_CALLBACK_PAYOFF', payload: { messageId: 'dm-43', cardIds: ['card-ribbon'] } }).storyMemory[0].usedCount).toBe(2);
        expect(gameReducer(next, { type: 'MARK_CALLBACK_PAYOFF', payload: { messageId: 'dm-41', cardIds: ['nope'] } })).toBe(next);
    });

    it('the DM\'s own `used` counts too, and usedCount is an engine stamp a lane payload cannot set', () => {
        const state = { ...initialGameState, storyMemory: [ribbon], messages: transcript(30) };
        const next = gameReducer(state, { type: 'UPDATE_STORY_MEMORY', payload: { id: 'card-ribbon', used: true } });
        expect(next.storyMemory[0].usedCount).toBe(1);
        expect(STORY_MEMORY_ENGINE_STAMPS).toContain('usedCount');
        const minted = gameReducer({ ...initialGameState, messages: transcript(4) }, { type: 'ADD_STORY_MEMORY_CARD', payload: { type: 'promise', subject: 'x', text: 'A promise made at the weir to return the ledger.', usedCount: 9 } });
        expect(minted.storyMemory[0].usedCount).toBeUndefined();
    });
});

describe('playtest 2026-09-30: an engine card keeps its text through a Scribe re-report', () => {
    // The re-report reaches the engine card by its id since lane 8 (the Scribe
    // is shown the id under KNOWN STORY CARDS); in other words without the id it is a new card.
    it('END_COMBAT\'s wound card is never reworded by the Scribe', () => {
        const wound = normalizeStoryMemoryCard({ id: 'wound-1', type: 'wound', subject: 'the Cutter fight', text: 'The Cutter opened Astra\'s shoulder to the bone at the weir; she went down to 3 HP.', salience: 4, source: 'engine', tags: ['fight-cost'] });
        const state = { ...initialGameState, storyMemory: [wound], messages: transcript(30) };
        expect(gameReducer(state, { type: 'ADD_STORY_MEMORY_CARD', payload: { type: 'wound', subject: 'the Cutter fight', text: 'Astra was wounded by the Cutter at the weir and nearly died.', salience: 4, tags: ['scar'] } }).storyMemory).toHaveLength(2);
        const next = gameReducer(state, { type: 'ADD_STORY_MEMORY_CARD', payload: { id: 'wound-1', type: 'wound', subject: 'the Cutter fight', text: 'Astra was wounded by the Cutter at the weir and nearly died.', salience: 4, tags: ['scar'] } });
        expect(next.storyMemory).toHaveLength(1);
        expect(next.storyMemory[0].text).toBe(wound.text);
        expect(next.storyMemory[0].source).toBe('engine');
        expect(next.storyMemory[0].tags).toContain('scar');
    });
});
