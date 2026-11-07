/**
 * Identity by reference, lane 6C (2026-11-08): the reflection confirms that
 * two records are one person (`same_person`, from a shortlist the engine
 * offered) and the engine merges by id; a tie carries the other person's id;
 * a person's death is the record's own `dead` flag, written by the Scribe's
 * `died: true` and seeded once by the save-version-5 migration.
 */
import { describe, expect, it, vi } from 'vitest';

const { sendMessage } = vi.hoisted(() => ({ sendMessage: vi.fn() }));
vi.mock('../llm/adapter.js', async (importOriginal) => ({ ...(await importOriginal()), sendMessage }));

import { gameReducer, initialGameState } from './gameReducer.js';
import { isRecordedDead, mergeNpcRecords, mergeNpcTies, possibleSamePersonPairs } from '../engine/npcRoster.js';
import { migrateLoadedSave } from './migrations.js';
import { REFLECTION_ANCHORS, runNpcFrontReflection, SCRIBE_SYSTEM_PROMPT } from '../llm/scribe.js';

const person = (id, name, extra = {}) => ({ id, name, rosterTier: 'character', kind: 'character', disposition: 'neutral', lastNotes: 'x', ...extra });

describe('possibleSamePersonPairs — the shortlist the reflection is asked about', () => {
    it('pairs a short form with its long form and an alias with a name; two full names that share a first name are not a pair', () => {
        const roster = [
            person('a', 'Saima Aallotar'),
            person('b', 'Saima'),
            person('c', 'Maren Tull'),
            person('d', 'Maren Ashford'),
            person('e', 'Brother Anselm', { aliases: ['the Elder'] }),
            person('f', 'The Elder'),
            { id: 'g', name: 'Saima Reed', rosterTier: 'archived_creature', kind: 'creature' },
        ];
        expect(possibleSamePersonPairs(roster)).toEqual([
            { ids: ['a', 'b'], names: ['Saima Aallotar', 'Saima'] },
            { ids: ['e', 'f'], names: ['Brother Anselm', 'The Elder'] },
        ]);
        expect(possibleSamePersonPairs([])).toEqual([]);
    });
});

describe('MERGE_NPC_RECORDS — the reflection\'s answer, by id', () => {
    const state = () => ({
        ...initialGameState,
        npcs: [
            person('a', 'Saima Aallotar', { stanceToPlayer: 'Amused.', lastSeen: 10, bondMoments: [{ text: 'She shared his mug.', kind: 'other', salience: 2 }], ties: [{ name: 'Old Tammo', regard: 'trusts him', npcId: 't' }] }),
            person('b', 'Saima', { lastNotes: 'Invited him up.', lastSeen: 20, pinned: true, dead: true, bondMoments: [{ text: 'She invited him up after closing.', kind: 'intimacy', salience: 5 }], aliases: ['the harbor-chart woman'] }),
            person('t', 'Old Tammo', { ties: [{ name: 'Saima', regard: 'owes her twine', npcId: 'b' }] }),
        ],
        quests: [{ id: 'q1', name: 'The chart', status: 'active', patron: 'Saima', patronId: 'b' }],
        ledger: [{ kind: 'coin', status: 'applied', cp: 10, movedCp: 10, party: 'Saima', partyId: 'b', sourceId: 'm1', atMessage: 1, lane: 'dm' }],
        session: { ...initialGameState.session, id: 's', heldNpcUpdates: [{ said: 'the chart woman', payload: { name: 'the chart woman' }, candidates: ['a', 'b'], passes: 0, atMessage: 2 }] },
    });

    it('folds the dropped record into the kept one — name kept, the other name an alias, history and flags united — and repoints quests, the ledger, ties and held shortlists', () => {
        const next = gameReducer(state(), { type: 'MERGE_NPC_RECORDS', payload: { keepId: 'a', dropId: 'b' } });
        expect(next.npcs.map(n => n.id)).toEqual(['a', 't']);
        const saima = next.npcs[0];
        expect(saima).toMatchObject({ name: 'Saima Aallotar', pinned: true, dead: true, lastSeen: 20, lastNotes: 'Invited him up.' });
        expect(saima.aliases).toEqual(['the harbor-chart woman', 'Saima']);
        expect(saima.bondMoments.map(m => m.text).sort()).toEqual(['She invited him up after closing.', 'She shared his mug.']);
        expect(saima.ties).toEqual([{ name: 'Old Tammo', regard: 'trusts him', npcId: 't' }]);
        expect(next.npcs[1].ties).toEqual([{ name: 'Saima Aallotar', regard: 'owes her twine', npcId: 'a' }]);
        expect(next.quests[0]).toMatchObject({ patron: 'Saima Aallotar', patronId: 'a' });
        expect(next.ledger[0].partyId).toBe('a');
        expect(next.session.heldNpcUpdates[0].candidates).toEqual(['a']);
        expect(isRecordedDead(saima)).toBe(true);
    });

    it('a missing id, the same id twice, or a stale campaign merges nothing', () => {
        const before = state();
        expect(gameReducer(before, { type: 'MERGE_NPC_RECORDS', payload: { keepId: 'a', dropId: 'nope' } })).toBe(before);
        expect(gameReducer(before, { type: 'MERGE_NPC_RECORDS', payload: { keepId: 'a', dropId: 'a' } })).toBe(before);
        expect(mergeNpcRecords(before.npcs, '', 'b')).toBe(before.npcs);
        expect(gameReducer(before, { type: 'MERGE_NPC_RECORDS', payload: { keepId: 'a', dropId: 'b' }, meta: { sessionId: 'other', loadNonce: 0 } })).toBe(before);
    });
});

describe('a tie carries the other person\'s id (lane 6C)', () => {
    it('the id is read first, then the exact name or alias; an unknown id with a known name still lands', () => {
        const roster = [person('h', 'Hesper Vane'), person('j', 'Jethro Pike')];
        const self = roster[1];
        expect(mergeNpcTies([], [{ id: 'h', name: 'Hesper', regard: 'distrusts her' }], { npcs: roster, self, messageCount: 3 }))
            .toEqual([{ name: 'Hesper Vane', regard: 'distrusts her', npcId: 'h', atMessage: 3 }]);
        expect(mergeNpcTies([], [{ id: 'nope', name: 'Hesper Vane', regard: 'r' }], { npcs: roster, self, messageCount: 3 })[0].npcId).toBe('h');
        expect(mergeNpcTies([], [{ name: 'Hesper', regard: 'r' }], { npcs: roster, self, messageCount: 3 })).toEqual([]);
        expect(SCRIBE_SYSTEM_PROMPT).toContain('"ties": [{ "id": "that person\'s exact id from KNOWN NPCS');
    });
});

describe('the dead flag (lane 6C): the Scribe\'s died: true writes it, nothing reads notes', () => {
    it('UPDATE_NPC with died: true marks the record dead; false or junk writes nothing; a dead record stays dead', () => {
        const base = { ...initialGameState, npcs: [person('r', 'Rarg', { lastNotes: 'Alive.' })] };
        const dead = gameReducer(base, { type: 'UPDATE_NPC', payload: { id: 'r', name: 'Rarg', died: true, lastNotes: 'Cut down at the ford.' }, meta: { lane: 'scribe' } });
        expect(dead.npcs[0]).toMatchObject({ dead: true, lastNotes: 'Cut down at the ford.' });
        expect('died' in dead.npcs[0]).toBe(false);
        expect(isRecordedDead(dead.npcs[0])).toBe(true);
        const notDead = gameReducer(base, { type: 'UPDATE_NPC', payload: { id: 'r', name: 'Rarg', died: 'maybe', lastNotes: 'Killed two guards and fled.' }, meta: { lane: 'scribe' } });
        expect(isRecordedDead(notDead.npcs[0])).toBe(false);
        const stillDead = gameReducer(dead, { type: 'UPDATE_NPC', payload: { id: 'r', name: 'Rarg', died: false, lastNotes: 'A rumor says he lives.' }, meta: { lane: 'scribe' } });
        expect(stillDead.npcs[0].dead).toBe(true);
        expect(SCRIBE_SYSTEM_PROMPT).toContain('"died": "true ONLY when this exchange establishes');
    });

    it('save version 5 seeds dead once from the frozen notes regex, and only where the record says so', () => {
        const save = {
            ...initialGameState,
            saveVersion: 4,
            npcs: [
                person('d', 'Dorn Ironjaw', { lastNotes: 'Killed by Astra on the pier.' }),
                person('k', 'Rusk Ironjaw', { lastNotes: 'Killed two guards at the gate and fled.' }),
                person('m', 'Mother Sorsa', { lastNotes: 'Mourns her son, who was killed by bandits.' }),
            ],
            messages: [{ id: 'm0', role: 'user', content: 'x', timestamp: 5 }],
        };
        const migrated = migrateLoadedSave(save);
        expect(migrated.saveVersion).toBe(5);
        expect(migrated.npcs.map(n => [n.id, n.dead === true])).toEqual([['d', true], ['k', false], ['m', true]]);
        const again = migrateLoadedSave({ ...migrated, saveVersion: 4 });
        expect(again.npcs.map(n => n.dead === true)).toEqual([true, false, true]);
        // A current save is left alone.
        expect(migrateLoadedSave({ ...save, saveVersion: 5 }).npcs.every(n => !('dead' in n))).toBe(true);
    });
});

describe('the reflection asks about same_person and merges only what it offered', () => {
    it('the anchors know same_person; an unoffered pair never merges', async () => {
        expect(REFLECTION_ANCHORS).toContain('same_person');
        sendMessage.mockReset();
        sendMessage.mockResolvedValue(JSON.stringify({
            npc_updates: [],
            same_person: [['a', 'b'], ['c', 'd'], ['a', 'a'], 'junk'],
            tempo_directive: { front_id: null },
        }));
        const dispatched = [];
        const state = {
            ...initialGameState,
            settings: { ...initialGameState.settings, llmProvider: 'gemini', apiKey: 'k', geminiApiKey: 'k' },
            session: { ...initialGameState.session, id: 's' },
            npcs: [person('a', 'Saima Aallotar', { lastSeen: 10 }), person('b', 'Saima', { lastSeen: 20 }), person('c', 'Maren Tull'), person('d', 'Maren Ashford')],
            fronts: [],
            messages: [],
        };
        await runNpcFrontReflection({ state, dispatch: action => dispatched.push(action), cadence: null });
        const merges = dispatched.filter(a => a.type === 'MERGE_NPC_RECORDS').map(a => a.payload);
        expect(merges).toEqual([{ keepId: 'a', dropId: 'b' }]);
        expect(sendMessage).toHaveBeenCalledTimes(1);
        const call = sendMessage.mock.calls[0][0];
        expect(call.userMessage).toContain('possibleSamePerson');
        expect(call.userMessage).toContain('"ids":["a","b"]');
        expect(call.userMessage).not.toContain('"ids":["c","d"]');
    });
});
