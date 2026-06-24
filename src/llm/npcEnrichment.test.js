import { describe, expect, it } from 'vitest';
import {
    gatherNpcEnrichmentContext,
    needsNpcEnrichment,
    normalizeCallbackHook,
    normalizeCallbackHooks,
} from './npcEnrichment.js';

describe('npcEnrichment', () => {
    it('flags thin legacy records that need deepening', () => {
        expect(needsNpcEnrichment({
            name: 'Captain Riven',
            disposition: 'hostile',
            lastNotes: 'Violently pursuing Vesa',
        })).toBe(true);
    });

    it('skips NPCs that already have agenda and tension', () => {
        expect(needsNpcEnrichment({
            name: 'Captain Riven',
            agenda: 'Reassert authority over Jewelglade.',
            relationshipTension: 'Humiliated by Vesa\'s defiance.',
        })).toBe(false);
    });

    it('gathers premise and journal context mentioning the NPC', () => {
        const context = gatherNpcEnrichmentContext({
            session: {
                premise: 'Jewelglade admits only women and eunuchs. Captain Riven commands the town guard.',
            },
            journal: [
                {
                    summary: 'Captain Riven chased Vesa beyond Jewelglade with two guards.',
                    consequences: ['Vesa narrowly escaped alive.'],
                },
            ],
            worldFacts: [{ fact: 'Captain Riven believes Vesa is a fraud and a threat to order.' }],
            storyMemory: [],
        }, {
            name: 'Captain Riven',
            lastNotes: 'Violently pursuing Vesa',
        });

        expect(context.premise).toContain('Jewelglade');
        expect(context.journalHighlights).toHaveLength(1);
        expect(context.worldFacts[0]).toContain('Captain Riven');
    });

    it('trims truncated hook fragments from incomplete model output', () => {
        expect(normalizeCallbackHook('She may be worried abou')).toBe('She may be worried');
        expect(normalizeCallbackHooks(['Complete hook.', 'She may be worried abou']))
            .toEqual(['Complete hook.', 'She may be worried']);
    });
});