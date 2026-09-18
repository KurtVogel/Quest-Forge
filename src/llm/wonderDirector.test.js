/**
 * The wonder director (WOW 2026-09-18): gating, the private context
 * projection (front STUBS only), and the generate → normalize path.
 */
import { describe, expect, it, vi } from 'vitest';

const { sendMessageMock } = vi.hoisted(() => ({ sendMessageMock: vi.fn() }));
vi.mock('./adapter.js', async (importOriginal) => ({
    ...(await importOriginal()),
    sendMessage: sendMessageMock,
}));

import { buildWonderContext, generateWonder, shouldGenerateWonder } from './wonderDirector.js';

const baseState = () => ({
    session: {
        id: 'campaign-1',
        premise: 'A quiet river town with debts.',
        pendingWonder: { key: 'wonder-60-lull', requestedAtMessage: 60, onDemand: false },
    },
    settings: { apiKey: 'k', llmProvider: 'gemini', model: 'gemini-3.1-pro-preview', preset: 'grimdark', paceDial: 'slow-burn', customSystemPrompt: 'Low magic. Nobody casts spells in public.' },
    combat: { active: false },
    character: { name: 'Rauha', race: 'human', class: 'cleric', level: 4, background: 'A ferryman\'s daughter.' },
    party: [{ name: 'Ketta', role: 'scout' }],
    currentLocation: 'Aldermill',
    locations: [{ id: 'loc-a', name: 'Aldermill', region: 'the Fenmarch' }, { id: 'loc-b', name: 'Deep Fen' }],
    npcs: [{ name: 'Orzo', disposition: 'guarded', basedIn: 'Aldermill' }, { name: { evil: true } }],
    fronts: [
        { id: 'front-tithe', title: 'The Tithe Collectors', status: 'active', clock: 4, maxClock: 6, stage: 1, grimPortents: ['a', 'b'], notes: 'SECRET', faction: { name: 'the Reeve\'s men' } },
        { id: 'front-old', title: 'The Drowned Bell', status: 'resolved' },
    ],
    worldFacts: [{ fact: 'The ferry is out.' }],
    journal: [{ summary: 'Two quiet days on the road.' }],
    messages: Array.from({ length: 62 }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', content: `m${i}` })),
});

describe('shouldGenerateWonder', () => {
    it('needs a typed pending marker, a session id, a key, and no fight', () => {
        expect(shouldGenerateWonder(baseState())).toBe(true);
        expect(shouldGenerateWonder({ ...baseState(), session: { id: 'c', pendingWonder: 'junk' } })).toBe(false);
        expect(shouldGenerateWonder({ ...baseState(), session: { id: 'c' } })).toBe(false);
        expect(shouldGenerateWonder({ ...baseState(), combat: { active: true } })).toBe(false);
        expect(shouldGenerateWonder({ ...baseState(), settings: {} })).toBe(false);
    });
});

describe('buildWonderContext', () => {
    it('projects premise, tone, hero, places, people, and front STUBS only — never clocks, stages, portents, or notes', () => {
        const context = buildWonderContext(baseState());
        expect(context.campaignPremise).toBe('A quiet river town with debts.');
        expect(context.tone).toEqual({ preset: 'Grimdark Survival', paceDial: 'slow-burn', playerInstructions: 'Low magic. Nobody casts spells in public.' });
        expect(context.hero).toMatchObject({ name: 'Rauha', class: 'cleric', level: 4, background: 'A ferryman\'s daughter.' });
        expect(context.region).toBe('the Fenmarch');
        expect(context.knownPlaces).toEqual(['Aldermill', 'Deep Fen']);
        expect(context.knownPeople).toEqual([{ name: 'Orzo', disposition: 'guarded', basedIn: 'Aldermill' }]);
        expect(context.livePressures).toEqual([{ id: 'front-tithe', faction: 'the Reeve\'s men' }]);
        expect(context.resolvedMatters).toEqual(['The Drowned Bell']);
        expect(JSON.stringify(context)).not.toContain('SECRET');
        expect(JSON.stringify(context)).not.toContain('grimPortents');
        expect(JSON.stringify(context)).not.toContain('clock');
        expect(context.recentEvents.length).toBeLessThanOrEqual(8);
        expect(context.playerAskedForIt).toBe(false);
    });
});

describe('generateWonder', () => {
    it('sends the DM-model call and returns normalized hooks with fits re-judged', async () => {
        sendMessageMock.mockResolvedValueOnce(JSON.stringify({
            hooks: [
                { register: 'person', title: 'The Countess of Vell', hook: 'A black carriage stops beside the wagon.', invitation: 'Supper at her manor.', fits: 'front:front-tithe' },
                { register: 'relic', title: 'The Beacon', hook: 'A green light pulses in the ruins.', invitation: 'Visible from the road.', fits: 'front:front-old' },
                { register: 'sight', title: 'The Sky Barge', hook: 'A barge crosses the sky.', invitation: 'Bound for the Closed Shore.', fits: 'standalone' },
            ],
        }));
        const hooks = await generateWonder(baseState());
        expect(hooks.map(h => [h.title, h.fits])).toEqual([
            ['The Countess of Vell', 'front-tithe'],
            ['The Beacon', 'standalone'],
            ['The Sky Barge', 'standalone'],
        ]);
        const call = sendMessageMock.mock.calls[0][0];
        expect(call.model).toBe('gemini-3.1-pro-preview');
        expect(call.systemPrompt).toContain('At least ONE hook must be "standalone"');
        expect(call.systemPrompt).toContain('WONDER, not danger');
        expect(call.temperature).toBe(0.9);
    });

    it('throws when nothing is pending and when the reply has no hooks', async () => {
        await expect(generateWonder({ ...baseState(), session: { id: 'c' } })).rejects.toThrow('No wonder is awaiting generation.');
        sendMessageMock.mockResolvedValueOnce('no json here');
        await expect(generateWonder(baseState())).rejects.toThrow(/wonder response/);
    });
});
