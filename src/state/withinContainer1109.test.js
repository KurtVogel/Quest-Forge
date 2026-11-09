/**
 * A new place's container may itself be new (2026-11-09, the megacampaign
 * play): every DM name in the new port was "<spot>, Corve-in-the-South", no
 * record was the town, and the Scribe — allowed only KNOWN PLACES names in
 * `within` — put the Exchange Arcade "within" the water-stairs, the one Corve
 * record on its list. The Scribe may now name a container the fiction names
 * that the record lacks; the engine mints it as an unvisited record. The
 * Scribe decides what contains what; the gates only refuse an invention.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { gameReducer, initialGameState } from './gameReducer.js';
import { SCRIBE_SYSTEM_PROMPT } from '../llm/scribe.js';

const atMessages = (state, n) => ({ ...state, messages: Array.from({ length: n }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', content: `m${i}` })) });
const byName = (state, name) => state.locations.find(r => r.name === name);
const STAIRS = 'Lower water-stairs, Corve-in-the-South';
const TURN = 'You climb the slick granite water-stairs into the muddy alleys of Corve-in-the-South, the timber port of the Green Marches.';

const arrive = (state, name, n) => gameReducer(atMessages(state, n), { type: 'SET_LOCATION', payload: name });
const profile = (state, name, rawProfile, evidenceText = TURN) => gameReducer(state, { type: 'UPDATE_LOCATION_PROFILE', payload: { name, profile: rawProfile, evidenceText } });

afterEach(() => vi.restoreAllMocks());

describe('a container the record never held', () => {
    it('is minted when the Scribe names it and the turn names it: unvisited, not provisional, the spot within it, the land shared', () => {
        const info = vi.spyOn(console, 'info').mockImplementation(() => {});
        let state = arrive(initialGameState, STAIRS, 10);
        state = profile(state, STAIRS, { type: 'settlement', region: 'The Green Marches', within: 'Corve-in-the-South' });
        const town = byName(state, 'Corve-in-the-South');
        expect(town).toMatchObject({ visitCount: 0, lastVisitedMessage: null, provisional: false, region: 'The Green Marches' });
        expect(byName(state, STAIRS).within).toBe(town.id);
        expect(state.currentLocation).toBe(STAIRS); // the hero did not move
        expect(info.mock.calls.some(([line]) => String(line).includes('"Corve-in-the-South" recorded as the place'))).toBe(true);
    });

    it('the next spot in the same town copies it: one town record, both spots within it', () => {
        let state = arrive(initialGameState, STAIRS, 10);
        state = profile(state, STAIRS, { within: 'Corve-in-the-South' });
        state = arrive(state, 'Exchange Arcade', 14);
        state = profile(state, 'Exchange Arcade', { within: 'Corve-in-the-South' }, 'The Exchange Arcade of Corve-in-the-South is all shouting brokers.');
        const towns = state.locations.filter(r => r.name === 'Corve-in-the-South');
        expect(towns).toHaveLength(1);
        expect(byName(state, 'Exchange Arcade').within).toBe(towns[0].id);
        expect(byName(state, STAIRS).within).toBe(towns[0].id);
    });

    it('an invention is refused: a name neither the turn nor the place itself says', () => {
        let state = arrive(initialGameState, 'Upper sun-basin', 10);
        state = profile(state, 'Upper sun-basin', { within: 'Saltreach Citadel' }, 'Broad pale cobbles sweep between the oaks.');
        expect(byName(state, 'Saltreach Citadel')).toBeUndefined();
        expect(byName(state, 'Upper sun-basin').within).toBeNull();
    });

    it('the place\'s own name is evidence: "<spot>, <Town>" with a turn that never repeats the town', () => {
        let state = arrive(initialGameState, STAIRS, 10);
        state = profile(state, STAIRS, { within: 'Corve-in-the-South' }, 'The water-stairs are green with slime.');
        expect(byName(state, STAIRS).within).toBe(byName(state, 'Corve-in-the-South').id);
    });

    it('never a land, never the place itself, never a lowercase description', () => {
        // A land already on record is a land, not a container.
        let state = arrive(initialGameState, 'Cape Morrow', 4);
        state = profile(state, 'Cape Morrow', { region: 'Meren' }, 'Cape Morrow, the harbor of Meren.');
        state = arrive(state, 'The Split Keel', 8);
        state = profile(state, 'The Split Keel', { within: 'Meren' }, 'The Split Keel, the busiest tavern in Meren.');
        expect(state.locations.filter(r => r.name === 'Meren')).toHaveLength(0);
        // The land the same profile states is not its container either.
        state = arrive(state, 'Tidewater Stair', 12);
        state = profile(state, 'Tidewater Stair', { region: 'The Salt Coast', within: 'The Salt Coast' }, 'Tidewater Stair runs down to the Salt Coast.');
        expect(byName(state, 'The Salt Coast')).toBeUndefined();
        // The place itself, or a description, mints nothing.
        state = profile(state, 'Tidewater Stair', { within: 'Tidewater Stair' }, 'Tidewater Stair runs down to the water.');
        state = profile(state, 'Tidewater Stair', { within: 'the old town' }, 'Tidewater Stair runs down from the old town.');
        expect(byName(state, 'Tidewater Stair').within).toBeNull();
        expect(byName(state, 'the old town')).toBeUndefined();
    });

    it('a known container is still a copy: no second record when the list holds it', () => {
        let state = arrive(initialGameState, 'Corve-in-the-South', 4);
        state = arrive(state, STAIRS, 8);
        const before = state.locations.length;
        state = profile(state, STAIRS, { within: 'Corve-in-the-South' });
        expect(state.locations).toHaveLength(before);
        expect(byName(state, STAIRS).within).toBe(byName(state, 'Corve-in-the-South').id);
    });

    it('the Scribe is told it may name a container the list lacks, and never a neighbour because it is the only one listed', () => {
        expect(SCRIBE_SYSTEM_PROMPT).toContain('when the fiction NAMES that town or keep and KNOWN PLACES has no entry for it, its proper name exactly as the narrative gives it');
        expect(SCRIBE_SYSTEM_PROMPT).toContain('the engine records the town');
        expect(SCRIBE_SYSTEM_PROMPT).toContain('never a neighbouring spot because it is the only one on the list');
        expect(SCRIBE_SYSTEM_PROMPT).toContain('KNOWN LANDS are lands, not containers');
    });
});
