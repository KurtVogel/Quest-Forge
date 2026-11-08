/**
 * WOW 2026-10-07 slice B, built 2026-11-04 — people have ties to each other:
 * one person's regard of ANOTHER roster person, merged on the record (cap 4,
 * roster-resolved, never the hero, never a stranger, never themselves), typed
 * at load, rendered on the KNOWN NPCs / party line only when the tied person
 * shares the scene, and on the Journal card as "With others".
 */
import { describe, expect, it } from 'vitest';
import { describeTiesForPrompt, mergeNpcTies, normalizeNpcRecord, normalizeNpcTies, NPC_TIES_CAP } from './npcRoster.js';
import { buildKnownNpcsBlock } from '../llm/journalBlocks.js';
import { buildSystemPrompt } from '../llm/promptBuilder.js';
import { buildKnownStances } from '../llm/scribe.js';
import { gameReducer, initialGameState } from '../state/gameReducer.js';

const person = (id, name, extra = {}) => ({ id, name, rosterTier: 'character', kind: 'character', disposition: 'neutral', ...extra });
const roster = () => [
    // "Hesper" is an alias the record was taught (lane 6): a tie names people exactly, by name or alias.
    person('npc-hesper', 'Hesper Vane', { stanceToPlayer: 'Wary respect for the hero.', aliases: ['Hesper'] }),
    person('npc-jethro', 'Jethro Pike'),
    person('npc-maren-t', 'Maren Tull'),
    person('npc-maren-a', 'Maren Ashford'),
    person('npc-corvin', 'Corvin'),
    person('npc-nib', 'Nib'),
];

describe('normalizeNpcTies — the load twin', () => {
    it('types rows string-or-drop, folds two rows about one person, and keeps the newest four', () => {
        const ties = normalizeNpcTies([
            null, 'junk', { name: 'A', regard: '' }, { name: '', regard: 'x' },
            { name: 'Hesper Vane', regard: 'r'.repeat(300), npcId: 'npc-hesper', atMessage: 4.9 },
            { name: 'Hesper', regard: 'the later word', npcId: 'npc-hesper' },
            { name: 'B', regard: 'b' }, { name: 'C', regard: 'c' }, { name: 'D', regard: 'd' }, { name: 'E', regard: 'e', atMessage: -1 },
        ]);
        expect(ties).toHaveLength(NPC_TIES_CAP);
        expect(ties.map(t => t.name)).toEqual(['B', 'C', 'D', 'E']);
        expect(normalizeNpcTies([{ name: 'Hesper Vane', regard: 'r'.repeat(300), npcId: 'npc-hesper', atMessage: 4.9 }])).toEqual([
            { name: 'Hesper Vane', regard: 'r'.repeat(120), npcId: 'npc-hesper', atMessage: 4 },
        ]);
        expect(normalizeNpcTies(null)).toEqual([]);
    });

    it('a record loads its ties typed and a record without ties stays byte-identical', () => {
        const withTies = normalizeNpcRecord(person('npc-x', 'Xan', { ties: [{ name: 'Hesper Vane', regard: 'owes her' }, { name: '', regard: 'drop' }] }));
        expect(withTies.ties).toEqual([{ name: 'Hesper Vane', regard: 'owes her' }]);
        const without = normalizeNpcRecord(person('npc-y', 'Yara'));
        expect('ties' in without).toBe(false);
        const blank = normalizeNpcRecord(person('npc-z', 'Zed', { ties: [] }));
        expect('ties' in blank).toBe(false);
    });
});

describe('mergeNpcTies — the roster is the boundary', () => {
    it('resolves the name to the roster record (full name and id kept), drops strangers, the hero, the ambiguous and the self', () => {
        const self = person('npc-jethro', 'Jethro Pike');
        const ties = mergeNpcTies([], [
            { name: 'Hesper', regard: 'distrusts her since the ferry money' },
            { name: 'Maren', regard: 'ambiguous — two Marens' },
            { name: 'The Harbormaster', regard: 'a stranger to the roster' },
            { name: 'Ilse', regard: 'the hero is not on the roster' },
            { name: 'Jethro', regard: 'himself' },
        ], { npcs: roster(), self, messageCount: 12 });
        expect(ties).toEqual([{ name: 'Hesper Vane', regard: 'distrusts her since the ferry money', npcId: 'npc-hesper', atMessage: 12 }]);
    });

    it('a second regard of the same person replaces the first; the cap keeps the newest four', () => {
        const self = person('npc-x', 'Xan');
        let ties = mergeNpcTies([], [{ name: 'Hesper Vane', regard: 'first' }], { npcs: roster(), self, messageCount: 1 });
        ties = mergeNpcTies(ties, [{ name: 'Hesper', regard: 'second' }], { npcs: roster(), self, messageCount: 2 });
        expect(ties).toEqual([{ name: 'Hesper Vane', regard: 'second', npcId: 'npc-hesper', atMessage: 2 }]);
        ties = mergeNpcTies(ties, [
            { name: 'Jethro Pike', regard: 'j' }, { name: 'Maren Tull', regard: 'm' }, { name: 'Corvin', regard: 'c' }, { name: 'Nib', regard: 'n' },
        ], { npcs: roster(), self, messageCount: 3 });
        expect(ties.map(t => t.name)).toEqual(['Jethro Pike', 'Maren Tull', 'Corvin', 'Nib']);
    });

    it('UPDATE_NPC merges a lane\'s ties onto the record and never mints a person for one', () => {
        const state = { ...initialGameState, npcs: roster(), messages: [{ id: 'm1', role: 'assistant', content: 'Jethro spat when Hesper Vane was named.', timestamp: 1 }] };
        const next = gameReducer(state, {
            type: 'UPDATE_NPC',
            payload: { name: 'Jethro Pike', lastNotes: 'Spat at the name.', ties: [{ name: 'Hesper Vane', regard: 'spits at her name — the ferry money' }, { name: 'Nobody Known', regard: 'x' }] },
        });
        const jethro = next.npcs.find(n => n.id === 'npc-jethro');
        expect(jethro.ties).toEqual([{ name: 'Hesper Vane', regard: 'spits at her name — the ferry money', npcId: 'npc-hesper', atMessage: 1 }]);
        expect(next.npcs).toHaveLength(roster().length);
        expect('ties' in next.npcs.find(n => n.id === 'npc-hesper')).toBe(false);
    });
});

describe('the tie is in the room — prompt rendering', () => {
    const jethro = person('npc-jethro', 'Jethro Pike', {
        lastNotes: 'The net-mender.',
        ties: [{ name: 'Hesper Vane', regard: 'distrusts her since the ferry money', npcId: 'npc-hesper' }, { name: 'Corvin', regard: 'fears him', npcId: 'npc-corvin' }],
    });

    it('describeTiesForPrompt renders only the ties whose person shares the scene, at most two', () => {
        expect(describeTiesForPrompt(jethro, [])).toBe('');
        expect(describeTiesForPrompt(jethro, ['Maren Tull'])).toBe('');
        // "Hesper" reaches Hesper Vane through the roster's alias (lane 7); without the roster it is nobody.
        expect(describeTiesForPrompt(jethro, ['Hesper'])).toBe('');
        expect(describeTiesForPrompt(jethro, ['Hesper'], roster())).toBe('ties: Hesper Vane — distrusts her since the ferry money');
        expect(describeTiesForPrompt(jethro, ['Hesper Vane', 'Corvin'])).toBe('ties: Hesper Vane — distrusts her since the ferry money; Corvin — fears him');
    });

    it('the KNOWN NPCs line carries the tie only when the tied person is present, and the header says what it is', () => {
        const npcs = [jethro, person('npc-hesper', 'Hesper Vane'), person('npc-corvin', 'Corvin')];
        const apart = buildKnownNpcsBlock(npcs, 'Saltmere', { presentNames: ['Jethro Pike'], partyNames: [] });
        expect(apart).not.toContain('ties: Hesper');
        expect(apart).not.toContain('ties: Corvin');
        const together = buildKnownNpcsBlock(npcs, 'Saltmere', { presentNames: ['Jethro Pike', 'Hesper Vane'], partyNames: [] });
        expect(together).toContain('ties: Hesper Vane — distrusts her since the ferry money');
        expect(together).not.toContain('Corvin — fears him');
        expect(together).toContain('"ties:" is how this person regards someone ELSE who is in the scene right now');
        // A companion counts as present.
        const withParty = buildKnownNpcsBlock(npcs, 'Saltmere', { presentNames: ['Jethro Pike'], partyNames: ['Corvin'] });
        expect(withParty).toContain('ties: Corvin — fears him');
    });

    it('a companion\'s party line carries their tie to a present person or another companion', () => {
        const maro = person('npc-maro', 'Maro', { ties: [{ name: 'Hesper Vane', regard: 'does not trust her smile', npcId: 'npc-hesper' }, { name: 'Nib', regard: 'dotes on her', npcId: 'npc-nib' }] });
        const base = {
            character: { name: 'Astra', race: 'human', class: 'fighter', level: 1, currentHP: 12, maxHP: 12, armorClass: 16, abilityScores: { strength: 16, dexterity: 12, constitution: 14, intelligence: 10, wisdom: 10, charisma: 8 }, conditions: [], classResources: {}, hitDice: { remaining: 1, total: 1, die: 10 }, traits: [], features: [] },
            inventory: [], quests: [], rollHistory: [], preset: 'classicFantasy', ruleset: 'simplified5e', customSystemPrompt: '', journal: [],
            npcs: [maro, person('npc-hesper', 'Hesper Vane'), person('npc-nib', 'Nib')],
            party: [{ id: 'c1', name: 'Maro', hp: 9, maxHp: 18, ac: 16, level: 2, affinity: 60 }, { id: 'c2', name: 'Nib', hp: 9, maxHp: 18, ac: 16, level: 2, affinity: 60 }],
            currentLocation: 'Saltmere', combat: { active: false }, worldFacts: [], locations: [], fronts: [], storyMemory: [], retrievedMemories: [], premise: '', recentRulings: [],
        };
        const quiet = buildSystemPrompt({ ...base, messages: [{ id: 'm1', role: 'assistant', content: 'The road was empty.', timestamp: 1 }], messageCount: 1 });
        expect(quiet).toContain('Ties: Nib — dotes on her');
        expect(quiet).not.toContain('Hesper Vane — does not trust her smile');
        const scene = buildSystemPrompt({ ...base, messages: [{ id: 'm1', role: 'assistant', content: 'Hesper Vane smiled at Maro across the table.', timestamp: 1 }], messageCount: 1 });
        expect(scene).toContain('Ties: Hesper Vane — does not trust her smile; Nib — dotes on her');
    });

    it('the Scribe\'s known-stances context lists the ties on record so it never restates them', () => {
        const context = buildKnownStances({ npcs: [jethro], messages: [] }, 'Jethro Pike glared.');
        expect(context).toContain('ties: Hesper Vane — "distrusts her since the ferry money"; Corvin — "fears him"');
    });
});
