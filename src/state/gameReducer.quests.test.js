import { describe, expect, it } from 'vitest';
import { gameReducer, initialGameState } from './gameReducer.js';

describe('quest identity', () => {
    it('updates an existing active quest instead of duplicating its normalized name', () => {
        const first = gameReducer(initialGameState, {
            type: 'ADD_QUEST',
            payload: { name: "The Alderman's Bounty", description: 'Speak to Alderman Thorne.' },
        });
        const second = gameReducer(first, {
            type: 'ADD_QUEST',
            payload: { name: "The Alderman’s Bounty", description: 'Clear the goblin threat.' },
        });

        expect(second.quests).toHaveLength(1);
        expect(second.quests[0]).toMatchObject({
            name: "The Alderman’s Bounty",
            description: 'Clear the goblin threat.',
            status: 'active',
        });
        expect(second.quests[0].id).toBe(first.quests[0].id);
    });

    it('completes a quest by stable id or normalized name', () => {
        const added = gameReducer(initialGameState, {
            type: 'ADD_QUEST',
            payload: { id: 'quest-bounty', name: "The Alderman's Bounty" },
        });
        const byName = gameReducer(added, {
            type: 'COMPLETE_QUEST',
            payload: { name: "the alderman’s bounty" },
        });

        expect(byName.quests[0].status).toBe('completed');
    });
});
