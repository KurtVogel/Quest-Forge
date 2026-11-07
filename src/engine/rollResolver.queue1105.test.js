/**
 * The 2026-11-05 strengthening queue, dice-engine (from the 2026-10-31
 * audit): the out-of-combat resolver ledgers only the HERO's dice. An NPC
 * attack / save / damage and a companion's swing post their chat line with
 * no ADD_ROLL (the exchange's `heroRolls` precedent), and `onDiceLanded`
 * tells the runner those dice landed (its "did dice land" probe reads the
 * ledger). The hero's own rolls still ledger.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { handleRequestedRolls, resolveRolls } from './rollResolver.js';

const { rollQueue } = vi.hoisted(() => ({ rollQueue: [] }));

vi.mock('./dice.ts', async (importOriginal) => {
    const actual = await importOriginal();
    let id = 0;
    const makeResult = (rolls, modifier, description) => {
        const subtotal = rolls.reduce((a, b) => a + b, 0);
        return {
            id: `q1105-roll-${++id}`,
            timestamp: 0,
            notation: '',
            dice: { count: rolls.length, sides: 20 },
            rolls,
            subtotal,
            modifier,
            total: subtotal + modifier,
            description,
            isCritical: rolls.length === 1 && rolls[0] === 20,
            isCritFail: rolls.length === 1 && rolls[0] === 1,
        };
    };
    const draw = () => {
        if (!rollQueue.length) throw new Error('dice queue exhausted — a test under-queued its rolls');
        return rollQueue.shift();
    };
    return {
        ...actual,
        rollWithModifier: (count, sides, modifier = 0, description = '') =>
            makeResult(Array.from({ length: count }, draw), modifier, description),
        rollNotation: (notation, description = '') => {
            const { count, modifier } = actual.parseNotation(notation);
            return makeResult(Array.from({ length: count }, draw), modifier, description);
        },
        rollDie: () => draw(),
        rollDice: (count) => Array.from({ length: count }, draw),
    };
});

const hero = {
    name: 'Testo', class: 'fighter', level: 2, currentHP: 12, maxHP: 20,
    abilityScores: { strength: 16, dexterity: 12, constitution: 14, intelligence: 10, wisdom: 10, charisma: 8 },
    savingThrowProficiencies: ['strength', 'constitution'], skillProficiencies: [], conditions: [],
};
const garrick = { id: 'c1', name: 'Garrick', hp: 18, maxHp: 18, ac: 14, attackBonus: 4, status: 'healthy' };

function resolve(rolls, { party = [] } = {}) {
    const dispatch = vi.fn();
    const onDiceLanded = vi.fn();
    const { results } = resolveRolls(rolls, { character: hero, inventory: [], party, dispatch, onDiceLanded });
    const types = dispatch.mock.calls.map(([a]) => a.type);
    return { results, dispatch, onDiceLanded, types };
}

beforeEach(() => { rollQueue.length = 0; });

describe('other actors\' dice never enter the roll ledger (2026-11-05)', () => {
    it('npc_attack on the hero: to-hit and damage post chat lines, no ADD_ROLL; HP still applies', () => {
        rollQueue.push(18, 4);
        const { results, types, onDiceLanded } = resolve([{ type: 'npc_attack', attacker: 'Goblin', modifier: 2, damage: '1d6' }]);
        expect(results[0]).toMatchObject({ success: true, targetIsPlayer: true, damage: 4 });
        expect(types).not.toContain('ADD_ROLL');
        expect(types.filter(t => t === 'ADD_MESSAGE')).toHaveLength(2);
        expect(types).toContain('TAKE_DAMAGE');
        expect(onDiceLanded).toHaveBeenCalled();
    });

    it('npc_attack on a companion: no ADD_ROLL', () => {
        rollQueue.push(15, 4);
        const { types, onDiceLanded } = resolve([{ type: 'npc_attack', attacker: 'Wolf', target: 'Garrick', modifier: 3, damage: '1d6' }], { party: [garrick] });
        expect(types).not.toContain('ADD_ROLL');
        expect(types).toContain('UPDATE_COMPANION');
        expect(onDiceLanded).toHaveBeenCalled();
    });

    it('npc_attack on an untracked third party: no ADD_ROLL', () => {
        rollQueue.push(15);
        const { types, onDiceLanded } = resolve([{ type: 'npc_attack', attacker: 'Guard', target: 'the merchant', modifier: 3, dc: 12 }]);
        expect(types).toEqual(['ADD_MESSAGE']);
        expect(onDiceLanded).toHaveBeenCalled();
    });

    it('npc_save: no ADD_ROLL', () => {
        rollQueue.push(9);
        const { results, types, onDiceLanded } = resolve([{ type: 'npc_save', attacker: 'Cultist', skill: 'wisdom', modifier: 1, dc: 13 }]);
        expect(results[0]).toMatchObject({ type: 'npc_save', success: false });
        expect(types).toEqual(['ADD_MESSAGE']);
        expect(onDiceLanded).toHaveBeenCalled();
    });

    it('companion_attack: no ADD_ROLL', () => {
        rollQueue.push(14);
        const { types, onDiceLanded } = resolve([{ type: 'companion_attack', attackerId: 'c1', dc: 13 }], { party: [garrick] });
        expect(types).toEqual(['ADD_MESSAGE']);
        expect(onDiceLanded).toHaveBeenCalled();
    });

    it('the hero\'s own check still ledgers, and is not reported as another actor\'s dice', () => {
        rollQueue.push(12);
        const { types, onDiceLanded } = resolve([{ type: 'skill_check', skill: 'athletics', dc: 10 }]);
        expect(types).toContain('ADD_ROLL');
        expect(onDiceLanded).not.toHaveBeenCalled();
    });

    it('handleRequestedRolls threads onDiceLanded so the runner hears an NPC-only batch landed', async () => {
        rollQueue.push(9);
        const dispatch = vi.fn();
        const onDiceLanded = vi.fn();
        const state = { character: hero, inventory: [], party: [], combat: { active: false } };
        await handleRequestedRolls([{ type: 'npc_save', attacker: 'Cultist', skill: 'wisdom', dc: 13 }], {
            getState: () => state,
            dispatch,
            sendToLLM: vi.fn().mockResolvedValue(null),
            onDiceLanded,
        });
        expect(onDiceLanded).toHaveBeenCalledTimes(1);
        expect(dispatch.mock.calls.map(([a]) => a.type)).not.toContain('ADD_ROLL');
    });
});

describe('an npc_attack tests the companion before the hero (2026-11-07, identity by reference)', () => {
    const mikaStone = { ...hero, name: 'Mika Stone' };
    const mika = { id: 'c-mika', name: 'Mika', hp: 18, maxHp: 18, ac: 12, attackBonus: 4, status: 'healthy' };
    const swing = (target, party) => {
        rollQueue.push(18, 4);
        const dispatch = vi.fn();
        resolveRolls([{ type: 'npc_attack', attacker: 'Raider', target, modifier: 2, damage: '1d6' }], { character: mikaStone, inventory: [], party, dispatch });
        return dispatch.mock.calls.map(([action]) => action);
    };
    const hitHero = actions => actions.some(action => action.type === 'TAKE_DAMAGE');
    const hitCompanion = actions => actions.some(action => action.type === 'UPDATE_COMPANION' && action.payload.id === 'c-mika');

    it('a hit aimed at "Mika" beside a hero "Mika Stone" lands on the companion', () => {
        const actions = swing('Mika', [mika]);
        expect(hitCompanion(actions)).toBe(true);
        expect(hitHero(actions)).toBe(false);
    });

    it('with no such companion the short name is the hero', () => {
        expect(hitHero(swing('Mika', []))).toBe(true);
    });

    it('the self words stay the hero with the companion beside her', () => {
        const actions = swing('the hero', [mika]);
        expect(hitHero(actions)).toBe(true);
        expect(hitCompanion(actions)).toBe(false);
    });
});
