/**
 * AbortError family (2026-08-31 P2 r3): a deliberate Stop is not an error —
 * but it must not destroy table state either. These were the unpinned rules:
 * - accept + Stop AFTER dice landed: the dice are final; the proposal stays
 *   cleared (restoring would reopen reroll bargaining) and NO error line posts.
 * - challenge + Stop (always pre-dice): the proposal returns to the table with
 *   the challenge unspent and its hidden-setup linkage intact, silently.
 * - non-abort failures keep their existing recovery lines.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { runScribeMock } = vi.hoisted(() => ({ runScribeMock: vi.fn(async () => {}) }));

vi.mock('./scribe.js', async (importOriginal) => ({
    ...(await importOriginal()),
    runScribe: runScribeMock,
}));

import { gameReducer, initialGameState } from '../state/gameReducer.js';
import { createCharacter } from '../engine/characterUtils.js';
import { createTurnRunner } from './turnOrchestrator.js';

const ABILITY_SCORES = {
    strength: 15, dexterity: 13, constitution: 14,
    intelligence: 10, wisdom: 12, charisma: 8,
};

const CHECK = [{ type: 'skill_check', skill: 'stealth', dc: 12, description: 'Slip inside unheard' }];

function abortError() {
    return Object.assign(new Error('The user aborted a request.'), { name: 'AbortError' });
}

function createHarness({ streamMessage }) {
    let state = {
        ...initialGameState,
        character: createCharacter('Testa', 'human', 'fighter', ABILITY_SCORES, ['athletics']),
        settings: { ...initialGameState.settings, llmProvider: 'openai', apiKey: 'test-key', model: 'test-model' },
        session: { ...initialGameState.session, id: 'session-abort' },
    };
    const dispatch = (action) => { state = gameReducer(state, action); };
    const runner = createTurnRunner({
        getState: () => state,
        dispatch,
        streamMessage,
        sendMessage: vi.fn(async () => ''),
    });
    return { runner, getState: () => state };
}

beforeEach(() => {
    runScribeMock.mockClear();
});

describe('acceptRoleplayCheck — Stop during the outcome narration (post-dice)', () => {
    it('keeps the dice, keeps the proposal cleared, and posts no error line', async () => {
        const { runner, getState } = createHarness({
            streamMessage: vi.fn(async () => { throw abortError(); }),
        });
        runner.stageRoleplayCheck(CHECK, 'I sneak in.');
        expect(getState().pendingRoleplayCheck).toBeTruthy();
        const messagesBefore = getState().messages.length;

        await runner.acceptRoleplayCheck();

        // Dice landed before the aborted follow-up call — they are final.
        expect(getState().rollHistory.length).toBeGreaterThan(0);
        // The proposal stays cleared: restoring post-dice would reopen the
        // exact reroll-bargaining door the proposal system closes.
        expect(getState().pendingRoleplayCheck).toBeNull();
        // A deliberate Stop is silent — no error/system chatter beyond the
        // engine's own roll-result lines.
        const newMessages = getState().messages.slice(messagesBefore);
        expect(newMessages.some(m => /Error|failed/i.test(m.content || ''))).toBe(false);
    });

    it('a non-abort failure after dice points at the "continue" retry path', async () => {
        const { runner, getState } = createHarness({
            streamMessage: vi.fn(async () => { throw new Error('provider 500'); }),
        });
        runner.stageRoleplayCheck(CHECK, 'I sneak in.');

        await runner.acceptRoleplayCheck();

        expect(getState().pendingRoleplayCheck).toBeNull();
        // rollResolver's own recovery line (the exception never escapes to the
        // orchestrator's catch for follow-up failures).
        expect(getState().messages.at(-1).content).toMatch(/Outcome narration failed.*continue/);
    });
});

describe('challengeRoleplayCheck — Stop mid-reconsideration (always pre-dice)', () => {
    it('restores the proposal with the challenge unspent and its hidden setup intact, silently', async () => {
        const { runner, getState } = createHarness({
            streamMessage: vi.fn(async () => { throw abortError(); }),
        });
        runner.stageRoleplayCheck(CHECK, 'I sneak in.', {
            setupNarrative: 'You edge toward the postern gate…',
            setupMessageId: 'msg-hidden-setup',
        });
        const staged = getState().pendingRoleplayCheck;
        expect(staged).toBeTruthy();

        await runner.challengeRoleplayCheck('Sneaking past a sleeping guard needs no roll.');

        const restored = getState().pendingRoleplayCheck;
        // The staged adjudication is back on the table (the old guard discarded
        // it, stranding the hidden setup with no path to resolution)…
        expect(restored).toBeTruthy();
        expect(restored.setupMessageId).toBe('msg-hidden-setup');
        // …with the one challenge still unspent — nothing was adjudicated.
        expect(restored.challengeUsed).toBeFalsy();
        expect(getState().rollHistory).toHaveLength(0);
        expect(getState().messages.some(m => /Error challenging check/.test(m.content || ''))).toBe(false);
    });

    it('a non-abort failure restores the proposal AND says so', async () => {
        const { runner, getState } = createHarness({
            streamMessage: vi.fn(async () => { throw new Error('provider 500'); }),
        });
        runner.stageRoleplayCheck(CHECK, 'I sneak in.');

        await runner.challengeRoleplayCheck('That should be easier.');

        expect(getState().pendingRoleplayCheck).toBeTruthy();
        expect(getState().messages.at(-1).content).toMatch(/Error challenging check/);
    });
});
