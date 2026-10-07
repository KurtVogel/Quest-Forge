/**
 * WOW 2026-09-27 (combat-drama, "the fight leaves a mark") — the reducer half:
 * START_COMBAT seeds `combat.fightTally`, APPLY_COMBAT_EXCHANGE folds each
 * commit in, the terminal narration reads ONE cost line from it, END_COMBAT
 * mints ONE engine wound card for a marking fight and none for a clean one,
 * LOAD_GAME types the tally complete-or-null, and an engine wound goes dormant
 * after six untouched cadences whatever its salience.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { rollQueue } = vi.hoisted(() => ({ rollQueue: [] }));

vi.mock('../engine/dice.ts', () => {
    let id = 0;
    const draw = () => {
        if (!rollQueue.length) throw new Error('dice queue exhausted — a test under-queued its rolls');
        return rollQueue.shift();
    };
    const makeResult = (rolls, modifier, description) => {
        const subtotal = rolls.reduce((sum, roll) => sum + roll, 0);
        return { id: `fm-${++id}`, timestamp: 0, notation: '1d20', dice: { count: rolls.length, sides: 20 }, rolls, subtotal, modifier, total: subtotal + modifier, description, isCritical: false, isCritFail: false };
    };
    return {
        rollDie: () => draw(),
        rollDice: (count) => Array.from({ length: count }, draw),
        rollWithModifier: (count, sides, modifier = 0, description = '') => makeResult(Array.from({ length: count }, draw), modifier, description),
        rollNotation: (notation, description = '') => makeResult([draw()], 0, description || notation),
    };
});

const { gameReducer, initialGameState } = await import('./gameReducer.js');
const { describeFightCost } = await import('../engine/fightTally.js');
const { applyStoryMemoryDormancy, WOUND_DORMANCY_JOURNAL_CYCLES } = await import('../engine/storyMemory.js');

const potion = (quantity) => ({ id: 'potion', name: 'Potion of Healing', type: 'consumable', consumableType: 'healing', healing: '2d4+2', quantity });

function makeState() {
    return {
        ...initialGameState,
        character: {
            name: 'Astra', race: 'human', class: 'fighter', level: 2, currentHP: 12, maxHP: 12, exp: 0,
            abilityScores: { strength: 16, dexterity: 14, constitution: 14, intelligence: 10, wisdom: 10, charisma: 8 },
            conditions: [],
            classResources: { secondWind: { used: 0, max: 1 }, actionSurge: { used: 0, max: 1 } },
        },
        inventory: [potion(2)],
        party: [{ id: 'companion-1', name: 'Garrick', hp: 10, maxHp: 10, status: 'healthy' }],
        currentLocation: 'Old road',
        messages: [],
        rollHistory: [],
        storyMemory: [],
    };
}

function startFight(state = makeState()) {
    // One d20 per enemy (declaration order), then the player's, then one per companion.
    rollQueue.push(9, 14, 11);
    return gameReducer(state, { type: 'START_COMBAT', payload: { enemies: [{ id: 'g1', name: 'Goblin Cutter', hp: 7, ac: 12, attackBonus: 4, damage: '1d6+2' }] } });
}

const attack = (actor, target, { hit = true, damage = 5, remainingHp, maxHp = 12, critical = false } = {}) => ({ type: 'attack', actor, target, rolled: 15, dc: 13, hit, damage, remainingHp, maxHp, critical });

function exchange(state, { id, round, events, enemies, party, playerDamage = 0, terminal = null, characterUpdates = null }) {
    return gameReducer(state, {
        type: 'APPLY_COMBAT_EXCHANGE',
        payload: {
            exchangeId: id, enemies, party, playerDamage, deathSaveNatural: null, rolls: [], heroRolls: [],
            consumeActionSurge: false, characterUpdates,
            result: { exchangeId: id, kind: 'exchange', round, terminal, events, postState: { player: { name: 'Astra', hp: 1, maxHp: 12 }, companions: [], enemies: [] } },
        },
    });
}

beforeEach(() => { rollQueue.length = 0; });

describe('the fight leaves a mark — reducer flow', () => {
    it('START_COMBAT seeds the tally from the live hero', () => {
        const state = startFight();
        expect(state.combat.fightTally).toEqual({
            heroHpStart: 12, heroMaxHp: 12, heroLowestHp: 12, heroDroppedRound: null, heroDroppedBy: null, deathSaves: 0, critsTaken: [], companionsDowned: [],
            witnesses: ['Garrick'], saves: [], heroKillingCrits: [], heroLowExchangeId: null,
            resourcesStart: { resources: { secondWind: 0, actionSurge: 0 }, slotsUsed: 0, potions: 2 }, rounds: 1,
        });
    });

    it('a marking fight: the tally folds the crit and the downed companion, the terminal prompt reads the cost, END_COMBAT mints ONE wound card and posts one line', () => {
        let state = startFight();
        const goblin = state.combat.enemies[0];
        state = exchange(state, {
            id: 'x1', round: 1, playerDamage: 10,
            events: [attack('Goblin Cutter', 'Astra', { critical: true, damage: 10, remainingHp: 2 }), attack('Goblin Cutter', 'Garrick', { damage: 10, remainingHp: 0, maxHp: 10 })],
            enemies: [{ ...goblin, hp: 3, condition: 'bloodied' }],
            party: [{ ...state.party[0], hp: 0, status: 'downed' }],
            characterUpdates: { classResources: { secondWind: { used: 1, max: 1 }, actionSurge: { used: 0, max: 1 } } },
        });
        expect(state.character.currentHP).toBe(2);
        expect(state.combat.fightTally).toMatchObject({
            heroLowestHp: 2, heroDroppedRound: null,
            critsTaken: [{ by: 'Goblin Cutter', target: 'Astra', damage: 10, round: 1 }],
            companionsDowned: ['Garrick'],
        });
        state = gameReducer(state, { type: 'COMPLETE_COMBAT_NARRATION', payload: { exchangeId: 'x1' } });
        expect(state.combat.phase).toBe('awaiting_player');
        expect(state.combat.fightTally.critsTaken).toHaveLength(1); // survives the round advance
        // The player drank a potion from the panel between rounds (the Inventory
        // handler's own path is pinned elsewhere; the DIFF is what the tally reads).
        state = { ...state, inventory: [potion(1)] };
        state = exchange(state, {
            id: 'x2', round: 2, terminal: 'victory',
            events: [attack('Astra', 'Goblin Cutter', { damage: 8, remainingHp: 0, maxHp: 7 })],
            enemies: [{ ...goblin, hp: 0, condition: 'dead' }],
            party: state.party,
        });
        expect(state.combat.fightTally.rounds).toBe(2);
        expect(describeFightCost(state.combat.fightTally, state)).toBe(
            'COST OF THIS FIGHT: Astra 12→2 HP (Goblin Cutter\'s critical blow in round 1, 10 damage); Garrick downed; Second Wind spent, 1 potion drunk; foes: 1 slain; 2 rounds.',
        );

        const before = state.messages.length;
        state = gameReducer(state, { type: 'COMPLETE_COMBAT_NARRATION', payload: { exchangeId: 'x2' } });
        expect(state.combat.active).toBe(false);
        expect(state.combat.fightTally).toBeNull();
        const wounds = state.storyMemory.filter(card => card.type === 'wound');
        expect(wounds).toHaveLength(1);
        expect(wounds[0]).toMatchObject({
            source: 'engine', salience: 4, status: 'active', location: 'Old road', linkedNpcNames: ['Garrick'], tags: ['fight-cost', 'victory'],
            subject: "Astra's wound from Goblin Cutter",
        });
        expect(wounds[0].text).toBe('Astra beat Goblin Cutter at Old road, was cut down to 2 of 12 HP and took Goblin Cutter\'s critical blow in round 1. Garrick went down in the fight. Second Wind spent, 1 potion drunk. The wound is fresh and unnamed.');
        // Stamped at birth like any card — after the "down but stable" line END_COMBAT posts first.
        expect(wounds[0].firstSeenMessage).toBe(before + 1);
        const mark = state.messages.find(m => String(m.content).startsWith('**The fight leaves a mark**'));
        expect(mark).toBeTruthy();
        expect(mark.content).toContain(wounds[0].text);
    });

    it('a clean fight mints no card and posts no mark line', () => {
        let state = startFight();
        const goblin = state.combat.enemies[0];
        state = exchange(state, {
            id: 'x1', round: 1, terminal: 'victory',
            events: [attack('Goblin Cutter', 'Astra', { hit: false, damage: 0, remainingHp: 12 }), attack('Astra', 'Goblin Cutter', { damage: 8, remainingHp: 0, maxHp: 7 })],
            enemies: [{ ...goblin, hp: 0, condition: 'dead' }], party: state.party,
        });
        expect(describeFightCost(state.combat.fightTally, state)).toBe('COST OF THIS FIGHT: Astra 12→12 HP; foes: 1 slain; 1 round.');
        state = gameReducer(state, { type: 'COMPLETE_COMBAT_NARRATION', payload: { exchangeId: 'x1' } });
        expect(state.storyMemory).toEqual([]);
        expect(state.messages.some(m => String(m.content).includes('leaves a mark'))).toBe(false);
    });

    it('a defeat mints the card with the defeat wording and the hero stays down', () => {
        let state = startFight();
        const goblin = state.combat.enemies[0];
        state = exchange(state, {
            id: 'x1', round: 1, playerDamage: 12, terminal: 'defeat',
            events: [attack('Goblin Cutter', 'Astra', { damage: 12, remainingHp: 0 })],
            enemies: [{ ...goblin }], party: [{ ...state.party[0], hp: 0, status: 'downed' }],
        });
        expect(state.combat.fightTally.heroDroppedRound).toBe(1);
        state = gameReducer(state, { type: 'COMPLETE_COMBAT_NARRATION', payload: { exchangeId: 'x1' } });
        const [card] = state.storyMemory;
        expect(card.text).toMatch(/^Astra fell to Goblin Cutter at Old road, went down at 0 HP in round 1\./);
        expect(card.tags).toEqual(['fight-cost', 'defeat']);
        expect(state.character.currentHP).toBe(0);
    });

    it('a pre-tally save (fightTally null) fights on without a tally, a cost line, or a card', () => {
        let state = startFight();
        state = { ...state, combat: { ...state.combat, fightTally: null } };
        const goblin = state.combat.enemies[0];
        state = exchange(state, {
            id: 'x1', round: 1, playerDamage: 11, terminal: 'victory',
            events: [attack('Goblin Cutter', 'Astra', { critical: true, damage: 11, remainingHp: 1 })],
            enemies: [{ ...goblin, hp: 0 }], party: state.party,
        });
        expect(state.combat.fightTally).toBeNull();
        expect(describeFightCost(state.combat.fightTally, state)).toBeNull();
        state = gameReducer(state, { type: 'COMPLETE_COMBAT_NARRATION', payload: { exchangeId: 'x1' } });
        expect(state.storyMemory).toEqual([]);
    });
});

describe('the fight is remembered (2026-09-28) — witnesses, the encounter mark, the ✦ tell', () => {
    const rosterGarrick = { id: 'npc-g', name: 'Garrick', kind: 'character', rosterTier: 'character', disposition: 'friendly', bondMoments: [] };

    it('END_COMBAT mints ONE graded bond moment on the witness companion (a companion who joined mid-fight gets none), stamps the encounter mark, and the ✦ tell lands on the narration', () => {
        let state = startFight({ ...makeState(), npcs: [rosterGarrick] });
        const goblin = state.combat.enemies[0];
        // Mid-fight, a second companion joins (add_companions in a narration) — no witness.
        state = { ...state, party: [...state.party, { id: 'companion-2', name: 'Sela', hp: 8, maxHp: 8, status: 'healthy' }], npcs: [...state.npcs, { ...rosterGarrick, id: 'npc-s', name: 'Sela' }] };
        state = exchange(state, {
            id: 'x1', round: 1, playerDamage: 12,
            events: [attack('Goblin Cutter', 'Astra', { damage: 12, remainingHp: 0 })],
            enemies: [{ ...goblin }], party: state.party,
        });
        state = gameReducer(state, { type: 'COMPLETE_COMBAT_NARRATION', payload: { exchangeId: 'x1' } });
        state = gameReducer(state, { type: 'ADD_MESSAGE', payload: { role: 'assistant', content: 'Garrick roars and cuts the goblin down over your body.' } });
        state = exchange(state, {
            id: 'x2', round: 2, terminal: 'victory',
            events: [{ type: 'death_save', natural: 9 }, attack('Garrick', 'Goblin Cutter', { damage: 8, remainingHp: 0, maxHp: 7 })],
            enemies: [{ ...goblin, hp: 0, condition: 'dead' }], party: state.party,
        });
        expect(state.combat.fightTally.saves).toEqual([{ how: 'felled', by: 'Garrick', saved: 'Astra', detail: 'Goblin Cutter', round: 2 }]);
        // The rescue TURNS the bond (trusted, earned by a moment): the turn beat's timing die (2026-10-07).
        rollQueue.push(1);
        state = gameReducer(state, { type: 'COMPLETE_COMBAT_NARRATION', payload: { exchangeId: 'x2' } });
        expect(state.combat.active).toBe(false);
        expect(state.session.relationshipBeat).toMatchObject({ mode: 'turn', npcName: 'Garrick', stage: 'trusted' });
        const garrick = state.npcs.find(n => n.name === 'Garrick');
        expect(garrick.bondMoments).toHaveLength(1);
        expect(garrick.bondMoments[0]).toMatchObject({
            kind: 'rescue', salience: 5,
            text: 'Garrick cut down Goblin Cutter while Astra lay at 0 HP against Goblin Cutter at Old road — Garrick kept Astra alive until it was won.',
        });
        expect(Number.isFinite(garrick.bondMoments[0].atMessage)).toBe(true);
        expect(state.npcs.find(n => n.name === 'Sela').bondMoments).toEqual([]);
        // The place keeps the particular; the ledger entry is typed like any other.
        expect(state.recentEncounters.at(-1)).toMatchObject({ outcome: 'victory', location: 'Old road', mark: 'Astra went down and Garrick fought on over the body until it was won' });
        // The quiet tell: the narration message carries the ✦ mark for the new key moment.
        const narration = [...state.messages].reverse().find(m => m.role === 'assistant');
        expect(narration.bondMarks.some(mark => mark.name === 'Garrick' && mark.kind === 'moment')).toBe(true);
    });

    it('the Scribe\'s same-scene re-report folds into the engine row and only lands a voice; a clean fight writes nothing and no mark', () => {
        let state = startFight({ ...makeState(), npcs: [rosterGarrick] });
        const goblin = state.combat.enemies[0];
        state = exchange(state, {
            id: 'x1', round: 1, terminal: 'victory',
            events: [attack('Astra', 'Goblin Cutter', { critical: true, damage: 9, remainingHp: 0, maxHp: 7 })],
            enemies: [{ ...goblin, hp: 0, condition: 'dead' }], party: state.party,
        });
        rollQueue.push(1); // shared danger at salience 4 turns the bond: the turn beat's timing die
        state = gameReducer(state, { type: 'COMPLETE_COMBAT_NARRATION', payload: { exchangeId: 'x1' } });
        expect(state.npcs[0].bondMoments).toHaveLength(1);
        expect(state.npcs[0].bondMoments[0]).toMatchObject({ kind: 'shared_danger', salience: 4 });
        state = gameReducer(state, { type: 'UPDATE_NPC', payload: { name: 'Garrick', bondMoment: { text: 'Garrick saw Astra split the goblin in one stroke on the old road.', kind: 'shared_danger', salience: 4, voice: 'One swing. I have never seen the like.' } } });
        expect(state.npcs[0].bondMoments).toHaveLength(1);
        expect(state.npcs[0].bondMoments[0].text).toMatch(/^Astra's critical blow felled Goblin Cutter and ended the fight/);
        expect(state.npcs[0].bondMoments[0].voice).toBe('One swing. I have never seen the like.');

        let clean = startFight({ ...makeState(), npcs: [rosterGarrick] });
        clean = exchange(clean, {
            id: 'y1', round: 1, terminal: 'victory',
            events: [attack('Astra', 'Goblin Cutter', { damage: 8, remainingHp: 0, maxHp: 7 })],
            enemies: [{ ...clean.combat.enemies[0], hp: 0, condition: 'dead' }], party: clean.party,
        });
        clean = gameReducer(clean, { type: 'COMPLETE_COMBAT_NARRATION', payload: { exchangeId: 'y1' } });
        expect(clean.npcs[0].bondMoments).toEqual([]);
        expect(clean.recentEncounters.at(-1).mark).toBeUndefined();
    });

    it('LOAD_GAME keeps a typed encounter mark and drops a junk one', () => {
        const load = (mark) => gameReducer(initialGameState, {
            type: 'LOAD_GAME',
            payload: { character: makeState().character, inventory: [], messages: [], recentEncounters: [{ enemies: 'goblin', location: 'Old road', outcome: 'victory', messageIndex: 2, mark }] },
        }).recentEncounters[0];
        expect(load('the hero went down and the dwarf fought on').mark).toBe('the hero went down and the dwarf fought on');
        expect(load({ text: 'x' }).mark).toBeUndefined();
        expect(load('m'.repeat(400)).mark).toHaveLength(160);
    });
});

describe('LOAD_GAME types combat.fightTally complete-or-null', () => {
    const load = (fightTally) => gameReducer(initialGameState, {
        type: 'LOAD_GAME',
        payload: {
            character: makeState().character, inventory: [], messages: [],
            combat: { ...initialGameState.combat, active: true, phase: 'awaiting_player', round: 2, enemies: [{ id: 'g1', name: 'Goblin', hp: 5, maxHp: 7, ac: 12 }], turnOrder: [{ type: 'player', name: 'Astra', initiative: 10 }], fightTally },
        },
    });

    it('junk is null; a valid tally survives typed; the key set is the initial envelope\'s', () => {
        for (const junk of ['x', 7, [], { heroMaxHp: 'lots' }, null]) expect(load(junk).combat.fightTally).toBeNull();
        const typed = load({ heroMaxHp: 12, heroHpStart: 12, heroLowestHp: '3', critsTaken: [null, { by: 'Goblin', target: 'Astra', damage: 9, round: 1 }], companionsDowned: ['Garrick', 4], resourcesStart: { resources: { secondWind: 1 }, potions: '2' }, rounds: 2, hostile: 'x' }).combat.fightTally;
        expect(typed).toEqual({
            heroHpStart: 12, heroMaxHp: 12, heroLowestHp: 3, heroDroppedRound: null, heroDroppedBy: null, deathSaves: 0,
            critsTaken: [{ by: 'Goblin', target: 'Astra', damage: 9, round: 1 }], companionsDowned: ['Garrick'],
            // A pre-fix tally loads with the fight-memory fields EMPTY, not null.
            witnesses: [], saves: [], heroKillingCrits: [], heroLowExchangeId: null,
            resourcesStart: { resources: { secondWind: 1 }, slotsUsed: 0, potions: 2 }, rounds: 2,
        });
        expect(new Set(Object.keys(load(null).combat))).toEqual(new Set(Object.keys(initialGameState.combat)));
    });
});

describe('an engine wound goes dormant after six untouched cadences', () => {
    const entry = (i) => ({ id: `j${i}`, timestamp: 1000 * (i + 1), summary: `cadence ${i}` });
    const journal = Array.from({ length: WOUND_DORMANCY_JOURNAL_CYCLES }, (_, i) => entry(i));
    const wound = (overrides = {}) => ({ id: 'w', type: 'wound', text: 'Astra was cut down.', salience: 4, status: 'active', source: 'engine', firstSeenAt: 500, lastSeenAt: 500, lastUsedAt: null, ...overrides });

    it('the engine wound ages out past the sixth cadence; a Scribe wound of the same salience never does; a touched engine wound stays', () => {
        const [engine, scribe, touched] = applyStoryMemoryDormancy([wound(), wound({ id: 's', source: 'scribe' }), wound({ id: 't', lastUsedAt: 1000 * WOUND_DORMANCY_JOURNAL_CYCLES })], journal);
        expect(engine.status).toBe('dormant');
        expect(scribe.status).toBe('active');
        expect(touched.status).toBe('active');
    });

    it('with fewer than six cadences the engine wound holds, while an ordinary salience-2 card still ages out at three', () => {
        const short = journal.slice(0, WOUND_DORMANCY_JOURNAL_CYCLES - 1);
        const [engine, low] = applyStoryMemoryDormancy([wound(), { id: 'l', type: 'callback', text: 'x', salience: 2, status: 'active', firstSeenAt: 500, lastSeenAt: 500 }], short);
        expect(engine.status).toBe('active');
        expect(low.status).toBe('dormant');
    });
});
