import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
    enrichNpcProfile,
    gatherNpcEnrichmentContext,
    needsNpcEnrichment,
    normalizeCallbackHook,
    normalizeCallbackHooks,
} from './npcEnrichment.js';
import { sendMessage } from './adapter.js';

vi.mock('./adapter.js', () => ({
    sendMessage: vi.fn(),
}));

describe('npcEnrichment', () => {
    it('flags thin legacy records that need deepening', () => {
        expect(needsNpcEnrichment({
            name: 'Captain Riven',
            disposition: 'hostile',
            lastNotes: 'Violently pursuing Vesa',
        })).toBe(true);
    });

    it('re-flags pre-stance records as thin so existing campaigns can upgrade', () => {
        expect(needsNpcEnrichment({
            name: 'Captain Riven',
            lastNotes: 'Violently pursuing Vesa',
            agenda: 'Reassert authority over Jewelglade.',
            relationshipTension: 'Humiliated by Vesa\'s defiance.',
        })).toBe(true);
    });

    it('skips NPCs that already have agenda, tension, and a personal stance', () => {
        expect(needsNpcEnrichment({
            name: 'Captain Riven',
            agenda: 'Reassert authority over Jewelglade.',
            relationshipTension: 'Humiliated by Vesa\'s defiance.',
            stanceToPlayer: 'Regards Vesa as a fraud to be broken publicly.',
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

    it('includes recent conversation excerpts mentioning the NPC — where the bond actually lives', () => {
        const context = gatherNpcEnrichmentContext({
            character: { name: 'Vesa' },
            messages: [
                { role: 'user', content: 'I tell Maren her laugh is the best thing in this town.' },
                { role: 'assistant', content: 'Maren laughs despite herself; her hand stays on yours a beat too long.' },
                { role: 'user', content: 'I head to the stables alone.', },
                { role: 'assistant', content: 'The stables smell of hay and rain.' },
                { role: 'system', content: 'Maren system line that must not leak.', },
                { role: 'assistant', content: 'Hidden Maren setup.', hidden: true },
            ],
            journal: [],
            worldFacts: [],
            storyMemory: [],
        }, {
            name: 'Maren',
            stanceToPlayer: 'Amused by the hero.',
            bondMoments: [{ text: 'Shared wine at the Gilded Fern.', at: 1 }],
        });

        expect(context.heroName).toBe('Vesa');
        expect(context.recentConversation).toHaveLength(2);
        expect(context.recentConversation[0].speaker).toContain('HERO');
        expect(context.recentConversation[0].text).toContain('her laugh is the best thing');
        expect(context.recentConversation[1].speaker).toBe('DM');
        expect(context.recentConversation.some(m => m.text.includes('stables'))).toBe(false);
        expect(context.existingRecord.stanceToPlayer).toBe('Amused by the hero.');
        expect(context.existingRecord.bondMoments).toEqual(['Shared wine at the Gilded Fern.']);
    });

    it('trims truncated hook fragments from incomplete model output', () => {
        expect(normalizeCallbackHook('She may be worried abou')).toBe('She may be worried');
        expect(normalizeCallbackHooks(['Complete hook.', 'She may be worried abou']))
            .toEqual(['Complete hook.', 'She may be worried']);
    });
});

describe('enrichNpcProfile relationship synthesis', () => {
    beforeEach(() => {
        sendMessage.mockReset();
    });

    const settings = { apiKey: 'test-key', llmProvider: 'gemini' };
    const state = {
        character: { name: 'Vesa' },
        messages: [
            { role: 'user', content: 'I flirt with Maren while she pours the wine.' },
            { role: 'assistant', content: 'Maren smirks and pours a little extra.' },
        ],
        journal: [],
        worldFacts: [],
        storyMemory: [],
    };

    it('parses stanceToPlayer and bondMoments from the enrichment response', async () => {
        sendMessage.mockResolvedValue(JSON.stringify({
            agenda: 'Keep the tavern out of the guild dispute.',
            relationshipTension: 'Attraction she does not fully trust.',
            stanceToPlayer: 'Charmed by Vesa\'s boldness but wary of charming strangers.',
            bondMoments: [
                'Vesa flirted while Maren poured wine; she smirked and poured extra.',
                '',
            ],
            callbackHooks: ['The extra measure of wine she never charged for.'],
        }));

        const update = await enrichNpcProfile({
            state,
            npc: { id: 'npc-maren', name: 'Maren' },
            settings,
        });

        expect(update.stanceToPlayer).toContain('Charmed by Vesa');
        expect(update.bondMoments).toEqual(['Vesa flirted while Maren poured wine; she smirked and poured extra.']);
        const request = sendMessage.mock.calls[0][0];
        expect(request.systemPrompt).toContain('PRIMARY output');
        expect(request.userMessage).toContain('recentConversation');
    });

    it('accepts a response that only establishes the personal relationship', async () => {
        sendMessage.mockResolvedValue(JSON.stringify({
            stanceToPlayer: 'Quietly fond of Vesa; keeps it hidden behind teasing.',
        }));

        const update = await enrichNpcProfile({
            state,
            npc: { id: 'npc-maren', name: 'Maren' },
            settings,
        });
        expect(update.stanceToPlayer).toContain('Quietly fond');
    });

    it('captures a merged physical appearance from conversation, unvarnished', async () => {
        sendMessage.mockResolvedValue(JSON.stringify({
            appearance: 'A scrawny goblin with large bat-like ears, yellow-slitted eyes, an oddly cute face, and a surprisingly thick, plump backside under grimy leather.',
        }));

        const update = await enrichNpcProfile({
            state,
            npc: { id: 'npc-wit', name: 'Wit', appearance: 'A scrawny goblin with large bat-like ears and yellow-slitted eyes.' },
            settings,
        });

        expect(update.appearance).toContain('plump backside');
        expect(update.appearance).toContain('bat-like ears');
        const request = sendMessage.mock.calls[0][0];
        expect(request.systemPrompt).toContain('COMPLETE merged description');
        expect(request.systemPrompt).toContain('unvarnished');
        expect(request.userMessage).toContain('appearance');
    });
});
