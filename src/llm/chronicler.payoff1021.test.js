/**
 * WOW 2026-10-21 (hidden-fronts-payoff, slice B): the chronicler receives the
 * design of every hidden pressure the hero ENDED inside the chapter's span —
 * read from the fronts' own `resolvedAtMessage`, never from session state —
 * so the placed symptoms are retold as foreshadowing. A front resolved
 * outside the span, or still active, is never handed over.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { sendMessage } from './adapter.js';
import { CHRONICLE_MIN_MESSAGES, describeRevealedFronts, writeChronicleChapters } from './chronicler.js';

vi.mock('./adapter.js', () => ({
    sendMessage: vi.fn(),
}));

const SETTINGS = { llmProvider: 'gemini', apiKey: 'test-key', model: 'test-model' };

function makeMessages(count) {
    return Array.from({ length: count }, (_, i) => ({
        role: i % 2 === 0 ? 'user' : 'assistant',
        content: `Play beat number ${i}.`,
    }));
}

const front = (extra = {}) => ({
    id: 'front-brood', title: 'The Mill Brood', goal: 'Claim the valley.', stakes: 'The valley starves.',
    grimPortents: ['Raids begin.', 'The mill falls.', 'The valley empties.'],
    clock: 4, maxClock: 6, stage: 2, status: 'resolved', resolvedAtMessage: 3,
    publicHints: ['Burnt wagons on the north road.'],
    faction: { name: 'The Brood', goal: 'Feed on the valley.' },
    ...extra,
});

describe('describeRevealedFronts', () => {
    it('lists only fronts resolved inside the span, each with its reveal', () => {
        const lines = describeRevealedFronts([
            front(),
            front({ id: 'f-early', title: 'Early', resolvedAtMessage: 1 }),
            front({ id: 'f-late', title: 'Late', resolvedAtMessage: 9 }),
            front({ id: 'f-active', title: 'Active', status: 'active', resolvedAtMessage: 4 }),
            front({ id: 'f-legacy', title: 'Legacy', resolvedAtMessage: undefined }),
        ], 2, 6);
        expect(lines).toHaveLength(1);
        expect(lines[0]).toContain('- "The Mill Brood" (ENDED by the hero): What it wanted: Feed on the valley.');
        expect(lines[0]).toContain('What you saw of it: "Burnt wagons on the north road."');
        expect(lines[0]).toContain('What was coming next: The valley empties.');
        expect(describeRevealedFronts(null, 0, 10)).toEqual([]);
    });
});

describe('writeChronicleChapters hands the reveal to the chronicler', () => {
    beforeEach(() => {
        sendMessage.mockReset();
        sendMessage.mockResolvedValue('The saga of the brood.');
    });

    it('a front resolved in the span rides the user message under the foreshadowing rule; the system prompt carries the rule', async () => {
        const state = {
            settings: SETTINGS,
            character: { name: 'Eero' },
            session: {},
            messages: makeMessages(CHRONICLE_MIN_MESSAGES),
            chronicle: [],
            fronts: [front()],
        };
        await writeChronicleChapters({ state });
        const request = sendMessage.mock.calls[0][0];
        expect(request.userMessage).toContain('HIDDEN PRESSURES THAT ENDED IN THIS SPAN');
        expect(request.userMessage).toContain('- "The Mill Brood" (ENDED by the hero): What it wanted: Feed on the valley.');
        expect(request.userMessage).toContain('retell them as foreshadowing');
        expect(request.systemPrompt).toContain('When HIDDEN PRESSURES THAT ENDED is provided');
    });

    it('a front resolved before the span (an earlier chapter) or still active is not handed over', async () => {
        const state = {
            settings: SETTINGS,
            character: { name: 'Eero' },
            session: {},
            messages: makeMessages(CHRONICLE_MIN_MESSAGES * 2),
            chronicle: [{ title: 'Chapter 1', text: 'x', fromIndex: 0, toIndex: CHRONICLE_MIN_MESSAGES - 1 }],
            fronts: [front({ resolvedAtMessage: 2 }), front({ id: 'f-active', title: 'Still Turning', status: 'active' })],
        };
        await writeChronicleChapters({ state });
        const request = sendMessage.mock.calls[0][0];
        expect(request.userMessage).not.toContain('HIDDEN PRESSURES');
        expect(request.userMessage).not.toContain('Still Turning');
    });
});
