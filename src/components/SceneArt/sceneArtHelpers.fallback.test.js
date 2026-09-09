/**
 * pickSceneSituation never paints the journal's apology (2026-09-09 audit P2,
 * minor): with no narration in the transcript it fell to `journal[last].summary`
 * without checking `fallback` — "Auto-summary was unavailable for a stretch of
 * 10 messages." became the situation the art director painted.
 */
import { describe, expect, it } from 'vitest';
import { pickSceneSituation } from './sceneArtHelpers.js';

describe('pickSceneSituation journal fallback entries', () => {
    it('skips a fallback entry and uses the newest REAL summary', () => {
        const { situation } = pickSceneSituation({
            messages: [],
            journal: [
                { id: 'j1', summary: 'The hero reached Ashford at dusk.' },
                { id: 'j2', summary: 'Auto-summary was unavailable for a stretch of 10 messages.', fallback: true },
            ],
            location: 'Ashford',
        });
        expect(situation).toBe('The hero reached Ashford at dusk.');
    });

    it('falls to the bare location when every entry is a fallback or junk', () => {
        const { situation } = pickSceneSituation({
            messages: [],
            journal: [
                { id: 'j2', summary: 'Auto-summary was unavailable…', fallback: true },
                null,
                { id: 'j3', summary: { text: 'x' } },
            ],
            location: 'Ashford',
        });
        expect(situation).toBe('The scene at Ashford.');
    });
});
