/**
 * Byte ceilings + key sets for every background director's context
 * (2026-09-20 audit, Lap 3 test depth): each is a DM-model call with default
 * thinking, fired off a marker — nothing pinned what they ship, so a projection
 * that quietly became a spread (the 846 KB portrait dump class) had no net.
 * The fixture is a worst-case campaign: every list long, every text at its cap.
 */
import { describe, expect, it, vi } from 'vitest';

const { sendMessageMock } = vi.hoisted(() => ({ sendMessageMock: vi.fn() }));
vi.mock('./adapter.js', () => ({ sendMessage: sendMessageMock }));

const { buildFrontAftermathContext } = await import('./frontAftermath.js');
const { buildAbsenceDriftContext } = await import('./absenceDrift.js');
const { buildRegionalFrontsContext } = await import('./regionalFronts.js');
const { buildWonderContext } = await import('./wonderDirector.js');
const { generateCampaignFronts } = await import('./frontDirector.js');

const fill = (label, length) => `${label} `.padEnd(length, label[0]);

const maxFront = (id, status = 'active') => ({
    id,
    status,
    title: fill(`Pressure ${id}`, 100),
    goal: fill('goal', 300),
    stakes: fill('stakes', 300),
    grimPortents: Array.from({ length: 6 }, (_, i) => fill(`portent ${i}`, 240)),
    publicHints: Array.from({ length: 6 }, (_, i) => fill(`hint ${i}`, 240)),
    notes: fill('notes', 500),
    stage: 2, clock: 3, maxClock: 8,
    faction: {
        name: fill(`Faction ${id}`, 100), goal: fill('fgoal', 300), stance: fill('stance', 200),
        relationships: Array.from({ length: 4 }, (_, i) => ({ frontId: `front-${i}`, stance: 'rival', note: fill('rel', 200) })),
    },
    resolution: fill('epitaph', 240),
    resolvedAtMessage: 90,
    portraitUrl: 'data:image/jpeg;base64,' + 'A'.repeat(60000),
});

const maxNpc = (i) => ({
    id: `npc-${i}`,
    name: `Councillor ${i}`,
    rosterTier: 'character',
    basedIn: 'Aldermill',
    lastLocation: 'Aldermill',
    gender: 'woman', species: 'human', disposition: 'wary',
    personality: fill('personality', 600), goals: fill('goals', 600), secrets: fill('secrets', 600),
    agenda: fill('agenda', 600), stanceToPlayer: fill('stance', 600), lastNotes: fill('notes', 600),
    appearance: fill('looks', 600),
    bondMoments: Array.from({ length: 10 }, (_, j) => ({ text: fill(`moment ${j}`, 240), kind: 'other', salience: 3 })),
    knownFacts: Array.from({ length: 30 }, (_, j) => fill(`fact ${j}`, 200)),
    portraitUrl: 'data:image/jpeg;base64,' + 'A'.repeat(60000),
});

const worstCaseState = () => ({
    session: {
        id: 'campaign-1',
        name: fill('campaign', 120),
        premise: fill('premise', 8000),
        pendingFrontAftermath: { frontId: 'front-done', title: 'The Done Thing' },
        pendingAbsenceDrift: { key: 'loc-a|200', locationName: 'Aldermill', awayDistance: 80, returnMessage: 200 },
        pendingRegionalFronts: { key: 'the saltreach|200', region: 'The Saltreach', locationName: 'Aldermill', atMessage: 200 },
        pendingWonder: { key: 'wonder|200', requestedAtMessage: 200, onDemand: false },
    },
    settings: { apiKey: 'k', llmProvider: 'gemini', model: 'gemini-3.1-pro-preview', paceDial: 'standard' },
    combat: { active: false },
    currentLocation: 'Aldermill',
    character: {
        name: 'Rauha', race: 'human', class: 'cleric', level: 4,
        background: fill('background', 2000), appearance: fill('appearance', 600),
    },
    party: Array.from({ length: 4 }, (_, i) => ({ id: `c-${i}`, name: `Companion ${i}`, role: fill('role', 100), notes: fill('notes', 600) })),
    fronts: [maxFront('front-done', 'resolved'), maxFront('front-a'), maxFront('front-b'), maxFront('front-c'), maxFront('front-d')],
    npcs: Array.from({ length: 40 }, (_, i) => maxNpc(i)),
    worldFacts: Array.from({ length: 80 }, (_, i) => ({ id: `f-${i}`, category: 'event', fact: fill(`fact ${i}`, 500) })),
    journal: Array.from({ length: 30 }, (_, i) => ({
        id: `j-${i}`, summary: fill(`summary ${i}`, 2000), location: 'Aldermill',
        keyDecisions: Array.from({ length: 8 }, () => fill('decision', 300)),
        consequences: Array.from({ length: 8 }, () => fill('consequence', 300)),
    })),
    quests: Array.from({ length: 12 }, (_, i) => ({ id: `q-${i}`, name: fill(`quest ${i}`, 160), description: fill('desc', 800), status: 'active' })),
    storyMemory: Array.from({ length: 40 }, (_, i) => ({
        id: `card-${i}`, type: 'promise', status: 'active', salience: 4,
        subject: fill(`subject ${i}`, 120), text: fill(`card ${i}`, 400),
    })),
    locations: [{ id: 'loc-a', name: 'Aldermill', type: 'settlement', danger: 'low', region: 'Home Vale', aliases: [], theaterFrontIds: ['front-a'] }],
    recentEncounters: Array.from({ length: 10 }, (_, i) => ({ enemies: fill('ghouls', 200), location: fill('place', 120), outcome: 'victory', messageIndex: 100 + i })),
    messages: Array.from({ length: 220 }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', content: fill(`message ${i}`, 3000) })),
});

// Measured 2026-09-20 at this fixture: aftermath 68,954 (was ~85 KB), drift
// 30,300, regional 28,481, wonder 24,559, campaign fronts 8,882.
const size = context => JSON.stringify(context).length;

describe('background director contexts — worst-case ceilings and key sets', () => {
    it('never ships a portrait, whatever the roster carries', () => {
        const state = worstCaseState();
        for (const build of [buildFrontAftermathContext, buildAbsenceDriftContext, buildRegionalFrontsContext, buildWonderContext]) {
            expect(JSON.stringify(build(state))).not.toContain('base64');
        }
    });

    it('front aftermath: other fronts ship as title/goal/faction only', () => {
        const context = buildFrontAftermathContext(worstCaseState());
        expect(context.remainingActiveFronts).toHaveLength(3);
        for (const front of context.remainingActiveFronts) {
            expect(Object.keys(front).sort()).toEqual(['faction', 'goal', 'title']);
        }
        expect(size(context.remainingActiveFronts)).toBeLessThan(1600);
        // The resolved front itself keeps its full dossier — it is the subject.
        expect(context.resolvedFront.grimPortents.length).toBeGreaterThan(0);
        expect(size(context)).toBeLessThan(72000);
    });

    it('absence drift stays bounded', () => {
        expect(size(buildAbsenceDriftContext(worstCaseState()))).toBeLessThan(33000);
    });

    it('regional fronts stays bounded and projects existing fronts to three fields', () => {
        const context = buildRegionalFrontsContext(worstCaseState());
        for (const front of context.existingCampaignFronts) {
            expect(Object.keys(front).sort()).toEqual(['faction', 'goal', 'title']);
        }
        expect(size(context)).toBeLessThan(32000);
    });

    it('wonder stays bounded', () => {
        expect(size(buildWonderContext(worstCaseState()))).toBeLessThan(27000);
    });

    it('campaign fronts: a fixed key set, bounded by the premise', async () => {
        sendMessageMock.mockReset();
        sendMessageMock.mockRejectedValue(new Error('stop after capture'));
        const state = { ...worstCaseState(), messages: [], fronts: [] };
        state.session = { ...state.session, createdAt: 1 };
        await generateCampaignFronts(state).catch(() => {});
        expect(sendMessageMock).toHaveBeenCalledTimes(1);
        const context = JSON.parse(sendMessageMock.mock.calls[0][0].userMessage);
        expect(Object.keys(context).sort()).toEqual(['campaignName', 'campaignPremise', 'hero', 'startingLocation', 'travelingAlone']);
        expect(Object.keys(context.hero).sort()).toEqual(['appearance', 'background', 'class', 'name', 'race']);
        expect(size(context)).toBeLessThan(10000);
    });
});
