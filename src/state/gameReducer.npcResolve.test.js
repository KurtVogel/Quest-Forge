/**
 * A shared name is not a person (memory-research M0, 2026-10-13 — "Stale,
 * Misattributed, or Late": misattribution survives every validity filter;
 * resolve by CONTEXT, abstain when context cannot). The reproduction that
 * earned the row: on a roster [Maren Tull, Maren Ashford] a payload
 * `{ name: 'Maren', bondMoment }` credited the moment to the smith by ROSTER
 * ORDER. Now: the person the scene names in full takes it; the one seen
 * inside the scene window takes it when the scene names neither; otherwise
 * NOBODY — nothing minted, nothing merged, one infrastructure line.
 */
import { describe, expect, it } from 'vitest';
import { gameReducer, initialGameState } from './gameReducer.js';
import { dedupeNpcRoster, findCompanionRecord, resolveNpcRef } from '../engine/npcRoster.js';

const smith = { id: 'npc-tull', name: 'Maren Tull', rosterTier: 'character', kind: 'character', disposition: 'friendly', lastNotes: 'The smith.', lastSeenMessage: 2 };
const innkeeper = { id: 'npc-ashford', name: 'Maren Ashford', rosterTier: 'character', kind: 'character', disposition: 'wary', lastNotes: 'The innkeeper.', lastSeenMessage: 2 };
const oldTam = { id: 'npc-old-tam', name: 'Old Tam', rosterTier: 'character', kind: 'character', lastNotes: 'The ferryman.', lastSeenMessage: 40 };
const tamReed = { id: 'npc-tam-reed', name: 'Tam Reed', rosterTier: 'character', kind: 'character', lastNotes: 'The net-mender.', lastSeenMessage: 2 };

const rescue = { text: 'The hero pulled Maren from the mill race.', kind: 'rescue', salience: 5 };

function stateWith(npcs, messageCount = 44) {
    return {
        ...initialGameState,
        npcs,
        messages: Array.from({ length: messageCount }, (_, i) => ({ id: `m${i}`, role: i % 2 ? 'assistant' : 'user', content: `row ${i}` })),
    };
}

const momentsOf = (state, id) => (state.npcs.find(n => n.id === id)?.bondMoments || []).map(m => m.text);

describe('resolveNpcRef — exact id, exact name, one candidate, the scene, the window, else nobody', () => {
    const roster = [smith, innkeeper, oldTam, tamReed];

    it('an exact id or an exact (case-folded) name is that record', () => {
        expect(resolveNpcRef(roster, { id: 'npc-ashford', name: 'Maren' }).npc).toBe(innkeeper);
        expect(resolveNpcRef(roster, { name: 'maren ashford' }).npc).toBe(innkeeper);
        expect(resolveNpcRef(roster, { name: 'Maren Ashford' }).ambiguous).toEqual([]);
    });

    it('a short name with ONE candidate is that person', () => {
        expect(resolveNpcRef([smith, oldTam], { name: 'Maren' }).npc).toBe(smith);
        expect(resolveNpcRef(roster, { name: 'Reed' }).npc).toBe(tamReed);
    });

    it('two candidates: the one the presence text names in FULL takes it', () => {
        const scene = 'Maren Ashford wipes the bar and asks after the hero\'s shoulder.';
        expect(resolveNpcRef(roster, { name: 'Maren' }, { presenceText: scene }).npc).toBe(innkeeper);
        expect(resolveNpcRef(roster, { name: 'Maren' }, { presenceText: 'Maren Tull hammers at the forge.' }).npc).toBe(smith);
    });

    it('two candidates, neither named in full: the one seen inside the scene window, if exactly one', () => {
        const roster2 = [{ ...smith, lastSeenMessage: 10 }, { ...innkeeper, lastSeenMessage: 43 }];
        expect(resolveNpcRef(roster2, { name: 'Maren' }, { presenceText: 'Maren smiles.', messageCount: 44 }).npc.id).toBe('npc-ashford');
        // Both recent, both absent from the scene text: nobody.
        const both = resolveNpcRef([{ ...smith, lastSeenMessage: 42 }, { ...innkeeper, lastSeenMessage: 43 }], { name: 'Maren' }, { presenceText: 'Maren smiles.', messageCount: 44 });
        expect(both.npc).toBeNull();
        expect(both.ambiguous.map(n => n.name)).toEqual(['Maren Tull', 'Maren Ashford']);
    });

    it('"Tam" with Tam Reed named in full in the scene is Tam Reed — never roster order (Old Tam is first)', () => {
        const resolved = resolveNpcRef(roster, { name: 'Tam' }, { presenceText: 'The hero helps Tam Reed with the nets.', messageCount: 44 });
        expect(resolved.npc).toBe(tamReed);
        // The scene names neither in full: the one seen inside the window
        // (Old Tam at row 40 of 44; Tam Reed at row 2) takes it.
        expect(resolveNpcRef(roster, { name: 'Tam' }, { presenceText: 'The hero helps Tam with the nets.', messageCount: 44 }).npc).toBe(oldTam);
    });

    it('a payload with neither id nor name, or a name nobody matches, is nobody without ambiguity', () => {
        expect(resolveNpcRef(roster, {})).toEqual({ npc: null, index: -1, ambiguous: [] });
        expect(resolveNpcRef(roster, { name: 'Orsa' }).npc).toBeNull();
        expect(resolveNpcRef(null, { name: 'Maren' }).npc).toBeNull();
    });
});

describe('UPDATE_NPC — an ambiguous reference mints and merges nothing, said once', () => {
    it('the present Maren takes the rescue; the other is untouched', () => {
        const before = stateWith([smith, innkeeper]);
        const after = gameReducer(before, {
            type: 'UPDATE_NPC',
            payload: { name: 'Maren', bondMoment: rescue },
            meta: { presenceText: 'The hero drags Maren Ashford out of the mill race; Maren Ashford coughs water.' },
        });
        expect(momentsOf(after, 'npc-ashford')).toContain(rescue.text);
        expect(momentsOf(after, 'npc-tull')).toEqual([]);
        expect(after.npcs).toHaveLength(2);
    });

    it('neither present nor alone in the window: dropped, with one infrastructure line naming the candidates', () => {
        const before = stateWith([{ ...smith, lastSeenMessage: 42 }, { ...innkeeper, lastSeenMessage: 43 }]);
        const after = gameReducer(before, { type: 'UPDATE_NPC', payload: { name: 'Maren', bondMoment: rescue, lastNotes: 'Grateful.' } });
        expect(after.npcs).toBe(before.npcs);
        expect(after.npcs.every(n => !(n.bondMoments || []).length)).toBe(true);
        const line = after.messages.at(-1);
        expect(line.role).toBe('system');
        expect(line.kind).toBe('error');
        expect(line.content).toContain('"Maren" could be Maren Tull or Maren Ashford');
        expect(line.content).toContain('not recorded');
    });

    it('one Maren on the roster: unchanged behavior, the short name lands', () => {
        const after = gameReducer(stateWith([smith]), { type: 'UPDATE_NPC', payload: { name: 'Maren', bondMoment: rescue } });
        expect(momentsOf(after, 'npc-tull')).toContain(rescue.text);
        expect(after.messages.some(m => m.kind === 'error')).toBe(false);
    });

    it('a new person with an unshared name is still minted', () => {
        const after = gameReducer(stateWith([smith, innkeeper]), { type: 'UPDATE_NPC', payload: { name: 'Orsa Pellwyn', kind: 'character', rosterEligible: true, lastNotes: 'The harbormaster.' } });
        expect(after.npcs.map(n => n.name)).toContain('Orsa Pellwyn');
    });
});

describe('dedupeNpcRoster keeps two full-named Marens as two people (M0, pinned)', () => {
    it('two distinct full names never fold; a bare short form still folds into its long form', () => {
        const kept = dedupeNpcRoster([smith, innkeeper, { id: 'npc-short', name: 'Maren', lastNotes: 'Seen at the forge.' }]);
        // The short record folds into the FIRST long form that matches (the
        // 2026-07-23 fork guard); the two full names stay apart.
        expect(kept.map(n => n.name).sort()).toEqual(['Maren Ashford', 'Maren Tull']);
        expect(kept).toHaveLength(2);
    });
});

describe('findCompanionRecord — the exact name first, then the short / long form', () => {
    it('prefers the exact record over a first-token match', () => {
        const roster = [{ id: 'a', name: 'Saima Aallotar' }, { id: 'b', name: 'Saima' }];
        expect(findCompanionRecord(roster, 'Saima').id).toBe('b');
        expect(findCompanionRecord(roster, 'saima aallotar').id).toBe('a');
        expect(findCompanionRecord([{ id: 'a', name: 'Saima Aallotar' }], 'Saima').id).toBe('a');
        expect(findCompanionRecord(roster, '')).toBeNull();
        expect(findCompanionRecord(null, 'Saima')).toBeNull();
    });
});
