/**
 * The 2026-10-22 strengthening queue through the wire and the reducer: the
 * rest wire's fold and TAKE_REST's refusal of junk, a foe declared wounded
 * (`max_hp`), the hero never minted as an NPC, the three Scribe flags read
 * through toFlag, a lane card's status stripped at the door, and a prose
 * trust placeholder that writes nothing.
 */
import { describe, expect, it } from 'vitest';
import { gameReducer, initialGameState } from './gameReducer.js';
import { parseResponse } from '../llm/responseParser.js';
import { createCharacter } from '../engine/characterUtils.js';

const SCORES = { strength: 16, dexterity: 12, constitution: 14, intelligence: 10, wisdom: 10, charisma: 8 };
const astra = createCharacter('Astra Vell', 'human', 'fighter', SCORES, []);
const turns = n => Array.from({ length: n * 2 }, (_, i) => ({ id: `m${i}`, role: i % 2 ? 'assistant' : 'user', content: `line ${i}` }));
const reply = json => parseResponse(`The night passes.\n\`\`\`json\n${JSON.stringify(json)}\n\`\`\``).events;

describe('rest_taken folds at the wire and junk is refused at the reducer (P2)', () => {
    it('the head word names the rest, whatever the casing or the tail; anything else is no rest', () => {
        expect(reply({ rest_taken: 'Long' }).restTaken).toBe('long');
        expect(reply({ rest_taken: 'long rest' }).restTaken).toBe('long');
        expect(reply({ rest_taken: '  SHORT rest by the fire ' }).restTaken).toBe('short');
        expect(reply({ rest_taken: 'a nap' }).restTaken).toBeNull();
        expect(reply({ rest_taken: 'longish' }).restTaken).toBeNull();
        expect(reply({ rest_taken: 7 }).restTaken).toBeNull();
    });

    it('TAKE_REST with a payload that is neither short nor long changes nothing — it used to be a SHORT rest', () => {
        const hurt = { ...initialGameState, character: { ...astra, currentHP: 3 }, messages: turns(4) };
        expect(gameReducer(hurt, { type: 'TAKE_REST', payload: 'Long' })).toBe(hurt);
        expect(gameReducer(hurt, { type: 'TAKE_REST', payload: null })).toBe(hurt);
        const rested = gameReducer(hurt, { type: 'TAKE_REST', payload: 'long' });
        expect(rested.character.currentHP).toBe(astra.maxHP);
    });
});

describe('a foe may be declared already wounded (P2 nit)', () => {
    const start = enemy => gameReducer(
        { ...initialGameState, character: astra, messages: turns(2) },
        { type: 'START_COMBAT', payload: { enemies: reply({ combat_start: { enemies: [enemy] } }).combatStart.enemies } },
    ).combat.enemies[0];

    it('max_hp above hp fields the foe bloodied; absent or below hp, the maximum is the hp', () => {
        expect(reply({ combat_start: { enemies: [{ name: 'Ogre', hp: 8, max_hp: 34 }] } }).combatStart.enemies[0]).toMatchObject({ hp: 8, maxHp: 34 });
        expect(reply({ combat_start: { enemies: [{ name: 'Ogre', hp: 8 }] } }).combatStart.enemies[0]).not.toHaveProperty('maxHp');
        const ogre = start({ name: 'Ogre', hp: 8, max_hp: '34' });
        expect(ogre).toMatchObject({ hp: 8, maxHp: 34, condition: 'critical' });
        expect(start({ name: 'Ogre', hp: 8 })).toMatchObject({ hp: 8, maxHp: 8, condition: 'healthy' });
        expect(start({ name: 'Ogre', hp: 8, max_hp: 4 })).toMatchObject({ hp: 8, maxHp: 8, condition: 'healthy' });
        expect(start({ name: 'Ogre', hp: 8, max_hp: 'lots' })).toMatchObject({ hp: 8, maxHp: 8 });
    });
});

describe('the hero is never an NPC (P2)', () => {
    const base = { ...initialGameState, character: astra, messages: turns(3) };
    it('an UPDATE_NPC named for the hero — exact or the short form — records nobody; another name still lands', () => {
        expect(gameReducer(base, { type: 'UPDATE_NPC', payload: { name: 'Astra Vell', kind: 'character', rosterEligible: true, stanceToPlayer: 'Admires herself.' } }).npcs).toEqual([]);
        expect(gameReducer(base, { type: 'UPDATE_NPC', payload: { name: 'astra vell', kind: 'character', rosterEligible: true } }).npcs).toEqual([]);
        expect(gameReducer(base, { type: 'UPDATE_NPC', payload: { name: 'Astra', kind: 'character', rosterEligible: true } }).npcs).toEqual([]);
        const next = gameReducer(base, { type: 'UPDATE_NPC', payload: { name: 'Maren Tull', kind: 'character', rosterEligible: true, lastNotes: 'Sold the hero rope.' } });
        expect(next.npcs.map(n => n.name)).toEqual(['Maren Tull']);
    });
});

describe('a schema flag is read through toFlag (P2)', () => {
    const maren = { ...initialGameState, character: astra, messages: turns(6) };
    const withThread = gameReducer(maren, { type: 'UPDATE_NPC', payload: { name: 'Maren', kind: 'character', rosterEligible: true, openThread: 'Waiting on the hero\'s answer.' } });

    it('openThreadResolved: "true" settles the thread exactly as `true`; "false" keeps it', () => {
        const kept = gameReducer(withThread, { type: 'UPDATE_NPC', payload: { name: 'Maren', lastNotes: 'x', openThreadResolved: 'false' } });
        expect(kept.npcs[0].openThread).toBe('Waiting on the hero\'s answer.');
        const settled = gameReducer({ ...withThread, messages: turns(20) }, { type: 'UPDATE_NPC', payload: { name: 'Maren', lastNotes: 'Answered.', openThreadResolved: 'true' } });
        expect(settled.npcs[0].openThread).toBe('');
        expect(settled.npcs[0].openThreadResolvedMessage).toBe(40);
    });

    it('a voiced: "true" report is a REMARK (no sighting, no party witnesses); public: "true" travels', () => {
        const party = [{ id: 'jorun', name: 'Jorun', status: 'healthy', hp: 10, maxHp: 10 }];
        const state = { ...initialGameState, character: astra, party, messages: turns(5), npcs: [{ id: 'npc-tammo', name: 'Tammo', rosterTier: 'character', kind: 'character' }] };
        const remarked = gameReducer(state, { type: 'ADD_HERO_TELLS', payload: [{ text: 'lights a pipe before answering', kind: 'habit', voiced: 'true', voicedBy: ['Tammo'], witnesses: [] }] });
        expect(remarked.heroTells).toHaveLength(1);
        expect(remarked.heroTells[0]).toMatchObject({ sightings: [], witnesses: [], voicedCount: 1, voicedBy: ['Tammo'], public: false });

        const seen = gameReducer(state, { type: 'ADD_HERO_TELLS', payload: [{ text: 'pays double without being asked', kind: 'principle', witnesses: ['Tammo'], public: 'true' }] });
        expect(seen.heroTells[0]).toMatchObject({ public: true, witnesses: expect.arrayContaining(['Tammo', 'Jorun']) });
        expect(seen.heroTells[0].sightings).toHaveLength(1);
    });

    it('the template\'s prose trust placeholder writes nothing; a number still moves the record', () => {
        const trusted = gameReducer(withThread, { type: 'UPDATE_NPC', payload: { name: 'Maren', trust: 72 } });
        expect(trusted.npcs[0].trust).toBe(72);
        const echoed = gameReducer(trusted, { type: 'UPDATE_NPC', payload: { name: 'Maren', lastNotes: 'y', trust: 'a number 0-100 ONLY when this exchange visibly changes how far they trust the hero — omit otherwise' } });
        expect(echoed.npcs[0].trust).toBe(72);
    });
});

describe('a lane card carries no status (P2)', () => {
    const base = { ...initialGameState, character: astra, messages: turns(4) };
    const promise = { type: 'promise', subject: 'the blue ribbon', text: 'Mira promised a blue ribbon on the well road if it turned unsafe.', linkedNpcNames: ['Mira'] };

    it('a card born dormant is born active; a re-report by id with status resolved leaves the card active; the DM channel still resolves it', () => {
        const born = gameReducer(base, { type: 'ADD_STORY_MEMORY_CARD', payload: { ...promise, status: 'dormant' } });
        expect(born.storyMemory).toHaveLength(1);
        expect(born.storyMemory[0].status).toBe('active');
        const id = born.storyMemory[0].id;

        const echoed = gameReducer(born, { type: 'ADD_STORY_MEMORY_CARDS', payload: [{ ...promise, id, status: 'resolved' }] });
        expect(echoed.storyMemory).toHaveLength(1);
        expect(echoed.storyMemory[0].status).toBe('active');

        const paid = gameReducer(echoed, { type: 'UPDATE_STORY_MEMORY', payload: { id, status: 'resolved' } });
        expect(paid.storyMemory[0].status).toBe('resolved');
        // And resolved stays terminal on the lane (2026-09-06).
        const again = gameReducer(paid, { type: 'ADD_STORY_MEMORY_CARD', payload: { ...promise, id, status: 'active' } });
        expect(again.storyMemory[0].status).toBe('resolved');
    });

    it('a dormant card still revives on a re-report — the documented revival is untouched', () => {
        const born = gameReducer(base, { type: 'ADD_STORY_MEMORY_CARD', payload: promise });
        const id = born.storyMemory[0].id;
        const dormant = { ...born, storyMemory: [{ ...born.storyMemory[0], status: 'dormant' }] };
        const revived = gameReducer(dormant, { type: 'ADD_STORY_MEMORY_CARD', payload: { ...promise, id } });
        expect(revived.storyMemory[0].status).toBe('active');
    });
});
