/**
 * Strengthening 2026-11-10 (hidden-fronts, Lap 3) — a fight is not paced.
 * While combat is active the tempo block is the ids (a blow may end a
 * pressure) and the echoes (a victory or a doom is narration): no pace line,
 * no QUIET rule, no variety lines, no companion offer.
 */
import { describe, expect, it } from 'vitest';
import { buildWorldTempoBlock } from './worldTempo.js';

const front = (overrides = {}) => ({
    id: 'front-v2-1',
    title: 'The River Blockade',
    goal: 'Starve the town',
    status: 'active',
    clock: 2,
    maxClock: 6,
    stage: 0,
    faction: { name: 'Mud-Dredge Gang', goal: 'Extort river trade' },
    ...overrides,
});
const hot = { level: 'high', reasons: ['a fight is under way', 'the hero is bloodied'] };
const encounters = [
    { enemies: '2× ghoul', foeFamilies: ['ghoul'], messageIndex: 1, outcome: 'victory' },
    { enemies: 'ghoul', foeFamilies: ['ghoul'], messageIndex: 3, outcome: 'victory' },
];
const worldMotifs = { ghoul: { count: 3, lastMessage: 5 }, 'pine woods': { count: 4, lastMessage: 9 } };
const scene = (overrides = {}) => ({
    fronts: [front(), front({ id: 'front-v2-2', faction: { name: 'The Ash Choir', goal: 'Wake the kiln' } })],
    worldTempo: null,
    paceDial: 'standard',
    heat: hot,
    recentEncounters: encounters,
    messageCount: 10,
    solo: true,
    worldMotifs,
    ...overrides,
});

describe('the tempo block in combat', () => {
    it('renders the ids and nothing a narration of blows cannot follow', () => {
        const block = buildWorldTempoBlock(scene({ combatActive: true }));
        expect(block).toContain('## WORLD TEMPO');
        expect(block).toContain('front-v2-1 (Mud-Dredge Gang), front-v2-2 (The Ash Choir)');
        expect(block).toContain('front_updates');
        for (const gone of ['Pace target', 'breathing room', 'QUIET', 'seek danger', 'Recent fights', 'ALREADY SHOWN', 'currently alone', 'bloodied']) {
            expect(block).not.toContain(gone);
        }
        expect(block.split('\n')).toHaveLength(3);
        expect(block.length).toBeLessThan(420);
    });

    it('is less than half the same scene out of combat, which keeps every line', () => {
        const fight = buildWorldTempoBlock(scene({ combatActive: true }));
        const calm = buildWorldTempoBlock(scene());
        for (const kept of ['Pace target', 'breathing room', 'QUIET this scene', 'seek danger', 'Recent fights', 'ALREADY SHOWN', 'currently alone']) {
            expect(calm).toContain(kept);
        }
        expect(fight.length * 2).toBeLessThan(calm.length);
    });

    it('keeps the echo of an ended pressure: a victory is narration', () => {
        const ended = front({ id: 'front-v2-3', status: 'resolved', resolvedAtMessage: 8, resolution: 'The gang broke at the weir.' });
        const block = buildWorldTempoBlock(scene({ fronts: [front(), ended], combatActive: true }));
        expect(block).toContain('RECENT VICTORY: the pressure "The River Blockade" has been ENDED (The gang broke at the weir.)');
        expect(block).toContain('Show its absence concretely');
        expect(block).not.toContain('QUIET');
    });

    it('renders nothing when a fight has no id and no echo to carry', () => {
        expect(buildWorldTempoBlock(scene({ fronts: [], combatActive: true }))).toBe('');
        // Out of combat the variety lines alone still make a block.
        expect(buildWorldTempoBlock(scene({ fronts: [] }))).toContain('Recent fights');
    });
});
