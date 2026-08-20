/**
 * runPostTurnExtraction — the shared post-turn Scribe/embed/audit pass
 * (2026-08-19 P1: handleSend and finalizeRoleplayTurn maintained near-duplicate
 * blocks by hand and the post-roll copy silently lost the narrated-cast audit,
 * so an eventless cast the DM narrated in a post-roll outcome escaped the
 * 2026-08-09 backstop). One orchestrator-owned helper now serves both paths;
 * these tests pin the auditCasts flag — the post-roll outcome path FIRST,
 * since that is the one that drifted.
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

function scriptedStream(responses) {
    return vi.fn(async ({ onChunk }) => {
        const next = responses.shift();
        if (next instanceof Error) throw next;
        const text = typeof next === 'string' ? next : '';
        onChunk?.(text);
        return text;
    });
}

function createHarness({ streamMessage } = {}) {
    let state = {
        ...initialGameState,
        character: createCharacter('Testa', 'human', 'fighter', ABILITY_SCORES, ['athletics']),
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

beforeEach(() => {
    runScribeMock.mockClear();
});

describe('turn runner — post-roll outcome extraction (2026-08-19 P1)', () => {
    it('the accepted-check outcome runs the Scribe with the narrated-cast audit armed', async () => {
        const { runner, getState } = createHarness({
            streamMessage: scriptedStream([
                'The lock clicks open — you whisper a soft Light cantrip and slip inside the dark archive.',
            ]),
        });
        runner.stageRoleplayCheck(
            [{ type: 'skill_check', skill: 'stealth', dc: 12, description: 'Slip inside unheard' }],
            'I pick the lock and slip inside.'
        );

        await runner.acceptRoleplayCheck();

        expect(getState().rollHistory.length).toBeGreaterThan(0);
        expect(runScribeMock).toHaveBeenCalledTimes(1);
        const args = runScribeMock.mock.calls[0][0];
        expect(args.playerMessage).toBe('I pick the lock and slip inside.');
        expect(args.dmNarrative).toContain('Light cantrip');
        expect(args.lootAudit).toBeTruthy();
        expect(args.lootAudit.auditCasts).toBe(true); // the flag the post-roll path had silently lost
        expect(args.lootAudit.sourceId).toMatch(/:scribe-loot$/);
    });
});

describe('turn runner — runPostTurnExtraction (shared handleSend/post-roll pass)', () => {
    it('extracts from the committed narration with the audit keyed to its message id', async () => {
        const { runner, getState } = createHarness({
            streamMessage: scriptedStream(['You pocket the strange coin.\n```json\n{"gold_found": 3}\n```']),
        });
        await runner.sendToLLM('I take the coin.', 'I take the coin.');

        expect(runner.runPostTurnExtraction('I take the coin.', { auditCasts: true })).toBe(true);

        expect(runScribeMock).toHaveBeenCalledTimes(1);
        const args = runScribeMock.mock.calls[0][0];
        const committed = getState().messages.findLast(m => m.role === 'assistant');
        expect(args.lootAudit.sourceId).toBe(`${committed.id}:scribe-loot`);
        // The applied events ride along so the audit only recovers the shortfall.
        expect(args.lootAudit.appliedEvents).toBe(committed.events);
        expect(args.lootAudit.auditCasts).toBe(true);
    });

    it('extracts nothing when no turn committed', () => {
        const { runner } = createHarness({});
        expect(runner.runPostTurnExtraction('I wait.', { auditCasts: true })).toBe(false);
        expect(runScribeMock).not.toHaveBeenCalled();
    });

    it('extracts nothing from a withheld roll-setup commit (hidden narration)', async () => {
        const { runner } = createHarness({
            streamMessage: scriptedStream([
                'You edge toward the gate as the sergeant turns.\n'
                + '```json\n{"requested_rolls": [{"type": "skill_check", "skill": "stealth", "dc": 12, "description": "Slip past the sergeant"}]}\n```',
            ]),
        });
        await runner.sendToLLM('I sneak past.', 'I sneak past.');
        expect(runner.getLastCommittedTurn().hidden).toBe(true);

        expect(runner.runPostTurnExtraction('I sneak past.', { auditCasts: true })).toBe(false);
        expect(runScribeMock).not.toHaveBeenCalled();
    });
});
