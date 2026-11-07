// Identity by reference, lane 4 (2026-11-07): the hero's name is a closed
// list compared exactly, and a companion is matched before the hero.
import { describe, expect, it } from 'vitest';
import { heroNameForms } from './textMatch.js';
import { isHeroRef, resolveSpellRecipients } from './spellcasting.js';
import { prepareHeroTellReports } from './heroTells.js';
import { gameReducer, initialGameState } from '../state/gameReducer.js';

const forms = name => [...heroNameForms(name)].sort();

describe('heroNameForms', () => {
    it('is the full name and its own words', () => {
        expect(forms('Astra Vane')).toEqual(['astra', 'astra vane', 'vane']);
        expect(forms('Astra')).toEqual(['astra']);
    });

    it('leaves out particles and titles, never the full name', () => {
        expect(forms('Sir Astra of Vane')).toEqual(['astra', 'sir astra of vane', 'vane']);
        expect(forms('The Lady')).toEqual(['the lady']);
    });

    it('keeps a short real name, and survives odd input', () => {
        expect(forms('Bo Reed')).toEqual(['bo', 'bo reed', 'reed']);
        expect(forms('Virtapää, Aino')).toEqual(['aino', 'virtapää', 'virtapää, aino']);
        expect(forms('')).toEqual([]);
        expect(forms(null)).toEqual([]);
        expect(forms({})).toEqual([]);
    });
});

describe('isHeroRef compares against the list', () => {
    const hero = { name: 'Astra Vane' };

    it('the forms and the self words are the hero', () => {
        for (const ref of ['Astra Vane', 'astra', ' VANE ', 'player', 'the hero', 'self']) {
            expect(isHeroRef(ref, hero), ref).toBe(true);
        }
    });

    it('a name that merely holds a form is someone else', () => {
        for (const ref of ['Lord Vane', 'Captain Astra', 'Astra Reed', 'Vane the Younger']) {
            expect(isHeroRef(ref, hero), ref).toBe(false);
        }
    });

    it('a healing spell on "Lord Vane" reaches him, not the hero', () => {
        const spell = { targeting: { side: 'any', mode: 'single' } };
        const { recipients } = resolveSpellRecipients(spell, hero, [], ['Lord Vane']);
        expect(recipients).toEqual([{ type: 'other', name: 'Lord Vane' }]);
    });
});

describe('UPDATE_NPC keeps a person who only shares a name with the hero', () => {
    const update = (heroName, name) => gameReducer(
        { ...initialGameState, character: { ...initialGameState.character, name: heroName } },
        { type: 'UPDATE_NPC', payload: { name, kind: 'character', rosterEligible: true, lastNotes: 'Met at the gate.' } },
    ).npcs.map(npc => npc.name);

    it('"Lord Vane" beside a hero "Astra Vane" gets a record', () => {
        expect(update('Astra Vane', 'Lord Vane')).toEqual(['Lord Vane']);
    });

    it('"Astra Reed" beside a single-name hero "Astra" gets a record', () => {
        expect(update('Astra', 'Astra Reed')).toEqual(['Astra Reed']);
    });

    it('the hero\'s own forms still record nobody', () => {
        expect(update('Astra Vane', 'Astra')).toEqual([]);
        expect(update('Astra Vane', 'astra vane')).toEqual([]);
    });
});

describe('a tell keeps a witness who only shares a name with the hero', () => {
    const report = witnesses => ({ text: 'turns a coin over the knuckles', kind: 'habit', sighted: true, public: true, witnesses });

    it('drops the hero\'s forms and keeps Lord Vane', () => {
        const [prepared] = prepareHeroTellReports([report(['Astra', 'Lord Vane'])], { heroName: 'Astra Vane' });
        expect(prepared.witnesses).toEqual(['Lord Vane']);
    });
});
