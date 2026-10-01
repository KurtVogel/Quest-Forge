/**
 * What the DM's call CARRIES, per lane, and how many network calls a turn
 * makes (2026-10-01 chat-orchestration + memory-journal Lap 3 — the two
 * test-depth items: no orchestrator test inspected the `messageHistory`
 * handed to `streamMessage`, and none counted calls per turn).
 *
 * The harness is React-shaped on purpose: `getState` lags `dispatch` by one
 * macrotask (the render flush), and the query embed resolves a macrotask
 * later like a real fetch — so a read BEFORE the turn's one pre-stream await
 * sees the pre-dispatch state and a read AFTER it sees the player's row. A
 * synchronous harness hides that whole class: it is how the player's line
 * reached the provider twice on every ordinary turn (once as the window's
 * last row, once as `userMessage`) with every test green.
 *
 * Real: reducer, parser, applyEvents, buildMessageWindow, the journal
 * cadence, vectorMemory's queue. Mocked: the Gemini embed endpoint and the
 * adapter's non-streaming sendMessage (Scribe / journal / reflection —
 * counted, the journal call answered with a valid summary).
 *
 * The player line's own embed (`addMemory` in ChatPanel.submitPlayerMessage)
 * is the component's, outside the runner: an ordinary turn is the three
 * requests pinned here plus that one.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';

globalThis.IDBKeyRange = IDBKeyRange;

const { embedTextMock, embedTextsMock, sendMessageMock } = vi.hoisted(() => ({
    embedTextMock: vi.fn(),
    embedTextsMock: vi.fn(),
    sendMessageMock: vi.fn(),
}));

vi.mock('./providers/gemini.js', async (importOriginal) => ({
    ...(await importOriginal()),
    embedText: embedTextMock,
    embedTexts: embedTextsMock,
}));
vi.mock('./adapter.js', async (importOriginal) => ({
    ...(await importOriginal()),
    sendMessage: sendMessageMock,
}));

import { gameReducer, initialGameState } from '../state/gameReducer.js';
import { createCharacter } from '../engine/characterUtils.js';
import { addMemory, clearMemories, flushMemoryQueue } from '../engine/vectorMemory.js';
import { KEEP_TAIL, resetSummarizeFailureTracker } from '../engine/worldJournal.js';
import { createTurnRunner, MESSAGE_WINDOW } from './turnOrchestrator.js';

const ABILITY_SCORES = { strength: 15, dexterity: 13, constitution: 14, intelligence: 10, wisdom: 12, charisma: 8 };

const JOURNAL_SUMMARY = 'The hero bargained with Reeve Holt at the toll gate.';
const JOURNAL_REPLY = JSON.stringify({
    summary: JOURNAL_SUMMARY,
    npcs_encountered: [],
    location: 'Toll gate',
    key_decisions: [],
    consequences: [],
    world_facts: [],
});

function unitVector(index) {
    const vector = Array(768).fill(0);
    vector[index] = 1;
    return vector;
}

const macrotask = () => new Promise(resolve => setTimeout(resolve, 0));
const settle = async () => { for (let i = 0; i < 4; i++) await macrotask(); };

function baseState(overrides = {}) {
    return {
        ...initialGameState,
        character: createCharacter('Testa', 'human', 'fighter', ABILITY_SCORES, ['athletics']),
        currentLocation: 'Toll gate',
        // Gemini DM: the main key doubles as the machinery key, so retrieval,
        // the Scribe, and the journal cadence are all live.
        settings: { ...initialGameState.settings, llmProvider: 'gemini', apiKey: 'test-key', model: 'test-model' },
        session: { ...initialGameState.session, id: 'session-window' },
        npcs: [{ name: 'Reeve Holt', disposition: 'wary', lastNotes: 'Keeps the toll gate.' }],
        ...overrides,
    };
}

/**
 * `lagging: true` is the React shape (dispatch visible one macrotask later);
 * `false` is a store whose reads are always current.
 */
function createHarness({ lagging = true, replies = [], state: initial = baseState() } = {}) {
    let state = initial;
    let visible = state;
    const dispatch = (action) => {
        state = gameReducer(state, action);
        if (lagging) setTimeout(() => { visible = state; }, 0);
        else visible = state;
    };
    const calls = [];
    const streamMessage = vi.fn(async ({ messageHistory, userMessage, onChunk }) => {
        // What the ref showed when the window was read: did the player's row
        // already ride the state?
        calls.push({ messageHistory, userMessage, visibleTail: visible.messages.at(-1)?.content ?? null });
        const text = replies.length > 0 ? replies.shift() : `The reeve grunts (${calls.length}).`;
        onChunk?.(text);
        return text;
    });
    const nudgeSend = vi.fn(async () => '{}');
    const runner = createTurnRunner({ getState: () => visible, dispatch, streamMessage, sendMessage: nudgeSend });
    return { runner, dispatch, calls, streamMessage, nudgeSend, getLive: () => state };
}

/** ChatPanel.submitPlayerMessage's ordinary route, in its order. */
async function playTurn(h, line, { tableTalk = false } = {}) {
    h.dispatch({ type: 'ADD_MESSAGE', payload: { role: 'user', content: line } });
    await h.runner.sendToLLM(line, line, { tableTalk });
    if (!tableTalk) h.runner.runPostTurnExtraction(line);
    await h.runner.runAutoSummarize();
    await flushMemoryQueue();
    await settle();
}

const occurrences = (call, text) => [...call.messageHistory.map(m => m.content), call.userMessage]
    .filter(content => content === text).length;

const flashCalls = () => sendMessageMock.mock.calls.map(([args]) => args);
const journalCalls = () => flashCalls().filter(args => /meticulous chronicler/.test(args.systemPrompt || ''));
const queryEmbeds = () => embedTextMock.mock.calls.filter(call => call[2]?.inputType === 'query');
const documentEmbeds = () => embedTextMock.mock.calls.filter(call => call[2]?.inputType !== 'query');

beforeEach(() => {
    clearMemories();
    globalThis.indexedDB = new IDBFactory();
    resetSummarizeFailureTracker();
    embedTextMock.mockReset();
    // A fetch-shaped embed: resolves a macrotask later, so the render flushes
    // under it exactly as it does in the app.
    embedTextMock.mockImplementation(() => new Promise(resolve => setTimeout(() => resolve(unitVector(0)), 0)));
    embedTextsMock.mockReset();
    embedTextsMock.mockImplementation(async (apiKey, texts) => (texts || []).map(() => unitVector(1)));
    sendMessageMock.mockReset();
    sendMessageMock.mockImplementation(async ({ systemPrompt }) => (/meticulous chronicler/.test(systemPrompt || '') ? JOURNAL_REPLY : ''));
});

afterEach(async () => {
    await flushMemoryQueue();
});

describe('the player\'s line reaches the provider ONCE (2026-10-01 chat-orchestration P1)', () => {
    it('ordinary turn: the row is already in the state when the window is read — and is not in the window', async () => {
        const h = createHarness();
        await playTurn(h, 'I greet the reeve.');
        await playTurn(h, 'I ask what the toll is.');

        const call = h.calls[1];
        // The harness exercised the trap: the ref carried the player's row.
        expect(call.visibleTail).toBe('I ask what the toll is.');
        expect(call.userMessage).toBe('I ask what the toll is.');
        expect(call.messageHistory.at(-1)).toEqual({ role: 'assistant', content: 'The reeve grunts (1).' });
        expect(occurrences(call, 'I ask what the toll is.')).toBe(1);
        // The earlier exchange is still there, once.
        expect(call.messageHistory.map(m => m.content)).toEqual(['I greet the reeve.', 'The reeve grunts (1).']);
    });

    it('table talk: the OOC line is sent once too', async () => {
        const h = createHarness();
        await playTurn(h, 'I greet the reeve.');
        await playTurn(h, 'OOC: what did he say his name was?', { tableTalk: true });

        const call = h.calls[1];
        expect(call.visibleTail).toBe('OOC: what did he say his name was?');
        expect(occurrences(call, 'OOC: what did he say his name was?')).toBe(1);
        expect(call.messageHistory.at(-1).role).toBe('assistant');
    });

    it('the window is the same whether or not the ref has flushed', async () => {
        const lagging = createHarness({ lagging: true });
        const current = createHarness({ lagging: false });
        for (const h of [lagging, current]) {
            await playTurn(h, 'I greet the reeve.');
            await playTurn(h, 'I ask what the toll is.');
            await playTurn(h, 'I pay it.');
        }
        expect(lagging.calls.map(c => c.messageHistory)).toEqual(current.calls.map(c => c.messageHistory));
        expect(lagging.calls.map(c => c.userMessage)).toEqual(current.calls.map(c => c.userMessage));
    });

    it('a roll challenge: the visible challenge row never rides beside the prompt that restates it', async () => {
        const roll = '{"requested_rolls": [{"type": "skill_check", "skill": "stealth", "dc": 12, "description": "Slip past the reeve"}]}';
        const h = createHarness({ replies: [
            `The reeve dozes at his post.\n\`\`\`json\n${roll}\n\`\`\``,
            'Fair enough — he is asleep. You walk past.',
        ] });
        const action = 'I sneak past the reeve.';
        h.dispatch({ type: 'ADD_MESSAGE', payload: { role: 'user', content: action } });
        const events = await h.runner.sendToLLM(action, action);
        h.runner.stageRoleplayCheck(events.requestedRolls, action, {
            setupNarrative: h.runner.getLastCommittedTurn().content,
            setupMessageId: events._setupMessageId,
        });
        await settle();

        await h.runner.challengeRoleplayCheck('He is asleep; no check is needed.');
        await settle();

        const call = h.calls[1];
        expect(call.userMessage).toContain('He is asleep; no check is needed.');
        expect(call.messageHistory.some(m => /Roll challenge/.test(m.content))).toBe(false);
        // The player still SEES their challenge in the chat.
        expect(h.getLive().messages.some(m => m.content === '**Roll challenge:** He is asleep; no check is needed.')).toBe(true);
        // The action it concerns stays in the window (the withheld setup does not).
        expect(call.messageHistory.at(-1)).toEqual({ role: 'user', content: action });
    });
});

describe('the engine-prompt lanes keep the whole transcript', () => {
    function fightHarness(replies) {
        const started = gameReducer(baseState({
            messages: [
                { id: 'u0', role: 'user', content: 'I step onto the marsh road.' },
                { id: 'a0', role: 'assistant', content: 'Two bandits rise from the reeds.' },
            ],
        }), {
            type: 'START_COMBAT',
            payload: { enemies: [{ name: 'Marsh bandit', hp: 20, ac: 12, attackBonus: 2, damage: '1d6' }] },
        });
        return createHarness({ replies, state: started });
    }

    it('combat intent: nothing is awaited before the read — the line is the userMessage alone', async () => {
        const h = fightHarness(['```json\n{"combat_exchange": {"player_slots": [{"action": "attack", "strikes": [{"target": "Marsh bandit"}]}], "enemy_intents": []}}\n```']);
        const line = 'I cut at the nearest bandit.';
        h.dispatch({ type: 'ADD_MESSAGE', payload: { role: 'user', content: line } });
        await h.runner.sendToLLM(line, line, { combatIntentOnly: true });

        const call = h.calls[0];
        expect(call.userMessage).toBe(line);
        expect(occurrences(call, line)).toBe(1);
        expect(call.messageHistory.at(-1).content).not.toBe(line);
        expect(queryEmbeds()).toHaveLength(0); // the intent call never retrieves
    });

    it('combat narration: the player\'s action row rides the window once, the engine prompt is the userMessage', async () => {
        const h = fightHarness(['Steel rings; the bandit staggers back into the reeds.']);
        const line = 'I cut at the nearest bandit.';
        h.dispatch({ type: 'ADD_MESSAGE', payload: { role: 'user', content: line } });
        await settle();
        const prompt = '[SYSTEM: narrate the resolved exchange.]';
        await h.runner.sendToLLM(prompt, null, { narrationOnly: true, combatNarration: true });

        const call = h.calls[0];
        expect(call.userMessage).toBe(prompt);
        expect(call.messageHistory.at(-1)).toEqual({ role: 'user', content: line });
        expect(occurrences(call, line)).toBe(1);
        expect(call.messageHistory.at(-1).content).not.toBe(call.userMessage);
    });
});

describe('the missing-events nudge carries the narration ONCE (2026-10-01 chat-orchestration P2)', () => {
    const NARRATION = 'He spits in his palm. "It\'s a deal, then. Bring me the ledger by dusk."';

    async function nudgeArgs(lagging) {
        const h = createHarness({ lagging, replies: ['The reeve grunts.', NARRATION] });
        await playTurn(h, 'I greet the reeve.');
        await playTurn(h, 'I offer to fetch his ledger for the toll.');
        expect(h.nudgeSend).toHaveBeenCalledTimes(1);
        return h.nudgeSend.mock.calls[0][0];
    }

    it('as the history\'s last assistant row — never quoted in the prompt as well', async () => {
        const args = await nudgeArgs(true);
        expect(args.messageHistory.at(-1)).toEqual({ role: 'assistant', content: NARRATION });
        expect(args.messageHistory.filter(m => m.content === NARRATION)).toHaveLength(1);
        expect(args.userMessage).not.toContain('Bring me the ledger');
        // The player's line precedes it, once.
        expect(args.messageHistory.at(-2)).toEqual({ role: 'user', content: 'I offer to fetch his ledger for the toll.' });
    });

    it('whether or not the committed row has reached the ref', async () => {
        const lagging = await nudgeArgs(true);
        const current = await nudgeArgs(false);
        expect(lagging.messageHistory).toEqual(current.messageHistory);
        expect(lagging.userMessage).toBe(current.userMessage);
    });
});

describe('after a journal cadence the window still carries the tail (2026-10-01 memory-journal P1)', () => {
    async function playUntilCadence(h) {
        let turn = 0;
        while (journalCalls().length === 0 && turn < 14) {
            turn += 1;
            await playTurn(h, `Player line ${turn}.`);
        }
        return turn;
    }

    it('the call after a cadence carries the last exchanges verbatim — not the player\'s line alone', async () => {
        const h = createHarness();
        const cadenceTurn = await playUntilCadence(h);
        expect(journalCalls()).toHaveLength(1);
        expect(h.getLive().journal).toHaveLength(1);

        // The window fills toward its ceiling before the cadence...
        expect(h.calls[cadenceTurn - 1].messageHistory.length).toBeGreaterThanOrEqual(KEEP_TAIL + 8);

        await playTurn(h, 'The line after the cadence.');
        const after = h.calls.at(-1);
        // ...and never falls under the tail after it (it used to be 0–1 rows).
        expect(after.messageHistory.length).toBeGreaterThanOrEqual(KEEP_TAIL);
        expect(after.messageHistory.length).toBeLessThanOrEqual(MESSAGE_WINDOW);
        // Verbatim, in order, whole exchanges: it opens on a player line and
        // ends on the DM's last reply.
        expect(after.messageHistory[0].role).toBe('user');
        expect(after.messageHistory.at(-1)).toEqual({ role: 'assistant', content: `The reeve grunts (${cadenceTurn}).` });
        expect(after.messageHistory.at(-2)).toEqual({ role: 'user', content: `Player line ${cadenceTurn}.` });
        const unsummarized = h.getLive().messages
            .filter(m => !m.summarized && (m.role === 'user' || m.role === 'assistant'))
            .map(m => m.content);
        expect([...after.messageHistory.map(m => m.content), after.userMessage, `The reeve grunts (${cadenceTurn + 1}).`])
            .toEqual(unsummarized);
        // What was summarized is exactly what left the window.
        const summarized = h.getLive().messages.filter(m => m.summarized);
        expect(summarized.length).toBeGreaterThanOrEqual(10);
        expect(after.messageHistory.some(m => summarized.some(row => row.content === m.content))).toBe(false);
    });

    it('a store that is always current keeps exactly KEEP_TAIL rows — the lag only ever keeps more', async () => {
        const h = createHarness({ lagging: false });
        const cadenceTurn = await playUntilCadence(h);
        // 10 rows before a 6-row tail = 16 rows = the eighth exchange.
        expect(cadenceTurn).toBe(8);

        await playTurn(h, 'The line after the cadence.');
        const after = h.calls.at(-1);
        expect(after.messageHistory.map(m => m.content)).toEqual([
            'Player line 6.', 'The reeve grunts (6).',
            'Player line 7.', 'The reeve grunts (7).',
            'Player line 8.', 'The reeve grunts (8).',
        ]);
    });
});

describe('network calls per turn (2026-10-01 test depth)', () => {
    it('an ordinary turn: one stream, one query embed, one document batch, one Scribe call', async () => {
        // A campaign with memory: an EMPTY store skips the query embed altogether.
        await addMemory('test-key', 'The reeve takes bribes after dark.', 'world_fact');
        embedTextMock.mockClear();
        const h = createHarness();
        // A line no other test sends: the query-vector memo would skip the embed.
        await playTurn(h, 'I count the coins in my purse.');

        expect(h.streamMessage).toHaveBeenCalledTimes(1);
        expect(queryEmbeds()).toHaveLength(1);
        expect(documentEmbeds()).toHaveLength(0);
        expect(embedTextsMock).toHaveBeenCalledTimes(1);
        expect(embedTextsMock.mock.calls[0][1]).toHaveLength(1); // the narrative
        expect(flashCalls()).toHaveLength(1); // the Scribe
        expect(journalCalls()).toHaveLength(0);
        expect(h.nudgeSend).not.toHaveBeenCalled();
    });

    it('a cadence turn adds two Flash calls and NO embed; the entry rides the next turn\'s batch', async () => {
        const h = createHarness({ lagging: false });
        for (let turn = 1; turn <= 7; turn++) await playTurn(h, `Player line ${turn}.`);
        expect(journalCalls()).toHaveLength(0);
        sendMessageMock.mockClear();
        embedTextMock.mockClear();
        embedTextsMock.mockClear();
        h.streamMessage.mockClear();

        await playTurn(h, 'Player line 8.');

        expect(h.streamMessage).toHaveBeenCalledTimes(1);
        expect(queryEmbeds()).toHaveLength(1);
        // Scribe + journal summary + cadence reflection.
        expect(flashCalls()).toHaveLength(3);
        expect(journalCalls()).toHaveLength(1);
        // The turn's one batch — and the new entry is NOT a request of its own.
        expect(documentEmbeds()).toHaveLength(0);
        expect(embedTextsMock).toHaveBeenCalledTimes(1);
        expect(embedTextsMock.mock.calls[0][1].some(text => text === JOURNAL_SUMMARY)).toBe(false);

        sendMessageMock.mockClear();
        embedTextMock.mockClear();
        embedTextsMock.mockClear();
        await playTurn(h, 'Player line 9.');

        // One batch again, now carrying the narrative AND the journal row.
        expect(embedTextsMock).toHaveBeenCalledTimes(1);
        expect(embedTextsMock.mock.calls[0][1]).toHaveLength(2);
        expect(embedTextsMock.mock.calls[0][1]).toContain(JOURNAL_SUMMARY);
        expect(documentEmbeds()).toHaveLength(0);
        expect(flashCalls()).toHaveLength(1);
    });
});
