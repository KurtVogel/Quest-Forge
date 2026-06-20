import { describe, expect, it } from 'vitest';
import { buildSystemPrompt } from './promptBuilder.js';

describe('player narrative authority guidance', () => {
    it('welcomes emergent absurdity without allowing unsupported escape hatches', () => {
        const prompt = buildSystemPrompt({
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
            currentLocation: 'Goblin Camp',
            combat: null,
            worldFacts: [],
            fronts: [],
            storyMemory: [],
            retrievedMemories: [],
            premise: '',
        });

        expect(prompt).toContain('## PLAYER AUTHORITY — CREATIVE INTENT, NOT AUTOMATIC REALITY');
        expect(prompt).toContain('Let the campaign become absurd when choices and established fiction genuinely lead there');
        expect(prompt).toContain('does not automatically create external creatures, objects, exits');
        expect(prompt).toContain('treat it as a wish, joke, or attempted idea — not established reality');
        expect(prompt).toContain('without scolding the player');
    });
});
