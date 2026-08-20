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

function createHarness({ streamMessage, sendMessage, isMounted, interceptDispatch, character } = {}) {
    let state = {
        ...initialGameState,
        character: character || createCharacter('Testa', 'human', 'fighter', ABILITY_SCORES, ['athletics']),
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

describe('turn runner — same-response duplicate items_found entries (playtest #8)', () => {
    it('aggregates two identical entries into one grant of quantity 2 instead of eating the second', async () => {
        const response = 'Each guard carried a blade.\n```json\n{"items_found": [{"name": "Dagger"}, {"name": "Dagger"}]}\n```';
        const { runner, getState } = createHarness({
            streamMessage: scriptedStream([response]),
            sendMessage: vi.fn(async () => ''),
        });

        await runner.sendToLLM('I search both guards.', 'I search both guards.');

        const daggers = getState().inventory.filter(i => /dagger/i.test(i.name));
        expect(daggers).toHaveLength(1);
        expect(daggers[0].quantity).toBe(2);
        expect(getState().messages.some(m => m.role === 'system' && /Duplicate item grant ignored/.test(m.content || ''))).toBe(false);
    });
});

describe('turn runner — table-talk world pause (security-shaped: OOC can never mutate state)', () => {
    it('force-nulls events a disobedient DM appends to an OOC answer', async () => {
        const response = 'Sure — quick recap: you are in Weatherby, unhurt.\n'
            + '```json\n{"gold_found": 500,'
            + ' "requested_rolls": [{"type": "skill_check", "skill": "perception", "dc": 10, "description": "Notice the ambush"}],'
            + ' "quest_updates": [{"name": "Smuggled quest", "status": "new", "description": "Should never exist"}],'
            + ' "location": "Somewhere Else"}\n```';
        const sendMessage = vi.fn(async () => '');
        const { runner, getState } = createHarness({ streamMessage: scriptedStream([response]), sendMessage });
        const goldBefore = getState().character.gold;
        const locationBefore = getState().currentLocation;

        const events = await runner.sendToLLM('DM, where are we again?', 'DM, where are we again?', { tableTalk: true });

        expect(events).toBeNull();
        expect(getState().character.gold).toBe(goldBefore);
        expect(getState().quests).toHaveLength(0);
        expect(getState().pendingRoleplayCheck).toBeNull();
        expect(getState().currentLocation).toBe(locationBefore);
        // The OOC answer itself is committed, visible, and event-free.
        const assistant = getState().messages.findLast(m => m.role === 'assistant');
        expect(assistant.hidden).toBe(false);
        expect(assistant.events).toBeNull();
        // No dropped-events notice, no semantic-roll detection turn, no nudge call.
        expect(getState().messages.some(m => m.role === 'system')).toBe(false);
        expect(sendMessage).not.toHaveBeenCalled();
    });

    it('injects the OOC response mode into the system prompt', async () => {
        const streamMessage = vi.fn(async ({ systemPrompt, onChunk }) => {
            expect(systemPrompt).toContain('OUT-OF-CHARACTER TABLE TALK');
            onChunk?.('Recap: you are at the ford.');
            return 'Recap: you are at the ford.';
        });
        const { runner } = createHarness({ streamMessage });
        await runner.sendToLLM('OOC: what happened last session?', 'OOC: what happened last session?', { tableTalk: true });
        expect(streamMessage).toHaveBeenCalledTimes(1);
    });
});

describe('turn runner — suppressHpEvents (batched-round HP already applied)', () => {
    const response = 'The blow lands hard and the goblin reels.\n'
        + '```json\n{"damage_taken": 7, "enemy_updates": [{"id": "goblin-1", "hp": 0}]}\n```';

    it('zeroes damage_taken and enemy_updates BEFORE the events object enters the store', async () => {
        const { runner, getState } = createHarness({ streamMessage: scriptedStream([response]) });
        const hpBefore = getState().character.currentHP;

        const events = await runner.sendToLLM('Continue.', 'Continue.', { suppressHpEvents: true });

        expect(events.damageTaken).toBe(0);
        expect(events.enemyUpdates).toEqual([]);
        expect(getState().character.currentHP).toBe(hpBefore);
        // The stored message carries the SAME finalized object — never mutated post-dispatch.
        expect(getState().messages.findLast(m => m.role === 'assistant').events).toBe(events);
    });

    it('control: the same response without the flag applies the narrated damage', async () => {
        const { runner, getState } = createHarness({ streamMessage: scriptedStream([response]) });
        const hpBefore = getState().character.currentHP;

        const events = await runner.sendToLLM('Continue.', 'Continue.');

        expect(events.damageTaken).toBe(7);
        expect(getState().character.currentHP).toBe(hpBefore - 7);
    });
});

describe('turn runner — challenge ruling (both branches)', () => {
    const proposalRolls = [{
        type: 'skill_check', skill: 'persuasion', dc: 15,
        description: 'Talk the sergeant into opening the gate',
    }];

    it('re-stages an upheld/revised ruling as a final proposal that carries the withheld setup', async () => {
        const revised = '```json\n{"requested_rolls": [{"type": "skill_check", "skill": "persuasion", "dc": 12,'
            + ' "description": "Talk the sergeant into opening the gate", "reason": "The writ is real leverage",'
            + ' "opposition": "Standing orders", "failure_stakes": "He calls the watch"}]}\n```';
        const { runner, getState } = createHarness({
            streamMessage: scriptedStream([revised]),
            sendMessage: vi.fn(async () => ''),
        });
        runner.stageRoleplayCheck(proposalRolls, 'I persuade the sergeant.', {
            setupNarrative: 'The sergeant hesitates at the gate.',
            setupMessageId: 'msg-setup-1',
        });
        expect(getState().pendingRoleplayCheck.challengeUsed).toBe(false);

        await runner.challengeRoleplayCheck('I already showed him the captain\'s writ.');

        const staged = getState().pendingRoleplayCheck;
        expect(staged).toBeTruthy();
        expect(staged.challengeUsed).toBe(true); // the one challenge is spent — this ruling is final
        expect(staged.rolls[0].dc).toBe(12);
        // The original withheld setup still rides the proposal for the post-roll re-weave.
        expect(staged.setupNarrative).toBe('The sergeant hesitates at the gate.');
        expect(staged.setupMessageId).toBe('msg-setup-1');
        // The challenge itself entered the visible transcript.
        expect(getState().messages.some(m => m.role === 'user' && /Roll challenge/.test(m.content || ''))).toBe(true);
    });

    it('records a durable withdrawn ruling when the DM narrates on without dice', async () => {
        const { runner, getState } = createHarness({
            streamMessage: scriptedStream(['He squints at the writ, grunts, and waves you through without ceremony.']),
            sendMessage: vi.fn(async () => ''),
        });
        runner.stageRoleplayCheck(proposalRolls, 'I persuade the sergeant.');

        await runner.challengeRoleplayCheck('I already showed him the writ.');

        expect(getState().pendingRoleplayCheck).toBeNull();
        expect(getState().rollHistory).toHaveLength(0);
        expect(getState().recentRulings).toHaveLength(1);
        expect(getState().recentRulings[0]).toMatchObject({
            outcome: 'withdrawn',
            objective: 'Talk the sergeant into opening the gate',
        });
        // The withdrawal narration is visible and stands as the beat.
        expect(getState().messages.findLast(m => m.role === 'assistant').hidden).toBe(false);
    });

    it('ignores a challenge when the single challenge is already spent', async () => {
        const streamMessage = vi.fn();
        const { runner, getState } = createHarness({ streamMessage });
        runner.stageRoleplayCheck(proposalRolls, 'I persuade the sergeant.', { challengeUsed: true });

        await runner.challengeRoleplayCheck('Try again anyway.');

        expect(streamMessage).not.toHaveBeenCalled();
        expect(getState().pendingRoleplayCheck).toBeTruthy(); // the final proposal still awaits Roll/Change
    });
});

describe('turn runner — change approach (reveal + set-aside ruling)', () => {
    const setupResponse = 'You edge toward the gate as the sergeant turns his back.\n'
        + '```json\n{"requested_rolls": [{"type": "skill_check", "skill": "stealth", "dc": 12, "description": "Slip past the sergeant"}]}\n```';

    it('reveals the withheld setup, records a set-aside ruling, and clears the proposal', async () => {
        const { runner, getState } = createHarness({
            streamMessage: scriptedStream([setupResponse]),
            sendMessage: vi.fn(async () => ''),
        });
        const events = await runner.sendToLLM('I sneak past the sergeant.', 'I sneak past the sergeant.');
        expect(runner.getLastCommittedTurn().hidden).toBe(true);
        runner.stageRoleplayCheck(events.requestedRolls, 'I sneak past the sergeant.', {
            setupNarrative: runner.getLastCommittedTurn().content,
            setupMessageId: events._setupMessageId,
        });

        runner.changeRoleplayApproach();

        const setupMessage = getState().messages.find(m => m.id === events._setupMessageId);
        expect(setupMessage.hidden).toBe(false); // the fiction the player never saw is restored
        expect(setupMessage.revealedSetup).toBe(true);
        expect(getState().pendingRoleplayCheck).toBeNull();
        expect(getState().recentRulings).toHaveLength(1);
        expect(getState().recentRulings[0]).toMatchObject({ outcome: 'set_aside' });
        expect(getState().messages.some(m => m.role === 'system'
            && /the scene above stands/.test(m.content || ''))).toBe(true);
    });

    it('never reveals a setup that pre-narrated an outcome that never happened', async () => {
        const { runner, getState } = createHarness({
            streamMessage: scriptedStream([setupResponse]),
            sendMessage: vi.fn(async () => ''),
        });
        const events = await runner.sendToLLM('I sneak past the sergeant.', 'I sneak past the sergeant.');
        runner.stageRoleplayCheck(events.requestedRolls, 'I sneak past the sergeant.', {
            preNarrated: true,
            setupNarrative: runner.getLastCommittedTurn().content,
            setupMessageId: events._setupMessageId,
        });

        runner.changeRoleplayApproach();

        expect(getState().messages.find(m => m.id === events._setupMessageId).hidden).toBe(true);
        expect(getState().pendingRoleplayCheck).toBeNull();
        expect(getState().recentRulings).toHaveLength(1);
        expect(getState().messages.some(m => m.role === 'system'
            && m.content === 'The proposed check is set aside. Describe a different approach; no dice were rolled.')).toBe(true);
    });
});

describe('turn runner — pre-fight spell_cast alongside combat_start (Codex 2026-08-09)', () => {
    it('applies the cast before initiative so the ward is real when the first blow lands', async () => {
        const wizard = createCharacter('Neris', 'human', 'wizard', {
            strength: 8, dexterity: 12, constitution: 14,
            intelligence: 16, wisdom: 10, charisma: 10,
        }, ['arcana']);
        const response = 'A shimmering ward settles over you as the wisps shriek and dive.\n'
            + '```json\n{"spell_cast": {"spell": "Mage Armor", "target": "self"},'
            + ' "combat_start": {"enemies": [{"id": "wisp-1", "name": "Spark Wisp", "hp": 5, "ac": 12, "attack_bonus": 3, "damage": "1d4"}]}}\n```';
        const { runner, getState } = createHarness({
            streamMessage: scriptedStream([response]),
            sendMessage: vi.fn(async () => ''),
            character: wizard,
        });
        const acBefore = getState().character.armorClass;

        await runner.sendToLLM('I cast Mage Armor and brace as the wisps attack.', 'I cast Mage Armor and brace as the wisps attack.');

        const after = getState();
        expect(after.character.sustainedSpell?.key).toBe('mageArmor');
        expect(after.character.spellSlots['1'].used).toBe(1);
        expect(after.character.armorClass).toBe(acBefore + 3);
        expect(after.combat.active).toBe(true);
        expect(after.combat.enemies).toHaveLength(1);
        expect(after.messages.some(m => m.role === 'system' && /casts Mage Armor/.test(m.content || ''))).toBe(true);
    });
});
