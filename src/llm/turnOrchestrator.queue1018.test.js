/**
 * The 2026-10-18 roll-resolution queue, the orchestrator half: the challenge
 * hop's own withheld row has a home (`rulingMessageId`, its prose appended to
 * the re-woven setup, revealed beside the setup), and a REVEALED setup is
 * extracted — the Scribe and the scene embed read the fiction that just
 * became canon, on both reveal paths (Change approach; a proposal whose every
 * roll resolves to nothing). The turn runner runs against the REAL parser,
 * applyEvents and reducer; only the adapter calls and the Scribe's network
 * pass are scripted.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { gameReducer, initialGameState } from '../state/gameReducer.js';
import { createCharacter } from '../engine/characterUtils.js';
import { createTurnRunner } from './turnOrchestrator.js';

const { runScribe } = vi.hoisted(() => ({ runScribe: vi.fn(async () => undefined) }));
vi.mock('./scribe.js', async (importOriginal) => ({
    ...(await importOriginal()),
    runScribe,
}));

const ABILITY_SCORES = { strength: 15, dexterity: 13, constitution: 14, intelligence: 10, wisdom: 12, charisma: 8 };

function scriptedStream(responses) {
    return vi.fn(async ({ onChunk }) => {
        const next = responses.shift();
        if (next instanceof Error) throw next;
        const text = typeof next === 'string' ? next : '';
        onChunk?.(text);
        return text;
    });
}

function createHarness({ streamMessage, character } = {}) {
    let state = {
        ...initialGameState,
        character: character || createCharacter('Testa', 'human', 'fighter', ABILITY_SCORES, ['athletics']),
        settings: { ...initialGameState.settings, llmProvider: 'openai', apiKey: 'test-key', model: 'test-model' },
        session: { ...initialGameState.session, id: 'session-test' },
    };
    const dispatch = (action) => { state = gameReducer(state, action); };
    const runner = createTurnRunner({
        getState: () => state,
        dispatch,
        streamMessage: streamMessage || vi.fn(async () => ''),
        sendMessage: vi.fn(async () => ''),
    });
    return { runner, getState: () => state };
}

const SETUP_PROSE = 'You edge toward the gate as the sergeant turns his back; a lantern gutters on the wall.';
const setupResponse = `${SETUP_PROSE}\n\`\`\`json\n{"requested_rolls": [{"type": "skill_check", "skill": "stealth", "dc": 12, "description": "Slip past the sergeant"}]}\n\`\`\``;
const RULING_PROSE = 'The sergeant is awake and the lantern is lit — the ruling stands, though the shadow by the cart helps.';
const upheldWithProse = `${RULING_PROSE}\n\`\`\`json\n{"requested_rolls": [{"type": "skill_check", "skill": "stealth", "dc": 10, "description": "Slip past the sergeant", "reason": "He is awake", "opposition": "A lit lantern", "failure_stakes": "He shouts"}]}\n\`\`\``;

beforeEach(() => { runScribe.mockClear(); });

async function stageSetup(runner) {
    const events = await runner.sendToLLM('I sneak past the sergeant.', 'I sneak past the sergeant.');
    runner.stageRoleplayCheck(events.requestedRolls, 'I sneak past the sergeant.', {
        events,
        narrative: runner.getLastCommittedTurn().content,
    });
    return events.turn.setupMessageId;
}

describe('the challenge hop\'s own row has a home (roll-resolution P2, by reading)', () => {
    it('an UPHOLD / REVISE that carried prose: the hop row rides as rulingMessageId and its prose joins the re-woven setup (the store folds whitespace)', async () => {
        const { runner, getState } = createHarness({ streamMessage: scriptedStream([setupResponse, upheldWithProse]) });
        const setupId = await stageSetup(runner);

        await runner.challengeRoleplayCheck('I already waited for him to turn.');

        const staged = getState().pendingRoleplayCheck;
        const hopRow = runner.getLastCommittedTurn();
        expect(hopRow.hidden).toBe(true); // the re-ruling carried rolls, so the policy withheld it
        expect(staged.setupMessageId).toBe(setupId); // the ORIGINAL scene still leads
        expect(staged.rulingMessageId).toBe(hopRow.id); // and the hop's row is named, not lost
        // The proposal store folds whitespace, so the two scenes join on one space.
        expect(staged.setupNarrative).toBe(`${SETUP_PROSE} ${RULING_PROSE}`);
        expect(staged.challengeUsed).toBe(true);
    });

    it('a JSON-only re-ruling (the contract\'s "minimal/no prose") names no ruling row and leaves the setup text alone', async () => {
        const jsonOnly = '```json\n{"requested_rolls": [{"type": "skill_check", "skill": "stealth", "dc": 10, "description": "Slip past the sergeant"}]}\n```';
        const { runner, getState } = createHarness({ streamMessage: scriptedStream([setupResponse, jsonOnly]) });
        await stageSetup(runner);

        await runner.challengeRoleplayCheck('He turned his back.');

        const staged = getState().pendingRoleplayCheck;
        expect(staged.rulingMessageId).toBeNull();
        expect(staged.setupNarrative).toBe(SETUP_PROSE);
    });

    it('Change approach after a prose re-ruling reveals BOTH rows', async () => {
        const { runner, getState } = createHarness({ streamMessage: scriptedStream([setupResponse, upheldWithProse]) });
        const setupId = await stageSetup(runner);
        await runner.challengeRoleplayCheck('I already waited for him to turn.');
        const rulingId = getState().pendingRoleplayCheck.rulingMessageId;

        runner.changeRoleplayApproach();

        const rows = getState().messages;
        expect(rows.find(m => m.id === setupId).hidden).toBe(false);
        expect(rows.find(m => m.id === rulingId).hidden).toBe(false);
        expect(getState().pendingRoleplayCheck).toBeNull();
        expect(getState().recentRulings[0]).toMatchObject({ outcome: 'set_aside' });
    });

    it('a stored proposal types rulingMessageId string-or-null like setupMessageId', async () => {
        const { runner, getState } = createHarness();
        runner.stageRoleplayCheck(
            [{ type: 'skill_check', skill: 'stealth', dc: 12, description: 'Slip past' }],
            'I sneak.',
            { setupFrom: { setupNarrative: 'A scene.', setupMessageId: 'msg-a', rulingMessageId: { junk: true } } },
        );
        expect(getState().pendingRoleplayCheck.rulingMessageId).toBeNull();
        runner.stageRoleplayCheck(
            [{ type: 'skill_check', skill: 'stealth', dc: 12, description: 'Slip past' }],
            'I sneak.',
            { setupFrom: { setupNarrative: 'A scene.', setupMessageId: 'msg-a', rulingMessageId: 'msg-r' } },
        );
        expect(getState().pendingRoleplayCheck.rulingMessageId).toBe('msg-r');
    });
});

describe('a revealed setup is canon and is extracted (roll-resolution P2, by reading)', () => {
    it('Change approach runs the Scribe over the revealed fiction, stamped with the setup row, with NO loot audit', async () => {
        const { runner } = createHarness({ streamMessage: scriptedStream([setupResponse]) });
        const setupId = await stageSetup(runner);
        expect(runScribe).not.toHaveBeenCalled(); // the withheld setup was never extracted

        runner.changeRoleplayApproach();

        expect(runScribe).toHaveBeenCalledTimes(1);
        const call = runScribe.mock.calls[0][0];
        expect(call.dmNarrative).toBe(SETUP_PROSE);
        expect(call.sourceMessageId).toBe(setupId);
        expect(call.playerMessage).toBe('I sneak past the sergeant.');
        expect(call.lootAudit).toBeNull();
    });

    it('after a prose re-ruling the Scribe reads both revealed rows as one text', async () => {
        const { runner } = createHarness({ streamMessage: scriptedStream([setupResponse, upheldWithProse]) });
        const setupId = await stageSetup(runner);
        await runner.challengeRoleplayCheck('I already waited for him to turn.');
        runScribe.mockClear();

        runner.changeRoleplayApproach();

        expect(runScribe).toHaveBeenCalledTimes(1);
        expect(runScribe.mock.calls[0][0].dmNarrative).toBe(`${SETUP_PROSE}\n\n${RULING_PROSE}`);
        expect(runScribe.mock.calls[0][0].sourceMessageId).toBe(setupId);
    });

    it('a pre-narrated setup is neither revealed nor extracted', async () => {
        const { runner, getState } = createHarness({ streamMessage: scriptedStream([setupResponse]) });
        const events = await runner.sendToLLM('I sneak past the sergeant.', 'I sneak past the sergeant.');
        events.turn.preNarratedOutcome = true;
        runner.stageRoleplayCheck(events.requestedRolls, 'I sneak past the sergeant.', { events, narrative: runner.getLastCommittedTurn().content });

        runner.changeRoleplayApproach();

        expect(getState().messages.find(m => m.id === events.turn.setupMessageId).hidden).toBe(true);
        expect(runScribe).not.toHaveBeenCalled();
    });

    it('a proposal whose every roll resolves to nothing (Roll pressed) reveals and extracts on the resolver path too', async () => {
        const initiativeSetup = `${SETUP_PROSE}\n\`\`\`json\n{"requested_rolls": [{"type": "skill_check", "skill": "initiative", "dc": 10, "description": "Roll initiative"}]}\n\`\`\``;
        const { runner, getState } = createHarness({ streamMessage: scriptedStream([initiativeSetup]) });
        const setupId = await stageSetup(runner);

        await runner.acceptRoleplayCheck();

        expect(getState().messages.find(m => m.id === setupId).hidden).toBe(false);
        expect(runScribe).toHaveBeenCalledTimes(1);
        expect(runScribe.mock.calls[0][0]).toMatchObject({ dmNarrative: SETUP_PROSE, sourceMessageId: setupId, lootAudit: null });
        expect(getState().rollHistory).toHaveLength(0);
    });
});
