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
    buildRegionalPrompt,
    generateRegionalFronts,
    regionalCallWants,
    shouldGenerateRegionalFronts,
} = await import('./regionalFronts.js');

const baseState = () => ({
    session: {
        id: 'campaign-1',
        premise: 'A drowned delta ruled by toll-weirs.',
        pendingRegionalFronts: { region: 'The Harchwold', locationName: 'Saltmarsh Landing' },
    },
    settings: { apiKey: 'k', llmProvider: 'gemini', model: 'gemini-3.8-flash' },
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
    grimPortents: ['Pans change hands', 'A rival drowns', 'The salt road closes'],
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
        expect(result.fronts).toHaveLength(1);
        expect(result.fronts[0].title).toBe('The Brine Compact');
        // The face was asked for (no profile on record) and the reply carried none.
        expect(result.profile).toBeNull();
    });

    it('repairs a trailing-comma response instead of failing it', async () => {
        const broken = JSON.stringify({ aftermath_fronts: [proposal()] }).replace(']}', '],}');
        sendMessageMock.mockResolvedValue(broken);
        const result = await generateRegionalFronts(baseState());
        expect(result.fronts).toHaveLength(1);
    });

    it('throws when the response has no aftermath_fronts JSON at all', async () => {
        sendMessageMock.mockResolvedValue('A peaceful land, prose only.');
        await expect(generateRegionalFronts(baseState())).rejects.toThrow('did not contain aftermath_fronts');
    });

    it('degrades an unclosed truncation to an install-nothing empty list', async () => {
        // Same shared repair path as frontAftermath: braces closed, goal-less
        // fragment dropped by sanitation — truncation installs nothing.
        sendMessageMock.mockResolvedValue('{"aftermath_fronts": [{"title": "Broken');
        await expect(generateRegionalFronts(baseState())).resolves.toEqual({ fronts: [], profile: null });
    });

    it('throws when the JSON is malformed beyond repair', async () => {
        sendMessageMock.mockResolvedValue('{"aftermath_fronts": oops}');
        await expect(generateRegionalFronts(baseState())).rejects.toThrow('malformed');
    });
});

describe('the land\'s face (WOW 2026-10-26, slice 1)', () => {
    const profile = { terrain: 'Salt flats to a grey horizon', people: 'Salt-boilers and grudge-keepers', built: 'Brine-bleached boards', dread: 'Things that crawl up the pans at night', names: 'Harsh and short — Grell, Mott' };

    it('asks for the profile beside the fronts when the land has none on record, and types it from the reply', async () => {
        sendMessageMock.mockResolvedValue(JSON.stringify({ aftermath_fronts: [proposal()], region_profile: { ...profile, junk: 'x', terrain: 42 } }));
        const result = await generateRegionalFronts(baseState());
        expect(result.fronts).toHaveLength(1);
        // A number is not a face: the required terrain is missing → no profile.
        expect(result.profile).toBeNull();
        sendMessageMock.mockResolvedValue(JSON.stringify({ aftermath_fronts: [], region_profile: profile }));
        const typed = await generateRegionalFronts(baseState());
        expect(typed.profile).toEqual(profile);
        const system = sendMessageMock.mock.calls.at(-1)[0].systemPrompt;
        expect(system).toContain('"aftermath_fronts"');
        expect(system).toContain('"region_profile"');
        expect(system).toContain('CONTRAST IS MANDATORY');
        expect(system).toContain('and write the land\'s own face beside them');
    });

    it('a profileOnly marker asks for the face alone: no fronts schema, the profile anchor, an empty fronts list', async () => {
        const state = baseState();
        state.session.pendingRegionalFronts = { ...state.session.pendingRegionalFronts, profileOnly: true };
        sendMessageMock.mockResolvedValue(`Here:\n${JSON.stringify({ region_profile: profile })}`);
        const result = await generateRegionalFronts(state);
        expect(result).toEqual({ fronts: [], profile });
        const system = sendMessageMock.mock.calls.at(-1)[0].systemPrompt;
        expect(system).not.toContain('"aftermath_fronts"');
        expect(system).toContain('whose face this campaign has not yet written down');
        expect(regionalCallWants(state)).toEqual({ wantsFronts: false, wantsProfile: true });
        // A prose reply with no profile is "missing", like a fronts reply without its list.
        sendMessageMock.mockResolvedValue('A lovely land.');
        await expect(generateRegionalFronts(state)).rejects.toThrow('did not contain region_profile');
    });

    it('a land already on record asks for no profile; the contrast list carries every OTHER land\'s face, newest first', async () => {
        const state = baseState();
        state.regions = {
            'The Harchwold': { ...profile, atMessage: 5 },
            'The Riverlands': { ...profile, terrain: 'Reed and slow water', atMessage: 2 },
            'The Icebound Coast': { ...profile, terrain: 'Sea ice', atMessage: 9 },
        };
        const context = buildRegionalFrontsContext(state);
        expect(context.wants).toEqual({ wantsFronts: true, wantsProfile: false });
        expect(context.knownRegions.map(land => land.name)).toEqual(['The Icebound Coast', 'The Riverlands']);
        expect(context.knownRegions[0]).toEqual({ name: 'The Icebound Coast', ...profile, terrain: 'Sea ice' });
        expect(context).not.toHaveProperty('journal');
        sendMessageMock.mockResolvedValue(JSON.stringify({ aftermath_fronts: [proposal()], region_profile: { ...profile, terrain: 'An unasked rewrite' } }));
        const result = await generateRegionalFronts(state);
        expect(result.profile).toBeNull();
        expect(sendMessageMock.mock.calls.at(-1)[0].systemPrompt).not.toContain('"region_profile"');
    });

    it('buildRegionalPrompt composes the two schemas and rule sets by what the call wants', () => {
        const both = buildRegionalPrompt({ wantsFronts: true, wantsProfile: true });
        expect(both).toContain('"aftermath_fronts"');
        expect(both).toContain('"region_profile"');
        expect(both).toContain('FLAVOR DIVERGENCE IS MANDATORY');
        expect(both).toContain('CONTRAST IS MANDATORY');
        const faceOnly = buildRegionalPrompt({ wantsFronts: false, wantsProfile: true });
        expect(faceOnly).not.toContain('FLAVOR DIVERGENCE');
        expect(faceOnly).toContain('"dread"');
        expect(buildRegionalPrompt({ wantsFronts: true, wantsProfile: false })).not.toContain('CONTRAST IS MANDATORY');
    });
});

describe('the combined call after the 2026-10-27 audit', () => {
    const profile = { terrain: 'Salt flats to a grey horizon', people: 'Salt-boilers and grudge-keepers', built: 'Brine-bleached boards', dread: 'Things that crawl up the pans at night', names: 'Grell, Mott' };

    it('a reply carrying the face without the fronts list keeps the face — an empty seed, not a failure', async () => {
        sendMessageMock.mockResolvedValue(`The land:\n${JSON.stringify({ region_profile: profile })}`);
        const result = await generateRegionalFronts(baseState());
        expect(result).toEqual({ fronts: [], profile });
    });

    it('a face-only marker whose face landed meanwhile makes no DM-model call', async () => {
        sendMessageMock.mockClear();
        const state = baseState();
        state.session.pendingRegionalFronts = { ...state.session.pendingRegionalFronts, profileOnly: true };
        state.regions = { 'The Harchwold': { ...profile, atMessage: 3 } };
        await expect(generateRegionalFronts(state)).resolves.toEqual({ fronts: [], profile: null });
        expect(sendMessageMock).not.toHaveBeenCalled();
    });

    it('the contrast list folds the region by isSameRegion, not by case alone', () => {
        const state = baseState();
        state.regions = { Harchwold: { ...profile, atMessage: 5 }, 'The Riverlands': { ...profile, atMessage: 2 } };
        expect(buildRegionalFrontsContext(state).knownRegions.map(land => land.name)).toEqual(['The Riverlands']);
    });
});
