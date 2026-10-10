/**
 * The 2026-10-10 strengthening sweep's Scribe pins: one context assembler for
 * both callers (the combat beat's narrative-only assembly included), the
 * parse anchors cover every top-level schema key the three prompts declare,
 * and the gear-handoff audit resolves a companion through the roster's own
 * name ladder.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
    SCRIBE_ANCHORS,
    SCRIBE_SYSTEM_PROMPT,
    buildKnownAppearances,
    buildKnownHeroTells,
    buildKnownLocations,
    buildKnownOpenPlans,
    buildKnownStances,
    buildKnownStoryCards,
    buildScribeContext,
    runScribe,
} from './scribe.js';
import { CAST_AUDIT_RULES, LOOT_AUDIT_RULES } from './scribeAudits.js';
import { sendMessage } from './adapter.js';

vi.mock('./adapter.js', () => ({ sendMessage: vi.fn() }));

const state = {
    character: { name: 'Vesa', appearance: 'a scarred woman with cropped grey hair' },
    npcs: [
        { name: 'Mira', appearance: 'a wiry smith, soot in every crease', stanceToPlayer: 'Owes the hero a warning and knows it.', bondMoments: [] },
        { name: 'Tammo', appearance: 'a broad ferryman', stanceToPlayer: 'Keeps the hero at arm\'s length.', bondMoments: [] },
    ],
    storyMemory: [{ id: 'card-1', type: 'promise', status: 'active', subject: 'Mira\'s blue ribbon', text: 'Mira promised a blue ribbon on the well road if it turned unsafe.', linkedNpcNames: ['Mira'] }],
    worldFacts: [{ id: 'f-1', fact: 'The baron plans to seize the mill at the new moon.', aspect: 'intent', atMessage: 4 }],
    heroTells: [{ id: 'tell-1', kind: 'habit', text: 'Lights a pipe before answering a hard question.', sightings: [] }],
    locations: [{ name: 'Rimehollow', lastVisitedAt: 5 }],
};

describe('buildScribeContext (scribe P2, 2026-10-10)', () => {
    it('is the six builders with the same arguments, under the names runScribe reads', () => {
        const texts = ['I ask Mira about the ribbon.', 'Mira wipes her hands. "Not yet," she says.'];
        const context = buildScribeContext(state, ...texts);
        expect(Object.keys(context).sort()).toEqual([
            'knownAppearances', 'knownHeroTells', 'knownLocations', 'knownOpenPlans', 'knownStances', 'knownStoryCards',
        ]);
        expect(context).toEqual({
            knownAppearances: buildKnownAppearances(state, ...texts),
            knownStances: buildKnownStances(state, ...texts),
            knownStoryCards: buildKnownStoryCards(state, ...texts),
            knownOpenPlans: buildKnownOpenPlans(state),
            knownHeroTells: buildKnownHeroTells(state),
            knownLocations: buildKnownLocations(state),
        });
        expect(context.knownAppearances).toContain('Mira');
        expect(context.knownAppearances).not.toContain('Tammo');
        expect(context.knownStoryCards).toContain('card-1');
    });

    it('the combat beat\'s assembly: narrative only, presence judged from that one text', () => {
        const beat = buildScribeContext(state, 'Tammo drags the last bandit off the ferry deck.');
        expect(beat.knownAppearances).toContain('Tammo');
        expect(beat.knownAppearances).not.toContain('Mira');
        expect(beat.knownStances).toContain('Tammo');
        expect(beat.knownStoryCards).toBeNull();
        expect(beat.knownOpenPlans).toContain('f-1');
        expect(beat.knownHeroTells).toContain('tell-1');
        expect(beat.knownLocations).toBe('Rimehollow');
    });

    it('feeds runScribe by spread — the request carries every block the context filled', async () => {
        sendMessage.mockReset();
        sendMessage.mockResolvedValue(JSON.stringify({ world_facts: [] }));
        await runScribe({
            playerMessage: 'I ask Mira about the ribbon.',
            dmNarrative: 'Mira wipes her hands. "Not yet," she says.',
            settings: { apiKey: 'test-key', llmProvider: 'gemini' },
            dispatch: vi.fn(),
            ...buildScribeContext(state, 'I ask Mira about the ribbon.', 'Mira wipes her hands. "Not yet," she says.'),
        });
        const request = sendMessage.mock.calls[0][0].userMessage;
        for (const block of ['KNOWN APPEARANCES', 'KNOWN PLAYER-RELATIONSHIP STANCES', 'KNOWN STORY CARDS', 'KNOWN OPEN PLANS', 'KNOWN HERO TELLS', 'KNOWN PLACES']) {
            expect(request).toContain(block);
        }
    });
});

describe('the parse anchors cover the schema (scribe P2, 2026-10-10)', () => {
    const prompts = SCRIBE_SYSTEM_PROMPT + LOOT_AUDIT_RULES + CAST_AUDIT_RULES;
    // Every top-level key the three prompts declare as JSON: a line that opens
    // with `"key":` at column 0 or 2, or the audit rules' bare `"key": {` /
    // `"key": [` declarations.
    const declared = [...new Set([...prompts.matchAll(/^ {0,2}"([a-z_]+)":/gm)].map(m => m[1]))];

    it('every declared top-level key is an anchor, and every anchor is declared', () => {
        expect(declared.length).toBeGreaterThanOrEqual(12);
        for (const key of declared) expect(SCRIBE_ANCHORS, key).toContain(key);
        for (const anchor of SCRIBE_ANCHORS) expect(declared, anchor).toContain(anchor);
    });

    it('the gear-handoff key is among them (the 10-10 gap)', () => {
        expect(SCRIBE_ANCHORS).toContain('missing_gear_handoffs');
        expect(declared).toContain('missing_gear_handoffs');
    });
});

describe('the gear-handoff audit resolves a companion through namesMatch (scribe P2, 2026-10-10)', () => {
    beforeEach(() => sendMessage.mockReset());

    const party = [
        { id: 'marn', name: 'Old Marn', status: 'healthy', ac: 12, weapon: 'Club' },
        { id: 'hesk', name: 'Old Hesk', status: 'healthy', ac: 12, weapon: 'Club' },
        { id: 'tammi', name: 'Kaarina Tammi', status: 'healthy', ac: 12, weapon: 'Dagger' },
        { id: 'odo', name: 'Brother Odo', status: 'healthy', ac: 11, weapon: 'Staff' },
    ];
    const auditState = () => ({ party, inventory: [], appliedLootSourceIds: [] });
    const extraction = handoffs => JSON.stringify({ world_facts: [], missing_gear_handoffs: handoffs });

    async function routed(handoffs) {
        sendMessage.mockResolvedValue(extraction(handoffs));
        const dispatch = vi.fn();
        await runScribe({
            playerMessage: 'Take it.',
            dmNarrative: 'The weapon changes hands.',
            settings: { apiKey: 'test-key', llmProvider: 'gemini' },
            dispatch,
            lootAudit: { sourceId: 'msg-1:scribe-loot', appliedEvents: null, getState: auditState },
        });
        return dispatch.mock.calls
            .filter(([action]) => action.type === 'UPDATE_COMPANION')
            .map(([action]) => action.payload.id);
    }

    it('a shared title never hands gear to the wrong companion: "Old Hesk" is Hesk, not Marn', async () => {
        expect(await routed([{ companion: 'Old Hesk', item: 'Boarding Axe', kind: 'weapon' }])).toEqual(['hesk']);
    });

    it('a surname alone and a title-stripped name both find their companion', async () => {
        expect(await routed([{ companion: 'Tammi', item: 'Boarding Axe', kind: 'weapon' }])).toEqual(['tammi']);
        expect(await routed([{ companion: 'Odo', item: 'Boarding Axe', kind: 'weapon' }])).toEqual(['odo']);
    });

    it('a name nobody carries routes nothing', async () => {
        expect(await routed([{ companion: 'Old', item: 'Boarding Axe', kind: 'weapon' }])).toEqual([]);
    });
});
