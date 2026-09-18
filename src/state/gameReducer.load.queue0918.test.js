/**
 * Queue sweep 2026-09-18 — load-boundary pins for prompt-building +
 * memory-journal (Lap 2, hostile input). Every case reproduces a queue line
 * through LOAD_GAME and into the reader that used to throw or mint
 * "[object Object]" canon.
 */
import { describe, expect, it } from 'vitest';
import { gameReducer, initialGameState } from './gameReducer.js';
import { buildSystemPrompt, PROMPT_CHAR_BUDGET } from '../llm/promptBuilder.js';
import { normalizeCompanion } from './handlers/shared.js';
import { appendKeepsakes } from '../engine/companionGear.js';
import { normalizeRollRuling } from '../engine/roleplayCheck.js';
import { normalizeCampaignPremise } from '../config/contentLimits.js';

const SCORES = { strength: 16, dexterity: 12, constitution: 14, intelligence: 10, wisdom: 10, charisma: 8 };

const save = (character = {}, extra = {}) => ({
    character: {
        name: 'Veteran', race: 'human', class: 'fighter', level: 3, exp: 0,
        currentHP: 28, maxHP: 28, conditions: [], abilityScores: { ...SCORES },
        ...character,
    },
    inventory: [],
    messages: Array.from({ length: 50 }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', content: `Beat ${i}` })),
    ...extra,
});

const load = (payload) => gameReducer(initialGameState, { type: 'LOAD_GAME', payload });

const promptFor = (state) => buildSystemPrompt({
    character: state.character, inventory: state.inventory, quests: state.quests, rollHistory: [],
    preset: 'classicFantasy', ruleset: 'simplified5e', customSystemPrompt: '', journal: state.journal, npcs: state.npcs,
    party: state.party, currentLocation: state.currentLocation || 'Jewelglade', combat: { active: false },
    worldFacts: [], fronts: [], storyMemory: [], retrievedMemories: [], premise: state.session?.premise || '',
    recentRulings: state.recentRulings || [], messages: state.messages, messageCount: state.messages.length,
});

describe('hero display lists at load (2026-09-18 P1)', () => {
    it('a STRING traits/features rebuilds from the catalogs and the prompt builds', () => {
        const next = load(save({ traits: 'Darkvision', features: 'Second Wind' }));
        expect(Array.isArray(next.character.traits)).toBe(true);
        expect(Array.isArray(next.character.features)).toBe(true);
        expect(next.character.features).toContain('Second Wind');
        expect(() => promptFor(next)).not.toThrow();
    });

    it('object / oversized elements are dropped or clamped; healthy elements survive verbatim', () => {
        const next = load(save({ traits: ['Versatile', { x: 1 }, null, 'Z'.repeat(50000)], features: ['Second Wind', 7] }));
        expect(next.character.traits[0]).toBe('Versatile');
        expect(next.character.traits).toHaveLength(2);
        expect(next.character.traits[1].length).toBeLessThanOrEqual(120);
        expect(next.character.features).toEqual(['Second Wind']);
        const prompt = promptFor(next);
        expect(prompt).not.toContain('[object Object]');
        expect(prompt.length).toBeLessThan(PROMPT_CHAR_BUDGET);
    });

    it('speed is finite: an object falls back to the race speed, a numeric string coerces', () => {
        expect(load(save({ speed: {} })).character.speed).toBe(30);
        expect(load(save({ speed: '25' })).character.speed).toBe(25);
        expect(promptFor(load(save({ speed: {} })))).toContain('**Speed:** 30 ft');
    });
});

describe('NPC relationship history at load (2026-09-18 P1)', () => {
    const npc = (extra) => ({ name: 'Saima Aallotar', rosterTier: 'character', kind: 'character', disposition: 'wary', ...extra });

    it('a null entry on an ARC-STAMPED record is dropped — KNOWN NPCs builds every turn', () => {
        const next = load(save({}, {
            npcs: [npc({ arcDisposition: 'wary', relationshipHistory: [{ from: 'friendly', to: 'wary', at: 5, note: 'The lie' }, null] })],
        }));
        expect(next.npcs[0].relationshipHistory).toEqual([{ from: 'friendly', to: 'wary', at: 5, note: 'The lie' }]);
        const prompt = promptFor(next);
        expect(prompt).toContain('relationship: friendly → wary');
    });

    it('an object / unknown from/to is no entry; case folds; a junk `at` is dropped', () => {
        const next = load(save({}, {
            npcs: [npc({
                arcDisposition: 'wary',
                relationshipHistory: [{ from: { x: 1 }, to: 'wary' }, { from: 'Friendly', to: 'WARY', at: 'junk' }, { from: 'smitten', to: 'wary' }, 'junk'],
            })],
        }));
        expect(next.npcs[0].relationshipHistory).toEqual([{ from: 'friendly', to: 'wary' }]);
        expect(promptFor(next)).not.toContain('[object Object]');
    });
});

describe('journal rows at load (2026-09-18 P2)', () => {
    it('list elements are string-or-drop at 8 × 300; one poisoned entry cannot blow the prompt budget', () => {
        const next = load(save({}, {
            journal: [{
                id: { x: 1 }, timestamp: 'junk', summary: 'The toll gate quarrel.', location: { name: 'Gate' }, fallback: 'false',
                messageRange: [0, 9000],
                keyDecisions: ['Refused the toll', { x: 1 }, null],
                consequences: [{ x: 1 }, 'Z'.repeat(100000), ...Array.from({ length: 12 }, (_, i) => `Consequence ${i}`)],
            }],
        }));
        const entry = next.journal[0];
        expect(entry.keyDecisions).toEqual(['Refused the toll']);
        expect(entry.consequences).toHaveLength(8);
        expect(entry.consequences.every(c => typeof c === 'string' && c.length <= 300)).toBe(true);
        expect(typeof entry.id).toBe('string');
        expect(Number.isFinite(entry.timestamp)).toBe(true);
        expect(entry.location).toBeNull();
        expect(entry.fallback).toBe(false);
        expect(entry.messageRange).toEqual([0, 50]);
        const prompt = promptFor(next);
        expect(prompt).not.toContain('[object Object]');
        expect(prompt.length).toBeLessThan(PROMPT_CHAR_BUDGET);
    });

    it('a healthy entry round-trips unchanged', () => {
        const healthy = {
            id: 'journal-1', timestamp: 1700000000000, summary: 'A quiet day.', location: 'Mirefen',
            keyDecisions: ['Stayed'], consequences: ['Rested'], messageRange: [0, 10],
        };
        expect(load(save({}, { journal: [healthy] })).journal[0]).toEqual(healthy);
    });

    it('a role-less / unknown-role message loads as an engine line', () => {
        const payload = save();
        payload.messages[4] = { content: 'No role' };
        payload.messages[6] = { role: { junk: 1 }, content: 'Object role' };
        const next = load(payload);
        expect(next.messages[4].role).toBe('system');
        expect(next.messages[6].role).toBe('system');
        expect(next.messages[5].role).toBe('assistant');
    });
});

describe('String(object) lanes (2026-09-18 P2)', () => {
    it('an object premise is no premise; an oversized one is stored at its clamp', () => {
        expect(normalizeCampaignPremise({ x: 1 })).toBe('');
        const next = load(save({}, { session: { id: 's-1', premise: { x: 1 } } }));
        expect(next.session.premise).toBe('');
        expect(promptFor(next)).not.toContain('[object Object]');
        const big = load(save({}, { session: { id: 's-1', premise: 'P'.repeat(100000) } }));
        expect(big.session.premise.length).toBe(8000);
        // A save without the key never gains one.
        expect('premise' in load(save({}, { session: { id: 's-1' } })).session).toBe(false);
    });

    it('an object ruling objective never persists as "[object Object]"', () => {
        // No usable objective = no ruling (it used to persist as "[object Object]" and bind the DM).
        expect(normalizeRollRuling({ outcome: 'withdrawn', objective: { x: 1 }, skill: 'stealth' }, { maxMessageCount: 50 })).toBeNull();
        const kept = normalizeRollRuling({ outcome: 'withdrawn', objective: 'Slip past the reeve', skill: { x: 1 }, location: { x: 1 } }, { maxMessageCount: 50 });
        expect(kept.objective).toBe('Slip past the reeve');
        expect(kept.skill).toBeNull();
        expect(kept.location).toBeNull();
    });

    it('a companion weapon object folds to its name or the fallback; keepsake text is string-or-drop', () => {
        expect(normalizeCompanion({ name: 'Mara', weapon: { name: 'Longsword' } }, {}).weapon).toBe('Longsword');
        expect(normalizeCompanion({ name: 'Mara', weapon: { x: 1 } }, {}).weapon).toBe('Dagger');
        expect(normalizeCompanion({ name: 'Mara', weapon: { x: 1 } }, { weapon: 'Spear' }).weapon).toBe('Spear');
        expect(appendKeepsakes([], [{ text: { x: 1 } }, { text: 'A pressed flower' }, 7, 'A river stone'])).toEqual(['A pressed flower', 'A river stone']);
    });
});
