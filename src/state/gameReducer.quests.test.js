import { describe, expect, it } from 'vitest';
import { gameReducer, initialGameState } from './gameReducer.js';
import { sanitizeQuestRecord } from './handlers/quests.js';

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

    // Flipped 2026-11-07 (identity by reference, lane 3; was the playtest #14
    // never-tracked insert): a named close that matches no id and no exact name
    // records NOTHING and says so. A one-reply arc is recorded by `new` beside
    // its close in the same response (see "a quest opened and closed in one
    // response" below); the insert's guess had no way to tell that arc from a
    // re-worded live quest or a finished one re-closed in new words.
    it('an unmatched named terminal update records no row and posts ONE dmVisible ⚖ line (was the playtest #14 insert)', () => {
        const completed = gameReducer(initialGameState, {
            type: 'COMPLETE_QUEST',
            payload: { name: "The Ferrywoman's Letter", description: 'Delivered the sealed letter to Aune.' },
        });
        expect(completed.quests).toHaveLength(0);
        expect(completed.messages).toHaveLength(1);
        expect(completed.messages[0]).toMatchObject({ role: 'system', dmVisible: true });
        expect(completed.messages[0].content).toContain('No tracked quest is named "The Ferrywoman\'s Letter"');
        expect(completed.messages[0].content).toContain('nothing was completed');

        const added = gameReducer(initialGameState, {
            type: 'ADD_QUEST',
            payload: { id: 'quest-debt', name: 'Collect the Debt' },
        });
        const next = gameReducer(added, { type: 'FAIL_QUEST', payload: { name: 'A Quest That Never Was' } });
        expect(next.quests).toHaveLength(1);
        expect(next.quests[0]).toMatchObject({ id: 'quest-debt', status: 'active' });
        expect(next.messages.at(-1).content).toContain('nothing was failed');
    });

    it('a quest opened and closed in one response by exact name is recorded and closed (the one-reply arc\'s route)', () => {
        let state = gameReducer(initialGameState, { type: 'ADD_QUEST', payload: { status: 'new', name: 'Carry the net to the hold' } });
        state = gameReducer(state, { type: 'COMPLETE_QUEST', payload: { name: 'Carry the net to the hold', outcome: 'Stowed.' } });
        expect(state.quests).toHaveLength(1);
        expect(state.quests[0]).toMatchObject({ name: 'Carry the net to the hold', status: 'completed', outcome: 'Stowed.' });
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

    // 2026-08-28 P1: recurring quest names must never rewrite closed-arc history.
    it('failing arc 2 of a reused name leaves arc 1\'s completed row untouched', () => {
        let state = gameReducer(initialGameState, {
            type: 'ADD_QUEST',
            payload: { id: 'q-caravan-1', name: 'Guard the Caravan' },
        });
        state = gameReducer(state, { type: 'COMPLETE_QUEST', payload: { name: 'Guard the Caravan' } });
        // Same name recurs as a new arc (deliberate ADD_QUEST behavior).
        state = gameReducer(state, {
            type: 'ADD_QUEST',
            payload: { id: 'q-caravan-2', name: 'Guard the Caravan' },
        });
        const failed = gameReducer(state, { type: 'FAIL_QUEST', payload: { name: 'Guard the Caravan' } });
        expect(failed.quests.find(q => q.id === 'q-caravan-1').status).toBe('completed');
        expect(failed.quests.find(q => q.id === 'q-caravan-2').status).toBe('failed');
    });

    it('completing arc 2 of a reused name leaves arc 1\'s failed row untouched (the mirror)', () => {
        let state = gameReducer(initialGameState, {
            type: 'ADD_QUEST',
            payload: { id: 'q-caravan-1', name: 'Guard the Caravan' },
        });
        state = gameReducer(state, { type: 'FAIL_QUEST', payload: { name: 'Guard the Caravan' } });
        state = gameReducer(state, {
            type: 'ADD_QUEST',
            payload: { id: 'q-caravan-2', name: 'Guard the Caravan' },
        });
        const completed = gameReducer(state, { type: 'COMPLETE_QUEST', payload: { name: 'Guard the Caravan' } });
        expect(completed.quests.find(q => q.id === 'q-caravan-1').status).toBe('failed');
        expect(completed.quests.find(q => q.id === 'q-caravan-2').status).toBe('completed');
    });

    it('a terminal-only exact match still accepts the harmless terminal rewrite (one-shot XP guard)', () => {
        let state = gameReducer(initialGameState, {
            type: 'ADD_QUEST',
            payload: { id: 'q-done', name: 'Deliver the Letter' },
        });
        state = gameReducer(state, { type: 'COMPLETE_QUEST', payload: { name: 'Deliver the Letter' } });
        // A DM re-emitting the completion later matches only the terminal row —
        // the rewrite is a no-op-shaped guard, never a new arc insert.
        const again = gameReducer(state, { type: 'COMPLETE_QUEST', payload: { name: 'Deliver the Letter' } });
        expect(again.quests).toHaveLength(1);
        expect(again.quests[0].status).toBe('completed');
    });

    it('ADD_QUEST picks fields explicitly — payload status/addedAt junk cannot ride in', () => {
        const next = gameReducer(initialGameState, {
            type: 'ADD_QUEST',
            payload: { name: 'Sneaky Quest', status: 'completed', addedAt: 1, junkKey: 'x' },
        });
        expect(next.quests[0].status).toBe('active');
        expect(next.quests[0].addedAt).not.toBe(1);
        expect(next.quests[0]).not.toHaveProperty('junkKey');
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

    it('clamps quest name/description on every write path, panel input included (2026-09-04 P2)', () => {
        const longName = 'x'.repeat(5000);
        const added = gameReducer(initialGameState, {
            type: 'ADD_QUEST',
            payload: { name: longName, description: 'y'.repeat(5000), source: 'player' },
        });
        expect(added.quests[0].name).toHaveLength(160);
        expect(added.quests[0].description).toHaveLength(800);

        // The never-tracked terminal insert is gone (lane 3, 2026-11-07): a
        // close that matches nothing writes no row, and the ⚖ line it posts
        // clamps the name it quotes.
        const refused = gameReducer(initialGameState, {
            type: 'COMPLETE_QUEST',
            payload: { name: longName, description: 'y'.repeat(5000) },
        });
        expect(refused.quests).toHaveLength(0);
        expect(refused.messages).toHaveLength(1);
        expect(refused.messages[0].content.length).toBeLessThan(400);
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

    it('pays the instant tier ONCE per response — four opened-and-closed errands in one reply pay 25, not 100 (DECISIONS.md 2026-09-14)', () => {
        let state = withHero();
        for (const name of ['Fetch the Ledger', 'Water the Mule', 'Return the Cup', 'Sweep the Step']) {
            state = gameReducer(state, { type: 'ADD_QUEST', payload: { name } });
            state = gameReducer(state, { type: 'COMPLETE_QUEST', payload: { name } });
        }
        expect(state.quests.every(q => q.status === 'completed')).toBe(true);
        expect(state.character.exp).toBe(25);
        // The three refused payouts say so, visibly.
        expect(state.messages.filter(m => /pays once per response/.test(m.content))).toHaveLength(3);
        // A completion on a LATER turn is a different response: full tier again.
        let later = gameReducer(passTurns(state, 2), { type: 'ADD_QUEST', payload: { name: 'Mend the Fence' } });
        later = gameReducer(later, { type: 'COMPLETE_QUEST', payload: { name: 'Mend the Fence' } });
        expect(later.character.exp).toBe(50);
    });

    // Flipped 2026-11-07 (lane 3): the never-tracked fallback insert is gone;
    // the close that matches nothing pays nothing AND records nothing.
    it('a never-tracked close records no row and pays NO XP (2026-09-04 revisit of the instant tier; the insert gone 2026-11-07)', () => {
        const next = gameReducer(withHero(), {
            type: 'COMPLETE_QUEST',
            payload: { name: "The Ferrywoman's Letter", description: 'Delivered off-screen.' },
        });
        expect(next.quests).toHaveLength(0);
        expect(next.character.exp).toBe(0);
        expect(next.messages).toHaveLength(1);
        expect(next.messages[0].content).toContain('nothing was completed');
    });

    it('panel ✓ (bare id ref) completes as bookkeeping only — the + then ✓ XP mine is closed (2026-09-04 P1)', () => {
        let state = gameReducer(withHero(), { type: 'ADD_QUEST', payload: { name: 'My own note', source: 'player' } });
        state = passTurns(state, 4);
        const clicked = gameReducer(state, { type: 'COMPLETE_QUEST', payload: state.quests[0].id });
        expect(clicked.quests[0].status).toBe('completed');
        expect(clicked.character.exp).toBe(0);
        expect(clicked.messages).toHaveLength(state.messages.length);

        // Same-turn add + ✓ double-click: not even the instant tier.
        const fresh = gameReducer(withHero(), { type: 'ADD_QUEST', payload: { name: 'Quick note', source: 'player' } });
        expect(gameReducer(fresh, { type: 'COMPLETE_QUEST', payload: fresh.quests[0].id }).character.exp).toBe(0);
    });

    it('a panel ✕ on a finished row followed by the DM re-emitting that completion pays nothing (2026-09-04 P2)', () => {
        let state = gameReducer(withHero(), { type: 'ADD_QUEST', payload: { id: 'q-rats', name: 'Clear the Cellar Rats' } });
        state = passTurns(state, 4);
        state = gameReducer(state, { type: 'COMPLETE_QUEST', payload: { id: 'q-rats', name: 'Clear the Cellar Rats' } });
        expect(state.character.exp).toBe(75);
        state = gameReducer(state, { type: 'REMOVE_QUEST', payload: 'q-rats' });
        expect(state.quests).toHaveLength(0);

        state = passTurns(state, 3);
        const replay = gameReducer(state, { type: 'COMPLETE_QUEST', payload: { id: 'q-rats', name: 'Clear the Cellar Rats' } });
        // Since lane 3 (2026-11-07) the replay resurrects nothing: the row the
        // player removed stays gone, one ⚖ line says the close landed on no
        // tracked quest, and the XP is never re-paid.
        expect(replay.quests).toHaveLength(0);
        expect(replay.character.exp).toBe(75);
        expect(replay.messages.at(-1).content).toContain('No tracked quest is named "Clear the Cellar Rats"');
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

// Flipped 2026-11-07 (identity by reference, lane 3; DECISIONS.md 2026-11-05):
// the fuzzy `questNameMatcher` (Terra playtest P3, 2026-08-26) is gone. A quest
// is the id the DM echoes from ACTIVE QUESTS or an exact (normalized) name;
// a drifted name closes nothing and says so, and a `new` in new words mints a
// visible twin rather than folding into the wrong arc.
describe('a quest is an id or an exact name — no word rule decides (lane 3, 2026-11-07; was fuzzy identity 2026-08-26)', () => {
    it('a drifted completion name closes nothing, mints nothing, and posts ONE dmVisible ⚖ line', () => {
        const added = gameReducer(initialGameState, {
            type: 'ADD_QUEST',
            payload: { id: 'q-relic', name: 'Find the Relic of Kel' },
        });
        const next = gameReducer(added, { type: 'COMPLETE_QUEST', payload: { name: 'The Relic of Kel' } });
        expect(next.quests).toHaveLength(1);
        expect(next.quests[0]).toMatchObject({ id: 'q-relic', status: 'active' });
        const lines = next.messages.filter(m => m.role === 'system' && !/^[◆✦✕] \*\*Quest/.test(m.content));
        expect(lines).toHaveLength(1);
        expect(lines[0]).toMatchObject({ dmVisible: true });
        expect(lines[0].content).toContain('No tracked quest is named "The Relic of Kel"');
        expect(lines[0].content).toContain('nothing was completed');
    });

    it('an exact name still closes, case- and punctuation-folded, with no id at all', () => {
        const added = gameReducer(initialGameState, {
            type: 'ADD_QUEST',
            payload: { id: 'q-relic', name: 'Find the Relic of Kel' },
        });
        const next = gameReducer(added, { type: 'COMPLETE_QUEST', payload: { name: 'find the relic of kel!' } });
        expect(next.quests).toHaveLength(1);
        expect(next.quests[0]).toMatchObject({ id: 'q-relic', status: 'completed' });
    });

    it('a name that matches no tracked quest records no table history beside live arcs', () => {
        let state = gameReducer(initialGameState, { type: 'ADD_QUEST', payload: { id: 'q-1', name: 'The Cellar Rats' } });
        state = gameReducer(state, { type: 'ADD_QUEST', payload: { id: 'q-2', name: 'Rats in the Cellar Shrine' } });
        const next = gameReducer(state, { type: 'COMPLETE_QUEST', payload: { name: 'Cellar Rats Dealt With', description: 'd' } });
        expect(next.quests.find(q => q.id === 'q-1').status).toBe('active');
        expect(next.quests.find(q => q.id === 'q-2').status).toBe('active');
        expect(next.quests).toHaveLength(2);
        expect(next.messages.filter(m => m.role === 'system' && !/^[◆✦✕] \*\*Quest/.test(m.content))).toHaveLength(1);
    });

    it('"Deliver letter 1" and "Deliver letter 2" are two quests; eight numbered errands in one reply are eight rows (the open queue item)', () => {
        let state = gameReducer(initialGameState, { type: 'ADD_QUEST', payload: { status: 'new', name: 'Deliver letter 1', description: 'to Bram' } });
        state = gameReducer(state, { type: 'ADD_QUEST', payload: { status: 'new', name: 'Deliver letter 2', description: 'to Ada' } });
        expect(state.quests.map(q => [q.name, q.description])).toEqual([['Deliver letter 1', 'to Bram'], ['Deliver letter 2', 'to Ada']]);
        expect(state.quests[0].stages).toBeUndefined();

        let errands = initialGameState;
        for (let i = 0; i < 8; i++) errands = gameReducer(errands, { type: 'ADD_QUEST', payload: { status: 'new', name: `Errand ${i}` } });
        expect(errands.quests).toHaveLength(8);
    });

    it('a `new` that re-words a live arc mints a visible twin — the price of no word rule, pinned on purpose', () => {
        const added = gameReducer(initialGameState, {
            type: 'ADD_QUEST',
            payload: { status: 'new', name: 'Find the Relic of Kel', description: 'Lost long ago.' },
        });
        const next = gameReducer(added, { type: 'ADD_QUEST', payload: { status: 'new', name: 'The Relic of Kel', description: 'The trail leads to the vault.' } });
        expect(next.quests).toHaveLength(2);
        expect(next.quests[0]).toMatchObject({ name: 'Find the Relic of Kel', description: 'Lost long ago.', status: 'active' });
        expect(next.quests[1]).toMatchObject({ name: 'The Relic of Kel', status: 'active' });
        // Both rows carry ids the DM sees in ACTIVE QUESTS; the player can ✕ one.
        expect(next.quests[0].id).not.toBe(next.quests[1].id);
    });

    it('a re-emitted completion with drifted phrasing closes nothing, mints nothing and pays nothing', () => {
        const hero = { name: 'Astra', race: 'human', class: 'fighter', level: 2, exp: 0, maxHP: 20, currentHP: 20, abilityScores: { strength: 16, dexterity: 12, constitution: 14, intelligence: 10, wisdom: 10, charisma: 8 }, features: [], classResources: {}, hitDice: { total: 2, remaining: 2, die: 10 } };
        let state = gameReducer({ ...initialGameState, character: hero }, {
            type: 'ADD_QUEST',
            payload: { id: 'q-debt', name: 'Collect the Ferry Debt' },
        });
        state = gameReducer(state, { type: 'COMPLETE_QUEST', payload: { id: 'q-debt', name: 'Collect the Ferry Debt' } });
        const paidOnce = state.character.exp;
        const replay = gameReducer(state, { type: 'COMPLETE_QUEST', payload: { name: 'The Ferry Debt' } });
        expect(replay.quests).toHaveLength(1);
        expect(replay.quests[0].status).toBe('completed');
        expect(replay.character.exp).toBe(paidOnce);
        expect(replay.messages.at(-1).content).toContain('No tracked quest is named "The Ferry Debt"');
    });

    it('ADD_QUEST "updated" with a drifted name and no id self-heals into its own row; the tracked arc is untouched', () => {
        const added = gameReducer(initialGameState, {
            type: 'ADD_QUEST',
            payload: { id: 'q-relic', name: 'Find the Relic of Kel', description: 'It was lost long ago.' },
        });
        const next = gameReducer(added, {
            type: 'ADD_QUEST',
            payload: { status: 'updated', name: 'The Relic of Kel', description: 'The trail leads to the sunken vault.' },
        });
        expect(next.quests).toHaveLength(2);
        expect(next.quests[0]).toMatchObject({ id: 'q-relic', description: 'It was lost long ago.' });
        expect(next.quests[1]).toMatchObject({ name: 'The Relic of Kel', description: 'The trail leads to the sunken vault.', status: 'active' });

        // With the id, the same words land on the arc (11-06) and the held name stays.
        const byId = gameReducer(added, {
            type: 'ADD_QUEST',
            payload: { id: 'q-relic', status: 'updated', name: 'The Relic of Kel', description: 'The trail leads to the sunken vault.' },
        });
        expect(byId.quests).toHaveLength(1);
        expect(byId.quests[0]).toMatchObject({ name: 'Find the Relic of Kel', description: 'The trail leads to the sunken vault.' });
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

// Revised 2026-11-06 (night): a `new` never matches by id (the 10-10 case
// holds), and an `updated` lands on the row its id names — no name gate.
describe('a new quest names no id; an update lands on the id it echoes (2026-11-06; was 2026-10-10 quests P2)', () => {
    it('an id reused on a NEW quest opens a second row and leaves the first untouched', () => {
        const first = gameReducer(initialGameState, { type: 'ADD_QUEST', payload: { id: 'q1', status: 'new', name: 'Find the Relic of Kel' } });
        const second = gameReducer(first, { type: 'ADD_QUEST', payload: { id: 'q1', status: 'new', name: 'Escort the salt caravan' } });
        expect(second.quests.map(q => q.name)).toEqual(['Find the Relic of Kel', 'Escort the salt caravan']);
        expect(second.quests[0]).toMatchObject({ id: 'q1', status: 'active' });
        // The invented id is re-minted — it may not collide with the live arc.
        expect(second.quests[1].id).not.toBe('q1');
        expect(second.quests[1].id).toMatch(/^quest-/);
    });

    it('an update re-worded past any name rule still lands on the arc its id names, and keeps the held name', () => {
        const first = gameReducer(initialGameState, { type: 'ADD_QUEST', payload: { id: 'q1', status: 'new', name: 'Find the Relic of Kel', description: 'Recover it for the abbot.' } });
        const second = gameReducer(first, { type: 'ADD_QUEST', payload: { id: 'q1', status: 'updated', name: 'The abbot\'s lost reliquary', description: 'The trail leads to the sunken vault.' } });
        expect(second.quests).toHaveLength(1);
        expect(second.quests[0]).toMatchObject({ id: 'q1', name: 'Find the Relic of Kel', description: 'The trail leads to the sunken vault.', agreement: 'Recover it for the abbot.' });
    });

    it('two jobs one digit apart stay two when the second is NEW, and an update by id moves only its own', () => {
        let state = gameReducer(initialGameState, { type: 'ADD_QUEST', payload: { status: 'new', name: 'Deliver letter 1', description: 'To Ada.' } });
        const firstId = state.quests[0].id;
        state = gameReducer(state, { type: 'ADD_QUEST', payload: { id: firstId, status: 'updated', name: 'Deliver letter 1', description: 'Ada has moved to the mill.' } });
        expect(state.quests).toHaveLength(1);
        expect(state.quests[0].description).toBe('Ada has moved to the mill.');
    });

    it('an update whose id names one arc and whose exact name is another changes nothing and says so', () => {
        let state = gameReducer(initialGameState, { type: 'ADD_QUEST', payload: { id: 'q-relic', status: 'new', name: 'Find the Relic of Kel', description: 'Recover it.' } });
        state = gameReducer(state, { type: 'ADD_QUEST', payload: { id: 'q-caravan', status: 'new', name: 'Escort the salt caravan', description: 'North by the weir.' } });
        const next = gameReducer(state, { type: 'ADD_QUEST', payload: { id: 'q-relic', status: 'updated', name: 'Escort the salt caravan', description: 'The road is cut.' } });
        expect(next.quests.map(q => q.description)).toEqual(['Recover it.', 'North by the weir.']);
        expect(next.messages.at(-1)).toMatchObject({ dmVisible: true });
        expect(next.messages.at(-1).content).toContain('nothing changed');
    });

    it('an id with a drifted but compatible name refreshes the tracked arc', () => {
        const first = gameReducer(initialGameState, { type: 'ADD_QUEST', payload: { id: 'q1', name: 'Find the Relic of Kel' } });
        const second = gameReducer(first, { type: 'ADD_QUEST', payload: { id: 'q1', name: 'The Relic of Kel', description: 'The trail leads to the sunken vault.' } });
        expect(second.quests).toHaveLength(1);
        expect(second.quests[0]).toMatchObject({ id: 'q1', description: 'The trail leads to the sunken vault.' });
    });

    it('a nameless ADD_QUEST inserts nothing — no ghost row for the prompt, the panel, or the count', () => {
        expect(gameReducer(initialGameState, { type: 'ADD_QUEST', payload: { id: 'q-7' } }).quests).toHaveLength(0);
        expect(gameReducer(initialGameState, { type: 'ADD_QUEST', payload: { id: 'q-7', name: { x: 1 } } }).quests).toHaveLength(0);
        expect(gameReducer(initialGameState, { type: 'ADD_QUEST', payload: { name: '   ' } }).quests).toHaveLength(0);
    });

    it('both live inserts are their own load twin (one row composer)', () => {
        const opened = gameReducer(initialGameState, {
            type: 'ADD_QUEST',
            payload: { name: '  Find the   ledger ', description: 'Recover it.', source: 'dm', status: 'completed', junk: true },
        }).quests[0];
        expect(opened).toMatchObject({ name: 'Find the ledger', source: 'dm', status: 'active', openedAtMessage: 0 });
        expect(opened).not.toHaveProperty('junk');
        expect(sanitizeQuestRecord(opened)).toEqual(opened);

        // The terminal insert is gone (lane 3, 2026-11-07): a closed row is an
        // opened row the close moved, so the twin check rides `new` + the close.
        const closed = gameReducer(gameReducer(initialGameState, {
            type: 'ADD_QUEST',
            payload: { status: 'new', name: 'Deliver the letter', description: 'To the mill.' },
        }), {
            type: 'COMPLETE_QUEST',
            payload: { name: 'Deliver the letter', description: 'To the mill.', outcome: 'Delivered.' },
        }).quests[0];
        expect(closed).toMatchObject({ name: 'Deliver the letter', status: 'completed', outcome: 'Delivered.' });
        expect(sanitizeQuestRecord(closed)).toEqual(closed);
        // A nameless terminal ref still records nothing.
        expect(gameReducer(initialGameState, { type: 'COMPLETE_QUEST', payload: { id: 'q-9' } }).quests).toHaveLength(0);
    });
});
