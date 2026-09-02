/**
 * applyEvents' player_death routing goes through THE engine low-level-solo
 * predicate (a downed companion counts as solo), never a party-length check
 * (2026-09-02 combat-exchange audit P1: the old local check sent a level-1
 * hero with a downed companion into the irreversible isDead branch).
 */
import { describe, expect, it, vi } from 'vitest';
import { applyEvents } from './applyEvents.js';
import { normalizeEvents } from '../llm/eventChannels.js';

const playerDeath = description => normalizeEvents({ player_death: { description } });

function run(state, description = 'The warden leaves you bleeding in the snow.') {
    const dispatch = vi.fn();
    applyEvents(playerDeath(description), dispatch, () => state);
    return dispatch;
}

describe('applyEvents player_death routing', () => {
    it('a level-1 hero with a DOWNED companion is rerouted to PLAYER_DEFEAT, never isDead', () => {
        const dispatch = run({
            character: { level: 1, currentHP: 0 },
            party: [{ id: 'c1', name: 'Brann', hp: 0, maxHp: 8, status: 'downed' }],
        });
        expect(dispatch).toHaveBeenCalledWith({
            type: 'PLAYER_DEFEAT',
            payload: { description: 'The warden leaves you bleeding in the snow.' },
        });
        expect(dispatch).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'UPDATE_CHARACTER' }));
        expect(dispatch).not.toHaveBeenCalledWith(expect.objectContaining({
            payload: expect.objectContaining({ isDead: true }),
        }));
    });

    it('a level-2 hero with no party at all still gets the setback', () => {
        const dispatch = run({ character: { level: 2 }, party: [] });
        expect(dispatch).toHaveBeenCalledWith(expect.objectContaining({ type: 'PLAYER_DEFEAT' }));
    });

    it('a level-1 hero with a STANDING companion is not solo: the narrative death applies', () => {
        const dispatch = run({
            character: { level: 1, currentHP: 0 },
            party: [{ id: 'c1', name: 'Brann', hp: 6, maxHp: 8, status: 'healthy' }],
        });
        expect(dispatch).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'PLAYER_DEFEAT' }));
        expect(dispatch).toHaveBeenCalledWith({
            type: 'UPDATE_CHARACTER',
            payload: { currentHP: 0, isDead: true, dying: false },
        });
    });

    it('a level-3 hero with a downed companion is above the protected levels (behaviour unchanged, DECISIONS question open)', () => {
        const dispatch = run({
            character: { level: 3, currentHP: 0 },
            party: [{ id: 'c1', name: 'Brann', hp: 0, maxHp: 8, status: 'downed' }],
        });
        expect(dispatch).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'PLAYER_DEFEAT' }));
        expect(dispatch).toHaveBeenCalledWith(expect.objectContaining({
            type: 'UPDATE_CHARACTER',
            payload: expect.objectContaining({ isDead: true }),
        }));
    });
});
