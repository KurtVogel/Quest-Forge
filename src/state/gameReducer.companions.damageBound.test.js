/**
 * Companion damage bound on BOTH normalizeCompanion branches (2026-09-09 audit
 * P1): the no-weapon-change branch stored the DM's damage raw and the
 * weapon-change branch's 20-char slice admitted "9d1000+99999999999".
 */
import { describe, expect, it } from 'vitest';
import { gameReducer, initialGameState } from './gameReducer.js';
import { boundCompanionDamage } from './handlers/shared.js';

const add = (payload) => gameReducer(initialGameState, { type: 'ADD_COMPANION', payload: { id: 'c1', name: 'Wit', hp: 10, maxHp: 10, ...payload } });
const companion = (state) => state.party.find(c => c.id === 'c1');

describe('boundCompanionDamage', () => {
    it('caps dice at the best catalog profile and the flat bonus at companion competence', () => {
        expect(boundCompanionDamage('100d1000+1000000', 'Rusty Club')).toBe('1d4+1');
        expect(boundCompanionDamage('9d1000+99999999999', 'Bone Axe')).toBe('1d4+1');
        expect(boundCompanionDamage('3d6+2', 'Great Club')).toBe('2d6+2');
        expect(boundCompanionDamage('2d6+50', 'x')).toBe('2d6+8');
        expect(boundCompanionDamage('1d8+2 slashing', 'x')).toBe('1d8+2');
        expect(boundCompanionDamage('1d8-3', 'x')).toBe('1d8');
        expect(boundCompanionDamage('1d6', 'x')).toBe('1d6');
        expect(boundCompanionDamage({ dice: '1d6' }, 'longsword')).toBe('1d8+2');
        expect(boundCompanionDamage('', 'dagger')).toBe('1d4+2');
    });
});

describe('ADD_COMPANION / UPDATE_COMPANION damage', () => {
    it('bounds the raw branch — an entry WITHOUT a weapon takes the damage field straight in', () => {
        const state = add({ damage: '100d1000+1000000' });
        expect(companion(state).damage).toBe('1d4+2');
    });

    it('bounds the weapon-change branch for a non-catalog weapon', () => {
        const state = gameReducer(add({ weapon: 'Dagger' }), {
            type: 'UPDATE_COMPANION',
            payload: { id: 'c1', weapon: 'Sharpened Oar', damage: '9d1000+99999999999' },
        });
        expect(companion(state).damage).toBe('1d4+1');
    });

    it('keeps a sane non-catalog damage string, stripping a trailing damage type', () => {
        const state = gameReducer(add({ weapon: 'Dagger' }), {
            type: 'UPDATE_COMPANION',
            payload: { id: 'c1', weapon: 'Sharpened Oar', damage: '1d8+2 bludgeoning' },
        });
        expect(companion(state).damage).toBe('1d8+2');
    });

    it('types appearance/notes/role — an object here threw at Scene mode', () => {
        const state = add({ appearance: { look: 'x' }, notes: 42, role: ['guide'] });
        expect(companion(state).appearance).toBe('');
        expect(companion(state).notes).toBe('');
        expect(companion(state).role).toBe('ally');
    });
});
