import { describe, expect, it } from 'vitest';
import { gameReducer, initialGameState } from './gameReducer.js';
import { createInitialFronts } from '../engine/fronts.js';

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

    it('installs contextual fronts once without changing established campaign state', () => {
        const inventory = [{ name: 'Longsword', equipped: true }];
        const state = {
            ...initialGameState,
            character,
            inventory,
            session: { id: 'old-campaign', premise: 'An old campaign.' },
            messages: [{ role: 'assistant', content: 'Established history.' }],
            fronts: [{
                id: 'front-local-pressure',
                title: 'Existing Pressure',
                goal: 'Preserve me.',
                stakes: 'Existing stakes.',
                grimPortents: ['One', 'Two', 'Three'],
                clock: 1,
                stage: 1,
            }],
        };
        const migrated = gameReducer(state, {
            type: 'MIGRATE_FRONTS',
            payload: {
                fronts: [{
                    id: 'front-migrated-1',
                    title: 'Consequences Gather',
                    goal: 'A surviving faction seeks leverage.',
                    stakes: 'Old allies come under pressure.',
                    grimPortents: ['A rumor spreads.', 'An ally is watched.', 'The faction acts openly.'],
                }],
                counts: { facts: 4, npcs: 2 },
            },
        });

        expect(migrated.fronts).toHaveLength(2);
        expect(migrated.fronts[0]).toBe(state.fronts[0]);
        expect(migrated.character).toBe(character);
        expect(migrated.inventory).toBe(inventory);
        expect(migrated.session.frontMigration).toMatchObject({ version: 1, contextCounts: { facts: 4, npcs: 2 } });
        expect(migrated.messages.at(-1).content).toContain('living world awakens');
        expect(migrated.messages.at(-1).content).not.toContain('Consequences Gather');

        const repeated = gameReducer(migrated, {
            type: 'MIGRATE_FRONTS',
            payload: { fronts: [{ id: 'replacement', title: 'Replacement' }] },
        });
        expect(repeated).toBe(migrated);
    });

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
