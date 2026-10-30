/**
 * Living-world P2 (2026-10-30, the Opus playtest, measured): END_COMBAT
 * counted a NAMED foe ("Joss", "oar-hand") as a motif family. A person's name
 * is not a kind: a foe whose name matches a roster PERSON (character tier,
 * `namesMatch`) leaves `foeFamilies`; the `enemies` summary keeps the name.
 */
import { describe, expect, it } from 'vitest';
import { buildEncounterEntry } from './worldTempo.js';

const state = (enemies, npcs) => ({
    messages: [], currentLocation: 'The Docks of Odrana',
    combat: { enemies },
    npcs,
});

describe('a roster-named foe is not a motif family (2026-10-30 P2)', () => {
    const roster = [
        { id: 'n1', name: 'Joss Harrow', rosterTier: 'character' },
        { id: 'n2', name: 'Ghoul', rosterTier: 'archived_creature' },
    ];

    it('"Joss" adds no family, "Goblin" still does, and the ledger\'s enemies string still names Joss', () => {
        const entry = buildEncounterEntry(state([{ name: 'Joss' }, { name: 'Goblin 1' }, { name: 'Goblin 2' }], roster), {});
        expect(entry.foeFamilies).toEqual(['goblin']);
        expect(entry.enemies).toBe('Joss, 2× Goblin');
    });

    it('the roster rule only — a capitalized stranger is still keyed, a numbered roster person is still a person, a legacy tier-less record counts as a person', () => {
        expect(buildEncounterEntry(state([{ name: 'Varn' }], roster), {}).foeFamilies).toEqual(['varn']);
        expect(buildEncounterEntry(state([{ name: 'Joss Harrow 2' }], roster), {}).foeFamilies).toEqual([]);
        expect(buildEncounterEntry(state([{ name: 'Mira Tull' }], [{ id: 'n3', name: 'Mira Tull' }]), {}).foeFamilies).toEqual([]);
    });

    it('an archived creature record or a generic creature name never shields a kind; no roster is no rule', () => {
        expect(buildEncounterEntry(state([{ name: 'Ghoul 1' }, { name: 'Ghoul 2' }], roster), {}).foeFamilies).toEqual(['ghoul']);
        expect(buildEncounterEntry(state([{ name: 'Bandit' }], [{ id: 'n4', name: 'Bandit', rosterTier: 'character' }]), {}).foeFamilies).toEqual(['bandit']);
        expect(buildEncounterEntry(state([{ name: 'Joss' }], undefined), {}).foeFamilies).toEqual(['joss']);
        expect(buildEncounterEntry(state([{ name: 'Joss' }], [null, 'junk', { name: 7 }]), {}).foeFamilies).toEqual(['joss']);
    });
});
