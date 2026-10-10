/**
 * The 2026-10-10 strengthening sweep's reducer pins: START_COMBAT composes an
 * enemy through the typed composer (an object name is no longer a turnable
 * undead on the reducer lane), the long rest clears `exhaustion` as it clears
 * `exhausted`, and the party status whitelist derives from the health ladder.
 */
import { describe, expect, it } from 'vitest';
import { gameReducer, initialGameState } from './gameReducer.js';
import { COMPANION_STATUSES, companionStatus } from './handlers/shared.js';
import { HEALTH_WORDS } from '../engine/enemyStats.js';

function makeState(overrides = {}) {
    return {
        ...initialGameState,
        character: {
            name: 'Testo', race: 'human', class: 'fighter', level: 2,
            currentHP: 12, maxHP: 20,
            abilityScores: { strength: 16, dexterity: 12, constitution: 14, intelligence: 10, wisdom: 10, charisma: 8 },
            hitDice: { total: 2, remaining: 2, die: 10 },
            classResources: {},
            conditions: [],
        },
        messages: [],
        party: [],
        ...overrides,
    };
}

describe('START_COMBAT composes through the typed enemy composer (enemy-stats P2, 2026-10-09)', () => {
    it('an object name and a string flag field a plain foe, never "[object Object]" as a turnable undead', () => {
        const next = gameReducer(makeState(), {
            type: 'START_COMBAT',
            payload: { enemies: [{ name: { x: 1 }, hp: 9, ac: 10, isUndead: 'false', conditions: 'prone', boss: 'true' }] },
        });
        expect(next.combat.active).toBe(true);
        const [foe] = next.combat.enemies;
        expect(foe).toMatchObject({ name: 'Enemy 1', isUndead: false, boss: false, conditions: ['prone'], hp: 9, maxHp: 9, condition: 'healthy', combatStatus: 'active', defending: false });
        expect(foe.id).not.toContain('object');
        expect(Number.isFinite(foe.initiative)).toBe(true);
    });

    it('offensive stats the DM gave ride validated; absent ones stay absent for the engine default', () => {
        const next = gameReducer(makeState(), {
            type: 'START_COMBAT',
            payload: { enemies: [
                { name: 'Archer', hp: 9, ac: 10, attackBonus: '+5', damage: '1d8+1 piercing', saveBonus: 2 },
                { name: 'Thug', hp: 9, ac: 10, attackBonus: 99 },
            ] },
        });
        const [archer, thug] = next.combat.enemies;
        expect(archer).toMatchObject({ attackBonus: 5, damage: '1d8+1', saveBonus: 2 });
        expect(thug).not.toHaveProperty('attackBonus');
        expect(thug).not.toHaveProperty('damage');
    });
});

describe('the long rest reads the condition table (rules-math P2, 2026-10-09)', () => {
    it('clears `exhaustion` and `exhausted` alike, keeps what no rest clears', () => {
        const state = makeState({ character: { ...makeState().character, conditions: ['exhaustion', 'exhausted', 'poisoned', 'cursed', 'Blinded'] } });
        const next = gameReducer(state, { type: 'TAKE_REST', payload: 'long' });
        expect(next.character.conditions).toEqual(['cursed']);
    });

    it('a short rest clears nothing of the list', () => {
        const state = makeState({ character: { ...makeState().character, conditions: ['exhausted', 'poisoned'] } });
        const next = gameReducer(state, { type: 'TAKE_REST', payload: 'short' });
        expect(next.character.conditions).toEqual(['exhausted', 'poisoned']);
    });
});

describe('the party status whitelist derives from the health ladder (enemy-stats nit, 2026-10-09)', () => {
    it('is the ladder words plus the companion down word and the explicit dead', () => {
        expect([...COMPANION_STATUSES]).toEqual([...HEALTH_WORDS, 'downed', 'dead']);
        for (const [hp, max] of [[10, 10], [5, 10], [2, 10], [0, 10]]) {
            expect(COMPANION_STATUSES.has(companionStatus(hp, max))).toBe(true);
        }
    });

    it('LOAD_GAME keeps a ladder status and re-derives an unknown one from HP', () => {
        const loaded = gameReducer(initialGameState, {
            type: 'LOAD_GAME',
            payload: {
                ...makeState(),
                party: [
                    { id: 'c1', name: 'Garrick', level: 1, hp: 2, maxHp: 20, ac: 12, weapon: 'Dagger', status: 'critical' },
                    { id: 'c2', name: 'Mira', level: 1, hp: 20, maxHp: 20, ac: 11, weapon: 'Dagger', status: 'sleepy' },
                ],
            },
        });
        expect(loaded.party.map(c => c.status)).toEqual(['critical', 'healthy']);
    });
});
