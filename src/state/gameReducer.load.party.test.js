/**
 * Companions get the same load sanitizer as the hero and enemies (2026-09-09
 * audit P1): an object-only filter let a string attackBonus concatenate into
 * "+40" and throw out of EVERY exchange (a deadlock — no rest, no removal
 * mid-fight) and an unbounded damage string one-shot a fight for 1,099,957.
 */
import { describe, expect, it } from 'vitest';
import { gameReducer, initialGameState } from './gameReducer.js';
import { COMBAT_PHASES, normalizeCombatExchange, planCombatExchange } from '../engine/combatExchange.js';

const base = {
    character: {
        name: 'Vesa', race: 'human', class: 'fighter', level: 2, exp: 0, currentHP: 20, maxHP: 20, armorClass: 16,
        abilityScores: { strength: 16, dexterity: 12, constitution: 14, intelligence: 10, wisdom: 10, charisma: 8 },
        skillProficiencies: [], conditions: [],
    },
    inventory: [{ id: 'sword', name: 'Longsword', type: 'weapon', category: 'martialMelee', damage: '1d8', equipped: true }],
    messages: [],
};

const load = (party) => gameReducer(initialGameState, { type: 'LOAD_GAME', payload: { ...base, party } });

describe('LOAD_GAME party sanitizer', () => {
    it('coerces a string attackBonus and bounds an absurd damage string', () => {
        const next = load([{
            id: 'wit', name: 'Wit', hp: 10, maxHp: 10, ac: 13,
            // A non-catalog weapon: catalog names ("Rusty Club" → club) rederive
            // their dice from the catalog by design, which would hide the bound.
            attackBonus: '+4', damage: '100d1000+1000000', weapon: 'Sharpened Oar', status: 'healthy',
        }]);
        const wit = next.party[0];
        expect(wit.attackBonus).toBe(4);
        expect(wit.damage).toBe('1d4+1');
        expect(wit.id).toBe('wit');
    });

    it('drops null/array entries and derives an unknown status from HP', () => {
        const next = load([
            null,
            ['not', 'a', 'companion'],
            { id: 'a', name: 'Aune', hp: 2, maxHp: 10, ac: 12, attackBonus: 3, damage: '1d6+1', status: 'zzz' },
            { id: 'b', name: 'Bran', hp: 0, maxHp: 10, ac: 12, attackBonus: 3, damage: '1d6+1', status: 'dead' },
        ]);
        expect(next.party.map(c => c.id)).toEqual(['a', 'b']);
        expect(next.party[0].status).toBe('critical');
        expect(next.party[1].status).toBe('dead');
    });

    it('keeps a mid-fight sustained-spell AC buff (clamped) and types text fields', () => {
        const next = load([{
            id: 'a', name: 'Aune', hp: 10, maxHp: 10, ac: 12, attackBonus: 3, damage: '1d6+1',
            spellAcBonus: '3', appearance: { look: 'x' }, notes: ['y'], role: { r: 1 },
        }]);
        expect(next.party[0].spellAcBonus).toBe(3);
        expect(next.party[0].appearance).toBe('');
        expect(next.party[0].notes).toBe('');
        expect(next.party[0].role).toBe('ally');
    });

    it('a loaded companion with pre-fix junk stats fights instead of deadlocking the exchange', () => {
        const loaded = load([{
            id: 'wit', name: 'Wit', hp: 10, maxHp: 10, ac: 13,
            attackBonus: '+4', damage: { dice: '1d6' }, weapon: 'Rusty Club', status: 'healthy',
        }]);
        const state = {
            ...loaded,
            combat: {
                active: true,
                phase: COMBAT_PHASES.AWAITING_PLAYER,
                round: 1,
                // Real dice here (no mock): a tough foe so the hero's own strike can
                // never fell it before the companion's slot resolves.
                enemies: [{ id: 'Goblin', name: 'Goblin', hp: 60, maxHp: 60, ac: 12, attackBonus: 4, damage: '1d6+2', condition: 'healthy', conditions: [], combatStatus: 'active' }],
                turnOrder: [{ type: 'player', name: 'Vesa', initiative: 15 }],
                currentTurn: 0,
            },
        };
        const intent = normalizeCombatExchange({
            player_slots: [{ action: 'attack', strikes: [{ target: 'Goblin' }] }],
            companion_intents: [{ companion_id: 'wit', action: 'attack', target: 'Goblin' }],
            enemy_intents: [{ enemy_id: 'Goblin', action: 'attack', target: 'player' }],
        });
        let plan;
        expect(() => { plan = planCombatExchange(state, intent); }).not.toThrow();
        expect(plan.ok).toBe(true);
        const companionEvent = plan.payload.result.events.find(event => event.actor === 'Wit');
        expect(companionEvent).toBeTruthy();
    });
});
