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
        expect(prompt).toContain('## NPC NAME DIVERSITY — AVOID THE LLM FANTASY DEFAULTS');
        expect(prompt).toContain('Elara, Elora, Elyra, Silas, Sylas, Thorne');
        expect(prompt).toContain('Never rename or erase an established name');
        expect(prompt).toContain("Build names from the person's culture, region, class, age, and community");
        expect(prompt).not.toContain('"Mira the Innkeeper"');
        expect(prompt).not.toContain('"name": "Garrick"');
    });

    it('makes checks exceptional, rewards clever play, and preserves authored delivery', () => {
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
            currentLocation: 'Inquisitor Chapel',
            combat: null,
            worldFacts: [],
            fronts: [],
            storyMemory: [],
            retrievedMemories: [],
            premise: '',
        });

        expect(prompt).toContain('## CHECK DISCIPLINE — FICTION FIRST, DICE SECOND');
        expect(prompt).toContain('Request a check only when ALL THREE are true');
        expect(prompt).toContain('DC 15 only for strong opposition or serious risk');
        expect(prompt).toContain('There is no default DC 15');
        expect(prompt).toContain('automatic success when it removes the obstacle; otherwise advantage OR a lower DC');
        expect(prompt).toContain('the engine rolls two d20s and keeps the higher');
        expect(prompt).toContain('express advantage/disadvantage directly on the requested_rolls entry');
        expect(prompt).toContain('A failed social check controls the NPC\'s external response only');
        expect(prompt).toContain('never invent stammering, trembling, cowardice, or incompetence');
    });
});
