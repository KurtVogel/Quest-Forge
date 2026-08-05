/**
 * Absence drift: generation gating, context projection, proposal sanitation,
 * the WHILE YOU WERE AWAY prompt block, and the promptBuilder wiring smoke.
 */
import { describe, expect, it } from 'vitest';
import {
    ABSENCE_DRIFT_WINDOW_MESSAGES,
    buildAbsenceDriftContext,
    buildWhileYouWereAwayBlock,
    sanitizeAbsenceDrift,
    shouldGenerateAbsenceDrift,
} from './absenceDrift.js';
import { buildSystemPrompt } from './promptBuilder.js';

const msgs = n => Array.from({ length: n }, (_, i) => ({
    role: i % 2 ? 'assistant' : 'user',
    content: `m${i}`,
}));

const baseState = () => ({
    session: {
        id: 'campaign-1',
        premise: 'A quiet river town with debts.',
        pendingAbsenceDrift: {
            key: 'loc-aldermill|50',
            locationName: 'Aldermill',
            awayDistance: 40,
            returnMessage: 50,
        },
    },
    settings: { apiKey: 'k', llmProvider: 'gemini', model: 'gemini-3.1-pro-preview' },
    combat: { active: false },
    character: { name: 'Rauha', race: 'human', class: 'cleric', level: 4 },
    locations: [{
        id: 'loc-aldermill', name: 'Aldermill', aliases: [], type: 'settlement',
        danger: 'low', theaterFrontIds: ['front-tithe'],
    }],
    fronts: [{
        id: 'front-tithe', title: 'The Tithe Collectors', status: 'active',
        clock: 4, maxClock: 6, stage: 1,
        faction: { name: 'Grey Ledger', goal: 'Own every debt in the valley' },
        goal: 'Squeeze the river trade',
    }],
    npcs: [
        {
            name: 'Marta', role: 'innkeeper', lastLocation: 'Aldermill',
            agenda: 'Reopen the ferry', lastNotes: 'Worried about her brother',
            stanceToPlayer: 'Warm, owes the hero for the cellar rescue', bondMoments: ['Shared a late-night confession'],
        },
        { name: 'Ox', role: 'porter', lastLocation: 'Deep Fen' },
        { name: 'Old rat', rosterTier: 'archived_creature', lastLocation: 'Aldermill' },
    ],
    worldFacts: [{ fact: 'The ferry sank in spring', category: 'event' }],
    journal: [{ title: 'Ch 1', summary: 'The hero left town chasing raiders.' }],
    quests: [{ name: 'Find the ledger', description: 'Trace the debts', status: 'active' }],
});

describe('shouldGenerateAbsenceDrift', () => {
    it('requires a pending marker, session, key, and no combat', () => {
        const state = baseState();
        expect(shouldGenerateAbsenceDrift(state)).toBe(true);
        expect(shouldGenerateAbsenceDrift({ ...state, session: { ...state.session, pendingAbsenceDrift: null } })).toBe(false);
        expect(shouldGenerateAbsenceDrift({ ...state, session: { ...state.session, id: null } })).toBe(false);
        expect(shouldGenerateAbsenceDrift({ ...state, settings: { apiKey: '' } })).toBe(false);
        expect(shouldGenerateAbsenceDrift({ ...state, combat: { active: true } })).toBe(false);
    });
});

describe('buildAbsenceDriftContext', () => {
    it('projects only NPCs of the return place and flags bond-bearing ones as untouchable', () => {
        const context = buildAbsenceDriftContext(baseState());
        expect(context.returnedTo).toMatchObject({ name: 'Aldermill', type: 'settlement' });
        const names = context.npcsOfThisPlace.map(npc => npc.name);
        expect(names).toContain('Marta');
        expect(names).not.toContain('Ox'); // elsewhere
        expect(names).not.toContain('Old rat'); // archived creature
        expect(context.npcsOfThisPlace[0].hasPersonalHistoryWithHero).toBe(true);
    });

    it('supplies theater fronts with their live intensity band, never clocks', () => {
        const context = buildAbsenceDriftContext(baseState());
        expect(context.offScreenPressuresHoldingThisPlace).toHaveLength(1);
        const pressure = context.offScreenPressuresHoldingThisPlace[0];
        expect(pressure).toMatchObject({ front_id: 'front-tithe', faction: 'Grey Ledger', maximumIntensity: 'presence' });
        expect(pressure.clock).toBeUndefined();
        expect(pressure.stage).toBeUndefined();
    });
});

describe('sanitizeAbsenceDrift', () => {
    const npcs = [{ name: 'Marta' }, { name: 'Ox' }];

    it('keeps only known NPCs, clamps fields, and caps developments', () => {
        const drift = sanitizeAbsenceDrift({
            developments: [
                { npc: 'Marta', agenda: 'a'.repeat(500), lastNotes: 'Married the ferryman', visible: 'A ring on her hand' },
                { npc: 'Totally New Villain', lastNotes: 'Arrived in town' },
                { npc: 'Ox', lastNotes: 'Broke his arm hauling stone' },
                { npc: 'Marta', lastNotes: 'A third development past the cap' },
            ],
            world_fact: 'The ferry runs again',
            front_symptom: 'Grey Ledger men now sit at the toll bridge',
        }, { npcs });
        expect(drift.developments).toHaveLength(2);
        expect(drift.developments.map(dev => dev.name)).toEqual(['Marta', 'Ox']);
        expect(drift.developments[0].agenda).toHaveLength(300);
        expect(drift.worldFact).toBe('The ferry runs again');
        expect(drift.frontSymptom).toContain('toll bridge');
    });

    it('degrades junk to an empty, install-nothing proposal', () => {
        expect(sanitizeAbsenceDrift(null, { npcs })).toEqual({ developments: [], worldFact: '', frontSymptom: '' });
        expect(sanitizeAbsenceDrift({ developments: 'no' }, { npcs }).developments).toEqual([]);
    });
});

describe('buildWhileYouWereAwayBlock', () => {
    const drift = {
        locationName: 'Aldermill',
        arrivedAtMessage: 50,
        awayDistance: 40,
        developments: [{ name: 'Marta', visible: 'A wedding ring, and the inn smells of fresh timber' }],
        fact: 'The ferry runs again under a new pilot',
        frontSymptom: { frontId: 'front-tithe', maxIntensity: 'indirect', text: 'Toll receipts nailed to the notice board' },
    };

    it('renders developments, fact, and the bounded symptom while fresh and in place', () => {
        const block = buildWhileYouWereAwayBlock(drift, {
            currentLocation: 'Aldermill',
            messages: msgs(54),
            messageCount: 54,
        });
        expect(block).toContain('## WHILE YOU WERE AWAY — PRIVATE');
        expect(block).toContain('~20 scenes');
        expect(block).toContain('Marta: A wedding ring');
        expect(block).toContain('ferry runs again');
        expect(block).toContain('maximum intensity indirect');
        expect(block).toContain('never present them as events erupting on arrival');
    });

    it('goes silent away from the place, after the window, or with nothing installed', () => {
        expect(buildWhileYouWereAwayBlock(drift, {
            currentLocation: 'Deep Fen', messages: msgs(54), messageCount: 54,
        })).toBe('');
        const expired = 50 + ABSENCE_DRIFT_WINDOW_MESSAGES + 2;
        expect(buildWhileYouWereAwayBlock(drift, {
            currentLocation: 'Aldermill', messages: msgs(expired), messageCount: expired,
        })).toBe('');
        expect(buildWhileYouWereAwayBlock({ ...drift, developments: [], fact: '', frontSymptom: null }, {
            currentLocation: 'Aldermill', messages: msgs(54), messageCount: 54,
        })).toBe('');
        expect(buildWhileYouWereAwayBlock(null, { currentLocation: 'Aldermill', messageCount: 54 })).toBe('');
    });
});

describe('promptBuilder wiring', () => {
    it('injects both living-world blocks when fresh and in place', () => {
        const prompt = buildSystemPrompt({
            currentLocation: 'Aldermill',
            messages: msgs(4),
            messageCount: 4,
            regionalHearsay: {
                locationName: 'Aldermill',
                arrivedAtMessage: 2,
                items: [{ text: 'the hero cutting down river raiders at Mill Row', grade: 'secondhand' }],
            },
            absenceDrift: {
                locationName: 'Aldermill',
                arrivedAtMessage: 2,
                awayDistance: 36,
                developments: [{ name: 'Marta', visible: 'The inn has a new roof' }],
                fact: '',
                frontSymptom: null,
            },
        });
        expect(prompt).toContain('## WHILE YOU WERE AWAY — PRIVATE');
        expect(prompt).toContain('## REGIONAL HEARSAY — PRIVATE');
    });

    it('omits them entirely when absent', () => {
        const prompt = buildSystemPrompt({ currentLocation: 'Aldermill', messages: [], messageCount: 0 });
        expect(prompt).not.toContain('WHILE YOU WERE AWAY');
        expect(prompt).not.toContain('REGIONAL HEARSAY');
    });
});
