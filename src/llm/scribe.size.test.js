/**
 * Byte ceilings and prefix properties of the two machinery prompts the Scribe
 * lane sends (2026-09-28 audit, scribe Lap 3 — performance & token budget).
 *
 * The earlier pins certified half the true ceiling: the reflection NPC test
 * used a fixture UNDER projectNpcForReflection's own caps (12 records AT the
 * caps measured 55.8k against a "< 30,000" pin on an under-cap fixture), and
 * nothing pinned the whole reflection context, the Scribe user message, or
 * the Scribe system prompt's shared-prefix property. Every fixture here sits
 * AT the caps; every ceiling is the measured worst case plus headroom.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
    JOURNAL_SUMMARY_REFLECTION_MAX,
    REFLECTION_PREMISE_MAX,
    buildKnownAppearances,
    buildKnownHeroTells,
    buildKnownLocations,
    buildKnownOpenPlans, buildKnownStances,
    buildKnownStoryCards,
    projectJournalForReflection,
    runNpcFrontReflection,
    runScribe,
} from './scribe.js';
import { sendMessage } from './adapter.js';

vi.mock('./adapter.js', () => ({ sendMessage: vi.fn() }));

const SETTINGS = { apiKey: 'test-key', llmProvider: 'gemini' };
const pad = (label, n, ch = 'x') => `${label} `.padEnd(n, ch);

// --- fixtures AT the caps ---
const NPC_NAMES = ['Aune Vesterinen', 'Orsa Pellwyn', 'Tammo Kerrick', 'Maren Holt', 'Odo Ferrin', 'Saima Aallotar', 'Brannock Tull', 'Ilse Varga', 'Pelle Ruud', 'Hesk Dorran', 'Wren Calloway', 'Jorund Pike'];
const maxNpc = (name, i) => ({
    id: `npc-${i}`,
    name,
    rosterTier: 'character',
    gender: 'woman',
    species: 'human',
    disposition: 'wary',
    personality: pad('personality', 600),
    goals: pad('goals', 600),
    secrets: pad('secrets', 600),
    agenda: pad('agenda', 600),
    relationshipTension: pad('tension', 600),
    stanceToPlayer: pad('stance', 600),
    lastNotes: pad('notes', 600),
    appearance: pad('appearance', 600),
    openThread: pad('thread', 200),
    callbackHooks: Array.from({ length: 5 }, (_, j) => pad(`hook ${j}`, 200)),
    recentImpressions: Array.from({ length: 6 }, (_, j) => ({ field: 'stanceToPlayer', text: pad(`impression ${j}`, 140), atMessage: 40 + j })),
    bondMoments: Array.from({ length: 10 }, (_, j) => ({ text: pad(`moment ${j}`, 240), at: j, kind: ['promise', 'rescue', 'confession', 'intimacy', 'quarrel'][j % 5], salience: 4 })),
    relationshipHistory: Array.from({ length: 20 }, () => ({ from: 'wary', to: 'hostile' })),
    knownFacts: Array.from({ length: 30 }, (_, j) => pad(`fact ${j}`, 200)),
    basedIn: pad('based', 120),
    lastLocation: pad('last', 120),
    portraitUrl: 'data:image/jpeg;base64,' + 'A'.repeat(60000),
});
const maxJournal = (i) => ({
    id: `journal-${i}`,
    timestamp: 1700000000000 + i,
    messageRange: [i * 10, i * 10 + 9],
    location: pad('place', 120),
    summary: pad(`summary ${i}`, 2000),
    keyDecisions: Array.from({ length: 8 }, (_, j) => pad(`decision ${j}`, 300)),
    consequences: Array.from({ length: 8 }, (_, j) => pad(`consequence ${j}`, 300)),
    facts: Array.from({ length: 5 }, (_, j) => pad(`fact ${j}`, 200)),
});
const maxFront = (id, status) => ({
    id, status,
    title: pad('Pressure', 100),
    goal: pad('goal', 300), stakes: pad('stakes', 300),
    grimPortents: Array.from({ length: 6 }, (_, j) => pad(`portent ${j}`, 240)),
    publicHints: Array.from({ length: 6 }, (_, j) => pad(`hint ${j}`, 240)),
    notes: pad('notes', 500), stage: 2, clock: 3, maxClock: 8,
    faction: { name: 'The Tallow Guild', goal: pad('fgoal', 300), stance: pad('fstance', 200) },
});
const maxCard = (i, npcName) => ({
    id: `card-${i}`, type: 'promise', status: 'active', subject: npcName,
    text: pad(`card ${i} about ${npcName}`, 260), linkedNpcNames: [npcName], salience: 4,
});
const maxTell = (i) => ({
    id: `tell-${i}`, kind: 'manner', text: pad(`tell ${i}`, 240),
    sightings: Array.from({ length: 5 }, (_, j) => ({ atMessage: j * 20 })),
    witnesses: NPC_NAMES.slice(0, 4), lastSeenMessage: 100 + i,
});

describe('reflection context — whole-context ceiling with fixtures AT the caps', () => {
    beforeEach(() => sendMessage.mockReset());

    it('projects journal rows: summary + location + 3 decisions + 3 consequences, no stamps, fallback rows dropped', () => {
        const projected = projectJournalForReflection(maxJournal(1));
        expect(Object.keys(projected).sort()).toEqual(['consequences', 'keyDecisions', 'location', 'summary']);
        expect(projected.summary).toHaveLength(JOURNAL_SUMMARY_REFLECTION_MAX);
        expect(projected.keyDecisions).toHaveLength(3);
        expect(projected.consequences).toHaveLength(3);
        expect(projectJournalForReflection({ ...maxJournal(2), fallback: true })).toBeNull();
        expect(projectJournalForReflection(null)).toBeNull();
        expect(projectJournalForReflection({ summary: 42 })).toBeNull();
    });

    it('ships a bounded context: 12 NPCs, 3 fronts + a dormant stub, 3 journal rows, the premise clamped, the cadence not repeating the newest row', async () => {
        sendMessage.mockResolvedValue(JSON.stringify({ npc_updates: [], front_advances: [], story_memory: [] }));
        const journal = [maxJournal(1), maxJournal(2), maxJournal(3)];
        const newest = journal[2];
        await runNpcFrontReflection({
            state: {
                settings: SETTINGS,
                session: { id: 'campaign', premise: pad('premise', 8000) },
                fronts: [maxFront('front-a', 'active'), maxFront('front-b', 'active'), maxFront('front-c', 'active'), maxFront('front-d', 'dormant'),
                    ...Array.from({ length: 20 }, (_, i) => maxFront(`front-done-${i}`, 'resolved'))],
                npcs: NPC_NAMES.map(maxNpc),
                journal,
                worldFacts: Array.from({ length: 30 }, (_, i) => ({ id: `wf-${i}`, fact: pad(`fact ${i}`, 300) })),
                party: [],
                recentEncounters: Array.from({ length: 10 }, (_, i) => ({ id: `enc-${i}`, summary: pad(`fight ${i}`, 200), foeFamilies: ['wolf'] })),
                locations: Array.from({ length: 30 }, (_, i) => ({ name: pad(`place ${i}`, 120), type: 'settlement', danger: 'low', theaterFrontIds: ['front-a'] })),
                currentLocation: pad('here', 200),
            },
            dispatch: vi.fn(),
            cadence: {
                id: 'journal-campaign-40', journalEnd: 40,
                summary: newest.summary, keyDecisions: newest.keyDecisions, consequences: newest.consequences,
            },
        });
        const payload = sendMessage.mock.calls[0][0].userMessage;
        const context = JSON.parse(payload);
        expect(context.premise).toHaveLength(REFLECTION_PREMISE_MAX);
        expect(context.recentJournal).toHaveLength(3);
        for (const row of context.recentJournal) {
            expect(Object.keys(row).sort()).toEqual(['consequences', 'keyDecisions', 'location', 'summary']);
        }
        // The cadence's summary IS the newest journal row: its lists ride there once.
        expect(context.cadence).toEqual({ id: 'journal-campaign-40', journalEnd: 40, latestSummary: expect.any(String) });
        expect(context.cadence.latestSummary).toHaveLength(JOURNAL_SUMMARY_REFLECTION_MAX);
        expect(context.npcs).toHaveLength(12);
        expect(payload).not.toContain('base64');
        // 12 NPCs AT the projection caps measure 55,831 (the bulk — the next
        // lever if the reflection ever needs to shrink again); the whole
        // context measured 85,044 after the journal / premise / cadence
        // projection (was 116,653 with the raw rows and the 8k premise).
        expect(JSON.stringify(context.npcs).length).toBeLessThan(60000);
        expect(payload.length).toBeLessThan(90000);
    });

    it('keeps the cadence\'s own lists when its summary is NOT yet a journal row', async () => {
        sendMessage.mockResolvedValue(JSON.stringify({ npc_updates: [], front_advances: [], story_memory: [] }));
        await runNpcFrontReflection({
            state: { settings: SETTINGS, session: { id: 'campaign' }, fronts: [{ id: 'front-a', status: 'active' }], npcs: [], journal: [maxJournal(1)], worldFacts: [], party: [] },
            dispatch: vi.fn(),
            cadence: { id: 'journal-campaign-20', journalEnd: 20, summary: 'Fresh summary.', keyDecisions: ['d1', 'd2', 'd3', 'd4'], consequences: [42, 'c1'] },
        });
        const context = JSON.parse(sendMessage.mock.calls[0][0].userMessage);
        expect(context.cadence).toEqual({ id: 'journal-campaign-20', journalEnd: 20, latestSummary: 'Fresh summary.', keyDecisions: ['d1', 'd2', 'd3'], consequences: ['c1'] });
        expect(context.premise).toBeUndefined();
    });
});

describe('the Scribe user message — KNOWN blocks at their caps', () => {
    beforeEach(() => sendMessage.mockReset());

    const present = NPC_NAMES.slice(0, 8);
    const turnText = `I greet ${present.join(', ')} at the quay.`;
    const state = {
        character: { name: 'Astra', appearance: pad('hero look', 600), gender: 'woman', species: 'human' },
        npcs: NPC_NAMES.map(maxNpc),
        storyMemory: Array.from({ length: 30 }, (_, i) => maxCard(i, present[i % present.length])),
        heroTells: Array.from({ length: 24 }, (_, i) => maxTell(i)),
        locations: Array.from({ length: 30 }, (_, i) => ({ name: pad(`place ${i}`, 120), lastVisitedAt: i })),
    };

    it('KNOWN STANCES states each rule ONCE in a header and renders every NPC as data lines', () => {
        const block = buildKnownStances(state, turnText);
        const count = needle => block.split(needle).length - 1;
        expect(count('open thread on record')).toBe(1);
        expect(count('recent impressions (unconfirmed')).toBe(1);
        expect(count('do NOT re-report or paraphrase')).toBe(1);
        expect(block.startsWith('Rules: ')).toBe(true);
        for (const name of present) {
            expect(block).toContain(`${name}: `);
            expect(block).toContain(`${name} — thread: "`);
            expect(block).toContain('| impressions: "');
            expect(block).toContain('| moments: "');
        }
        // 8 present NPCs at the caps: 14,233 chars with the rules on every
        // entry; the header form measured under 11k.
        expect(block.length).toBeLessThan(12000);
    });

    it('a stance block with no thread / impressions / moments carries no rules header', () => {
        const block = buildKnownStances({ npcs: [{ name: 'Maren', stanceToPlayer: 'Warm.' }] }, 'Maren waves.');
        expect(block).toBe('Maren: Warm.');
    });

    it('the whole Scribe user message stays under its ceiling at 8 NPCs / 10 cards / 12 tells, and the system prompt is one shared prefix across the audit variants', async () => {
        sendMessage.mockResolvedValue(JSON.stringify({ world_facts: [] }));
        const known = {
            knownAppearances: buildKnownAppearances(state, turnText),
            knownStances: buildKnownStances(state, turnText),
            knownStoryCards: buildKnownStoryCards(state, turnText),
            knownOpenPlans: buildKnownOpenPlans(state),
            knownHeroTells: buildKnownHeroTells(state),
            knownLocations: buildKnownLocations(state),
        };
        const auditState = {
            character: { name: 'Astra', class: 'wizard', level: 5, gold: 3, silver: 2, copper: 1, knownSpells: [] },
            inventory: Array.from({ length: 40 }, (_, i) => ({ id: `i-${i}`, name: pad(`item ${i}`, 60), quantity: 3 })),
            party: Array.from({ length: 4 }, (_, i) => ({ id: `c-${i}`, name: present[i], weapon: 'Spear', ac: 14, keepsakes: ['a ring'] })),
            combat: { active: false },
        };
        const dmNarrative = pad('narrative', 4000);
        const playerMessage = pad(turnText, 2000);
        // Variant 1: no audit.
        await runScribe({ playerMessage, dmNarrative, settings: SETTINGS, dispatch: vi.fn(), ...known });
        // Variant 2: loot audit.
        await runScribe({
            playerMessage, dmNarrative, settings: SETTINGS, dispatch: vi.fn(), ...known,
            lootAudit: { getState: () => auditState, appliedEvents: { itemsFound: [], goldFound: 0 }, sourceId: 'msg-1' },
        });
        // Variant 3: loot + cast audit.
        await runScribe({
            playerMessage, dmNarrative, settings: SETTINGS, dispatch: vi.fn(), ...known,
            lootAudit: { getState: () => auditState, appliedEvents: { itemsFound: [], goldFound: 0, spellCasts: [] }, sourceId: 'msg-1', auditCasts: true },
        });
        expect(sendMessage).toHaveBeenCalledTimes(3);
        const calls = sendMessage.mock.calls.map(([args]) => args);
        const base = calls[0].systemPrompt;
        for (const call of calls) {
            // The cache-prefix contract: every variant EXTENDS the base prompt.
            expect(call.systemPrompt.startsWith(base)).toBe(true);
        }
        expect(calls[1].systemPrompt.length).toBeGreaterThan(base.length);
        expect(calls[2].systemPrompt.length).toBeGreaterThan(calls[1].systemPrompt.length);
        for (const call of calls) {
            expect(call.userMessage).not.toContain('base64');
            // Measured worst case after the KNOWN STANCES header form: under 40k
            // for the audited variants with a 4k narrative and 2k player line
            // (was 29,677 with the rules-per-entry block on a smaller fixture).
            expect(call.userMessage.length).toBeLessThan(45000);
        }
        expect(base.length).toBeLessThan(40000);
    });
});
