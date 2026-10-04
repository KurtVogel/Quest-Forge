/**
 * The director family's shared shelf (2026-10-03 living-world Lap-4): one
 * gate, one call, one set of canon projections. The size test
 * (`directorContexts.size.test.js`) pins bytes; this pins the SHAPE the lanes
 * share, which is what drifted when each lane owned a copy.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { sendMessageMock } = vi.hoisted(() => ({ sendMessageMock: vi.fn() }));
vi.mock('./adapter.js', () => ({ sendMessage: sendMessageMock }));

const {
    DIRECTOR_CONTEXT_DEFAULTS, baseDirectorContext, directorHero, isDirectorReady, runDirector,
} = await import('./directorUtils.js');
const { buildFrontAftermathContext, shouldGenerateFrontAftermath } = await import('./frontAftermath.js');
const { buildAbsenceDriftContext, shouldGenerateAbsenceDrift } = await import('./absenceDrift.js');
const { buildRegionalFrontsContext, shouldGenerateRegionalFronts } = await import('./regionalFronts.js');
const { buildWonderContext, shouldGenerateWonder } = await import('./wonderDirector.js');

const state = () => ({
    session: {
        id: 'campaign-1',
        premise: 'A quiet river town with debts.',
        pendingFrontAftermath: { frontId: 'front-done', title: 'The Done Thing' },
        pendingAbsenceDrift: { key: 'loc-a|200', locationName: 'Aldermill', awayDistance: 80, returnMessage: 200 },
        pendingRegionalFronts: { key: 'the saltreach|200', region: 'The Saltreach', locationName: 'Aldermill' },
        pendingWonder: { key: 'wonder-200-lull', requestedAtMessage: 200, onDemand: false },
    },
    settings: { apiKey: 'k', llmProvider: 'gemini', model: 'gemini-3.1-pro-preview' },
    combat: { active: false },
    currentLocation: 'Aldermill',
    character: { name: 'Rauha', race: 'human', class: 'cleric', level: 4, background: 'A ferryman\'s daughter.' },
    fronts: [],
    npcs: [],
    locations: [{ id: 'loc-a', name: 'Aldermill', aliases: [], theaterFrontIds: [] }],
    worldFacts: Array.from({ length: 40 }, (_, i) => ({ id: `f-${i}`, category: 'event', fact: `fact ${i} `.padEnd(700, 'f') })),
    journal: Array.from({ length: 12 }, (_, i) => ({ id: `j-${i}`, summary: `summary ${i} `.padEnd(1500, 's') })),
    quests: [
        { id: 'q-done', name: 'TERMINAL', description: 'x', status: 'completed' },
        ...Array.from({ length: 14 }, (_, i) => ({ id: `q-${i}`, name: `quest ${i}`, description: 'd'.repeat(700), status: 'active' })),
    ],
    messages: [],
});

beforeEach(() => sendMessageMock.mockReset());

describe('isDirectorReady — the four gates are one', () => {
    const gates = [shouldGenerateFrontAftermath, shouldGenerateAbsenceDrift, shouldGenerateRegionalFronts, shouldGenerateWonder];

    it('a pending marker, a session id, a DM key, and no live fight', () => {
        for (const gate of gates) {
            expect(gate(state()), gate.name).toBe(true);
            expect(gate({ ...state(), settings: {} }), gate.name).toBe(false);
            expect(gate({ ...state(), combat: { active: true } }), gate.name).toBe(false);
            expect(gate({ ...state(), session: { id: 'campaign-1' } }), gate.name).toBe(false);
            expect(gate({ ...state(), session: { ...state().session, id: '' } }), gate.name).toBe(false);
            expect(gate(null), gate.name).toBe(false);
        }
        expect(isDirectorReady(state(), null)).toBe(false);
        expect(isDirectorReady(state(), { key: 'x' })).toBe(true);
    });
});

describe('baseDirectorContext — one default set, overrides stated at the call site', () => {
    it('projects premise, hero, live facts, journal, and ACTIVE quests at the defaults', () => {
        const base = baseDirectorContext(state());
        expect(Object.keys(base)).toEqual(['campaignPremise', 'hero', 'canonicalWorldFacts', 'journal', 'activeQuests']);
        expect(base.hero).toEqual({ name: 'Rauha', race: 'human', class: 'cleric', level: 4 });
        expect(base.hero).toEqual(directorHero(state().character));
        expect(base.canonicalWorldFacts).toHaveLength(DIRECTOR_CONTEXT_DEFAULTS.facts);
        expect(base.canonicalWorldFacts[0].fact).toHaveLength(DIRECTOR_CONTEXT_DEFAULTS.factChars);
        expect(base.journal).toHaveLength(DIRECTOR_CONTEXT_DEFAULTS.journal);
        expect(base.journal[0].summary).toHaveLength(DIRECTOR_CONTEXT_DEFAULTS.journalChars);
        expect(base.activeQuests).toHaveLength(DIRECTOR_CONTEXT_DEFAULTS.quests);
        expect(base.activeQuests[0].description).toHaveLength(DIRECTOR_CONTEXT_DEFAULTS.questChars);
        expect(JSON.stringify(base)).not.toContain('TERMINAL');
        expect(baseDirectorContext(state(), { journal: 0 })).not.toHaveProperty('journal');
    });

    it('the drift and regional lanes ship the SAME shared projections; the aftermath lane is the one stated override', () => {
        const drift = buildAbsenceDriftContext(state());
        const regional = buildRegionalFrontsContext(state());
        const aftermath = buildFrontAftermathContext(state());
        for (const key of ['campaignPremise', 'hero', 'canonicalWorldFacts', 'activeQuests']) {
            expect(regional[key], key).toEqual(drift[key]);
        }
        expect(regional).not.toHaveProperty('journal');
        expect(aftermath.hero).toEqual(drift.hero);
        expect(aftermath.canonicalWorldFacts).toHaveLength(30);
        expect(aftermath.journal).toHaveLength(6);
        expect(aftermath.activeQuests).toHaveLength(10);
        // The wonder lane's hero is the same hero plus the background it grounds a hook in.
        const { background, ...wonderHero } = buildWonderContext(state()).hero;
        expect(wonderHero).toEqual(drift.hero);
        expect(background).toContain('ferryman');
    });
});

describe('runDirector — the one call', () => {
    it('sends the DM\'s own provider / key / model, an empty history, the context as the user message, and parses on the anchor', async () => {
        sendMessageMock.mockResolvedValue('Here you go:\n{"hooks": [1, 2,],}\nDone.');
        const parsed = await runDirector(state(), { prompt: 'PROMPT', context: { a: 1 }, anchor: 'hooks', label: 'wonder', temperature: 0.9 });
        expect(parsed).toEqual({ hooks: [1, 2] });
        expect(sendMessageMock).toHaveBeenCalledTimes(1);
        expect(sendMessageMock.mock.calls[0][0]).toEqual({
            provider: 'gemini', apiKey: 'k', model: 'gemini-3.1-pro-preview',
            systemPrompt: 'PROMPT', messageHistory: [], userMessage: '{"a":1}', temperature: 0.9,
        });
    });

    it('defaults the temperature, names a missing anchor, and passes a lane\'s own error wording through', async () => {
        sendMessageMock.mockResolvedValue('prose only');
        await expect(runDirector(state(), { prompt: 'P', context: {}, anchor: 'fronts', label: 'living-world' }))
            .rejects.toThrow('The living-world response did not contain fronts.');
        expect(sendMessageMock.mock.calls[0][0].temperature).toBe(0.7);
        await expect(runDirector(state(), { prompt: 'P', context: {}, anchor: ['a', 'b'], label: 'x', errors: { missingMessage: 'No web.' } }))
            .rejects.toThrow('No web.');
    });
});
