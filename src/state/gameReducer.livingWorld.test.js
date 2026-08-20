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

    it('nested-place guard: no drift for a street whose child shop was just visited (live playtest #7)', () => {
        // The street, the shop ON it, and the guild quarter fragment into three
        // records. The hero "returns" to the street after 30+ messages by ITS
        // stale stamp — but spent most of that time inside the shop. A related
        // record (shared "tallow" token) with a fresh stamp means no real absence.
        let state = gameReducer(atMessages(initialGameState, 5), { type: 'SET_LOCATION', payload: 'Tallow Lane' });
        state = gameReducer(atMessages(state, 8), { type: 'SET_LOCATION', payload: 'E. Duskwell, Tallow & Tapers' });
        state = gameReducer(atMessages(state, 20), { type: 'SET_LOCATION', payload: 'Weatherby Guild Quarter' });
        const returned = gameReducer(atMessages(state, 45), { type: 'SET_LOCATION', payload: 'Tallow Lane' });
        expect(returned.locations.map(r => r.name)).toContain('E. Duskwell, Tallow & Tapers');
        expect(returned.session.pendingAbsenceDrift).toBeUndefined();
    });

    it('nested-place guard: a genuine return past unrelated places still drifts', () => {
        let state = gameReducer(atMessages(initialGameState, 5), { type: 'SET_LOCATION', payload: 'Tallow Lane' });
        state = gameReducer(atMessages(state, 8), { type: 'SET_LOCATION', payload: 'Fen Causeway' });
        state = gameReducer(atMessages(state, 20), { type: 'SET_LOCATION', payload: 'Black Weirs' });
        const returned = gameReducer(atMessages(state, 45), { type: 'SET_LOCATION', payload: 'Tallow Lane' });
        expect(returned.session.pendingAbsenceDrift).toMatchObject({ locationName: 'Tallow Lane' });
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

    it('runs no rumor pass for a destination that neither resolves nor mints (playtest #8)', () => {
        // "The threshold of the hidden staircase" is scene furniture, not a place
        // with a gossiping audience — every such string used to count as a fresh
        // arrival and re-offer the same deeds under raw-text ledger keys.
        let state = gameReducer(withDeeds(), { type: 'SET_LOCATION', payload: 'Saltmarsh' });
        const hearsayBefore = state.session.regionalHearsay;
        const ledgerBefore = state.recentHearsay;
        const next = gameReducer(atMessages(state, 34), { type: 'SET_LOCATION', payload: 'the threshold of the hidden staircase' });
        expect(next.currentLocation).toBe('the threshold of the hidden staircase');
        expect(next.locations.map(r => r.name)).not.toContain('the threshold of the hidden staircase');
        expect(next.recentHearsay).toBe(ledgerBefore);
        expect(next.session.regionalHearsay).toBe(hearsayBefore);
    });

    it('does not re-offer a deed at a nested sibling of the place it was offered at (playtest #8)', () => {
        let state = gameReducer(withDeeds(), { type: 'SET_LOCATION', payload: 'Tallow Lane' });
        expect(state.recentHearsay).toHaveLength(1);
        const next = gameReducer(atMessages(state, 34), { type: 'SET_LOCATION', payload: 'E. Duskwell, Tallow & Tapers' });
        expect(next.recentHearsay).toHaveLength(1); // same audience, no second offer
        expect(next.session.regionalHearsay).toBeNull();
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

    it('rejects a development for a roster NPC who lives elsewhere (2026-08-19 audit)', () => {
        // The director's context holds only the NPCs of the return place, so a
        // proposal naming a distant roster NPC is a hallucination — installing
        // it would rewrite that NPC's agenda/lastNotes as if they lived here.
        const state = pendingState();
        state.npcs = [...state.npcs, { id: 'npc-renn', name: 'Renn', rosterTier: 'character', lastLocation: 'Deep Fen', lastNotes: 'Runs the fen ferry' }];
        const next = gameReducer(state, {
            type: 'INSTALL_ABSENCE_DRIFT',
            payload: {
                sessionId: 'campaign-1',
                key: 'loc-aldermill|50',
                drift: {
                    developments: [{ name: 'Renn', agenda: 'Secretly rule Aldermill', lastNotes: 'Moved to Aldermill and took over' }],
                    worldFact: '',
                    frontSymptom: '',
                },
            },
        });
        expect(next.npcs).toBe(state.npcs); // untouched — the development never installs
        expect(next.session.absenceDrift).toBeNull(); // nothing survived → install-nothing
        expect(next.session.pendingAbsenceDrift).toBeNull(); // the one-shot marker is still spent
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

    it('rejects all-lowercase descriptions — the 2026-08-06 live-run leak', async () => {
        const { sanitizeRegionName } = await import('../engine/locationRegistry.js');
        // Both slipped past the generic-token test in the second live playtest
        // and "the coastal artery" seeded 2 native fronts:
        expect(sanitizeRegionName('the coastal artery', 'Netsholm')).toBeNull();
        expect(sanitizeRegionName('the coastal mudflats', 'Drowned Anchor')).toBeNull();
        // A leading article carries no properness; the inner proper token does.
        expect(sanitizeRegionName('the Rimefell Marches', 'Fallow\'s End')).toBe('the Rimefell Marches');
        expect(sanitizeRegionName('Brackwater', 'The Gilded Eel')).toBe('Brackwater');
    });

    it('strips junk regions at the reducer boundary', () => {
        const state = gameReducer(initialGameState, {
            type: 'SET_LOCATION',
            payload: { name: 'The Docks', profile: { type: 'settlement', region: 'the docks' } },
        });
        expect(state.locations[0].region).toBeNull();
    });
});

describe('backstory-region guard (2026-08-06 live playtest #3)', () => {
    it('isBackstoryRegion: background-only lands are backstory, premise geography is not', async () => {
        const { isBackstoryRegion } = await import('../engine/locationRegistry.js');
        const background = 'Grew up a ferry-keeper\'s daughter on the Sorrow Fen crossings.';
        const premise = 'Saltmere lies in the Vale of Reeds; north is the Rimefell Marches.';

        expect(isBackstoryRegion('the Sorrow Fen', { background, premise })).toBe(true);
        expect(isBackstoryRegion('THE SORROW FEN', { background, premise })).toBe(true);
        // Premise names it too → real campaign geography, never rejected —
        // even when the background is also set there (home-region detection
        // must survive a background written in the campaign's home region).
        expect(isBackstoryRegion('the Vale of Reeds', {
            background: background + ' Now hauls freight across the Vale of Reeds.',
            premise,
        })).toBe(false);
        // Not in the background at all → not backstory.
        expect(isBackstoryRegion('the Rimefell Marches', { background, premise })).toBe(false);
        expect(isBackstoryRegion('the Sorrow Fen', {})).toBe(false);
        expect(isBackstoryRegion('', { background, premise })).toBe(false);
    });

    it('strips a backstory region before it can enter the registry or trigger seeding', () => {
        let state = {
            ...initialGameState,
            session: { ...initialGameState.session, id: 'campaign-1', premise: 'A tale set in the Vale of Reeds.' },
            character: { ...initialGameState.character, background: 'Born on the Sorrow Fen, fled after the fire.' },
            messages: Array.from({ length: 20 }, (_, i) => ({ role: 'user', content: `m${i}` })),
        };
        state = gameReducer(state, { type: 'SET_LOCATION', payload: 'Saltmere' });
        state = gameReducer(state, {
            type: 'UPDATE_LOCATION_PROFILE',
            payload: { name: 'Saltmere', profile: { type: 'settlement', region: 'the Vale of Reeds' } },
        });
        state = gameReducer(state, { type: 'SET_LOCATION', payload: 'Blackwater Weirs' });

        const poisoned = gameReducer(state, {
            type: 'UPDATE_LOCATION_PROFILE',
            payload: { name: 'Blackwater Weirs', profile: { type: 'frontier', region: 'the Sorrow Fen' } },
        });
        const weirs = poisoned.locations.find(r => r.name === 'Blackwater Weirs');
        expect(weirs.region ?? null).toBeNull();
        expect(weirs.type).toBe('frontier'); // rest of the profile still lands
        expect(poisoned.session.pendingRegionalFronts).toBeUndefined();

        // The same arrival with a genuinely new, non-backstory region still
        // seeds — here evidenced by the turn's own text (the Scribe dispatch
        // always carries it in production).
        const real = gameReducer(state, {
            type: 'UPDATE_LOCATION_PROFILE',
            payload: {
                name: 'Blackwater Weirs',
                profile: { region: 'the Rimefell Marches' },
                evidenceText: 'You cross the last weir into the Rimefell Marches.',
            },
        });
        expect(real.session.pendingRegionalFronts).toMatchObject({ region: 'the Rimefell Marches' });
    });
});

describe('first-seen region evidence gate + cluster inheritance (queue P2, playtest #8)', () => {
    const based = () => {
        let state = {
            ...initialGameState,
            session: { ...initialGameState.session, id: 'campaign-1', premise: 'Debts and river trade in the Harchwold.' },
            messages: msgs(20),
        };
        state = gameReducer(state, { type: 'SET_LOCATION', payload: 'Weatherby' });
        state = gameReducer(state, {
            type: 'UPDATE_LOCATION_PROFILE',
            payload: { name: 'Weatherby', profile: { type: 'settlement', region: 'the Harchwold' } },
        });
        return state;
    };

    it('rejects a well-formed phantom region with no evidence anywhere (the Rimefell Marches echo)', () => {
        let state = based();
        state = gameReducer(state, { type: 'SET_LOCATION', payload: 'Fort Halla' });
        const next = gameReducer(state, {
            type: 'UPDATE_LOCATION_PROFILE',
            payload: {
                name: 'Fort Halla',
                profile: { type: 'frontier', region: 'the Rimefell Marches' },
                evidenceText: 'The fort gate creaks open onto a muddy yard.',
            },
        });
        const fort = next.locations.find(r => r.name === 'Fort Halla');
        expect(fort.region ?? null).toBeNull();
        expect(fort.type).toBe('frontier'); // the rest of the profile still lands
        expect(next.session.pendingRegionalFronts).toBeUndefined();
    });

    it('accepts the same region when the turn text names it', () => {
        let state = based();
        state = gameReducer(state, { type: 'SET_LOCATION', payload: 'Fort Halla' });
        const next = gameReducer(state, {
            type: 'UPDATE_LOCATION_PROFILE',
            payload: {
                name: 'Fort Halla',
                profile: { region: 'the Rimefell Marches' },
                evidenceText: 'Beyond the gate the Rimefell Marches stretch north.',
            },
        });
        expect(next.locations.find(r => r.name === 'Fort Halla').region).toBe('the Rimefell Marches');
        expect(next.session.pendingRegionalFronts).toMatchObject({ region: 'the Rimefell Marches' });
    });

    it('re-tags an already-known region without needing evidence', () => {
        let state = based();
        state = gameReducer(state, { type: 'SET_LOCATION', payload: 'Aldermill' });
        const next = gameReducer(state, {
            type: 'UPDATE_LOCATION_PROFILE',
            payload: { name: 'Aldermill', profile: { type: 'settlement', region: 'the Harchwold' } },
        });
        expect(next.locations.find(r => r.name === 'Aldermill').region).toBe('the Harchwold');
    });

    it('a sub-place inherits its cluster region over a novel proposal', () => {
        let state = based();
        state = gameReducer(state, { type: 'SET_LOCATION', payload: 'Guild Quarter, Weatherby' });
        // Settlement no-fold: the quarter has its own record now.
        const quarter = state.locations.find(r => r.name === 'Guild Quarter, Weatherby');
        expect(quarter).toBeTruthy();
        const next = gameReducer(state, {
            type: 'UPDATE_LOCATION_PROFILE',
            payload: {
                name: 'Guild Quarter, Weatherby',
                profile: { type: 'settlement', region: 'the Rimefell Marches' },
                evidenceText: 'Talk in the Guild Quarter runs to the Rimefell Marches and its wars.',
            },
        });
        // The quarter sits in Weatherby, and Weatherby sits in the Harchwold —
        // a novel (even evidenced) region for a related record is the phantom class.
        expect(next.locations.find(r => r.name === 'Guild Quarter, Weatherby').region).toBe('the Harchwold');
        expect(next.session.pendingRegionalFronts).toBeUndefined();
    });
});

describe('region names never become location records (2026-08-06 live playtest #3 registry noise)', () => {
    const settled = () => {
        // The premise names the region so the first-seen evidence gate accepts it.
        let state = {
            ...initialGameState,
            session: { ...initialGameState.session, id: 'campaign-1', premise: 'A tale of the Rimefell Marches.' },
            messages: msgs(20),
        };
        state = gameReducer(state, { type: 'SET_LOCATION', payload: 'Aldermill' });
        state = gameReducer(state, {
            type: 'UPDATE_LOCATION_PROFILE',
            payload: { name: 'Aldermill', profile: { type: 'settlement', region: 'the Rimefell Marches' } },
        });
        return state;
    };

    it('SET_LOCATION to a bare known-region name updates currentLocation without minting a record', () => {
        const state = gameReducer(settled(), { type: 'SET_LOCATION', payload: 'the Rimefell Marches' });
        expect(state.currentLocation).toBe('the Rimefell Marches');
        expect(state.locations.map(r => r.name)).toEqual(['Aldermill']);
    });

    it('a compound place name inside a known region still mints its own record', () => {
        const state = gameReducer(settled(), { type: 'SET_LOCATION', payload: 'Ghyll, Rimefell Marches' });
        expect(state.locations.some(r => r.name === 'Ghyll, Rimefell Marches')).toBe(true);
    });

    it('a bare region re-statement never renames a compound place record (the Ghyll failure)', () => {
        let state = gameReducer(settled(), { type: 'SET_LOCATION', payload: 'Ghyll, Rimefell Marches' });
        state = gameReducer(state, { type: 'SET_LOCATION', payload: 'the Rimefell Marches' });
        const town = state.locations.find(r => r.name === 'Ghyll, Rimefell Marches');
        expect(town).toBeTruthy();
        expect(state.locations.some(r => r.name.toLowerCase() === 'the rimefell marches')).toBe(false);
    });

    it('UPDATE_LOCATION_PROFILE is update-only: a profile for an unknown place mints nothing', () => {
        const state = gameReducer(settled(), {
            type: 'UPDATE_LOCATION_PROFILE',
            payload: { name: 'Vale of Reeds', profile: { type: 'wilderness', danger: 'moderate' } },
        });
        expect(state.locations.map(r => r.name)).toEqual(['Aldermill']);
    });
});

describe('fillOnly SET_LOCATION (playtest #5: journal cadence must never relocate the hero)', () => {
    const base = () => ({ ...initialGameState, session: { ...initialGameState.session, id: 'campaign-1' }, messages: msgs(20) });

    it('a stale batch summary cannot clobber a fresher location', () => {
        let state = gameReducer(base(), { type: 'SET_LOCATION', payload: 'Weatherby' });
        state = gameReducer(state, { type: 'SET_LOCATION', payload: 'The Weirs' });
        const clobbered = gameReducer(state, { type: 'SET_LOCATION', payload: { name: 'Weatherby', fillOnly: true } });
        expect(clobbered).toBe(state); // no relocation, no phantom departure stamps
        expect(clobbered.currentLocation).toBe('The Weirs');
    });

    it('fills an empty location and re-affirms the current one normally', () => {
        const filled = gameReducer(base(), { type: 'SET_LOCATION', payload: { name: 'Weatherby', fillOnly: true } });
        expect(filled.currentLocation).toBe('Weatherby');

        let state = gameReducer(base(), { type: 'SET_LOCATION', payload: 'Clockwork Tower' });
        const affirmed = gameReducer(state, { type: 'SET_LOCATION', payload: { name: 'Library landing, Clockwork Tower', fillOnly: true } });
        expect(affirmed.locations).toHaveLength(1); // alias fold onto the same record
        expect(affirmed.locations[0].aliases).toContain('Library landing, Clockwork Tower');
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
        // The premise names both regions so the first-seen evidence gate accepts them.
        let state = {
            ...initialGameState,
            session: {
                ...initialGameState.session,
                id: 'campaign-1',
                premise: 'Trade wars run from the Riverlands to the Icebound Coast.',
            },
            messages: msgs(20),
        };
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

        // One-slot reserve (2026-08-06): at MAX_ACTIVE_FRONTS - 1 the installer
        // has no room either, so the marker isn't raised — the region stays
        // unseeded and may trigger later when a slot frees.
        const nearlyFull = {
            ...state,
            fronts: Array.from({ length: 3 }, (_, i) => ({ id: `f${i}`, title: `F${i}`, status: 'active' })),
        };
        const reserved = gameReducer(nearlyFull, {
            type: 'UPDATE_LOCATION_PROFILE',
            payload: { name: 'Fort Halla', profile: { region: 'the Icebound Coast' } },
        });
        expect(reserved.session.pendingRegionalFronts).toBeUndefined();
    });

    it('regional installs never fill the last front slot (2026-08-06 one-slot reserve)', () => {
        let state = traveled();
        state = { ...state, fronts: [{ id: 'f0', title: 'F0', status: 'active' }, { id: 'f1', title: 'F1', status: 'active' }] };
        state = gameReducer(state, {
            type: 'UPDATE_LOCATION_PROFILE',
            payload: { name: 'Fort Halla', profile: { region: 'the Icebound Coast' } },
        });
        const installed = gameReducer(state, {
            type: 'INSTALL_REGIONAL_FRONTS',
            payload: {
                sessionId: 'campaign-1',
                key: state.session.pendingRegionalFronts.key,
                fronts: [proposal('The Sled Toll', 'Kettu Syndicate'), proposal('The Ice Tithe', 'Frostbound Compact')],
            },
        });
        // Two valid proposals, but only one slot below the reserve line: 2 + 1 = 3 of 4.
        const active = installed.fronts.filter(f => (f.status || 'active') === 'active');
        expect(active).toHaveLength(3);
        expect(installed.fronts.some(f => f.title === 'The Sled Toll')).toBe(true);
        expect(installed.fronts.some(f => f.title === 'The Ice Tithe')).toBe(false);
        expect(installed.session.seededRegions).toContain('the Icebound Coast');
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
