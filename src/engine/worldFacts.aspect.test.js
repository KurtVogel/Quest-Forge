/**
 * A state is not a fact (memory-research M0, 2026-09-30) + the retraction
 * stamps: the aspect lexicon, the age tag the live readers render, and the
 * two record-lane tags.
 */
import { describe, expect, it } from 'vitest';
import { classifyFactAspect, describeRetractedTag, describeStateTag, findOpenPlan, isLiveFact, liveWorldFacts } from './worldFacts.js';

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

describe('classifyFactAspect — an intent is not a deed (2026-10-07)', () => {
    it('marks plans, promises, threats, appointments, and forward modals as intent', () => {
        const intents = [
            'The baron plans to seize the Ashford mill at the new moon.',
            'Tammo intends to leave for Ashford when the roads clear.',
            'Saima will marry the miller in spring.',
            'The Guild means to hire the hero to escort the salt caravan.',
            'Maren might sell the inn if the harvest fails.',
            'The council has agreed to meet the hero at dawn by the old mill.',
            'The baron is going to burn the granary.',
            'The baron is planning to seize the mill.',
            "Tammo promised to return the hero's knife by midsummer.",
            'The Pike threatens to burn the chandlery.',
            'Odo is about to confess to the reeve.',
            'The ferry is due to sail at first light.',
        ];
        for (const fact of intents) expect(classifyFactAspect(fact), fact).toBe('intent');
    });

    it('a deed done, a destination, an allegiance, accepted terms, and a death stay standing; a passing state stays state', () => {
        expect(classifyFactAspect('The baron seized the Ashford mill.')).toBeNull();
        expect(classifyFactAspect('The baron agreed to the terms.')).toBeNull();
        expect(classifyFactAspect('The reeve is sworn to the Pike.')).toBeNull();
        expect(classifyFactAspect('The goblin captain Rarg is dead.')).toBeNull();
        expect(classifyFactAspect('Tammo is going to the capital.')).toBe('state');
        expect(classifyFactAspect('The harbor road is flooded.')).toBe('state');
    });

    it('describeStateTag renders an intent as planned with its age, and findOpenPlan answers only to a live intent id', () => {
        const messages = Array.from({ length: 20 }, (_, i) => ({ id: `m${i}`, role: i % 2 ? 'assistant' : 'user', content: 'x' }));
        expect(describeStateTag({ fact: 'x', aspect: 'intent', atMessage: 10 }, { messages, messageCount: 20 })).toBe('planned (as of 5 turns ago): ');
        expect(describeStateTag({ fact: 'x', aspect: 'intent' }, { messages, messageCount: 20 })).toBe('planned: ');
        const plan = { id: 'p1', fact: 'The baron plans to seize the mill.', aspect: 'intent' };
        const buried = { id: 'p2', fact: 'Tammo promised to return the knife.', aspect: 'intent', supersededBy: 'd2' };
        const standing = { id: 's1', fact: 'Odo is dead.' };
        const live = [plan, buried, standing];
        expect(findOpenPlan(live, 'p1')).toBe(plan);
        expect(findOpenPlan(live, ' p1 ')).toBe(plan);
        expect(findOpenPlan(live, 'p2')).toBeNull();
        expect(findOpenPlan(live, 's1')).toBeNull();
        expect(findOpenPlan(live, { evil: true })).toBeNull();
        expect(findOpenPlan(live, '')).toBeNull();
        expect(findOpenPlan(null, 'p1')).toBeNull();
    });
});
