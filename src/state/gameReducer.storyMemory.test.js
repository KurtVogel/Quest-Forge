/**
 * Tests for the ADD_STORY_MEMORY_CARD(S) and UPDATE_STORY_MEMORY reducer actions.
 * Card normalization itself is covered by engine/storyMemory.test.js; these tests
 * cover the reducer's merge-vs-append and lookup logic.
 */
import { describe, expect, it } from 'vitest';
import { gameReducer, initialGameState } from './gameReducer.js';

describe('ADD_STORY_MEMORY_CARD', () => {
    it('appends a brand-new card', () => {
        const next = gameReducer(initialGameState, {
            type: 'ADD_STORY_MEMORY_CARD',
            payload: { text: 'The hero promised to return the sword.', subject: 'sword promise', type: 'promise' },
        });
        expect(next.storyMemory).toHaveLength(1);
        expect(next.storyMemory[0].text).toMatch(/promised to return/);
    });

    it('ignores a card with no usable text', () => {
        const next = gameReducer(initialGameState, {
            type: 'ADD_STORY_MEMORY_CARD',
            payload: { subject: 'no text here' },
        });
        expect(next).toBe(initialGameState);
    });

    it('merges a reworded restatement of the same beat instead of duplicating (2026-07-14 eval)', () => {
        const first = gameReducer(initialGameState, {
            type: 'ADD_STORY_MEMORY_CARD',
            payload: {
                type: 'promise',
                subject: 'Sundial, Oren, Jack',
                text: "Jack's promise to Oren to mend the cracked sundial before the harvest.",
                salience: 3,
            },
        });
        const second = gameReducer(first, {
            type: 'ADD_STORY_MEMORY_CARD',
            payload: {
                type: 'promise',
                subject: 'Oren and the sundial',
                text: "Jack's broken promise to Oren to mend the cracked sundial, now amidst the valley's collapse.",
                salience: 4,
            },
        });
        expect(second.storyMemory).toHaveLength(1);
        expect(second.storyMemory[0].text).toMatch(/broken promise/);
        expect(second.storyMemory[0].salience).toBe(4);
    });

    it('keeps the richer text when a near-duplicate fragment arrives', () => {
        const first = gameReducer(initialGameState, {
            type: 'ADD_STORY_MEMORY_CARD',
            payload: {
                type: 'npcAgenda',
                subject: 'Greenhouse Raider',
                text: 'The Greenhouse Raider intends to finish the job his crew started hours ago and secure the conservatory.',
            },
        });
        const second = gameReducer(first, {
            type: 'ADD_STORY_MEMORY_CARD',
            payload: {
                type: 'npcAgenda',
                subject: 'Greenhouse Raider',
                text: 'Raider intends to finish the job his crew started.',
            },
        });
        expect(second.storyMemory).toHaveLength(1);
        expect(second.storyMemory[0].text).toMatch(/secure the conservatory/);
    });

    it('merges into an existing card with the same subject and type instead of duplicating', () => {
        const first = gameReducer(initialGameState, {
            type: 'ADD_STORY_MEMORY_CARD',
            payload: { text: 'Owes a debt to the blacksmith.', subject: 'blacksmith debt', type: 'promise', tags: ['debt'] },
        });
        const second = gameReducer(first, {
            type: 'ADD_STORY_MEMORY_CARD',
            payload: { text: 'Debt is growing larger.', subject: 'blacksmith debt', type: 'promise', tags: ['money'] },
        });
        expect(second.storyMemory).toHaveLength(1);
        expect(second.storyMemory[0].text).toMatch(/growing larger/);
        expect(second.storyMemory[0].tags).toEqual(expect.arrayContaining(['debt', 'money']));
    });
});

describe('ADD_STORY_MEMORY_CARDS', () => {
    it('adds every card in the batch', () => {
        const next = gameReducer(initialGameState, {
            type: 'ADD_STORY_MEMORY_CARDS',
            payload: [
                { text: 'First card text.', subject: 'first' },
                { text: 'Second card text.', subject: 'second' },
            ],
        });
        expect(next.storyMemory).toHaveLength(2);
    });

    it('handles an empty batch without error', () => {
        const next = gameReducer(initialGameState, { type: 'ADD_STORY_MEMORY_CARDS', payload: [] });
        expect(next.storyMemory).toEqual(initialGameState.storyMemory);
    });
});

describe('UPDATE_STORY_MEMORY', () => {
    function withCard() {
        return gameReducer(initialGameState, {
            type: 'ADD_STORY_MEMORY_CARD',
            payload: { text: 'The mysterious letter remains unread.', subject: 'mysterious letter', type: 'mystery' },
        });
    }

    it('updates a card matched by subject', () => {
        const state = withCard();
        const next = gameReducer(state, {
            type: 'UPDATE_STORY_MEMORY',
            payload: { subject: 'mysterious letter', status: 'resolved' },
        });
        expect(next.storyMemory[0].status).toBe('resolved');
    });

    it('marks a card used via markUsed', () => {
        const state = withCard();
        const next = gameReducer(state, {
            type: 'UPDATE_STORY_MEMORY',
            payload: { subject: 'mysterious letter', markUsed: true },
        });
        expect(next.storyMemory[0].lastUsedAt).toBeTruthy();
    });

    it('is a no-op when no card matches', () => {
        const state = withCard();
        const next = gameReducer(state, {
            type: 'UPDATE_STORY_MEMORY',
            payload: { subject: 'does not exist', status: 'resolved' },
        });
        expect(next).toBe(state);
    });

    it('is a no-op for an update with no identifying fields', () => {
        const state = withCard();
        const next = gameReducer(state, { type: 'UPDATE_STORY_MEMORY', payload: {} });
        expect(next).toBe(state);
    });

    it('refuses an ambiguous bare-subject match across card types (2026-08-06 audit)', () => {
        let state = gameReducer(initialGameState, {
            type: 'ADD_STORY_MEMORY_CARD',
            payload: { text: 'Oren guards the sluice-gate ledger jealously.', subject: 'Oren', type: 'npcAgenda' },
        });
        state = gameReducer(state, {
            type: 'ADD_STORY_MEMORY_CARD',
            payload: { text: 'The hero owes Oren an unpaid ferry debt.', subject: 'Oren', type: 'promise' },
        });
        expect(state.storyMemory).toHaveLength(2);
        // A bare "Oren" could hit either card — must touch neither.
        const ambiguous = gameReducer(state, {
            type: 'UPDATE_STORY_MEMORY',
            payload: { subject: 'Oren', status: 'resolved' },
        });
        expect(ambiguous).toBe(state);
        // Referencing the card by id still works.
        const byId = gameReducer(state, {
            type: 'UPDATE_STORY_MEMORY',
            payload: { id: state.storyMemory[1].id, status: 'resolved' },
        });
        expect(byId.storyMemory[1].status).toBe('resolved');
        expect(byId.storyMemory[0].status).toBe('active');
    });
});

describe('story-memory dormancy on the journal cadence (2026-08-06 audit)', () => {
    const OLD = Date.now() - 1000 * 60 * 60;
    const card = (over = {}) => ({
        id: over.id || `card-${Math.random().toString(36).slice(2, 8)}`,
        type: 'callback', text: 'A one-off scene beat.', subject: 'beat',
        salience: 1, emotionalCharge: 1, status: 'active',
        firstSeenAt: OLD, lastSeenAt: OLD, lastUsedAt: null,
        tags: [], linkedNpcNames: [], location: '', source: 'scribe',
        ...over,
    });
    const journalEntry = (i, timestamp) => ({ id: `j-${i}`, timestamp, summary: `entry ${i}` });

    function cadence(state) {
        return gameReducer(state, {
            type: 'ADD_JOURNAL_ENTRY',
            payload: journalEntry(Math.random().toString(36).slice(2, 6), Date.now()),
        });
    }

    it('ages low-salience silent cards to dormant after three cadences; exempts promises and player canon', () => {
        let state = {
            ...initialGameState,
            journal: [journalEntry(1, OLD + 1000), journalEntry(2, OLD + 2000)],
            storyMemory: [
                card({ id: 'stale' }),
                card({ id: 'fresh', lastSeenAt: Date.now() }),
                card({ id: 'important', salience: 4 }),
                card({ id: 'vow', type: 'promise' }),
                card({ id: 'canon', type: 'playerCanon' }),
            ],
        };
        state = cadence(state); // third entry — cutoff = first entry's timestamp
        const byId = Object.fromEntries(state.storyMemory.map(c => [c.id, c.status]));
        expect(byId).toEqual({
            stale: 'dormant',
            fresh: 'active',
            important: 'active',
            vow: 'active',
            canon: 'active',
        });
    });

    it('does nothing before three journal entries exist', () => {
        let state = { ...initialGameState, journal: [journalEntry(1, OLD)], storyMemory: [card({ id: 'stale' })] };
        state = cadence(state);
        expect(state.storyMemory[0].status).toBe('active');
    });

    it('a Scribe re-report revives a dormant card', () => {
        const state = {
            ...initialGameState,
            storyMemory: [card({ id: 'stale', status: 'dormant', text: 'The miller still owes the hero a favor.' })],
        };
        const revived = gameReducer(state, {
            type: 'ADD_STORY_MEMORY_CARD',
            payload: { type: 'callback', subject: 'beat', text: 'The miller still owes the hero a favor.' },
        });
        expect(revived.storyMemory).toHaveLength(1);
        expect(revived.storyMemory[0].status).toBe('active');
    });
});

describe('resolved is terminal on the Scribe re-report path (2026-09-06 P1)', () => {
    const messages = (n) => Array.from({ length: n }, (_, i) => ({
        id: `m${i}`, role: i % 2 ? 'assistant' : 'user', content: `line ${i}`,
    }));
    const base = {
        ...initialGameState,
        messages: messages(6),
        storyMemory: [{
            id: 'mem-vow', type: 'promise', subject: 'ferry vow',
            text: 'Aune promised the hero safe passage across the ferry line.',
            salience: 4, emotionalCharge: 3, status: 'resolved',
            firstSeenAt: 1, lastSeenAt: 1, lastUsedAt: 1,
            tags: [], linkedNpcNames: ['Aune'], location: '', source: 'scribe',
        }],
    };

    it('a Scribe re-report of a paid-off beat stays resolved (was: the merge spread flipped it active)', () => {
        const next = gameReducer(base, {
            type: 'ADD_STORY_MEMORY_CARD',
            payload: { type: 'promise', subject: 'ferry vow', text: 'Aune promised the hero safe passage across the ferry line.' },
        });
        expect(next.storyMemory).toHaveLength(1);
        expect(next.storyMemory[0].status).toBe('resolved');
    });

    it('a re-report addressed by id (the KNOWN STORY CARDS contract) stays resolved too', () => {
        const next = gameReducer(base, {
            type: 'ADD_STORY_MEMORY_CARD',
            payload: { id: 'mem-vow', type: 'promise', subject: 'ferry vow', text: 'Aune kept her promise: the hero crossed the ferry line safely.' },
        });
        expect(next.storyMemory).toHaveLength(1);
        expect(next.storyMemory[0].status).toBe('resolved');
    });

    it('only an explicit status from the DM memory_updates channel reopens a resolved card', () => {
        const next = gameReducer(base, { type: 'UPDATE_STORY_MEMORY', payload: { id: 'mem-vow', status: 'active' } });
        expect(next.storyMemory[0].status).toBe('active');
    });

    it('stamps lastSeenMessage at birth and on merge, lastUsedMessage when the DM marks a card used', () => {
        const born = gameReducer(base, {
            type: 'ADD_STORY_MEMORY_CARD',
            payload: { type: 'callback', subject: 'gate favor', text: 'The gatekeeper still owes the hero a favor for the smuggled letter.' },
        });
        expect(born.storyMemory).toHaveLength(2);
        expect(born.storyMemory[1].firstSeenMessage).toBe(6);
        expect(born.storyMemory[1].lastSeenMessage).toBe(6);
        expect(born.storyMemory[1].lastUsedMessage).toBeUndefined();

        const later = { ...born, messages: messages(8) };
        const used = gameReducer(later, {
            type: 'UPDATE_STORY_MEMORY',
            payload: { id: born.storyMemory[1].id, used: true },
        });
        expect(used.storyMemory[1].lastUsedMessage).toBe(8);
        expect(used.storyMemory[1].lastSeenMessage).toBe(8);

        const merged = gameReducer({ ...used, messages: messages(11) }, {
            type: 'ADD_STORY_MEMORY_CARD',
            payload: { type: 'callback', subject: 'gate favor', text: 'The gatekeeper still owes the hero a favor for the smuggled letter.' },
        });
        expect(merged.storyMemory).toHaveLength(2);
        expect(merged.storyMemory[1].lastSeenMessage).toBe(11);
        expect(merged.storyMemory[1].lastUsedMessage).toBe(8);
        expect(merged.storyMemory[1].firstSeenMessage).toBe(6);
    });
});
