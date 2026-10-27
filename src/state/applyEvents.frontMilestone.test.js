/**
 * One DM reply must not pay a WHOLE level (2026-10-27 progression P2,
 * measured): `front_updates: resolved` pays the front tier (half a level) in
 * UPDATE_FRONT, and a `level_up: true` beside it paid the story-milestone tier
 * (the same half) — L1 / 0 XP → Level 2 from one response. The quest
 * precedent: the DM's XP lanes are dropped beside a resolution of a LIVE front.
 */
import { describe, expect, it, vi } from 'vitest';
import { applyEvents } from './applyEvents.js';
import { normalizeEvents } from '../llm/eventChannels.js';
import { gameReducer, initialGameState } from './gameReducer.js';

const baseState = (frontStatus = 'active') => ({
    character: { level: 1, exp: 0, currentHP: 10, maxHP: 10, gold: 0, silver: 0, copper: 0, classResources: {}, class: 'fighter' },
    inventory: [],
    party: [],
    combat: { active: false },
    messages: [],
    fronts: [{ id: 'front-ash', title: 'The Ash Cult', status: frontStatus, clock: 3, stage: 1 }],
});

const types = dispatch => dispatch.mock.calls.map(([action]) => action.type);

describe('applyEvents: the DM XP lanes beside a front resolution', () => {
    it('drops level_up and exp_awarded beside a resolution of a live front', () => {
        const dispatch = vi.fn();
        const events = normalizeEvents({
            front_updates: [{ id: 'front-ash', status: 'resolved', notes: 'The cult is broken.' }],
            level_up: true,
            exp_awarded: 50,
        });
        applyEvents(events, dispatch, () => baseState());
        expect(types(dispatch)).toContain('UPDATE_FRONT');
        expect(types(dispatch)).not.toContain('LEVEL_UP');
        expect(types(dispatch)).not.toContain('ADD_EXP');
    });

    it('keeps level_up when the resolution names a front that is already resolved', () => {
        const dispatch = vi.fn();
        const events = normalizeEvents({
            front_updates: [{ id: 'front-ash', status: 'resolved' }],
            level_up: true,
        });
        applyEvents(events, dispatch, () => baseState('resolved'));
        expect(types(dispatch)).toContain('LEVEL_UP');
    });

    it('keeps level_up beside an ordinary (non-resolving) front update', () => {
        const dispatch = vi.fn();
        const events = normalizeEvents({
            front_updates: [{ id: 'front-ash', clock: 4 }],
            level_up: true,
        });
        applyEvents(events, dispatch, () => baseState());
        expect(types(dispatch)).toContain('LEVEL_UP');
        // The payload carries no `reason` the handler never read (2026-10-27 nit).
        const levelUp = dispatch.mock.calls.find(([a]) => a.type === 'LEVEL_UP')[0];
        expect(levelUp.payload).not.toHaveProperty('reason');
    });

    it('through the reducer: one reply resolving a front at L1 / 0 XP stays at level 1', () => {
        let state = { ...initialGameState, ...baseState() };
        const dispatch = action => { state = gameReducer(state, action); };
        const events = normalizeEvents({
            front_updates: [{ id: 'front-ash', status: 'resolved', notes: 'The cult is broken.' }],
            level_up: true,
        });
        applyEvents(events, dispatch, () => state);
        expect(state.character.level).toBe(1);
        expect(state.character.exp).toBe(150);
    });
});
