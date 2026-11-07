/**
 * Identity by reference, lane 6 (2026-11-08): the save-version-4 migration
 * and the Scribe's view of people. The migration is the ONE run of the fuzzy
 * matcher (frozen in legacyNpcIdentity.js): forks fold as the old load did,
 * and every people-name the save holds outside the roster that the matcher
 * resolved to exactly one record becomes that record's alias — so the exact
 * lookups that replaced the matcher still find "Mira" for Mira Vane. The
 * Scribe is shown KNOWN NPCS with ids and HELD NAMES with shortlists.
 */
import { describe, expect, it } from 'vitest';
import { CURRENT_SAVE_VERSION, migrateLoadedSave, MIGRATIONS } from './migrations.js';
import { initialGameState } from './initialState.js';
import { buildHeldNames, buildKnownNpcIds, buildScribeContext, SCRIBE_ANCHORS, SCRIBE_SYSTEM_PROMPT } from '../llm/scribe.js';

const person = (id, name, extra = {}) => ({ id, name, rosterTier: 'character', kind: 'character', disposition: 'neutral', lastNotes: 'x', ...extra });

const oldSave = () => ({
    ...initialGameState,
    saveVersion: 3,
    character: { ...initialGameState.character, name: 'Astra Vane' },
    npcs: [
        person('npc-mira', 'Mira Vane', { stanceToPlayer: 'Fond.', lastSeen: 10 }),
        person('npc-mira2', 'Mira', { lastNotes: 'A fork of the same woman.', lastSeen: 20, bondMoments: [{ text: 'She laughed at his joke.', kind: 'other', salience: 2 }] }),
        person('npc-tam', 'Old Tammo'),
        person('npc-anselm', 'Brother Anselm'),
        person('npc-reed', 'Tam Reed'),
    ],
    quests: [{ id: 'q1', name: 'The letter', status: 'active', patron: 'Anselm' }],
    storyMemory: [{ id: 'c1', type: 'promise', status: 'active', text: 'A ribbon for the road.', linkedNpcNames: ['Sister Mira', 'Astra'] }],
    heroTells: [{ id: 't1', kind: 'habit', text: 'digs out a pipe', witnesses: ['Tammo', 'Tam'], voicedBy: ['the Elder Anselm'], sightings: [3] }],
    ledger: [{ kind: 'coin', status: 'applied', cp: 10, movedCp: 10, party: 'Vane', sourceId: 'msg-1', atMessage: 1, lane: 'dm' }],
    worldFacts: [{ id: 'f1', fact: 'The mill is sold.', knownBy: ['Brother Anselm', 'Mira V.'] }],
    // One stamped row, so the legacy message-clock heal behaves the same on every run.
    messages: [{ id: 'm0', role: 'user', content: 'x', timestamp: 5 }],
});

describe('save version 4 — the one run of the frozen matcher', () => {
    it('is version 4, and the pipeline folds forks once and seeds aliases from the names the save holds about people', () => {
        expect(CURRENT_SAVE_VERSION).toBe(4);
        expect(MIGRATIONS.at(-1).toVersion).toBe(4);
        const migrated = migrateLoadedSave(oldSave());
        expect(migrated.saveVersion).toBe(4);
        const names = migrated.npcs.map(n => n.name);
        // The fork folded into the longer name; the short name is its alias.
        expect(names).toEqual(['Mira Vane', 'Old Tammo', 'Brother Anselm', 'Tam Reed']);
        const mira = migrated.npcs.find(n => n.id === 'npc-mira');
        expect(mira.bondMoments.map(m => m.text)).toContain('She laughed at his joke.');
        // Seeded: "Mira" (the fold), "Sister Mira" (a card link, title-stripped core) and "Mira V." (a knower; "v" is too short to count).
        expect(mira.aliases).toEqual(expect.arrayContaining(['Mira', 'Sister Mira', 'Mira V.']));
        // "Anselm" (a patron) and "the Elder Anselm" (a voice) resolve to Brother Anselm; "Brother Anselm" is his own name, no alias.
        expect(migrated.npcs.find(n => n.id === 'npc-anselm').aliases).toEqual(expect.arrayContaining(['Anselm', 'the Elder Anselm']));
        // "Tammo" is contained in "Old Tammo" alone; "Tam" in "Tam Reed" alone ("tam" is not "tammo"): one candidate each, seeded.
        expect(migrated.npcs.find(n => n.id === 'npc-tam').aliases).toEqual(['Tammo']);
        expect(migrated.npcs.find(n => n.id === 'npc-reed').aliases).toEqual(['Tam']);
        // The hero's own forms ("Astra", "Vane") are never aliases of anyone.
        expect(migrated.npcs.some(n => (n.aliases || []).some(a => ['Astra', 'Vane'].includes(a)))).toBe(false);
    });

    it('is idempotent and skips a save already at version 4', () => {
        const once = migrateLoadedSave(oldSave());
        const twice = migrateLoadedSave({ ...once, saveVersion: 3 });
        expect(twice.npcs).toEqual(once.npcs);
        const current = migrateLoadedSave({ ...oldSave(), saveVersion: 4 });
        expect(current.npcs.map(n => n.name)).toContain('Mira');
    });
});

describe('what the Scribe is shown about people (lane 6)', () => {
    const state = {
        ...initialGameState,
        npcs: [
            person('npc-saima', 'Saima Aallotar', { aliases: ['Saima'] }),
            person('npc-reed', 'Saima Reed'),
            person('npc-orsa', 'Orsa Pellwyn'),
            person('npc-far', 'Far Away Fen'),
        ],
        session: { ...initialGameState.session, heldNpcUpdates: [{ said: 'Saima', payload: { name: 'Saima' }, candidates: ['npc-saima', 'npc-reed'], passes: 0, atMessage: 4 }] },
    };

    it('KNOWN NPCS lists the people the turn names (by name or alias) and every held name\'s candidates, with ids and aliases', () => {
        const block = buildKnownNpcIds(state, 'I nod to Orsa Pellwyn.', 'Orsa Pellwyn frowns; Saima laughs.');
        expect(block.split('\n')).toEqual([
            'npc-saima | Saima Aallotar (also: Saima)',
            'npc-reed | Saima Reed',
            'npc-orsa | Orsa Pellwyn',
        ]);
        expect(buildKnownNpcIds({ ...state, session: initialGameState.session }, 'Nobody here.', 'The marsh is quiet.')).toBeNull();
    });

    it('HELD NAMES prints each held name with its shortlist, or "new" alone when nobody is likely', () => {
        expect(buildHeldNames(state)).toBe('"Saima" — npc-saima Saima Aallotar; npc-reed Saima Reed; or "new"');
        const lonely = { ...state, session: { ...state.session, heldNpcUpdates: [{ said: 'Corren', payload: {}, candidates: [], passes: 0 }] } };
        expect(buildHeldNames(lonely)).toContain('"Corren" — nobody on the roster');
        expect(buildHeldNames(initialGameState)).toBeNull();
    });

    it('the Scribe context carries both blocks, the schema asks for the id and name_links, and the anchors know name_links', () => {
        const context = buildScribeContext(state, 'I nod to Orsa Pellwyn.', 'Orsa Pellwyn frowns.');
        expect(context.knownNpcIds).toContain('npc-orsa | Orsa Pellwyn');
        expect(context.heldNames).toContain('"Saima"');
        expect(SCRIBE_SYSTEM_PROMPT).toContain('"id": "when this person is listed under KNOWN NPCS');
        expect(SCRIBE_SYSTEM_PROMPT).toContain('"name_links"');
        expect(SCRIBE_SYSTEM_PROMPT).toContain('HELD NAMES are names the DM used this turn');
        expect(SCRIBE_ANCHORS).toContain('name_links');
    });
});
