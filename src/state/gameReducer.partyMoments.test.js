/**
 * The companion as a PERSON WITH BUSINESS (WOW 2026-10-13, two W1 slices):
 * joining and leaving are moments on the roster record (a `meeting` /
 * `farewell` key moment + the engine's `joinedPartyMessage` /
 * `leftPartyMessage` stamps), the Scribe is asked for the join-turn thread
 * while it is fresh, the party line carries the companion's want and current
 * business, the prefix's MOTION rule gives them a voice, and a travelling
 * companion's estranged / rival turn beat is the breaking point.
 */
import { describe, expect, it } from 'vitest';
import { gameReducer, initialGameState } from './gameReducer.js';
import { buildKnownStances } from '../llm/scribe.js';
import { buildRelationshipBeatBlock } from '../engine/relationshipArc.js';
import { buildSystemPrompt } from '../llm/promptBuilder.js';
import { createCharacter } from '../engine/characterUtils.js';

const ABILITY_SCORES = { strength: 14, dexterity: 10, constitution: 16, intelligence: 10, wisdom: 18, charisma: 12 };

function stateWith({ npcs = [], party = [], messageCount = 30 } = {}) {
    return {
        ...initialGameState,
        npcs,
        party,
        messages: Array.from({ length: messageCount }, (_, i) => ({ id: `m${i}`, role: i % 2 ? 'assistant' : 'user', content: `row ${i}` })),
    };
}

const osma = { id: 'c-osma', name: 'Osma Varrow', role: 'tracker', level: 2, hp: 18, maxHp: 18, ac: 15, affinity: 60 };
const record = (name) => (state) => state.npcs.find(n => n.name === name);

describe('ADD_COMPANION mints a meeting moment and the join stamp', () => {
    it('a new companion\'s roster record carries a `meeting` key moment and joinedPartyMessage', () => {
        const after = gameReducer(stateWith(), { type: 'ADD_COMPANION', payload: osma });
        const rec = record('Osma Varrow')(after);
        expect(rec).toBeTruthy();
        expect(rec.bondMoments).toHaveLength(1);
        expect(rec.bondMoments[0]).toMatchObject({ kind: 'meeting', salience: 4, atMessage: 30 });
        expect(rec.bondMoments[0].text).toBe('Osma Varrow joined the hero\'s party as tracker.');
        expect(rec.joinedPartyMessage).toBe(30);
    });

    it('a companion with an existing record (a known NPC who joins) gets the moment on THAT record, resolved exactly', () => {
        const known = { id: 'npc-osma', name: 'Osma Varrow', rosterTier: 'character', kind: 'character', lastNotes: 'A tracker from the fens.', stanceToPlayer: 'Curious about the hero.' };
        const other = { id: 'npc-osma-2', name: 'Osma Thorne', rosterTier: 'character', kind: 'character', lastNotes: 'A different Osma.' };
        const after = gameReducer(stateWith({ npcs: [other, known] }), { type: 'ADD_COMPANION', payload: osma });
        expect(record('Osma Varrow')(after).bondMoments.map(m => m.kind)).toEqual(['meeting']);
        expect(record('Osma Varrow')(after).stanceToPlayer).toBe('Curious about the hero.');
        expect(record('Osma Thorne')(after).bondMoments || []).toEqual([]);
        expect(after.npcs).toHaveLength(2);
    });
});

describe('REMOVE_COMPANION mints a farewell moment and the leave stamp; the record stays', () => {
    it('leaving appends a `farewell` key moment and stamps leftPartyMessage', () => {
        const joined = gameReducer(stateWith(), { type: 'ADD_COMPANION', payload: osma });
        const later = { ...joined, messages: [...joined.messages, ...Array.from({ length: 20 }, (_, i) => ({ id: `n${i}`, role: i % 2 ? 'assistant' : 'user', content: `later ${i}` }))] };
        const after = gameReducer(later, { type: 'REMOVE_COMPANION', payload: { name: 'Osma' } });
        expect(after.party).toEqual([]);
        const rec = record('Osma Varrow')(after);
        expect(rec.bondMoments.map(m => m.kind)).toEqual(['meeting', 'farewell']);
        expect(rec.bondMoments.at(-1).text).toBe('Osma Varrow left the hero\'s party.');
        expect(rec.leftPartyMessage).toBe(50);
        expect(rec.joinedPartyMessage).toBe(30);
        expect(after.messages.at(-1).content).toContain('no longer travelling');
    });
});

describe('the Scribe is asked for the join-turn thread while the join is fresh', () => {
    it('KNOWN STANCES carries JOINED THE PARTY THIS SCENE for a fresh join without a thread, and drops it once a thread exists or the scene has passed', () => {
        const fresh = { id: 'npc-osma', name: 'Osma Varrow', joinedPartyMessage: 28 };
        const messages = Array.from({ length: 30 }, (_, i) => ({ id: `m${i}`, role: 'user', content: 'x' }));
        const text = 'Osma Varrow falls in beside the hero on the road.';
        expect(buildKnownStances({ npcs: [fresh], messages }, text)).toContain('JOINED THE PARTY THIS SCENE — emit openThread');
        expect(buildKnownStances({ npcs: [{ ...fresh, openThread: 'Wants to know if the hero will take her north.' }], messages }, text)).not.toContain('JOINED THE PARTY');
        const old = Array.from({ length: 60 }, (_, i) => ({ id: `m${i}`, role: 'user', content: 'x' }));
        expect(buildKnownStances({ npcs: [fresh], messages: old }, text)).toBeNull();
        // Not present in the turn's texts: not listed at all.
        expect(buildKnownStances({ npcs: [fresh], messages }, 'The reeve counts coins.')).toBeNull();
    });
});

describe('a travelling companion\'s turn beat is the breaking point', () => {
    const npc = { id: 'npc-osma', name: 'Osma Varrow', rosterTier: 'character', disposition: 'hostile', bondMoments: [{ text: 'Osma Varrow called the hero a liar in front of the whole camp.', kind: 'quarrel', salience: 5 }] };
    const beat = (stage) => ({ npcId: 'npc-osma', npcName: 'Osma Varrow', mode: 'turn', stage, since: 'Osma Varrow called the hero a liar in front of the whole camp.', mintedAtMessage: 20, opensAtMessage: 22, closesAtMessage: 60 });

    it('estranged / rival for a PARTY member says why and leaves through remove_companions, or names the one condition', () => {
        for (const stage of ['estranged', 'rival']) {
            const inParty = buildRelationshipBeatBlock(beat(stage), [npc], { messageCount: 30, party: [osma] });
            expect(inParty).toContain('THE BOND HAS TURNED');
            expect(inParty).toContain('TRAVELLING WITH the hero, so this is the breaking point');
            expect(inParty).toContain('`remove_companions`');
            const notInParty = buildRelationshipBeatBlock(beat(stage), [npc], { messageCount: 30, party: [] });
            expect(notInParty).toContain('THE BOND HAS TURNED');
            expect(notInParty).not.toContain('breaking point');
        }
    });

    it('a trusted / intimate turn for a party member is not a breaking point', () => {
        const warm = { ...npc, disposition: 'friendly', bondMoments: [{ text: 'Osma Varrow pulled the hero from the fen.', kind: 'rescue', salience: 5 }] };
        const block = buildRelationshipBeatBlock(beat('trusted'), [warm], { messageCount: 30, party: [osma] });
        expect(block).toContain('THE BOND HAS TURNED');
        expect(block).not.toContain('breaking point');
    });
});

describe('the party line carries the companion\'s want and business; the prefix gives them a voice', () => {
    it('Wants: / Their business now: render from the roster record\'s goals / agenda', () => {
        const text = buildSystemPrompt({
            character: createCharacter('Testa', 'human', 'fighter', ABILITY_SCORES, ['athletics']),
            party: [osma],
            npcs: [{ id: 'npc-osma', name: 'Osma Varrow', rosterTier: 'character', goals: 'Wants her brother\'s name cleared at the weir-court.', agenda: 'Is asking every carter about the Pike\'s barges.' }],
            preset: 'classicFantasy', ruleset: 'simplified5e', inventory: [], quests: [], rollHistory: [], journal: [], worldFacts: [], fronts: [], storyMemory: [], retrievedMemories: [],
            messages: [], messageCount: 0, combat: { active: false },
        });
        const party = text.slice(text.indexOf('## COMPANIONS (PARTY)'));
        expect(party).toContain('  Wants: Wants her brother\'s name cleared at the weir-court.');
        expect(party).toContain('  Their business now: Is asking every carter about the Pike\'s barges.');
        // The prefix rule names the two lines and bounds the voice to one line.
        expect(text).toContain('A companion travelling with the hero is a person with business');
        expect(text).toContain('once per scene they speak or act from their own `Wants:` / `Their business now:`');
        expect(text.indexOf('person with business')).toBeLessThan(text.indexOf('## COMPANIONS (PARTY)'));
    });
});
