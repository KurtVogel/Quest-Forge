/**
 * The 2026-10-23 quests queue (Lap 1, every finding measured by the auditor
 * against the real reducer and wire):
 *
 *  P1 — a quest completion / front resolution crossing a level stood a DOWN
 *       hero up (`foldExperience` without `keepDowned`; DECISIONS 2026-10-14
 *       point 2 applied to the DM's `exp_awarded` lane only).
 *  P1 — on the close lane an id was still identity: a ref pairing one arc's
 *       name with another's id closed BOTH arcs and paid one.
 *  P2 — closure words outside the alias table read as `new`.
 *  P2 — the "harmless terminal rewrite" flipped ACROSS terminal statuses.
 *  P2 — two silent outcomes: an ambiguous fuzzy close minted a phantom third
 *       row; an id-only close that matched nothing said nothing.
 *  P2 nits — a fuzzy `updated` renamed the arc; numeric junk minted ids.
 */
import { describe, expect, it } from 'vitest';
import { gameReducer, initialGameState } from './gameReducer.js';
import { normalizeEvents } from '../llm/eventChannels.js';

const hero = {
    name: 'Astra',
    race: 'human',
    class: 'fighter',
    level: 2,
    exp: 0,
    maxHP: 20,
    currentHP: 20,
    abilityScores: { strength: 16, dexterity: 12, constitution: 14, intelligence: 10, wisdom: 10, charisma: 8 },
    conditions: [],
    features: [],
    classResources: {},
    hitDice: { total: 2, remaining: 2, die: 10 },
};
const message = (i) => ({ id: `m-${i}`, role: 'assistant', content: `turn ${i}`, timestamp: i });
const passTurns = (state, count) => ({
    ...state,
    messages: [...state.messages, ...Array.from({ length: count }, (_, i) => message(state.messages.length + i))],
});
const withHero = (overrides = {}) => ({ ...initialGameState, character: { ...hero, ...overrides } });
const dyingHero = {
    currentHP: 0,
    dying: true,
    deathSaves: { successes: 1, failures: 2 },
    conditions: ['Unconscious'],
};
const systemLines = (state) => state.messages.filter(m => m.role === 'system');

describe('a DOWN hero stays down through the engine-amount XP folds a DM channel triggers (2026-10-23 P1)', () => {
    it('a quest completion crossing a level leaves a dying hero at 0 HP with the death-save clock intact', () => {
        // 550 + the full tier (75 = 12.5 % of the 600 XP L2→3 threshold) crosses L3.
        let state = gameReducer(withHero({ ...dyingHero, exp: 550 }), { type: 'ADD_QUEST', payload: { id: 'q-summit', name: 'Reach the summit' } });
        state = passTurns(state, 4);
        const next = gameReducer(state, { type: 'COMPLETE_QUEST', payload: { id: 'q-summit', name: 'Reach the summit' } });
        expect(next.quests[0].status).toBe('completed');
        expect(next.character.level).toBe(3);
        expect(next.character.maxHP).toBeGreaterThan(20);
        expect(next.character).toMatchObject({ currentHP: 0, dying: true, deathSaves: { successes: 1, failures: 2 } });
        expect(next.character.conditions).toEqual(['Unconscious']);
        expect(next.messages.some(m => /Fully healed/.test(m.content || ''))).toBe(false);
    });

    it('a standing hero keeps the full level-up heal on a quest completion', () => {
        let state = gameReducer(withHero({ exp: 550, currentHP: 3 }), { type: 'ADD_QUEST', payload: { id: 'q-summit', name: 'Reach the summit' } });
        state = passTurns(state, 4);
        const next = gameReducer(state, { type: 'COMPLETE_QUEST', payload: { id: 'q-summit', name: 'Reach the summit' } });
        expect(next.character.level).toBe(3);
        expect(next.character.currentHP).toBe(next.character.maxHP);
    });

    it('a front resolution crossing a level leaves a dying hero down with the clock intact', () => {
        // The milestone pays 50 % of the L2 threshold (300): 350 + 300 crosses L3.
        const state = {
            ...withHero({ ...dyingHero, exp: 350 }),
            session: { id: 'campaign' },
            messages: [
                { role: 'assistant', content: 'The matriarch falls.' },
                { role: 'user', content: 'We burn the brood.' },
            ],
            fronts: [{
                id: 'front-brood', title: 'The Mill Brood', goal: 'Claim the valley.', stakes: 'The valley starves.',
                grimPortents: ['Raids begin.', 'The mill falls.', 'The valley empties.'],
                clock: 5, maxClock: 6, stage: 2, status: 'active', publicHints: [],
                faction: { name: 'The Brood', goal: 'Feed.', stance: 'Hostile', relationships: [] },
            }],
            locations: [],
        };
        const next = gameReducer(state, {
            type: 'UPDATE_FRONT',
            payload: { id: 'front-brood', status: 'resolved', notes: 'The hero slew the matriarch.' },
        });
        expect(next.fronts[0].status).toBe('resolved');
        expect(next.character.level).toBe(3);
        expect(next.character).toMatchObject({ currentHP: 0, dying: true, deathSaves: { successes: 1, failures: 2 } });
        expect(next.character.conditions).toEqual(['Unconscious']);
        expect(next.messages.some(m => /Fully healed/.test(m.content || ''))).toBe(false);
    });
});

describe('on the close lane the id is a hint, the name is identity (2026-10-23 P1)', () => {
    const twoArcs = () => {
        let state = gameReducer(withHero(), { type: 'ADD_QUEST', payload: { id: 'q-relic', name: 'Find the Relic of Kel' } });
        state = gameReducer(state, { type: 'ADD_QUEST', payload: { id: 'q-caravan', name: 'Escort the salt caravan' } });
        return passTurns(state, 4);
    };

    it('a ref pairing the caravan\'s name with the relic\'s id closes the caravan ALONE and pays it', () => {
        const next = gameReducer(twoArcs(), {
            type: 'COMPLETE_QUEST',
            payload: { id: 'q-relic', name: 'Escort the salt caravan', status: 'completed' },
        });
        expect(next.quests.find(q => q.id === 'q-relic').status).toBe('active');
        expect(next.quests.find(q => q.id === 'q-caravan').status).toBe('completed');
        expect(next.quests).toHaveLength(2);
        expect(next.character.exp).toBe(75);
        expect(next.messages.at(-1).content).toContain('quest completed: Escort the salt caravan');
    });

    it('an id whose name agrees fuzzily still closes by the id; an id-only ref keeps its by-id close', () => {
        const fuzzy = gameReducer(twoArcs(), { type: 'COMPLETE_QUEST', payload: { id: 'q-relic', name: 'The Relic of Kel' } });
        expect(fuzzy.quests.find(q => q.id === 'q-relic').status).toBe('completed');
        expect(fuzzy.quests.find(q => q.id === 'q-caravan').status).toBe('active');

        const idOnly = gameReducer(twoArcs(), { type: 'COMPLETE_QUEST', payload: { id: 'q-caravan' } });
        expect(idOnly.quests.find(q => q.id === 'q-caravan').status).toBe('completed');
        expect(idOnly.quests.find(q => q.id === 'q-relic').status).toBe('active');
        expect(idOnly.character.exp).toBe(75);
    });

    it('a name the record never held beside a wrong id records ITS OWN finished row, never the id\'s arc', () => {
        const next = gameReducer(twoArcs(), {
            type: 'COMPLETE_QUEST',
            payload: { id: 'q-relic', name: 'Deliver the letter' },
        });
        expect(next.quests.find(q => q.id === 'q-relic').status).toBe('active');
        expect(next.quests).toHaveLength(3);
        expect(next.quests.at(-1)).toMatchObject({ name: 'Deliver the letter', status: 'completed' });
        expect(next.quests.at(-1).id).not.toBe('q-relic');
        expect(next.character.exp).toBe(0);
    });
});

describe('a finished quest never changes its ending (2026-10-23 P2)', () => {
    const completedArc = () => {
        let state = gameReducer(withHero(), { type: 'ADD_QUEST', payload: { id: 'q-debt', name: 'Collect the Ferry Debt' } });
        state = passTurns(state, 2);
        state = gameReducer(state, { type: 'COMPLETE_QUEST', payload: { id: 'q-debt', name: 'Collect the Ferry Debt' } });
        return passTurns(state, 7);
    };

    it('the same terminal status re-emitted is a silent no-op — the one-shot guard', () => {
        const state = completedArc();
        const replay = gameReducer(state, { type: 'COMPLETE_QUEST', payload: { id: 'q-debt', name: 'Collect the Ferry Debt' } });
        expect(replay).toBe(state);
    });

    it('a `failed` carrying a completed row\'s id is refused with a dmVisible ⚖ line — status, close stamp and XP untouched', () => {
        const state = completedArc();
        const row = state.quests[0];
        expect(row).toMatchObject({ status: 'completed', closedAtMessage: 2 });
        const flipped = gameReducer(state, { type: 'FAIL_QUEST', payload: { id: 'q-debt', name: 'Collect the Ferry Debt' } });
        expect(flipped.quests[0]).toMatchObject({ status: 'completed', closedAtMessage: 2 });
        expect(flipped.character.exp).toBe(state.character.exp);
        const line = flipped.messages.at(-1);
        expect(line).toMatchObject({ role: 'system', dmVisible: true });
        expect(line.content).toMatch(/^⚖ "Collect the Ferry Debt" already ended as completed/);
        expect(flipped.quests).toHaveLength(1);
    });

    it('a reused name with an ACTIVE arc 2 still closes arc 2 alone — the refusal is for terminal-only matches', () => {
        let state = completedArc();
        state = gameReducer(state, { type: 'ADD_QUEST', payload: { name: 'Collect the Ferry Debt' } });
        state = passTurns(state, 3);
        const next = gameReducer(state, { type: 'FAIL_QUEST', payload: { name: 'Collect the Ferry Debt' } });
        expect(next.quests.map(q => q.status)).toEqual(['completed', 'failed']);
    });
});

describe('the close lane says what it did not do (2026-10-23 P2)', () => {
    it('an ambiguous fuzzy close records nothing and posts ONE dmVisible ⚖ line naming the candidates', () => {
        let state = gameReducer(withHero(), { type: 'ADD_QUEST', payload: { id: 'q-find', name: 'Find the Relic of Kel' } });
        state = gameReducer(state, { type: 'ADD_QUEST', payload: { id: 'q-return', name: 'Return the Relic of Kel' } });
        state = passTurns(state, 3);
        const next = gameReducer(state, { type: 'COMPLETE_QUEST', payload: { name: 'The Relic of Kel', description: 'd' } });
        expect(next.quests).toHaveLength(2);
        expect(next.quests.every(q => q.status === 'active')).toBe(true);
        expect(next.character.exp).toBe(0);
        const lines = systemLines(next);
        expect(lines).toHaveLength(1);
        expect(lines[0]).toMatchObject({ dmVisible: true });
        expect(lines[0].content).toContain('matches 2 tracked quests');
        expect(lines[0].content).toContain('"Find the Relic of Kel"');
        expect(lines[0].content).toContain('"Return the Relic of Kel"');
        expect(lines[0].content).toContain('nothing was completed');
    });

    it('a name outside every fuzzy family still records its own table history (the old "ambiguous" pin was never a fuzzy match)', () => {
        let state = gameReducer(initialGameState, { type: 'ADD_QUEST', payload: { id: 'q-1', name: 'The Cellar Rats' } });
        state = gameReducer(state, { type: 'ADD_QUEST', payload: { id: 'q-2', name: 'Rats in the Cellar Shrine' } });
        const next = gameReducer(state, { type: 'COMPLETE_QUEST', payload: { name: 'Cellar Rats Dealt With', description: 'd' } });
        expect(next.quests.find(q => q.id === 'q-1').status).toBe('active');
        expect(next.quests.find(q => q.id === 'q-2').status).toBe('active');
        expect(next.quests).toHaveLength(3);
        expect(systemLines(next)).toHaveLength(0);
    });

    it('an id-only close whose id matches nothing posts ONE dmVisible ⚖ line and changes no row', () => {
        let state = gameReducer(withHero(), { type: 'ADD_QUEST', payload: { id: 'q-relic', name: 'Find the Relic of Kel' } });
        state = passTurns(state, 2);
        const next = gameReducer(state, { type: 'COMPLETE_QUEST', payload: { id: 'q-stale' } });
        expect(next.quests).toEqual(state.quests);
        expect(next.character.exp).toBe(0);
        const lines = systemLines(next);
        expect(lines).toHaveLength(1);
        expect(lines[0]).toMatchObject({ dmVisible: true });
        expect(lines[0].content).toContain('No tracked quest has the id "q-stale"');

        // The panel's bare-string ✓ on a stale id stays a silent no-op.
        expect(gameReducer(state, { type: 'COMPLETE_QUEST', payload: 'q-stale' })).toBe(state);
    });
});

describe('the 2026-10-23 nits', () => {
    it('a fuzzy `updated` keeps the held (longer) name; an exact match still replaces the text', () => {
        const added = gameReducer(initialGameState, {
            type: 'ADD_QUEST',
            payload: { id: 'q-relic', name: 'Find the Relic of Kel', description: 'Lost long ago.' },
        });
        const drifted = gameReducer(added, { type: 'ADD_QUEST', payload: { name: 'The Relic of Kel', description: 'The trail leads to the vault.' } });
        expect(drifted.quests).toHaveLength(1);
        expect(drifted.quests[0]).toMatchObject({ name: 'Find the Relic of Kel', description: 'The trail leads to the vault.' });

        const byGatedId = gameReducer(added, { type: 'ADD_QUEST', payload: { id: 'q-relic', name: 'The Relic of Kel' } });
        expect(byGatedId.quests[0].name).toBe('Find the Relic of Kel');

        const exact = gameReducer(added, { type: 'ADD_QUEST', payload: { name: 'Find the relic of Kel!' } });
        expect(exact.quests[0].name).toBe('Find the relic of Kel!');
    });

    it('numeric junk never spells itself into an id — only a safe integer stringifies', () => {
        const updates = (list) => normalizeEvents({ quest_updates: list }).questUpdates;
        expect(updates([{ id: NaN, name: 'A' }, { id: 1e21, name: 'B' }, { id: Infinity, name: 'C' }, { id: 7, name: 'D' }]))
            .toEqual([{ name: 'A', status: 'new' }, { name: 'B', status: 'new' }, { name: 'C', status: 'new' }, { id: '7', name: 'D', status: 'new' }]);
        // An id-only terminal update with a junk id has no identity at all.
        expect(updates([{ id: NaN, status: 'completed' }])).toEqual([]);
    });
});

describe('the quest wire reads closure words (2026-10-23 P2)', () => {
    const statusOf = (status) => normalizeEvents({ quest_updates: [{ name: 'Find the ferry', status }] }).questUpdates[0].status;

    it('the failed / abandoned side closes the arc as failed', () => {
        for (const word of ['cancelled', 'canceled', 'dropped', 'declined', 'expired', 'lost', 'forfeited', 'rejected', 'given up', 'given_up', 'gave up', 'abandoned', 'Cancelled.', 'GIVEN UP!']) {
            expect(statusOf(word), word).toBe('failed');
        }
    });

    it('`closed` is `resolved`\'s sibling — completed; trailing punctuation and symbols are stripped before the lookup', () => {
        for (const word of ['closed', 'Closed.', 'complete!', 'Completed ✓', 'done!!', 'resolved ✔']) {
            expect(statusOf(word), word).toBe('completed');
        }
        expect(statusOf('in-progress')).toBe('updated');
        expect(statusOf('failed...')).toBe('failed');
    });

    it('an unrecognised NON-empty status is `updated`; a MISSING status keeps `new`', () => {
        expect(statusOf('pending')).toBe('updated');
        expect(statusOf('???')).toBe('new'); // symbols only — nothing was said
        expect(normalizeEvents({ quest_updates: [{ name: 'Find the ferry' }] }).questUpdates[0].status).toBe('new');
        expect(normalizeEvents({ quest_updates: [{ name: 'Find the ferry', status: '' }] }).questUpdates[0].status).toBe('new');
        // An unknown word on an id-only row has no name to open with: dropped, as before.
        expect(normalizeEvents({ quest_updates: [{ id: 'q-1', status: 'pending' }] }).questUpdates).toEqual([]);
    });
});
