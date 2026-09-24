import { describe, expect, it, vi } from 'vitest';
import { gameReducer, initialGameState } from '../state/gameReducer.js';
import { createCharacter } from '../engine/characterUtils.js';
import { createTurnRunner } from './turnOrchestrator.js';

/**
 * The two DM calls a combat round makes (2026-09-23 combat-exchange P2 + test
 * depth): the intent translation and the narration. Same harness contract as
 * turnOrchestrator.test.js — OpenAI DM, no machinery key, so no background
 * helper reaches a network. Pins the call count per round, that the narration
 * call's system prompt keeps the cached static prefix byte-identical while
 * dropping the quest / facts / history / inventory blocks the narration
 * cannot use, and that the orchestrator makes no Flash call on either lane.
 */

const ABILITY_SCORES = {
    strength: 15, dexterity: 13, constitution: 14,
    intelligence: 10, wisdom: 12, charisma: 8,
};

const PREMISE = 'The barony of Kolkanmaa is starving and the toll-weirs keep failing.';

function createHarness({ streamMessage, sendMessage } = {}) {
    let state = {
        ...initialGameState,
        character: createCharacter('Testa', 'human', 'fighter', ABILITY_SCORES, ['athletics']),
        settings: { ...initialGameState.settings, llmProvider: 'openai', apiKey: 'test-key', model: 'test-model' },
        session: { ...initialGameState.session, id: 'session-test', premise: PREMISE },
        inventory: [{ id: 'sword', name: 'Longsword', type: 'weapon', category: 'martialMelee', damage: '1d8', equipped: true }],
        quests: [{ id: 'q1', name: 'Find the wardens', status: 'active', description: 'Track the missing weir wardens.' }],
        worldFacts: [{ id: 'f1', fact: 'The Pike buys captives.', category: 'lore', timestamp: 1 }],
        journal: [
            { id: 'j1', summary: 'The hero reached Brackwater and made enemies at the toll gate.', keyDecisions: [], consequences: ['The reeve remembers the insult'], messageRange: [0, 10], location: 'Brackwater', timestamp: 1 },
        ],
        npcs: [{ id: 'n1', name: 'Reeve Halvard', rosterTier: 'character', disposition: 'hostile', importance: 4 }],
        party: [{ id: 'c1', name: 'Osma', hp: 9, maxHp: 18, ac: 16, level: 2, affinity: 60 }],
        currentLocation: 'Brackwater',
        messages: [
            { id: 'u0', role: 'user', content: 'I draw steel.' },
            { id: 'a0', role: 'assistant', content: 'Reeve Halvard draws steel as the goblins close.' },
        ],
        combat: {
            ...initialGameState.combat,
            active: true,
            phase: 'awaiting_intent',
            round: 2,
            enemies: [{ id: 'goblin-1', name: 'Goblin', hp: 7, maxHp: 7, ac: 13, condition: 'healthy', conditions: [], combatStatus: 'active' }],
            turnOrder: [{ type: 'player', name: 'Testa', initiative: 15 }],
        },
    };
    const dispatch = (action) => { state = gameReducer(state, action); };
    const runner = createTurnRunner({
        getState: () => state,
        dispatch,
        streamMessage: streamMessage || vi.fn(async () => ''),
        sendMessage: sendMessage || vi.fn(async () => ''),
    });
    return { runner, getState: () => state };
}

const SKIPPED_ON_NARRATION = ['## ACTIVE QUESTS', '## WORLD FACTS', '## SESSION HISTORY', '## LOCATION TRANSITION HISTORY', '## INVENTORY'];
const KEPT_ON_NARRATION = ['## ACTIVE COMBAT', '## PLAYER CHARACTER', '## COMPANIONS (PARTY)', '## KNOWN NPCs', '## SETTING & TONE', '**Current location:**'];

describe('turn runner — a combat round is two DM stream calls, the narration one slimmed', () => {
    it('intent + narration = 2 stream calls, 0 Flash calls; the narration prompt keeps the prefix and drops the dead-weight blocks', async () => {
        const streamMessage = vi.fn(async ({ onChunk, systemPrompt }) => {
            const text = systemPrompt.includes('COMBAT INTENT ONLY')
                ? '```json\n{"combat_exchange": {"player_slots": [{"action": "attack", "strikes": [{"target": "Goblin"}]}], "enemy_intents": []}}\n```'
                : 'Steel rings against the goblin\'s buckler; Reeve Halvard curses from the bank.';
            onChunk?.(text);
            return text;
        });
        const sendMessage = vi.fn(async () => '');
        const { runner, getState } = createHarness({ streamMessage, sendMessage });

        await runner.sendToLLM('I attack the goblin.', 'I attack the goblin.', { combatIntentOnly: true });
        await runner.sendToLLM('[SYSTEM: Combat exchange exchange-1 has already been resolved completely by the engine. RESOLVED EVENTS: **Testa attacks Goblin** — Rolled **17** vs AC 13; **Hit for 8 damage.**]', null, { narrationOnly: true, combatNarration: true });

        expect(streamMessage).toHaveBeenCalledTimes(2);
        expect(sendMessage).not.toHaveBeenCalled();
        const [intent, narration] = streamMessage.mock.calls.map(call => call[0].systemPrompt);

        // The intent call still carries the full dynamic half.
        for (const heading of SKIPPED_ON_NARRATION) expect(intent).toContain(heading);
        expect(intent).toContain('COMBAT INTENT ONLY');

        // The narration call drops what it cannot use and keeps what it narrates from.
        for (const heading of SKIPPED_ON_NARRATION) expect(narration).not.toContain(heading);
        for (const heading of KEPT_ON_NARRATION) expect(narration).toContain(heading);
        expect(narration).toContain('Reeve Halvard');
        expect(narration).not.toContain('COMBAT INTENT ONLY');

        // The cached static prefix (through the premise) is byte-identical on both calls.
        const prefixEnd = intent.indexOf(PREMISE) + PREMISE.length;
        expect(prefixEnd).toBeGreaterThan(1000);
        expect(narration.slice(0, prefixEnd)).toBe(intent.slice(0, prefixEnd));
        expect(narration.length).toBeLessThan(intent.length);

        // The narration committed as the round's prose; the intent stored no bubble.
        const assistants = getState().messages.filter(m => m.role === 'assistant');
        expect(assistants.map(m => m.content)).toEqual([
            'Reeve Halvard draws steel as the goblins close.',
            'Steel rings against the goblin\'s buckler; Reeve Halvard curses from the bank.',
        ]);
    });

    it('a narration-only call without the combat lane keeps the full prompt (cast / roll-correction narration is not slimmed)', async () => {
        const streamMessage = vi.fn(async ({ onChunk }) => {
            const text = 'The ward settles over you.';
            onChunk?.(text);
            return text;
        });
        const { runner } = createHarness({ streamMessage });

        await runner.sendToLLM('[SYSTEM: narrate the cast.]', null, { narrationOnly: true });

        const [prompt] = streamMessage.mock.calls.map(call => call[0].systemPrompt);
        for (const heading of SKIPPED_ON_NARRATION) expect(prompt).toContain(heading);
    });
});
