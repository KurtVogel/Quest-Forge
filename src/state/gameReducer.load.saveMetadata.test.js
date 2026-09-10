/**
 * LOAD_GAME types the two values that feed the save-list metadata and the
 * prompt's location line (2026-09-10 audit P1): an object `currentLocation`
 * or `session.name` survived load, threw `loc.trim is not a function` out of
 * every prompt build, and landed in the NEXT save's metadata, where both save
 * lists rendered it as a React child and crashed — every save unreachable.
 * The same load caps the two conversational-stamp ledgers at the live
 * transcript length (P2: a future-stamped ruling/check never expired) and
 * canonicalizes companion condition lists (P2: "[object Object]" in the party
 * prompt block).
 */
import { describe, expect, it } from 'vitest';
import { gameReducer, initialGameState } from './gameReducer.js';
import { buildSaveMetadata } from './persistence.js';
import { buildSystemPrompt } from '../llm/promptBuilder.js';
import { RECENT_CHECK_LIMIT } from '../engine/roleplayCheck.js';

const base = {
    character: {
        name: 'Vesa', race: 'human', class: 'fighter', level: 2, exp: 0, currentHP: 20, maxHP: 20, armorClass: 16,
        abilityScores: { strength: 16, dexterity: 12, constitution: 14, intelligence: 10, wisdom: 10, charisma: 8 },
        skillProficiencies: [], conditions: [],
    },
    inventory: [],
    messages: Array.from({ length: 12 }, (_, i) => ({ id: `m${i}`, role: i % 2 ? 'assistant' : 'user', content: `line ${i}` })),
};

const load = (overrides) => gameReducer(initialGameState, { type: 'LOAD_GAME', payload: { ...base, ...overrides } });

const promptOf = (state) => buildSystemPrompt({
    ...state,
    preset: 'classicFantasy',
    ruleset: 'simplified5e',
    customSystemPrompt: '',
    retrievedMemories: [],
});

describe('LOAD_GAME types currentLocation and session.name', () => {
    it('an object location/name loads as null/empty, the prompt builds, and the next metadata is typed', () => {
        const next = load({ currentLocation: { name: 'Docks' }, session: { id: 's1', name: { title: 'Campaign' } } });
        expect(next.currentLocation).toBeNull();
        expect(next.session.name).toBe('');
        expect(next.session.id).toBe('s1');
        expect(() => promptOf(next)).not.toThrow();
        const meta = buildSaveMetadata(next);
        expect(meta.location).toBeNull();
        expect(meta.name).toBe('Unnamed Save');
    });

    it('honest strings survive trimmed and clamped', () => {
        const next = load({ currentLocation: '  The Gate District  ', session: { id: 's1', name: 'x'.repeat(500) } });
        expect(next.currentLocation).toBe('The Gate District');
        expect(next.session.name).toHaveLength(120);
    });

    it('a non-object session falls back to the initial session shape', () => {
        const next = load({ session: 'junk' });
        expect(next.session).toMatchObject({ name: '' });
        expect(typeof next.session).toBe('object');
        expect(Array.isArray(next.session)).toBe(false);
    });
});

describe('LOAD_GAME caps conversational stamps at the live transcript length', () => {
    it('a future-stamped ruling clamps to "now" so it ages out; dc clamps 0..30', () => {
        const next = load({
            recentRulings: [{ objective: 'Talk past the guard', skill: 'persuasion', dc: -1000000000, outcome: 'withdrawn', atMessageCount: 1e12, location: null }],
        });
        expect(next.recentRulings).toHaveLength(1);
        expect(next.recentRulings[0].atMessageCount).toBe(base.messages.length);
        expect(next.recentRulings[0].dc).toBe(0);
    });

    it('future-stamped checks clamp to the live count (the heat ledger can no longer run hot forever)', () => {
        const next = load({
            recentChecks: Array.from({ length: RECENT_CHECK_LIMIT }, (_, i) => ({ messageIndex: 1e9 + i, dc: 15, skill: 'stealth' })),
        });
        expect(next.recentChecks.every(entry => entry.messageIndex === base.messages.length)).toBe(true);
    });

    it('honest past stamps are untouched', () => {
        const next = load({ recentChecks: [{ messageIndex: 4, dc: 12, skill: 'stealth' }] });
        expect(next.recentChecks[0].messageIndex).toBe(4);
    });
});

describe('LOAD_GAME canonicalizes companion conditions', () => {
    it('drops object elements and lowercases the rest', () => {
        const next = load({
            party: [{ id: 'wit', name: 'Wit', hp: 10, maxHp: 10, ac: 13, attackBonus: 4, damage: '1d6', weapon: 'Club', status: 'healthy', conditions: [{ junk: 1 }, 'Prone', 'prone'] }],
        });
        expect(next.party[0].conditions).toEqual(['prone']);
        expect(promptOf(next)).not.toContain('[object Object]');
    });
});
