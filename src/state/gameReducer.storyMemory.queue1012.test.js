/**
 * Strengthening queue 2026-10-12 (story-memory Lap 4) — the pins:
 * the DM's memory_updates round trip through the id the callbacks block now
 * prints (P1), an engine card's provenance and identity across a Scribe
 * re-report (P2), one birth composer (P2), dormancy on the conversational
 * clock (P2), and the shelved helpers (P2 nit).
 */
import { describe, expect, it } from 'vitest';
import { gameReducer, initialGameState } from './gameReducer.js';
import {
    applyStoryMemoryDormancy,
    bornStoryMemoryCard,
    buildStoryMemoryPromptBlock,
    compareCardRecency,
    curateStoryMemory,
    WOUND_DORMANCY_JOURNAL_CYCLES,
} from '../engine/storyMemory.js';
import { clampNumber, strictFlag, toFlag } from '../engine/text.js';
import { clampMessageStamp, conversationalAgeSince } from '../engine/replayLedger.js';

const talk = n => Array.from({ length: n }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', content: `line ${i}` }));
const withMessages = n => ({ ...initialGameState, messages: talk(n) });
const entry = (end, timestamp = 1) => ({ summary: 's', timestamp, messageRange: [Math.max(0, end - 10), end] });

describe('P1 — the callbacks block prints the id memory_updates addresses', () => {
    it('round-trips { id, used } from the line the DM reads to a stamped cooldown', () => {
        let state = gameReducer(withMessages(4), {
            type: 'ADD_STORY_MEMORY_CARD',
            payload: { type: 'promise', subject: 'Oren', text: 'The hero swore to Oren to mend the sundial before harvest.', salience: 4 },
        });
        const card = state.storyMemory[0];
        const block = buildStoryMemoryPromptBlock(curateStoryMemory({ memories: state.storyMemory, query: 'Oren sundial', messages: state.messages }));
        const id = block.match(/\| id: ([^\s|)]+)/)?.[1];
        expect(id).toBe(card.id);
        expect(block).toMatch(/using the id shown on its line/);

        state = { ...state, messages: talk(10) };
        state = gameReducer(state, { type: 'UPDATE_STORY_MEMORY', payload: { id, used: true } });
        expect(state.storyMemory[0].lastUsedMessage).toBe(10);
        expect(state.storyMemory[0].lastUsedAt).toEqual(expect.any(Number));
        // …and the cooldown it sets holds the card out of the next curation.
        expect(curateStoryMemory({ memories: state.storyMemory, query: 'Oren sundial', messages: state.messages })).toHaveLength(0);
    });

    it('a found-by-subject update never re-ids the card with a stray id', () => {
        let state = gameReducer(withMessages(2), {
            type: 'ADD_STORY_MEMORY_CARD',
            payload: { type: 'mystery', subject: 'The drowned bell', text: 'A bell rings under the lake at night.' },
        });
        const id = state.storyMemory[0].id;
        state = gameReducer(state, { type: 'UPDATE_STORY_MEMORY', payload: { id: 'mem-invented', subject: 'The drowned bell', salience: 5 } });
        expect(state.storyMemory[0].id).toBe(id);
        expect(state.storyMemory[0].salience).toBe(5);
        expect(state.storyMemory[0].lastUsedMessage).toBeUndefined();
    });
});

describe('P2 — a Scribe re-report keeps the stored card\'s source and id', () => {
    const wound = { type: 'wound', subject: 'The ambush at Kettle Ford', text: 'Astra took a spear through the shoulder at Kettle Ford; Garrick went down beside her.', salience: 4, source: 'engine', tags: ['fight-cost'] };

    it('an engine wound stays engine and goes dormant after its six untouched cadences', () => {
        let state = gameReducer(withMessages(10), { type: 'ADD_STORY_MEMORY_CARD', payload: wound });
        const { id } = state.storyMemory[0];
        state = { ...state, messages: talk(14) };
        state = gameReducer(state, {
            type: 'ADD_STORY_MEMORY_CARD',
            payload: { type: 'wound', subject: 'The ambush at Kettle Ford', text: 'The spear wound from Kettle Ford still aches.', salience: 3 },
        });
        expect(state.storyMemory).toHaveLength(1);
        expect(state.storyMemory[0].source).toBe('engine');
        expect(state.storyMemory[0].id).toBe(id);
        expect(state.storyMemory[0].lastSeenMessage).toBe(14);

        const journal = Array.from({ length: WOUND_DORMANCY_JOURNAL_CYCLES }, (_, i) => entry(20 + i * 10));
        expect(applyStoryMemoryDormancy(state.storyMemory, journal)[0].status).toBe('dormant');
    });

    it('an id-less re-report of a Scribe card keeps the card id', () => {
        let state = gameReducer(withMessages(2), {
            type: 'ADD_STORY_MEMORY_CARD',
            payload: { type: 'promise', subject: 'Mara', text: 'The hero promised Mara a ride to the coast.' },
        });
        const { id } = state.storyMemory[0];
        state = gameReducer(state, {
            type: 'ADD_STORY_MEMORY_CARD',
            payload: { type: 'promise', subject: 'Mara', text: 'The hero promised Mara a ride to the coast before the thaw.' },
        });
        expect(state.storyMemory).toHaveLength(1);
        expect(state.storyMemory[0].id).toBe(id);
        expect(state.storyMemory[0].source).toBe('scribe');
    });
});

describe('P2 — one birth composer', () => {
    it('the lane card and the roster promotion carry the same birth stamps', () => {
        const base = withMessages(6);
        const lane = gameReducer(base, {
            type: 'ADD_STORY_MEMORY_CARD',
            payload: { type: 'mystery', subject: 'Lantern', text: 'A green lantern moves on the marsh.' },
            meta: { sourceMessage: 'msg-5' },
        }).storyMemory[0];
        const promoted = gameReducer(base, {
            type: 'UPDATE_NPC',
            payload: { name: 'Odo Grells', disposition: 'neutral', agenda: 'Corner the eel market before winter.' },
        }).storyMemory.find(card => card.source === 'npc_roster');
        for (const card of [lane, promoted]) {
            expect(card.firstSeenMessage).toBe(6);
            expect(card.lastSeenMessage).toBe(6);
        }
        expect(lane.sourceMessage).toBe('msg-5');
        expect(promoted.sourceMessage).toBeUndefined();
    });

    it('a refreshed promotion is seen now on the conversational clock', () => {
        const born = gameReducer(withMessages(2), {
            type: 'UPDATE_NPC',
            payload: { name: 'Odo Grells', disposition: 'neutral', agenda: 'Corner the eel market before winter.' },
        });
        const refreshed = gameReducer({ ...born, messages: talk(9) }, {
            type: 'UPDATE_NPC',
            payload: { name: 'Odo Grells', stanceToPlayer: 'Resents the hero for undercutting his prices.' },
        });
        const card = refreshed.storyMemory.find(c => c.source === 'npc_roster');
        expect(card.firstSeenMessage).toBe(2);
        expect(card.lastSeenMessage).toBe(9);
    });

    it('bornStoryMemoryCard stamps a source only when one is given', () => {
        expect(bornStoryMemoryCard({ id: 'a' }, 3)).toEqual({ id: 'a', firstSeenMessage: 3, lastSeenMessage: 3 });
        expect(bornStoryMemoryCard({ id: 'a' }, 3, { sourceMessage: 'm' }).sourceMessage).toBe('m');
        expect(bornStoryMemoryCard(null, 3)).toBeNull();
    });
});

describe('P2 — dormancy reads the conversational clock', () => {
    const lowCard = { id: 'c', type: 'callback', text: 'A minor rumour about the tanner.', salience: 2, status: 'active', lastSeenMessage: 30, firstSeenMessage: 30, lastSeenAt: 5_000 };

    it('a card touched after the cutoff entry\'s range stays active whatever the wall-clock says', () => {
        // Wall-clock: every entry is NEWER than the card (it would go dormant on the old clock).
        const journal = [entry(25, 9_000), entry(40, 9_100), entry(50, 9_200)];
        expect(applyStoryMemoryDormancy([lowCard], journal)[0].status).toBe('active');
    });

    it('a card untouched since before the cutoff goes dormant whatever the wall-clock says', () => {
        // Wall-clock: every entry is OLDER than the card (it would stay active on the old clock).
        const journal = [entry(35, 1_000), entry(45, 1_100), entry(55, 1_200)];
        expect(applyStoryMemoryDormancy([lowCard], journal)[0].status).toBe('dormant');
    });

    it('a legacy card (no message stamps) or a legacy entry (no range) falls back to wall-clock', () => {
        const legacy = { id: 'l', type: 'callback', text: 'Old.', salience: 1, status: 'active', lastSeenAt: 500 };
        const journal = [entry(35, 1_000), entry(45, 1_100), entry(55, 1_200)];
        expect(applyStoryMemoryDormancy([legacy], journal)[0].status).toBe('dormant');
        const legacyJournal = [{ timestamp: 1 }, { timestamp: 2 }, { timestamp: 3 }];
        expect(applyStoryMemoryDormancy([lowCard], legacyJournal)[0].status).toBe('active');
    });

    it('compareCardRecency prefers the message stamp, falls back to wall-clock', () => {
        const a = { lastSeenMessage: 10, lastSeenAt: 1 };
        const b = { lastSeenMessage: 20, lastSeenAt: 0 };
        expect([a, b].sort(compareCardRecency)[0]).toBe(b);
        expect([{ lastSeenAt: 1 }, { lastSeenAt: 5 }].sort(compareCardRecency)[0].lastSeenAt).toBe(5);
    });
});

describe('P2 nit — the shelved helpers', () => {
    it('toFlag reads worded false; strictFlag reads only true', () => {
        expect(['false', 'no', '0', 'off', '', ' none '].map(toFlag)).toEqual([false, false, false, false, false, false]);
        expect(['yes', 'true', 1, true].map(toFlag)).toEqual([true, true, true, true]);
        expect([true, 'true', ' TRUE '].map(strictFlag)).toEqual([true, true, true]);
        expect([1, 'yes', {}, null].map(strictFlag)).toEqual([false, false, false, false]);
    });

    it('clampNumber rounds into range or falls back', () => {
        expect(clampNumber('7', 1, 5, 3)).toBe(5);
        expect(clampNumber(-2, 0, 5, 2)).toBe(0);
        expect(clampNumber('x', 0, 5, 2)).toBe(2);
    });

    it('conversationalAgeSince skips system rows and answers null without a stamp', () => {
        const messages = [...talk(4), { role: 'system', content: 'roll' }, ...talk(2)];
        expect(conversationalAgeSince(2, { messages })).toBe(4);
        expect(conversationalAgeSince(undefined, { messages })).toBeNull();
        expect(conversationalAgeSince(3, { messageCount: 10 })).toBe(7);
    });

    it('clampMessageStamp floors and clamps to the transcript', () => {
        expect(clampMessageStamp('12.7', 10)).toBe(10);
        expect(clampMessageStamp(-4)).toBe(0);
        expect(clampMessageStamp('junk')).toBeNull();
    });
});
