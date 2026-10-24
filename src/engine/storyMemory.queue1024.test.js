/**
 * Strengthening queue 2026-10-24 (story-memory Lap 1) — the engine pins:
 * a person-named subject is not a card's identity (P1), the payoff judge
 * scores what the scene did not supply (P1), an id is a claim (P2), the DM
 * lane's update normalizes case and nothing it may not write (P2), the
 * schema's knownBy placeholder is not a knower and the place bonus reads the
 * registry's fold (P2 nits).
 */
import { describe, expect, it } from 'vitest';
import {
    CALLBACK_PAYOFF_CONTAINMENT,
    CALLBACK_PAYOFF_MIN_HITS,
    curateStoryMemory,
    detectCallbackPayoff,
    findStoryMemoryMatch,
    ID_REPORT_CONTAINMENT,
    idReportAgrees,
    isNameSubject,
    normalizeKnownBy,
    normalizeStoryMemoryCard,
    normalizeStoryMemoryUpdate,
    SAME_SUBJECT_CONTAINMENT,
    SAME_SUBJECT_MIN_SHARED,
    scoreStoryMemory,
    STORY_MEMORY_UPDATE_FIELDS,
} from './storyMemory.js';
import { SCRIBE_SYSTEM_PROMPT } from '../llm/scribe.js';
import { upsertLocation } from './locationRegistry.js';

const card = over => normalizeStoryMemoryCard({ id: 'c', type: 'relationship', subject: 'Tammo', text: 'x', ...over });

describe('P1 — a person-named subject is not a card\'s identity', () => {
    const trust = card({ id: 'c-trust', text: 'Tammo trusted the hero with the key to the mill loft.', salience: 3 });

    it('two same-type beats about one named person are two cards; a restatement of one is still one', () => {
        const slap = { type: 'relationship', subject: 'Tammo', text: 'Tammo struck the hero across the face at the harvest feast.', salience: 4 };
        expect(findStoryMemoryMatch([trust], slap)).toBe(-1);
        const restated = { type: 'relationship', subject: 'Tammo', text: 'Tammo let the hero keep the loft key in trust.' };
        expect(findStoryMemoryMatch([trust], restated)).toBe(0);
    });

    it('the gate: the name set aside, at least two shared meaning tokens and 0.4 containment — "hero" alone never clears it', () => {
        expect(SAME_SUBJECT_MIN_SHARED).toBe(2);
        expect(SAME_SUBJECT_CONTAINMENT).toBe(0.4);
        // {hero} is the only shared token: one hit, under the floor — and the
        // fuzzy rung behind it sets the name aside too (a four-token text used
        // to reach its 0.5 on the name + "hero").
        expect(findStoryMemoryMatch([trust], { type: 'relationship', subject: 'Tammo', text: 'Tammo asked the hero for silver.' })).toBe(-1);
        expect(findStoryMemoryMatch([trust], { type: 'relationship', subject: 'Tammo Reed', text: 'Tammo asked the hero for silver.' })).toBe(-1);
    });

    it('a beat-named subject keeps the plain exact-subject rule; npcAgenda is one card per person', () => {
        const debt = card({ id: 'c-debt', type: 'promise', subject: 'blacksmith debt', text: 'Owes a debt to the blacksmith.' });
        expect(findStoryMemoryMatch([debt], { type: 'promise', subject: 'blacksmith debt', text: 'Debt is growing larger.' })).toBe(0);
        const agenda = card({ id: 'c-agenda', type: 'npcAgenda', subject: 'Odo Grells', text: 'Odo plans to corner the eel market before winter.' });
        expect(findStoryMemoryMatch([agenda], { type: 'npcAgenda', subject: 'Odo Grells', text: 'Odo intends to leave town before the magistrate arrives.' })).toBe(0);
    });

    it('isNameSubject reads capitalized content tokens, four at most', () => {
        expect(isNameSubject('Tammo')).toBe(true);
        expect(isNameSubject('Odo Grells')).toBe(true);
        expect(isNameSubject('The Lady of the Mill')).toBe(true);
        expect(isNameSubject('Sundial, Oren, Jack')).toBe(true);
        expect(isNameSubject('blacksmith debt')).toBe(false);
        expect(isNameSubject('Mira ribbon')).toBe(false);
        expect(isNameSubject('')).toBe(false);
        expect(isNameSubject('Ab Bc Cd De Ef')).toBe(false);
    });
});

describe('P1 — the payoff judge scores what the scene did not supply', () => {
    const debt = card({ id: 'c-debt', type: 'promise', subject: 'Tammo', text: 'Tammo owes the hero a debt from the night at the Rimehollow well.', linkedNpcNames: ['Tammo'], location: 'Rimehollow' });
    const scene = { query: 'I look at Tammo.', location: 'Rimehollow', npcs: [{ name: 'Tammo' }], heroName: 'Astra', presenceText: 'You reach the Rimehollow well as night falls.' };
    const sceneReply = 'Tammo leans on the Rimehollow well and squints at the hero. \'Night\'s coming,\' he says, and spits. The chapel bells ring.';

    it('the auditor\'s scene-nouns reply does NOT land; a reply that says the debt DOES', () => {
        expect(detectCallbackPayoff([debt], sceneReply, scene)).toEqual([]);
        // Without the scene the old judge read 4 of 6 tokens and landed it.
        expect(detectCallbackPayoff([debt], sceneReply).map(c => c.id)).toEqual(['c-debt']);
        const said = 'Tammo spits. \'He owes me a debt from that night,\' he says, to nobody in particular.';
        expect(detectCallbackPayoff([debt], said, scene).map(c => c.id)).toEqual(['c-debt']);
    });

    it('the floor is two distinctive hits at a third of the distinctive tokens; a card that is nothing but the scene never lands', () => {
        expect(CALLBACK_PAYOFF_MIN_HITS).toBe(2);
        expect(CALLBACK_PAYOFF_CONTAINMENT).toBe(0.3);
        const ribbon = card({ id: 'c-ribbon', type: 'promise', subject: 'Mira ribbon', text: 'Mira promised to leave a blue ribbon on the well road if it became unsafe.' });
        const ribbonScene = { query: 'the well road', npcs: ['Mira'] };
        // blue + ribbon of {promised, leave, blue, ribbon, became, unsafe}: a spoken callback carries the nouns.
        expect(detectCallbackPayoff([ribbon], 'Mira glances at the well road. \'No blue ribbon on the post — the road is still safe,\' she says.', ribbonScene).map(c => c.id)).toEqual(['c-ribbon']);
        // One distinctive noun is not a landing.
        expect(detectCallbackPayoff([ribbon], 'Mira glances at the well road and tugs the blue shawl tighter.', ribbonScene)).toEqual([]);
        const sceneOnly = card({ id: 'c-scene', text: 'Tammo at the Rimehollow well with the hero.' });
        expect(detectCallbackPayoff([sceneOnly], 'Tammo at the Rimehollow well with the hero, again.', { location: 'Rimehollow', npcs: ['Tammo'] })).toEqual([]);
    });
});

describe('P2 — an id is a claim: an echo rewrites nothing', () => {
    const ferry = card({ id: 'c-ferry', type: 'promise', subject: 'Harl', text: 'Harl the ferryman promised the hero a free crossing at the spring flood.' });

    it('an id re-report with another type or unrelated text matches nothing; one that touches the wording matches', () => {
        expect(ID_REPORT_CONTAINMENT).toBe(0.3);
        const echo = { id: 'c-ferry', type: 'mystery', subject: 'Ilse', text: 'Nobody knows where Ilse goes on the new moon.' };
        expect(idReportAgrees(ferry, echo)).toBe(false);
        expect(findStoryMemoryMatch([ferry], echo)).toBe(-1);
        const sameTypeUnrelated = { id: 'c-ferry', type: 'promise', subject: 'Ilse', text: 'Ilse swore to bring the hero bread every morning.' };
        expect(findStoryMemoryMatch([ferry], sameTypeUnrelated)).toBe(-1);
        const touching = { id: 'c-ferry', type: 'promise', subject: 'Harl', text: 'Harl still owes the hero that free crossing at the flood.' };
        expect(idReportAgrees(ferry, touching)).toBe(true);
        expect(findStoryMemoryMatch([ferry], touching)).toBe(0);
    });

    it('a roster promotion snapshot keeps its stable id across the type flip and a wholesale text change', () => {
        const held = card({ id: 'npc-bond-npc-7', type: 'npcAgenda', subject: 'Odo Grells', text: 'Agenda: corner the eel market.', source: 'npc_roster' });
        const flipped = { id: 'npc-bond-npc-7', type: 'relationship', subject: 'Odo Grells', text: 'Toward the hero: resents the undercut prices.', source: 'npc_roster' };
        expect(findStoryMemoryMatch([held], flipped)).toBe(0);
        // A lane card never carries that source (the merge keeps the stored one): the echo is judged.
        expect(findStoryMemoryMatch([held], { ...flipped, source: 'scribe' })).toBe(-1);
    });
});

describe('P2 — the DM lane\'s update', () => {
    it('lowercases the status so "Resolved" is honored, and writes status / salience / emotionalCharge only', () => {
        expect(normalizeStoryMemoryUpdate({ id: 'c', status: 'Resolved' }).status).toBe('resolved');
        expect(normalizeStoryMemoryUpdate({ id: 'c', status: ' ACTIVE ' }).status).toBe('active');
        expect(STORY_MEMORY_UPDATE_FIELDS).toEqual(['status', 'salience', 'emotionalCharge']);
        const out = normalizeStoryMemoryUpdate({ id: 'c', text: 'rewrite', subject: 'x', tags: ['t'], linkedNpcNames: ['n'], location: 'L', salience: '2', emotionalCharge: 1 });
        expect(Object.keys(out).sort()).toEqual(['emotionalCharge', 'id', 'salience', 'subject', 'text']);
        expect(out.salience).toBe(2);
    });
});

describe('P2 nits — the knownBy placeholder and the place bonus', () => {
    it('the Scribe schema spells knownBy as prose on both fields, and an echo of it is no knower', () => {
        expect(SCRIBE_SYSTEM_PROMPT).not.toMatch(/"knownBy": \[/);
        const placeholders = SCRIBE_SYSTEM_PROMPT.match(/"knownBy": "([^"]+)"/g) || [];
        expect(placeholders).toHaveLength(2);
        for (const line of placeholders) {
            const text = line.match(/"knownBy": "([^"]+)"/)[1];
            expect(normalizeKnownBy(text)).toEqual([]);
            expect(normalizeKnownBy([text])).toEqual([]);
            expect(normalizeKnownBy([text, 'the hero'])).toEqual(['the hero']);
        }
        expect(normalizeKnownBy('the hero')).toEqual(['the hero']);
        expect(normalizeKnownBy('the hero, Tammo and Ilse')).toEqual(['the hero', 'Tammo', 'Ilse']);
        expect(normalizeKnownBy(['Tammo', 'everyone'])).toEqual([]);
        const echoed = normalizeStoryMemoryCard({ type: 'promise', text: 'A public vow before the market.', knownBy: 'ONLY for private information: exactly who knows it', witnessed: true });
        expect(echoed.knownBy).toBeUndefined();
        expect(echoed.witnessed).toBe(true);
    });

    it('the place bonus reads the registry\'s fold: "Rimehollow" against the folded market square scores the +4', () => {
        const locations = upsertLocation(upsertLocation([], 'Rimehollow'), 'The Rimehollow market square');
        const memory = card({ id: 'c-well', text: 'Tammo owes the hero a debt from the night at the well.', location: 'The Rimehollow market square', lastSeenMessage: 0 });
        const messages = Array.from({ length: 60 }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', content: 'm' }));
        // The query names Rimehollow on both sides so the overlap term is equal and only the place bonus differs.
        const away = scoreStoryMemory(memory, { query: 'debt Rimehollow', location: 'Saltmarsh', messages, locations });
        const here = scoreStoryMemory(memory, { query: 'debt Rimehollow', location: 'Rimehollow', messages, locations });
        expect(here - away).toBe(4);
        expect(curateStoryMemory({ memories: [memory], query: 'debt Rimehollow', location: 'Rimehollow', messages, locations })[0].score).toBe(here);
        // An ALIAS with no shared token is the registry's own knowledge: with it
        // the +4, without it (the exact-string / token-fold fallback) nothing.
        const aliased = [{ ...locations[0], aliases: [...(locations[0].aliases || []), 'The Gilded Eel'] }];
        const tavern = card({ id: 'c-eel', text: 'Tammo owes the hero a debt from the night at the tavern.', location: 'The Gilded Eel', lastSeenMessage: 0 });
        const withRegistry = scoreStoryMemory(tavern, { query: 'debt', location: 'Rimehollow', messages, locations: aliased });
        const without = scoreStoryMemory(tavern, { query: 'debt', location: 'Rimehollow', messages });
        expect(withRegistry - without).toBe(4);
        // The exact string still matches with no registry (the query names the place on both sides).
        const elsewhere = scoreStoryMemory(tavern, { query: 'debt The Gilded Eel', location: 'Saltmarsh', messages });
        expect(scoreStoryMemory(tavern, { query: 'debt The Gilded Eel', location: 'The Gilded Eel', messages }) - elsewhere).toBe(4);
    });
});
