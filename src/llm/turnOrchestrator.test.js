import { describe, expect, it, vi } from 'vitest';
import { gameReducer, initialGameState } from '../state/gameReducer.js';
import { createCharacter } from '../engine/characterUtils.js';
import { createTurnRunner } from './turnOrchestrator.js';

/**
 * The turn runner against the REAL parser, applyEvents, and reducer — only the
 * LLM adapter calls are scripted. The harness uses an OpenAI DM with NO Gemini
 * machinery key, so every background helper (RAG retrieval/embedding, semantic
 * roll detection, the Scribe, roll-policy review, auto-summarize) takes its
 * deterministic offline path and no test ever touches a network or IndexedDB.
 */

const ABILITY_SCORES = {
    strength: 15, dexterity: 13, constitution: 14,
    intelligence: 10, wisdom: 12, charisma: 8,
};

function scriptedStream(responses) {
    return vi.fn(async ({ onChunk }) => {
        const next = responses.shift();
        if (next instanceof Error) throw next;
        const text = typeof next === 'string' ? next : '';
        onChunk?.(text);
        return text;
    });
}

function createHarness({ streamMessage, sendMessage, isMounted, interceptDispatch } = {}) {
    let state = {
        ...initialGameState,
        character: createCharacter('Testa', 'human', 'fighter', ABILITY_SCORES, ['athletics']),
        settings: { ...initialGameState.settings, llmProvider: 'openai', apiKey: 'test-key', model: 'test-model' },
        session: { ...initialGameState.session, id: 'session-test' },
    };
    const dispatched = [];
    const dispatch = (action) => {
        if (interceptDispatch) interceptDispatch(action);
        dispatched.push(action);
        state = gameReducer(state, action);
    };
    const runner = createTurnRunner({
        getState: () => state,
        dispatch,
        streamMessage: streamMessage || vi.fn(async () => ''),
        sendMessage: sendMessage || vi.fn(async () => ''),
        ...(isMounted && { isMounted }),
    });
    return { runner, getState: () => state, dispatched };
}

describe('turn runner — plain narrative turn', () => {
    it('dispatches one assistant message and applies simple events exactly once', async () => {
        const response = 'You enter the tavern. The barkeep nods.\n```json\n{"gold_found": 5}\n```';
        const sendMessage = vi.fn(async () => '');
        const { runner, getState, dispatched } = createHarness({
            streamMessage: scriptedStream([response]),
            sendMessage,
        });
        const goldBefore = getState().character.gold;

        const events = await runner.sendToLLM('I enter the tavern.', 'I enter the tavern.');

        expect(events.goldFound).toBe(5);
        const assistants = getState().messages.filter(m => m.role === 'assistant');
        expect(assistants).toHaveLength(1);
        expect(assistants[0].content).toBe('You enter the tavern. The barkeep nods.');
        expect(assistants[0].hidden).toBe(false);
        // The stored-events object identity flows from ADD_MESSAGE into applyEvents.
        expect(assistants[0].events).toBe(events);
        expect(getState().character.gold).toBe(goldBefore + 5);
        expect(dispatched.filter(a => a.type === 'ADD_COIN_GRANT')).toHaveLength(1);
        // An event-carrying turn never fires the missing-events nudge.
        expect(sendMessage).not.toHaveBeenCalled();
    });
});

describe('turn runner — unrepairable event JSON', () => {
    it('posts the visible events-dropped system line and changes no state', async () => {
        // "five" is unquoted — JSON.parse fails and repairJson cannot fix it.
        const response = 'The vault door groans open.\n```json\n{"gold_found": five}\n```';
        const { runner, getState } = createHarness({ streamMessage: scriptedStream([response]) });
        const goldBefore = getState().character.gold;

        const events = await runner.sendToLLM('I open the vault.', 'I open the vault.');

        expect(events).toBeNull();
        const notice = getState().messages.find(m => m.role === 'system');
        expect(notice).toBeTruthy();
        expect(notice.content).toContain('The DM\'s mechanical events could not be read this turn');
        expect(getState().character.gold).toBe(goldBefore);
        expect(getState().messages.filter(m => m.role === 'assistant')).toHaveLength(1);
    });
});

describe('turn runner — unmount safety', () => {
    it('dispatches nothing when the turn resolves after isMounted() flips false', async () => {
        const response = 'You find a chest of riches.\n```json\n{"gold_found": 50}\n```';
        const { runner, getState, dispatched } = createHarness({
            streamMessage: scriptedStream([response]),
            isMounted: () => false,
        });

        const events = await runner.sendToLLM('I search the room.', 'I search the room.');

        expect(events).toBeNull();
        // NOTHING reaches the store — no message, no loot, no claim.
        expect(dispatched).toHaveLength(0);
        expect(getState().messages).toHaveLength(0);
    });
});

describe('turn runner — committed-turn record (live playtest #6 stale-Scribe root cause)', () => {
    it('records the committed assistant message so consumers never re-read React state', async () => {
        const response = 'You cross the bridge into Weatherby.\n```json\n{"location": "Weatherby"}\n```';
        const { runner, getState } = createHarness({ streamMessage: scriptedStream([response]) });

        const events = await runner.sendToLLM('I walk to Weatherby.', 'I walk to Weatherby.');

        const committed = runner.getLastCommittedTurn();
        expect(committed).toBeTruthy();
        expect(committed.content).toBe('You cross the bridge into Weatherby.');
        expect(committed.hidden).toBe(false);
        // Identity: the SAME events object the store carries — the Scribe's
        // dmLocationEvent and loot appliedEvents come from this turn, not the last.
        expect(committed.events).toBe(events);
        expect(committed.events.location).toBe('Weatherby');
        const stored = getState().messages.findLast(m => m.role === 'assistant');
        expect(stored.id).toBe(committed.id);
    });

    it('still records a no-events narration (Scribe loot audit needs the id)', async () => {
        const { runner } = createHarness({
            streamMessage: scriptedStream(['You pocket the strange coin without a word.']),
        });
        await runner.sendToLLM('I take the coin.', 'I take the coin.');
        const committed = runner.getLastCommittedTurn();
        expect(committed).toBeTruthy();
        expect(committed.events).toBeNull();
        expect(committed.id).toMatch(/^msg-/);
    });

    it('resets per call: a turn that commits nothing exposes no earlier message', async () => {
        let mounted = true;
        const { runner } = createHarness({
            streamMessage: scriptedStream([
                'First narration.\n```json\n{"gold_found": 2}\n```',
                'Second narration that must never commit.',
            ]),
            isMounted: () => mounted,
        });
        await runner.sendToLLM('First.', 'First.');
        expect(runner.getLastCommittedTurn()).toBeTruthy();
        mounted = false;
        await runner.sendToLLM('Second.', 'Second.');
        expect(runner.getLastCommittedTurn()).toBeNull();
    });
});

describe('turn runner — missing-events nudge', () => {
    it('fires the JSON-only follow-up at a contract moment and holds the whitelist', async () => {
        const opening = 'Dawn breaks over the caravan camp as Marla hands you your father\'s hunting knife.';
        const nudgeReply = '```json\n' + JSON.stringify({
            quest_updates: [{ id: 'q-caravan', name: 'Guard the caravan', status: 'new', description: 'See the caravan safely to Highmoor.' }],
            starting_items: [{ name: 'Hunting Knife' }],
            // Smuggled channels the whitelist must drop:
            gold_found: 500,
            requested_rolls: [{ type: 'skill_check', skill: 'perception', dc: 10 }],
        }) + '\n```';
        const sendMessage = vi.fn(async () => nudgeReply);
        const { runner, getState, dispatched } = createHarness({
            streamMessage: scriptedStream([opening]),
            sendMessage,
        });
        const goldBefore = getState().character.gold;

        await runner.sendToLLM('Begin the adventure.', null, { openingScene: true });

        expect(sendMessage).toHaveBeenCalledTimes(1);
        expect(sendMessage.mock.calls[0][0].userMessage).toContain('emitted NO JSON event block');
        expect(getState().quests.some(q => q.name === 'Guard the caravan' && q.status === 'active')).toBe(true);
        expect(getState().inventory.some(i => /hunting knife/i.test(i.name || ''))).toBe(true);
        // Whitelist held: no coin, no staged roll proposal from the follow-up.
        expect(getState().character.gold).toBe(goldBefore);
        expect(dispatched.filter(a => a.type === 'ADD_COIN_GRANT')).toHaveLength(0);
        expect(getState().pendingRoleplayCheck).toBeNull();
    });
});

describe('turn runner — roleplay-check accept path failures', () => {
    const stageProposal = (runner) => runner.stageRoleplayCheck(
        [{ type: 'skill_check', skill: 'stealth', dc: 12, description: 'Slip past the guard' }],
        'I sneak past the guard.'
    );

    it('restores the proposal intact when the failure lands BEFORE any dice', async () => {
        const streamMessage = vi.fn(async () => '');
        const { runner, getState } = createHarness({
            streamMessage,
            interceptDispatch: (action) => {
                if (action.type === 'ADD_ROLL') throw new Error('roll store unavailable');
            },
        });
        expect(stageProposal(runner)).toBe(true);
        expect(getState().pendingRoleplayCheck).toBeTruthy();

        await runner.acceptRoleplayCheck();

        expect(getState().rollHistory).toHaveLength(0);
        expect(getState().pendingRoleplayCheck).toMatchObject({ playerAction: 'I sneak past the guard.' });
        expect(getState().messages.some(m => m.role === 'system'
            && m.content === 'Error resolving check: roll store unavailable')).toBe(true);
        // No dice means no outcome follow-up call either.
        expect(streamMessage).not.toHaveBeenCalled();
    });

    it('posts the continue guidance (never a restored proposal) when the outcome call fails AFTER dice', async () => {
        const streamMessage = vi.fn(async () => { throw new Error('provider exploded'); });
        const { runner, getState } = createHarness({ streamMessage });
        expect(stageProposal(runner)).toBe(true);

        await runner.acceptRoleplayCheck();

        expect(getState().rollHistory.length).toBeGreaterThan(0);
        expect(getState().pendingRoleplayCheck).toBeNull();
        const guidance = getState().messages.find(m => m.role === 'system'
            && /Outcome narration failed/.test(m.content || ''));
        expect(guidance).toBeTruthy();
        expect(guidance.content).toContain('"continue"');
        // The reroll-bargaining door stays closed: no ChatPanel-side restore path fired.
        expect(getState().messages.some(m => /The dice landed/.test(m.content || ''))).toBe(false);
    });
});
