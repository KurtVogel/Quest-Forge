/**
 * Strengthening queue 2026-10-24 (story-memory Lap 1) — the reducer pins:
 * two person-subject beats are two cards (P1), an id echo births a new card
 * with the id dropped (P2), the DM lane never rewrites an engine or resolved
 * card's text and honors "Resolved" / "2" (P2), and both payoff lanes leave
 * the same stamps (P2).
 */
import { describe, expect, it } from 'vitest';
import { gameReducer, initialGameState } from './gameReducer.js';
import { normalizeEvents } from '../llm/responseParser.js';

const talk = n => Array.from({ length: n }, (_, i) => ({ id: `m${i}`, role: i % 2 ? 'assistant' : 'user', content: `line ${i}` }));
const withMessages = n => ({ ...initialGameState, messages: talk(n) });
const add = (state, payload, meta) => gameReducer(state, { type: 'ADD_STORY_MEMORY_CARD', payload, ...(meta && { meta }) });

describe('P1 — two beats about one person are two cards', () => {
    it('the trust beat survives the slap', () => {
        let state = add(withMessages(4), { type: 'relationship', subject: 'Tammo', text: 'Tammo trusted the hero with the key to the mill loft.', salience: 3 });
        state = add({ ...state, messages: talk(54) }, { type: 'relationship', subject: 'Tammo', text: 'Tammo struck the hero across the face at the harvest feast.', salience: 4 });
        expect(state.storyMemory).toHaveLength(2);
        expect(state.storyMemory.map(c => c.text)).toEqual([
            'Tammo trusted the hero with the key to the mill loft.',
            'Tammo struck the hero across the face at the harvest feast.',
        ]);
        // A restatement of the slap still folds into it.
        const restated = add({ ...state, messages: talk(56) }, { type: 'relationship', subject: 'Tammo', text: 'Tammo struck the hero in the face before the whole harvest feast.' });
        expect(restated.storyMemory).toHaveLength(2);
    });
});

describe('P2 — an id echo is a new card with the id dropped', () => {
    it('the ferryman promise stays itself; the Ilse mystery is born under its own id', () => {
        let state = add(withMessages(2), { id: 'c-ferry', type: 'promise', subject: 'Harl', text: 'Harl the ferryman promised the hero a free crossing at the spring flood.' });
        const ferryId = state.storyMemory[0].id;
        state = add(state, { id: ferryId, type: 'mystery', subject: 'Ilse', text: 'Nobody knows where Ilse goes on the new moon.', source: 'scribe' });
        expect(state.storyMemory).toHaveLength(2);
        expect(state.storyMemory[0]).toMatchObject({ id: ferryId, type: 'promise', subject: 'Harl' });
        expect(state.storyMemory[0].text).toMatch(/ferryman promised/);
        expect(state.storyMemory[1]).toMatchObject({ type: 'mystery', subject: 'Ilse' });
        expect(state.storyMemory[1].id).not.toBe(ferryId);
        expect(new Set(state.storyMemory.map(c => c.id)).size).toBe(2);
    });
});

describe('P2 — the DM lane is a status channel', () => {
    const base = () => {
        let state = add(withMessages(4), { id: 'wound-1', type: 'wound', subject: 'Astra\'s wound from the ford', text: 'Took a crossbow bolt through the shoulder at the ford.', salience: 4, source: 'engine' });
        state = add(state, { type: 'promise', subject: 'Oren', text: 'The hero swore to Oren to mend the sundial before harvest.', salience: 4 });
        state = gameReducer(state, { type: 'UPDATE_STORY_MEMORY', payload: { id: state.storyMemory[1].id, status: 'resolved' } });
        return state;
    };
    const update = (state, payload) => gameReducer(state, { type: 'UPDATE_STORY_MEMORY', payload });

    it('a DM text / subject never changes an engine card or a resolved card; salience and charge still move', () => {
        const state = base();
        const wound = update(state, { id: 'wound-1', text: 'A scratch, long healed.', subject: 'nothing', salience: 1, tags: ['healed'], location: 'Elsewhere' });
        expect(wound.storyMemory[0]).toMatchObject({ text: 'Took a crossbow bolt through the shoulder at the ford.', subject: 'Astra\'s wound from the ford', salience: 1, location: '' });
        expect(wound.storyMemory[0].tags).toEqual([]);
        const resolved = update(state, { id: state.storyMemory[1].id, text: 'Nothing happened at the ford.', emotionalCharge: 5 });
        expect(resolved.storyMemory[1]).toMatchObject({ status: 'resolved', text: 'The hero swore to Oren to mend the sundial before harvest.', emotionalCharge: 5 });
    });

    it('"Resolved" resolves and a wire salience "2" lands as 2', () => {
        const state = base();
        expect(update(state, { id: 'wound-1', status: 'Resolved' }).storyMemory[0].status).toBe('resolved');
        const events = normalizeEvents({ memory_updates: [{ id: 'wound-1', salience: '2', emotional_charge: '3' }] });
        expect(events.memoryUpdates).toEqual([{ id: 'wound-1', salience: 2, emotionalCharge: 3 }]);
        const next = update(state, events.memoryUpdates[0]);
        expect(next.storyMemory[0]).toMatchObject({ salience: 2, emotionalCharge: 3 });
        expect(normalizeEvents({ memory_updates: [{ id: 'wound-1', salience: 'high' }] }).memoryUpdates).toEqual([{ id: 'wound-1' }]);
    });
});

describe('P2 — one landing, two lanes, the same clocks', () => {
    it('MARK_CALLBACK_PAYOFF and a DM-marked used leave identical message stamps and counts', () => {
        const born = add(withMessages(4), { type: 'promise', subject: 'Oren', text: 'The hero swore to Oren to mend the sundial before harvest.', salience: 4 });
        const id = born.storyMemory[0].id;
        const later = { ...born, messages: talk(40) };
        const dm = gameReducer(later, { type: 'UPDATE_STORY_MEMORY', payload: { id, used: true } });
        const engine = gameReducer(later, { type: 'MARK_CALLBACK_PAYOFF', payload: { messageId: 'm39', cardIds: [id] } });
        const stamps = card => ({ lastSeenMessage: card.lastSeenMessage, lastUsedMessage: card.lastUsedMessage, usedCount: card.usedCount, status: card.status });
        expect(stamps(engine.storyMemory[0])).toEqual(stamps(dm.storyMemory[0]));
        expect(stamps(engine.storyMemory[0])).toEqual({ lastSeenMessage: 40, lastUsedMessage: 40, usedCount: 1, status: 'active' });
        expect(engine.storyMemory[0].lastSeenAt).toBe(engine.storyMemory[0].lastUsedAt);
        expect(engine.messages[39].bondMarks).toEqual([expect.objectContaining({ kind: 'callback', name: 'Oren' })]);
    });
});
