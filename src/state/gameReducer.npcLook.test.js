/**
 * SET_NPC_LOOK (2026-09-12): the player's own edit of a character's look is a
 * PLAIN REPLACE of appearance / gender / species on the roster record — never
 * the Scribe's fragment merge or the dossier append — so what the player types
 * is exactly what portraits, scene art, and the DM are told from then on.
 */
import { describe, expect, it } from 'vitest';
import { gameReducer, initialGameState } from './gameReducer.js';

const seeded = gameReducer(initialGameState, {
    type: 'LOAD_GAME',
    payload: {
        character: { name: 'Astra', race: 'human', class: 'fighter', level: 1, exp: 0, currentHP: 12, maxHP: 12, conditions: [], abilityScores: { strength: 16, dexterity: 12, constitution: 14, intelligence: 10, wisdom: 10, charisma: 8 } },
        inventory: [], messages: [],
        npcs: [{
            id: 'npc-1', name: 'Nyanza Okoro', kind: 'character', disposition: 'friendly',
            appearance: 'A tall woman in an oilskin coat, tight grey cornrows, a scar along her jaw.',
            gender: 'woman', species: 'human',
            stanceToPlayer: 'Trusts the hero with the harbour.',
            portraitUrl: 'data:image/png;base64,AAAA', portraitProvider: 'xai',
        }],
    },
});
const record = state => state.npcs.find(npc => npc.id === 'npc-1');

describe('SET_NPC_LOOK', () => {
    it('replaces the look wholesale — a short rewrite is NOT merged into the old record', () => {
        const next = gameReducer(seeded, { type: 'SET_NPC_LOOK', payload: { id: 'npc-1', appearance: 'Completely bald, deep dark brown skin, tall and statuesque.' } });
        expect(record(next).appearance).toBe('Completely bald, deep dark brown skin, tall and statuesque.');
        expect(record(next).appearance).not.toContain('cornrows');
        // Everything else on the record is untouched.
        expect(record(next).stanceToPlayer).toBe('Trusts the hero with the harbour.');
        expect(record(next).portraitUrl).toBe('data:image/png;base64,AAAA');
        expect(record(next).gender).toBe('woman');
    });

    it('changes only the keys the payload carries, and an empty string clears a field', () => {
        const next = gameReducer(seeded, { type: 'SET_NPC_LOOK', payload: { id: 'npc-1', species: 'half-orc', gender: '' } });
        expect(record(next).species).toBe('half-orc');
        expect(record(next).gender ?? '').toBe(''); // normalizeNpcRecord stores a cleared field as absent
        expect(record(next).appearance).toContain('cornrows');
    });

    it('clamps and types the fields at the boundary', () => {
        const next = gameReducer(seeded, { type: 'SET_NPC_LOOK', payload: { id: 'npc-1', appearance: 'x'.repeat(2000), gender: { evil: true }, species: 'g'.repeat(100) } });
        expect(record(next).appearance).toHaveLength(600);
        expect(record(next).gender ?? '').toBe('');
        expect(record(next).species).toHaveLength(40);
    });

    it('is a no-op for an unknown id, a missing id, or a payload with no look fields', () => {
        expect(gameReducer(seeded, { type: 'SET_NPC_LOOK', payload: { id: 'nope', appearance: 'x' } })).toBe(seeded);
        expect(gameReducer(seeded, { type: 'SET_NPC_LOOK', payload: { appearance: 'x' } })).toBe(seeded);
        expect(gameReducer(seeded, { type: 'SET_NPC_LOOK', payload: { id: 'npc-1' } })).toBe(seeded);
    });

    it('a later Scribe fragment merges INTO the edited record instead of restoring the old look', () => {
        const edited = gameReducer(seeded, { type: 'SET_NPC_LOOK', payload: { id: 'npc-1', appearance: 'Completely bald, deep dark brown skin, tall and statuesque, a scar along her jaw.' } });
        const merged = gameReducer(edited, { type: 'UPDATE_NPC', payload: { name: 'Nyanza Okoro', appearance: 'a fresh burn on her left hand' } });
        expect(record(merged).appearance).toContain('Completely bald');
        expect(record(merged).appearance).toContain('burn on her left hand');
        expect(record(merged).appearance).not.toContain('cornrows');
    });
});
