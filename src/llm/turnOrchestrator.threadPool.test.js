/**
 * The open thread reads the POOL, the callbacks block reads the curated list
 * (2026-09-30 story-memory Lap-3 P1). `buildCurrentSystemPrompt` used to hand
 * the ≤5 curated cards to the builder as `storyMemory`, and the builder
 * forwarded that same list to `resolveOpenThread`'s promise fallback — so an
 * NPC's `between you now:` vanished whenever louder cards about someone else
 * outscored their promise, and for 8 conversational messages right after the
 * DM paid it off (cooldown → score 0). The Journal / Companions cards read
 * `state.storyMemory` and kept showing the thread the DM was never told.
 *
 * Real curation, no mocks: the fixture makes the curated five certain.
 */
import { describe, expect, it, vi } from 'vitest';
import { gameReducer, initialGameState } from '../state/gameReducer.js';
import { createCharacter } from '../engine/characterUtils.js';
import { createTurnRunner } from './turnOrchestrator.js';

const ABILITY_SCORES = { strength: 15, dexterity: 12, constitution: 14, intelligence: 10, wisdom: 10, charisma: 8 };
const PROMISE = 'The hero swore to Oren they would carry his letter to the widow at Saltmere before the ice.';

function createHarness({ promiseExtras = {} } = {}) {
    const messages = [
        { id: 'u0', role: 'user', content: 'I sit down across from Bram.' },
        { id: 'a0', role: 'assistant', content: 'Bram sets down his tankard and studies you. Oren waits by the door.' },
    ];
    // Twelve loud mysteries about the present Bram (salience 5, charged, here)
    // beside one quiet salience-3 promise linked to the companion Oren.
    const mysteries = Array.from({ length: 12 }, (_, i) => ({
        id: `mystery-${i}`, type: 'mystery', status: 'active', salience: 5, emotionalCharge: 5,
        subject: `Bram and the lantern ${i}`, linkedNpcNames: ['Bram'], location: 'Brackwater',
        text: `Bram knows where the lantern ${i} went and lies about it every time it comes up.`,
        lastSeenMessage: 1,
    }));
    const promise = {
        id: 'promise-oren', type: 'promise', status: 'active', salience: 3, emotionalCharge: 1,
        subject: 'the letter for the widow', linkedNpcNames: ['Oren'], location: 'Jewelglade',
        text: PROMISE, lastSeenMessage: 0, ...promiseExtras,
    };
    let state = {
        ...initialGameState,
        character: createCharacter('Testa', 'human', 'fighter', ABILITY_SCORES, ['athletics']),
        settings: { ...initialGameState.settings, llmProvider: 'openai', apiKey: 'test-key', model: 'test-model' },
        session: { ...initialGameState.session, id: 'session-test' },
        npcs: [
            { id: 'n-bram', name: 'Bram', rosterTier: 'character', kind: 'character', disposition: 'wary', importance: 3, lastNotes: 'Drinks at the Flagon.' },
            { id: 'n-oren', name: 'Oren', rosterTier: 'character', kind: 'character', disposition: 'friendly', importance: 3, stanceToPlayer: 'Trusts the hero with his errands.' },
        ],
        party: [{ id: 'c1', name: 'Oren', hp: 12, maxHp: 12, ac: 14, level: 2, affinity: 70 }],
        currentLocation: 'Brackwater',
        messages,
        storyMemory: [promise, ...mysteries],
    };
    const dispatch = (action) => { state = gameReducer(state, action); };
    const streamMessage = vi.fn(async ({ onChunk }) => {
        const text = 'Bram shrugs. Oren clears his throat by the door.';
        onChunk?.(text);
        return text;
    });
    const runner = createTurnRunner({
        getState: () => state,
        dispatch,
        streamMessage,
        sendMessage: vi.fn(async () => ''),
    });
    return { runner, streamMessage };
}

function sectionOf(prompt, heading) {
    const start = prompt.indexOf(heading);
    if (start < 0) return '';
    const next = prompt.indexOf('\n## ', start + heading.length);
    return prompt.slice(start, next < 0 ? undefined : next);
}

describe('turn runner — the open thread is a lookup over the pool, the callbacks block a projection', () => {
    it('renders Oren\'s promise as "between you now" although the curated five are all Bram\'s mysteries', async () => {
        const { runner, streamMessage } = createHarness();
        await runner.sendToLLM('I ask Bram about the lantern.', 'I ask Bram about the lantern.');
        expect(streamMessage).toHaveBeenCalledTimes(1);
        const prompt = streamMessage.mock.calls[0][0].systemPrompt;

        const callbacks = sectionOf(prompt, '## DRAMATIC CALLBACK OPPORTUNITIES');
        expect(callbacks).toContain('Bram');
        expect(callbacks).not.toContain('widow at Saltmere'); // curation narrowed the SHOWN list — as designed
        expect((callbacks.match(/^- /gm) || []).length).toBeLessThanOrEqual(5);

        const party = sectionOf(prompt, '## COMPANIONS (PARTY)');
        expect(party).toContain(`Between you now: ${PROMISE}`);
    });

    it('keeps the thread while the promise is on its callback cooldown (paid off 0 messages ago → curation score 0)', async () => {
        const { runner, streamMessage } = createHarness({ promiseExtras: { lastUsedMessage: 1 } });
        await runner.sendToLLM('I ask Bram about the lantern.', 'I ask Bram about the lantern.');
        const prompt = streamMessage.mock.calls[0][0].systemPrompt;
        expect(sectionOf(prompt, '## DRAMATIC CALLBACK OPPORTUNITIES')).not.toContain('widow at Saltmere');
        expect(sectionOf(prompt, '## COMPANIONS (PARTY)')).toContain(`Between you now: ${PROMISE}`);
    });
});
