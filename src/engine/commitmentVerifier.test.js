/**
 * The post-journal verifier (memory-research M1, 2026-09-30): zero tokens,
 * a snapshot before the cadence and a diff after, one line on a loss.
 */
import { describe, expect, it, vi } from 'vitest';
import { describeCommitmentLosses, diffCommitments, snapshotCommitments, verifyCommitmentsAfterCadence } from './commitmentVerifier.js';
import { gameReducer, initialGameState } from '../state/gameReducer.js';

const state = () => ({
    quests: [
        { id: 'q1', name: 'Find the wardens', status: 'active' },
        { id: 'q2', name: 'Old debt', status: 'completed' },
    ],
    worldFacts: [
        { id: 'f1', fact: 'The Pike buys captives.' },
        { id: 'f2', fact: 'The Toll Pike is broken: its factor Orsa hanged.', pinned: true },
        { id: 'f3', fact: 'Old truth.', pinned: true, supersededBy: 'f4' },
    ],
    npcs: [
        { id: 'n1', name: 'Orsa', openThread: 'The ledger is still owed.' },
        { id: 'n2', name: 'Tammo' },
    ],
    storyMemory: [
        { id: 'c1', type: 'promise', status: 'active', text: 'The hero swore to bring the ledger back before the ice.' },
        { id: 'c2', type: 'promise', status: 'resolved', text: 'Paid.' },
        { id: 'c3', type: 'mystery', status: 'active', text: 'Who lit the lantern.' },
    ],
});

describe('snapshotCommitments / diffCommitments', () => {
    it('snapshots active quests, pinned live facts, open threads, active promise cards', () => {
        const snap = snapshotCommitments(state());
        expect([...snap.quests.keys()]).toEqual(['q1']);
        expect([...snap.facts.keys()]).toEqual(['f2']);
        expect([...snap.threads.keys()]).toEqual(['n1']);
        expect([...snap.promises.keys()]).toEqual(['c1']);
        expect(snapshotCommitments({})).toEqual({ quests: new Map(), facts: new Map(), threads: new Map(), promises: new Map(), promiseTexts: new Map(), carriers: [], resolvedThreads: new Map(), messageCount: 0 });
    });

    it('reports what vanished: a quest gone, a pinned fact superseded, a thread cleared, a promise resolved — a REPLACED thread is not a loss', () => {
        const before = snapshotCommitments(state());
        const after = state();
        after.quests = after.quests.filter(q => q.id !== 'q1');
        after.worldFacts[1] = { ...after.worldFacts[1], supersededBy: 'f9' };
        after.npcs[0] = { ...after.npcs[0], openThread: '' };
        after.storyMemory[0] = { ...after.storyMemory[0], status: 'resolved' };
        const losses = diffCommitments(before, snapshotCommitments(after));
        expect(losses).toEqual([
            { kind: 'quest', label: 'Find the wardens' },
            { kind: 'fact', label: 'The Toll Pike is broken: its factor Orsa hanged.' },
            { kind: 'thread', label: 'Orsa' },
            { kind: 'promise', label: 'The hero swore to bring the ledger back before the ice.' },
        ]);
        const reworded = state();
        reworded.storyMemory[0] = { ...reworded.storyMemory[0], status: 'resolved' };
        reworded.storyMemory.push({ id: 'c9', type: 'promise', status: 'active', text: 'Before the ice comes the hero will bring back the ledger.' });
        expect(diffCommitments(before, snapshotCommitments(reworded))).toEqual([]);
        const asThread = state();
        asThread.storyMemory[0] = { ...asThread.storyMemory[0], status: 'resolved' };
        asThread.npcs[1] = { ...asThread.npcs[1], openThread: 'She swore to bring the ledger back before the ice.' };
        expect(diffCommitments(before, snapshotCommitments(asThread))).toEqual([]);
        const moved = state();
        moved.npcs[0] = { ...moved.npcs[0], openThread: 'Now she wants the keys, not the ledger.' };
        expect(diffCommitments(before, snapshotCommitments(moved))).toEqual([]);
    });

    it('a thread a lane SETTLED at or after the snapshot is not a loss; one settled before it, or cleared without the stamp, is (grand playtest 2026-10-03)', () => {
        const withMessages = { ...state(), messages: new Array(40).fill({ role: 'user', content: 'x' }) };
        const before = snapshotCommitments(withMessages);
        expect(before.messageCount).toBe(40);
        const settled = { ...state(), messages: withMessages.messages };
        settled.npcs[0] = { ...settled.npcs[0], openThread: '', openThreadMessage: null, openThreadResolvedMessage: 41 };
        expect(diffCommitments(before, snapshotCommitments(settled))).toEqual([]);
        const settledAtSnapshot = { ...settled, npcs: [{ ...settled.npcs[0], openThreadResolvedMessage: 40 }, settled.npcs[1]] };
        expect(diffCommitments(before, snapshotCommitments(settledAtSnapshot))).toEqual([]);
        const stale = { ...settled, npcs: [{ ...settled.npcs[0], openThreadResolvedMessage: 12 }, settled.npcs[1]] };
        expect(diffCommitments(before, snapshotCommitments(stale))).toEqual([{ kind: 'thread', label: 'Orsa' }]);
        const unstamped = { ...settled, npcs: [{ ...settled.npcs[0], openThreadResolvedMessage: undefined }, settled.npcs[1]] };
        expect(diffCommitments(before, snapshotCommitments(unstamped))).toEqual([{ kind: 'thread', label: 'Orsa' }]);
    });

    it('UPDATE_NPC with openThreadResolved: true stamps openThreadResolvedMessage from the transcript length (never from the payload)', () => {
        let s = { ...initialGameState, messages: new Array(7).fill({ role: 'user', content: 'x' }), npcs: [{ id: 'n1', name: 'Orsa', openThread: 'The ledger is still owed.', openThreadMessage: 3 }] };
        s = gameReducer(s, { type: 'UPDATE_NPC', payload: { id: 'n1', name: 'Orsa', openThreadResolved: true, openThreadResolvedMessage: 999 } });
        const orsa = s.npcs.find(n => n.id === 'n1');
        expect(orsa.openThread).toBe('');
        expect(orsa.openThreadResolvedMessage).toBe(7);
        const before = snapshotCommitments({ ...s, npcs: [{ id: 'n1', name: 'Orsa', openThread: 'The ledger is still owed.' }] });
        expect(diffCommitments(before, snapshotCommitments(s))).toEqual([]);
    });

    it('describes losses in one line and dispatches exactly one infrastructure line only on a loss', () => {
        expect(describeCommitmentLosses([])).toBe('');
        const line = describeCommitmentLosses([{ kind: 'thread', label: 'Orsa' }, { kind: 'promise', label: 'The ledger vow' }]);
        expect(line).toContain('the open thread with "Orsa"');
        expect(line).toContain('the promise "The ledger vow"');
        const dispatch = vi.fn();
        expect(verifyCommitmentsAfterCadence(snapshotCommitments(state()), state(), dispatch)).toEqual([]);
        expect(dispatch).not.toHaveBeenCalled();
        const after = state();
        after.storyMemory[0] = { ...after.storyMemory[0], status: 'dormant' };
        verifyCommitmentsAfterCadence(snapshotCommitments(state()), after, dispatch);
        expect(dispatch).toHaveBeenCalledTimes(1);
        expect(dispatch.mock.calls[0][0]).toMatchObject({ type: 'ADD_MESSAGE', payload: { role: 'system', kind: 'error' } });
        expect(dispatch.mock.calls[0][0].payload.content).toContain('📓 Journal check');
    });
});

describe('a front resolution mints a PINNED fact the verifier watches', () => {
    it('UPDATE_FRONT resolved → the resolution fact carries pinned: true', () => {
        const front = { id: 'front-1', title: 'The Toll Pike', status: 'active', clock: 3, maxClock: 6, stage: 1, goal: 'squeeze the weirs', faction: { name: 'The Pike' }, grimPortents: [], publicHints: [], theaters: [] };
        const s = gameReducer({ ...initialGameState, fronts: [front], messages: [] }, { type: 'UPDATE_FRONT', payload: { id: 'front-1', status: 'resolved', notes: 'The factor hanged at the weir.' } });
        const resolution = (s.worldFacts || []).find(f => f.pinned === true);
        expect(resolution).toBeTruthy();
        expect(resolution.fact).toContain('Toll Pike');
        expect([...snapshotCommitments(s).facts.values()]).toHaveLength(1);
    });
});
