import { describe, expect, it } from 'vitest';
import { gameReducer, initialGameState } from './gameReducer.js';

describe('gameReducer NPC roster gating', () => {
    it('does not add generic combat fodder to the roster', () => {
        const next = gameReducer(initialGameState, {
            type: 'UPDATE_NPC',
            payload: {
                name: 'Goblin with Spear #15',
                disposition: 'hostile',
                lastNotes: 'Was killed in the ambush.',
            },
        });
        expect(next.npcs).toHaveLength(0);
    });

    it('keeps legacy antagonists when loading an old save', () => {
        const next = gameReducer(initialGameState, {
            type: 'LOAD_GAME',
            payload: {
                ...initialGameState,
                character: initialGameState.character,
                inventory: initialGameState.inventory,
                messages: [],
                npcs: [{
                    name: 'Captain Maren Voss',
                    disposition: 'hostile',
                    lastNotes: 'The fighter captain who humiliated the hero in Galicia.',
                    relationshipTension: 'The hero plans to return stronger.',
                }],
            },
        });
        expect(next.npcs).toHaveLength(1);
        expect(next.npcs[0].rosterTier).toBe('character');
        expect(next.npcs[0].name).toBe('Captain Maren Voss');
    });

    it('pins an important NPC for long-term recall', () => {
        const withNpc = gameReducer(initialGameState, {
            type: 'LOAD_GAME',
            payload: {
                ...initialGameState,
                character: initialGameState.character,
                inventory: initialGameState.inventory,
                messages: [],
                npcs: [{ id: 'npc-captain', name: 'Captain Maren Voss', disposition: 'hostile' }],
            },
        });
        const pinned = gameReducer(withNpc, {
            type: 'PIN_NPC',
            payload: { id: 'npc-captain', pinned: true },
        });
        expect(pinned.npcs[0].pinned).toBe(true);
        expect(pinned.npcs[0].importance).toBe(5);
    });

    it('promotes relationship tension into story memory', () => {
        const next = gameReducer(initialGameState, {
            type: 'UPDATE_NPC',
            payload: {
                name: 'Captain Maren Voss',
                disposition: 'hostile',
                relationshipTension: 'Humiliated the hero publicly.',
                lastNotes: 'Blocked the hero at the town gate.',
            },
        });
        expect(next.npcs).toHaveLength(1);
        expect(next.storyMemory.length).toBeGreaterThan(0);
        expect(next.storyMemory[0].linkedNpcNames).toContain('Captain Maren Voss');
    });

    it('merges NPC records title-insensitively and preserves the longer name', () => {
        // Test case 1: Start with "Lannis" and update with "Confessor Lannis"
        const state1 = gameReducer(initialGameState, {
            type: 'UPDATE_NPC',
            payload: {
                name: 'Lannis',
                disposition: 'friendly',
                relationshipTension: 'Lannis knows a secret.',
            },
        });
        expect(state1.npcs).toHaveLength(1);
        expect(state1.npcs[0].name).toBe('Lannis');

        const state2 = gameReducer(state1, {
            type: 'UPDATE_NPC',
            payload: {
                name: 'Confessor Lannis',
                disposition: 'friendly',
                lastNotes: 'Met Lannis at the solar.',
            },
        });
        expect(state2.npcs).toHaveLength(1);
        expect(state2.npcs[0].name).toBe('Confessor Lannis');
        expect(state2.npcs[0].lastNotes).toBe('Met Lannis at the solar.');

        // Test case 2: Start with "Confessor Lannis" and update with "Lannis"
        const state3 = gameReducer(initialGameState, {
            type: 'UPDATE_NPC',
            payload: {
                name: 'Confessor Lannis',
                disposition: 'friendly',
                relationshipTension: 'Lannis knows a secret.',
            },
        });
        expect(state3.npcs).toHaveLength(1);
        expect(state3.npcs[0].name).toBe('Confessor Lannis');

        const state4 = gameReducer(state3, {
            type: 'UPDATE_NPC',
            payload: {
                name: 'Lannis',
                disposition: 'friendly',
                lastNotes: 'Met Lannis at the solar.',
            },
        });
        expect(state4.npcs).toHaveLength(1);
        expect(state4.npcs[0].name).toBe('Confessor Lannis'); // Keeps the longer name
        expect(state4.npcs[0].lastNotes).toBe('Met Lannis at the solar.');
    });
});