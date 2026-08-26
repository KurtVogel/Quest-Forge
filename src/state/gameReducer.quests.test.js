import { describe, expect, it } from 'vitest';
import { gameReducer, initialGameState } from './gameReducer.js';

describe('quest identity', () => {
    it('updates an existing active quest instead of duplicating its normalized name', () => {
        const first = gameReducer(initialGameState, {
            type: 'ADD_QUEST',
            payload: { name: "The Alderman's Bounty", description: 'Speak to Alderman Thorne.' },
        });
        const second = gameReducer(first, {
            type: 'ADD_QUEST',
            payload: { name: "The Alderman’s Bounty", description: 'Clear the goblin threat.' },
        });

        expect(second.quests).toHaveLength(1);
        expect(second.quests[0]).toMatchObject({
            name: "The Alderman’s Bounty",
            description: 'Clear the goblin threat.',
            status: 'active',
        });
        expect(second.quests[0].id).toBe(first.quests[0].id);
    });

    it('completes a quest by stable id or normalized name', () => {
        const added = gameReducer(initialGameState, {
            type: 'ADD_QUEST',
            payload: { id: 'quest-bounty', name: "The Alderman's Bounty" },
        });
        const byName = gameReducer(added, {
            type: 'COMPLETE_QUEST',
            payload: { name: "the alderman’s bounty" },
        });

        expect(byName.quests[0].status).toBe('completed');
    });

    it('fails a quest by stable id or normalized name and leaves others untouched', () => {
        const added = gameReducer(gameReducer(initialGameState, {
            type: 'ADD_QUEST',
            payload: { id: 'quest-debt', name: 'Collect the Debt' },
        }), {
            type: 'ADD_QUEST',
            payload: { id: 'quest-rats', name: 'Clear the Cellar Rats' },
        });

        const failed = gameReducer(added, {
            type: 'FAIL_QUEST',
            payload: { name: 'collect the debt' },
        });
        expect(failed.quests.find(q => q.id === 'quest-debt').status).toBe('failed');
        expect(failed.quests.find(q => q.id === 'quest-rats').status).toBe('active');
    });

    it('records an unmatched named terminal update as finished table history (playtest #14)', () => {
        // A quest arc the DM opens and resolves in ONE response never existed in
        // state — the terminal update must record it, not vanish.
        const completed = gameReducer(initialGameState, {
            type: 'COMPLETE_QUEST',
            payload: { name: "The Ferrywoman's Letter", description: 'Delivered the sealed letter to Aune.' },
        });
        expect(completed.quests).toHaveLength(1);
        expect(completed.quests[0]).toMatchObject({
            name: "The Ferrywoman's Letter",
            description: 'Delivered the sealed letter to Aune.',
            status: 'completed',
        });

        const added = gameReducer(initialGameState, {
            type: 'ADD_QUEST',
            payload: { id: 'quest-debt', name: 'Collect the Debt' },
        });
        const next = gameReducer(added, { type: 'FAIL_QUEST', payload: { name: 'A Quest That Never Was' } });
        expect(next.quests.find(q => q.id === 'quest-debt').status).toBe('active');
        expect(next.quests.find(q => q.name === 'A Quest That Never Was')).toMatchObject({ status: 'failed' });
    });

    it('keeps unmatched bare-string terminal refs as no-ops (panel buttons, stale ids)', () => {
        const added = gameReducer(initialGameState, {
            type: 'ADD_QUEST',
            payload: { id: 'quest-debt', name: 'Collect the Debt' },
        });
        const next = gameReducer(added, { type: 'COMPLETE_QUEST', payload: 'quest-gone-stale' });
        expect(next.quests).toHaveLength(1);
        expect(next.quests[0].status).toBe('active');
    });
});

describe('REMOVE_QUEST and bare-id completion (2026-08-04 queue P2)', () => {
    it('REMOVE_QUEST deletes exactly the referenced quest (both panel ✕ buttons ride this)', () => {
        let state = gameReducer(initialGameState, { type: 'ADD_QUEST', payload: { id: 'q-keep', name: 'Keep Me' } });
        state = gameReducer(state, { type: 'ADD_QUEST', payload: { id: 'q-drop', name: 'Drop Me' } });
        const next = gameReducer(state, { type: 'REMOVE_QUEST', payload: 'q-drop' });
        expect(next.quests).toHaveLength(1);
        expect(next.quests[0].id).toBe('q-keep');
        // Unknown id is a harmless no-op.
        expect(gameReducer(next, { type: 'REMOVE_QUEST', payload: 'q-gone' }).quests).toHaveLength(1);
    });

    it('completes a quest by MATCHED bare id string (the panel button path)', () => {
        const added = gameReducer(initialGameState, {
            type: 'ADD_QUEST',
            payload: { id: 'quest-debt', name: 'Collect the Debt' },
        });
        const next = gameReducer(added, { type: 'COMPLETE_QUEST', payload: 'quest-debt' });
        expect(next.quests).toHaveLength(1);
        expect(next.quests[0]).toMatchObject({ id: 'quest-debt', status: 'completed' });
    });
});

describe('engine-owned quest completion XP (rpg-balance-master ruling 2026-08-22)', () => {
    const hero = {
        name: 'Astra',
        race: 'human',
        class: 'fighter',
        level: 2,
        exp: 0,
        maxHP: 20,
        currentHP: 20,
        abilityScores: { strength: 16, dexterity: 12, constitution: 14, intelligence: 10, wisdom: 10, charisma: 8 },
        features: [],
        classResources: {},
        hitDice: { total: 2, remaining: 2, die: 10 },
    };
    const message = (i) => ({ id: `m-${i}`, role: 'assistant', content: `turn ${i}`, timestamp: i });
    const withHero = () => ({ ...initialGameState, character: { ...hero } });
    const passTurns = (state, count) => ({
        ...state,
        messages: [...state.messages, ...Array.from({ length: count }, (_, i) => message(state.messages.length + i))],
    });

    it('pays the full tier (12.5% of threshold) for a tracked quest completed on a later turn', () => {
        let state = gameReducer(withHero(), { type: 'ADD_QUEST', payload: { id: 'q-rats', name: 'Clear the Cellar Rats' } });
        state = passTurns(state, 4);
        const next = gameReducer(state, { type: 'COMPLETE_QUEST', payload: { id: 'q-rats', name: 'Clear the Cellar Rats' } });

        expect(next.quests[0].status).toBe('completed');
        expect(next.character.exp).toBe(75); // 12.5% of the 600 XP L2→3 threshold
        expect(next.messages.at(-1).content).toContain('quest completed: Clear the Cellar Rats');
    });

    it('caps a quest opened and closed in the SAME turn at the flat instant tier', () => {
        const state = gameReducer(withHero(), { type: 'ADD_QUEST', payload: { id: 'q-fast', name: 'Fetch the Ledger' } });
        const next = gameReducer(state, { type: 'COMPLETE_QUEST', payload: { id: 'q-fast', name: 'Fetch the Ledger' } });
        expect(next.character.exp).toBe(25);
    });

    it('pays the never-tracked fallback insert the flat instant tier only', () => {
        const next = gameReducer(withHero(), {
            type: 'COMPLETE_QUEST',
            payload: { name: "The Ferrywoman's Letter", description: 'Delivered off-screen.' },
        });
        expect(next.quests[0].status).toBe('completed');
        expect(next.character.exp).toBe(25);
    });

    it('pays NOTHING for a failed quest — matched or never-tracked', () => {
        let state = gameReducer(withHero(), { type: 'ADD_QUEST', payload: { id: 'q-debt', name: 'Collect the Debt' } });
        state = passTurns(state, 4);
        const failed = gameReducer(state, { type: 'FAIL_QUEST', payload: { id: 'q-debt', name: 'Collect the Debt' } });
        expect(failed.quests[0].status).toBe('failed');
        expect(failed.character.exp).toBe(0);

        const fallbackFailed = gameReducer(withHero(), { type: 'FAIL_QUEST', payload: { name: 'A Doomed Errand' } });
        expect(fallbackFailed.character.exp).toBe(0);
    });

    it('never pays twice: re-emitting the same completion on a later turn re-writes a terminal status without XP', () => {
        let state = gameReducer(withHero(), { type: 'ADD_QUEST', payload: { id: 'q-rats', name: 'Clear the Cellar Rats' } });
        state = passTurns(state, 4);
        state = gameReducer(state, { type: 'COMPLETE_QUEST', payload: { id: 'q-rats', name: 'Clear the Cellar Rats' } });
        expect(state.character.exp).toBe(75);

        state = passTurns(state, 3);
        const replay = gameReducer(state, { type: 'COMPLETE_QUEST', payload: { id: 'q-rats', name: 'Clear the Cellar Rats' } });
        expect(replay.character.exp).toBe(75); // unchanged
        expect(replay.quests).toHaveLength(1);
    });

    it('treats a pre-ruling row without openedAtMessage as not-same-turn (full tier, non-exploitable direction)', () => {
        const state = {
            ...withHero(),
            quests: [{ id: 'q-old', name: 'An Old Promise', status: 'active', addedAt: 1 }],
        };
        const next = gameReducer(state, { type: 'COMPLETE_QUEST', payload: { id: 'q-old', name: 'An Old Promise' } });
        expect(next.character.exp).toBe(75);
    });

    it('untrusted payloads cannot pre-age openedAtMessage to fake the full tier', () => {
        let state = withHero();
        state = passTurns(state, 6);
        // A hostile/echoed payload claiming the quest opened long ago must still
        // be stamped with the CURRENT message count on creation.
        state = gameReducer(state, { type: 'ADD_QUEST', payload: { id: 'q-inject', name: 'Instant Riches', openedAtMessage: 0 } });
        const next = gameReducer(state, { type: 'COMPLETE_QUEST', payload: { id: 'q-inject', name: 'Instant Riches' } });
        expect(next.character.exp).toBe(25);
    });

    it('completes without XP or crash when no character exists yet', () => {
        const state = gameReducer(initialGameState, { type: 'ADD_QUEST', payload: { id: 'q-pre', name: 'Prologue Task' } });
        const next = gameReducer(state, { type: 'COMPLETE_QUEST', payload: { id: 'q-pre', name: 'Prologue Task' } });
        expect(next.quests[0].status).toBe('completed');
        expect(next.character).toBeNull();
    });
});

describe('fuzzy quest-name identity (Terra playtest P3, ruling follow-up 2026-08-26)', () => {
    it('a drifted completion name closes the tracked quest instead of minting a phantom second row', () => {
        const added = gameReducer(initialGameState, {
            type: 'ADD_QUEST',
            payload: { id: 'q-relic', name: 'Find the Relic of Kel' },
        });
        const next = gameReducer(added, { type: 'COMPLETE_QUEST', payload: { name: 'The Relic of Kel' } });
        expect(next.quests).toHaveLength(1);
        expect(next.quests[0]).toMatchObject({ id: 'q-relic', status: 'completed' });
    });

    it('an ambiguous fuzzy match falls through to the fallback insert — never a guess', () => {
        let state = gameReducer(initialGameState, { type: 'ADD_QUEST', payload: { id: 'q-1', name: 'The Cellar Rats' } });
        state = gameReducer(state, { type: 'ADD_QUEST', payload: { id: 'q-2', name: 'Rats in the Cellar Shrine' } });
        const next = gameReducer(state, { type: 'COMPLETE_QUEST', payload: { name: 'Cellar Rats Dealt With', description: 'd' } });
        expect(next.quests.find(q => q.id === 'q-1').status).toBe('active');
        expect(next.quests.find(q => q.id === 'q-2').status).toBe('active');
        expect(next.quests).toHaveLength(3); // recorded as its own table history
    });

    it('a re-emitted completion with drifted phrasing is a harmless terminal re-write — no second row, no XP', () => {
        const hero = { name: 'Astra', race: 'human', class: 'fighter', level: 2, exp: 0, maxHP: 20, currentHP: 20, abilityScores: { strength: 16, dexterity: 12, constitution: 14, intelligence: 10, wisdom: 10, charisma: 8 }, features: [], classResources: {}, hitDice: { total: 2, remaining: 2, die: 10 } };
        let state = gameReducer({ ...initialGameState, character: hero }, {
            type: 'ADD_QUEST',
            payload: { id: 'q-debt', name: 'Collect the Ferry Debt' },
        });
        state = gameReducer(state, { type: 'COMPLETE_QUEST', payload: { id: 'q-debt', name: 'Collect the Ferry Debt' } });
        const paidOnce = state.character.exp;
        const replay = gameReducer(state, { type: 'COMPLETE_QUEST', payload: { name: 'The Ferry Debt' } });
        expect(replay.quests).toHaveLength(1);
        expect(replay.character.exp).toBe(paidOnce);
    });

    it('ADD_QUEST "updated" with a drifted name refreshes the tracked arc instead of duplicating it', () => {
        const added = gameReducer(initialGameState, {
            type: 'ADD_QUEST',
            payload: { id: 'q-relic', name: 'Find the Relic of Kel', description: 'It was lost long ago.' },
        });
        const next = gameReducer(added, {
            type: 'ADD_QUEST',
            payload: { name: 'The Relic of Kel', description: 'The trail leads to the sunken vault.' },
        });
        expect(next.quests).toHaveLength(1);
        expect(next.quests[0].description).toBe('The trail leads to the sunken vault.');
    });
});

describe('finished quests stay closed (documented 2026-07-23)', () => {
    it('a new quest reusing a completed quest name opens a NEW arc instead of reopening the old one', () => {
        const state = {
            ...initialGameState,
            quests: [{ id: 'q1', name: 'Guard the Caravan', status: 'completed', addedAt: 1 }],
        };
        const next = gameReducer(state, {
            type: 'ADD_QUEST',
            payload: { name: 'Guard the Caravan', description: 'A second run north.' },
        });

        expect(next.quests).toHaveLength(2);
        expect(next.quests[0]).toMatchObject({ id: 'q1', status: 'completed' }); // history intact
        expect(next.quests[1]).toMatchObject({ name: 'Guard the Caravan', status: 'active', description: 'A second run north.' });
        expect(next.quests[1].id).not.toBe('q1');
    });
});
