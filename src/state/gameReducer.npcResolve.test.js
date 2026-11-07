/**
 * A shared name is not a person (memory-research M0, 2026-10-13) — and since
 * identity by reference, lane 6 (2026-11-08), neither is a SIMILAR name: the
 * record a lane payload refers to is an exact id, an exact name or an exact
 * alias (`findNpcByRef`), nothing else. The 10-13 reproduction — on a roster
 * [Maren Tull, Maren Ashford] a `{ name: 'Maren', bondMoment }` credited the
 * moment to the smith by ROSTER ORDER — now lands on nobody by construction:
 * the DM lane HOLDS "Maren" for the Scribe to link (rung 3), the Scribe lane
 * (shown every id) mints a new person, and an alias two records share is the
 * one ambiguity left, said once.
 */
import { describe, expect, it } from 'vitest';
import { gameReducer, initialGameState } from './gameReducer.js';
import { addNpcAlias, findCompanionRecord, findNpcByRef, normalizeNpcAliases, shortlistNpcCandidates } from '../engine/npcRoster.js';
import { legacyFoldForkedNpcs } from './legacyNpcIdentity.js';

const smith = { id: 'npc-tull', name: 'Maren Tull', rosterTier: 'character', kind: 'character', disposition: 'friendly', lastNotes: 'The smith.', lastSeenMessage: 2 };
const innkeeper = { id: 'npc-ashford', name: 'Maren Ashford', rosterTier: 'character', kind: 'character', disposition: 'wary', lastNotes: 'The innkeeper.', lastSeenMessage: 2 };
const oldTam = { id: 'npc-old-tam', name: 'Old Tam', rosterTier: 'character', kind: 'character', lastNotes: 'The ferryman.', lastSeenMessage: 40, aliases: ['Tam'] };
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
const held = (state) => state.session?.heldNpcUpdates || [];

describe('findNpcByRef — exact id, exact name, exact alias, else nobody (lane 6)', () => {
    const roster = [smith, innkeeper, oldTam, tamReed];

    it('an exact id or an exact (case-folded) name is that record', () => {
        expect(findNpcByRef(roster, { id: 'npc-ashford', name: 'Maren' })).toMatchObject({ npc: innkeeper, matchedBy: 'id' });
        expect(findNpcByRef(roster, { name: 'maren ashford' })).toMatchObject({ npc: innkeeper, matchedBy: 'name' });
        expect(findNpcByRef(roster, { name: 'Maren Ashford' }).ambiguous).toEqual([]);
    });

    it('an exact alias is that record; a short name nobody is known by is nobody — never a word match, never roster order', () => {
        expect(findNpcByRef(roster, { name: 'tam' })).toMatchObject({ npc: oldTam, matchedBy: 'alias' });
        expect(findNpcByRef(roster, { name: 'Maren' })).toEqual({ npc: null, index: -1, ambiguous: [], matchedBy: null });
        expect(findNpcByRef([smith], { name: 'Maren' }).npc).toBeNull();
        expect(findNpcByRef(roster, { name: 'Reed' }).npc).toBeNull();
    });

    it('an alias two records share lands on nobody, with both named', () => {
        const twoTams = [{ ...oldTam, aliases: ['Tam'] }, { ...tamReed, aliases: ['Tam'] }];
        const resolved = findNpcByRef(twoTams, { name: 'Tam' });
        expect(resolved.npc).toBeNull();
        expect(resolved.ambiguous.map(n => n.id)).toEqual(['npc-old-tam', 'npc-tam-reed']);
    });

    it('a payload with neither id nor name, or an unknown id with no name, is nobody without ambiguity', () => {
        expect(findNpcByRef(roster, {})).toEqual({ npc: null, index: -1, ambiguous: [], matchedBy: null });
        expect(findNpcByRef(roster, { id: 'npc-nope' }).npc).toBeNull();
        expect(findNpcByRef(null, { name: 'Maren' }).npc).toBeNull();
    });

    it('addNpcAlias teaches one record a name nobody else answers to; normalizeNpcAliases types, folds and caps', () => {
        const taught = addNpcAlias(roster, 'npc-tull', 'the smith');
        expect(taught.find(n => n.id === 'npc-tull').aliases).toEqual(['the smith']);
        expect(findNpcByRef(taught, { name: 'The Smith' }).npc.id).toBe('npc-tull');
        // Refused: another record's name, another record's alias, its own name.
        expect(addNpcAlias(roster, 'npc-tull', 'Maren Ashford')).toBe(roster);
        expect(addNpcAlias(roster, 'npc-tam-reed', 'Tam')).toBe(roster);
        expect(addNpcAlias(roster, 'npc-tull', 'maren tull')).toBe(roster);
        expect(normalizeNpcAliases(['Tam', ' tam ', 'TAM', '', 7, 'Old Tam', 'x'.repeat(200)], 'Old Tam')).toEqual(['Tam', 'x'.repeat(80)]);
        expect(normalizeNpcAliases(Array.from({ length: 12 }, (_, i) => `n${i}`), 'z')).toHaveLength(8);
    });

    it('the shortlist is what the Scribe is shown, never what decides: word matches first, then the cast the turn names in full', () => {
        const ids = shortlistNpcCandidates(roster, 'Maren', { presenceText: 'Tam Reed mends the nets while the hero waits.' }).map(n => n.id);
        // "Tam Reed" names Old Tam in full too ("tam" is his one identifying token): the shortlist may be loose, it never decides.
        expect(ids).toEqual(['npc-tull', 'npc-ashford', 'npc-old-tam', 'npc-tam-reed']);
        expect(shortlistNpcCandidates(roster, 'the widow', { presenceText: 'Maren Ashford pours.' }).map(n => n.id)).toEqual(['npc-ashford']);
        expect(shortlistNpcCandidates(roster, 'Nobody')).toEqual([]);
    });
});

describe('UPDATE_NPC — the DM lane holds a name the record does not know; the Scribe links it (rung 3)', () => {
    const dm = (presenceText) => ({ meta: { lane: 'dm', ...(presenceText && { presenceText }) } });

    it('"Maren" beside two Marens is held with both as candidates — nothing minted, nothing merged, no error line', () => {
        const before = stateWith([smith, innkeeper]);
        const after = gameReducer(before, { type: 'UPDATE_NPC', payload: { name: 'Maren', bondMoment: rescue }, ...dm('The hero drags Maren out of the mill race.') });
        expect(after.npcs).toBe(before.npcs);
        expect(after.messages).toHaveLength(before.messages.length);
        expect(held(after)).toHaveLength(1);
        expect(held(after)[0]).toMatchObject({ said: 'Maren', candidates: ['npc-tull', 'npc-ashford'], passes: 0, atMessage: 44 });
        expect(held(after)[0].payload).toMatchObject({ name: 'Maren' });
    });

    it('the Scribe links the held name to an id: the record learns the alias and takes the payload; the next "Maren" lands by alias with no hold', () => {
        const heldState = gameReducer(stateWith([smith, innkeeper]), { type: 'UPDATE_NPC', payload: { name: 'Maren', bondMoment: rescue }, ...dm('Maren coughs water.') });
        const linked = gameReducer(heldState, { type: 'LINK_HELD_NPCS', payload: { links: [{ said: 'maren', id: 'npc-ashford' }] } });
        expect(held(linked)).toEqual([]);
        expect(momentsOf(linked, 'npc-ashford')).toContain(rescue.text);
        expect(momentsOf(linked, 'npc-tull')).toEqual([]);
        expect(linked.npcs.find(n => n.id === 'npc-ashford').aliases).toEqual(['Maren']);
        expect(linked.npcs).toHaveLength(2);
        const again = gameReducer(linked, { type: 'UPDATE_NPC', payload: { name: 'Maren', lastNotes: 'Pours the hero a drink.' }, ...dm('Maren pours.') });
        expect(held(again)).toEqual([]);
        expect(again.npcs.find(n => n.id === 'npc-ashford').lastNotes).toBe('Pours the hero a drink.');
        expect(again.npcs.find(n => n.id === 'npc-ashford').name).toBe('Maren Ashford');
    });

    it('"new" mints the held person; an answer naming nobody known, or no answer, counts a pass and the second pass drops it', () => {
        const heldState = gameReducer(stateWith([smith]), { type: 'UPDATE_NPC', payload: { name: 'Orsa Pellwyn', kind: 'character', rosterEligible: true, lastNotes: 'The harbormaster.' }, ...dm('Orsa Pellwyn looks up.') });
        expect(held(heldState)[0]).toMatchObject({ said: 'Orsa Pellwyn', candidates: [] });
        const minted = gameReducer(heldState, { type: 'LINK_HELD_NPCS', payload: { links: [{ said: 'Orsa Pellwyn', id: 'new' }] } });
        expect(minted.npcs.map(n => n.name)).toEqual(['Maren Tull', 'Orsa Pellwyn']);
        expect(held(minted)).toEqual([]);

        const unanswered = gameReducer(heldState, { type: 'LINK_HELD_NPCS', payload: { links: [{ said: 'Orsa Pellwyn', id: 'npc-nope' }] } });
        expect(unanswered.npcs).toHaveLength(1);
        expect(held(unanswered)[0].passes).toBe(1);
        const dropped = gameReducer(unanswered, { type: 'LINK_HELD_NPCS', payload: { links: [] } });
        expect(held(dropped)).toEqual([]);
        expect(dropped.npcs).toHaveLength(1);
    });

    it('a held name said twice keeps one entry; the cap keeps the newest six; a load empties the hold', () => {
        let state = stateWith([smith]);
        for (let i = 0; i < 8; i++) state = gameReducer(state, { type: 'UPDATE_NPC', payload: { name: `Stranger ${i}`, lastNotes: 'x' }, ...dm() });
        state = gameReducer(state, { type: 'UPDATE_NPC', payload: { name: 'Stranger 7', lastNotes: 'again' }, ...dm() });
        expect(held(state)).toHaveLength(6);
        expect(held(state).map(h => h.said)).toEqual(['Stranger 2', 'Stranger 3', 'Stranger 4', 'Stranger 5', 'Stranger 6', 'Stranger 7']);
        expect(held(state).at(-1).payload.lastNotes).toBe('again');
        const loaded = gameReducer(state, { type: 'LOAD_GAME', payload: { ...initialGameState, npcs: [smith], session: { ...initialGameState.session, id: 's', heldNpcUpdates: held(state) } } });
        expect(loaded.session.heldNpcUpdates).toEqual([]);
    });

    it('the Scribe lane was shown every id: a name it does not copy an id for is a new person; an exact name or alias still lands', () => {
        const scribe = { meta: { lane: 'scribe', presenceText: 'Maren smiles.' } };
        const minted = gameReducer(stateWith([smith]), { type: 'UPDATE_NPC', payload: { name: 'Maren', kind: 'character', rosterEligible: true, bondMoment: rescue }, ...scribe });
        expect(minted.npcs.map(n => n.name)).toEqual(['Maren Tull', 'Maren']);
        expect(held(minted)).toEqual([]);
        const byId = gameReducer(stateWith([smith]), { type: 'UPDATE_NPC', payload: { id: 'npc-tull', name: 'Maren', bondMoment: rescue }, ...scribe });
        expect(byId.npcs).toHaveLength(1);
        expect(momentsOf(byId, 'npc-tull')).toContain(rescue.text);
        expect(byId.npcs[0].name).toBe('Maren Tull');
        expect(byId.npcs[0].aliases).toEqual(['Maren']);
    });

    it('an alias two records share is dropped with one infrastructure line naming the candidates (the one ambiguity left)', () => {
        const before = stateWith([{ ...smith, aliases: ['Maren'] }, { ...innkeeper, aliases: ['Maren'] }]);
        const after = gameReducer(before, { type: 'UPDATE_NPC', payload: { name: 'Maren', bondMoment: rescue, lastNotes: 'Grateful.' }, ...dm() });
        expect(after.npcs).toBe(before.npcs);
        const line = after.messages.at(-1);
        expect(line).toMatchObject({ role: 'system', kind: 'error' });
        expect(line.content).toContain('"Maren" could be Maren Tull or Maren Ashford');
        expect(held(after)).toEqual([]);
    });

    it('a longer name landing on a record by alias becomes the name, and the old name stays findable as an alias', () => {
        const short = { id: 'npc-s', name: 'Saima', rosterTier: 'character', kind: 'character', aliases: ['Saima Aallotar'] };
        const after = gameReducer(stateWith([short]), { type: 'UPDATE_NPC', payload: { name: 'Saima Aallotar', lastNotes: 'Full name given.' }, ...dm() });
        expect(after.npcs[0]).toMatchObject({ id: 'npc-s', name: 'Saima Aallotar', aliases: ['Saima'] });
        expect(findNpcByRef(after.npcs, { name: 'saima' }).npc.id).toBe('npc-s');
    });
});

describe('the frozen fold (legacyNpcIdentity, migration only): two full-named Marens stay two people; a short form folds once and stays as an alias', () => {
    it('two distinct full names never fold; a bare short form folds into its long form and is kept as its alias', () => {
        const kept = legacyFoldForkedNpcs([smith, innkeeper, { id: 'npc-short', name: 'Maren', lastNotes: 'Seen at the forge.' }]);
        expect(kept.map(n => n.name).sort()).toEqual(['Maren Ashford', 'Maren Tull']);
        expect(kept).toHaveLength(2);
        expect(kept.find(n => n.id === 'npc-tull').aliases).toEqual(['Maren']);
    });
});

describe('findCompanionRecord — the exact name first, then the short / long form (lane 7\'s row, unchanged)', () => {
    it('prefers the exact record over a first-token match', () => {
        const roster = [{ id: 'a', name: 'Saima Aallotar' }, { id: 'b', name: 'Saima' }];
        expect(findCompanionRecord(roster, 'Saima').id).toBe('b');
        expect(findCompanionRecord(roster, 'saima aallotar').id).toBe('a');
        expect(findCompanionRecord([{ id: 'a', name: 'Saima Aallotar' }], 'Saima').id).toBe('a');
        expect(findCompanionRecord(roster, '')).toBeNull();
        expect(findCompanionRecord(null, 'Saima')).toBeNull();
    });
});
