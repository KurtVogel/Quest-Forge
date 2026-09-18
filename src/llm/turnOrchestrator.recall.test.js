/**
 * "Remember when…" — the record lane through the orchestrator (WOW
 * 2026-09-18): a recall question widens retrieval with the asked-about people
 * counted as present, posts a `📜 From the record` receipt, appends
 * `## THE RECORD` to the prompt, strips every mechanical channel from the
 * answer, and hands the Scribe the RECALL TURN rule with the loot audit off.
 * Partial mocks: only the spy targets are replaced.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { retrieveRelevantMock, addMemoryMock, runScribeMock } = vi.hoisted(() => ({
    retrieveRelevantMock: vi.fn(async () => []),
    addMemoryMock: vi.fn(async () => {}),
    runScribeMock: vi.fn(async () => {}),
}));

vi.mock('../engine/vectorMemory.js', async (importOriginal) => ({
    ...(await importOriginal()),
    retrieveRelevant: retrieveRelevantMock,
    addMemory: addMemoryMock,
}));
vi.mock('./scribe.js', async (importOriginal) => ({
    ...(await importOriginal()),
    runScribe: runScribeMock,
}));

import { gameReducer, initialGameState } from '../state/gameReducer.js';
import { createCharacter } from '../engine/characterUtils.js';
import {
    createTurnRunner, findRecallIntent, stripRecallEvents,
    RECALL_RETRIEVAL_MIN_SCORE, RECALL_RETRIEVAL_TOP_N, RECALL_STRIPPED_EVENT_KEYS,
} from './turnOrchestrator.js';

const ABILITY_SCORES = {
    strength: 15, dexterity: 13, constitution: 14,
    intelligence: 10, wisdom: 12, charisma: 8,
};

function makeState(overrides = {}) {
    return {
        ...initialGameState,
        character: createCharacter('Testa', 'human', 'fighter', ABILITY_SCORES, ['athletics']),
        settings: { ...initialGameState.settings, llmProvider: 'gemini', apiKey: 'test-key', model: 'test-model' },
        session: { ...initialGameState.session, id: 'session-test' },
        npcs: [{ id: 'n1', name: 'Saima Aallotar', disposition: 'friendly', lastNotes: 'Keeps the ford tavern.' }],
        journal: [{
            id: 'j1', summary: 'The hero promised Saima Aallotar to deal with the ghouls that took the ferryman.',
            keyDecisions: [], consequences: [], messageRange: [0, 2], location: 'The Broken Ford',
        }],
        messages: [
            { id: 'u1', role: 'user', content: 'I promise Saima I will deal with the ghouls.' },
            { id: 'a1', role: 'assistant', content: 'Saima Aallotar nods. "The ghouls took the ferryman last night."' },
            { id: 'u2', role: 'user', content: 'I head for the crypt.' },
            { id: 'a2', role: 'assistant', content: 'The crypt yawns before you.' },
        ],
        ...overrides,
    };
}

function createHarness(reply, overrides) {
    let state = makeState(overrides);
    const dispatch = (action) => { state = gameReducer(state, action); };
    const streamMessage = vi.fn(async ({ onChunk }) => { onChunk?.(reply); return reply; });
    const statuses = [];
    const runner = createTurnRunner({
        getState: () => state,
        dispatch,
        streamMessage,
        sendMessage: vi.fn(async () => ''),
        onStatus: label => statuses.push(label),
    });
    return { runner, getState: () => state, streamMessage, statuses };
}

beforeEach(() => {
    retrieveRelevantMock.mockClear();
    addMemoryMock.mockClear();
    runScribeMock.mockClear();
});

const QUESTION = 'Saima, do you remember when the ghouls took the ferryman?';

describe('a recall question through sendToLLM', () => {
    it('widens retrieval, counts the asked-about person as present, and appends THE RECORD to the prompt', async () => {
        const { runner, streamMessage, statuses } = createHarness('"I remember," Saima says quietly.');
        await runner.sendToLLM(QUESTION, QUESTION);

        expect(retrieveRelevantMock).toHaveBeenCalledTimes(1);
        const [, query, topN, minScore, options] = retrieveRelevantMock.mock.calls[0];
        expect(query).toMatch(/^About: Saima Aallotar\. /);
        expect(topN).toBe(RECALL_RETRIEVAL_TOP_N);
        expect(minScore).toBe(RECALL_RETRIEVAL_MIN_SCORE);
        expect(options.presenceText).toContain('Saima Aallotar');

        const { systemPrompt } = streamMessage.mock.calls[0][0];
        const recordAt = systemPrompt.indexOf('## THE RECORD — ANSWER FROM THIS, NEVER INVENT');
        expect(recordAt).toBeGreaterThan(-1);
        expect(systemPrompt.indexOf('## FINAL FORMAT REMINDER')).toBeGreaterThan(recordAt);
        expect(systemPrompt).toContain('promised Saima Aallotar to deal with the ghouls');
        expect(systemPrompt).toContain('AS SAID');
        expect(statuses).toContain('Consulting the record');
    });

    it('posts the receipt line as a record-kind system message BEFORE the answer, hidden from the DM window', async () => {
        const { runner, getState } = createHarness('"I remember," Saima says quietly.');
        await runner.sendToLLM(QUESTION, QUESTION);

        const messages = getState().messages;
        const receipt = messages.find(m => m.kind === 'record');
        expect(receipt).toBeDefined();
        expect(receipt.role).toBe('system');
        expect(receipt.content).toMatch(/^📜 From the record for Saima Aallotar: 1 journal entry/);
        expect(receipt.dmVisible).toBeUndefined();
        const answer = messages.findLast(m => m.role === 'assistant');
        expect(messages.indexOf(receipt)).toBeLessThan(messages.indexOf(answer));
        expect(answer.content).toBe('"I remember," Saima says quietly.');
    });

    it('is honest when nothing is on record', async () => {
        const { runner, getState, streamMessage } = createHarness('"Zorbulax? Never heard the name," she says.');
        const question = 'Saima, remember Zorbulax?';
        await runner.sendToLLM(question, question);
        const receipt = getState().messages.find(m => m.kind === 'record');
        // Saima is on record (her journal line), so the dossier is not empty —
        // but a wholly unknown subject alone is.
        expect(receipt.content).toMatch(/^📜 /);
        const { systemPrompt } = streamMessage.mock.calls[0][0];
        expect(systemPrompt).toContain('## THE RECORD');
    });

    it('strips every mechanical channel from the answer — a recounted reward never pays twice', async () => {
        const reply = 'Saima smiles. "You found fifty gold that day."\n```json\n{"gold_found": 50, "items_found": [{"name": "Lantern"}], "exp_awarded": 100, "requested_rolls": [{"type": "skill_check", "skill": "Insight", "dc": 10, "description": "Recall"}], "npc_updates": [{"name": "Saima Aallotar", "bondMoment": "She smiled at the memory."}]}\n```';
        const { runner, getState } = createHarness(reply);
        const goldBefore = getState().character.gold;
        const events = await runner.sendToLLM(QUESTION, QUESTION);

        expect(events.goldFound).toBe(0);
        expect(events.itemsFound).toEqual([]);
        expect(events.expAwarded).toBe(0);
        expect(events.requestedRolls).toEqual([]);
        expect(events.npcUpdates).toHaveLength(1);
        expect(getState().character.gold).toBe(goldBefore);
        expect(getState().inventory.some(i => i.name === 'Lantern')).toBe(false);
        expect(getState().pendingRoleplayCheck).toBeNull();
    });

    it('hands the Scribe the RECALL TURN rule with the loot audit off and skips the narrative embed', async () => {
        const { runner } = createHarness('"I remember," Saima says quietly.');
        await runner.sendToLLM(QUESTION, QUESTION);
        addMemoryMock.mockClear();
        expect(runner.runPostTurnExtraction(QUESTION, { auditCasts: true })).toBe(true);

        expect(runScribeMock).toHaveBeenCalledTimes(1);
        const args = runScribeMock.mock.calls[0][0];
        expect(args.recallTurn).toBe(true);
        expect(args.lootAudit).toBeNull();
        expect(addMemoryMock).not.toHaveBeenCalled();
    });

    it('an ordinary action stays on the ordinary path', async () => {
        const { runner, getState, streamMessage } = createHarness('You step into the crypt.');
        const action = 'I step into the crypt.';
        await runner.sendToLLM(action, action);
        const [, , topN, minScore] = retrieveRelevantMock.mock.calls[0];
        expect(topN).toBe(8);
        expect(minScore).toBe(0.55);
        expect(streamMessage.mock.calls[0][0].systemPrompt).not.toContain('## THE RECORD');
        expect(getState().messages.some(m => m.kind === 'record')).toBe(false);
        runner.runPostTurnExtraction(action, { auditCasts: true });
        expect(runScribeMock.mock.calls[0][0].recallTurn).toBe(false);
        expect(runScribeMock.mock.calls[0][0].lootAudit).not.toBeNull();
    });

    it('never fires inside active combat', () => {
        const state = makeState({ combat: { ...initialGameState.combat, active: true } });
        expect(findRecallIntent(state, QUESTION)).toBeNull();
        expect(findRecallIntent(makeState(), QUESTION)?.subjects).toEqual(['Saima Aallotar']);
    });
});

describe('stripRecallEvents', () => {
    it('zeroes every listed channel by type and leaves the rest', () => {
        const events = { goldFound: 5, itemsFound: [{ name: 'x' }], levelUp: true, restTaken: 'long', location: 'Crypt', npcUpdates: [{ name: 'a' }] };
        const stripped = stripRecallEvents(events);
        expect(stripped).toEqual({ goldFound: 0, itemsFound: [], levelUp: false, restTaken: null, location: 'Crypt', npcUpdates: [{ name: 'a' }] });
        expect(events.goldFound).toBe(5);
        expect(stripRecallEvents(null)).toBeNull();
        expect(RECALL_STRIPPED_EVENT_KEYS).toContain('combatStart');
        expect(RECALL_STRIPPED_EVENT_KEYS).toContain('spellCasts');
    });
});
