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
    curateStoryMemory,
    findStoryMemoryMatch,
    ID_REPORT_CONTAINMENT,
    idReportAgrees,
    idReportDrifted,
    normalizeKnownBy,
    normalizeStoryMemoryCard,
    normalizeStoryMemoryUpdate,
    scoreStoryMemory,
    STORY_MEMORY_UPDATE_FIELDS,
} from './storyMemory.js';
import { SCRIBE_SYSTEM_PROMPT } from '../llm/scribe.js';
import { normalizeLocationRecord } from './locationRegistry.js';

const card = over => normalizeStoryMemoryCard({ id: 'c', type: 'relationship', subject: 'Tammo', text: 'x', ...over });

// Revised 2026-11-08 (identity by reference, lane 8; was "a person-named
// subject is not a card's identity" + "the payoff judge scores what the scene
// did not supply"): NO subject or word rung is left — the trust and the slap
// are two cards because nothing but an echoed id or the exact text folds, and
// the payoff detector is gone (the DM's own `used` is the one landing).
describe('P1 — two beats about one person are two cards, and so is a restatement without the id', () => {
    const trust = card({ id: 'c-trust', text: 'Tammo trusted the hero with the key to the mill loft.', salience: 3 });

    it('the slap is a new card; so is the restated trust unless it echoes the id', () => {
        expect(findStoryMemoryMatch([trust], { type: 'relationship', subject: 'Tammo', text: 'Tammo struck the hero across the face at the harvest feast.', salience: 4 })).toBe(-1);
        expect(findStoryMemoryMatch([trust], { type: 'relationship', subject: 'Tammo', text: 'Tammo let the hero keep the loft key in trust.' })).toBe(-1);
        expect(findStoryMemoryMatch([trust], { id: 'c-trust', type: 'relationship', subject: 'Tammo', text: 'Tammo let the hero keep the loft key in trust.' })).toBe(0);
    });

    it('a beat-named subject and an npcAgenda subject are not identity either; the reflection\'s merge_cards is the fold', () => {
        const debt = card({ id: 'c-debt', type: 'promise', subject: 'blacksmith debt', text: 'Owes a debt to the blacksmith.' });
        expect(findStoryMemoryMatch([debt], { type: 'promise', subject: 'blacksmith debt', text: 'Debt is growing larger.' })).toBe(-1);
        const agenda = card({ id: 'c-agenda', type: 'npcAgenda', subject: 'Odo Grells', text: 'Odo plans to corner the eel market before winter.' });
        expect(findStoryMemoryMatch([agenda], { type: 'npcAgenda', subject: 'Odo Grells', text: 'Odo intends to leave town before the magistrate arrives.' })).toBe(-1);
        expect(findStoryMemoryMatch([agenda], { id: 'c-agenda', type: 'npcAgenda', subject: 'Odo', text: 'Odo intends to leave town before the magistrate arrives.' })).toBe(0);
    });
});

// Revised 2026-11-06 (night; was "an id is a claim: an echo rewrites
// nothing"): the echoed id decides, the TYPE is the one structural check,
// and the old word floor only marks a drifted rewrite for the log.
describe('P2 — an echoed id of the same type decides; the word floor is a diagnostic', () => {
    const ferry = card({ id: 'c-ferry', type: 'promise', subject: 'Harl', text: 'Harl the ferryman promised the hero a free crossing at the spring flood.' });

    it('another type under the id matches nothing; the same type lands on the card whatever the words', () => {
        expect(ID_REPORT_CONTAINMENT).toBe(0.3);
        const echo = { id: 'c-ferry', type: 'mystery', subject: 'Ilse', text: 'Nobody knows where Ilse goes on the new moon.' };
        expect(idReportAgrees(ferry, echo)).toBe(false);
        expect(findStoryMemoryMatch([ferry], echo)).toBe(-1);
        const reworded = { id: 'c-ferry', type: 'promise', subject: 'the spring passage', text: 'The boatman at the weir will carry the hero over for nothing once the thaw comes.' };
        expect(idReportAgrees(ferry, reworded)).toBe(true);
        expect(findStoryMemoryMatch([ferry], reworded)).toBe(0);
        expect(idReportDrifted(ferry, reworded)).toBe(true);
        const touching = { id: 'c-ferry', type: 'promise', subject: 'Harl', text: 'Harl still owes the hero that free crossing at the flood.' };
        expect(findStoryMemoryMatch([ferry], touching)).toBe(0);
        expect(idReportDrifted(ferry, touching)).toBe(false);
    });

    it('the id is read first over the whole pool: an earlier look-alike never wins over the card the id names', () => {
        const lookalike = card({ id: 'c-old', type: 'promise', subject: 'Harl', text: 'Harl the ferryman promised the hero a free crossing at the spring flood, and a meal.' });
        const named = card({ id: 'c-new', type: 'promise', subject: 'Harl', text: 'Harl asked the hero to bring word from the mill.' });
        const report = { id: 'c-new', type: 'promise', subject: 'Harl', text: 'Harl the ferryman promised the hero a free crossing at the spring flood.' };
        expect(findStoryMemoryMatch([lookalike, named], report)).toBe(1);
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

    it('the place bonus reads the registry\'s aliases: "Rimehollow" against the market square on record as its alias scores the +4 (lane 9A: an alias, never a fold)', () => {
        const locations = [normalizeLocationRecord({ name: 'Rimehollow', aliases: ['The Rimehollow market square'] })];
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
