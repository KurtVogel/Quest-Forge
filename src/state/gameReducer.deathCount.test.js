/**
 * The count is on the page — the reducer twin (WOW 2026-09-30,
 * death-and-stakes): three committed exchanges with death saves 4 / 13 / 1
 * put three countdown lines on the chat, the reducer's tally agrees with the
 * engine's line at every step (one judge), the third failure kills, the
 * terminal narration prompt says DIED, and END_COMBAT posts the death line
 * with the fight's cost tally. The engine terminal stays `defeat`, so the
 * slain-XP rules are untouched.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { rollQueue } = vi.hoisted(() => ({ rollQueue: [] }));

vi.mock('../engine/dice.ts', () => {
    let id = 0;
    const draw = () => {
        if (!rollQueue.length) throw new Error('dice queue exhausted — a test under-queued its rolls');
        return rollQueue.shift();
    };
    const makeResult = (rolls, modifier, description, sides = 20) => {
        const subtotal = rolls.reduce((sum, roll) => sum + roll, 0);
        return {
            id: `death-count-${++id}`, timestamp: 0, notation: `${rolls.length}d${sides}`, dice: { count: rolls.length, sides },
            rolls, subtotal, modifier, total: subtotal + modifier, description,
            isCritical: rolls.length === 1 && sides === 20 && rolls[0] === 20,
            isCritFail: rolls.length === 1 && sides === 20 && rolls[0] === 1,
        };
    };
    const parseNotation = notation => {
        const match = String(notation).replace(/\s+/g, '').match(/^(\d+)d(\d+)([+-]\d+)?$/i);
        if (!match) throw new Error(`Invalid notation: ${notation}`);
        return { count: Number(match[1]), sides: Number(match[2]), modifier: match[3] ? Number(match[3]) : 0 };
    };
    return {
        parseNotation,
        rollDie: () => draw(),
        rollDice: (count) => Array.from({ length: count }, draw),
        rollWithModifier: (count, sides, modifier = 0, description = '') => makeResult(Array.from({ length: count }, draw), modifier, description, sides),
        rollNotation: (notation, description = '') => makeResult([draw()], 0, description || notation),
    };
});

const { gameReducer, initialGameState } = await import('./gameReducer.js');
const { COMBAT_PHASES } = await import('../engine/combatPredicates.js');
const { normalizeCombatExchange } = await import('../engine/combatWire.js');
const { planCombatExchange } = await import('../engine/combatExchange.js');
const { describeFightCost, startFightTally } = await import('../engine/fightTally.js');
const { combatNarrationPrompt } = await import('../llm/combatNarration.js');

function dyingState() {
    const base = {
        ...initialGameState,
        character: {
            name: 'Astra', race: 'human', class: 'fighter', level: 3, exp: 900, currentHP: 0, maxHP: 20, armorClass: 16,
            abilityScores: { strength: 16, dexterity: 12, constitution: 14, intelligence: 10, wisdom: 10, charisma: 8 },
            conditions: ['Unconscious'], dying: true, deathSaves: { successes: 0, failures: 0 }, isDead: false,
        },
        inventory: [],
        party: [{ id: 'companion-1', name: 'Tammo', hp: 10, maxHp: 10, ac: 12, status: 'healthy', attackBonus: 3, damage: '1d6' }],
        messages: [{ id: 'm1', role: 'user', content: 'I charge.' }, { id: 'm2', role: 'assistant', content: 'The goblin swings.' }],
        session: { ...initialGameState.session, id: 'death-count' },
    };
    return {
        ...base,
        combat: {
            ...initialGameState.combat,
            active: true,
            phase: COMBAT_PHASES.AWAITING_PLAYER,
            round: 2,
            enemies: [{ id: 'enemy-goblin', name: 'Goblin', hp: 6, maxHp: 10, ac: 12, attackBonus: 4, damage: '1d6+2', condition: 'bloodied', conditions: [], combatStatus: 'active' }],
            turnOrder: [{ type: 'player', name: 'Astra', initiative: 15 }, { type: 'companion', id: 'companion-1', name: 'Tammo', initiative: 10 }, { type: 'enemy', id: 'enemy-goblin', name: 'Goblin', initiative: 8 }],
            currentTurn: 0,
            fightTally: { ...startFightTally({ ...base, character: { ...base.character, currentHP: 20 } }), heroDroppedRound: 1, heroLowestHp: 0 },
        },
    };
}

const intent = normalizeCombatExchange({
    player_slots: [{ action: 'death_save' }],
    companion_intents: [{ companion_id: 'companion-1', action: 'guard' }],
    enemy_intents: [{ enemy_id: 'enemy-goblin', action: 'defend' }],
});

function commitRound(state, natural) {
    rollQueue.push(natural);
    const plan = planCombatExchange(state, intent);
    expect(plan.ok).toBe(true);
    const applied = gameReducer(state, { type: 'APPLY_COMBAT_EXCHANGE', payload: plan.payload });
    expect(applied.combat.phase).toBe(COMBAT_PHASES.AWAITING_NARRATION);
    return applied;
}

const deathLines = state => state.messages.filter(m => m.role === 'system' && String(m.content).startsWith('**Death Saving Throw:**')).map(m => m.content);

beforeEach(() => { rollQueue.length = 0; });

describe('death saves 4 / 13 / 1 through the reducer', () => {
    it('three committed exchanges put three countdown lines on the page, the tally agrees, the third failure kills, END_COMBAT posts the death line', () => {
        let state = commitRound(dyingState(), 4);
        expect(deathLines(state)).toEqual(['**Death Saving Throw:** natural **4** — failure (1/3). Two more and Astra dies.']);
        expect(state.character.deathSaves).toEqual({ successes: 0, failures: 1 });
        expect(state.character.dying).toBe(true);
        expect(state.combat.lastExchangeResult.postState.player).toMatchObject({ status: 'dying', deathSaves: { successes: 0, failures: 1 } });
        expect(combatNarrationPrompt(state.combat.lastExchangeResult)).toContain('- PLAYER DYING: Astra — 0/20 HP; death saves 0 successes / 1 failure — two more failures kill.');
        state = gameReducer(state, { type: 'COMPLETE_COMBAT_NARRATION', payload: { exchangeId: state.combat.lastExchangeResult.exchangeId } });
        expect(state.combat.active).toBe(true);
        expect(state.combat.phase).toBe(COMBAT_PHASES.AWAITING_PLAYER);

        state = commitRound(state, 13);
        expect(deathLines(state)).toEqual([
            '**Death Saving Throw:** natural **4** — failure (1/3). Two more and Astra dies.',
            '**Death Saving Throw:** natural **13** — success (1/3). Two more and Astra is stable.',
        ]);
        expect(state.character.deathSaves).toEqual({ successes: 1, failures: 1 });
        expect(combatNarrationPrompt(state.combat.lastExchangeResult)).toContain('death saves 1 success / 1 failure — two more failures kill.');
        state = gameReducer(state, { type: 'COMPLETE_COMBAT_NARRATION', payload: { exchangeId: state.combat.lastExchangeResult.exchangeId } });

        state = commitRound(state, 1);
        expect(deathLines(state)).toEqual([
            '**Death Saving Throw:** natural **4** — failure (1/3). Two more and Astra dies.',
            '**Death Saving Throw:** natural **13** — success (1/3). Two more and Astra is stable.',
            '**Death Saving Throw:** natural **1** — THE THIRD FAILURE. Astra dies.',
        ]);
        expect(state.character.isDead).toBe(true);
        expect(state.character.dying).toBe(false);
        // The line is posted ONCE: the exchange line owns it in combat; DEATH_SAVE_RESULT stays silent.
        expect(state.messages.filter(m => String(m.content).includes('THE THIRD FAILURE')).length).toBe(1);
        const result = state.combat.lastExchangeResult;
        expect(result.terminal).toBe('defeat');
        expect(result.postState.player).toMatchObject({ status: 'dead', deathSaves: { successes: 1, failures: 3 } });
        const cost = describeFightCost(state.combat.fightTally, state);
        const terminalPrompt = combatNarrationPrompt(result, { cost });
        expect(terminalPrompt).toContain('The player has DIED — the third failed death save. Narrate the death plainly and finally; the fight ends here.');
        expect(terminalPrompt).not.toContain('setback or collapse');
        expect(terminalPrompt).toContain('- PLAYER DEAD: Astra — 0/20 HP; the third failed death save. Dead');
        expect(terminalPrompt).toContain('COST OF THIS FIGHT');

        const ended = gameReducer(state, { type: 'COMPLETE_COMBAT_NARRATION', payload: { exchangeId: result.exchangeId } });
        expect(ended.combat.active).toBe(false);
        const deathLine = ended.messages.find(m => String(m.content).startsWith('☠ **Astra is dead.**'));
        expect(deathLine).toBeDefined();
        expect(deathLine.content).toContain('The third failed death save ends the story here.');
        expect(deathLine.content).toContain('COST OF THIS FIGHT: Astra 20→0 HP');
        expect(deathLine.content).toContain('death saves');
        expect(ended.character.isDead).toBe(true);
        // The XP rule is untouched: the goblin lives, so a slain-only defeat pays nothing.
        expect(ended.character.exp).toBe(900);
    });

    it('a defeat that is NOT a death posts no death line', () => {
        rollQueue.push(15);
        const stableState = { ...dyingState() };
        stableState.character = { ...stableState.character, deathSaves: { successes: 2, failures: 0 } };
        const plan = planCombatExchange(stableState, intent);
        let state = gameReducer(stableState, { type: 'APPLY_COMBAT_EXCHANGE', payload: plan.payload });
        expect(deathLines(state)).toEqual(['**Death Saving Throw:** natural **15** — STABLE: unconscious, no longer dying.']);
        expect(state.character.dying).toBe(false);
        expect(state.character.isDead).toBe(false);
        expect(state.combat.lastExchangeResult.postState.player).toMatchObject({ status: 'stable' });
        state = gameReducer(state, { type: 'COMPLETE_COMBAT_NARRATION', payload: { exchangeId: state.combat.lastExchangeResult.exchangeId } });
        expect(state.combat.active).toBe(false);
        expect(state.messages.some(m => String(m.content).startsWith('☠'))).toBe(false);
    });

    it('DEATH_SAVE_RESULT judges through the shared judge: the reducer tally matches the engine line at every step', () => {
        const base = dyingState();
        const step = (saves, die) => gameReducer({ ...base, character: { ...base.character, deathSaves: saves } }, { type: 'DEATH_SAVE_RESULT', payload: { die } }).character;
        expect(step({ successes: 0, failures: 0 }, 4).deathSaves).toEqual({ successes: 0, failures: 1 });
        expect(step({ successes: 0, failures: 1 }, 13).deathSaves).toEqual({ successes: 1, failures: 1 });
        expect(step({ successes: 1, failures: 1 }, 1).isDead).toBe(true);
        expect(step({ successes: 0, failures: 0 }, 1).deathSaves).toEqual({ successes: 0, failures: 2 });
        const stable = step({ successes: 2, failures: 2 }, 10);
        expect(stable.dying).toBe(false);
        expect(stable.deathSaves).toEqual({ successes: 0, failures: 0 });
        const revived = step({ successes: 1, failures: 2 }, 20);
        expect(revived.currentHP).toBe(1);
        expect(revived.dying).toBe(false);
        // A die-less dispatch is the skipped signal, never a failure; a string die is nothing.
        expect(step({ successes: 0, failures: 2 }, null).deathSaves).toEqual({ successes: 0, failures: 2 });
        expect(step({ successes: 0, failures: 2 }, '4').deathSaves).toEqual({ successes: 0, failures: 2 });
    });
});
