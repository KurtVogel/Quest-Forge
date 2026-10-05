/**
 * 2026-09-27 enemy-stats Lap-3 test depth: the trailing-damage-type warn
 * (`sanitizeEnemyDamage`, 2026-09-15) fires ONCE per fight — at the parser,
 * where the DM's "2d8+4 bludgeoning" is cleaned — and never again at
 * START_COMBAT (which re-validates the CLEANED notation) or per enemy attack.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { rollQueue } = vi.hoisted(() => ({ rollQueue: [] }));

vi.mock('../engine/dice.ts', () => {
    let id = 0;
    const draw = () => {
        if (!rollQueue.length) throw new Error('dice queue exhausted — a test under-queued its rolls');
        return rollQueue.shift();
    };
    const makeResult = (rolls, modifier, description, sides = 20) => {
        const subtotal = rolls.reduce((sum, roll) => sum + roll, 0);
        return { id: `dw-${++id}`, timestamp: 0, notation: `${rolls.length}d${sides}`, dice: { count: rolls.length, sides }, rolls, subtotal, modifier, total: subtotal + modifier, description, isCritical: false, isCritFail: false };
    };
    const parseNotation = notation => {
        const m = String(notation).replace(/\s+/g, '').match(/^(\d+)d(\d+)([+-]\d+)?$/i);
        if (!m) throw new Error(`Invalid notation: ${notation}`);
        return { count: Number(m[1]), sides: Number(m[2]), modifier: m[3] ? Number(m[3]) : 0 };
    };
    return {
        parseNotation,
        rollDie: () => draw(),
        rollDice: (count) => Array.from({ length: count }, draw),
        rollWithModifier: (count, sides, modifier = 0, description = '') => makeResult(Array.from({ length: count }, draw), modifier, description, sides),
        rollNotation: (notation, description = '') => { const p = parseNotation(notation); return makeResult(Array.from({ length: p.count }, draw), p.modifier, description || notation, p.sides); },
    };
});

const { gameReducer, initialGameState } = await import('./gameReducer.js');
const { parseResponse } = await import('../llm/responseParser.js');
const { normalizeCombatExchange } = await import('../engine/combatWire.js');
const { planCombatExchange } = await import('../engine/combatExchange.js');

const RESPONSE = 'The brute lunges.\n```json\n{"combat_start": {"enemies": [{"id": "brute-1", "name": "Brute", "hp": 20, "ac": 13, "attack_bonus": 4, "damage": "2d8+4 bludgeoning"}], "surprise": "none"}}\n```';

let warn;
beforeEach(() => {
    rollQueue.length = 0;
    warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => warn.mockRestore());

const typeWarns = () => warn.mock.calls.filter(call => String(call[0]).includes('[enemyStats] Dropped trailing damage type'));

describe('the damage-type coercion warn fires once per fight', () => {
    it('parser once; START_COMBAT on the cleaned notation none; three enemy attacks none', () => {
        const { events } = parseResponse(RESPONSE);
        expect(events.combatStart.enemies[0].damage).toBe('2d8+4');
        expect(typeWarns()).toHaveLength(1);

        rollQueue.push(7, 15); // enemy initiative, player initiative
        let state = gameReducer({
            ...initialGameState,
            character: { name: 'Astra', race: 'human', class: 'fighter', level: 3, currentHP: 30, maxHP: 30, armorClass: 16, abilityScores: { strength: 16, dexterity: 12, constitution: 14, intelligence: 10, wisdom: 10, charisma: 8 }, conditions: [], classResources: {} },
            inventory: [], party: [], messages: [], rollHistory: [],
        }, { type: 'START_COMBAT', payload: { enemies: events.combatStart.enemies, surprise: events.combatStart.surprise } });
        expect(state.combat.enemies[0].damage).toBe('2d8+4');
        expect(typeWarns()).toHaveLength(1);

        for (let round = 0; round < 3; round++) {
            rollQueue.push(12, 3, 4); // the brute's d20, then 2d8
            const plan = planCombatExchange(state, normalizeCombatExchange({ player_slots: [{ action: 'dodge' }] }));
            expect(plan.ok).toBe(true);
            expect(plan.payload.result.events.some(e => e.type === 'attack' && e.actor === 'Brute')).toBe(true);
            state = gameReducer(state, { type: 'APPLY_COMBAT_EXCHANGE', payload: plan.payload });
            state = gameReducer(state, { type: 'COMPLETE_COMBAT_NARRATION', payload: { exchangeId: plan.payload.exchangeId } });
        }
        expect(typeWarns()).toHaveLength(1);
    });
});
