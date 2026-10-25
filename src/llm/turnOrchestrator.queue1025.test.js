/**
 * Pins for the 2026-10-25 chat-orchestration audit queue (Lap 1), the
 * orchestrator half. The turn runner runs against the REAL parser,
 * applyEvents, reducer, roll arbiter (its sync rules) and roll resolver; the
 * adapter calls, the Scribe's network pass, retrieval and the embed queue are
 * scripted.
 *
 * - P1: a block-only reply WITH events commits NO assistant row (the intent
 *   lane's rule, now every lane's); a block-only `{}` is an empty reply; the
 *   cast backstop's narration row is the one the extraction reads.
 * - P2: `sendRollCorrection`'s reply is ROUTED like a first hop, once — a
 *   check is staged with the correction's hidden row as its setup, a fight is
 *   started, a re-rejected check stands revealed and extracted.
 * - P2: the missing-events nudge runs on the pre-commit budget and its
 *   recovery is in `stateAfter`.
 * - P2: the display freeze reads the parser's fence opener.
 * - P2: the DM fact lane embeds the RECORD's rows (the record's `atMessage`,
 *   never a refused restatement).
 * - nits: the detector is gated on the machinery key; a withheld setup's
 *   `location` waits for the outcome and never lands on a set-aside.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    runScribe: vi.fn(async () => {}),
    queueMemory: vi.fn(async () => {}),
    flushMemoryQueue: vi.fn(async () => {}),
    adapterSend: vi.fn(async () => ''),
    detect: vi.fn(async () => null),
}));

vi.mock('./scribe.js', async (importOriginal) => ({
    ...(await importOriginal()),
    runScribe: mocks.runScribe,
}));
vi.mock('../engine/vectorMemory.js', async (importOriginal) => ({
    ...(await importOriginal()),
    queueMemoryItem: mocks.queueMemory,
    flushMemoryQueue: mocks.flushMemoryQueue,
    retrieveRelevant: async () => [],
}));
// The arbiter's and the detector's own adapter call (a machinery-keyed
// harness would otherwise reach the network): '' takes the sync rules.
vi.mock('./adapter.js', async (importOriginal) => ({
    ...(await importOriginal()),
    sendMessage: mocks.adapterSend,
}));
vi.mock('./responseParser.js', async (importOriginal) => ({
    ...(await importOriginal()),
    detectSemanticTextRolls: mocks.detect,
}));

import { gameReducer, initialGameState } from '../state/gameReducer.js';
import { createCharacter } from '../engine/characterUtils.js';
import { createTurnRunner } from './turnOrchestrator.js';
import { buildMessageWindow } from '../components/Chat/turnVisibility.js';
import { routeTurnEvents, TURN_ROUTES } from '../components/Chat/eventRouting.js';
import { PRE_COMMIT_TIMEOUT_MS } from './machinery.js';
import { sanitizePendingRoleplayCheck } from '../engine/roleplayCheck.js';

const ABILITY_SCORES = { strength: 15, dexterity: 13, constitution: 14, intelligence: 10, wisdom: 12, charisma: 8 };

/** Each scripted reply is a string, or an array of chunks fed one by one. */
function scriptedStream(responses) {
    return vi.fn(async ({ onChunk }) => {
        const next = responses.shift();
        if (next instanceof Error) throw next;
        const chunks = Array.isArray(next) ? next : [typeof next === 'string' ? next : ''];
        for (const chunk of chunks) onChunk?.(chunk);
        return chunks.join('');
    });
}

/**
 * `machinery: true` runs a Gemini DM (the main key doubles as the machinery
 * key) so retrieval, the detector gate, the arbiter and the fact embed are
 * live — against the mocks above. The default is an OpenAI DM with NO
 * machinery key: every background helper takes its offline path.
 */
function createHarness({ streamMessage, machinery = false, messages = [], worldFacts = [], currentLocation = 'Brackwater', onStreamChunkText } = {}) {
    let state = {
        ...initialGameState,
        character: createCharacter('Testa', 'human', 'fighter', ABILITY_SCORES, ['athletics']),
        settings: { ...initialGameState.settings, llmProvider: machinery ? 'gemini' : 'openai', apiKey: 'test-key', model: 'test-model' },
        session: { ...initialGameState.session, id: 'session-q1025' },
        currentLocation,
        messages,
        worldFacts,
    };
    const dispatched = [];
    const dispatch = (action) => { dispatched.push(action); state = gameReducer(state, action); };
    const nudgeSend = vi.fn(async () => '{}');
    const runner = createTurnRunner({
        getState: () => state,
        dispatch,
        streamMessage: streamMessage || vi.fn(async () => ''),
        sendMessage: nudgeSend,
        ...(onStreamChunkText && { onStreamChunkText }),
    });
    return { runner, getState: () => state, dispatched, nudgeSend, streamMessage };
}

beforeEach(() => {
    mocks.runScribe.mockClear();
    mocks.queueMemory.mockClear();
    mocks.detect.mockReset();
    mocks.detect.mockResolvedValue(null);
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'info').mockImplementation(() => {});
});

const BLOCK_ONLY_GOLD = '```json\n{"gold_found": 5}\n```';

describe('P1 — a block-only reply with events commits NO assistant row (standard lane)', () => {
    it('pays the gold, commits no row, leaves the turn record null, and the window carries no blank row — a legacy blank row included', async () => {
        const legacyBlank = { id: 'a-blank', role: 'assistant', content: '' };
        const h = createHarness({
            streamMessage: scriptedStream([BLOCK_ONLY_GOLD]),
            messages: [{ id: 'u0', role: 'user', content: 'I look at the chest.' }, legacyBlank, { id: 'u1', role: 'user', content: 'I search the chest.' }],
        });
        const goldBefore = h.getState().character.gold;

        const events = await h.runner.sendToLLM('I search the chest.', 'I search the chest.');

        expect(events.goldFound).toBe(5);
        expect(h.getState().character.gold).toBe(goldBefore + 5);
        // No new assistant row — the legacy blank is the only one, untouched.
        expect(h.getState().messages.filter(m => m.role === 'assistant')).toEqual([legacyBlank]);
        expect(h.runner.getLastCommittedTurn()).toBeNull();
        // The coin receipt is the player's "something" — and it is dmVisible.
        expect(h.getState().messages.some(m => m.role === 'system' && m.dmVisible === true && /\+5/.test(m.content))).toBe(true);
        // The window: no blank row, the receipt rides.
        const window = buildMessageWindow(h.getState().messages, 20);
        expect(window.some(m => !m.content.trim())).toBe(false);
        expect(window.some(m => /\+5/.test(m.content))).toBe(true);
    });

    it('a block-only `{}` that changes nothing is an empty reply: throws, commits nothing, applies nothing', async () => {
        const h = createHarness({ streamMessage: scriptedStream(['```json\n{}\n```']) });
        await expect(h.runner.sendToLLM('I wait.', 'I wait.')).rejects.toThrow(/changed nothing/);
        expect(h.getState().messages.filter(m => m.role === 'assistant')).toHaveLength(0);
        expect(h.dispatched).toHaveLength(0);
    });

    it('a block-only roll request is the CALLER\'s (no throw, no row): the flags name no setup row and the staged proposal carries no setup', async () => {
        const h = createHarness({ streamMessage: scriptedStream(['```json\n{"requested_rolls": [{"type": "skill_check", "skill": "stealth", "dc": 12, "description": "Slip past"}]}\n```']) });
        const events = await h.runner.sendToLLM('I sneak past.', 'I sneak past.');
        expect(events.requestedRolls).toHaveLength(1);
        expect(events.turn.setupMessageId).toBeNull();
        expect(events.turn.setupHidden).toBe(true);
        expect(h.getState().messages.filter(m => m.role === 'assistant')).toHaveLength(0);

        h.runner.stageRoleplayCheck(events.requestedRolls, 'I sneak past.', { events, narrative: '' });
        const staged = h.getState().pendingRoleplayCheck;
        expect(staged.setupMessageId).toBeNull();
        expect(staged.setupNarrative).toBe('');
        // A set-aside has nothing to reveal and says so plainly.
        h.runner.changeRoleplayApproach();
        expect(h.getState().messages.at(-1).content).toMatch(/^The proposed check is set aside\. Describe a different approach/);
    });

    it('the cast backstop\'s narration row is the one the post-turn extraction reads', async () => {
        const h = createHarness({ streamMessage: scriptedStream([BLOCK_ONLY_GOLD, 'Light blooms from your palm.']) });
        await h.runner.sendToLLM('I cast Light.', 'I cast Light.');
        expect(h.runner.getLastCommittedTurn()).toBeNull();
        // With no commit this turn the extraction has nothing — it never runs
        // on the PREVIOUS turn's record.
        expect(h.runner.runPostTurnExtraction('I cast Light.')).toBe(false);

        await h.runner.sendToLLM('[SYSTEM: narrate the cast]', null, { lane: 'narration' });
        expect(h.runner.getLastCommittedTurn()).toMatchObject({ content: 'Light blooms from your palm.', hidden: false });
        expect(h.runner.runPostTurnExtraction('I cast Light.')).toBe(true);
        expect(mocks.runScribe).toHaveBeenCalledTimes(1);
        expect(mocks.runScribe.mock.calls[0][0].dmNarrative).toBe('Light blooms from your palm.');
        expect(h.getState().messages.filter(m => m.role === 'assistant')).toHaveLength(1);
    });
});

// --- P2: the correction's reply is a turn -------------------------------------
const ATTACK = 'I attack the lookout with my longsword.';
const attackAsCheck = (prose) => `${prose}\n\`\`\`json\n{"requested_rolls": [{"type": "skill_check", "skill": "strength", "dc": 12, "description": "Strike the lookout down with your blade"}]}\n\`\`\``;
const APPROACH_PROSE = 'You slip along the wall first, keeping to the shadow of the cart.';
const approachCheck = `${APPROACH_PROSE}\n\`\`\`json\n{"requested_rolls": [{"type": "skill_check", "skill": "stealth", "dc": 12, "description": "Close in unseen"}]}\n\`\`\``;
const FIGHT = 'Steel rings.\n```json\n{"combat_start": {"enemies": [{"name": "Lookout", "hp": 9, "ac": 12}]}, "combat_exchange": {"player_slots": [{"action": "attack", "strikes": [{"target": "lookout-1"}]}]}}\n```';

async function rejectedFirstHop(h) {
    const events = await h.runner.sendToLLM(ATTACK, ATTACK);
    expect(routeTurnEvents(events).route).toBe(TURN_ROUTES.ATTACK_AS_CHECK);
    return events;
}

describe('P2 — sendRollCorrection routes its reply like a first hop, ONCE', () => {
    it('prose + an approach check: a proposal is staged and the correction\'s hidden row is its setup', async () => {
        const h = createHarness({ streamMessage: scriptedStream([attackAsCheck('The lookout turns.'), approachCheck]) });
        await rejectedFirstHop(h);
        expect(h.getState().pendingRoleplayCheck).toBeNull();

        const result = await h.runner.sendRollCorrection({ attackAsCheck: true, playerAction: ATTACK });

        expect(result.route).toBe('staged');
        expect(h.streamMessage).toHaveBeenCalledTimes(2);
        const staged = h.getState().pendingRoleplayCheck;
        expect(staged.rolls[0].skill).toBe('stealth');
        expect(staged.playerAction).toBe(ATTACK);
        expect(staged.setupNarrative).toBe(APPROACH_PROSE);
        const row = h.getState().messages.find(m => m.id === staged.setupMessageId);
        expect(row).toMatchObject({ role: 'assistant', hidden: true, content: APPROACH_PROSE });
        // The correction carried the player's action, so the arbiter judged
        // its check — an approach check passes.
        expect(result.events.turn.attackAsCheckRejected).toBeUndefined();
    });

    it('combat_start + a queued exchange: the fight starts (START_COMBAT with the queued exchange)', async () => {
        const h = createHarness({ streamMessage: scriptedStream([attackAsCheck('The lookout turns.'), FIGHT]) });
        await rejectedFirstHop(h);

        const result = await h.runner.sendRollCorrection({ attackAsCheck: true, playerAction: ATTACK });

        expect(result.route).toBe('combat');
        expect(h.getState().combat.active).toBe(true);
        expect(h.getState().combat.enemies[0].name).toBe('Lookout');
        expect(h.getState().combat.queuedExchange).toBeTruthy();
        expect(h.getState().pendingRoleplayCheck).toBeNull();
    });

    it('the attack staged as a check AGAIN is not corrected twice: one hop, the prose stands revealed and is extracted once', async () => {
        const SECOND = 'He raises his spear — strike, then!';
        const h = createHarness({ streamMessage: scriptedStream([attackAsCheck('The lookout turns.'), attackAsCheck(SECOND)]) });
        await rejectedFirstHop(h);

        const result = await h.runner.sendRollCorrection({ attackAsCheck: true, playerAction: ATTACK });

        expect(result.route).toBe('revealed');
        expect(h.streamMessage).toHaveBeenCalledTimes(2); // no second correction
        expect(h.getState().pendingRoleplayCheck).toBeNull();
        const row = h.getState().messages.findLast(m => m.role === 'assistant');
        expect(row).toMatchObject({ hidden: false, revealedSetup: true, content: SECOND });
        expect(mocks.runScribe).toHaveBeenCalledTimes(1);
        expect(mocks.runScribe.mock.calls[0][0]).toMatchObject({ dmNarrative: SECOND, sourceMessageId: row.id, lootAudit: null });
    });

    it('the accept path: a chained check the arbiter rejects takes the same route, and a correction that stages is a follow-up (no finalize)', async () => {
        // Hop 1 is a legitimate approach check on the declared attack; the
        // outcome chains the attack AS a check (rejected); the correction
        // comes back with another approach check (staged).
        const h = createHarness({ streamMessage: scriptedStream([approachCheck, attackAsCheck('You are close now.'), approachCheck]) });
        const events = await h.runner.sendToLLM(ATTACK, ATTACK);
        expect(routeTurnEvents(events).route).toBe(TURN_ROUTES.ROLL_PROPOSAL);
        h.runner.stageRoleplayCheck(events.requestedRolls, ATTACK, { events, narrative: APPROACH_PROSE });

        await h.runner.acceptRoleplayCheck();

        expect(h.streamMessage).toHaveBeenCalledTimes(3);
        expect(h.getState().rollHistory).toHaveLength(1); // one stealth check landed
        const staged = h.getState().pendingRoleplayCheck;
        expect(staged).not.toBeNull();
        expect(staged.rolls[0].skill).toBe('stealth');
        expect(staged.setupNarrative).toBe(APPROACH_PROSE);
        // A staged follow-up waits for its dice: no post-turn extraction yet.
        expect(mocks.runScribe).not.toHaveBeenCalled();
    });
});

describe('P2 — the missing-events nudge runs on the pre-commit budget and its recovery is in stateAfter', () => {
    it('sendMessage gets timeoutMs 20 s and maxRetries 0, and the recovered quest is in lastCommittedTurn.stateAfter', async () => {
        const h = createHarness({ streamMessage: scriptedStream(['He spits in his palm. "It\'s a deal, then. Bring me the ledger by dusk."']) });
        h.nudgeSend.mockResolvedValue('```json\n{"quest_updates": [{"name": "Fetch the ledger", "status": "new", "description": "Bring Holt his ledger by dusk."}]}\n```');

        await h.runner.sendToLLM('I offer to fetch his ledger.', 'I offer to fetch his ledger.');

        expect(h.nudgeSend).toHaveBeenCalledTimes(1);
        const call = h.nudgeSend.mock.calls[0][0];
        expect(PRE_COMMIT_TIMEOUT_MS).toBe(20_000);
        expect(call.timeoutMs).toBe(PRE_COMMIT_TIMEOUT_MS);
        expect(call.maxRetries).toBe(0);
        expect(h.getState().quests.some(q => q.name === 'Fetch the ledger')).toBe(true);
        const after = h.runner.getLastCommittedTurn().stateAfter;
        expect(after.quests.some(q => q.name === 'Fetch the ledger')).toBe(true);
        // The projection equals the store up to the one documented divergence
        // (a reducer-minted id).
        expect(after.quests.map(q => [q.name, q.status])).toEqual(h.getState().quests.map(q => [q.name, q.status]));
    });
});

describe('P2 — the display freeze reads the parser\'s fence opener', () => {
    it.each([
        ['"``` json"', ['The door opens.\n', '``` js', 'on\n', '{"gold_found": 5}\n', '```']],
        ['a bare fence on an object', ['The door opens.\n', '```', '\n{"gold_found": 5}\n', '```']],
        ['```JSON', ['The door opens.\n```JSON\n', '{"gold_found": 5}\n```']],
    ])('%s: the player never sees a brace, and the last display text is the prose', async (_label, chunks) => {
        const shown = [];
        const h = createHarness({ streamMessage: scriptedStream([chunks]), onStreamChunkText: text => shown.push(text) });
        const goldBefore = h.getState().character.gold;

        await h.runner.sendToLLM('I open the door.', 'I open the door.');

        expect(shown.length).toBeGreaterThan(0);
        expect(shown.every(text => !text.includes('{'))).toBe(true);
        expect(shown.at(-1)).toBe('The door opens.');
        expect(h.getState().character.gold).toBe(goldBefore + 5);
        expect(h.getState().messages.findLast(m => m.role === 'assistant').content).toBe('The door opens.');
    });

    it('a bare fence around prose (a sign) is displayed and committed as the story', async () => {
        const shown = [];
        const text = 'The sign reads:\n```\nKEEP OUT\n```\nYou shrug.';
        const h = createHarness({ streamMessage: scriptedStream([['The sign reads:\n```\nKEEP ', 'OUT\n```\nYou shrug.']]), onStreamChunkText: t => shown.push(t) });

        await h.runner.sendToLLM('I read the sign.', 'I read the sign.');

        expect(shown.at(-1)).toBe(text);
        expect(h.getState().messages.findLast(m => m.role === 'assistant').content).toBe(text);
    });
});

describe('P2 — the DM fact lane embeds the RECORD\'s rows', () => {
    const FACT_REPLY = 'Reeve Holt spits.\n```json\n{"world_facts": [{"fact": "The reeve takes bribes after dark.", "category": "lore"}, {"fact": "The Pike buys captives.", "category": "lore"}]}\n```';

    it('the queued row carries the record\'s own atMessage (not the entry state\'s count) and a refused restatement is never queued', async () => {
        const entryMessages = [
            { id: 'u0', role: 'user', content: 'I walk to the toll gate.' },
            { id: 'a0', role: 'assistant', content: 'Reeve Holt waits there.' },
        ];
        const h = createHarness({
            machinery: true,
            streamMessage: scriptedStream([FACT_REPLY]),
            messages: entryMessages,
            worldFacts: [{ id: 'f1', fact: 'The Pike buys captives.', category: 'lore', timestamp: 1, atMessage: 1 }],
        });

        await h.runner.sendToLLM('I greet Reeve Holt.', 'I greet Reeve Holt.');

        expect(mocks.queueMemory).toHaveBeenCalledTimes(1); // the restatement was refused by the record
        const item = mocks.queueMemory.mock.calls[0][1];
        expect(item.text).toContain('bribes after dark');
        const turn = h.runner.getLastCommittedTurn();
        const record = turn.stateAfter.worldFacts.find(f => /bribes after dark/.test(f.fact));
        expect(record).toBeTruthy();
        expect(record.sourceMessage).toBe(turn.id);
        expect(item.sourceMessage).toBe(turn.id);
        // The record stamps the fact AFTER the assistant row; the entry state
        // had two rows — a plan against it stamped one (two, live) early.
        expect(record.atMessage).toBe(entryMessages.length + 1);
        expect(item.atMessage).toBe(record.atMessage);
        expect(item.atMessage).not.toBe(entryMessages.length);
        // The live store agrees with the projection.
        expect(h.getState().worldFacts.find(f => /bribes/.test(f.fact)).atMessage).toBe(record.atMessage);
    });
});

describe('nits — the detector gate and the withheld setup\'s location', () => {
    // A reply WITH a JSON block (the parser's regex detector runs only on a
    // block-less reply) whose prose asks for a roll — so the semantic
    // detector is the one asked. The semantic-rolls harness's own shape.
    const REQUEST_SHAPED = 'The runes glow. Give me a Perception check to spot the runes.\n```json\n{"items_found": [{"name": "Amulet"}]}\n```';

    it('the semantic detector is gated on the MACHINERY key, not the DM key', async () => {
        const noMachinery = createHarness({ streamMessage: scriptedStream([REQUEST_SHAPED]) });
        await noMachinery.runner.sendToLLM('I study the runes.', 'I study the runes.');
        expect(mocks.detect).not.toHaveBeenCalled();

        const withMachinery = createHarness({ machinery: true, streamMessage: scriptedStream([REQUEST_SHAPED]) });
        await withMachinery.runner.sendToLLM('I study the runes.', 'I study the runes.');
        expect(mocks.detect).toHaveBeenCalledTimes(1);
    });

    const TRAVEL_SETUP = 'You take the north road toward Rimehollow; the fog thickens.\n```json\n{"requested_rolls": [{"type": "skill_check", "skill": "perception", "dc": 12, "description": "Keep the road in the fog"}], "location": "Rimehollow"}\n```';
    const RIDE = 'I ride north to Rimehollow.';

    async function stageTravel(h) {
        const events = await h.runner.sendToLLM(RIDE, RIDE);
        h.runner.stageRoleplayCheck(events.requestedRolls, RIDE, { events, narrative: h.runner.getLastCommittedTurn().content });
        return events;
    }

    it('a withheld setup\'s location does not move the hero: it rides the flags and the proposal', async () => {
        const h = createHarness({ streamMessage: scriptedStream([TRAVEL_SETUP]) });
        const events = await stageTravel(h);
        expect(h.getState().currentLocation).toBe('Brackwater');
        expect(h.dispatched.some(a => a.type === 'SET_LOCATION')).toBe(false);
        expect(events.turn.setupLocation).toBe('Rimehollow');
        expect(h.getState().pendingRoleplayCheck.setupLocation).toBe('Rimehollow');
    });

    it('a set-aside never moves the hero', async () => {
        const h = createHarness({ streamMessage: scriptedStream([TRAVEL_SETUP]) });
        await stageTravel(h);
        h.runner.changeRoleplayApproach();
        expect(h.getState().currentLocation).toBe('Brackwater');
        expect(h.dispatched.some(a => a.type === 'SET_LOCATION')).toBe(false);
        expect(h.getState().pendingRoleplayCheck).toBeNull();
    });

    it('the outcome lands the destination — in the outcome call\'s own record, so the Scribe reads it as the DM\'s location', async () => {
        const h = createHarness({ streamMessage: scriptedStream([TRAVEL_SETUP, 'You ride into Rimehollow at dusk, the fog behind you.']) });
        await stageTravel(h);

        await h.runner.acceptRoleplayCheck();

        expect(h.getState().currentLocation).toBe('Rimehollow');
        const turn = h.runner.getLastCommittedTurn();
        expect(turn.location).toBe('Rimehollow');
        expect(turn.stateAfter.currentLocation).toBe('Rimehollow');
        expect(mocks.runScribe).toHaveBeenCalledTimes(1);
        expect(mocks.runScribe.mock.calls[0][0].dmLocationEvent).toBe('Rimehollow');
        expect(h.getState().locations.some(l => l.name === 'Rimehollow')).toBe(true);
    });

    it('the outcome\'s own location wins when present', async () => {
        const h = createHarness({ streamMessage: scriptedStream([TRAVEL_SETUP, 'The fog lifts on a mill, not a town.\n```json\n{"location": "The Mill"}\n```']) });
        await stageTravel(h);
        await h.runner.acceptRoleplayCheck();
        expect(h.getState().currentLocation).toBe('The Mill');
        expect(h.dispatched.filter(a => a.type === 'SET_LOCATION').map(a => a.payload)).toEqual(['The Mill']);
    });

    it('a chained check carries the destination on to the re-staged proposal; the hero still has not moved', async () => {
        const CHAINED = 'A shape looms in the fog — hooves.\n```json\n{"requested_rolls": [{"type": "skill_check", "skill": "stealth", "dc": 12, "description": "Hide from the rider"}]}\n```';
        const h = createHarness({ streamMessage: scriptedStream([TRAVEL_SETUP, CHAINED]) });
        await stageTravel(h);
        await h.runner.acceptRoleplayCheck();
        expect(h.getState().currentLocation).toBe('Brackwater');
        expect(h.dispatched.some(a => a.type === 'SET_LOCATION')).toBe(false);
        const staged = h.getState().pendingRoleplayCheck;
        expect(staged.rolls[0].skill).toBe('stealth');
        expect(staged.setupLocation).toBe('Rimehollow');
    });

    it('the proposal store types setupLocation string-or-null (the load twin)', () => {
        const rolls = [{ type: 'skill_check', skill: 'stealth', dc: 12, description: 'Slip past' }];
        expect(sanitizePendingRoleplayCheck({ rolls, playerAction: 'x', setupLocation: { junk: true } }).setupLocation).toBeNull();
        expect(sanitizePendingRoleplayCheck({ rolls, playerAction: 'x', setupLocation: '  Rimehollow ' }).setupLocation).toBe('Rimehollow');
        expect(sanitizePendingRoleplayCheck({ rolls, playerAction: 'x' }).setupLocation).toBeNull();
    });
});
