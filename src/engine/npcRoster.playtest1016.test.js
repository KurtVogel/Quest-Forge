/**
 * Playtest findings closed 2026-10-16: a role noun PLACED is a description,
 * not a person (grand playtest 2026-10-03 Sol: "Serving woman on Market
 * Street" minted a roster record), the downed-hero COMBAT NOTES bullet, and
 * the Scribe's hero-tells rule names the motive trap.
 */
import { describe, expect, it } from 'vitest';
import { isDescriptiveLabel, classifyNpcCandidate } from './npcRoster.js';
import { buildSystemPromptParts } from '../llm/promptBuilder.js';
import { SCRIBE_SYSTEM_PROMPT } from '../llm/scribe.js';
import { createCharacter } from './characterUtils.js';

describe('a role noun placed is a description', () => {
    it('generic head noun + locative preposition → description; a NAME before the preposition stays a name', () => {
        for (const label of ['Serving woman on Market Street', 'Guard at the gate', 'Man in the grey cloak', 'Boy by the well', 'Innkeeper near the ford']) {
            expect(isDescriptiveLabel(label), label).toBe(true);
        }
        for (const label of ['Marta from Aldermill', 'Old Hesk of the Mill', 'Tammo at the Gilded Eel', 'Saima Aallotar', 'The Lady']) {
            expect(isDescriptiveLabel(label), label).toBe(false);
        }
    });

    it('classifyNpcCandidate never mints a record for the placed role noun', () => {
        const classified = classifyNpcCandidate({ name: 'Serving woman on Market Street', kind: 'character', rosterEligible: true });
        expect(classified?.tier ?? classified?.rosterTier ?? null).not.toBe('character');
    });
});

describe('the downed hero is not a pause button (one COMBAT NOTES bullet, prefix)', () => {
    it('the bullet sits in the cached prefix and names the two engine-true exits', () => {
        const character = createCharacter('Testa', 'human', 'fighter', { strength: 15, dexterity: 13, constitution: 14, intelligence: 10, wisdom: 12, charisma: 8 }, ['athletics']);
        const parts = buildSystemPromptParts({ character, inventory: [], quests: [], rollHistory: [], preset: 'classicFantasy', ruleset: 'simplified5e', journal: [], npcs: [], party: [], currentLocation: '', combat: { active: false }, worldFacts: [], fronts: [], storyMemory: [], retrievedMemories: [], messages: [], messageCount: 0 });
        const text = parts.map(p => p.text).join('\n\n');
        expect(text).toContain('A downed hero is not a pause button.');
        expect(text).toContain('a foe standing idle over a body is the one wrong answer');
        const bulletPart = parts.find(p => p.text.includes('A downed hero is not a pause button.'));
        const prefixEnd = parts.findIndex(p => p.name === 'heroSheet');
        expect(parts.indexOf(bulletPart)).toBeLessThan(prefixEnd);
    });
});

describe('the Scribe\'s hero-tells rule names the motive trap', () => {
    it('a feeling is never the trigger', () => {
        expect(SCRIBE_SYSTEM_PROMPT).toContain('a feeling or a reason is never the trigger');
        expect(SCRIBE_SYSTEM_PROMPT).toContain('"when anxious"');
    });
});
