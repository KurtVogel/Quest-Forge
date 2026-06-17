import { describe, expect, it } from 'vitest';
import { buildSystemPrompt } from './promptBuilder.js';

function basePrompt(overrides = {}) {
    return buildSystemPrompt({
        character: null,
        inventory: [],
        quests: [],
        rollHistory: [],
        preset: 'classicFantasy',
        ruleset: 'simplified5e',
        customSystemPrompt: '',
        journal: [],
        npcs: [],
        party: [],
        currentLocation: 'Millhaven',
        combat: null,
        worldFacts: [],
        fronts: [],
        storyMemory: [],
        retrievedMemories: [],
        premise: '',
        ...overrides,
    });
}

describe('story memory prompt block', () => {
    it('injects dramatic callback opportunities with strict usage guidance', () => {
        const prompt = basePrompt({
            storyMemory: [{
                id: 'mem-ribbon',
                type: 'promise',
                text: 'Mira promised to leave a blue ribbon if the well road became unsafe.',
                subject: 'Mira ribbon',
                tags: ['promise'],
                salience: 4,
                emotionalCharge: 4,
                status: 'active',
                linkedNpcNames: ['Mira'],
                location: 'Millhaven',
            }],
        });

        expect(prompt).toContain('## DRAMATIC CALLBACK OPPORTUNITIES');
        expect(prompt).toContain('Use at most ONE naturally');
        expect(prompt).toContain('Mira promised to leave a blue ribbon');
        expect(prompt).toContain('memory_updates');
        expect(prompt).toContain('narrative-only bookkeeping');
    });

    it('omits the block when no curated memories are supplied', () => {
        const prompt = basePrompt();
        expect(prompt).not.toContain('## DRAMATIC CALLBACK OPPORTUNITIES');
    });
});

