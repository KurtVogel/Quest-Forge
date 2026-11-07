/**
 * WOW 2026-11-04 (quests-and-rewards, Lap 1) — the sworn record and the close
 * as a ceremony. Slice A: `patron` / `promised` / `outcome` on the wire, the
 * frozen `agreement`, the staged log (`updated` appends, never overwrites).
 * Slice B: the ◆ / ✦ / ✕ rows, one engine `quest` story card at the close
 * (salience 4 for a long arc), the Chronicle nudge for an arc that lived
 * QUEST_LONG_ARC_ROWS — and NONE of it for the panel's own bookkeeping.
 */
import { describe, expect, it } from 'vitest';
import { gameReducer, initialGameState } from './gameReducer.js';
import { QUEST_LONG_ARC_ROWS, sanitizeQuestRecord } from './handlers/quests.js';

const hero = {
    name: 'Ilse', race: 'human', class: 'fighter', level: 2, exp: 0, currentHP: 20, maxHP: 20, armorClass: 16,
    abilityScores: { strength: 16, dexterity: 12, constitution: 14, intelligence: 10, wisdom: 10, charisma: 8 },
    conditions: [], classResources: {}, features: [], traits: [], hitDice: { total: 2, remaining: 2, die: 10 },
};
const row = (i, role = 'assistant') => ({ id: `m-${i}`, role, content: `turn ${i}`, timestamp: i });
const passTurns = (state, count) => ({
    ...state,
    messages: [...state.messages, ...Array.from({ length: count }, (_, i) => row(state.messages.length + i, i % 2 ? 'assistant' : 'user'))],
});
const withRoster = () => ({
    ...initialGameState,
    character: { ...hero },
    currentLocation: 'Saltmere',
    npcs: [
        { id: 'npc-hesper', name: 'Hesper Vane', rosterTier: 'character', kind: 'character', disposition: 'neutral' },
        { id: 'npc-maren-t', name: 'Maren Tull', rosterTier: 'character', kind: 'character', disposition: 'neutral' },
        { id: 'npc-maren-a', name: 'Maren Ashford', rosterTier: 'character', kind: 'character', disposition: 'neutral' },
    ],
});
const questRows = (state) => state.messages.filter(m => m.role === 'system' && /^[◆✦✕] \*\*Quest/.test(m.content));

describe('the sworn record (slice A)', () => {
    it('a new quest keeps the agreement, resolves the patron to the roster, and holds the promise', () => {
        const next = gameReducer(withRoster(), {
            type: 'ADD_QUEST',
            payload: { name: 'The Manifest', description: 'Steal the Syndicate manifest from the counting house.', patron: 'Hesper', promised: '20 gp and a name' },
        });
        expect(next.quests[0]).toMatchObject({
            name: 'The Manifest',
            agreement: 'Steal the Syndicate manifest from the counting house.',
            patron: 'Hesper Vane',
            patronId: 'npc-hesper',
            promised: '20 gp and a name',
            status: 'active',
        });
        expect(next.quests[0].stages).toBeUndefined();
        // The job taken is a moment: one DM-visible row.
        const rows = questRows(next);
        expect(rows).toHaveLength(1);
        expect(rows[0].content).toBe('◆ **Quest taken** — The Manifest (for Hesper Vane · promised: 20 gp and a name)');
        expect(rows[0].dmVisible).toBe(true);
    });

    it('an ambiguous patron name is kept as text, never a guess; an unknown one too', () => {
        const ambiguous = gameReducer(withRoster(), { type: 'ADD_QUEST', payload: { name: 'A Favor', description: 'd', patron: 'Maren' } });
        expect(ambiguous.quests[0].patron).toBe('Maren');
        expect(ambiguous.quests[0].patronId).toBeUndefined();
        const unknown = gameReducer(withRoster(), { type: 'ADD_QUEST', payload: { name: 'A Favor', description: 'd', patron: 'The Harbormaster' } });
        expect(unknown.quests[0].patron).toBe('The Harbormaster');
        expect(unknown.quests[0].patronId).toBeUndefined();
    });

    it('`updated` appends a stage and leaves the agreement, patron and promise untouched', () => {
        let state = gameReducer(withRoster(), {
            type: 'ADD_QUEST',
            payload: { name: 'The Manifest', description: 'Steal the manifest.', patron: 'Hesper Vane', promised: '20 gp' },
        });
        state = passTurns(state, 2);
        state = gameReducer(state, { type: 'ADD_QUEST', payload: { name: 'The Manifest', description: 'The manifest is at the weir now; Vane wants it by dawn.', patron: 'Somebody Else', promised: '5 gp' } });
        state = passTurns(state, 2);
        state = gameReducer(state, { type: 'ADD_QUEST', payload: { name: 'The Manifest', description: 'The weir is guarded; the back door is the way.' } });
        const quest = state.quests[0];
        expect(state.quests).toHaveLength(1);
        expect(quest.agreement).toBe('Steal the manifest.');
        expect(quest.patron).toBe('Hesper Vane');
        expect(quest.promised).toBe('20 gp');
        expect(quest.description).toBe('The weir is guarded; the back door is the way.');
        expect(quest.stages.map(s => s.text)).toEqual([
            'The manifest is at the weir now; Vane wants it by dawn.',
            'The weir is guarded; the back door is the way.',
        ]);
        expect(quest.stages.every(s => Number.isInteger(s.atMessage))).toBe(true);
        // A restatement of the current description is not a stage.
        const same = gameReducer(state, { type: 'ADD_QUEST', payload: { name: 'The Manifest', description: 'The weir is guarded; the back door is the way.' } });
        expect(same.quests[0].stages).toHaveLength(2);
        // Only one ◆ row for the whole arc — updates post nothing.
        expect(questRows(same)).toHaveLength(1);
    });

    it('a pre-11-04 row back-fills its agreement the first time it moves, and the staged log caps at six', () => {
        let state = { ...withRoster(), quests: [{ id: 'q-old', name: 'Old Job', description: 'The first wording.', status: 'active', addedAt: 1, openedAtMessage: 0 }] };
        for (let i = 0; i < 8; i++) {
            state = gameReducer(state, { type: 'ADD_QUEST', payload: { name: 'Old Job', description: `Stage ${i}.` } });
        }
        expect(state.quests[0].agreement).toBe('The first wording.');
        expect(state.quests[0].stages).toHaveLength(6);
        expect(state.quests[0].stages[0].text).toBe('Stage 2.');
        expect(state.quests[0].description).toBe('Stage 7.');
    });

    it('a close writes the outcome — the wire field first, else a description that says something new', () => {
        let state = gameReducer(withRoster(), { type: 'ADD_QUEST', payload: { name: 'The Manifest', description: 'Steal the manifest.', patron: 'Hesper Vane' } });
        state = passTurns(state, 4);
        const done = gameReducer(state, { type: 'COMPLETE_QUEST', payload: { name: 'The Manifest', outcome: 'Delivered to Vane at the quay; she paid 20 gp and gave the name.' } });
        expect(done.quests[0]).toMatchObject({ status: 'completed', outcome: 'Delivered to Vane at the quay; she paid 20 gp and gave the name.' });
        const byDescription = gameReducer(state, { type: 'FAIL_QUEST', payload: { name: 'The Manifest', description: 'The manifest burned with the counting house.' } });
        expect(byDescription.quests[0]).toMatchObject({ status: 'failed', outcome: 'The manifest burned with the counting house.' });
        const restated = gameReducer(state, { type: 'COMPLETE_QUEST', payload: { name: 'The Manifest', description: 'Steal the manifest.' } });
        expect(restated.quests[0].outcome).toBeUndefined();
    });

    it('the load twin types every new field and drops an outcome on an active row', () => {
        const typed = sanitizeQuestRecord({
            id: 'q1', name: 'Job', description: 'd', status: 'active',
            patron: { name: 'object' }, patronId: 'npc-1', promised: 'x'.repeat(500), agreement: ['not', 'text'], outcome: 'should drop',
            stages: [null, { text: '' }, { text: 'kept', atMessage: 3.7 }, 'junk', { text: 'y'.repeat(400), atMessage: -2 }],
        }, { maxMessageCount: 10 });
        expect(typed.patron).toBeUndefined();
        expect(typed.patronId).toBeUndefined(); // no patron, no id
        expect(typed.promised).toHaveLength(120);
        expect(typed.agreement).toBeUndefined();
        expect(typed.outcome).toBeUndefined();
        expect(typed.stages).toEqual([{ text: 'kept', atMessage: 3 }, { text: 'y'.repeat(200), atMessage: 0 }]);
        const terminal = sanitizeQuestRecord({ id: 'q2', name: 'Done', status: 'completed', outcome: 'o'.repeat(300), patron: 'Hesper Vane', patronId: 'npc-hesper' });
        expect(terminal.outcome).toHaveLength(200);
        expect(terminal).toMatchObject({ patron: 'Hesper Vane', patronId: 'npc-hesper' });
    });
});

describe('the close as a ceremony (slice B)', () => {
    it('a DM-lane completion posts the ✦ row above the XP receipt and mints one engine quest card with the patron linked', () => {
        let state = gameReducer(withRoster(), { type: 'ADD_QUEST', payload: { name: 'The Manifest', description: 'Steal the manifest.', patron: 'Hesper Vane', promised: '20 gp' } });
        state = passTurns(state, 4);
        const next = gameReducer(state, { type: 'COMPLETE_QUEST', payload: { name: 'The Manifest', outcome: 'Delivered to Vane; she paid.' } });
        const systemRows = next.messages.filter(m => m.role === 'system');
        expect(systemRows.at(-2).content).toBe('✦ **Quest done** — The Manifest: Delivered to Vane; she paid.');
        expect(systemRows.at(-1).content).toContain('quest completed: The Manifest');
        const card = next.storyMemory.find(c => c.type === 'quest');
        expect(card).toMatchObject({ type: 'quest', source: 'engine', salience: 3, status: 'active', subject: 'The Manifest', location: 'Saltmere' });
        expect(card.text).toBe('"The Manifest" for Hesper Vane (promised: 20 gp) — completed: Delivered to Vane; she paid.');
        expect(card.linkedNpcNames).toEqual(['Hesper Vane']);
        expect(card.tags).toEqual(expect.arrayContaining(['quest', 'completed']));
        // A short arc offers no chapter close.
        expect(next.session?.chapterCloseSuggested ?? null).toBeNull();
    });

    it('a failure posts the ✕ row, pays nothing, and still writes the card', () => {
        let state = gameReducer(withRoster(), { type: 'ADD_QUEST', payload: { name: 'A Promise to Sanna', description: 'Bring Pelle home.' } });
        state = passTurns(state, 4);
        const next = gameReducer(state, { type: 'FAIL_QUEST', payload: { name: 'A Promise to Sanna', outcome: 'Pelle drowned at the weir.' } });
        expect(next.character.exp).toBe(0);
        expect(questRows(next).at(-1).content).toBe('✕ **Quest failed** — A Promise to Sanna: Pelle drowned at the weir.');
        const card = next.storyMemory.find(c => c.type === 'quest');
        expect(card.text).toBe('"A Promise to Sanna" — failed: Pelle drowned at the weir.');
        expect(card.emotionalCharge).toBe(3);
    });

    it('an arc that lived QUEST_LONG_ARC_ROWS conversational rows earns salience 4 and the Chronicle nudge', () => {
        let state = gameReducer(withRoster(), { type: 'ADD_QUEST', payload: { name: 'The Long Road', description: 'Walk it.' } });
        state = passTurns(state, QUEST_LONG_ARC_ROWS + 2);
        const next = gameReducer(state, { type: 'COMPLETE_QUEST', payload: { name: 'The Long Road', outcome: 'Walked.' } });
        expect(next.storyMemory.find(c => c.type === 'quest').salience).toBe(4);
        expect(next.session.chapterCloseSuggested).toMatchObject({ reason: 'quest', title: 'The Long Road' });
        expect(Number.isFinite(next.session.chapterCloseSuggested.at)).toBe(true);
    });

    it('system rows between open and close do not count as distance — a dice-heavy short arc stays short', () => {
        let state = gameReducer(withRoster(), { type: 'ADD_QUEST', payload: { name: 'Quick Errand', description: 'Go.' } });
        state = { ...state, messages: [...state.messages, ...Array.from({ length: QUEST_LONG_ARC_ROWS + 5 }, (_, i) => row(100 + i, 'system'))] };
        state = passTurns(state, 2);
        const next = gameReducer(state, { type: 'COMPLETE_QUEST', payload: { name: 'Quick Errand' } });
        expect(next.storyMemory.find(c => c.type === 'quest').salience).toBe(3);
        expect(next.session?.chapterCloseSuggested ?? null).toBeNull();
    });

    // The never-tracked close half flipped 2026-11-07 (lane 3): a close that
    // matches nothing records nothing and says so; the arc is recorded by
    // `new` beside the close in one response.
    it('the panel\'s own note and ✓ post no rows and mint no card; a never-tracked close records nothing and posts one ⚖ line', () => {
        let state = gameReducer(withRoster(), { type: 'ADD_QUEST', payload: { name: 'My note', source: 'player' } });
        expect(questRows(state)).toHaveLength(0);
        state = passTurns(state, 4);
        const clicked = gameReducer(state, { type: 'COMPLETE_QUEST', payload: state.quests[0].id });
        expect(clicked.messages).toHaveLength(state.messages.length);
        expect((clicked.storyMemory || []).some(c => c.type === 'quest')).toBe(false);
        const untracked = gameReducer(withRoster(), { type: 'COMPLETE_QUEST', payload: { name: 'A One-Reply Errand', description: 'Done in one.', patron: 'Hesper Vane', outcome: 'Paid.' } });
        expect(untracked.quests).toHaveLength(0);
        expect(untracked.messages).toHaveLength(1);
        expect(untracked.messages[0].content).toContain('No tracked quest is named "A One-Reply Errand"');
        expect((untracked.storyMemory || []).some(c => c.type === 'quest')).toBe(false);
    });

    it('re-emitting the completion mints no second card and no second row (the one-shot guard holds)', () => {
        let state = gameReducer(withRoster(), { type: 'ADD_QUEST', payload: { name: 'The Manifest', description: 'Steal it.' } });
        state = passTurns(state, 4);
        const once = gameReducer(state, { type: 'COMPLETE_QUEST', payload: { name: 'The Manifest', outcome: 'Done.' } });
        const twice = gameReducer(once, { type: 'COMPLETE_QUEST', payload: { name: 'The Manifest', outcome: 'Done.' } });
        expect(twice).toBe(once);
        expect(twice.storyMemory.filter(c => c.type === 'quest')).toHaveLength(1);
    });
});
