/**
 * The two engine-triggered narration prompts (2026-10-13 chat-orchestration
 * P2) — they lived as closures in ChatPanel.jsx with no test reading them.
 */
import { describe, expect, it } from 'vitest';
import { buildCastNarrationPrompt, buildCueNarrationPrompt } from './engineNarration.js';

describe('buildCueNarrationPrompt', () => {
    const cue = { mechanic: 'Short rest', actionType: 'rest', effect: 'Regained 7 HP' };

    it('names the mechanic, the action type, the effect and the engine line, and forbids mechanics and JSON', () => {
        const prompt = buildCueNarrationPrompt(cue, 'Testa rests and regains 7 HP.');
        expect(prompt.startsWith('[SYSTEM: The engine just resolved a player-triggered mechanic.')).toBe(true);
        expect(prompt).toContain('Mechanic: Short rest. Action type: rest. Effect: Regained 7 HP.');
        expect(prompt).toContain('System result to interpret fictionally: Testa rests and regains 7 HP.]');
        expect(prompt).toContain('Do not apply healing, spend resources, request rolls, add items, alter combat, or emit JSON.');
        expect(prompt).toContain('Do not advance time or introduce a new challenge.');
    });

    it('in combat the line forbids advancing enemy turns instead', () => {
        const prompt = buildCueNarrationPrompt(cue, 'Testa drinks a potion.', { combatActive: true });
        expect(prompt).toContain('Combat is active; do not advance enemy turns, request rolls, or resolve any enemy actions.');
        expect(prompt).not.toContain('Do not advance time');
    });

    it('an action type defaults to "action"', () => {
        expect(buildCueNarrationPrompt({ mechanic: 'Potion', effect: 'Healed' }, 'line')).toContain('Action type: action.');
    });
});

describe('buildCastNarrationPrompt', () => {
    it('lists each cast with its target, "self" targets omitted, and forbids re-emitting the cast', () => {
        const prompt = buildCastNarrationPrompt([
            { spell: 'Cure Wounds', target: 'Osma' },
            { spell: 'Detect Magic', target: 'self' },
            { spell: 'Light' },
        ]);
        expect(prompt).toContain('Engine result to interpret fictionally: The hero casts Cure Wounds on Osma. The hero casts Detect Magic. The hero casts Light.]');
        expect(prompt).toContain('do not emit spell_cast again or any JSON');
        expect(prompt).toContain('unvarnished');
    });

    it('closes the bracket with no engine result when nothing was cast', () => {
        expect(buildCastNarrationPrompt([]).endsWith(' ]')).toBe(true);
        expect(buildCastNarrationPrompt(null)).not.toContain('Engine result');
    });
});
