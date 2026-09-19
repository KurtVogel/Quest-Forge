/**
 * The wonder die through the reducer (WOW 2026-09-18): the journal-cadence
 * request tick, the OOC ask, the one-shot install (die + delay + residue card
 * + cooldown), and LOAD_GAME typing of the session fields.
 */
import { describe, expect, it } from 'vitest';
import { gameReducer, initialGameState } from './gameReducer.js';
import { WONDER_OPENING_MIN_MESSAGES, WONDER_WINDOW_MESSAGES } from '../engine/wonder.js';
import { scoreStoryMemory } from '../engine/storyMemory.js';

const msgs = n => Array.from({ length: n }, (_, i) => ({ id: `m${i}`, role: i % 2 ? 'assistant' : 'user', content: `m${i}`, timestamp: 1 }));

const HOOKS = [
    { register: 'person', title: 'The Countess of Vell', hook: 'A black carriage stops beside the wagon.', invitation: 'She offers supper at her manor.', fits: 'standalone' },
    { register: 'relic', title: 'The Beacon', hook: 'A green light pulses in the hill ruins.', invitation: 'It can be seen from the road each night.', fits: 'front:f1' },
];

const quiet = (n = 60, session = {}) => ({
    ...initialGameState,
    character: { ...initialGameState.character, name: 'Testa', currentHP: 12, maxHP: 12 },
    session: { ...initialGameState.session, id: 's1', ...session },
    settings: { ...initialGameState.settings, paceDial: 'standard' },
    messages: msgs(n),
    fronts: [{ id: 'f1', title: 'The Hollow Choir', status: 'active', clock: 1, maxClock: 6, stage: 0, grimPortents: ['a', 'b', 'c'], faction: { name: 'the Choir of Ash' } }],
});

const journalEntry = { id: 'j1', summary: 'A quiet stretch of road.', keyDecisions: [], consequences: [], messageRange: [0, 10] };

describe('the request tick', () => {
    it('ADD_JOURNAL_ENTRY raises pendingWonder after a real lull and leaves it alone otherwise', () => {
        const state = gameReducer(quiet(60), { type: 'ADD_JOURNAL_ENTRY', payload: journalEntry });
        expect(state.session.pendingWonder).toEqual({ key: 'wonder-60-lull', requestedAtMessage: 60, onDemand: false });
        const early = gameReducer(quiet(WONDER_OPENING_MIN_MESSAGES - 2), { type: 'ADD_JOURNAL_ENTRY', payload: journalEntry });
        expect(early.session.pendingWonder).toBeUndefined();
        const again = gameReducer(state, { type: 'ADD_JOURNAL_ENTRY', payload: { ...journalEntry, id: 'j2' } });
        expect(again.session.pendingWonder).toEqual(state.session.pendingWonder);
    });

    it('REQUEST_WONDER on demand asks even inside the cooldown, never in combat', () => {
        const state = gameReducer(quiet(30, { lastWonderMessage: 28 }), { type: 'REQUEST_WONDER', payload: { onDemand: true } });
        expect(state.session.pendingWonder).toEqual({ key: 'wonder-30-asked', requestedAtMessage: 30, onDemand: true });
        const fighting = { ...quiet(30), combat: { ...initialGameState.combat, active: true } };
        expect(gameReducer(fighting, { type: 'REQUEST_WONDER', payload: { onDemand: true } })).toBe(fighting);
    });
});

describe('INSTALL_WONDER — the residue card never out-runs the die (live playtest 2026-09-19)', () => {
    it('holds the residue out of the callback lane until after the wonder window, then lets it resurface', () => {
        const pending = gameReducer(quiet(60), { type: 'ADD_JOURNAL_ENTRY', payload: journalEntry });
        const installed = gameReducer(pending, { type: 'INSTALL_WONDER', payload: { sessionId: 's1', key: 'wonder-60-lull', hooks: [HOOKS[0]] } });
        const card = installed.storyMemory.find(c => (c.tags || []).includes('wonder'));
        expect(card).toBeTruthy();
        expect(card.lastUsedMessage).toBe(installed.session.wonder.openAtMessage + WONDER_WINDOW_MESSAGES);
        const scene = (count) => ({ query: 'the countess carriage supper manor', messages: msgs(count), messageCount: count });
        // Install turn, the delay scenes, and the whole window: invisible to the callback lane.
        expect(scoreStoryMemory(card, scene(61))).toBe(0);
        expect(scoreStoryMemory(card, scene(installed.session.wonder.openAtMessage + 2))).toBe(0);
        expect(scoreStoryMemory(card, scene(installed.session.wonder.openAtMessage + WONDER_WINDOW_MESSAGES))).toBe(0);
        // ...and back as residue once the cooldown after the window has passed.
        expect(scoreStoryMemory(card, scene(installed.session.wonder.openAtMessage + WONDER_WINDOW_MESSAGES + 12))).toBeGreaterThan(0);
    });

    it('an on-demand wonder (window open at once) holds the residue the same way', () => {
        const asked = gameReducer(quiet(30), { type: 'REQUEST_WONDER', payload: { onDemand: true } });
        const installed = gameReducer(asked, { type: 'INSTALL_WONDER', payload: { sessionId: 's1', key: 'wonder-30-asked', hooks: [HOOKS[0]] } });
        const card = installed.storyMemory.find(c => (c.tags || []).includes('wonder'));
        expect(card.lastUsedMessage).toBe(30 + WONDER_WINDOW_MESSAGES);
    });
});

describe('INSTALL_WONDER', () => {
    it('installs the chosen hook once, mints the residue card, stamps the cooldown, and clears the marker', () => {
        const pending = gameReducer(quiet(60), { type: 'ADD_JOURNAL_ENTRY', payload: journalEntry });
        const installed = gameReducer(pending, { type: 'INSTALL_WONDER', payload: { sessionId: 's1', key: 'wonder-60-lull', hooks: HOOKS } });
        const wonder = installed.session.wonder;
        expect(wonder).toBeTruthy();
        expect(['The Countess of Vell', 'The Beacon']).toContain(wonder.title);
        expect(wonder.key).toBe('wonder-60-lull');
        expect(wonder.chosenAtMessage).toBe(60);
        expect(wonder.openAtMessage).toBeGreaterThanOrEqual(60);
        expect(wonder.openAtMessage).toBeLessThanOrEqual(66);
        if (wonder.title === 'The Beacon') expect(wonder.fits).toBe('f1');
        expect(installed.session.pendingWonder).toBeNull();
        expect(installed.session.lastWonderMessage).toBe(60);
        const card = installed.storyMemory.find(c => c.tags?.includes('wonder'));
        expect(card).toMatchObject({ type: 'foreshadow', subject: wonder.title, salience: 4, firstSeenMessage: 60 });
        // No system line: private like every front.
        expect(installed.messages).toHaveLength(60);
        // A second landing of the same key is a no-op.
        expect(gameReducer(installed, { type: 'INSTALL_WONDER', payload: { sessionId: 's1', key: 'wonder-60-lull', hooks: HOOKS } })).toBe(installed);
    });

    it('rejects a wrong session or key and spends the request on an empty answer', () => {
        const pending = gameReducer(quiet(60), { type: 'ADD_JOURNAL_ENTRY', payload: journalEntry });
        expect(gameReducer(pending, { type: 'INSTALL_WONDER', payload: { sessionId: 'other', key: 'wonder-60-lull', hooks: HOOKS } })).toBe(pending);
        expect(gameReducer(pending, { type: 'INSTALL_WONDER', payload: { sessionId: 's1', key: 'stale', hooks: HOOKS } })).toBe(pending);
        const empty = gameReducer(pending, { type: 'INSTALL_WONDER', payload: { sessionId: 's1', key: 'wonder-60-lull', hooks: [null, { register: 'dragon' }] } });
        expect(empty.session.pendingWonder).toBeNull();
        expect(empty.session.wonder).toBeUndefined();
        expect(empty.session.lastWonderMessage).toBe(60);
        expect(empty.storyMemory).toEqual(pending.storyMemory);
    });

    it('an on-demand wonder opens at once', () => {
        const asked = gameReducer(quiet(30), { type: 'REQUEST_WONDER', payload: { onDemand: true } });
        const installed = gameReducer(asked, { type: 'INSTALL_WONDER', payload: { sessionId: 's1', key: 'wonder-30-asked', hooks: HOOKS } });
        expect(installed.session.wonder.openAtMessage).toBe(30);
        expect(installed.session.wonder.onDemand).toBe(true);
    });
});

describe('LOAD_GAME types the wonder session fields', () => {
    it('keeps a complete wonder and marker, drops junk, and never mints absent keys', () => {
        const payload = {
            ...initialGameState,
            character: { name: 'Hero', race: 'human', class: 'fighter', level: 1, maxHP: 10, currentHP: 10, abilityScores: { STR: 10, DEX: 10, CON: 10, INT: 10, WIS: 10, CHA: 10 } },
            messages: msgs(10),
            session: {
                id: 's1',
                wonder: { ...HOOKS[0], key: 'k', chosenAtMessage: 4, openAtMessage: 6, onDemand: 'yes' },
                pendingWonder: 'junk',
                lastWonderMessage: '7',
            },
        };
        const loaded = gameReducer(initialGameState, { type: 'LOAD_GAME', payload });
        expect(loaded.session.wonder).toMatchObject({ title: 'The Countess of Vell', chosenAtMessage: 4, openAtMessage: 6, onDemand: false });
        expect(loaded.session.pendingWonder).toBeNull();
        expect(loaded.session.lastWonderMessage).toBe(7);

        const bare = gameReducer(initialGameState, { type: 'LOAD_GAME', payload: { ...payload, session: { id: 's1' } } });
        expect('wonder' in bare.session).toBe(false);
        expect('pendingWonder' in bare.session).toBe(false);
    });
});
