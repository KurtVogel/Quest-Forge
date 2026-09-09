/**
 * composeScenePrompt's input assembly sits ABOVE its try (2026-09-09 audit
 * P1): an object identity field on the hero, a companion, or an NPC rejected
 * the whole call and Scene mode showed the raw TypeError as its error.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { composeScenePrompt } from './sceneDirector.js';
import { sendMessage } from './adapter.js';

vi.mock('./adapter.js', () => ({
    sendMessage: vi.fn(),
}));

const settings = { apiKey: 'test-key', llmProvider: 'gemini' };
const userMessage = () => sendMessage.mock.calls[0][0].userMessage;

describe('composeScenePrompt with untyped records', () => {
    beforeEach(() => sendMessage.mockReset());

    it('never rejects on object identity fields and never paints "[object Object]"', async () => {
        sendMessage.mockResolvedValue('prompt');
        const result = await composeScenePrompt({
            situation: 'A quiet dock.',
            character: { name: 'Ghazra', gender: {}, appearance: {}, background: ['x'], race: 'halfOrc', class: 'fighter', equippedSummary: 7 },
            party: [{ id: 'c1', name: 'Wit', species: 5, gender: ['m'], appearance: { look: 'x' }, notes: 42, role: { r: 1 }, weapon: 'Dagger' }],
            npcs: [{ id: 'n1', name: 'Maren', rosterTier: 'character', appearance: { look: 'x' }, gender: ['f'], species: 9, disposition: { d: 1 } }],
            currentLocation: 'Docks',
            settings,
        });
        expect(result).toBe('prompt');
        const text = userMessage();
        expect(text).not.toContain('[object Object]');
        expect(text).toContain('Player character — Ghazra: a Half-Orc Fighter');
        expect(text).toContain('Party companion — Wit: companion Wielding Dagger.');
        expect(text).toContain('NPC — Maren: NPC');
    });
});
