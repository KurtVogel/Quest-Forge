/**
 * WOW 2026-09-27 (combat-drama slice A): the prefix-stable COMBAT NOTES
 * sentence that makes the next `enemy_intents` honor the narration's own
 * telegraph and lets bloodied foes break — in the cached RESPONSE FORMAT for
 * every class, never interpolated.
 */
import { describe, expect, it } from 'vitest';
import { buildSystemPrompt } from './promptBuilder.js';
import { buildSpellSlots } from '../engine/spellcasting.js';

const base = (overrides = {}) => ({
    name: 'Astra', race: 'human', class: 'fighter', level: 1, exp: 0, currentHP: 12, maxHP: 12, armorClass: 16, gold: 0, silver: 0, copper: 0, speed: 30,
    abilityScores: { strength: 16, dexterity: 12, constitution: 14, intelligence: 10, wisdom: 10, charisma: 8 },
    savingThrowProficiencies: [], skillProficiencies: [], conditions: [], classResources: {}, hitDice: { remaining: 1, total: 1, die: 10 }, traits: [], features: [],
    ...overrides,
});
const prompt = (character) => buildSystemPrompt({
    character, inventory: [], quests: [], rollHistory: [], preset: 'classicFantasy', ruleset: 'simplified5e', customSystemPrompt: '', journal: [], npcs: [], party: [],
    currentLocation: 'Old road', combat: { active: false }, worldFacts: [], locations: [], fronts: [], storyMemory: [], retrievedMemories: [], premise: '', recentRulings: [], messages: [], messageCount: 0,
});

describe('COMBAT NOTES — honor your own telegraph, and let foes break', () => {
    it('rides both class-gated response formats, inside the cached prefix, right after the enemy_intents rule', () => {
        for (const character of [base(), base({ class: 'wizard', level: 3, spellSlots: buildSpellSlots(3) })]) {
            const text = prompt(character);
            const notes = text.slice(text.indexOf('COMBAT NOTES — INTENT ONLY'), text.indexOf('PLAYER DEATH & DYING:'));
            expect(notes).toContain('**Honor your own telegraph, and let foes break.**');
            expect(notes).toContain('the foe shown nocking an arrow at Torvald attacks Torvald, the foe shown backing toward the door flees');
            expect(notes).toContain('BREAKS by the round after it was bloodied: `flee`, `surrender`, or one desperate attack before it does');
            expect(notes).toContain('Fanatics, the undead, constructs, and beasts guarding young or a kill are the exceptions');
            expect(notes.indexOf('Honor your own telegraph')).toBeGreaterThan(notes.indexOf('`enemy_intents`: at most one per living foe'));
            // Prefix: the sentence sits before the first dynamic block.
            expect(text.indexOf('Honor your own telegraph')).toBeLessThan(text.indexOf('## PLAYER CHARACTER'));
        }
    });
});
