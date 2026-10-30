/**
 * Source-stamped retraction (memory-research M0, 2026-09-30) and the state
 * aspect's reducer half: a lane dispatch stamps the DM message it read
 * (`meta.sourceMessage`) on the facts, cards and impressions it mints;
 * DELETE_MESSAGE retracts them with the message and says so once; a STATE
 * fact carries its birth stamp and is re-stamped by a restatement; the load
 * twin types every stamp.
 */
import { describe, expect, it } from 'vitest';
import { gameReducer, initialGameState } from './gameReducer.js';
import { createCharacter } from '../engine/characterUtils.js';
import { buildSystemPrompt } from '../llm/promptBuilder.js';

const ABILITY_SCORES = { strength: 15, dexterity: 12, constitution: 14, intelligence: 10, wisdom: 10, charisma: 8 };

function baseState() {
    return {
        ...initialGameState,
        character: createCharacter('Testa', 'human', 'fighter', ABILITY_SCORES, ['athletics']),
        session: { ...initialGameState.session, id: 'session-test' },
        messages: [
            { id: 'u1', role: 'user', content: 'I ask about the road.' },
            { id: 'a1', role: 'assistant', content: 'The harbor road is flooded, the reeve says. Orsa looks away.' },
        ],
        npcs: [{
            id: 'n-orsa', name: 'Orsa', rosterTier: 'character', kind: 'character', disposition: 'wary',
            stanceToPlayer: 'She trusts the hero with the ledger and the countinghouse keys, though she watches every coin, and she has never once asked where the silver came from or why the hero keeps returning to the docks after dark.',
        }],
    };
}

const META = { meta: { sourceMessage: 'a1' } };

describe('lane dispatches stamp their source message; DELETE_MESSAGE retracts', () => {
    it('ADD_WORLD_FACTS with meta stamps sourceMessage + atMessage, and a passing state gets aspect: state', () => {
        const s = gameReducer(baseState(), { type: 'ADD_WORLD_FACTS', payload: [
            { fact: 'The harbor road is flooded.', category: 'location' },
            { fact: 'The goblin captain Rarg is dead.', category: 'event' },
        ], ...META });
        expect(s.worldFacts).toHaveLength(2);
        expect(s.worldFacts[0]).toMatchObject({ sourceMessage: 'a1', atMessage: 2, aspect: 'state' });
        expect(s.worldFacts[1]).toMatchObject({ sourceMessage: 'a1', atMessage: 2 });
        expect(s.worldFacts[1].aspect).toBeUndefined();
        // Without meta: no source, still the birth stamp.
        const t = gameReducer(baseState(), { type: 'ADD_WORLD_FACTS', payload: [{ fact: 'Odo was killed at the docks.' }] });
        expect(t.worldFacts[0].sourceMessage).toBeUndefined();
        expect(t.worldFacts[0].atMessage).toBe(2);
    });

    it('a restatement of a STATE fact re-stamps its age instead of being dropped; a standing restatement is still dropped', () => {
        let s = gameReducer(baseState(), { type: 'ADD_WORLD_FACTS', payload: [{ fact: 'The harbor road is flooded.' }, { fact: 'Rarg is dead.' }] });
        const [stateId, standingId] = s.worldFacts.map(f => f.id);
        s = { ...s, messages: [...s.messages, ...Array.from({ length: 10 }, (_, i) => ({ id: `x${i}`, role: i % 2 ? 'assistant' : 'user', content: 'y' }))] };
        s = gameReducer(s, { type: 'ADD_WORLD_FACTS', payload: [{ fact: 'The harbor road is still flooded.' }, { fact: 'Rarg is dead now.' }] });
        expect(s.worldFacts).toHaveLength(2);
        expect(s.worldFacts.find(f => f.id === stateId).atMessage).toBe(12);
        expect(s.worldFacts.find(f => f.id === standingId).atMessage).toBe(2);
    });

    it('the WORLD FACTS block renders a state fact with its age and a standing fact bare', () => {
        let s = gameReducer(baseState(), { type: 'ADD_WORLD_FACTS', payload: [{ fact: 'The harbor road is flooded.' }, { fact: 'Rarg is dead.' }] });
        s = { ...s, messages: [...s.messages, ...Array.from({ length: 6 }, (_, i) => ({ id: `x${i}`, role: i % 2 ? 'assistant' : 'user', content: 'y' }))] };
        const prompt = buildSystemPrompt({
            character: s.character, inventory: [], quests: [], rollHistory: [], preset: 'classicFantasy', ruleset: 'simplified5e',
            journal: [], npcs: [], party: [], currentLocation: 'Saltmere', combat: { active: false }, worldFacts: s.worldFacts, fronts: [],
            storyMemory: [], retrievedMemories: [], messages: s.messages, messageCount: s.messages.length,
        });
        expect(prompt).toContain('- for now (as of 3 turns ago): The harbor road is flooded.');
        expect(prompt).toContain('- Rarg is dead.');
        expect(prompt).toContain('a line opening "for now (as of N turns ago)" is a passing STATE');
    });

    it('ADD_STORY_MEMORY_CARDS with meta stamps the card; UPDATE_NPC with meta stamps the fresh impression', () => {
        let s = gameReducer(baseState(), { type: 'ADD_STORY_MEMORY_CARDS', payload: [{ type: 'promise', text: 'The hero swore to Orsa to bring the ledger back.', subject: 'the ledger', linkedNpcNames: ['Orsa'] }], ...META });
        expect(s.storyMemory[0].sourceMessage).toBe('a1');
        s = gameReducer(s, { type: 'UPDATE_NPC', payload: { name: 'Orsa', stanceToPlayer: 'appreciates his discretion tonight' }, ...META });
        const orsa = s.npcs.find(n => n.name === 'Orsa');
        expect(Array.isArray(orsa.recentImpressions)).toBe(true);
        expect(orsa.recentImpressions[0]).toMatchObject({ field: 'stanceToPlayer', sourceMessage: 'a1' });
        expect(orsa.stanceToPlayer.startsWith('She trusts the hero')).toBe(true);
    });

    it('DELETE_MESSAGE retracts the facts, cards and impressions minted from that message, posts one infrastructure line, and touches nothing else', () => {
        let s = gameReducer(baseState(), { type: 'ADD_WORLD_FACTS', payload: [{ fact: 'The harbor road is flooded.' }, { fact: 'Rarg is dead.' }], ...META });
        s = gameReducer(s, { type: 'ADD_WORLD_FACTS', payload: [{ fact: 'Odo owns the ferry.' }] }); // no source
        s = gameReducer(s, { type: 'ADD_STORY_MEMORY_CARDS', payload: [{ type: 'promise', text: 'The hero swore to Orsa to bring the ledger back.', linkedNpcNames: ['Orsa'] }], ...META });
        s = gameReducer(s, { type: 'UPDATE_NPC', payload: { name: 'Orsa', stanceToPlayer: 'appreciates his discretion tonight' }, ...META });
        const before = s;

        const t = gameReducer(s, { type: 'DELETE_MESSAGE', payload: 'a1' });
        expect(t.messages.find(m => m.id === 'a1').deleted).toBe(true);
        const retractedFacts = t.worldFacts.filter(f => Number.isFinite(f.retractedAtMessage));
        expect(retractedFacts.map(f => f.fact)).toEqual(['The harbor road is flooded.', 'Rarg is dead.']);
        expect(t.worldFacts.find(f => f.fact === 'Odo owns the ferry.').retractedAtMessage).toBeUndefined();
        expect(t.storyMemory[0]).toMatchObject({ status: 'dormant', retractedAtMessage: before.messages.length });
        expect(t.npcs.find(n => n.name === 'Orsa').recentImpressions).toBeUndefined();
        const line = t.messages[t.messages.length - 1];
        expect(line).toMatchObject({ role: 'system', kind: 'error' });
        expect(line.content).toContain('2 world facts, 1 story card, 1 unconfirmed impression');

        // A message that minted nothing: only the flag, no line.
        const u = gameReducer(before, { type: 'DELETE_MESSAGE', payload: 'u1' });
        expect(u.messages).toHaveLength(before.messages.length);
        expect(u.worldFacts).toBe(before.worldFacts);
        expect(u.storyMemory).toBe(before.storyMemory);
        // Deleting the same message again is a no-op.
        expect(gameReducer(t, { type: 'DELETE_MESSAGE', payload: 'a1' })).toBe(t);
    });

    it('LOAD_GAME types the stamps: aspect whitelisted, message stamps clamped, source string-or-drop; the card keeps its source', () => {
        const payload = {
            ...baseState(),
            worldFacts: [
                { id: 'f1', fact: 'The road is flooded.', category: 'location', aspect: 'state', atMessage: 999, sourceMessage: 'a1', retractedAtMessage: '7' },
                { id: 'f2', fact: 'Rarg is dead.', category: 'event', aspect: 'weird', atMessage: 'x', sourceMessage: { id: 1 } },
                { id: 'f3', fact: 'Pinned.', category: 'event', pinned: 'true' },
            ],
            storyMemory: [{ id: 'c1', type: 'promise', text: 'A promise.', status: 'active', sourceMessage: 'a1', retractedAtMessage: 500 }],
        };
        const s = gameReducer(initialGameState, { type: 'LOAD_GAME', payload });
        const [f1, f2, f3] = s.worldFacts;
        expect(f1).toMatchObject({ aspect: 'state', atMessage: 2, sourceMessage: 'a1', retractedAtMessage: 2 }); // both clamped to the 2-row transcript
        expect(f2.aspect).toBeUndefined();
        expect(f2.atMessage).toBeUndefined();
        expect(f2.sourceMessage).toBeUndefined();
        expect(f3.pinned).toBe(true);
        expect(s.storyMemory[0]).toMatchObject({ sourceMessage: 'a1', retractedAtMessage: 2 });
    });
});

/**
 * Retraction follows the LAST WITNESS, not the first message (memory-research
 * M0, 2026-10-28): a fact restated from a later message used to die with the
 * first message's ✕ — the first message was its only source.
 */
describe('a restatement is a witness; ✕ retracts only what nothing later said', () => {
    const META_A2 = { meta: { sourceMessage: 'a2' } };
    const PROMISE = { type: 'promise', text: 'The hero swore to Orsa to bring the ledger back.', subject: 'the ledger', linkedNpcNames: ['Orsa'] };

    function restatedState() {
        // m1 (a1) mints two facts and a card; m3 (a2) restates one fact and the card.
        let s = gameReducer(baseState(), { type: 'ADD_WORLD_FACTS', payload: [{ fact: 'The harbor road is flooded.' }, { fact: 'Rarg is dead.' }], ...META });
        s = gameReducer(s, { type: 'ADD_STORY_MEMORY_CARDS', payload: [PROMISE], ...META });
        s = { ...s, messages: [...s.messages,
            { id: 'u2', role: 'user', content: 'And Rarg?' },
            { id: 'a2', role: 'assistant', content: 'Rarg is dead now, the reeve repeats. The ledger, Orsa reminds you.' },
        ] };
        s = gameReducer(s, { type: 'ADD_WORLD_FACTS', payload: [{ fact: 'Rarg is dead now.' }], ...META_A2 });
        s = gameReducer(s, { type: 'ADD_STORY_MEMORY_CARDS', payload: [{ ...PROMISE, text: 'The hero swore to Orsa to bring the ledger back to her.' }], ...META_A2 });
        return s;
    }

    it('a duplicate verdict stamps the restating message as a witness on the held fact (every aspect; never its own source) and on the merged card', () => {
        const s = restatedState();
        expect(s.worldFacts).toHaveLength(2);
        const rarg = s.worldFacts.find(f => f.fact === 'Rarg is dead.');
        expect(rarg).toMatchObject({ sourceMessage: 'a1', witnesses: ['a2'], atMessage: 2 }); // a standing fact's age is NOT re-stamped
        expect(s.worldFacts.find(f => f.fact === 'The harbor road is flooded.').witnesses).toBeUndefined();
        expect(s.storyMemory).toHaveLength(1);
        expect(s.storyMemory[0]).toMatchObject({ sourceMessage: 'a1', witnesses: ['a2'] });
        // A same-message restatement (the DM's world_facts and the Scribe's both read a1) is no witness.
        const same = gameReducer(s, { type: 'ADD_WORLD_FACTS', payload: [{ fact: 'The harbor road is flooded still.' }], ...META });
        expect(same.worldFacts.find(f => f.fact === 'The harbor road is flooded.').witnesses).toBeUndefined();
        // A source-less dispatch stamps no witness (a standing fact: nothing changes at all).
        const none = gameReducer(s, { type: 'ADD_WORLD_FACTS', payload: [{ fact: 'Rarg is dead now.' }] });
        expect(none.worldFacts).toBe(s.worldFacts);
    });

    it('✕ on the FIRST message keeps the restated fact and card (source moved to m3), retracts the lone fact, and the line says what was kept', () => {
        const s = restatedState();
        const t = gameReducer(s, { type: 'DELETE_MESSAGE', payload: 'a1' });
        const flooded = t.worldFacts.find(f => f.fact === 'The harbor road is flooded.');
        const rarg = t.worldFacts.find(f => f.fact === 'Rarg is dead.');
        expect(flooded.retractedAtMessage).toBe(4);
        expect(rarg).toMatchObject({ sourceMessage: 'a2' });
        expect(rarg.retractedAtMessage).toBeUndefined();
        expect(rarg.witnesses).toBeUndefined();
        expect(t.storyMemory[0]).toMatchObject({ status: 'active', sourceMessage: 'a2' });
        expect(t.storyMemory[0].retractedAtMessage).toBeUndefined();
        const line = t.messages[t.messages.length - 1];
        expect(line).toMatchObject({ role: 'system', kind: 'error' });
        expect(line.content).toContain('retracted with it: 1 world fact.');
        expect(line.content).toContain('Kept — restated later: 1 world fact, 1 story card.');
        // Afterwards ✕ on m3 — now the source — retracts them: nothing later said them.
        const u = gameReducer(t, { type: 'DELETE_MESSAGE', payload: 'a2' });
        expect(u.worldFacts.find(f => f.fact === 'Rarg is dead.').retractedAtMessage).toBe(5);
        expect(u.storyMemory[0]).toMatchObject({ status: 'dormant', retractedAtMessage: 5 });
        expect(u.messages[u.messages.length - 1].content).toContain('retracted with it: 1 world fact, 1 story card. The DM no longer sees them');
    });

    it('✕ on the WITNESS alone just drops it (no line); ✕ on m3 then m1 retracts everything', () => {
        const s = restatedState();
        const t = gameReducer(s, { type: 'DELETE_MESSAGE', payload: 'a2' });
        expect(t.messages).toHaveLength(s.messages.length); // the flag only, no line
        const rarg = t.worldFacts.find(f => f.fact === 'Rarg is dead.');
        expect(rarg).toMatchObject({ sourceMessage: 'a1' });
        expect(rarg.witnesses).toBeUndefined();
        expect(rarg.retractedAtMessage).toBeUndefined();
        expect(t.storyMemory[0]).toMatchObject({ status: 'active', sourceMessage: 'a1' });
        expect(t.storyMemory[0].witnesses).toBeUndefined();
        const u = gameReducer(t, { type: 'DELETE_MESSAGE', payload: 'a1' });
        expect(u.worldFacts.filter(f => Number.isFinite(f.retractedAtMessage)).map(f => f.fact)).toEqual(['The harbor road is flooded.', 'Rarg is dead.']);
        expect(u.storyMemory[0]).toMatchObject({ status: 'dormant' });
        expect(u.messages[u.messages.length - 1].content).toContain('retracted with it: 2 world facts, 1 story card. The DM no longer sees them');
    });

    it('a kept-only removal posts the kept line', () => {
        let s = gameReducer(baseState(), { type: 'ADD_WORLD_FACTS', payload: [{ fact: 'Rarg is dead.' }], ...META });
        s = { ...s, messages: [...s.messages, { id: 'u2', role: 'user', content: 'x' }, { id: 'a2', role: 'assistant', content: 'y' }] };
        s = gameReducer(s, { type: 'ADD_WORLD_FACTS', payload: [{ fact: 'Rarg is dead now.' }], ...META_A2 });
        const t = gameReducer(s, { type: 'DELETE_MESSAGE', payload: 'a1' });
        expect(t.messages[t.messages.length - 1].content).toBe('✕ Message removed — what it had put on the record is kept — restated later: 1 world fact. Nothing else changed.');
        expect(t.worldFacts[0]).toMatchObject({ sourceMessage: 'a2' });
    });

    it('LOAD_GAME types witnesses on facts and cards: strings the live transcript holds, never the own source, junk and deleted rows dropped', () => {
        const base = baseState();
        const payload = {
            ...base,
            messages: [...base.messages, { id: 'u2', role: 'user', content: 'x' }, { id: 'a2', role: 'assistant', content: 'y' }, { id: 'a3', role: 'assistant', content: 'z', deleted: true }],
            worldFacts: [
                { id: 'f1', fact: 'Rarg is dead.', category: 'event', sourceMessage: 'a1', witnesses: ['a1', 'a2', 42, null, 'ghost', 'a2', 'a3'] },
                { id: 'f2', fact: 'Odo owns the ferry.', category: 'event', sourceMessage: 'a1', witnesses: 'a2' },
            ],
            storyMemory: [
                { id: 'c1', type: 'promise', text: 'A promise.', status: 'active', sourceMessage: 'a1', witnesses: ['a2', 'a1', { id: 'a2' }, 'a3'] },
                { id: 'c2', type: 'promise', text: 'Another.', status: 'active', sourceMessage: 'a1', witnesses: ['ghost'] },
            ],
        };
        const s = gameReducer(initialGameState, { type: 'LOAD_GAME', payload });
        expect(s.worldFacts[0].witnesses).toEqual(['a2']);
        expect(s.worldFacts[1].witnesses).toBeUndefined();
        expect(s.storyMemory[0].witnesses).toEqual(['a2']);
        expect(s.storyMemory[1].witnesses).toBeUndefined();
    });
});
