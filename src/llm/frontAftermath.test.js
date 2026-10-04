/**
 * Front aftermath (2026-08-18 audit: the only living-world llm module besides
 * regionalFronts with no suite at all): generation gating, context projection,
 * proposal sanitation, and the malformed-response paths of the one-shot
 * post-resolution director call.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { sendMessageMock } = vi.hoisted(() => ({ sendMessageMock: vi.fn() }));
vi.mock('./adapter.js', () => ({ sendMessage: sendMessageMock }));

const {
    buildFrontAftermathContext,
    generateFrontAftermath,
    sanitizeAftermathProposals,
    shouldGenerateFrontAftermath,
} = await import('./frontAftermath.js');

const baseState = () => ({
    session: {
        id: 'campaign-1',
        premise: 'A drowned delta ruled by toll-weirs.',
        pendingFrontAftermath: { frontId: 'front-tithe', title: 'The Tithe Collectors' },
    },
    settings: { apiKey: 'k', llmProvider: 'gemini', model: 'gemini-3.1-pro-preview' },
    combat: { active: false },
    character: { name: 'Rauha', race: 'human', class: 'cleric', level: 4 },
    fronts: [
        {
            id: 'front-tithe', title: 'The Tithe Collectors', status: 'resolved',
            resolution: 'The hero burned the tithe-barge fleet at anchor.',
            goal: 'Squeeze the river trade', stakes: 'Every weir pays or drowns',
            grimPortents: ['Barges mass at the estuary', 'The toll doubles', 'A village is made an example'],
            stage: 1, publicHints: ['Barge lanterns on the night river'],
            notes: 'Broken by the fire at the anchorage.',
            faction: {
                name: 'Grey Ledger', goal: 'Own every debt in the valley',
                stance: 'Hates the hero', relationships: ['Feuds with the weir-guild'],
            },
        },
        { id: 'front-mold', title: 'The Weeping Mold', status: 'active', faction: { name: 'The Mold' } },
        { id: 'front-old', title: 'A Resolved Elder', status: 'resolved' },
    ],
    worldFacts: [{ fact: 'The anchorage burned', category: 'event' }],
    journal: [{ title: 'Ch 9', summary: 'The fleet burned and the collectors scattered.' }],
    quests: [
        { name: 'Settle the ledger', description: 'Find the surviving clerks', status: 'active' },
        { name: 'Old errand', description: 'Done long ago', status: 'completed' },
    ],
    npcs: [{ name: 'Marta', disposition: 'friendly', goals: 'Reopen the ferry', agenda: '', lastLocation: 'Aldermill' }],
    party: [{ name: 'Ox', role: 'porter' }],
    messages: [
        { role: 'user', content: 'I put the torch to the last barge.' },
        { role: 'assistant', content: 'The anchorage goes up like a festival lantern.' },
        { role: 'assistant', content: 'Hidden setup line.', hidden: true },
        { role: 'system', content: 'System line that must not reach the director.' },
    ],
});

const proposal = (extra = {}) => ({
    title: 'The Vacant Anchorage',
    goal: 'Claim the burned toll rights',
    stakes: 'A new hand on the river trade',
    grimPortents: ['Salvagers stake claims', 'A muscle crew arrives', 'The tolls are sold twice'],
    faction: { name: 'The Salvage Ring', goal: 'Own the wrecks', stance: 'Indifferent', relationships: ['Buys from the weir-guild'] },
    reason: 'The burned fleet leaves the tolls unclaimed.',
    ...extra,
});

beforeEach(() => {
    sendMessageMock.mockReset();
});

describe('shouldGenerateFrontAftermath', () => {
    it('requires the pending marker, a session id, an api key, and no active combat', () => {
        const state = baseState();
        expect(shouldGenerateFrontAftermath(state)).toBe(true);
        expect(shouldGenerateFrontAftermath({ ...state, session: { ...state.session, pendingFrontAftermath: null } })).toBe(false);
        expect(shouldGenerateFrontAftermath({ ...state, session: { ...state.session, id: null } })).toBe(false);
        expect(shouldGenerateFrontAftermath({ ...state, settings: { apiKey: '' } })).toBe(false);
        expect(shouldGenerateFrontAftermath({ ...state, combat: { active: true } })).toBe(false);
        expect(shouldGenerateFrontAftermath(null)).toBe(false);
    });
});

describe('buildFrontAftermathContext', () => {
    it('projects the resolved front with its resolution and only the remaining ACTIVE fronts', () => {
        const context = buildFrontAftermathContext(baseState());
        expect(context.resolvedFront.title).toBe('The Tithe Collectors');
        expect(context.resolvedFront.resolution).toContain('burned the tithe-barge fleet');
        expect(context.resolvedFront.faction.name).toBe('Grey Ledger');
        // The resolved front itself and the other resolved elder are excluded.
        expect(context.remainingActiveFronts.map(front => front.title)).toEqual(['The Weeping Mold']);
    });

    it('falls back to the pending title when the resolved front record is gone', () => {
        const state = baseState();
        state.fronts = [];
        const context = buildFrontAftermathContext(state);
        expect(context.resolvedFront).toEqual({ title: 'The Tithe Collectors' });
    });

    it('drops hidden and system messages from recent events and filters finished quests', () => {
        const context = buildFrontAftermathContext(baseState());
        const contents = context.recentEvents.map(message => message.content);
        expect(contents).toContain('I put the torch to the last barge.');
        expect(contents.some(content => content.includes('Hidden setup'))).toBe(false);
        expect(contents.some(content => content.includes('System line'))).toBe(false);
        expect(context.activeQuests.map(quest => quest.name)).toEqual(['Settle the ledger']);
    });
});

describe('sanitizeAftermathProposals', () => {
    it('caps at two proposals and holds the ENGINE\'s gate — the one the installer re-validates with (2026-10-03 audit)', () => {
        const result = sanitizeAftermathProposals([
            proposal(),
            proposal({ title: 'Second Successor', faction: { name: 'The Other Ring', goal: 'Own the docks' } }),
            proposal({ title: 'Third — past the cap', faction: { name: 'A Third Ring', goal: 'Own the rest' } }),
        ]);
        expect(result).toHaveLength(2);
        // The shaper used to pass anything with a title and a goal; every one
        // of these would then be refused by INSTALL_AFTERMATH_FRONTS while the
        // log said "1 successor pressure(s) proposed".
        for (const weak of [
            { title: '' }, { goal: '' }, { stakes: '' },
            { grimPortents: ['only', 'two'] },
            { faction: 'The Salvage Ring' },
            { faction: { name: 'The Salvage Ring' } },
        ]) {
            expect(sanitizeAftermathProposals([proposal(weak)]), JSON.stringify(weak)).toEqual([]);
        }
        // One faction cannot drive both successors, nor one title name two.
        expect(sanitizeAftermathProposals([proposal(), proposal({ title: 'Same Faction Again' })])).toHaveLength(1);
        expect(sanitizeAftermathProposals([proposal(), proposal({ faction: { name: 'Another Ring', goal: 'x' } })])).toHaveLength(1);
    });

    it('clamps fields, accepts snake_case grim_portents, and carries the rationale as private notes', () => {
        const [front] = sanitizeAftermathProposals([proposal({
            title: 'x'.repeat(300),
            grimPortents: undefined,
            grim_portents: ['One', '', 'Two', 'Three', 'Four', 'Five', 'Six — past the cap'],
        })]);
        expect(front.title).toHaveLength(90);
        expect(front.grimPortents).toEqual(['One', 'Two', 'Three', 'Four', 'Five']);
        expect(front.notes).toBe('The burned fleet leaves the tolls unclaimed.');
        expect(front).toMatchObject({ clock: 0, stage: 0, status: 'active' });
    });

    it('what it shapes, the installer accepts: a shaped proposal re-validates to the same front', async () => {
        const { normalizeFrontProposal } = await import('../engine/fronts.js');
        const [shaped] = sanitizeAftermathProposals([proposal()]);
        const installed = normalizeFrontProposal(shaped, { existing: [], id: 'front-aftermath-1' });
        expect(installed).toMatchObject({ title: shaped.title, goal: shaped.goal, stakes: shaped.stakes, grimPortents: shaped.grimPortents, notes: shaped.notes });
        expect(installed.faction).toEqual(shaped.faction);
    });

    it('degrades junk to an empty list', () => {
        expect(sanitizeAftermathProposals(null)).toEqual([]);
        expect(sanitizeAftermathProposals('no')).toEqual([]);
        expect(sanitizeAftermathProposals([null, 42])).toEqual([]);
    });
});

describe('generateFrontAftermath', () => {
    it('throws when no resolved front is awaiting aftermath', async () => {
        const state = baseState();
        state.session.pendingFrontAftermath = null;
        await expect(generateFrontAftermath(state)).rejects.toThrow('No resolved front');
        expect(sendMessageMock).not.toHaveBeenCalled();
    });

    it('extracts and sanitizes proposals from a chatty response', async () => {
        sendMessageMock.mockResolvedValue(`Here is what the victory leaves behind:\n${JSON.stringify({ aftermath_fronts: [proposal()] })}\nGood luck.`);
        const result = await generateFrontAftermath(baseState());
        expect(result).toHaveLength(1);
        expect(result[0].title).toBe('The Vacant Anchorage');
    });

    it('treats an empty list as a first-class clean victory', async () => {
        sendMessageMock.mockResolvedValue('{"aftermath_fronts": []}');
        await expect(generateFrontAftermath(baseState())).resolves.toEqual([]);
    });

    it('repairs a trailing-comma response instead of failing it', async () => {
        const broken = JSON.stringify({ aftermath_fronts: [proposal()] }).replace(']}', '],}');
        sendMessageMock.mockResolvedValue(broken);
        const result = await generateFrontAftermath(baseState());
        expect(result).toHaveLength(1);
    });

    it('throws when the response has no aftermath_fronts JSON at all', async () => {
        sendMessageMock.mockResolvedValue('The world moves on, prose only.');
        await expect(generateFrontAftermath(baseState())).rejects.toThrow('did not contain aftermath_fronts');
    });

    it('degrades an unclosed truncation to an install-nothing empty list', async () => {
        // repairJson closes the dangling braces; the goal-less fragment is then
        // dropped by sanitation — truncation never installs a half-built front.
        sendMessageMock.mockResolvedValue('{"aftermath_fronts": [{"title": "Broken');
        await expect(generateFrontAftermath(baseState())).resolves.toEqual([]);
    });

    it('throws when the JSON is malformed beyond repair', async () => {
        sendMessageMock.mockResolvedValue('{"aftermath_fronts": oops}');
        await expect(generateFrontAftermath(baseState())).rejects.toThrow('malformed');
    });
});
