/**
 * rollHistory entries load TYPED (2026-09-09 audit P2): the old guard was
 * `object && Array.isArray(rolls)`, so object faces/total/description rendered
 * "[object Object]" into RECENT DICE ROLLS on every turn and a 5k-char
 * description rode the prompt unclamped.
 */
import { describe, expect, it } from 'vitest';
import { gameReducer, initialGameState } from './gameReducer.js';
import { buildSystemPrompt } from '../llm/promptBuilder.js';

const base = {
    character: {
        name: 'Vesa', race: 'human', class: 'fighter', level: 1, exp: 0, currentHP: 12, maxHP: 12, conditions: [],
        abilityScores: { strength: 16, dexterity: 12, constitution: 14, intelligence: 10, wisdom: 10, charisma: 8 },
    },
    inventory: [],
    messages: [],
};

describe('LOAD_GAME rollHistory typing', () => {
    it('types faces/total/modifier, clamps text, and drops entries with no finite faces', () => {
        const next = gameReducer(initialGameState, {
            type: 'LOAD_GAME',
            payload: {
                ...base,
                rollHistory: [
                    { id: 'r1', rolls: [{ a: 1 }], total: { b: 2 }, description: { c: 3 } },
                    { id: 'r2', rolls: ['12', 3], total: 'zz', modifier: '2', description: 'x'.repeat(5000), notation: { n: 1 } },
                    { id: 'r3', rolls: [7], total: 9, modifier: 2, description: 'Stealth check', notation: '1d20+2', isCritical: 'yes' },
                    null,
                    { rolls: 'nope' },
                ],
            },
        });
        expect(next.rollHistory.map(r => r.id)).toEqual(['r2', 'r3']);
        expect(next.rollHistory[0]).toMatchObject({ rolls: [12, 3], modifier: 2, total: 17, notation: '' });
        expect(next.rollHistory[0].description).toHaveLength(120);
        expect(next.rollHistory[1]).toMatchObject({ rolls: [7], total: 9, isCritical: false, isCritFail: false });
    });

    it('never renders "[object Object]" into RECENT DICE ROLLS after a load', () => {
        const next = gameReducer(initialGameState, {
            type: 'LOAD_GAME',
            payload: {
                ...base,
                rollHistory: [{ id: 'r1', rolls: [{ a: 1 }, 4], total: { b: 2 }, description: { c: 3 }, modifier: { d: 4 } }],
            },
        });
        const text = buildSystemPrompt({
            ...next,
            preset: 'classicFantasy',
            ruleset: 'simplified5e',
            customSystemPrompt: '',
            retrievedMemories: [],
        });
        expect(text).not.toContain('[object Object]');
        expect(text).toContain('**4**');
    });
});
