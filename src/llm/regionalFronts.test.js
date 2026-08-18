/**
 * Regional front seeding (2026-08-18 audit: shipped with no suite): generation
 * gating, the new-region context projection, and the malformed-response paths
 * of the one-shot native-pressure director call. Proposal sanitation itself is
 * shared with frontAftermath and covered there.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { sendMessageMock } = vi.hoisted(() => ({ sendMessageMock: vi.fn() }));
vi.mock('./adapter.js', () => ({ sendMessage: sendMessageMock }));

const {
    buildRegionalFrontsContext,
    generateRegionalFronts,
    shouldGenerateRegionalFronts,
} = await import('./regionalFronts.js');

const baseState = () => ({
    session: {
        id: 'campaign-1',
        premise: 'A drowned delta ruled by toll-weirs.',
        pendingRegionalFronts: { region: 'The Harchwold', locationName: 'Saltmarsh Landing' },
    },
    settings: { apiKey: 'k', llmProvider: 'gemini', model: 'gemini-3.1-pro-preview' },
    combat: { active: false },
    character: { name: 'Rauha', race: 'human', class: 'cleric', level: 4 },
    locations: [
        { id: 'loc-salt', name: 'Saltmarsh Landing', aliases: [], type: 'settlement', danger: 'low' },
    ],
    fronts: [
        { id: 'front-tithe', title: 'The Tithe Collectors', status: 'active', goal: 'Squeeze the river trade', faction: { name: 'Grey Ledger' } },
        { id: 'front-done', title: 'A Resolved One', status: 'resolved', faction: { name: 'Gone' } },
    ],
    worldFacts: [{ fact: 'The Harchwold trades in salt and grudges', category: 'lore' }],
    quests: [
        { name: 'Find the ledger', description: 'Trace the debts', status: 'active' },
        { name: 'Old errand', description: 'Done', status: 'failed' },
    ],
    messages: [
        { role: 'assistant', content: 'The salt flats stretch to a grey horizon.' },
        { role: 'assistant', content: 'Hidden line.', hidden: true },
    ],
});

const proposal = () => ({
    title: 'The Brine Compact',
    goal: 'Corner the salt trade',
    stakes: 'Every pan pays the compact',
    grimPortents: ['Pans change hands', 'A rival drowns'],
    faction: { name: 'The Compact', goal: 'Own the pans', stance: 'Wary of outsiders', relationships: ['Leans on the harbormaster'] },
    reason: 'Salt is the region\'s one currency.',
});

beforeEach(() => {
    sendMessageMock.mockReset();
});

describe('shouldGenerateRegionalFronts', () => {
    it('requires the pending marker, a session id, an api key, and no active combat', () => {
        const state = baseState();
        expect(shouldGenerateRegionalFronts(state)).toBe(true);
        expect(shouldGenerateRegionalFronts({ ...state, session: { ...state.session, pendingRegionalFronts: null } })).toBe(false);
        expect(shouldGenerateRegionalFronts({ ...state, session: { ...state.session, id: null } })).toBe(false);
        expect(shouldGenerateRegionalFronts({ ...state, settings: { apiKey: '' } })).toBe(false);
        expect(shouldGenerateRegionalFronts({ ...state, combat: { active: true } })).toBe(false);
        expect(shouldGenerateRegionalFronts(null)).toBe(false);
    });
});

describe('buildRegionalFrontsContext', () => {
    it('projects the new region with the arrival place profile and only ACTIVE existing fronts', () => {
        const context = buildRegionalFrontsContext(baseState());
        expect(context.newRegion).toEqual({
            name: 'The Harchwold',
            arrivedAt: 'Saltmarsh Landing',
            arrivalPlaceType: 'settlement',
            arrivalPlaceDanger: 'low',
        });
        expect(context.existingCampaignFronts.map(front => front.title)).toEqual(['The Tithe Collectors']);
        expect(context.existingCampaignFronts[0].faction).toBe('Grey Ledger');
    });

    it('degrades to null place profile when the arrival location has no registry record', () => {
        const state = baseState();
        state.locations = [];
        const context = buildRegionalFrontsContext(state);
        expect(context.newRegion.arrivalPlaceType).toBeNull();
        expect(context.newRegion.arrivalPlaceDanger).toBeNull();
    });

    it('filters hidden messages and finished quests out of the projected context', () => {
        const context = buildRegionalFrontsContext(baseState());
        expect(context.recentNarrationInThisRegion.some(message => message.content.includes('Hidden line'))).toBe(false);
        expect(context.activeQuests.map(quest => quest.name)).toEqual(['Find the ledger']);
    });
});

describe('generateRegionalFronts', () => {
    it('throws when no new region is awaiting seeding', async () => {
        const state = baseState();
        state.session.pendingRegionalFronts = null;
        await expect(generateRegionalFronts(state)).rejects.toThrow('No new region');
        expect(sendMessageMock).not.toHaveBeenCalled();
    });

    it('extracts and sanitizes native pressures from a chatty response', async () => {
        sendMessageMock.mockResolvedValue(`The Harchwold's own troubles:\n${JSON.stringify({ aftermath_fronts: [proposal()] })}`);
        const result = await generateRegionalFronts(baseState());
        expect(result).toHaveLength(1);
        expect(result[0].title).toBe('The Brine Compact');
    });

    it('repairs a trailing-comma response instead of failing it', async () => {
        const broken = JSON.stringify({ aftermath_fronts: [proposal()] }).replace(']}', '],}');
        sendMessageMock.mockResolvedValue(broken);
        const result = await generateRegionalFronts(baseState());
        expect(result).toHaveLength(1);
    });

    it('throws when the response has no aftermath_fronts JSON at all', async () => {
        sendMessageMock.mockResolvedValue('A peaceful land, prose only.');
        await expect(generateRegionalFronts(baseState())).rejects.toThrow('did not contain aftermath_fronts');
    });

    it('degrades an unclosed truncation to an install-nothing empty list', async () => {
        // Same shared repair path as frontAftermath: braces closed, goal-less
        // fragment dropped by sanitation — truncation installs nothing.
        sendMessageMock.mockResolvedValue('{"aftermath_fronts": [{"title": "Broken');
        await expect(generateRegionalFronts(baseState())).resolves.toEqual([]);
    });

    it('throws when the JSON is malformed beyond repair', async () => {
        sendMessageMock.mockResolvedValue('{"aftermath_fronts": oops}');
        await expect(generateRegionalFronts(baseState())).rejects.toThrow('malformed');
    });
});
