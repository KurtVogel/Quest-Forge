/**
 * MERGE_CHARACTER_APPEARANCE (2026-09-16 scribe P1): the Scribe's lane for the
 * hero's look rides the NPC fragment belt — a fragment merges into the recorded
 * description, a rewrite replaces it. UPDATE_CHARACTER (the wizard / the sheet)
 * stays a plain replace: the player's own edit is exactly what they typed.
 */
import { describe, expect, it } from 'vitest';
import { gameReducer, initialGameState } from './gameReducer.js';

const LOOK = 'A tall woman with white hair to her waist, grey eyes, a broken nose, and a heavy build; wears a green wool cloak.';
const base = { ...initialGameState, character: { ...initialGameState.character, name: 'Astra', appearance: LOOK } };

describe('MERGE_CHARACTER_APPEARANCE', () => {
    it('a fragment joins the recorded look instead of replacing it', () => {
        const next = gameReducer(base, { type: 'MERGE_CHARACTER_APPEARANCE', payload: { appearance: 'a fresh cut over the brow' } });
        expect(next.character.appearance).toContain('white hair to her waist');
        expect(next.character.appearance).toContain('a fresh cut over the brow');
    });

    it('a complete rewrite replaces the record (haircuts and disguises must be able to drop details)', () => {
        const rewrite = 'A tall woman, head now shaved to the scalp, grey eyes, a broken nose, a heavy build, and a fresh cut over the brow; wears a green wool cloak.';
        const next = gameReducer(base, { type: 'MERGE_CHARACTER_APPEARANCE', payload: { appearance: rewrite } });
        expect(next.character.appearance).toBe(rewrite);
        expect(next.character.appearance).not.toContain('white hair');
    });

    it('blank or non-string input is ignored; the merged text clamps to 600', () => {
        expect(gameReducer(base, { type: 'MERGE_CHARACTER_APPEARANCE', payload: { appearance: '   ' } })).toBe(base);
        expect(gameReducer(base, { type: 'MERGE_CHARACTER_APPEARANCE', payload: { appearance: { x: 1 } } })).toBe(base);
        const long = gameReducer(base, { type: 'MERGE_CHARACTER_APPEARANCE', payload: { appearance: 'z'.repeat(900) } });
        expect(long.character.appearance.length).toBeLessThanOrEqual(600);
    });

    it('seeds an empty record with the incoming text', () => {
        const blank = { ...base, character: { ...base.character, appearance: '' } };
        const next = gameReducer(blank, { type: 'MERGE_CHARACTER_APPEARANCE', payload: { appearance: 'a fresh cut over the brow' } });
        expect(next.character.appearance).toBe('a fresh cut over the brow');
    });

    it('UPDATE_CHARACTER still plain-replaces — the player edit lane is untouched', () => {
        const next = gameReducer(base, { type: 'UPDATE_CHARACTER', payload: { appearance: 'Short.' } });
        expect(next.character.appearance).toBe('Short.');
    });
});
