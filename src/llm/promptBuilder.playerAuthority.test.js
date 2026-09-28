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
        // The Bram clause (2026-09-28): a harmless named addition defaults to
        // played-straight or quietly-absent; doubt of the hero's mind must be
        // EARNED by the fiction and voiced by NPCs, never by the narrator.
        expect(prompt).toContain('HARMLESS ADDITIONS ARE COLOR, NOT CLAIMS');
        expect(prompt).toContain('play it straight — the person or thing is simply there — or to let it be plausibly absent without comment');
        expect(prompt).toContain('Never read an ambiguous harmless addition as evidence that the hero is mad, drunk, dreaming, or seeing things');
        expect(prompt).toContain('only when the fiction has EARNED it');
        expect(prompt).toContain('it is NPCs who doubt, in their own voice; the narrator never diagnoses the hero');
        // The decline examples no longer hand the DM the delusion reading.
        expect(prompt).not.toContain('(the grasp that finds nothing, a dream, an NPC\'s reaction)');
        expect(prompt).toContain('an NPC who does not go along with it');
        // The clause sits INSIDE the block, after the "does not automatically create" rule.
        const block = prompt.slice(prompt.indexOf('## PLAYER AUTHORITY'), prompt.indexOf('## CHECK DISCIPLINE'));
        expect(block.indexOf('does not automatically create external creatures')).toBeLessThan(block.indexOf('HARMLESS ADDITIONS ARE COLOR'));
        expect(block.indexOf('HARMLESS ADDITIONS ARE COLOR')).toBeLessThan(block.indexOf('Treat declared outcomes'));
        expect(prompt).toContain('## NAME DIVERSITY — AVOID LLM FANTASY DEFAULTS');
        expect(prompt).toContain('Elara, Elora, Elyra, Silas, Sylas, Thorne');
        expect(prompt).toContain('Never rename or erase an established name');
        expect(prompt).toContain("Build names from the setting's culture, region, geography, and community");
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
        expect(prompt).toContain('One roll settles the entire immediate approach');
        expect(prompt).toContain('do not demand another check for the same objective');
        expect(prompt).toContain('Apply one proportionate consequence, then give the player a meaningful new choice');
        expect(prompt).toContain('PUBLIC TABLE RULING, not private chain-of-thought');
        expect(prompt).toContain('reason, opposition, failure_stakes, and difficulty_reason');
        expect(prompt).toContain('player may challenge one proposed ruling before dice');
        expect(prompt).toContain('Roll, Challenge once, or Change approach');
    });
});
