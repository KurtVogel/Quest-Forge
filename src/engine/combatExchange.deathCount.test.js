/**
 * The count is on the page (WOW 2026-09-30, death-and-stakes): the combat
 * death_save event carries its judged outcome + tally and renders through the
 * shared line as a countdown; `postState.player` carries a status + the tally
 * so the narration prompt's PLAYER line and the dying / DIED endings play the
 * round over the body. Engine-only — the reducer twin is
 * `state/gameReducer.deathCount.test.js`.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { COMBAT_PHASES } from './combatPredicates.js';
import { normalizeCombatExchange } from './combatWire.js';
import { exchangeEventLines, planCombatExchange, planOpeningExchange } from './combatExchange.js';
import { combatNarrationPrompt } from '../llm/combatNarration.js';

const { rollQueue } = vi.hoisted(() => ({ rollQueue: [] }));

vi.mock('./dice.ts', () => {
    let id = 0;
    const draw = () => {
        if (!rollQueue.length) throw new Error('dice queue exhausted — a test under-queued its rolls');
        return rollQueue.shift();
    };
    const parseNotation = notation => {
        const match = String(notation).replace(/\s+/g, '').match(/^(\d+)d(\d+)([+-]\d+)?$/i);
        if (!match) throw new Error(`Invalid notation: ${notation}`);
        return { count: Number(match[1]), sides: Number(match[2]), modifier: match[3] ? Number(match[3]) : 0 };
    };
    return {
        parseNotation,
        rollWithModifier: (count, sides, modifier = 0, description = '') => {
            const rolls = Array.from({ length: count }, draw);
            const subtotal = rolls.reduce((sum, value) => sum + value, 0);
            return {
                id: `death-roll-${++id}`, timestamp: 0, notation: `${count}d${sides}`, dice: { count, sides },
                rolls, subtotal, modifier, total: subtotal + modifier, description,
                isCritical: count === 1 && sides === 20 && rolls[0] === 20,
                isCritFail: count === 1 && sides === 20 && rolls[0] === 1,
            };
        },
        rollDice: (count) => Array.from({ length: count }, draw),
    };
});

const goblin = () => ({
    id: 'Goblin', name: 'Goblin', hp: 10, maxHp: 10, ac: 12, attackBonus: 4, damage: '1d6+2',
    condition: 'healthy', conditions: [], combatStatus: 'active',
});

function state({ character = {}, party = [] } = {}) {
    return {
        character: {
            name: 'Astra', class: 'fighter', level: 3, currentHP: 0, maxHP: 20, armorClass: 16,
            abilityScores: { strength: 16, dexterity: 12, constitution: 14, intelligence: 10, wisdom: 10, charisma: 8 },
            skillProficiencies: [], conditions: ['Unconscious'], dying: true, deathSaves: { successes: 0, failures: 0 },
            ...character,
        },
        inventory: [{ id: 'sword', name: 'Longsword', type: 'weapon', category: 'martialMelee', damage: '1d8', equipped: true }],
        party,
        combat: {
            active: true, phase: COMBAT_PHASES.AWAITING_PLAYER, round: 1, enemies: [goblin()],
            turnOrder: [{ type: 'player', name: 'Astra', initiative: 15 }], currentTurn: 0,
        },
    };
}

const deathSaveIntent = (enemyAction = 'defend') => normalizeCombatExchange({
    player_slots: [{ action: 'death_save' }],
    enemy_intents: [{ enemy_id: 'Goblin', action: enemyAction, target: 'player' }],
});

const deathLine = plan => exchangeEventLines(plan.payload.result).find(line => line.startsWith('**Death Saving Throw:**'));

beforeEach(() => { rollQueue.length = 0; });

describe('the death_save event carries its outcome and renders as a countdown', () => {
    it('a fixture fight: the hero drops and rolls 4 / 13 / 1 — three lines that count down to the death', () => {
        rollQueue.push(4);
        const first = planCombatExchange(state(), deathSaveIntent());
        expect(first.ok).toBe(true);
        expect(deathLine(first)).toBe('**Death Saving Throw:** natural **4** — failure (1/3). Two more and Astra dies.');
        expect(first.payload.result.events.find(e => e.type === 'death_save')).toEqual({
            type: 'death_save', natural: 4, actor: 'Astra', outcome: 'failure', successes: 0, failures: 1,
        });
        expect(first.payload.result.terminal).toBe('dying');
        expect(first.payload.result.postState.player).toEqual({ name: 'Astra', hp: 0, maxHp: 20, status: 'dying', deathSaves: { successes: 0, failures: 1 } });

        rollQueue.push(13);
        const second = planCombatExchange(state({ character: { deathSaves: { successes: 0, failures: 1 } } }), deathSaveIntent());
        expect(deathLine(second)).toBe('**Death Saving Throw:** natural **13** — success (1/3). Two more and Astra is stable.');
        expect(second.payload.result.terminal).toBe('dying');
        expect(second.payload.result.postState.player).toMatchObject({ status: 'dying', deathSaves: { successes: 1, failures: 1 } });

        rollQueue.push(1);
        const third = planCombatExchange(state({ character: { deathSaves: { successes: 1, failures: 1 } } }), deathSaveIntent());
        expect(deathLine(third)).toBe('**Death Saving Throw:** natural **1** — THE THIRD FAILURE. Astra dies.');
        // The engine terminal stays `defeat` (END_COMBAT's XP rules untouched); the snapshot says dead.
        expect(third.payload.result.terminal).toBe('defeat');
        expect(third.payload.result.postState.player).toMatchObject({ status: 'dead', deathSaves: { successes: 1, failures: 3 } });
    });

    it('stable, revived, and a natural 1 render their own outcomes', () => {
        rollQueue.push(15);
        const stable = planCombatExchange(state({ character: { deathSaves: { successes: 2, failures: 1 } } }), deathSaveIntent());
        expect(deathLine(stable)).toBe('**Death Saving Throw:** natural **15** — STABLE: unconscious, no longer dying.');
        expect(stable.payload.result.terminal).toBe('defeat');
        expect(stable.payload.result.postState.player).toMatchObject({ status: 'stable', hp: 0, deathSaves: { successes: 3, failures: 1 } });

        rollQueue.push(20);
        const revived = planCombatExchange(state({ character: { deathSaves: { successes: 0, failures: 2 } } }), deathSaveIntent());
        expect(deathLine(revived)).toBe('**Death Saving Throw:** natural **20** — NATURAL 20: Astra is back on their feet with 1 HP.');
        expect(revived.payload.result.terminal).toBeNull();
        expect(revived.payload.result.postState.player).toEqual({ name: 'Astra', hp: 1, maxHp: 20, status: 'revived', deathSaves: { successes: 0, failures: 0 } });

        rollQueue.push(1);
        const natOne = planCombatExchange(state(), deathSaveIntent());
        expect(deathLine(natOne)).toBe('**Death Saving Throw:** natural **1** — NATURAL 1, two failures (2/3). One more and Astra dies.');
        expect(natOne.payload.result.postState.player).toMatchObject({ status: 'dying', deathSaves: { successes: 0, failures: 2 } });
    });

    it('the low-level-solo mercy is untouched: no die, no death line, snapshot `defeated`', () => {
        const plan = planCombatExchange(state({ character: { level: 1 } }), deathSaveIntent());
        expect(plan.ok).toBe(true);
        expect(plan.payload.deathSaveSkipped).toBe(true);
        expect(plan.payload.deathSaveNatural).toBeNull();
        expect(deathLine(plan)).toBeUndefined();
        expect(plan.payload.result.terminal).toBe('defeat');
        expect(plan.payload.result.postState.player).toMatchObject({ status: 'defeated', deathSaves: { successes: 0, failures: 0 } });
    });

    it('a revived hero dropped again in the same exchange starts a fresh clock in the snapshot', () => {
        rollQueue.push(
            20, // natural 20 — up at 1 HP
            19, // goblin attack hits
            1,  // 1d6+2 = 3 damage
        );
        const plan = planCombatExchange(state({ character: { deathSaves: { successes: 1, failures: 2 } } }), deathSaveIntent('attack'));
        expect(plan.payload.result.terminal).toBe('dying');
        expect(plan.payload.result.postState.player).toEqual({ name: 'Astra', hp: 0, maxHp: 20, status: 'dying', deathSaves: { successes: 0, failures: 0 } });
    });

    it('a conscious hero dropping to 0 is `dying` with a fresh tally; one who stands is `active`; the opening snapshot carries a status too', () => {
        const conscious = state({ character: { currentHP: 2, dying: false, conditions: [], deathSaves: undefined } });
        rollQueue.push(19, 6); // goblin hits for 8
        const dropped = planCombatExchange(conscious, normalizeCombatExchange({
            player_slots: [{ action: 'pass' }],
            enemy_intents: [{ enemy_id: 'Goblin', action: 'attack', target: 'player' }],
        }));
        expect(dropped.payload.result.terminal).toBe('dying');
        expect(dropped.payload.result.postState.player).toEqual({ name: 'Astra', hp: 0, maxHp: 20, status: 'dying', deathSaves: { successes: 0, failures: 0 } });

        const standing = planCombatExchange(conscious, normalizeCombatExchange({
            player_slots: [{ action: 'pass' }],
            enemy_intents: [{ enemy_id: 'Goblin', action: 'defend' }],
        }));
        expect(standing.payload.result.postState.player).toEqual({ name: 'Astra', hp: 2, maxHp: 20, status: 'active', deathSaves: { successes: 0, failures: 0 } });

        const openingState = { ...conscious, combat: { ...conscious.combat, phase: COMBAT_PHASES.OPENING, openingActorIds: [], turnOrder: [{ type: 'player', name: 'Astra', initiative: 15 }] } };
        const opening = planOpeningExchange(openingState);
        expect(opening.ok).toBe(true);
        expect(opening.payload.result.postState.player).toMatchObject({ status: 'active', deathSaves: { successes: 0, failures: 0 } });
    });
});

describe('combatNarrationPrompt — the PLAYER line carries the count, the endings play the round over the body', () => {
    const result = (player, { terminal = 'dying', events = [] } = {}) => ({
        exchangeId: 'x-death', kind: 'exchange', round: 3, terminal, events,
        postState: { player, companions: [{ id: 'c1', name: 'Tammo', hp: 9, maxHp: 12, status: 'healthy' }], enemies: [{ name: 'Goblin', hp: 4, maxHp: 10, condition: 'bloodied', conditions: [], status: 'active' }] },
    });

    it('DYING: the tally and what the next die means, and the party\'s-side ending', () => {
        const prompt = combatNarrationPrompt(result(
            { name: 'Astra', hp: 0, maxHp: 20, status: 'dying', deathSaves: { successes: 1, failures: 2 } },
            { events: [{ type: 'death_save', natural: 4, actor: 'Astra', outcome: 'failure', successes: 1, failures: 2 }] },
        ));
        expect(prompt).toContain('- PLAYER DYING: Astra — 0/20 HP; death saves 1 success / 2 failures — the next failure kills.');
        expect(prompt).toContain('Narrate this round from the party\'s side — who does what over the body, and what the count means. Do not end combat');
        expect(prompt).not.toContain('Narrate the danger briefly');
        expect(prompt).toContain('**Death Saving Throw:** natural **4** — failure (2/3). One more and Astra dies.');
        expect(prompt).not.toContain('undefined');
    });

    it('DEAD: the terminal stays defeat, the prompt says DIED — not "setback or collapse"', () => {
        const prompt = combatNarrationPrompt(result(
            { name: 'Astra', hp: 0, maxHp: 20, status: 'dead', deathSaves: { successes: 1, failures: 3 } },
            { terminal: 'defeat', events: [{ type: 'death_save', natural: 1, actor: 'Astra', outcome: 'dead', successes: 1, failures: 3 }] },
        ), { cost: 'COST OF THIS FIGHT: Astra 20→0 HP; 3 rounds.' });
        expect(prompt).toContain('The terminal state is mechanically authoritative: defeat.');
        expect(prompt).toContain('The player has DIED — the third failed death save. Narrate the death plainly and finally; the fight ends here.');
        expect(prompt).not.toContain('setback or collapse');
        expect(prompt).toContain('- PLAYER DEAD: Astra — 0/20 HP; the third failed death save. Dead');
        expect(prompt).toContain('COST OF THIS FIGHT');
        expect(prompt).toContain('THE THIRD FAILURE. Astra dies.');
    });

    it('STABLE and DEFEATED keep the ordinary defeat ending; REVIVED and ACTIVE are ongoing lines', () => {
        const stable = combatNarrationPrompt(result({ name: 'Astra', hp: 0, maxHp: 20, status: 'stable', deathSaves: { successes: 3, failures: 1 } }, { terminal: 'defeat' }));
        expect(stable).toContain('- PLAYER STABLE: Astra — 0/20 HP; three successful death saves — unconscious, no longer dying.');
        expect(stable).toContain('Narrate the setback or collapse');
        expect(stable).not.toContain('has DIED');

        const defeated = combatNarrationPrompt(result({ name: 'Astra', hp: 0, maxHp: 8, status: 'defeated', deathSaves: { successes: 0, failures: 0 } }, { terminal: 'defeat' }));
        expect(defeated).toContain('- PLAYER DEFEATED: Astra — 0/8 HP; down but alive — a setback, never a death.');
        expect(defeated).toContain('Narrate the setback or collapse');

        const revived = combatNarrationPrompt(result({ name: 'Astra', hp: 1, maxHp: 20, status: 'revived', deathSaves: { successes: 0, failures: 0 } }, { terminal: null }));
        expect(revived).toContain('- PLAYER REVIVED: Astra — 1/20 HP; a natural-20 death save put them back on their feet');
        expect(revived).toContain('COMBAT IS STILL ACTIVE.');

        const active = combatNarrationPrompt(result({ name: 'Astra', hp: 12, maxHp: 20, status: 'active', deathSaves: { successes: 0, failures: 0 } }, { terminal: null }));
        expect(active).toContain('- PLAYER: Astra — 12/20 HP.');
    });

    it('a pre-change stored result (no status, bare death_save event) renders the legacy lines and no undefined', () => {
        const legacy = combatNarrationPrompt(result({ name: 'Astra', hp: 0, maxHp: 20 }, { events: [{ type: 'death_save', natural: 13 }] }));
        expect(legacy).toContain('- PLAYER: Astra — 0/20 HP.');
        expect(legacy).toContain('**Death Saving Throw:** natural **13**.');
        expect(legacy).not.toContain('undefined');
    });
});
