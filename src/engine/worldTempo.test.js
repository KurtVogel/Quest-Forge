import { describe, expect, it } from 'vitest';
import {
    appendRecentEncounter,
    buildEncounterEntry,
    buildPaceGuidance,
    buildWorldTempoBlock,
    clampIntensity,
    computeRecentHeat,
    getFrontIntensityBand,
    isTempoWindowActive,
    normalizePaceDial,
    normalizeTempoDirective,
    summarizeEncounterEnemies,
    MAX_RECENT_ENCOUNTERS,
} from './worldTempo.js';

const front = (overrides = {}) => ({
    id: 'front-v2-1',
    title: 'The River Blockade',
    goal: 'Starve the town',
    status: 'active',
    clock: 0,
    maxClock: 6,
    stage: 0,
    faction: { name: 'Mud-Dredge Gang', goal: 'Extort river trade' },
    ...overrides,
});

describe('intensity bands', () => {
    it('derives the band from clock ratio and stage', () => {
        expect(getFrontIntensityBand(front({ clock: 0, stage: 0 }))).toBe('whispers');
        expect(getFrontIntensityBand(front({ clock: 1, stage: 0 }))).toBe('whispers');
        expect(getFrontIntensityBand(front({ clock: 2, stage: 0 }))).toBe('indirect');
        expect(getFrontIntensityBand(front({ clock: 1, stage: 1 }))).toBe('indirect');
        expect(getFrontIntensityBand(front({ clock: 4, stage: 1 }))).toBe('presence');
        expect(getFrontIntensityBand(front({ clock: 2, stage: 3 }))).toBe('presence');
        expect(getFrontIntensityBand(front({ clock: 6, stage: 4 }))).toBe('confrontation');
        expect(getFrontIntensityBand(null)).toBe('whispers');
    });

    it('clamps requested intensity to the band, never above', () => {
        expect(clampIntensity('confrontation', 'whispers')).toBe('whispers');
        expect(clampIntensity('indirect', 'presence')).toBe('indirect');
        expect(clampIntensity('garbage', 'indirect')).toBe('indirect');
    });
});

describe('recent heat', () => {
    const baseState = {
        messages: Array.from({ length: 30 }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user' })),
        character: { currentHP: 20, maxHP: 20 },
        combat: { active: false },
        recentEncounters: [],
    };

    it('is calm with nothing going on', () => {
        const heat = computeRecentHeat(baseState);
        expect(heat).toMatchObject({ score: 0, level: 'calm', reasons: [] });
    });

    it('scores active combat, recent fights, and a hurt hero', () => {
        const heat = computeRecentHeat({
            ...baseState,
            combat: { active: true },
            character: { currentHP: 5, maxHP: 20 },
            recentEncounters: [
                { enemies: 'ghoul', messageIndex: 22 },
                { enemies: 'wolves', messageIndex: 27 },
            ],
        });
        expect(heat.level).toBe('high');
        expect(heat.score).toBeGreaterThanOrEqual(7);
        expect(heat.reasons.join(' ')).toMatch(/combat is happening/);
        expect(heat.reasons.join(' ')).toMatch(/badly hurt/);
    });

    it('ignores fights outside the window', () => {
        const heat = computeRecentHeat({
            ...baseState,
            recentEncounters: [{ enemies: 'ghoul', messageIndex: 2 }],
        });
        expect(heat.score).toBe(0);
    });

    it('treats a single recent check as routine, not heat', () => {
        const heat = computeRecentHeat({
            ...baseState,
            recentChecks: [{ messageIndex: 28, dc: 12 }],
        });
        expect(heat.score).toBe(0);
    });

    it('scores a dense diceless pressure arc from check proposals', () => {
        const heat = computeRecentHeat({
            ...baseState,
            recentChecks: [
                { messageIndex: 20, dc: 12 },
                { messageIndex: 24, dc: 15 },
                { messageIndex: 26, dc: 12 },
                { messageIndex: 29, dc: 15 },
            ],
        });
        // 4 checks (+3) with strong opposition (+1) → lively without any combat.
        expect(heat.score).toBe(4);
        expect(heat.level).toBe('lively');
        expect(heat.reasons.join(' ')).toMatch(/4 checks under pressure/);
        expect(heat.reasons.join(' ')).toMatch(/strong opposition/);
    });

    it('ignores checks outside the window and caps the diceless contribution below combat weight', () => {
        const outside = computeRecentHeat({
            ...baseState,
            recentChecks: [
                { messageIndex: 1, dc: 18 },
                { messageIndex: 3, dc: 18 },
            ],
        });
        expect(outside.score).toBe(0);

        const stacked = computeRecentHeat({
            ...baseState,
            recentChecks: Array.from({ length: 8 }, (_, i) => ({ messageIndex: 20 + i, dc: 18 })),
        });
        expect(stacked.score).toBe(4); // 3 cap + 1 hard-DC bonus — never "high" alone
        expect(stacked.level).toBe('lively');
    });
});

describe('pace guidance thermostat', () => {
    it('cools an overheated slow-burn campaign', () => {
        const line = buildPaceGuidance('slow-burn', { level: 'high', reasons: ['two fights'] });
        expect(line).toMatch(/breathing room/i);
        expect(line).toMatch(/NO new unprovoked threats/);
    });

    it('heats a flat breakneck campaign', () => {
        expect(buildPaceGuidance('breakneck', { level: 'calm', reasons: [] })).toMatch(/would land well/);
    });

    it('holds a campaign on target and defaults unknown dials to standard', () => {
        expect(buildPaceGuidance('standard', { level: 'lively', reasons: [] })).toMatch(/on this campaign's standard target/);
        expect(normalizePaceDial('warp-speed')).toBe('standard');
    });
});

describe('tempo directive normalization', () => {
    const ctx = {
        fronts: [front({ clock: 2 }), front({ id: 'front-v2-2', clock: 5, faction: { name: 'Miller', goal: 'Monopoly' } })],
        messageCount: 30,
        paceDial: 'standard',
        timingDelay: 2,
    };

    it('grants a validated window with the timing die applied in scenes', () => {
        const directive = normalizeTempoDirective(
            { front_id: 'front-v2-1', max_intensity: 'confrontation', where: 'the docks', suggested_symptom: 'A skiff goes missing.' },
            ctx,
        );
        expect(directive.frontId).toBe('front-v2-1');
        // clock 2/6 → indirect band; the requested confrontation is clamped down.
        expect(directive.maxIntensity).toBe('indirect');
        expect(directive.activatesAtMessage).toBe(34); // 30 + 2 scenes × 2 messages
        expect(directive.expiresAtMessage).toBeGreaterThan(directive.activatesAtMessage);
    });

    it('degrades unknown fronts and garbage to a quiet directive', () => {
        expect(normalizeTempoDirective({ front_id: 'front-nope' }, ctx).frontId).toBeNull();
        expect(normalizeTempoDirective(null, ctx).frontId).toBeNull();
        expect(normalizeTempoDirective({ front_id: 'front-nope' }, ctx).maxIntensity).toBe('whispers');
    });

    it('never grants the same front two consecutive windows', () => {
        const directive = normalizeTempoDirective(
            { front_id: 'front-v2-1', max_intensity: 'whispers' },
            { ...ctx, previousDirective: { frontId: 'front-v2-1' } },
        );
        expect(directive.frontId).toBeNull();
    });

    it('slow-burn forces a quiet cadence after ANY window', () => {
        const directive = normalizeTempoDirective(
            { front_id: 'front-v2-2', max_intensity: 'whispers' },
            { ...ctx, paceDial: 'slow-burn', previousDirective: { frontId: 'front-v2-1' } },
        );
        expect(directive.frontId).toBeNull();
    });

    it('clamps to whispers away from a front with a known home theater', () => {
        const locations = [
            { name: 'River Docks', aliases: [], theaterFrontIds: ['front-v2-1'] },
            { name: 'Distant Icefield', aliases: [], theaterFrontIds: [] },
        ];
        const away = normalizeTempoDirective(
            { front_id: 'front-v2-1', max_intensity: 'indirect' },
            { ...ctx, locations, currentLocation: 'Distant Icefield' },
        );
        expect(away).toMatchObject({ frontId: 'front-v2-1', maxIntensity: 'whispers' });

        const home = normalizeTempoDirective(
            { front_id: 'front-v2-1', max_intensity: 'indirect' },
            { ...ctx, locations, currentLocation: 'River Docks' },
        );
        expect(home.maxIntensity).toBe('indirect');

        // A front with no recorded theater anywhere stays permissive.
        const unhomed = normalizeTempoDirective(
            { front_id: 'front-v2-2', max_intensity: 'presence' },
            { ...ctx, locations, currentLocation: 'Distant Icefield' },
        );
        expect(unhomed.maxIntensity).toBe('presence');
    });

    it('honors a directive whose `where` resolves to the theater even when the current location string drifted', () => {
        // 2026-07-15 playtest: hero stood at "the shrine" (a drifted record),
        // theater was "Candlemire" — the window wrongly clamped to whispers at
        // the front's own home.
        const locations = [
            { name: 'Candlemire', aliases: ['Candlemire shrine'], theaterFrontIds: ['front-v2-1'] },
            { name: 'the shrine', aliases: [], theaterFrontIds: [] },
        ];
        const atHome = normalizeTempoDirective(
            { front_id: 'front-v2-1', max_intensity: 'indirect', where: 'Candlemire shrine' },
            { ...ctx, locations, currentLocation: 'the shrine' },
        );
        expect(atHome.maxIntensity).toBe('indirect');

        // But a `where` that resolves nowhere near a theater still clamps.
        const elsewhere = normalizeTempoDirective(
            { front_id: 'front-v2-1', max_intensity: 'indirect', where: 'Distant Icefield' },
            { ...ctx, locations: [...locations, { name: 'Distant Icefield', aliases: [], theaterFrontIds: [] }], currentLocation: 'the shrine' },
        );
        expect(elsewhere.maxIntensity).toBe('whispers');
    });

    it('window activity respects activation and expiry', () => {
        const directive = normalizeTempoDirective({ front_id: 'front-v2-1' }, ctx);
        expect(isTempoWindowActive(directive, 33)).toBe(false); // die still counting down
        expect(isTempoWindowActive(directive, 34)).toBe(true);
        expect(isTempoWindowActive(directive, directive.expiresAtMessage + 1)).toBe(false);
        expect(isTempoWindowActive(null, 34)).toBe(false);
    });
});

describe('encounter ledger', () => {
    it('summarizes and caps encounters', () => {
        expect(summarizeEncounterEnemies([
            { name: 'Ghoul 1' }, { name: 'Ghoul 2' }, { name: 'Scarred Hound' },
        ])).toBe('2× Ghoul, Scarred Hound');

        const state = {
            messages: Array.from({ length: 12 }, () => ({})),
            currentLocation: 'Old Crypt',
            combat: { enemies: [{ name: 'Ghoul 1' }, { name: 'Ghoul 2' }] },
        };
        const entry = buildEncounterEntry(state, { defeat: false });
        expect(entry).toMatchObject({ messageIndex: 12, location: 'Old Crypt', enemies: '2× Ghoul', outcome: 'victory' });
        expect(buildEncounterEntry(state, { defeat: true, slainXpOnly: true }).outcome).toBe('defeat');
        expect(buildEncounterEntry(state, { escaped: true }).outcome).toBe('escaped');

        let list = [];
        for (let i = 0; i < 10; i++) list = appendRecentEncounter(list, { enemies: `foe ${i}`, messageIndex: i });
        expect(list).toHaveLength(MAX_RECENT_ENCOUNTERS);
        expect(list[0].enemies).toBe('foe 4');
    });
});

describe('world tempo prompt block', () => {
    const fronts = [front({ clock: 2 })];

    it('renders quiet state with stubs but no dossier', () => {
        const block = buildWorldTempoBlock({
            fronts,
            worldTempo: null,
            paceDial: 'slow-burn',
            heat: { level: 'calm', reasons: [] },
            messageCount: 10,
        });
        expect(block).toContain('## WORLD TEMPO');
        expect(block).toContain('front-v2-1 (Mud-Dredge Gang)');
        expect(block).toContain('QUIET this scene');
        expect(block).toContain('player-initiated risk');
        // The dossier stays hidden: no clocks, portents, or stakes.
        expect(block).not.toMatch(/clock/i);
        expect(block).not.toMatch(/portent/i);
        expect(block).not.toContain('The River Blockade');
    });

    it('renders the permission card only when the window is active', () => {
        const directive = {
            frontId: 'front-v2-1', maxIntensity: 'indirect', where: 'the docks',
            suggestedSymptom: 'A skiff goes missing.', grantedAtMessage: 10,
            activatesAtMessage: 14, expiresAtMessage: 34,
        };
        const pending = buildWorldTempoBlock({
            fronts, worldTempo: { directive }, heat: { level: 'calm', reasons: [] }, messageCount: 12,
        });
        expect(pending).toContain('QUIET this scene');

        const active = buildWorldTempoBlock({
            fronts, worldTempo: { directive }, heat: { level: 'calm', reasons: [] }, messageCount: 14,
        });
        expect(active).toContain("THIS SCENE'S PERMISSION");
        expect(active).toContain('Maximum intensity: indirect');
        expect(active).toContain('A skiff goes missing.');
    });

    it('suppresses the permission during active combat and lists recent fights', () => {
        const directive = {
            frontId: 'front-v2-1', maxIntensity: 'indirect',
            grantedAtMessage: 10, activatesAtMessage: 10, expiresAtMessage: 34,
        };
        const block = buildWorldTempoBlock({
            fronts,
            worldTempo: { directive },
            heat: { level: 'high', reasons: ['combat is happening right now'] },
            messageCount: 12,
            combatActive: true,
            recentEncounters: [{ enemies: '2× ghoul', location: 'Old Crypt', outcome: 'victory', messageIndex: 8 }],
        });
        expect(block).not.toContain("THIS SCENE'S PERMISSION");
        expect(block).toContain('Recent fights: 2× ghoul (Old Crypt, victory)');
        expect(block).toContain('cleared once won');
    });

    it('returns empty with no fronts and no encounters', () => {
        expect(buildWorldTempoBlock({ fronts: [], recentEncounters: [] })).toBe('');
    });
});
