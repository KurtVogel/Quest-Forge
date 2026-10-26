/**
 * "The world has lands, not a name" (WOW 2026-10-26) through the reducer:
 * the face-only marker and the installer's profile (slice 1), the variety
 * tally's two feeds (slice 2), and the interlude's seams, consumption and
 * load typing (slice 3).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const rollQueue = [];
vi.mock('../engine/dice.ts', async () => {
    const actual = await vi.importActual('../engine/dice.ts');
    return {
        ...actual,
        rollDie: vi.fn((sides) => (rollQueue.length ? rollQueue.shift() : 1) % sides || sides),
        rollWithModifier: vi.fn((count, sides, modifier, description) => {
            const rolls = Array.from({ length: count }, () => (rollQueue.length ? rollQueue.shift() : 1));
            const subtotal = rolls.reduce((a, b) => a + b, 0);
            return { id: `roll-${Math.random()}`, notation: `${count}d${sides}`, rolls, subtotal, modifier, total: subtotal + modifier, description };
        }),
    };
});

const { gameReducer, initialGameState } = await import('./gameReducer.js');
const { INTERLUDE_CONCLUSION_DELAY, INTERLUDE_COOLDOWN_MESSAGES } = await import('../engine/interlude.js');

const msgs = n => Array.from({ length: n }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', content: `m${i}` }));
const atMessages = (state, n) => ({ ...state, messages: msgs(n) });
const face = () => ({ terrain: 'Black shingle and sea ice', people: 'Sealers who pay in oil', built: 'Driftwood halls', dread: 'The drowned under the ice', names: 'Kettu, Isk' });

const hero = () => ({
    name: 'Astra', race: 'human', class: 'fighter', level: 2, currentHP: 12, maxHP: 12, exp: 0,
    abilityScores: { strength: 16, dexterity: 14, constitution: 14, intelligence: 10, wisdom: 10, charisma: 8 },
    conditions: [], classResources: {}, hitDice: { total: 2, remaining: 2, die: 10 },
});

/** Home at Aldermill (the Riverlands), then standing at Fort Halla — the living-world test's own fixture. */
function traveled() {
    let state = {
        ...initialGameState,
        session: { ...initialGameState.session, id: 'campaign-1', premise: 'Trade wars run from the Riverlands to the Icebound Coast.' },
        character: hero(),
        messages: msgs(20),
    };
    state = gameReducer(state, { type: 'SET_LOCATION', payload: 'Aldermill' });
    state = gameReducer(state, { type: 'UPDATE_LOCATION_PROFILE', payload: { name: 'Aldermill', profile: { type: 'settlement', danger: 'low', region: 'the Riverlands' } } });
    state = gameReducer(state, { type: 'SET_LOCATION', payload: 'Fort Halla' });
    return state;
}

beforeEach(() => { rollQueue.length = 0; });
afterEach(() => { rollQueue.length = 0; });

describe('slice 1 — the face-only marker and the installer', () => {
    it('the home land asks for its face alone; the installer writes it, clears the marker, and marks nothing seeded', () => {
        const state = traveled();
        const pending = state.session.pendingRegionalFronts;
        expect(pending).toEqual({ key: 'the riverlands|20|profile', region: 'the Riverlands', locationName: 'Aldermill', profileOnly: true });
        const installed = gameReducer(state, {
            type: 'INSTALL_REGIONAL_FRONTS',
            payload: { sessionId: 'campaign-1', key: pending.key, fronts: [{ title: 'Should be ignored', goal: 'g', stakes: 's', grimPortents: ['a', 'b', 'c'], faction: { name: 'X', goal: 'y' } }], profile: face() },
        });
        expect(installed.session.pendingRegionalFronts).toBeNull();
        expect(installed.session.seededRegions ?? []).toEqual([]);
        expect(installed.fronts).toEqual(state.fronts);
        expect(installed.regions['the Riverlands']).toEqual({ ...face(), atMessage: 20 });
        // With its face on record, a home place re-classified asks for nothing.
        const again = gameReducer(installed, { type: 'UPDATE_LOCATION_PROFILE', payload: { name: 'Fort Halla', profile: { region: 'the Riverlands' } } });
        expect(again.session.pendingRegionalFronts).toBeNull();
    });

    it('the give-up (an empty install) clears a face-only marker and writes no face; the next classification asks again', () => {
        const state = traveled();
        const empty = gameReducer(state, { type: 'INSTALL_REGIONAL_FRONTS', payload: { sessionId: 'campaign-1', key: state.session.pendingRegionalFronts.key, fronts: [], profile: null } });
        expect(empty.session.pendingRegionalFronts).toBeNull();
        expect(empty.regions).toEqual({});
        const again = gameReducer(atMessages(empty, 26), { type: 'UPDATE_LOCATION_PROFILE', payload: { name: 'Fort Halla', profile: { region: 'the Riverlands' } } });
        expect(again.session.pendingRegionalFronts).toMatchObject({ region: 'the Riverlands', locationName: 'Fort Halla', profileOnly: true });
    });

    it('a wrong key, another campaign, or a stale marker installs nothing; a junk profile writes nothing', () => {
        const state = traveled();
        const key = state.session.pendingRegionalFronts.key;
        expect(gameReducer(state, { type: 'INSTALL_REGIONAL_FRONTS', payload: { sessionId: 'campaign-1', key: 'other', profile: face() } })).toBe(state);
        expect(gameReducer(state, { type: 'INSTALL_REGIONAL_FRONTS', payload: { sessionId: 'campaign-2', key, profile: face() } })).toBe(state);
        const junk = gameReducer(state, { type: 'INSTALL_REGIONAL_FRONTS', payload: { sessionId: 'campaign-1', key, profile: { terrain: 'only' } } });
        expect(junk.regions).toEqual({});
        expect(junk.session.pendingRegionalFronts).toBeNull();
    });

    it('a genuinely new land\'s seed replaces a pending face-only marker, and its install writes the face beside the natives', () => {
        let state = traveled();
        state = gameReducer(state, { type: 'UPDATE_LOCATION_PROFILE', payload: { name: 'Fort Halla', profile: { type: 'frontier', danger: 'moderate', region: 'the Icebound Coast' } } });
        const seed = state.session.pendingRegionalFronts;
        expect(seed).toEqual({ key: 'the icebound coast|20', region: 'the Icebound Coast', locationName: 'Fort Halla' });
        const installed = gameReducer(state, {
            type: 'INSTALL_REGIONAL_FRONTS',
            payload: {
                sessionId: 'campaign-1', key: seed.key,
                fronts: [{ title: 'The Sled Toll', goal: 'Control the ice roads', stakes: 'The coast starves', grimPortents: ['tolls rise', 'a village empties', 'open seizure'], faction: { name: 'Kettu Syndicate', goal: 'Own every sled route' }, reason: 'native' }],
                profile: face(),
            },
        });
        expect(installed.session.seededRegions).toContain('the Icebound Coast');
        expect(installed.fronts.some(f => f.title === 'The Sled Toll')).toBe(true);
        expect(installed.regions['the Icebound Coast']).toMatchObject({ dread: 'The drowned under the ice' });
        // The home's face is still unwritten: the next home classification asks for it.
        const home = gameReducer(atMessages(installed, 30), { type: 'SET_LOCATION', payload: 'Aldermill' });
        const asked = gameReducer(home, { type: 'UPDATE_LOCATION_PROFILE', payload: { name: 'Aldermill', profile: { region: 'the Riverlands' } } });
        expect(asked.session.pendingRegionalFronts).toMatchObject({ region: 'the Riverlands', profileOnly: true });
    });

    it('a seed never replaces a pending SEED (one at a time), and a deferred land still asks for its face', () => {
        let state = traveled();
        state = gameReducer(state, { type: 'UPDATE_LOCATION_PROFILE', payload: { name: 'Fort Halla', profile: { region: 'the Icebound Coast' } } });
        const seed = state.session.pendingRegionalFronts;
        state = gameReducer(atMessages(state, 24), { type: 'SET_LOCATION', payload: 'Saltreach Quay' });
        const blocked = gameReducer(state, { type: 'UPDATE_LOCATION_PROFILE', payload: { name: 'Saltreach Quay', profile: { region: 'the Saltreach' }, evidenceText: 'Saltreach Quay, in the Saltreach.' } });
        expect(blocked.session.pendingRegionalFronts).toBe(seed);

        // Full web: the land is deferred for its FRONTS; its FACE is asked for at once.
        let full = { ...traveled(), fronts: Array.from({ length: 4 }, (_, i) => ({ id: `f${i}`, title: `F${i}`, status: 'active' })) };
        full = gameReducer(full, { type: 'INSTALL_REGIONAL_FRONTS', payload: { sessionId: 'campaign-1', key: full.session.pendingRegionalFronts.key, fronts: [], profile: face() } });
        const deferred = gameReducer(full, { type: 'UPDATE_LOCATION_PROFILE', payload: { name: 'Fort Halla', profile: { region: 'the Icebound Coast' } } });
        expect(deferred.session.deferredRegions).toEqual(['the Icebound Coast']);
        expect(deferred.session.pendingRegionalFronts).toMatchObject({ region: 'the Icebound Coast', profileOnly: true });
    });
});

describe('slice 2 — the variety tally\'s feeds', () => {
    it('a place\'s archetype and motifs count ONCE per record; a re-classification repeating them adds nothing', () => {
        let state = traveled();
        state = gameReducer(state, { type: 'UPDATE_LOCATION_PROFILE', payload: { name: 'Fort Halla', profile: { type: 'hostile_site', archetype: 'Eyeless Undead', motifs: ['black ichor', 'Bone-piles', 'a third'] } } });
        expect(state.worldMotifs).toEqual({
            'eyeless undead': { count: 1, lastMessage: 20 },
            'black ichor': { count: 1, lastMessage: 20 },
            'bone-piles': { count: 1, lastMessage: 20 },
        });
        expect(state.locations.find(r => r.name === 'Fort Halla')).toMatchObject({ archetype: 'eyeless undead', motifs: ['black ichor', 'bone-piles'] });
        const again = gameReducer(atMessages(state, 30), { type: 'UPDATE_LOCATION_PROFILE', payload: { name: 'Fort Halla', profile: { archetype: 'eyeless undead', motifs: ['black ichor'] } } });
        expect(again.worldMotifs).toBe(state.worldMotifs);
        // A new archetype on the same record (the kind changed) counts.
        const changed = gameReducer(atMessages(state, 30), { type: 'UPDATE_LOCATION_PROFILE', payload: { name: 'Fort Halla', profile: { archetype: 'marsh leeches' } } });
        expect(changed.worldMotifs['marsh leeches']).toEqual({ count: 1, lastMessage: 30 });
        expect(changed.worldMotifs['eyeless undead'].count).toBe(1);
    });

    it('END_COMBAT counts each foe family once per fight (the head-noun fallback)', () => {
        let state = { ...traveled(), party: [], inventory: [] };
        rollQueue.push(9, 14, 8);
        state = gameReducer(state, { type: 'START_COMBAT', payload: { enemies: [
            { id: 'g1', name: 'Eyeless Scavenger', hp: 7, ac: 12, attackBonus: 4, damage: '1d6+2' },
            { id: 'g2', name: 'Eyeless Scavenger 2', hp: 7, ac: 12, attackBonus: 4, damage: '1d6+2' },
            { id: 'h1', name: 'Scarred Hound', hp: 5, ac: 11, attackBonus: 3, damage: '1d4' },
        ] } });
        const ended = gameReducer(state, { type: 'END_COMBAT', payload: {} });
        expect(ended.worldMotifs.scavenger).toMatchObject({ count: 1 });
        expect(ended.worldMotifs.hound).toMatchObject({ count: 1 });
    });
});

describe('slice 3 — the interlude\'s seams', () => {
    it('REGION: crossing into a second land mints the establishing shot once; the home land is remembered without one', () => {
        let state = traveled(); // the home land (the Riverlands) was classified while no other was known
        expect(state.session.interludedRegions).toEqual(['the Riverlands']);
        expect(state.session.interlude ?? null).toBeNull();
        state = gameReducer(state, { type: 'UPDATE_LOCATION_PROFILE', payload: { name: 'Fort Halla', profile: { region: 'the Icebound Coast' } } });
        expect(state.session.interlude).toMatchObject({ reason: 'region', region: 'the Icebound Coast', mintedAtMessage: 20, opensAtMessage: 20 });
        expect(state.session.interludedRegions).toEqual(['the Riverlands', 'the Icebound Coast']);
        // Arriving at another Coast place later mints nothing new.
        const spent = { ...state, session: { ...state.session, interlude: null } };
        let later = gameReducer(atMessages(spent, 200), { type: 'SET_LOCATION', payload: 'Rime Quay' });
        later = gameReducer(later, { type: 'UPDATE_LOCATION_PROFILE', payload: { name: 'Rime Quay', profile: { region: 'the Icebound Coast' } } });
        expect(later.session.interlude ?? null).toBeNull();
    });

    it('REGION: an arrival at a record already in a new land mints it too, and a fight defers it without spending the land', () => {
        let state = traveled();
        state = gameReducer(state, { type: 'UPDATE_LOCATION_PROFILE', payload: { name: 'Fort Halla', profile: { region: 'the Icebound Coast' } } });
        state = { ...state, session: { ...state.session, interlude: null, interludedRegions: ['the Riverlands'], lastInterludeMessage: undefined } };
        const inFight = gameReducer({ ...state, combat: { ...state.combat, active: true } }, { type: 'SET_LOCATION', payload: 'Aldermill' });
        const crossing = gameReducer({ ...inFight, combat: { ...inFight.combat, active: true } }, { type: 'SET_LOCATION', payload: 'Fort Halla' });
        expect(crossing.session.interlude ?? null).toBeNull();
        expect(crossing.session.interludedRegions).toEqual(['the Riverlands']);
        const calm = gameReducer({ ...crossing, combat: { ...crossing.combat, active: false }, messages: msgs(30) }, { type: 'SET_LOCATION', payload: 'Aldermill' });
        const arrived = gameReducer(atMessages(calm, 32), { type: 'SET_LOCATION', payload: 'Fort Halla' });
        expect(arrived.session.interlude).toMatchObject({ reason: 'region', region: 'the Icebound Coast' });
    });

    it('TURNING: a DM clock gain that crosses a stage mints the seam with the portent that came to pass', () => {
        const base = {
            ...initialGameState,
            session: { ...initialGameState.session, id: 'campaign-1' },
            messages: msgs(30),
            fronts: [{ id: 'f1', title: 'The Blockade', goal: 'g', stakes: 's', clock: 2, maxClock: 6, stage: 0, status: 'active', grimPortents: ['tolls rise', 'a village empties', 'open seizure'], publicHints: [], faction: { name: 'Gang', goal: 'x' } }],
        };
        const turned = gameReducer(base, { type: 'UPDATE_FRONT', payload: { id: 'f1', clock: 3, stage: 1, publicHints: ['a toll post on the ford'] } });
        expect(turned.fronts[0].stage).toBe(1);
        expect(turned.session.interlude).toMatchObject({ reason: 'turning', frontId: 'f1', material: 'tolls rise', opensAtMessage: 30 });
        // A softening or a stage-less note mints nothing.
        expect(gameReducer(base, { type: 'UPDATE_FRONT', payload: { id: 'f1', notes: 'quiet' } }).session.interlude ?? null).toBeNull();
    });

    it('CONCLUSION: a resolved front mints the seam a dozen rows out, with the title and the outcome', () => {
        const base = {
            ...initialGameState,
            session: { ...initialGameState.session, id: 'campaign-1' },
            character: hero(),
            messages: msgs(30),
            fronts: [{ id: 'f1', title: 'The Blockade', goal: 'Starve the town', stakes: 's', clock: 2, maxClock: 6, stage: 0, status: 'active', grimPortents: ['a', 'b', 'c'], publicHints: [], faction: { name: 'Gang', goal: 'x' } }],
        };
        const done = gameReducer(base, { type: 'UPDATE_FRONT', payload: { id: 'f1', status: 'resolved', notes: 'the weir stands open' } });
        expect(done.session.interlude).toMatchObject({
            reason: 'conclusion', frontId: 'f1', title: 'The Blockade', material: 'the weir stands open',
            mintedAtMessage: 30, opensAtMessage: 30 + INTERLUDE_CONCLUSION_DELAY,
        });
    });

    it('REST: a long rest mints the seam, a short rest never, and the cooldown holds between them', () => {
        const base = { ...initialGameState, session: { ...initialGameState.session, id: 'campaign-1' }, character: hero(), messages: msgs(30) };
        expect(gameReducer(base, { type: 'TAKE_REST', payload: 'short' }).session.interlude ?? null).toBeNull();
        const rested = gameReducer(base, { type: 'TAKE_REST', payload: 'long' });
        expect(rested.session.interlude).toMatchObject({ reason: 'rest', mintedAtMessage: 30 });
        expect(rested.session.lastInterludeMessage).toBe(30);
        const soon = { ...rested, session: { ...rested.session, interlude: null } };
        expect(gameReducer(atMessages(soon, 30 + INTERLUDE_COOLDOWN_MESSAGES - 2), { type: 'TAKE_REST', payload: 'long' }).session.interlude ?? null).toBeNull();
        expect(gameReducer(atMessages(soon, 30 + INTERLUDE_COOLDOWN_MESSAGES), { type: 'TAKE_REST', payload: 'long' }).session.interlude).toMatchObject({ reason: 'rest' });
    });

    it('DEMAND: REQUEST_INTERLUDE ignores the cooldown and opens at once — never in combat', () => {
        const base = { ...initialGameState, session: { ...initialGameState.session, id: 'campaign-1', lastInterludeMessage: 28 }, messages: msgs(30) };
        const asked = gameReducer(base, { type: 'REQUEST_INTERLUDE' });
        expect(asked.session.interlude).toMatchObject({ reason: 'demand', mintedAtMessage: 30, opensAtMessage: 30 });
        const fight = { ...base, combat: { ...base.combat, active: true } };
        expect(gameReducer(fight, { type: 'REQUEST_INTERLUDE' })).toBe(fight);
    });
});

describe('slice 3 — consumption and load', () => {
    const withOpen = () => ({
        ...initialGameState,
        session: { ...initialGameState.session, id: 'campaign-1', interlude: { key: 'rest|30', reason: 'rest', mintedAtMessage: 30, opensAtMessage: 30, region: null, frontId: null, title: null, material: null } },
        messages: msgs(31), // the player's line is in; the DM's reply is next
    });

    it('a narrative DM row spends the open interlude; a user row, a hidden row, a table-talk reply or a combat row never does', () => {
        const state = withOpen();
        expect(gameReducer(state, { type: 'ADD_MESSAGE', payload: { role: 'assistant', content: 'The land turns.' } }).session.interlude).toBeNull();
        expect(gameReducer(state, { type: 'ADD_MESSAGE', payload: { role: 'user', content: 'I walk on.' } }).session.interlude).not.toBeNull();
        expect(gameReducer(state, { type: 'ADD_MESSAGE', payload: { role: 'assistant', content: 'x', hidden: true } }).session.interlude).not.toBeNull();
        const ooc = { ...state, messages: [...msgs(30), { role: 'user', content: 'OOC: interlude please' }] };
        expect(gameReducer(ooc, { type: 'ADD_MESSAGE', payload: { role: 'assistant', content: 'Sure, next turn.' } }).session.interlude).not.toBeNull();
        const fight = { ...state, combat: { ...state.combat, active: true } };
        expect(gameReducer(fight, { type: 'ADD_MESSAGE', payload: { role: 'assistant', content: 'The blade falls.' } }).session.interlude).not.toBeNull();
    });

    it('LOAD_GAME types the regions, the tally and the interlude, seeds an empty tally from the ledger, and clamps the stamps', () => {
        const loaded = gameReducer(initialGameState, {
            type: 'LOAD_GAME',
            payload: {
                ...initialGameState,
                character: hero(),
                messages: msgs(10),
                session: {
                    id: 'campaign-1',
                    interlude: { key: 'rest|400', reason: 'rest', mintedAtMessage: 400, opensAtMessage: 400 },
                    interludedRegions: ['the Riverlands', 4, 'x'],
                    lastInterludeMessage: 999,
                    pendingRegionalFronts: { key: 'k|1|profile', region: 'The Vale', locationName: 'Mill', profileOnly: true },
                },
                regions: { 'The Vale': { ...face(), atMessage: 900 }, junk: { terrain: 'only' } },
                worldMotifs: { 'Eyeless Undead': { count: '2', lastMessage: 3 }, bad: 'x' },
                recentEncounters: [{ enemies: '2× ghoul', foeFamilies: ['ghoul'], outcome: 'victory', messageIndex: 4, location: 'Crypt' }],
            },
        });
        expect(loaded.session.interlude).toMatchObject({ reason: 'rest', mintedAtMessage: 10, opensAtMessage: 10 });
        expect(loaded.session.interludedRegions).toEqual(['the Riverlands', 'x']);
        expect(loaded.session.lastInterludeMessage).toBe(10);
        expect(loaded.session.pendingRegionalFronts).toEqual({ key: 'k|1|profile', region: 'The Vale', locationName: 'Mill', profileOnly: true });
        expect(loaded.regions).toEqual({ 'The Vale': { ...face(), atMessage: 10 } });
        // A tally with entries is trusted; the ledger seeds only an EMPTY one.
        expect(loaded.worldMotifs).toEqual({ 'eyeless undead': { count: 2, lastMessage: 3 } });
        const seeded = gameReducer(initialGameState, {
            type: 'LOAD_GAME',
            payload: { ...initialGameState, character: hero(), messages: msgs(10), session: { id: 'campaign-1' }, recentEncounters: [{ enemies: '2× ghoul', foeFamilies: ['ghoul'], outcome: 'victory', messageIndex: 4, location: 'Crypt' }] },
        });
        expect(seeded.worldMotifs).toEqual({ ghoul: { count: 1, lastMessage: 4 } });
        expect(seeded.regions).toEqual({});
        expect(seeded.session.interlude).toBeUndefined();
    });
});
