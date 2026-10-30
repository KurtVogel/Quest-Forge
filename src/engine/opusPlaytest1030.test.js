import { describe, expect, it } from 'vitest';
import { foeFamilyKey } from './worldTempo.js';
import { buildKnownLands } from '../llm/scribe.js';
import { WOUND_CARD_TEXT_MAX, fitSentences } from './fightTally.js';
import { COMMITMENT_CONTAINMENT, COMMITMENT_MIN_SHARED, findStoryMemoryMatch } from './storyMemory.js';
import { gameReducer, initialGameState } from '../state/gameReducer.js';

// The 2026-10-30 Opus-played run (opus-flash-2, Gemini 3.8 Flash DM): what the
// engine got wrong, pinned. The areRelatedPlaces kinship fix is pinned in
// locationRegistry.test.js, the defeat-by-flight terminal in combatExchange.test.js.

describe('a parenthetical epithet is not a foe family', () => {
    it('keys "Syndicate Warden (Cleaver)" to warden, not "(cleaver)"', () => {
        expect(foeFamilyKey('Syndicate Warden (Cleaver)')).toBe('warden');
        expect(foeFamilyKey('Syndicate Warden (Billet)')).toBe('warden');
        expect(foeFamilyKey('Ghoul 2')).toBe('ghoul');
        expect(foeFamilyKey('ichor ghouls')).toBe('ghoul');
    });
});

describe('KNOWN LANDS: a place in no land is not in a listed land by default', () => {
    const locations = [
        { id: 'l1', name: 'The Quays, Harrow Sound', region: 'Fells of Marrow' },
        { id: 'l2', name: 'Puerto Azafrán', region: null },
    ];
    it('tells the Scribe a NEW land may be at hand when the current place lies in no land', () => {
        const text = buildKnownLands({ locations, currentLocation: 'Puerto Azafrán', session: { premise: 'Across the Strait of Teeth lies the Saffron Reach.' } });
        expect(text).toContain('NO land on record yet');
        expect(text).toContain('this is a NEW land');
        expect(text).toContain('CAMPAIGN PREMISE');
    });
    it('says nothing of a new land when the current place lies in a land on record', () => {
        const text = buildKnownLands({ locations, currentLocation: 'The Quays, Harrow Sound', session: { premise: 'x' } });
        expect(text).toContain('"Fells of Marrow"');
        expect(text).not.toContain('NEW land');
    });
});

describe('the wound card ends on a sentence', () => {
    it('keeps whole sentences up to the cap and drops the one that would overflow', () => {
        const first = 'Sanni Koskela fell to Syndicate Warden (Cleaver) and Syndicate Warden (Billet) at Kiln Throat, went down at 0 HP in round 1 and rolled 2 death saves and took Syndicate Warden (Billet)\'s critical blow in round 1.';
        const text = fitSentences([first, 'Maro went down in the fight.', 'The wound is fresh and unnamed.'], WOUND_CARD_TEXT_MAX);
        expect(text.length).toBeLessThanOrEqual(WOUND_CARD_TEXT_MAX);
        expect(text).toMatch(/\.$/);
        expect(text.startsWith(first)).toBe(true);
        expect(text).not.toContain('fresh and unnamed');
    });
    it('a lone over-long first sentence is clipped at a word with an ellipsis', () => {
        const text = fitSentences([`${'word '.repeat(80)}end.`], 60);
        expect(text.length).toBeLessThanOrEqual(60);
        expect(text.endsWith('…')).toBe(true);
        expect(text).not.toMatch(/\s…$/);
    });
});

describe('a promise re-minted in new words about the same person is the same promise', () => {
    const held = {
        id: 'mem-1', type: 'promise', status: 'active', subject: 'Maro\'s guide agreement in the Basin', linkedNpcNames: ['Maro'],
        text: 'Maro agreed to serve as Sanni\'s guide between the lime-wharves and cooperage alleys in the Basin for one silver per day, explicitly refusing to bleed for family business.',
    };
    it('matches the run\'s reworded guide contract on the shared person and the shared meaning', () => {
        const reworded = {
            type: 'promise', subject: 'Maro\'s guidance contract', linkedNpcNames: ['Maro'],
            text: 'Maro agreed to guide Sanni through the Saffron Basin for one silver per day, explicitly refusing to engage syndicate enforcers on her behalf.',
        };
        expect(findStoryMemoryMatch([held], reworded)).toBe(0);
        expect(COMMITMENT_MIN_SHARED).toBe(3);
        expect(COMMITMENT_CONTAINMENT).toBe(0.5);
    });
    it('a DIFFERENT promise to the same person, or the same words under another type, is not a match', () => {
        const passage = {
            type: 'promise', subject: 'Fifty silver debt to Maro', linkedNpcNames: ['Maro'],
            text: 'Sanni gave her word as a Koskela to pay Maro fifty silver pieces for ship passage once Eero is freed from the High Wash.',
        };
        expect(findStoryMemoryMatch([held], passage)).toBe(-1);
        // The same commitment reworded under another TYPE is not this rung's (the exact-text rung is type-agnostic by design).
        expect(findStoryMemoryMatch([held], {
            type: 'relationship', subject: 'Maro and Sanni', linkedNpcNames: ['Maro'],
            text: 'Maro agreed to guide Sanni through the Saffron Basin for one silver per day, explicitly refusing to engage syndicate enforcers on her behalf.',
        })).toBe(-1);
        expect(findStoryMemoryMatch([held], { type: 'promise', subject: 'A guide for silver', linkedNpcNames: ['Tuuri'], text: held.text })).toBe(0); // the exact text rung still wins
    });
});

describe('one "Death save skipped" line per skipped save', () => {
    const dying = {
        ...initialGameState,
        character: { ...initialGameState.character, level: 1, currentHP: 0, maxHP: 8, dying: true, deathSaves: { successes: 0, failures: 0 }, conditions: ['Unconscious'] },
        party: [],
        messages: [],
    };
    it('the exchange lane converts QUIETLY (its own note already said so); the resolver lane still posts the line', () => {
        const quiet = gameReducer(dying, { type: 'DEATH_SAVE_RESULT', payload: { die: null, quiet: true } });
        expect(quiet.character.lowLevelDefeat).toBe(true);
        expect(quiet.messages.filter(m => /Death save skipped/.test(m.content))).toHaveLength(0);
        const loud = gameReducer(dying, { type: 'DEATH_SAVE_RESULT', payload: { die: null } });
        expect(loud.character.lowLevelDefeat).toBe(true);
        expect(loud.messages.filter(m => /Death save skipped/.test(m.content))).toHaveLength(1);
    });
});
