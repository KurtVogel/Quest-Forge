/**
 * 2026-09-27 quests Lap-3 P2 — the ACTIVE QUESTS block's byte ceiling INCLUDING
 * its overflow tail. The cap on described rows (12) had moved the cost into the
 * tail, which named every omitted quest at 160 chars: 52 active quests measured
 * an 11,958-char block, 6,119 of it the tail, live on every turn.
 */
import { describe, expect, it } from 'vitest';
import { buildSystemPrompt } from './promptBuilder.js';

const prompt = (quests) => buildSystemPrompt({
    character: { name: 'Astra', race: 'human', class: 'fighter', level: 1, currentHP: 12, maxHP: 12, armorClass: 16, abilityScores: { strength: 16, dexterity: 12, constitution: 14, intelligence: 10, wisdom: 10, charisma: 8 }, conditions: [], classResources: {}, hitDice: { remaining: 1, total: 1, die: 10 }, traits: [], features: [] },
    inventory: [], quests, rollHistory: [], preset: 'classicFantasy', ruleset: 'simplified5e', customSystemPrompt: '', journal: [], npcs: [], party: [],
    currentLocation: 'Old road', combat: { active: false }, worldFacts: [], locations: [], fronts: [], storyMemory: [], retrievedMemories: [], premise: '', recentRulings: [], messages: [], messageCount: 0,
});
const block = (text) => {
    const start = text.indexOf('## ACTIVE QUESTS');
    const end = text.indexOf('\n## ', start + 1);
    return text.slice(start, end === -1 ? undefined : end);
};
const maxQuest = (i) => ({ id: `q${i}`, name: `Quest ${i} `.padEnd(160, 'n'), description: 'd'.repeat(800), status: 'active' });

describe('ACTIVE QUESTS — byte ceiling with the tail', () => {
    it('52 max-size active quests render under 7,000 chars; the tail names the newest 8 omitted and counts the rest', () => {
        const text = block(prompt(Array.from({ length: 52 }, (_, i) => maxQuest(i))));
        expect(text.length).toBeLessThan(7000);
        const tail = text.slice(text.indexOf('…plus'));
        expect(tail).toMatch(/^…plus 40 older active quest\(s\), tracked and still open: /);
        // The newest 8 of the 40 omitted (quests 32–39), then the count.
        expect(tail).toContain('Quest 32 ');
        expect(tail).toContain('Quest 39 ');
        expect(tail).not.toContain('Quest 31 ');
        expect(tail).toMatch(/Quest 39 n+, and 32 more(\n|$)/);
        expect(tail.length).toBeLessThan(1500);
        // The described rows are untouched: the newest 12.
        expect(text).toContain('**Quest 51 ');
        expect(text).toContain('**Quest 40 ');
        expect(text).not.toContain('**Quest 39 ');
    });

    it('at most 8 omitted names never appends a count; 9 omitted appends "and 1 more"', () => {
        const twenty = block(prompt(Array.from({ length: 20 }, (_, i) => maxQuest(i))));
        expect(twenty).toContain('…plus 8 older active quest(s)');
        expect(twenty).not.toContain(' more');
        const twentyOne = block(prompt(Array.from({ length: 21 }, (_, i) => maxQuest(i))));
        expect(twentyOne).toContain('…plus 9 older active quest(s)');
        expect(twentyOne).toMatch(/, and 1 more(\n|$)/);
        expect(twentyOne).not.toContain('Quest 0 ');
    });

    it('the ceiling grows with the row count only up to the cap: 500 active quests cost the same block as 52', () => {
        const a = block(prompt(Array.from({ length: 52 }, (_, i) => maxQuest(i)))).length;
        const b = block(prompt(Array.from({ length: 500 }, (_, i) => maxQuest(i)))).length;
        expect(b - a).toBeLessThan(40); // only the digits of the counts and names differ
    });
});
