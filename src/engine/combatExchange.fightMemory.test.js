/**
 * WOW 2026-09-28 (fight memory) — the engine half: the tally records who
 * saved whom, the hero's killing crits, and the exchange that first cut the
 * hero low; END_COMBAT's memories are minted on WITNESSES only, one graded
 * moment per companion with the direction in plain words; the place keeps a
 * mark; and the resonance cue rides an ONGOING narration at the fight's
 * first beat or the hero's drop to a quarter, only for an OLD key moment.
 */
import { describe, expect, it } from 'vitest';
import {
    buildFightMemories, combatNarrationPrompt, describeFightMark, describeFightResonance,
    FIGHT_RESONANCE_MIN_DISTANCE, recordExchangeCost, sanitizeFightTally, startFightTally,
} from './combatExchange.js';

const hero = (overrides = {}) => ({ name: 'Astra', currentHP: 20, maxHP: 20, ...overrides });
const torvald = (overrides = {}) => ({ id: 'c1', name: 'Torvald', hp: 18, maxHp: 18, status: 'healthy', ...overrides });
const mika = (overrides = {}) => ({ id: 'c2', name: 'Mika', hp: 12, maxHp: 12, status: 'healthy', ...overrides });
const goblin = (overrides = {}) => ({ id: 'g1', name: 'Goblin Cutter', hp: 7, maxHp: 7, condition: 'healthy', combatStatus: 'active', ...overrides });

const attack = (actor, target, { hit = true, damage = 5, remainingHp, maxHp = 20, critical = false, intercepted } = {}) => ({
    type: 'attack', actor, target, rolled: 15, dc: 13, hit, damage, remainingHp, maxHp, critical, ...(intercepted && { intercepted }),
});
const result = (events, { round = 1, terminal = null, exchangeId = `x-${round}` } = {}) => ({ exchangeId, kind: 'exchange', round, terminal, events });
const fold = (tally, events, opts = {}) => recordExchangeCost(tally, {
    result: result(events, opts), heroName: 'Astra',
    hpBefore: opts.hpBefore ?? 20, hpAfter: opts.hpAfter ?? 20,
    partyBefore: opts.partyBefore ?? [torvald()], partyAfter: opts.partyAfter ?? [torvald()],
});
const startState = (party = [torvald()]) => ({ character: hero(), inventory: [], party });
const endState = (tally, { party = [torvald()], enemies = [goblin({ hp: 0, condition: 'dead' })], location = 'the ford' } = {}) => ({
    character: hero({ currentHP: 5 }), inventory: [], party, currentLocation: location, combat: { active: true, enemies, fightTally: tally },
});

describe('sanitizeFightTally — the fight-memory fields', () => {
    it('types witnesses, saves (how whitelisted, by + saved required), killing crits, and the low exchange id; junk defaults empty', () => {
        const typed = sanitizeFightTally({
            heroMaxHp: 20, heroHpStart: 20,
            witnesses: ['Torvald', 4, null, 'Torvald', ' Mika '],
            saves: [
                { how: 'revived', by: 'Astra', saved: 'Torvald', detail: 7, round: '2' },
                { how: 'teleported', by: 'Astra', saved: 'Torvald' },
                { how: 'felled', by: '', saved: 'Astra' },
                'junk', null,
                { how: 'intercepted', by: 'Mika', saved: 'Astra', detail: 'Ogre', round: 0 },
            ],
            heroKillingCrits: [{ target: 'Ogre', damage: '19', round: 3, decisive: 'yes' }, null, { decisive: true }],
            heroLowExchangeId: '  x-2  ',
        });
        expect(typed.witnesses).toEqual(['Torvald', 'Mika']);
        expect(typed.saves).toEqual([
            { how: 'revived', by: 'Astra', saved: 'Torvald', detail: '', round: 2 },
            { how: 'intercepted', by: 'Mika', saved: 'Astra', detail: 'Ogre', round: 1 },
        ]);
        expect(typed.heroKillingCrits).toEqual([
            { target: 'Ogre', damage: 19, round: 3, decisive: false },
            { target: 'a foe', damage: 0, round: 1, decisive: true },
        ]);
        expect(typed.heroLowExchangeId).toBe('x-2');
        const bare = sanitizeFightTally({ heroMaxHp: 20, heroHpStart: 20, witnesses: 'Torvald', saves: 'x', heroKillingCrits: {}, heroLowExchangeId: 7 });
        expect(bare).toMatchObject({ witnesses: [], saves: [], heroKillingCrits: [], heroLowExchangeId: null });
    });

    it('START_COMBAT seeds the witnesses from the party present, deduped and typed', () => {
        const tally = startFightTally({ ...startState([torvald(), { name: 7 }, mika(), torvald()]) });
        expect(tally.witnesses).toEqual(['Torvald', 'Mika']);
        expect(startFightTally({ character: hero() }).witnesses).toEqual([]);
    });
});

describe('recordExchangeCost — who saved whom', () => {
    const start = startFightTally(startState());

    it('a companion back on their feet in the party snapshot is the hero\'s revive; a companion still down is not', () => {
        const down = [torvald({ hp: 0, status: 'downed' })];
        const revived = fold(start, [], { partyBefore: down, partyAfter: [torvald({ hp: 6 })], round: 2 });
        expect(revived.saves).toEqual([{ how: 'revived', by: 'Astra', saved: 'Torvald', detail: '', round: 2 }]);
        expect(fold(start, [], { partyBefore: down, partyAfter: down }).saves).toEqual([]);
        // A companion not in the party before (joined mid-fight) is nobody's revive.
        expect(fold(start, [], { partyBefore: [], partyAfter: [torvald({ hp: 6 })] }).saves).toEqual([]);
    });

    it('a companion\'s kill while the hero lay at 0 is a "felled" save — unless a natural 20 stood the hero up first', () => {
        const kill = attack('Torvald', 'Goblin Cutter', { damage: 9, remainingHp: 0, maxHp: 7 });
        const felled = fold(start, [{ type: 'death_save', natural: 11 }, kill], { hpBefore: 0, hpAfter: 0, round: 3 });
        expect(felled.saves).toEqual([{ how: 'felled', by: 'Torvald', saved: 'Astra', detail: 'Goblin Cutter', round: 3 }]);
        expect(felled.deathSaves).toBe(1);
        expect(fold(start, [{ type: 'death_save', natural: 20 }, kill], { hpBefore: 0, hpAfter: 1 }).saves).toEqual([]);
        // A conscious hero's companion kill is an ordinary kill; a wounding blow is no save.
        expect(fold(start, [kill], { hpBefore: 4, hpAfter: 4 }).saves).toEqual([]);
        expect(fold(start, [attack('Torvald', 'Goblin Cutter', { remainingHp: 2, maxHp: 7 })], { hpBefore: 0, hpAfter: 0 }).saves).toEqual([]);
    });

    it('a guard intercept counts as a save only while the hero stands at a quarter or less, and only when the blow lands', () => {
        const intercept = attack('Ogre', 'Torvald', { damage: 9, remainingHp: 9, maxHp: 18, intercepted: true });
        expect(fold(start, [intercept], { hpBefore: 5, hpAfter: 5 }).saves).toEqual([{ how: 'intercepted', by: 'Torvald', saved: 'Astra', detail: 'Ogre', round: 1 }]);
        expect(fold(start, [intercept], { hpBefore: 6, hpAfter: 6 }).saves).toEqual([]);
        expect(fold(start, [{ ...intercept, hit: false }], { hpBefore: 5, hpAfter: 5 }).saves).toEqual([]);
        // A downed hero is not "standing"; a plain blow on a companion is not an intercept.
        expect(fold(start, [intercept], { hpBefore: 0, hpAfter: 0 }).saves).toEqual([]);
        expect(fold(start, [attack('Ogre', 'Torvald', { damage: 9, remainingHp: 9, maxHp: 18 })], { hpBefore: 5, hpAfter: 5 }).saves).toEqual([]);
    });

    it('the hero\'s killing crit is recorded, decisive on a victory exchange; a non-killing crit and a companion\'s crit are not', () => {
        const crit = attack('Astra', 'Goblin Cutter', { critical: true, damage: 14, remainingHp: 0, maxHp: 7 });
        expect(fold(start, [crit], { terminal: 'victory', round: 2 }).heroKillingCrits).toEqual([{ target: 'Goblin Cutter', damage: 14, round: 2, decisive: true }]);
        expect(fold(start, [crit]).heroKillingCrits).toEqual([{ target: 'Goblin Cutter', damage: 14, round: 1, decisive: false }]);
        expect(fold(start, [attack('Astra', 'Goblin Cutter', { critical: true, damage: 4, remainingHp: 3, maxHp: 7 })]).heroKillingCrits).toEqual([]);
        expect(fold(start, [attack('Torvald', 'Goblin Cutter', { critical: true, damage: 9, remainingHp: 0, maxHp: 7 })]).heroKillingCrits).toEqual([]);
    });

    it('the low exchange is the FIRST one that cut a standing hero to a quarter or less, kept thereafter', () => {
        const r1 = fold(start, [attack('Ogre', 'Astra', { damage: 8, remainingHp: 12 })], { hpBefore: 20, hpAfter: 12, exchangeId: 'a' });
        expect(r1.heroLowExchangeId).toBeNull();
        const r2 = fold(r1, [attack('Ogre', 'Astra', { damage: 8, remainingHp: 4 })], { hpBefore: 12, hpAfter: 4, exchangeId: 'b' });
        expect(r2.heroLowExchangeId).toBe('b');
        const r3 = fold(r2, [attack('Ogre', 'Astra', { damage: 4, remainingHp: 0 })], { hpBefore: 4, hpAfter: 0, exchangeId: 'c' });
        expect(r3.heroLowExchangeId).toBe('b');
        // A hero who walked in already low never crosses: no low exchange (the marking rule's twin).
        const lowStart = startFightTally({ character: hero({ currentHP: 4 }), party: [] });
        expect(fold(lowStart, [attack('Ogre', 'Astra', { damage: 2, remainingHp: 2 })], { hpBefore: 4, hpAfter: 2, exchangeId: 'd' }).heroLowExchangeId).toBeNull();
    });
});

describe('buildFightMemories — witnesses only, one graded moment each, direction in plain words', () => {
    const start = startFightTally(startState([torvald(), mika()]));

    it('a revive is the hero\'s rescue of THAT companion (5); the other witness gets the next pattern that fits, or nothing', () => {
        const tally = fold(start, [], { partyBefore: [torvald({ hp: 0 }), mika()], partyAfter: [torvald({ hp: 6 }), mika()], round: 2 });
        const memories = buildFightMemories(tally, endState(tally, { party: [torvald({ hp: 6 }), mika()] }), 'victory');
        expect(memories).toEqual([{
            name: 'Torvald',
            moment: { kind: 'rescue', salience: 5, text: 'Astra pulled Torvald back from the ground mid-fight against Goblin Cutter at the ford — Astra saved Torvald\'s life.' },
        }]);
    });

    it('a companion\'s kill over the downed hero: rescue 5 on a win, shared danger 4 on a loss; the bystander witness shares the danger at 4 on the win', () => {
        const kill = attack('Torvald', 'Goblin Cutter', { damage: 9, remainingHp: 0, maxHp: 7 });
        const tally = fold(fold(start, [attack('Goblin Cutter', 'Astra', { damage: 20, remainingHp: 0 })], { hpBefore: 20, hpAfter: 0 }), [kill], { hpBefore: 0, hpAfter: 0, round: 2, partyBefore: [torvald(), mika()], partyAfter: [torvald(), mika()] });
        const won = buildFightMemories(tally, endState(tally, { party: [torvald(), mika()] }), 'victory');
        expect(won).toEqual([
            { name: 'Torvald', moment: { kind: 'rescue', salience: 5, text: 'Torvald cut down Goblin Cutter while Astra lay at 0 HP against Goblin Cutter at the ford — Torvald kept Astra alive until it was won.' } },
            { name: 'Mika', moment: { kind: 'shared_danger', salience: 4, text: 'Astra went down at 0 HP against Goblin Cutter at the ford; Mika with Torvald fought on until it was won.' } },
        ]);
        const lost = buildFightMemories(tally, endState(tally, { party: [torvald(), mika()], enemies: [goblin()] }), 'defeat');
        expect(lost[0].moment).toEqual({ kind: 'shared_danger', salience: 4, text: 'Torvald fought on over Astra\'s body against Goblin Cutter at the ford, felling Goblin Cutter, and still the fight was lost.' });
        expect(lost).toHaveLength(1); // a defeat with the hero down and nothing more is no memory for Mika
    });

    it('a guard intercept at the edge is a rescue 4; the decisive killing crit a shared danger 4; the hero cut low and winning, a 3', () => {
        const solo = startFightTally(startState([torvald()]));
        const intercept = fold(solo, [attack('Ogre', 'Torvald', { damage: 9, remainingHp: 9, maxHp: 18, intercepted: true })], { hpBefore: 20, hpAfter: 3 });
        const withLow = fold(intercept, [attack('Ogre', 'Torvald', { damage: 9, remainingHp: 9, maxHp: 18, intercepted: true })], { hpBefore: 3, hpAfter: 3, round: 2 });
        expect(buildFightMemories(withLow, endState(withLow), 'victory')[0].moment).toEqual({
            kind: 'rescue', salience: 4,
            text: 'Torvald stepped into Ogre\'s blow meant for Astra, who stood at 3 of 20 HP, against Goblin Cutter at the ford — Torvald took the hit for Astra.',
        });
        const decisive = fold(solo, [attack('Astra', 'Goblin Cutter', { critical: true, damage: 14, remainingHp: 0, maxHp: 7 })], { terminal: 'victory' });
        expect(buildFightMemories(decisive, endState(decisive), 'victory')[0].moment).toEqual({
            kind: 'shared_danger', salience: 4,
            text: 'Astra\'s critical blow felled Goblin Cutter and ended the fight against Goblin Cutter at the ford, with Torvald there to see it.',
        });
        const low = fold(solo, [attack('Goblin Cutter', 'Astra', { damage: 16, remainingHp: 4 })], { hpBefore: 20, hpAfter: 4 });
        expect(buildFightMemories(low, endState(low), 'victory')[0].moment).toEqual({
            kind: 'shared_danger', salience: 3,
            text: 'Astra was cut to 4 of 20 HP against Goblin Cutter at the ford and still won, Torvald beside them.',
        });
        // A big crit taken (half the hero's max) is a 3; a small one is nothing.
        const bigCrit = fold(solo, [attack('Goblin Cutter', 'Astra', { critical: true, damage: 10, remainingHp: 10 })], { hpBefore: 20, hpAfter: 10 });
        expect(buildFightMemories(bigCrit, endState(bigCrit), 'victory')[0].moment.salience).toBe(3);
        const smallCrit = fold(solo, [attack('Goblin Cutter', 'Astra', { critical: true, damage: 6, remainingHp: 14 })], { hpBefore: 20, hpAfter: 14 });
        expect(buildFightMemories(smallCrit, endState(smallCrit), 'victory')).toEqual([]);
    });

    it('witnesses only: a companion who joined after the blades came out remembers nothing, and one who has left the party is not written', () => {
        const solo = startFightTally(startState([torvald()]));
        const tally = fold(solo, [attack('Goblin Cutter', 'Astra', { damage: 20, remainingHp: 0 })], { hpBefore: 20, hpAfter: 0 });
        const late = buildFightMemories(tally, endState(tally, { party: [torvald(), mika()] }), 'victory');
        expect(late.map(m => m.name)).toEqual(['Torvald']);
        expect(buildFightMemories(tally, endState(tally, { party: [mika()] }), 'victory')).toEqual([]);
        // A clean fight, a null tally, no hero: nothing.
        expect(buildFightMemories(solo, endState(solo), 'victory')).toEqual([]);
        expect(buildFightMemories(null, endState(null), 'victory')).toEqual([]);
        expect(buildFightMemories(tally, { party: [torvald()] }, 'victory')).toEqual([]);
    });
});

describe('describeFightMark — the particular the place keeps', () => {
    const start = startFightTally(startState([torvald()]));
    it('ranks the companion holding the line over the revive, the drop, the decisive blow, the intercept, and the plain fall; nothing for a clean fight', () => {
        const down = fold(start, [attack('Goblin Cutter', 'Astra', { damage: 20, remainingHp: 0 })], { hpBefore: 20, hpAfter: 0 });
        const held = fold(down, [attack('Torvald', 'Goblin Cutter', { damage: 9, remainingHp: 0, maxHp: 7 })], { hpBefore: 0, hpAfter: 0, round: 2 });
        expect(describeFightMark(held, endState(held), 'victory')).toBe('Astra went down and Torvald fought on over the body until it was won');
        expect(describeFightMark(down, endState(down), 'victory')).toBe('Astra went down and the companions carried the fight');
        expect(describeFightMark(down, endState(down), 'defeat')).toBe('Astra was left at 0 HP');
        const revived = fold(start, [], { partyBefore: [torvald({ hp: 0 })], partyAfter: [torvald({ hp: 5 })] });
        expect(describeFightMark(revived, endState(revived), 'victory')).toBe('Astra brought Torvald back from the ground mid-fight');
        const decisive = fold(start, [attack('Astra', 'Goblin Cutter', { critical: true, damage: 14, remainingHp: 0, maxHp: 7 })], { terminal: 'victory' });
        expect(describeFightMark(decisive, endState(decisive), 'victory')).toBe('one blow of Astra\'s ended it — Goblin Cutter felled outright');
        const fell = fold(start, [attack('Goblin Cutter', 'Torvald', { damage: 18, remainingHp: 0, maxHp: 18 })], { partyAfter: [torvald({ hp: 0 })] });
        expect(describeFightMark(fell, endState(fell), 'victory')).toBe('Torvald went down');
        const cut = fold(start, [attack('Goblin Cutter', 'Astra', { damage: 17, remainingHp: 3 })], { hpBefore: 20, hpAfter: 3 });
        expect(describeFightMark(cut, endState(cut), 'victory')).toBe('Astra was cut down to 3 HP and still won');
        expect(describeFightMark(cut, endState(cut), 'escaped')).toBe('Astra was cut down to 3 HP');
        const critted = fold(start, [attack('Goblin Cutter', 'Torvald', { critical: true, damage: 6, remainingHp: 12, maxHp: 18 })]);
        expect(describeFightMark(critted, endState(critted), 'victory')).toBe("Torvald took Goblin Cutter's critical blow");
        expect(describeFightMark(start, endState(start), 'victory')).toBeNull();
        expect(describeFightMark(null, endState(null), 'victory')).toBeNull();
    });
});

describe('describeFightResonance — the echo lands in the next dangerous moment', () => {
    const msgs = n => Array.from({ length: n }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', content: `m${i}` }));
    const carried = (overrides = {}) => ({ text: 'Torvald cut down the wolf while Astra lay at 0 HP at the ford — Torvald kept Astra alive.', kind: 'rescue', salience: 5, atMessage: 4, at: 1, ...overrides });
    // The moment sits at index 4; distance counts the conversational rows AFTER it up to the last one.
    const stateWith = ({ moments = [carried()], party = [torvald()], messageCount = 5 + FIGHT_RESONANCE_MIN_DISTANCE, resolved = ['x-1'], tally = {} } = {}) => ({
        messages: msgs(messageCount),
        party,
        npcs: [{ id: 'n1', name: 'Torvald', kind: 'character', rosterTier: 'character', bondMoments: moments }],
        combat: { active: true, resolvedExchangeIds: resolved, fightTally: { ...startFightTally(startState()), ...tally } },
    });
    const ongoing = { exchangeId: 'x-1', terminal: null };

    it('fires on the fight\'s first beat for an old rescue key moment, naming the companion and the distance in turns', () => {
        const line = describeFightResonance(stateWith(), ongoing);
        expect(line).toBe(`FIGHT MEMORY (private, engine record): Torvald carries this from ${FIGHT_RESONANCE_MIN_DISTANCE / 2} turns ago: "Torvald cut down the wolf while Astra lay at 0 HP at the ford — Torvald kept Astra alive." Let it show as the fight opens in ONE beat of their bearing or a single line in their own voice — never a speech, never narrator commentary, never a second mention this fight.`);
    });

    it('is silent while the moment is too fresh, on a terminal beat, on a later beat that is not the low one, for a downed companion, and for a moment that is not a key rescue / shared danger', () => {
        expect(describeFightResonance(stateWith({ messageCount: 4 + FIGHT_RESONANCE_MIN_DISTANCE }), ongoing)).toBeNull();
        expect(describeFightResonance(stateWith(), { exchangeId: 'x-1', terminal: 'victory' })).toBeNull();
        expect(describeFightResonance(stateWith({ resolved: ['x-0', 'x-1'] }), ongoing)).toBeNull();
        expect(describeFightResonance(stateWith({ party: [torvald({ hp: 0, status: 'downed' })] }), ongoing)).toBeNull();
        expect(describeFightResonance(stateWith({ moments: [carried({ kind: 'gift' })] }), ongoing)).toBeNull();
        expect(describeFightResonance(stateWith({ moments: [carried({ salience: 3 })] }), ongoing)).toBeNull();
        expect(describeFightResonance(stateWith({ moments: [carried({ atMessage: undefined })] }), ongoing)).toBeNull();
        expect(describeFightResonance({ ...stateWith(), combat: { active: false } }, ongoing)).toBeNull();
    });

    it('fires again on the exchange that cut the hero to a quarter, with the low wording; at most two companions', () => {
        const state = stateWith({
            resolved: ['x-0', 'x-1', 'x-2'], tally: { heroLowExchangeId: 'x-2' },
            party: [torvald(), mika(), { id: 'c3', name: 'Jorun', hp: 9, maxHp: 9 }],
        });
        state.npcs.push(
            { id: 'n2', name: 'Mika', kind: 'character', rosterTier: 'character', bondMoments: [carried({ text: 'Mika stood over Astra at the mill.', kind: 'shared_danger', salience: 4 })] },
            { id: 'n3', name: 'Jorun', kind: 'character', rosterTier: 'character', bondMoments: [carried({ text: 'Jorun took the hit for Astra.', salience: 4 })] },
        );
        const line = describeFightResonance(state, { exchangeId: 'x-2', terminal: null });
        expect(line).toContain('with the hero cut this low');
        expect(line).toContain('Torvald carries this');
        expect(line).toContain('Mika carries this');
        expect(line).not.toContain('Jorun');
    });

    it('rides the ongoing narration prompt after the telegraph and never a terminal one', () => {
        const result = { exchangeId: 'x-1', kind: 'exchange', round: 1, terminal: null, events: [], postState: { player: { name: 'Astra', hp: 9, maxHp: 20 }, companions: [], enemies: [] } };
        const prompt = combatNarrationPrompt(result, { resonance: 'FIGHT MEMORY (private, engine record): Torvald carries this…' });
        expect(prompt).toContain('FIGHT MEMORY (private, engine record): Torvald carries this…');
        expect(prompt.indexOf('THE FOE\'S NEXT MOVE')).toBeLessThan(prompt.indexOf('FIGHT MEMORY'));
        expect(combatNarrationPrompt({ ...result, terminal: 'victory' }, { resonance: 'FIGHT MEMORY…', cost: 'COST OF THIS FIGHT: x.' })).not.toContain('FIGHT MEMORY');
        expect(combatNarrationPrompt(result, { resonance: null })).not.toContain('FIGHT MEMORY');
        expect(combatNarrationPrompt(result, { resonance: 7 })).not.toContain('FIGHT MEMORY');
    });
});
