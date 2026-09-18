/**
 * The wonder die (WOW 2026-09-18): lull detection, the request guards, hook
 * validation, the die, the window, the DM cue, the residue card, and the
 * promptBuilder wiring smoke.
 */
import { describe, expect, it } from 'vitest';
import {
    MESSAGES_PER_SCENE,
    WONDER_COOLDOWN_MESSAGES,
    WONDER_MIN_LULL,
    WONDER_OPENING_MIN_MESSAGES,
    WONDER_WINDOW_MESSAGES,
    buildWonderBlock,
    buildWonderResidueCard,
    isWonderExpired,
    isWonderOpen,
    isWonderRequest,
    lastEventMessage,
    measureLull,
    mintPendingWonder,
    normalizeWonderHooks,
    sanitizePendingWonder,
    sanitizeWonder,
    selectWonder,
    shouldRequestWonder,
    wonderThreshold,
} from './wonder.js';
import { buildSystemPrompt } from '../llm/promptBuilder.js';

const msgs = n => Array.from({ length: n }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', content: `m${i}` }));

const quietState = (n = 60, overrides = {}) => ({
    messages: msgs(n),
    session: { id: 's1' },
    settings: { paceDial: 'standard' },
    combat: { active: false },
    character: { name: 'Testa', currentHP: 12, maxHP: 12 },
    recentEncounters: [],
    quests: [],
    storyMemory: [],
    fronts: [],
    worldTempo: null,
    recentChecks: [],
    ...overrides,
});

const HOOK = {
    register: 'person', title: 'The Countess of Vell', fits: 'standalone',
    hook: 'A black carriage stops beside the wagon at dusk; the veiled woman inside asks for the hero by name.',
    invitation: 'She offers a seat and a warm supper at her manor on the moor.',
};

describe('lastEventMessage + measureLull', () => {
    it('finds the newest event across ledgers and measures the lull from it in conversational messages', () => {
        const state = quietState(60, {
            recentEncounters: [{ messageIndex: 10, enemies: 'wolf', outcome: 'victory' }],
            quests: [{ name: 'q', openedAtMessage: 20 }],
            storyMemory: [{ text: 'x', salience: 4, firstSeenMessage: 25 }, { text: 'y', salience: 2, firstSeenMessage: 50 }],
            fronts: [{ id: 'f', status: 'resolved', resolvedAtMessage: 15 }, { id: 'g', status: 'active', resolvedAtMessage: 58 }],
        });
        expect(lastEventMessage(state)).toBe(25);
        expect(measureLull(state)).toBe(35);
        expect(lastEventMessage(quietState(60))).toBeNull();
        expect(measureLull(quietState(60))).toBe(60);
    });

    it('a permitted symptom, an open wonder, and the cooldown stamp are events too', () => {
        expect(lastEventMessage(quietState(60, { worldTempo: { directive: { grantedAtMessage: 30 } } }))).toBe(30);
        expect(lastEventMessage(quietState(60, { session: { id: 's1', wonder: { ...HOOK, chosenAtMessage: 40, openAtMessage: 42 } } }))).toBe(42);
        expect(lastEventMessage(quietState(60, { session: { id: 's1', lastWonderMessage: 44 } }))).toBe(44);
        expect(lastEventMessage(quietState(60, { recentEncounters: [null, { messageIndex: 'junk' }, { messageIndex: true }] }))).toBeNull();
    });

    it('thresholds follow the pace dial and never disable', () => {
        expect(wonderThreshold('slow-burn')).toBe(WONDER_MIN_LULL['slow-burn']);
        expect(wonderThreshold('breakneck')).toBe(WONDER_MIN_LULL.breakneck);
        expect(wonderThreshold('junk')).toBe(WONDER_MIN_LULL.standard);
        expect(WONDER_MIN_LULL['slow-burn']).toBeGreaterThan(WONDER_MIN_LULL.standard);
    });
});

describe('shouldRequestWonder — the guards', () => {
    it('asks after a real lull on a quiet campaign', () => {
        expect(shouldRequestWonder(quietState(60))).toBe(true);
    });

    it('never in combat, never in the opening, never with a request pending or a wonder open', () => {
        expect(shouldRequestWonder(quietState(60, { combat: { active: true } }))).toBe(false);
        expect(shouldRequestWonder(quietState(WONDER_OPENING_MIN_MESSAGES - 1))).toBe(false);
        expect(shouldRequestWonder(quietState(60, { session: { id: 's1', pendingWonder: { key: 'k', requestedAtMessage: 50 } } }))).toBe(false);
        expect(shouldRequestWonder(quietState(60, { session: { id: 's1', wonder: { ...HOOK, chosenAtMessage: 55, openAtMessage: 57 } } }))).toBe(false);
        expect(shouldRequestWonder(null)).toBe(false);
    });

    it('waits out the cooldown, a front at confrontation, heat above the setpoint, and a short lull', () => {
        expect(shouldRequestWonder(quietState(60, { session: { id: 's1', lastWonderMessage: 60 - WONDER_COOLDOWN_MESSAGES + 5 } }))).toBe(false);
        expect(shouldRequestWonder(quietState(60, { fronts: [{ id: 'f', status: 'active', clock: 6, maxClock: 6, stage: 3 }] }))).toBe(false);
        // A fight three scenes ago is heat above a standard target only on slow-burn.
        const hot = quietState(60, { recentEncounters: [{ messageIndex: 54, enemies: 'wolf', outcome: 'victory' }] });
        expect(shouldRequestWonder(hot)).toBe(false); // also: the fight is the event, lull = 6
        expect(shouldRequestWonder(quietState(60, { recentEncounters: [{ messageIndex: 45, enemies: 'wolf', outcome: 'victory' }] }))).toBe(false);
        expect(shouldRequestWonder(quietState(60, { settings: { paceDial: 'breakneck' }, recentEncounters: [{ messageIndex: 44, enemies: 'wolf', outcome: 'victory' }] }))).toBe(true);
    });

    it('on demand skips the lull and the cooldown only', () => {
        expect(shouldRequestWonder(quietState(30, { session: { id: 's1', lastWonderMessage: 25 } }), { onDemand: true })).toBe(true);
        expect(shouldRequestWonder(quietState(30, { combat: { active: true } }), { onDemand: true })).toBe(false);
        expect(shouldRequestWonder(quietState(10), { onDemand: true })).toBe(false);
    });

    it('mints and types the pending marker', () => {
        const pending = mintPendingWonder(quietState(60), { onDemand: true });
        expect(pending).toEqual({ key: 'wonder-60-asked', requestedAtMessage: 60, onDemand: true });
        expect(sanitizePendingWonder(pending)).toEqual(pending);
        expect(sanitizePendingWonder({ key: 'k', requestedAtMessage: 'junk' })).toBeNull();
        expect(sanitizePendingWonder('k')).toBeNull();
        expect(sanitizePendingWonder({ key: 'k', requestedAtMessage: 3, onDemand: 'yes' })).toEqual({ key: 'k', requestedAtMessage: 3, onDemand: false });
    });
});

describe('normalizeWonderHooks', () => {
    it('types every hook complete-or-drop, folds duplicate registers, caps at three, and re-judges fits', () => {
        const hooks = normalizeWonderHooks([
            { ...HOOK, fits: 'front:f1' },
            { register: 'RELIC', title: 'The Beacon', hook: 'A green light pulses in the hill ruins.', invitation: 'It is visible from the road every night now.', fits: 'front:nope' },
            { register: 'person', title: 'Dup', hook: 'x', invitation: 'y' },
            { register: 'passage', title: 'The Sky Barge', hook: 'A barge crosses the sky.', invitation: 'A dockhand says it sails for the Closed Shore.', fits: 'standalone' },
            { register: 'sight', title: 'Fourth', hook: 'x', invitation: 'y' },
            null, 'junk', { register: 'bargain', title: { evil: true }, hook: 'x', invitation: 'y' },
        ], { fronts: [{ id: 'f1', status: 'active' }, { id: 'f2', status: 'resolved' }] });
        expect(hooks.map(h => h.register)).toEqual(['person', 'relic', 'passage']);
        expect(hooks[0].fits).toBe('f1');
        expect(hooks[1].fits).toBe('standalone');
        expect(hooks[2].fits).toBe('standalone');
    });

    it('guarantees one standalone hook and clamps text', () => {
        const hooks = normalizeWonderHooks([{ ...HOOK, fits: 'front:f1', hook: 'h'.repeat(400) }], { fronts: [{ id: 'f1', status: 'active' }] });
        expect(hooks[0].fits).toBe('standalone');
        expect(hooks[0].hook).toHaveLength(300);
        expect(normalizeWonderHooks('junk')).toEqual([]);
        expect(normalizeWonderHooks([{ register: 'dragon', title: 'x', hook: 'y', invitation: 'z' }])).toEqual([]);
    });
});

describe('selectWonder + sanitizeWonder + the window', () => {
    it('the die picks one hook and delays the window by scenes; on demand opens at once', () => {
        const hooks = [HOOK, { ...HOOK, register: 'relic', title: 'The Beacon' }];
        const chosen = selectWonder(hooks, { messageCount: 60, pick: 1, delayScenes: 2, key: 'wonder-60-lull' });
        expect(chosen.title).toBe('The Beacon');
        expect(chosen.openAtMessage).toBe(60 + 2 * MESSAGES_PER_SCENE);
        expect(chosen.key).toBe('wonder-60-lull');
        const asked = selectWonder(hooks, { messageCount: 60, pick: 9, delayScenes: 3, onDemand: true });
        expect(asked.title).toBe('The Beacon');
        expect(asked.openAtMessage).toBe(60);
        expect(asked.onDemand).toBe(true);
        expect(selectWonder([], { messageCount: 60, pick: 0, delayScenes: 0 })).toBeNull();
    });

    it('sanitizeWonder is complete-or-null and keeps the stored tie', () => {
        const stored = { ...HOOK, fits: 'f1', key: 'k', chosenAtMessage: 60, openAtMessage: 58, onDemand: 'yes' };
        expect(sanitizeWonder(stored)).toEqual({ ...HOOK, fits: 'f1', key: 'k', chosenAtMessage: 60, openAtMessage: 60, onDemand: false });
        expect(sanitizeWonder({ ...HOOK, chosenAtMessage: 'x', openAtMessage: 3 })).toBeNull();
        expect(sanitizeWonder({ ...HOOK, register: 'dragon', chosenAtMessage: 1, openAtMessage: 3 })).toBeNull();
        expect(sanitizeWonder('junk')).toBeNull();
    });

    it('is open only after the delay and inside the window, measured conversationally', () => {
        const wonder = { ...HOOK, chosenAtMessage: 60, openAtMessage: 64 };
        expect(isWonderOpen(wonder, 62, msgs(62))).toBe(false);
        expect(isWonderOpen(wonder, 64, msgs(64))).toBe(true);
        expect(isWonderOpen(wonder, 64 + WONDER_WINDOW_MESSAGES, msgs(64 + WONDER_WINDOW_MESSAGES))).toBe(true);
        expect(isWonderOpen(wonder, 64 + WONDER_WINDOW_MESSAGES + 2, msgs(64 + WONDER_WINDOW_MESSAGES + 2))).toBe(false);
        expect(isWonderExpired(wonder, 64 + WONDER_WINDOW_MESSAGES + 2, msgs(64 + WONDER_WINDOW_MESSAGES + 2))).toBe(true);
        expect(isWonderExpired(wonder, 62, msgs(62))).toBe(false);
        // System lines do not age the window.
        const padded = [...msgs(66), ...Array.from({ length: 30 }, () => ({ role: 'system', content: 'x' }))];
        expect(isWonderOpen(wonder, padded.length, padded)).toBe(true);
        expect(isWonderExpired('junk', 99)).toBe(true);
    });
});

describe('buildWonderBlock + the residue card + the OOC ask', () => {
    it('renders the invitation cue while open, standalone by default, and nothing in combat or outside the window', () => {
        const wonder = { ...HOOK, chosenAtMessage: 60, openAtMessage: 62 };
        const block = buildWonderBlock(wonder, { messageCount: 62, messages: msgs(62) });
        expect(block).toMatch(/^## SOMETHING STRANGE ARRIVES — PRIVATE/);
        expect(block).toContain('**The Countess of Vell** (someone who takes an interest): A black carriage');
        expect(block).toContain('never as an attack, ambush, grab, or threat');
        expect(block).toContain('It stands on its own');
        expect(block).toContain('never reveal that it was rolled');
        expect(buildWonderBlock(wonder, { messageCount: 62, messages: msgs(62), combatActive: true })).toBe('');
        expect(buildWonderBlock(wonder, { messageCount: 60, messages: msgs(60) })).toBe('');
        expect(buildWonderBlock(null, { messageCount: 62 })).toBe('');
    });

    it('names the tied pressure by faction only, never a clock', () => {
        const wonder = { ...HOOK, fits: 'f1', chosenAtMessage: 60, openAtMessage: 60 };
        const fronts = [{ id: 'f1', status: 'active', title: 'The Hollow Choir', clock: 4, faction: { name: 'the Choir of Ash' } }];
        const block = buildWonderBlock(wonder, { messageCount: 60, messages: msgs(60), fronts });
        expect(block).toContain('quietly tied to the Choir of Ash');
        expect(block).not.toContain('clock');
        // A resolved or unknown tie renders as standalone.
        expect(buildWonderBlock(wonder, { messageCount: 60, messages: msgs(60), fronts: [{ ...fronts[0], status: 'resolved' }] })).toContain('It stands on its own');
    });

    it('mints a salient foreshadowing card and detects the OOC ask', () => {
        const card = buildWonderResidueCard({ ...HOOK, chosenAtMessage: 60, openAtMessage: 60 });
        expect(card).toMatchObject({ type: 'foreshadow', subject: 'The Countess of Vell', salience: 4, status: 'active', tags: ['wonder', 'person'] });
        expect(card.text).toContain('black carriage');
        expect(buildWonderResidueCard(null)).toBeNull();
        expect(isWonderRequest('OOC: surprise me')).toBe(true);
        expect(isWonderRequest('DM, give me something wild')).toBe(true);
        expect(isWonderRequest('OOC: can we shake things up?')).toBe(true);
        expect(isWonderRequest('OOC: recap please')).toBe(false);
        expect(isWonderRequest('')).toBe(false);
    });

    it('rides the system prompt only while open', () => {
        const base = {
            character: { name: 'Testa', race: 'human', class: 'fighter', level: 2, currentHP: 10, maxHP: 10, abilityScores: { STR: 10, DEX: 10, CON: 10, INT: 10, WIS: 10, CHA: 10 } },
            inventory: [], quests: [], rollHistory: [], journal: [], npcs: [], party: [], worldFacts: [], fronts: [],
            messages: msgs(62), messageCount: 62,
        };
        const open = buildSystemPrompt({ ...base, wonder: { ...HOOK, chosenAtMessage: 60, openAtMessage: 62 } });
        expect(open).toContain('## SOMETHING STRANGE ARRIVES — PRIVATE');
        expect(open.indexOf('## SOMETHING STRANGE ARRIVES')).toBeLessThan(open.indexOf('## PLAYER CHARACTER'));
        const closed = buildSystemPrompt({ ...base, wonder: { ...HOOK, chosenAtMessage: 60, openAtMessage: 70 } });
        expect(closed).not.toContain('## SOMETHING STRANGE ARRIVES');
        expect(buildSystemPrompt(base)).not.toContain('## SOMETHING STRANGE ARRIVES');
    });
});
