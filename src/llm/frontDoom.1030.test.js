/**
 * The doom director's pure shaping (2026-10-29 audit P2, test depth: the
 * module was 46 % covered). `sanitizeFrontDoom` is light shaping ahead of
 * INSTALL_DOOM_AFTERMATH's re-validation: the `npc` / `name` alias, the
 * roster pre-filter, the caps, and the successor walk through the engine's
 * ONE proposal boundary — complete-or-nothing.
 */
import { describe, expect, it } from 'vitest';
import { sanitizeFrontDoom, shouldGenerateFrontDoom } from './frontDoom.js';
import { MAX_DOOM_DEVELOPMENTS, MAX_DOOM_PLACES } from '../engine/worldTempo.js';

const npcs = [{ name: 'Tammo Reik' }, { name: 'Saima Aallotar' }, { name: 'Orrin' }, { name: 'Bess' }];

const successor = (title, factionName = `${title} faction`) => ({
    title,
    goal: 'Hold the river tolls',
    stakes: 'The valley pays twice for bread',
    grimPortents: ['A new toll house', 'A hanged smuggler', 'The ferry burns'],
    faction: { name: factionName, goal: 'Tax the river', stance: 'Watchful', relationships: ['Owes the guild'] },
    reason: 'Born of the win',
});

describe('sanitizeFrontDoom: developments', () => {
    it('reads `npc` or `name`, and drops a person the roster does not hold', () => {
        const out = sanitizeFrontDoom({
            world_change: {
                fact: 'The Grey Choir holds the mill.',
                developments: [
                    { npc: 'Tammo Reik', agenda: 'Keep his head down' },
                    { name: 'Saima', lastNotes: 'Sells to the Choir now' },
                    { npc: 'Nobody Known', agenda: 'Plots', lastNotes: 'Lurks' },
                ],
            },
        }, { npcs });
        expect(out.developments.map(dev => dev.name)).toEqual(['Tammo Reik', 'Saima']);
        expect(out.developments[0]).toMatchObject({ agenda: 'Keep his head down', lastNotes: '' });
        expect(out.developments[1]).toMatchObject({ agenda: '', lastNotes: 'Sells to the Choir now' });
        expect(out.fact).toBe('The Grey Choir holds the mill.');
    });

    it('a development with neither agenda nor lastNotes is nothing; `last_notes` and `world_fact` are read as aliases', () => {
        const out = sanitizeFrontDoom({
            world_change: {
                world_fact: 'The tolls stand.',
                developments: [
                    { npc: 'Tammo Reik' },
                    { npc: 'Orrin', last_notes: 'Collects the toll' },
                ],
            },
        }, { npcs });
        expect(out.developments).toEqual([{ name: 'Orrin', agenda: '', lastNotes: 'Collects the toll' }]);
        expect(out.fact).toBe('The tolls stand.');
    });

    it(`caps developments at MAX_DOOM_DEVELOPMENTS (${MAX_DOOM_DEVELOPMENTS}) after the roster filter`, () => {
        const out = sanitizeFrontDoom({
            world_change: {
                developments: [
                    { npc: 'Ghost', agenda: 'x' },
                    { npc: 'Tammo Reik', agenda: 'a' },
                    { npc: 'Saima Aallotar', agenda: 'b' },
                    { npc: 'Orrin', agenda: 'c' },
                    { npc: 'Bess', agenda: 'd' },
                ],
            },
        }, { npcs });
        expect(out.developments).toHaveLength(MAX_DOOM_DEVELOPMENTS);
        expect(out.developments.map(dev => dev.name)).toEqual(['Tammo Reik', 'Saima Aallotar', 'Orrin']);
    });
});

describe('sanitizeFrontDoom: places', () => {
    it(`needs a name AND a state, reads last_state, caps at MAX_DOOM_PLACES (${MAX_DOOM_PLACES})`, () => {
        const out = sanitizeFrontDoom({
            world_change: {
                places: [
                    { name: 'The mill' },
                    { name: 'The ferry', last_state: 'Burned to the waterline' },
                    { name: 'The square', lastState: 'A toll house stands at its mouth' },
                    { name: 'The chapel', lastState: 'Shuttered' },
                ],
            },
        });
        expect(out.places).toEqual([
            { name: 'The ferry', lastState: 'Burned to the waterline' },
            { name: 'The square', lastState: 'A toll house stands at its mouth' },
        ]);
    });
});

describe('sanitizeFrontDoom: successors are complete-or-nothing through normalizeFrontProposal', () => {
    it('a proposal missing a required field installs nothing; a complete one is a born front at clock 0', () => {
        const out = sanitizeFrontDoom({
            successor_fronts: [
                { title: 'Half a pressure', goal: 'g', stakes: 's', grimPortents: ['one', 'two'] },
                successor('The Toll Reeve'),
            ],
        });
        expect(out.successors).toHaveLength(1);
        expect(out.successors[0]).toMatchObject({ title: 'The Toll Reeve', clock: 0, stage: 0, status: 'active', notes: 'Born of the win' });
        expect(out.successors[0].faction).toMatchObject({ name: 'The Toll Reeve faction', goal: 'Tax the river' });
    });

    it('at most two successors, and a second with the same faction as the first is dropped (one web, one faction)', () => {
        const out = sanitizeFrontDoom({
            successor_fronts: [successor('A'), successor('B', 'A faction'), successor('C')],
        });
        expect(out.successors.map(front => front.title)).toEqual(['A']);
        const two = sanitizeFrontDoom({ successor_fronts: [successor('A'), successor('B'), successor('C')] });
        expect(two.successors.map(front => front.title)).toEqual(['A', 'B']);
    });

    it('junk in, empty landing out — never a throw', () => {
        for (const junk of [null, undefined, 'text', 42, [], { world_change: 'x', successor_fronts: 'y' }]) {
            expect(sanitizeFrontDoom(junk, { npcs })).toEqual({ fact: '', developments: [], places: [], successors: [] });
        }
    });
});

describe('shouldGenerateFrontDoom', () => {
    it('fires only on a typed pending marker with a prevailed front still on record', () => {
        const front = { id: 'front-a', title: 'The Grey Choir', status: 'resolved', outcome: 'prevailed' };
        const settings = { llmProvider: 'gemini', apiKey: 'test-key' };
        const base = { session: { id: 's1', pendingFrontDoom: { frontId: 'front-a', title: 'The Grey Choir' } }, fronts: [front], combat: { active: false }, settings };
        expect(shouldGenerateFrontDoom(base)).toBe(true);
        expect(shouldGenerateFrontDoom({ ...base, session: { id: 's1' } })).toBe(false);
        expect(shouldGenerateFrontDoom({ ...base, combat: { active: true } })).toBe(false);
        expect(shouldGenerateFrontDoom({ ...base, settings: {} })).toBe(false);
    });
});
