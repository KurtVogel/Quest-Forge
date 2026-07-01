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

describe('gameReducer NPC archive/migration actions', () => {
    it('ARCHIVE_NPC demotes a single NPC to an archived creature and unpins it', () => {
        const state = {
            ...initialGameState,
            npcs: [{ id: 'npc-1', name: 'Captain Voss', rosterTier: 'character', kind: 'character', pinned: true }],
        };
        const next = gameReducer(state, { type: 'ARCHIVE_NPC', payload: { id: 'npc-1' } });
        expect(next.npcs[0].rosterTier).toBe('archived_creature');
        expect(next.npcs[0].kind).toBe('creature');
        expect(next.npcs[0].pinned).toBe(false);
    });

    it('ARCHIVE_NPC leaves non-matching NPCs untouched', () => {
        const state = {
            ...initialGameState,
            npcs: [{ id: 'npc-1', name: 'Captain Voss', rosterTier: 'character' }],
        };
        const next = gameReducer(state, { type: 'ARCHIVE_NPC', payload: { id: 'does-not-exist' } });
        expect(next.npcs[0].rosterTier).toBe('character');
    });

    it('ARCHIVE_NPC_BULK archives every listed id', () => {
        const state = {
            ...initialGameState,
            npcs: [
                { id: 'npc-1', name: 'Goblin #1', rosterTier: 'archived_creature', kind: 'creature' },
                { id: 'npc-2', name: 'Goblin #2', rosterTier: 'archived_creature', kind: 'creature' },
            ],
        };
        const next = gameReducer(state, { type: 'ARCHIVE_NPC_BULK', payload: { ids: ['npc-1', 'npc-2'] } });
        expect(next.npcs.every(npc => npc.rosterTier === 'archived_creature')).toBe(true);
    });

    it('ARCHIVE_NPC_BULK is a no-op with an empty id list', () => {
        const state = { ...initialGameState, npcs: [{ id: 'npc-1', name: 'Captain Voss' }] };
        const next = gameReducer(state, { type: 'ARCHIVE_NPC_BULK', payload: { ids: [] } });
        expect(next).toBe(state);
    });

    it('ARCHIVE_GENERIC_FODDER sweeps unpinned generic-named creatures into the archive', () => {
        const state = {
            ...initialGameState,
            npcs: [
                { id: 'npc-1', name: 'Goblin #12', rosterTier: 'character', kind: 'creature', lastNotes: 'Killed in combat.' },
                { id: 'npc-2', name: 'Captain Voss', rosterTier: 'character', kind: 'character' },
            ],
        };
        const next = gameReducer(state, { type: 'ARCHIVE_GENERIC_FODDER' });
        const goblin = next.npcs.find(npc => npc.id === 'npc-1');
        const captain = next.npcs.find(npc => npc.id === 'npc-2');
        expect(goblin.rosterTier).toBe('archived_creature');
        expect(captain.rosterTier).toBe('character');
    });

    it('ARCHIVE_GENERIC_FODDER is a no-op when nothing qualifies', () => {
        const state = { ...initialGameState, npcs: [{ id: 'npc-1', name: 'Captain Voss', rosterTier: 'character' }] };
        const next = gameReducer(state, { type: 'ARCHIVE_GENERIC_FODDER' });
        expect(next).toBe(state);
    });

    it('MIGRATE_NPC_ROSTER backfills rosterTier on legacy records missing it', () => {
        const state = { ...initialGameState, npcs: [{ id: 'npc-1', name: 'Captain Voss', disposition: 'hostile' }] };
        const next = gameReducer(state, { type: 'MIGRATE_NPC_ROSTER' });
        expect(next.npcs[0].rosterTier).toBeTruthy();
    });

    it('MIGRATE_NPC_ROSTER is a no-op when every NPC already has a rosterTier', () => {
        const state = { ...initialGameState, npcs: [{ id: 'npc-1', name: 'Captain Voss', rosterTier: 'character' }] };
        const next = gameReducer(state, { type: 'MIGRATE_NPC_ROSTER' });
        expect(next).toBe(state);
    });
});