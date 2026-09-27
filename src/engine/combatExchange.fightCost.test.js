/**
 * WOW 2026-09-27 (combat-drama Lap 1, both W1 slices) — the engine half:
 *  A. the non-terminal narration prompt ends on the foe's next move (the
 *     telegraph rule), never on a terminal or dying beat;
 *  B. the fight's cost tally is pure and typed, the terminal prompt carries
 *     ONE cost line, and a marking fight yields ONE engine-minted wound card.
 */
import { describe, expect, it } from 'vitest';
import {
    buildFightWoundCard, combatNarrationPrompt, describeFightCost, isMarkingFight,
    recordExchangeCost, sanitizeFightTally, snapshotHeroResources, spentFightResources, startFightTally,
} from './combatExchange.js';

const hero = (overrides = {}) => ({
    name: 'Astra', currentHP: 20, maxHP: 20,
    classResources: { secondWind: { used: 0, max: 1 }, actionSurge: { used: 0, max: 1 } },
    spellSlots: { 1: { used: 0, max: 2 } },
    ...overrides,
});
const potion = (quantity = 1) => ({ id: 'p', name: 'Potion of Healing', type: 'consumable', consumableType: 'healing', healing: '2d4+2', quantity });
const goblin = (overrides = {}) => ({ id: 'g1', name: 'Goblin Cutter', hp: 7, maxHp: 7, condition: 'healthy', combatStatus: 'active', ...overrides });

const attack = (actor, target, { hit = true, damage = 5, remainingHp, maxHp = 20, critical = false, intercepted } = {}) => ({
    type: 'attack', actor, target, rolled: 15, dc: 13, hit, damage, remainingHp, maxHp, critical, ...(intercepted && { intercepted }),
});
const result = (events, { round = 1, terminal = null, postState } = {}) => ({ exchangeId: `x-${round}`, kind: 'exchange', round, terminal, events, postState });

describe('startFightTally / snapshotHeroResources', () => {
    it('seeds the ledger from the live hero: HP, class resources used, slots used, potions carried', () => {
        const tally = startFightTally({ character: hero({ currentHP: 17 }), inventory: [potion(2), { id: 'a', name: 'Antitoxin', type: 'consumable', consumableType: 'antitoxin' }] });
        expect(tally).toEqual({
            heroHpStart: 17, heroMaxHp: 20, heroLowestHp: 17, heroDroppedRound: null, deathSaves: 0,
            critsTaken: [], companionsDowned: [],
            resourcesStart: { resources: { secondWind: 0, actionSurge: 0 }, slotsUsed: 0, potions: 2 },
            rounds: 1,
        });
        expect(snapshotHeroResources(hero({ classResources: 'junk', spellSlots: [1, 2] }), 'junk')).toEqual({ resources: {}, slotsUsed: 0, potions: 0 });
    });
});

describe('sanitizeFightTally — complete-or-null', () => {
    it('rejects non-objects and a tally without a usable max HP; types every field of a hostile one', () => {
        for (const junk of [null, undefined, 'x', 7, [], {}, { heroMaxHp: 'lots' }, { heroMaxHp: 0 }]) expect(sanitizeFightTally(junk)).toBeNull();
        const typed = sanitizeFightTally({
            heroMaxHp: '20', heroHpStart: '15', heroLowestHp: 99, heroDroppedRound: '2', deathSaves: -3,
            critsTaken: [null, 'x', { by: { a: 1 }, target: 'Astra', damage: '9', round: 0 }, ...Array.from({ length: 9 }, () => ({ by: 'G', target: 'T' }))],
            companionsDowned: ['Jorun', 'Jorun', 7, '', 'Mika'],
            resourcesStart: { resources: { secondWind: '1', junk: 'x' }, slotsUsed: 'a', potions: 2.9 },
            rounds: 0,
        });
        expect(typed.heroMaxHp).toBe(20);
        expect(typed.heroHpStart).toBe(15);
        expect(typed.heroLowestHp).toBe(15); // clamped to the start: the low point is never above it
        expect(typed.heroDroppedRound).toBeNull(); // a string round is no round
        expect(typed.deathSaves).toBe(0);
        expect(typed.critsTaken).toHaveLength(6);
        expect(typed.critsTaken[0]).toEqual({ by: 'a foe', target: 'Astra', damage: 9, round: 1 });
        expect(typed.companionsDowned).toEqual(['Jorun', 'Mika']);
        expect(typed.resourcesStart).toEqual({ resources: { secondWind: 1 }, slotsUsed: 0, potions: 2 });
        expect(typed.rounds).toBe(1);
    });
});

describe('recordExchangeCost — folds one committed result into the tally', () => {
    const start = startFightTally({ character: hero(), inventory: [] });
    const party = [{ id: 'c1', name: 'Torvald', hp: 18, maxHp: 18 }];

    it('tracks the lowest point, the crit with its attacker, the drop to 0, death saves, and a downed companion', () => {
        const r1 = recordExchangeCost(start, {
            result: result([
                attack('Astra', 'Goblin Cutter', { remainingHp: 2, maxHp: 7 }),
                attack('Goblin Cutter', 'Astra', { critical: true, damage: 14, remainingHp: 6 }),
                attack('Wolf', 'Torvald', { damage: 20, remainingHp: 0, maxHp: 18 }),
            ], { round: 2 }),
            heroName: 'Astra', hpBefore: 20, hpAfter: 6, partyBefore: party, partyAfter: [{ ...party[0], hp: 0 }],
        });
        expect(r1.heroLowestHp).toBe(6);
        expect(r1.critsTaken).toEqual([{ by: 'Goblin Cutter', target: 'Astra', damage: 14, round: 2 }]);
        expect(r1.companionsDowned).toEqual(['Torvald']);
        expect(r1.heroDroppedRound).toBeNull();
        expect(r1.rounds).toBe(2);
        // A crit on the hero's own target is the foe's problem, not the party's.
        expect(recordExchangeCost(start, { result: result([attack('Astra', 'Goblin Cutter', { critical: true, remainingHp: 0, maxHp: 7 })]), heroName: 'Astra', hpBefore: 20, hpAfter: 20 }).critsTaken).toEqual([]);

        const r2 = recordExchangeCost(r1, {
            result: result([attack('Goblin Cutter', 'Astra', { damage: 6, remainingHp: 0 }), { type: 'death_save', natural: 12 }], { round: 3 }),
            heroName: 'Astra', hpBefore: 6, hpAfter: 0, partyBefore: [{ ...party[0], hp: 0 }], partyAfter: [{ ...party[0], hp: 0 }],
        });
        expect(r2.heroLowestHp).toBe(0);
        expect(r2.heroDroppedRound).toBe(3);
        expect(r2.deathSaves).toBe(1);
        expect(r2.companionsDowned).toEqual(['Torvald']); // once, not per exchange
        // The first drop is the one remembered.
        expect(recordExchangeCost(r2, { result: result([{ type: 'death_save', natural: 3 }], { round: 4 }), heroName: 'Astra', hpBefore: 0, hpAfter: 0 }).heroDroppedRound).toBe(3);
    });

    it('a companion dropped by a snapshot (no attack event) and a guard-intercepted crit both count; a null tally stays null', () => {
        const r = recordExchangeCost(start, {
            result: result([attack('Ogre', 'Torvald', { critical: true, damage: 12, remainingHp: 6, maxHp: 18, intercepted: true })]),
            heroName: 'Astra', hpBefore: 20, hpAfter: 20, partyBefore: party, partyAfter: [{ ...party[0], hp: 0 }],
        });
        expect(r.critsTaken[0]).toMatchObject({ by: 'Ogre', target: 'Torvald' });
        expect(r.companionsDowned).toEqual(['Torvald']);
        expect(recordExchangeCost(null, { result: result([]) })).toBeNull();
        expect(recordExchangeCost(start, { result: 'junk' })).toEqual(start);
        expect(recordExchangeCost(start, { result: result('junk'), hpAfter: 'x' })).toEqual(start);
    });
});

describe('isMarkingFight', () => {
    const base = startFightTally({ character: hero(), inventory: [] });
    it('marks on a drop to 0, a low point at or under a quarter, a crit taken, or a companion downed — and not otherwise', () => {
        expect(isMarkingFight(base)).toBe(false);
        expect(isMarkingFight({ ...base, heroLowestHp: 5 })).toBe(true);
        expect(isMarkingFight({ ...base, heroLowestHp: 6 })).toBe(false);
        expect(isMarkingFight({ ...base, heroDroppedRound: 1, heroLowestHp: 0 })).toBe(true);
        expect(isMarkingFight({ ...base, critsTaken: [{ by: 'G', target: 'Astra', damage: 3, round: 1 }] })).toBe(true);
        expect(isMarkingFight({ ...base, companionsDowned: ['Torvald'] })).toBe(true);
        // A hero who walked in at 4/20 and took nothing is not marked by this fight.
        expect(isMarkingFight({ ...base, heroHpStart: 4, heroLowestHp: 4 })).toBe(false);
        expect(isMarkingFight(null)).toBe(false);
    });
});

describe('describeFightCost / spentFightResources — the ONE line', () => {
    it('reads HP from→to with the low point, the crit by name, the downed companion, what was spent, the foes, and the rounds', () => {
        const tally = recordExchangeCost(startFightTally({ character: hero(), inventory: [potion(2)] }), {
            result: result([attack('Goblin Cutter', 'Astra', { critical: true, damage: 14, remainingHp: 6 }), attack('Wolf', 'Torvald', { remainingHp: 0, maxHp: 18 })], { round: 3 }),
            heroName: 'Astra', hpBefore: 20, hpAfter: 6, partyBefore: [{ id: 'c1', name: 'Torvald', hp: 18 }], partyAfter: [{ id: 'c1', name: 'Torvald', hp: 0 }],
        });
        const state = {
            character: hero({ currentHP: 11, classResources: { secondWind: { used: 1, max: 1 }, actionSurge: { used: 0, max: 1 } }, spellSlots: { 1: { used: 2, max: 2 } } }),
            inventory: [potion(1)],
            combat: { enemies: [goblin({ hp: 0 }), goblin({ id: 'g2', name: 'Wolf', combatStatus: 'fled' }), goblin({ id: 'g3', name: 'Goblin Archer', combatStatus: 'surrendered' })] },
        };
        expect(spentFightResources(tally, state.character, state.inventory)).toEqual(['Second Wind spent', '2 spell slots spent', '1 potion drunk']);
        expect(describeFightCost(tally, state)).toBe(
            'COST OF THIS FIGHT: Astra 20→11 HP (lowest 6; Goblin Cutter\'s critical blow in round 3, 14 damage); Torvald downed; Second Wind spent, 2 spell slots spent, 1 potion drunk; foes: 1 slain, 1 fled, 1 surrendered; 3 rounds.',
        );
    });

    it('a clean fight still has a line (the DM should know it cost nothing); no tally, no line', () => {
        const state = { character: hero(), inventory: [], combat: { enemies: [goblin({ hp: 0 })] } };
        expect(describeFightCost(startFightTally(state), state)).toBe('COST OF THIS FIGHT: Astra 20→20 HP; foes: 1 slain; 1 round.');
        expect(describeFightCost(null, state)).toBeNull();
        expect(describeFightCost(startFightTally(state), {})).toBeNull();
    });

    it('a resource used ×2 and a hero who went down read as such', () => {
        const tally = { ...startFightTally({ character: hero(), inventory: [] }), heroLowestHp: 0, heroDroppedRound: 2, deathSaves: 2, rounds: 4 };
        const state = { character: hero({ currentHP: 1, classResources: { secondWind: { used: 2, max: 2 } } }), inventory: [], combat: { enemies: [] } };
        expect(describeFightCost(tally, state)).toBe('COST OF THIS FIGHT: Astra 20→1 HP (lowest 0; DOWN at 0 HP in round 2, 2 death saves); Second Wind ×2; 4 rounds.');
    });
});

describe('buildFightWoundCard — one engine-minted salience-4 wound', () => {
    const marking = recordExchangeCost(startFightTally({ character: hero(), inventory: [potion(1)] }), {
        result: result([attack('Goblin Cutter', 'Astra', { critical: true, damage: 15, remainingHp: 5 }), attack('Wolf', 'Torvald', { remainingHp: 0, maxHp: 18 })], { round: 2 }),
        heroName: 'Astra', hpBefore: 20, hpAfter: 5, partyBefore: [{ id: 'c1', name: 'Torvald', hp: 18 }], partyAfter: [{ id: 'c1', name: 'Torvald', hp: 0 }],
    });
    const state = {
        character: hero({ currentHP: 5 }), inventory: [], currentLocation: 'Old road',
        combat: { enemies: [goblin({ hp: 0 }), goblin({ id: 'g2', name: 'Wolf' }), goblin({ id: 'g3', name: 'Goblin Archer' })] },
    };

    it('carries the record as text, the foes as subject, the downed companion as a linked NPC, the place, and the engine source', () => {
        const card = buildFightWoundCard(marking, state, 'victory');
        expect(card).toEqual({
            type: 'wound',
            subject: "Astra's wound from Goblin Cutter and 2 others",
            text: 'Astra beat Goblin Cutter and 2 others at Old road, was cut down to 5 of 20 HP and took Goblin Cutter\'s critical blow in round 2. Torvald went down in the fight. 1 potion drunk. The wound is fresh and unnamed.',
            salience: 4,
            emotionalCharge: 3,
            status: 'active',
            source: 'engine',
            tags: ['fight-cost', 'victory'],
            linkedNpcNames: ['Torvald'],
            location: 'Old road',
        });
        expect(card.text.length).toBeLessThanOrEqual(260);
    });

    it('a defeat or an escape reads as such; a hero who went down says so; two foes are named in full', () => {
        const down = { ...marking, heroDroppedRound: 2, heroLowestHp: 0, deathSaves: 1 };
        const two = { ...state, combat: { enemies: [goblin(), goblin({ id: 'g2', name: 'Wolf' })] } };
        expect(buildFightWoundCard(down, two, 'defeat').text).toContain('Astra fell to Goblin Cutter and Wolf at Old road, went down at 0 HP in round 2 and rolled 1 death save and took');
        expect(buildFightWoundCard(marking, two, 'escaped').text).toMatch(/^Astra fled from Goblin Cutter and Wolf/);
        expect(buildFightWoundCard(marking, two, 'escaped').tags).toEqual(['fight-cost', 'escaped']);
    });

    it('no card for a clean fight, a null tally, or a state without a hero; a very long name never breaks the clamps', () => {
        expect(buildFightWoundCard(startFightTally(state), state, 'victory')).toBeNull();
        expect(buildFightWoundCard(null, state, 'victory')).toBeNull();
        expect(buildFightWoundCard(marking, {}, 'victory')).toBeNull();
        const long = buildFightWoundCard(marking, { ...state, currentLocation: 'L'.repeat(500), combat: { enemies: [goblin({ name: 'N'.repeat(500) })] } }, 'victory');
        expect(long.subject.length).toBeLessThanOrEqual(80);
        expect(long.text.length).toBeLessThanOrEqual(260);
        expect(long.location.length).toBeLessThanOrEqual(100);
    });
});

describe('combatNarrationPrompt — the telegraph on every ongoing beat, the cost on the terminal one', () => {
    const post = { player: { name: 'Astra', hp: 6, maxHp: 20 }, companions: [], enemies: [{ name: 'Goblin Cutter', hp: 3, maxHp: 7, condition: 'bloodied', conditions: [], status: 'active' }] };
    const cost = 'COST OF THIS FIGHT: Astra 20→6 HP; 2 rounds.';

    it('an ongoing exchange ends on the foe\'s next move and never carries a cost line, even when one is offered', () => {
        const prompt = combatNarrationPrompt(result([attack('Goblin Cutter', 'Astra', { remainingHp: 6 })], { postState: post }), { cost });
        expect(prompt).toContain("THE FOE'S NEXT MOVE IS ON THE PAGE");
        expect(prompt).toContain('a critical foe with no reason to die fighting is on the edge of flight or plea');
        expect(prompt).toContain('COMBAT IS STILL ACTIVE.');
        expect(prompt).not.toContain('COST OF THIS FIGHT');
        expect(prompt).not.toContain('Let the ending carry its cost');
        // The telegraph sits right after the ending rule, before the authoritative state.
        expect(prompt.indexOf("THE FOE'S NEXT MOVE")).toBeGreaterThan(prompt.indexOf('COMBAT IS STILL ACTIVE.'));
        expect(prompt.indexOf("THE FOE'S NEXT MOVE")).toBeLessThan(prompt.indexOf('POST-EXCHANGE STATE (AUTHORITATIVE):'));
    });

    it('victory, defeat, and escape carry the cost line and the cost rule; dying carries neither', () => {
        for (const terminal of ['victory', 'defeat', 'escaped']) {
            const prompt = combatNarrationPrompt(result([], { terminal, postState: post }), { cost });
            expect(prompt).toContain(cost);
            expect(prompt).toContain('Let the ending carry its cost: a wound the hero will feel tomorrow, named in the fiction');
            expect(prompt).not.toContain("THE FOE'S NEXT MOVE");
        }
        const dying = combatNarrationPrompt(result([{ type: 'death_save', natural: 4 }], { terminal: 'dying', postState: post }), { cost });
        expect(dying).not.toContain('COST OF THIS FIGHT');
        expect(dying).not.toContain("THE FOE'S NEXT MOVE");
        // No cost offered: the terminal prompt is the old one.
        expect(combatNarrationPrompt(result([], { terminal: 'victory', postState: post }))).not.toContain('Let the ending carry its cost');
        expect(combatNarrationPrompt(result([], { terminal: 'victory', postState: post }), { cost: null })).not.toContain('Let the ending carry its cost');
    });
});
