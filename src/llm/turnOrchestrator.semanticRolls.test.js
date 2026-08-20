/**
 * Semantic text-roll merge (turnOrchestrator): when the DM narrates a check in
 * prose instead of JSON, the Scribe-detected rolls must MERGE into any events
 * the response carried — replacing the whole object would silently drop loot,
 * quest, and NPC events (the exact regression the merge comment guards).
 * detectSemanticTextRolls is network-backed machinery, so it is the one
 * partial mock here; parser, applyEvents, and reducer stay real.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { detectMock } = vi.hoisted(() => ({ detectMock: vi.fn(async () => null) }));

vi.mock('./responseParser.js', async (importOriginal) => ({
    ...(await importOriginal()),
    detectSemanticTextRolls: detectMock,
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
        const text = responses.shift() || '';
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
    detectMock.mockReset();
    detectMock.mockResolvedValue(null);
});

describe('turn runner — semantic text-roll merge', () => {
    it('merges detected rolls into existing events without dropping the loot they carried', async () => {
        detectMock.mockResolvedValue([
            { type: 'skill_check', skill: 'perception', dc: 10, description: 'Spot the runes' },
        ]);
        const response = 'You lift the amulet from the altar. Give me a Perception check to spot the runes.\n'
            + '```json\n{"items_found": [{"name": "Amulet"}]}\n```';
        const { runner, getState } = createHarness({ streamMessage: scriptedStream([response]) });

        const events = await runner.sendToLLM('I take the amulet and look around.', 'I take the amulet and look around.');

        expect(events._textRollDetected).toBe(true);
        expect(events.requestedRolls).toHaveLength(1);
        expect(events.requestedRolls[0].skill).toBe('perception');
        // The merge, not a replace: the response's own loot event survived.
        expect(events.itemsFound).toHaveLength(1);
        // A prose-extracted proposal stays visible — the player already read it.
        expect(getState().messages.findLast(m => m.role === 'assistant').hidden).toBe(false);
    });

    it('never runs detection when the response already declared rolls in JSON', async () => {
        const response = 'The sergeant eyes you.\n'
            + '```json\n{"requested_rolls": [{"type": "skill_check", "skill": "stealth", "dc": 12, "description": "Slip past"}]}\n```';
        const { runner } = createHarness({ streamMessage: scriptedStream([response]) });

        await runner.sendToLLM('I sneak past.', 'I sneak past.');

        expect(detectMock).not.toHaveBeenCalled();
    });

    it('never runs detection on a table-talk turn', async () => {
        const { runner } = createHarness({
            streamMessage: scriptedStream(['Recap: you are at the ford. Maybe roll Perception sometime.']),
        });

        await runner.sendToLLM('DM, recap please.', 'DM, recap please.', { tableTalk: true });

        expect(detectMock).not.toHaveBeenCalled();
    });
});
