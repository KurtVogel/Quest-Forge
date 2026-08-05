/**
 * Living-world reducer tests (DECISIONS.md 2026-08-05): arrival detection and
 * visit stamps on SET_LOCATION, the traveling-rumor selection + ledger, the
 * absence-drift pending marker, and the one-shot INSTALL_ABSENCE_DRIFT.
 */
import { describe, expect, it } from 'vitest';
import { gameReducer, initialGameState } from './gameReducer.js';
import { ABSENCE_DRIFT_MIN_AWAY } from '../engine/worldTempo.js';

const msgs = n => Array.from({ length: n }, (_, i) => ({
    role: i % 2 ? 'assistant' : 'user',
    content: `m${i}`,
}));

const atMessages = (state, n) => ({ ...state, messages: msgs(n) });

describe('SET_LOCATION visit stamps and arrival detection', () => {
    it('stamps lastVisitedMessage on mint and on the departed record when leaving', () => {
        let state = gameReducer(atMessages(initialGameState, 4), { type: 'SET_LOCATION', payload: 'Aldermill' });
        expect(state.locations[0].lastVisitedMessage).toBe(4);

        state = gameReducer(atMessages(state, 10), { type: 'SET_LOCATION', payload: 'Deep Fen' });
        const aldermill = state.locations.find(record => record.name === 'Aldermill');
        expect(aldermill.lastVisitedMessage).toBe(10); // departure stamp
        expect(state.locations.find(record => record.name === 'Deep Fen').lastVisitedMessage).toBe(10);
    });

    it('does not treat an alias re-statement of the current place as an arrival', () => {
        let state = gameReducer(atMessages(initialGameState, 2), { type: 'SET_LOCATION', payload: 'Clockwork Tower' });
        state = { ...state, session: { ...state.session, regionalHearsay: { locationName: 'Clockwork Tower', arrivedAtMessage: 2, items: [{ text: 'x', grade: 'firsthand' }] } } };
        const next = gameReducer(atMessages(state, 6), { type: 'SET_LOCATION', payload: 'Library landing, Clockwork Tower' });
        expect(next.locations).toHaveLength(1);
        // Not an arrival: hearsay state untouched, no pending drift.
        expect(next.session.regionalHearsay).toBe(state.session.regionalHearsay);
        expect(next.session.pendingAbsenceDrift).toBeUndefined();
    });
});

describe('absence-drift pending marker', () => {
    const travel = () => {
        let state = gameReducer(atMessages(initialGameState, 0), { type: 'SET_LOCATION', payload: 'Aldermill' });
        return gameReducer(atMessages(state, 10), { type: 'SET_LOCATION', payload: 'Deep Fen' });
    };

    it('raises the one-shot marker on a long-enough return', () => {
        const returnAt = 10 + ABSENCE_DRIFT_MIN_AWAY + 5;
        const state = gameReducer(atMessages(travel(), returnAt), { type: 'SET_LOCATION', payload: 'Aldermill' });
        expect(state.session.pendingAbsenceDrift).toMatchObject({
            locationName: 'Aldermill',
            returnMessage: returnAt,
        });
        expect(state.session.pendingAbsenceDrift.awayDistance).toBeGreaterThanOrEqual(ABSENCE_DRIFT_MIN_AWAY);
        expect(state.session.pendingAbsenceDrift.key).toContain(`|${returnAt}`);
    });

    it('stays quiet on a short hop, a first visit, or when one is already pending', () => {
        const short = gameReducer(atMessages(travel(), 20), { type: 'SET_LOCATION', payload: 'Aldermill' });
        expect(short.session.pendingAbsenceDrift).toBeUndefined();

        const first = gameReducer(atMessages(initialGameState, 60), { type: 'SET_LOCATION', payload: 'Brand New Town' });
        expect(first.session.pendingAbsenceDrift).toBeUndefined();

        const withPending = {
            ...travel(),
            session: { ...travel().session, pendingAbsenceDrift: { key: 'other|1', locationName: 'Elsewhere', awayDistance: 50, returnMessage: 1 } },
        };
        const kept = gameReducer(atMessages(withPending, 60), { type: 'SET_LOCATION', payload: 'Aldermill' });
        expect(kept.session.pendingAbsenceDrift.key).toBe('other|1');
    });
});

describe('traveling rumor on arrival', () => {
    const withDeeds = () => ({
        ...initialGameState,
        fronts: [{ id: 'front-brood', title: 'The Mill Brood', status: 'resolved', resolvedAtMessage: 0, resolution: 'burned out' }],
        messages: msgs(30),
    });

    it('installs hearsay + ledger on arrival, and never re-offers the same deed at the same place', () => {
        let state = gameReducer(withDeeds(), { type: 'SET_LOCATION', payload: 'Saltmarsh' });
        expect(state.session.regionalHearsay).toMatchObject({ locationName: 'Saltmarsh', arrivedAtMessage: 30 });
        expect(state.session.regionalHearsay.items[0].text).toContain('The Mill Brood');
        expect(state.recentHearsay).toHaveLength(1);
        expect(state.recentHearsay[0]).toMatch(/^front:front-brood\|/);

        // Leave and return: the ledger blocks the repeat, hearsay clears.
        state = gameReducer(atMessages(state, 34), { type: 'SET_LOCATION', payload: 'Deep Fen' });
        state = gameReducer(atMessages(state, 38), { type: 'SET_LOCATION', payload: 'Saltmarsh' });
        expect(state.session.regionalHearsay).toBeNull();
        expect(state.recentHearsay).toHaveLength(2); // Deep Fen arrival earned its own offer
    });
});

describe('INSTALL_ABSENCE_DRIFT', () => {
    const pendingState = () => ({
        ...initialGameState,
        messages: msgs(50),
        session: {
            ...initialGameState.session,
            id: 'campaign-1',
            pendingAbsenceDrift: { key: 'loc-aldermill|50', locationName: 'Aldermill', awayDistance: 40, returnMessage: 50 },
        },
        locations: [{ id: 'loc-aldermill', name: 'Aldermill', aliases: [], type: 'settlement', danger: 'low', theaterFrontIds: ['front-tithe'] }],
        fronts: [{ id: 'front-tithe', title: 'The Tithe Collectors', status: 'active', clock: 4, maxClock: 6, stage: 1, faction: { name: 'Grey Ledger' } }],
        npcs: [{ id: 'npc-marta', name: 'Marta', rosterTier: 'character', lastLocation: 'Aldermill', lastNotes: 'Worried about her brother' }],
    });

    const drift = {
        developments: [
            { name: 'Marta', agenda: 'Keep the new roof paid off', lastNotes: 'Married the ferryman; the inn thrives', visible: 'A wedding ring' },
            { name: 'Invented Stranger', lastNotes: 'Should be filtered out' },
        ],
        worldFact: 'The ferry runs again under a new pilot',
        frontSymptom: 'Toll receipts nailed to the notice board',
    };

    it('installs bounded NPC changes, the fact, and a band-clamped theater symptom, one-shot', () => {
        const state = pendingState();
        const next = gameReducer(state, { type: 'INSTALL_ABSENCE_DRIFT', payload: { sessionId: 'campaign-1', key: 'loc-aldermill|50', drift } });

        expect(next.session.pendingAbsenceDrift).toBeNull();
        const marta = next.npcs.find(npc => npc.name === 'Marta');
        expect(marta.lastNotes).toContain('Married the ferryman');
        expect(marta.agenda).toContain('new roof');
        expect(next.npcs.some(npc => npc.name === 'Invented Stranger')).toBe(false);
        expect(next.worldFacts.some(fact => fact.fact.includes('ferry runs again'))).toBe(true);
        expect(next.session.absenceDrift).toMatchObject({
            locationName: 'Aldermill',
            arrivedAtMessage: 50,
            frontSymptom: { frontId: 'front-tithe', maxIntensity: 'presence' },
        });
        expect(next.session.absenceDrift.developments).toHaveLength(1);

        // Replay of the same result is a no-op once the pending marker is spent.
        expect(gameReducer(next, { type: 'INSTALL_ABSENCE_DRIFT', payload: { sessionId: 'campaign-1', key: 'loc-aldermill|50', drift } })).toBe(next);
    });

    it('drops stale, cross-session, or mismatched results without mutation', () => {
        const state = pendingState();
        expect(gameReducer(state, { type: 'INSTALL_ABSENCE_DRIFT', payload: { sessionId: 'other', key: 'loc-aldermill|50', drift } })).toBe(state);
        expect(gameReducer(state, { type: 'INSTALL_ABSENCE_DRIFT', payload: { sessionId: 'campaign-1', key: 'loc-aldermill|1', drift } })).toBe(state);
    });

    it('treats a quiet proposal as a clean, install-nothing answer', () => {
        const state = pendingState();
        const next = gameReducer(state, {
            type: 'INSTALL_ABSENCE_DRIFT',
            payload: { sessionId: 'campaign-1', key: 'loc-aldermill|50', drift: { developments: [], worldFact: '', frontSymptom: '' } },
        });
        expect(next.session.pendingAbsenceDrift).toBeNull();
        expect(next.session.absenceDrift).toBeNull();
        expect(next.npcs).toBe(state.npcs);
    });

    it('drops a symptom when no active front holds the place', () => {
        const state = pendingState();
        state.fronts = [{ ...state.fronts[0], status: 'resolved' }];
        const next = gameReducer(state, {
            type: 'INSTALL_ABSENCE_DRIFT',
            payload: { sessionId: 'campaign-1', key: 'loc-aldermill|50', drift: { developments: [], worldFact: '', frontSymptom: 'Something ominous' } },
        });
        expect(next.session.absenceDrift).toBeNull();
    });
});

describe('epistemics capture in the reducer', () => {
    it('ADD_WORLD_FACTS keeps a knower list and clears public-style entries', () => {
        const state = gameReducer(initialGameState, {
            type: 'ADD_WORLD_FACTS',
            payload: [
                { fact: 'The mayor forged the tithe ledger', category: 'event', knownBy: ['Marta', 'the hero'] },
                { fact: 'The ferry sank in spring', category: 'event', knownBy: ['everyone'] },
            ],
        });
        expect(state.worldFacts[0].knownBy).toEqual(['Marta', 'the hero']);
        expect(state.worldFacts[1].knownBy).toEqual([]);
    });

    it('ADD_STORY_MEMORY_CARD stamps firstSeenMessage at birth and keeps it on merge', () => {
        let state = { ...initialGameState, messages: Array.from({ length: 7 }, (_, i) => ({ role: 'user', content: `m${i}` })) };
        state = gameReducer(state, {
            type: 'ADD_STORY_MEMORY_CARD',
            payload: { text: 'Accused the magistrate before the crowd', type: 'callback', witnessed: true, salience: 4 },
        });
        expect(state.storyMemory[0].firstSeenMessage).toBe(7);
        expect(state.storyMemory[0].witnessed).toBe(true);

        state = { ...state, messages: [...state.messages, { role: 'assistant', content: 'later' }] };
        state = gameReducer(state, {
            type: 'ADD_STORY_MEMORY_CARD',
            payload: { text: 'Accused the magistrate before the crowd, loudly', type: 'callback' },
        });
        expect(state.storyMemory).toHaveLength(1);
        expect(state.storyMemory[0].firstSeenMessage).toBe(7);
        expect(state.storyMemory[0].witnessed).toBe(true);
    });
});

describe('front-resolution payoff ceremony', () => {
    const resolvableState = () => ({
        ...initialGameState,
        messages: msgs(10),
        session: { ...initialGameState.session, id: 'campaign-1' },
        character: {
            name: 'Rauha', race: 'human', class: 'cleric', level: 3, exp: 0,
            maxHP: 20, currentHP: 20,
            abilityScores: { strength: 10, dexterity: 10, constitution: 10, intelligence: 10, wisdom: 10, charisma: 10 },
        },
        fronts: [{
            id: 'front-brood', title: 'The Mill Brood', status: 'active',
            clock: 5, maxClock: 6, stage: 2, grimPortents: ['a', 'b', 'c'],
            goal: 'Overrun the mill', stakes: 'The mill falls',
        }],
    });

    it('awards engine-computed milestone XP and raises the chapter-close nudge, one-shot', () => {
        const next = gameReducer(resolvableState(), {
            type: 'UPDATE_FRONT',
            payload: { id: 'front-brood', status: 'resolved', notes: 'burned out of the cellar' },
        });
        // L3 threshold is 1800 → milestone 900.
        expect(next.character.exp).toBe(900);
        expect(next.messages.some(m => m.role === 'system' && m.content.includes('campaign milestone'))).toBe(true);
        expect(next.messages.some(m => m.role === 'system' && m.content.includes('Chronicle tab'))).toBe(true);
        expect(next.session.chapterCloseSuggested).toMatchObject({ frontId: 'front-brood', title: 'The Mill Brood' });

        // Re-emitting "resolved" on a later turn must not pay twice.
        const replay = gameReducer(next, {
            type: 'UPDATE_FRONT',
            payload: { id: 'front-brood', status: 'resolved', notes: 'burned out of the cellar' },
        });
        expect(replay.character.exp).toBe(900);
    });

    it('two resolutions at the same level are exactly one level-up', () => {
        const state = {
            ...resolvableState(),
            fronts: [
                ...resolvableState().fronts,
                { id: 'front-ledger', title: 'The Grey Ledger', status: 'active', clock: 5, maxClock: 6, stage: 2, grimPortents: ['a', 'b', 'c'], goal: 'Own the debts', stakes: 'Debt slavery' },
            ],
        };
        let next = gameReducer(state, { type: 'UPDATE_FRONT', payload: { id: 'front-brood', status: 'resolved' } });
        expect(next.character.level).toBe(3);
        next = gameReducer(next, { type: 'UPDATE_FRONT', payload: { id: 'front-ledger', status: 'resolved' } });
        expect(next.character.level).toBe(4);
        expect(next.character.exp).toBe(0);
    });

    it('writing a chronicle chapter consumes the nudge', () => {
        const resolved = gameReducer(resolvableState(), {
            type: 'UPDATE_FRONT',
            payload: { id: 'front-brood', status: 'resolved' },
        });
        const written = gameReducer(resolved, {
            type: 'ADD_CHRONICLE_CHAPTER',
            payload: { text: 'And so the brood burned.', title: 'Chapter 1', fromIndex: 0, toIndex: 9 },
        });
        expect(written.session.chapterCloseSuggested).toBeNull();
    });
});

describe('region name validation (2026-08-05 live playtest findings)', () => {
    it('rejects locality junk the Scribe emitted live and keeps real region names', async () => {
        const { sanitizeRegionName } = await import('../engine/locationRegistry.js');
        // Every junk value the first live playtest actually produced:
        expect(sanitizeRegionName('the docks', 'The docks')).toBeNull();
        expect(sanitizeRegionName('the coast', 'Netsholm')).toBeNull();
        expect(sanitizeRegionName('the district', 'The Gilded Eel')).toBeNull();
        // Real region names survive:
        expect(sanitizeRegionName('the Rimefell Marches', 'a fortified waystation')).toBe('the Rimefell Marches');
        expect(sanitizeRegionName('Vale of Reeds', 'Brackwater')).toBe('Vale of Reeds');
        // The place itself is never its own region; sentences are not names.
        expect(sanitizeRegionName('Fort Halla', 'Fort Halla')).toBeNull();
        expect(sanitizeRegionName('a long miserable stretch of frozen upland country', 'X')).toBeNull();
    });

    it('strips junk regions at the reducer boundary', () => {
        const state = gameReducer(initialGameState, {
            type: 'SET_LOCATION',
            payload: { name: 'The docks', profile: { type: 'settlement', region: 'the docks' } },
        });
        expect(state.locations[0].region).toBeNull();
    });
});

describe('absence-drift cooldown (2026-08-05 live playtest finding)', () => {
    it('one drift per homecoming: a recent install suppresses re-triggers on nearby stale records', () => {
        let state = gameReducer(atMessages(initialGameState, 0), { type: 'SET_LOCATION', payload: 'Gilded Eel' });
        state = gameReducer(atMessages(state, 5), { type: 'SET_LOCATION', payload: 'Old Docks' });
        state = gameReducer(atMessages(state, 10), { type: 'SET_LOCATION', payload: 'Far Fen' });
        // A drift just installed for the Gilded Eel return at message 50.
        state = {
            ...atMessages(state, 54),
            session: {
                ...state.session,
                pendingAbsenceDrift: null,
                absenceDrift: { locationName: 'Gilded Eel', arrivedAtMessage: 50, awayDistance: 40, developments: [], fact: 'x', frontSymptom: null },
            },
        };
        // Re-touching another stale record (Old Docks, last visited msg 10) 4
        // messages later must NOT raise a second marker.
        const next = gameReducer(state, { type: 'SET_LOCATION', payload: 'Old Docks' });
        expect(next.session.pendingAbsenceDrift ?? null).toBeNull();
    });
});

describe('regional front seeding', () => {
    const proposal = (title, factionName) => ({
        title,
        goal: 'Control the ice roads',
        stakes: 'The coast starves',
        grimPortents: ['tolls rise', 'a village empties', 'open seizure'],
        faction: { name: factionName, goal: 'Own every sled route' },
        reason: 'native to the coast',
    });

    const traveled = () => {
        let state = { ...initialGameState, session: { ...initialGameState.session, id: 'campaign-1' }, messages: msgs(20) };
        state = gameReducer(state, { type: 'SET_LOCATION', payload: 'Aldermill' });
        state = gameReducer(state, {
            type: 'UPDATE_LOCATION_PROFILE',
            payload: { name: 'Aldermill', profile: { type: 'settlement', danger: 'low', region: 'the Riverlands' } },
        });
        state = gameReducer(state, { type: 'SET_LOCATION', payload: 'Fort Halla' });
        return state;
    };

    it('never seeds the first-ever region (home), and seeds a genuinely new one', () => {
        let state = traveled();
        expect(state.session.pendingRegionalFronts).toBeUndefined();

        state = gameReducer(state, {
            type: 'UPDATE_LOCATION_PROFILE',
            payload: { name: 'Fort Halla', profile: { type: 'frontier', danger: 'moderate', region: 'the Icebound Coast' } },
        });
        expect(state.session.pendingRegionalFronts).toMatchObject({
            region: 'the Icebound Coast',
            locationName: 'Fort Halla',
        });
    });

    it('does not seed for a known region, from afar, or past the active-front cap', () => {
        let state = traveled();
        // Same region as home → no marker.
        const sameRegion = gameReducer(state, {
            type: 'UPDATE_LOCATION_PROFILE',
            payload: { name: 'Fort Halla', profile: { region: 'the Riverlands' } },
        });
        expect(sameRegion.session.pendingRegionalFronts).toBeUndefined();

        // Classifying a place the hero is NOT at → no marker.
        const elsewhere = gameReducer(state, {
            type: 'UPDATE_LOCATION_PROFILE',
            payload: { name: 'Aldermill', profile: { region: 'the Riverlands' } },
        });
        expect(elsewhere.session.pendingRegionalFronts).toBeUndefined();

        // Full front web → no marker.
        const full = {
            ...state,
            fronts: Array.from({ length: 4 }, (_, i) => ({ id: `f${i}`, title: `F${i}`, status: 'active' })),
        };
        const capped = gameReducer(full, {
            type: 'UPDATE_LOCATION_PROFILE',
            payload: { name: 'Fort Halla', profile: { region: 'the Icebound Coast' } },
        });
        expect(capped.session.pendingRegionalFronts).toBeUndefined();
    });

    it('INSTALL_REGIONAL_FRONTS installs validated natives with the arrival theater, one-shot', () => {
        let state = traveled();
        state = gameReducer(state, {
            type: 'UPDATE_LOCATION_PROFILE',
            payload: { name: 'Fort Halla', profile: { region: 'the Icebound Coast' } },
        });
        const key = state.session.pendingRegionalFronts.key;

        const installed = gameReducer(state, {
            type: 'INSTALL_REGIONAL_FRONTS',
            payload: { sessionId: 'campaign-1', key, fronts: [proposal('The Sled Toll', 'Kettu Syndicate'), { title: 'Junk' }] },
        });
        expect(installed.session.pendingRegionalFronts).toBeNull();
        expect(installed.session.seededRegions).toContain('the Icebound Coast');
        const regional = installed.fronts.find(f => f.title === 'The Sled Toll');
        expect(regional.clock).toBe(0);
        const halla = installed.locations.find(r => r.name === 'Fort Halla');
        expect(halla.theaterFrontIds).toContain(regional.id);

        // Replay after the marker is spent: dropped.
        expect(gameReducer(installed, {
            type: 'INSTALL_REGIONAL_FRONTS',
            payload: { sessionId: 'campaign-1', key, fronts: [proposal('Again', 'Again Clan')] },
        })).toBe(installed);

        // A region that was seeded (even emptily) never re-triggers.
        const again = gameReducer(installed, {
            type: 'UPDATE_LOCATION_PROFILE',
            payload: { name: 'Fort Halla', profile: { region: 'the Icebound Coast' } },
        });
        expect(again.session.pendingRegionalFronts).toBeNull();
    });

    it('marks the region seeded even when every proposal fails validation', () => {
        let state = traveled();
        state = gameReducer(state, {
            type: 'UPDATE_LOCATION_PROFILE',
            payload: { name: 'Fort Halla', profile: { region: 'the Icebound Coast' } },
        });
        const empty = gameReducer(state, {
            type: 'INSTALL_REGIONAL_FRONTS',
            payload: { sessionId: 'campaign-1', key: state.session.pendingRegionalFronts.key, fronts: [{ title: 'Junk' }] },
        });
        expect(empty.session.pendingRegionalFronts).toBeNull();
        expect(empty.session.seededRegions).toContain('the Icebound Coast');
        expect(empty.fronts).toEqual(state.fronts);
    });
});

describe('LOAD_GAME sanitation', () => {
    it('sanitizes the hearsay ledger from hostile saves', () => {
        const loaded = gameReducer(initialGameState, {
            type: 'LOAD_GAME',
            payload: {
                ...initialGameState,
                session: { id: 'campaign-1' },
                character: { name: 'Hero', race: 'human', class: 'fighter', level: 1, maxHP: 10, currentHP: 10, abilityScores: { STR: 10, DEX: 10, CON: 10, INT: 10, WIS: 10, CHA: 10 } },
                recentHearsay: [null, 42, 'fight:1|town|1', {}],
            },
        });
        expect(loaded.recentHearsay).toEqual(['fight:1|town|1']);
    });
});
