/**
 * A state is not a fact (memory-research M0, 2026-09-30) + the retraction
 * stamps: the aspect lexicon, the age tag the live readers render, and the
 * two record-lane tags.
 */
import { describe, expect, it } from 'vitest';
import { classifyFactAspect, describeRetractedTag, describeStateTag, isLiveFact, liveWorldFacts } from './worldFacts.js';

describe('classifyFactAspect — a passing state vs a standing truth', () => {
    it('marks progressive and state predicates and explicit temporariness as state', () => {
        const states = [
            'The harbor road is flooded.',
            'Tammo is recovering from the fever.',
            'The east gate is closed for the night.',
            'Saltmere remains under siege.',
            'Orsa is away in the capital.',
            'The bridge is being rebuilt.',
            'For now, the ferry runs only at dawn.',
            'The mill is shut this week.',
            'The reeve is in hiding.',
            'The road stays impassable until the thaw.',
        ];
        for (const fact of states) expect(classifyFactAspect(fact), fact).toBe('state');
    });

    it('leaves deaths, names, histories, and -ing nouns as standing facts', () => {
        const standing = [
            'The goblin captain Rarg is dead.',
            'Odo was killed at the docks.',
            'The village of Millhaven burned to the ground.',
            'The Pike buys captives at the toll gate.',
            'Saltmere is a harbor town on the northern coast.',
            'Orsa is the king of the marsh.',
            'The keeper is nothing to the guild.',
            'The lantern is a thing of the old faith.',
            'The bell rang at midnight when the weir failed.',
            'Tammo is dying.', // a death in progress reads as a state only when not simply "dead" — pinned below
        ];
        for (const fact of standing.slice(0, 9)) expect(classifyFactAspect(fact), fact).toBeNull();
        expect(classifyFactAspect('Tammo is dying.')).toBe('state');
        expect(classifyFactAspect('')).toBeNull();
        expect(classifyFactAspect(null)).toBeNull();
    });
});

describe('describeStateTag / isLiveFact / describeRetractedTag', () => {
    const messages = Array.from({ length: 30 }, (_, i) => ({ id: `m${i}`, role: i % 2 ? 'assistant' : 'user', content: 'x' }));

    it('renders the age in conversational turns from atMessage, "for now:" without one, nothing for a standing fact', () => {
        expect(describeStateTag({ fact: 'x', aspect: 'state', atMessage: 10 }, { messages, messageCount: 30 })).toBe('for now (as of 10 turns ago): ');
        expect(describeStateTag({ fact: 'x', aspect: 'state', atMessage: 30 }, { messages, messageCount: 30 })).toBe('for now (as of this turn): ');
        expect(describeStateTag({ fact: 'x', aspect: 'state' }, { messages, messageCount: 30 })).toBe('for now: ');
        expect(describeStateTag({ fact: 'x', atMessage: 10 }, { messages, messageCount: 30 })).toBe('');
        expect(describeStateTag(null)).toBe('');
    });

    it('a retracted fact is not live, is dropped by liveWorldFacts, and carries the record-lane tag', () => {
        const live = { id: 'a', fact: 'A' };
        const retracted = { id: 'b', fact: 'B', retractedAtMessage: 12 };
        const superseded = { id: 'c', fact: 'C', supersededBy: 'd' };
        expect(isLiveFact(live)).toBe(true);
        expect(isLiveFact(retracted)).toBe(false);
        expect(liveWorldFacts([live, retracted, superseded, null])).toEqual([live]);
        expect(describeRetractedTag(retracted)).toBe('[RETRACTED — its message was removed] ');
        expect(describeRetractedTag(live)).toBe('');
    });
});
