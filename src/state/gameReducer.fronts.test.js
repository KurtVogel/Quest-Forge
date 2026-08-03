import { describe, expect, it } from 'vitest';
import { gameReducer, initialGameState } from './gameReducer.js';
import { createInitialFronts, normalizeFront } from '../engine/fronts.js';

const character = {
    name: 'Astra',
    race: 'human',
    class: 'fighter',
    level: 1,
    currentHP: 12,
    maxHP: 12,
    abilityScores: { strength: 16, dexterity: 12, constitution: 14, intelligence: 10, wisdom: 10, charisma: 8 },
    conditions: [],
};

describe('creation-time front anchor', () => {
    it('anchors on a place name extracted from the premise, never the raw premise sentence', () => {
        const fronts = createInitialFronts({
            premise: 'Kalden Vor, a human fighter and disgraced caravan guard, arrives in the smuggler’s port of Brackwater seeking work.',
            character: { name: 'Kalden Vor' },
        });
        expect(fronts[0].title).toBe('Trouble around Brackwater');
        expect(fronts[0].title).not.toContain('fighter');
        expect(fronts[0].title).not.toContain('Kalden');
    });

    it('prefers a known location over the premise', () => {
        const fronts = createInitialFronts({
            premise: 'A drifter arrives in the port of Brackwater.',
            location: 'The Rusty Flagon, Millhaven',
        });
        expect(fronts[0].title).toBe('Trouble around The Rusty Flagon, Millhaven');
    });

    it('falls back to a generic region when the premise offers no place-like name', () => {
        const fronts = createInitialFronts({
            premise: 'a wandering sellsword looks for coin and trouble.',
            character: { name: 'Astra' },
        });
        expect(fronts[0].title).toBe('Trouble around the starting region');
    });
});

describe('hidden campaign fronts', () => {
    it('seeds an initial hidden front when a campaign session starts', () => {
        const withCharacter = gameReducer(initialGameState, {
            type: 'START_CHARACTER',
            payload: { character, inventory: [] },
        });

        const next = gameReducer(withCharacter, {
            type: 'UPDATE_SESSION',
            payload: {
                id: 'session-1',
                name: 'Rain Road',
                premise: 'Astra reaches Jewelglade while people vanish on the north road.',
            },
        });

        expect(next.fronts).toHaveLength(1);
        expect(next.fronts[0]).toMatchObject({
            id: 'front-local-pressure',
            status: 'active',
            clock: 0,
        });
        expect(next.fronts[0].goal).toContain('Jewelglade');
    });

    it('merges structured front updates by id', () => {
        const state = {
            ...initialGameState,
            fronts: [{
                id: 'front-local-pressure',
                title: 'Trouble around Jewelglade',
                goal: 'A local threat gathers leverage.',
                stakes: 'Who suffers first?',
                grimPortents: ['A warning sign appears.'],
                clock: 0,
                maxClock: 6,
                stage: 0,
                status: 'active',
                publicHints: [],
            }],
        };

        const next = gameReducer(state, {
            type: 'UPDATE_FRONT',
            payload: {
                id: 'front-local-pressure',
                clock: 1,
                stage: 1,
                publicHints: ['Refugees avoid the north road.'],
            },
        });

        expect(next.fronts[0]).toMatchObject({
            id: 'front-local-pressure',
            title: 'Trouble around Jewelglade',
            clock: 1,
            stage: 1,
            publicHints: ['Refugees avoid the north road.'],
        });
    });

    it('installs richer generated fronts only for the matching fresh session', () => {
        const state = {
            ...initialGameState,
            character,
            session: { id: 'fresh-session', createdAt: 1 },
            fronts: [{ id: 'front-local-pressure', title: 'Fallback' }],
        };
        const generated = [1, 2].map(index => ({
            id: `front-v2-${index}`,
            title: `Pressure ${index}`,
            goal: `Goal ${index}`,
            stakes: `Stakes ${index}`,
            grimPortents: ['One', 'Two', 'Three'],
            faction: { name: `Faction ${index}`, goal: 'Gain leverage.' },
        }));

        const ignored = gameReducer(state, {
            type: 'INSTALL_GENERATED_FRONTS',
            payload: { sessionId: 'another-session', fronts: generated },
        });
        expect(ignored).toBe(state);

        const installed = gameReducer(state, {
            type: 'INSTALL_GENERATED_FRONTS',
            payload: { sessionId: 'fresh-session', fronts: generated },
        });
        expect(installed.fronts).toHaveLength(2);
        expect(installed.fronts[0].faction.name).toBe('Faction 1');
        expect(installed.session.frontDirector).toMatchObject({ version: 2, source: 'campaign-creation' });
    });

    it('installs a late-arriving generation while the fallback front is untouched (2026-07-14 eval race)', () => {
        // Generation runs on the slow DM model; a fast player reaches turn 2+
        // before it resolves. The old > 2 visible-message guard silently
        // discarded the result and stranded the campaign on the fallback front.
        const state = {
            ...initialGameState,
            character,
            session: { id: 'fresh-session', createdAt: 1 },
            messages: [
                { role: 'assistant', content: 'Opening scene.' },
                { role: 'user', content: 'Turn 1.' },
                { role: 'assistant', content: 'Turn 1 reply.' },
                { role: 'user', content: 'Turn 2.' },
            ],
            fronts: [{ id: 'front-local-pressure', title: 'Fallback', clock: 0, stage: 0 }],
        };
        const generated = [1, 2].map(index => ({
            id: `front-v2-${index}`,
            title: `Pressure ${index}`,
            goal: `Goal ${index}`,
            stakes: `Stakes ${index}`,
            grimPortents: ['One', 'Two', 'Three'],
            faction: { name: `Faction ${index}`, goal: 'Gain leverage.' },
        }));

        const installed = gameReducer(state, {
            type: 'INSTALL_GENERATED_FRONTS',
            payload: { sessionId: 'fresh-session', fronts: generated },
        });
        expect(installed.fronts).toHaveLength(2);
        expect(installed.session.frontDirector).toMatchObject({ version: 2 });

        const movedFallback = {
            ...state,
            fronts: [{ id: 'front-local-pressure', title: 'Fallback', clock: 2, stage: 1 }],
        };
        expect(gameReducer(movedFallback, {
            type: 'INSTALL_GENERATED_FRONTS',
            payload: { sessionId: 'fresh-session', fronts: generated },
        })).toBe(movedFallback);
    });

    it('applies a bounded cadenced advance once and derives portent stage in the engine', () => {
        const state = {
            ...initialGameState,
            session: { id: 'campaign', frontDirector: { version: 2, lastJournalEnd: 10 } },
            fronts: [{
                id: 'front-road',
                title: 'The Closed Road',
                goal: 'Control the food road.',
                stakes: 'The town starves.',
                grimPortents: ['Caravans stop.', 'Stores empty.', 'Riots begin.'],
                clock: 1,
                maxClock: 6,
                stage: 0,
                status: 'active',
                publicHints: [],
            }],
        };
        const action = {
            type: 'APPLY_FRONT_ADVANCE_BATCH',
            payload: {
                cadenceId: 'journal-campaign-20',
                journalEnd: 20,
                advances: [{ id: 'front-road', delta: 99, symptom: 'The last mule train arrives empty.', reason: 'A week passed.' }],
            },
        };

        const advanced = gameReducer(state, action);
        expect(advanced.fronts[0]).toMatchObject({
            clock: 2,
            stage: 1,
            publicHints: ['The last mule train arrives empty.'],
            lastAdvanceId: 'journal-campaign-20',
        });
        expect(advanced.session.frontDirector).toMatchObject({ lastJournalEnd: 20, lastAppliedCount: 1 });
        expect(gameReducer(advanced, action)).toBe(advanced);
    });

    it('lets only one front gain clock per cadence while other advances keep their symptoms', () => {
        const makeFront = (id) => ({
            id, title: id, goal: 'Press.', stakes: 'Pain.',
            grimPortents: ['One.', 'Two.', 'Three.'],
            clock: 1, maxClock: 6, stage: 0, status: 'active', publicHints: [],
        });
        const state = {
            ...initialGameState,
            session: { id: 'campaign', frontDirector: { version: 2, lastJournalEnd: 10 } },
            fronts: [makeFront('front-a'), makeFront('front-b')],
        };
        const advanced = gameReducer(state, {
            type: 'APPLY_FRONT_ADVANCE_BATCH',
            payload: {
                cadenceId: 'cad-20',
                journalEnd: 20,
                advances: [
                    { id: 'front-a', delta: 1, symptom: 'Patrols double.', reason: 'Opportunity.' },
                    { id: 'front-b', delta: 1, symptom: 'Prices spike.', reason: 'Opportunity.' },
                ],
            },
        });
        expect(advanced.fronts[0].clock).toBe(2);
        expect(advanced.fronts[1].clock).toBe(1); // clock held by the pacing guard
        expect(advanced.fronts[1].publicHints).toContain('Prices spike.'); // symptom still lands
        expect(advanced.fronts[1].lastAdvanceDelta).toBe(0);
    });

    it('does not let a front already at max clock consume the cadence clock-gain slot', () => {
        const makeFront = (id, clock) => ({
            id, title: id, goal: 'Press.', stakes: 'Pain.',
            grimPortents: ['One.', 'Two.', 'Three.'],
            clock, maxClock: 6, stage: 0, status: 'active', publicHints: [],
        });
        const state = {
            ...initialGameState,
            session: { id: 'campaign', frontDirector: { version: 2, lastJournalEnd: 10 } },
            // The maxed front is FIRST, so pre-fix it would eat the slot.
            fronts: [makeFront('front-maxed', 6), makeFront('front-live', 1)],
        };
        const advanced = gameReducer(state, {
            type: 'APPLY_FRONT_ADVANCE_BATCH',
            payload: {
                cadenceId: 'cad-20',
                journalEnd: 20,
                advances: [
                    { id: 'front-maxed', delta: 1, symptom: 'The siege tightens.', reason: 'Nowhere left to go.' },
                    { id: 'front-live', delta: 1, symptom: 'Scouts probe the walls.', reason: 'Opportunity.' },
                ],
            },
        });
        expect(advanced.fronts[0].clock).toBe(6); // capped — cannot move
        expect(advanced.fronts[0].lastAdvanceDelta).toBe(0);
        expect(advanced.fronts[0].publicHints).toContain('The siege tightens.'); // symptom still lands
        expect(advanced.fronts[1].clock).toBe(2); // the slot went to the front that could use it
        expect(advanced.fronts[1].lastAdvanceDelta).toBe(1);
    });

    it('skips advances aimed at dormant or resolved fronts entirely', () => {
        const makeFront = (id, status) => ({
            id, title: id, goal: 'Press.', stakes: 'Pain.',
            grimPortents: ['One.', 'Two.', 'Three.'],
            clock: 2, maxClock: 6, stage: 1, status, publicHints: [],
        });
        const state = {
            ...initialGameState,
            session: { id: 'campaign', frontDirector: { version: 2, lastJournalEnd: 10 } },
            fronts: [makeFront('front-dormant', 'dormant'), makeFront('front-resolved', 'resolved')],
        };
        const next = gameReducer(state, {
            type: 'APPLY_FRONT_ADVANCE_BATCH',
            payload: {
                cadenceId: 'cad-20',
                journalEnd: 20,
                advances: [
                    { id: 'front-dormant', delta: 1, symptom: 'Stirring.', reason: 'Time.' },
                    { id: 'front-resolved', delta: 1, symptom: 'Echoes.', reason: 'Time.' },
                ],
            },
        });
        for (const front of next.fronts) {
            expect(front.clock).toBe(2);
            expect(front.publicHints).toEqual([]);
            expect(front.lastAdvanceId).toBeFalsy();
        }
    });

    it('refuses a clock gain for a front that advanced in the immediately previous cadence', () => {
        const front = {
            id: 'front-road', title: 'The Closed Road', goal: 'Choke the road.', stakes: 'Starvation.',
            grimPortents: ['One.', 'Two.', 'Three.'],
            clock: 2, maxClock: 6, stage: 1, status: 'active', publicHints: [],
            lastAdvanceId: 'cad-20', lastAdvanceDelta: 1,
        };
        const state = {
            ...initialGameState,
            session: { id: 'campaign', frontDirector: { version: 2, lastCadenceId: 'cad-20', lastJournalEnd: 20 } },
            fronts: [front],
        };
        const throttled = gameReducer(state, {
            type: 'APPLY_FRONT_ADVANCE_BATCH',
            payload: {
                cadenceId: 'cad-30',
                journalEnd: 30,
                advances: [{ id: 'front-road', delta: 1, symptom: 'Another caravan vanishes.', reason: 'Time passed.' }],
            },
        });
        expect(throttled.fronts[0].clock).toBe(2); // cooldown: no consecutive-cadence gains
        expect(throttled.fronts[0].lastAdvanceDelta).toBe(0);

        // The cadence after that may advance again.
        const resumed = gameReducer(throttled, {
            type: 'APPLY_FRONT_ADVANCE_BATCH',
            payload: {
                cadenceId: 'cad-40',
                journalEnd: 40,
                advances: [{ id: 'front-road', delta: 1, symptom: 'The road closes.', reason: 'Unopposed.' }],
            },
        });
        expect(resumed.fronts[0].clock).toBe(3);
        expect(resumed.fronts[0].lastAdvanceDelta).toBe(1);
    });

    it('never throttles softening — player interference always lands', () => {
        const front = {
            id: 'front-road', title: 'The Closed Road', goal: 'Choke the road.', stakes: 'Starvation.',
            grimPortents: ['One.', 'Two.', 'Three.'],
            clock: 3, maxClock: 6, stage: 1, status: 'active', publicHints: [],
            lastAdvanceId: 'cad-20', lastAdvanceDelta: 1,
        };
        const state = {
            ...initialGameState,
            session: { id: 'campaign', frontDirector: { version: 2, lastCadenceId: 'cad-20', lastJournalEnd: 20 } },
            fronts: [front],
        };
        const softened = gameReducer(state, {
            type: 'APPLY_FRONT_ADVANCE_BATCH',
            payload: {
                cadenceId: 'cad-30',
                journalEnd: 30,
                advances: [{ id: 'front-road', delta: -1, symptom: 'The ambush was broken.', reason: 'The hero cleared the pass.' }],
            },
        });
        expect(softened.fronts[0].clock).toBe(2);
        expect(softened.fronts[0].lastAdvanceDelta).toBe(-1);
    });

    it('rejects unknown front updates and bounds direct clock changes to one step', () => {
        const state = {
            ...initialGameState,
            fronts: [{ id: 'known', title: 'Known', clock: 2, stage: 1, maxClock: 6 }],
        };
        expect(gameReducer(state, { type: 'UPDATE_FRONT', payload: { id: 'invented', clock: 6 } })).toBe(state);
        const next = gameReducer(state, { type: 'UPDATE_FRONT', payload: { id: 'known', clock: 6, stage: 6 } });
        expect(next.fronts[0]).toMatchObject({ clock: 3, stage: 2, maxClock: 6 });
    });

    it('never regresses portent stage through the per-turn UPDATE_FRONT channel', () => {
        // The DM never sees stage values (they are private), so a lower stage is a
        // blind guess — the cadence engine keeps stage monotonic and so does this path.
        const state = {
            ...initialGameState,
            fronts: [{ id: 'known', title: 'Known', clock: 3, stage: 2, maxClock: 6 }],
        };
        const next = gameReducer(state, { type: 'UPDATE_FRONT', payload: { id: 'known', clock: 2, stage: 0 } });
        expect(next.fronts[0]).toMatchObject({ clock: 2, stage: 2 }); // clock softens, stage holds
    });

    // The legacy MIGRATE_FRONTS (v1 contextual migration) action was removed in
    // the 2026-07-31 dead-code sweep — the shipped upgrade path is UPGRADE_FRONTS_V2.

    it('upgrades Vesa in place without changing character or established front history', () => {
        const vesa = { ...character, name: 'Vesa', class: 'fighter', level: 3 };
        const inventory = [{ name: 'Warhammer', equipped: true }];
        const quests = [{ name: 'The Alderman’s Bounty', status: 'completed' }];
        const existingFront = {
            id: 'front-local-pressure', title: 'Goblin Aftermath', goal: 'Survivors seek leverage.', stakes: 'The road suffers.',
            grimPortents: ['Tracks spread.', 'A guide vanishes.', 'A banner rises.'], clock: 2, maxClock: 6, stage: 1,
            status: 'active', publicHints: ['Fresh tracks leave the cavern.'], notes: 'Kraul remains dead.',
        };
        const state = {
            ...initialGameState,
            character: vesa,
            inventory,
            quests,
            session: { id: 'vesa-campaign', prunedMessageCount: 20 },
            fronts: [existingFront],
        };
        const action = {
            type: 'UPGRADE_FRONTS_V2',
            payload: {
                sessionId: 'vesa-campaign',
                enrichments: [{ id: 'front-local-pressure', faction: { name: 'Kraul’s Remnants', goal: 'Choose a successor.', stance: 'Terrified of Vesa' } }],
                newFronts: [{
                    id: 'front-upgrade-2', title: 'The Sealed Bounty', goal: 'Suppress the alderman’s bargain.', stakes: 'Witnesses disappear.',
                    grimPortents: ['A witness recants.', 'Records burn.', 'A hunter arrives.'], clock: 0, maxClock: 6, stage: 0, status: 'active',
                    faction: { name: 'The Alderman’s Agents', goal: 'Bury the bargain.', stance: 'Wary' },
                }],
                counts: { facts: 12, journalEntries: 4 },
            },
        };

        const upgraded = gameReducer(state, action);
        expect(upgraded.character).toBe(vesa);
        expect(upgraded.inventory).toBe(inventory);
        expect(upgraded.quests).toBe(quests);
        expect(upgraded.fronts[0]).toMatchObject({
            id: existingFront.id, clock: 2, stage: 1, publicHints: existingFront.publicHints,
            notes: existingFront.notes, faction: { name: 'Kraul’s Remnants' },
        });
        expect(upgraded.fronts[1]).toMatchObject({ id: 'front-upgrade-2', clock: 0 });
        expect(upgraded.session.frontDirector).toMatchObject({
            version: 2, generationVersion: 2, source: 'existing-campaign-upgrade', lastJournalEnd: 20,
        });
        expect(gameReducer(upgraded, action)).toBe(upgraded);
    });
});

describe('front resolution (DECISIONS.md 2026-08-03)', () => {
    const resolvableState = () => ({
        ...initialGameState,
        session: { id: 'campaign' },
        messages: [
            { role: 'assistant', content: 'The matriarch falls.' },
            { role: 'user', content: 'We burn the brood.' },
        ],
        fronts: [
            {
                id: 'front-brood', title: 'The Mill Brood', goal: 'Claim the valley.', stakes: 'The valley starves.',
                grimPortents: ['Raids begin.', 'The mill falls.', 'The valley empties.'],
                clock: 5, maxClock: 6, stage: 2, status: 'active', publicHints: [],
                faction: { name: 'The Brood', goal: 'Feed.', stance: 'Hostile', relationships: [] },
            },
            {
                id: 'front-guild', title: 'The Salt Guild', goal: 'Corner the trade.', stakes: 'Prices strangle the town.',
                grimPortents: ['One.', 'Two.', 'Three.'],
                clock: 1, maxClock: 6, stage: 0, status: 'active', publicHints: [],
            },
        ],
        locations: [
            { name: 'The Old Mill', theaterFrontIds: ['front-brood'] },
            { name: 'Saltmarket', theaterFrontIds: ['front-guild', 'front-brood'] },
        ],
        worldTempo: { directive: { frontId: 'front-brood', maxIntensity: 'confrontation', grantedAtMessage: 0, activatesAtMessage: 0, expiresAtMessage: 99 }, lastCadenceId: 'cad-1' },
    });

    const resolveAction = {
        type: 'UPDATE_FRONT',
        payload: { id: 'front-brood', status: 'resolved', notes: 'The hero slew the matriarch and burned the brood.' },
    };

    it('canonizes the victory: world fact, payoff system line, resolution record, aftermath flag', () => {
        const next = gameReducer(resolvableState(), resolveAction);
        expect(next.fronts[0]).toMatchObject({ id: 'front-brood', status: 'resolved', resolvedAtMessage: 2 });
        expect(next.fronts[0].resolution).toContain('slew the matriarch');
        expect(next.worldFacts.some(f => f.fact.includes('"The Mill Brood"') && f.fact.includes('ended'))).toBe(true);
        const lastMessage = next.messages[next.messages.length - 1];
        expect(lastMessage.role).toBe('system');
        expect(lastMessage.content).toContain('The Mill Brood');
        expect(next.session.pendingFrontAftermath).toMatchObject({ frontId: 'front-brood', title: 'The Mill Brood' });
    });

    it('retires the resolved front from theaters and cancels its granted tempo window', () => {
        const next = gameReducer(resolvableState(), resolveAction);
        expect(next.locations.find(l => l.name === 'The Old Mill').theaterFrontIds).toEqual([]);
        expect(next.locations.find(l => l.name === 'Saltmarket').theaterFrontIds).toEqual(['front-guild']);
        expect(next.worldTempo.directive).toBeNull();
    });

    it('is one-shot: re-emitting resolved fires no second fact, line, or aftermath flag', () => {
        const resolved = gameReducer(resolvableState(), resolveAction);
        const cleared = { ...resolved, session: { ...resolved.session, pendingFrontAftermath: null } };
        const again = gameReducer(cleared, resolveAction);
        expect(again.worldFacts).toHaveLength(resolved.worldFacts.length);
        expect(again.messages).toHaveLength(resolved.messages.length);
        expect(again.session.pendingFrontAftermath).toBeNull();
    });

    it('keeps the resolution record through normalizeFront on save reload paths', () => {
        const resolved = gameReducer(resolvableState(), resolveAction);
        const roundTripped = JSON.parse(JSON.stringify(resolved.fronts[0]));
        expect(normalizeFront(roundTripped)).toMatchObject({
            status: 'resolved',
            resolvedAtMessage: 2,
            resolution: expect.stringContaining('matriarch'),
        });
    });
});

describe('aftermath front install', () => {
    const pendingState = () => ({
        ...initialGameState,
        session: { id: 'campaign', pendingFrontAftermath: { frontId: 'front-brood', title: 'The Mill Brood', resolvedAt: 1 } },
        fronts: [
            { id: 'front-brood', title: 'The Mill Brood', goal: 'Claim.', stakes: 'Loss.', grimPortents: ['A.', 'B.', 'C.'], clock: 6, maxClock: 6, stage: 3, status: 'resolved', publicHints: [] },
            { id: 'front-guild', title: 'The Salt Guild', goal: 'Corner.', stakes: 'Squeeze.', grimPortents: ['A.', 'B.', 'C.'], clock: 1, maxClock: 6, stage: 0, status: 'active', publicHints: [] },
        ],
    });
    const proposal = (title, factionName) => ({
        title,
        goal: 'Claim the vacuum the brood left.',
        stakes: 'The valley trades one master for another.',
        grimPortents: ['Scouts arrive.', 'A tithe is demanded.', 'A holdout burns.'],
        faction: { name: factionName, goal: 'Rule the valley.', stance: 'Indifferent to the hero' },
        reason: 'Power vacuum after the brood fell.',
    });

    it('installs validated successors at clock 0, clears the pending flag, and stays within the 3-active cap', () => {
        const next = gameReducer(pendingState(), {
            type: 'INSTALL_AFTERMATH_FRONTS',
            payload: {
                sessionId: 'campaign',
                frontId: 'front-brood',
                fronts: [proposal('The Reeve of Ashes', 'The Gray Reeve'), proposal('The Second Claim', 'Claimant Band'), proposal('The Third Claim', 'Third Band')],
            },
        });
        expect(next.session.pendingFrontAftermath).toBeNull();
        const added = next.fronts.filter(f => f.id.startsWith('front-aftermath-'));
        expect(added).toHaveLength(2); // room = min(2, 3 - 1 active)
        expect(added[0]).toMatchObject({ title: 'The Reeve of Ashes', clock: 0, stage: 0, status: 'active' });
    });

    it('accepts an empty aftermath (a clean victory) and still clears the pending flag', () => {
        const next = gameReducer(pendingState(), {
            type: 'INSTALL_AFTERMATH_FRONTS',
            payload: { sessionId: 'campaign', frontId: 'front-brood', fronts: [] },
        });
        expect(next.session.pendingFrontAftermath).toBeNull();
        expect(next.fronts).toHaveLength(2);
    });

    it('drops cross-session, wrong-front, duplicate-flavor, and post-clear results', () => {
        const state = pendingState();
        expect(gameReducer(state, {
            type: 'INSTALL_AFTERMATH_FRONTS',
            payload: { sessionId: 'other', frontId: 'front-brood', fronts: [proposal('New', 'Faction')] },
        })).toBe(state);
        expect(gameReducer(state, {
            type: 'INSTALL_AFTERMATH_FRONTS',
            payload: { sessionId: 'campaign', frontId: 'front-guild', fronts: [proposal('New', 'Faction')] },
        })).toBe(state);

        // A successor duplicating a live faction/title is rejected by validation.
        const duped = gameReducer(state, {
            type: 'INSTALL_AFTERMATH_FRONTS',
            payload: { sessionId: 'campaign', frontId: 'front-brood', fronts: [proposal('The Salt Guild', 'Anyone')] },
        });
        expect(duped.fronts).toHaveLength(2);
        expect(duped.session.pendingFrontAftermath).toBeNull();

        // Once cleared, a late duplicate result is a no-op.
        expect(gameReducer(duped, {
            type: 'INSTALL_AFTERMATH_FRONTS',
            payload: { sessionId: 'campaign', frontId: 'front-brood', fronts: [proposal('New', 'Faction')] },
        })).toBe(duped);
    });

    it('installs nothing when the active web is already full', () => {
        const state = pendingState();
        state.fronts = [
            state.fronts[0],
            ...['a', 'b', 'c'].map(key => ({
                id: `front-${key}`, title: `Front ${key}`, goal: 'G.', stakes: 'S.',
                grimPortents: ['A.', 'B.', 'C.'], clock: 1, maxClock: 6, stage: 0, status: 'active', publicHints: [],
            })),
        ];
        const next = gameReducer(state, {
            type: 'INSTALL_AFTERMATH_FRONTS',
            payload: { sessionId: 'campaign', frontId: 'front-brood', fronts: [proposal('The Reeve of Ashes', 'The Gray Reeve')] },
        });
        expect(next.fronts).toHaveLength(4);
        expect(next.session.pendingFrontAftermath).toBeNull();
    });
});
