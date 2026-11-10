/**
 * Strengthening 2026-11-10 (story-memory, Lap 2) — a lane card never claims
 * what is the engine's, and a commitment written under another word is still
 * a promise. `vow` / `oath` / `pledge` / `debt` fold to `promise`; a lane
 * `type: "quest"` is refused whole; a lane `source` is dropped.
 */
import { describe, expect, it } from 'vitest';
import { gameReducer, initialGameState } from './gameReducer.js';
import { isEngineOnlyCardType, normalizeStoryMemoryCard } from '../engine/storyMemory.js';
import { capNovelCards } from '../llm/scribe.js';

describe('the commitment words', () => {
    it('fold to promise after the same fold as the canonical names', () => {
        for (const word of ['vow', 'Oath', 'PLEDGE', 'debt', ' Debt ', 'vow.']) {
            expect(normalizeStoryMemoryCard({ type: word, text: 'Swore to bring Pelle home.' }).type).toBe('promise');
        }
    });

    it('leave every other off-list word a callback, and the canonical names alone', () => {
        for (const word of ['rumor', 'vows of silence', 'debtor', 'bond', '']) {
            expect(normalizeStoryMemoryCard({ type: word, text: 'A thing that happened.' }).type).toBe('callback');
        }
        expect(normalizeStoryMemoryCard({ type: 'npc-agenda', text: 'Vane wants the ledger.' }).type).toBe('npcAgenda');
        expect(normalizeStoryMemoryCard({ type: 'mystery', text: 'Who rang the bell?' }).type).toBe('mystery');
    });

    it('a lane vow lands as a promise card', () => {
        const next = gameReducer(initialGameState, {
            type: 'ADD_STORY_MEMORY_CARDS', payload: [{ type: 'oath', subject: 'Sanna', text: 'The hero swore to Sanna to bring Pelle home.' }],
        });
        expect(next.storyMemory).toHaveLength(1);
        expect(next.storyMemory[0]).toMatchObject({ type: 'promise', source: 'scribe' });
    });
});

describe('the engine-only type and source', () => {
    it('names the quest type in any spelling', () => {
        expect(['quest', 'Quest', ' QUEST ', 'quest.'].every(isEngineOnlyCardType)).toBe(true);
        expect(['quests', 'promise', '', null, undefined, { type: 'quest' }].some(isEngineOnlyCardType)).toBe(false);
    });

    it('a lane quest card is refused whole and the cards beside it land', () => {
        const next = gameReducer(initialGameState, {
            type: 'ADD_STORY_MEMORY_CARDS',
            payload: [
                { type: 'Quest', subject: 'The Manifest', text: 'The hero took the job of stealing the manifest.' },
                { type: 'mystery', subject: 'The bell', text: 'Nobody saw who rang the abbey bell.' },
            ],
        });
        expect(next.storyMemory.map(card => card.type)).toEqual(['mystery']);
    });

    it('a lane card that writes source "engine" is a scribe card', () => {
        const next = gameReducer(initialGameState, {
            type: 'ADD_STORY_MEMORY_CARDS',
            payload: [{ type: 'wound', subject: 'Shoulder', text: 'Took a bolt through the shoulder.', source: 'engine' }],
        });
        expect(next.storyMemory[0].source).toBe('scribe');
        // …so a later re-report may still reword it (an engine card's text is frozen).
        const again = gameReducer(next, {
            type: 'ADD_STORY_MEMORY_CARDS',
            payload: [{ id: next.storyMemory[0].id, type: 'wound', text: 'Took a crossbow bolt through the left shoulder at the weir.' }],
        });
        expect(again.storyMemory).toHaveLength(1);
        expect(again.storyMemory[0].text).toBe('Took a crossbow bolt through the left shoulder at the weir.');
    });

    it('the engine still mints its own quest card through the singular action', () => {
        const next = gameReducer(initialGameState, {
            type: 'ADD_STORY_MEMORY_CARD',
            payload: { type: 'quest', subject: 'The Manifest', text: '"The Manifest" — completed: done.', source: 'engine' },
        });
        expect(next.storyMemory[0]).toMatchObject({ type: 'quest', source: 'engine' });
    });

    it('a lane quest card spends no slot of the novel-card cap', () => {
        const kept = capNovelCards([
            { type: 'quest', text: 'The hero took the job of stealing the manifest.' },
            { type: 'quest', text: 'The hero took a second job.' },
            { type: 'promise', text: 'The hero swore to bring Pelle home.' },
            { type: 'mystery', text: 'Nobody saw who rang the abbey bell.' },
        ], []);
        expect(kept.map(card => card.type)).toEqual(['promise', 'mystery']);
    });
});
