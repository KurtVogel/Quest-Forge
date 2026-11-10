/**
 * Strengthening 2026-11-10 (quests, Lap 1) — the engine `quest` card keeps how
 * it ended. The record's 260-char clamp used to fall on the ENDING; the card
 * is budgeted from the ending back now: the ending whole, then the name, the
 * patron whole or not at all, the promise with what is left.
 */
import { describe, expect, it } from 'vitest';
import { gameReducer, initialGameState } from './gameReducer.js';

const hero = {
    name: 'Ilse', race: 'human', class: 'fighter', level: 2, exp: 0, currentHP: 20, maxHP: 20, armorClass: 16,
    abilityScores: { strength: 16, dexterity: 12, constitution: 14, intelligence: 10, wisdom: 10, charisma: 8 },
    conditions: [], classResources: {}, features: [], traits: [], hitDice: { total: 2, remaining: 2, die: 10 },
};
const row = (i, role) => ({ id: `m-${i}`, role, content: `turn ${i}`, timestamp: i });
const closeCard = ({ name, patron, promised, outcome }, type = 'COMPLETE_QUEST') => {
    let state = gameReducer({ ...initialGameState, character: { ...hero } }, {
        type: 'ADD_QUEST', payload: { name, description: 'The job.', ...(patron && { patron }), ...(promised && { promised }) },
    });
    state = { ...state, messages: [...state.messages, row(1, 'user'), row(2, 'assistant'), row(3, 'user'), row(4, 'assistant')] };
    const next = gameReducer(state, { type, payload: { name, outcome } });
    return next.storyMemory.find(card => card.type === 'quest');
};

describe('the quest card keeps its ending', () => {
    it('the audit row: 47 + 14 + 37 + 145 chars keeps the whole ending (129 of 145 before) and cuts the promise', () => {
        const name = 'The Bell of Saint Orrin and the Thieves of Weir';
        const patron = 'Abbot Reme Tal';
        const promised = 'forty silver and a night under a roof';
        const outcome = `${'The bell hangs in the abbey tower again; '.repeat(3)}Reme paid all in full.`;
        expect([name.length, patron.length, promised.length, outcome.length]).toEqual([47, 14, 37, 145]);
        const card = closeCard({ name, patron, promised, outcome });
        expect(card.text).toBe(`"${name}" for ${patron} (promised: forty silver and a…) — completed: ${outcome}`);
        expect(card.text.length).toBeLessThanOrEqual(260);
    });

    it('at the wire caps the ending is whole and the name is cut to make room', () => {
        const outcome = `${'o'.repeat(199)}!`;
        const card = closeCard({ name: 'N'.repeat(160), patron: 'P'.repeat(80), promised: 'x'.repeat(120), outcome });
        expect(card.text.endsWith(` — completed: ${outcome}`)).toBe(true);
        expect(card.text.length).toBeLessThanOrEqual(260);
        expect(card.text.startsWith(`"${'N'.repeat(43)}…"`)).toBe(true);
        // No room for a patron or a promise: both stay off rather than cut to a stub.
        expect(card.text).not.toContain(' for P');
        expect(card.text).not.toContain('promised');
        // The name and the patron are still on the record whole.
        expect(card.subject).toBe('N'.repeat(80));
        expect(card.linkedNpcNames).toEqual(['P'.repeat(80)]);
    });

    it('a long promise is cut, with its mark, after the ending took its room', () => {
        const outcome = 'd'.repeat(150);
        const card = closeCard({ name: 'The Ford', patron: 'Maren', promised: 'p'.repeat(120), outcome }, 'FAIL_QUEST');
        expect(card.text.endsWith(` — failed: ${outcome}`)).toBe(true);
        expect(card.text.length).toBe(260);
        expect(card.text).toMatch(/^"The Ford" for Maren \(promised: p+…\) — failed: /);
    });

    it('a short row reads as before', () => {
        expect(closeCard({ name: 'The Manifest', patron: 'Hesper Vane', promised: '20 gp', outcome: 'Delivered to Vane; she paid.' }).text)
            .toBe('"The Manifest" for Hesper Vane (promised: 20 gp) — completed: Delivered to Vane; she paid.');
        expect(closeCard({ name: 'A Promise to Sanna', outcome: 'Pelle drowned at the weir.' }, 'FAIL_QUEST').text)
            .toBe('"A Promise to Sanna" — failed: Pelle drowned at the weir.');
    });
});
