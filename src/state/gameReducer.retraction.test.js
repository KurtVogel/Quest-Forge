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
