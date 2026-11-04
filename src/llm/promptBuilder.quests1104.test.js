/** WOW 2026-11-04: the ACTIVE QUESTS line says for whom and for what; LEVELING asks for a beat. */
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

describe('ACTIVE QUESTS — the sworn record on the line', () => {
    it('renders patron and promise before the newest stage, clamped; a bare quest keeps the old shape', () => {
        const text = block(prompt([
            { id: 'q1', name: 'The Manifest', description: 'The weir is guarded.', status: 'active', patron: 'Hesper Vane', promised: 'p'.repeat(200) },
            { id: 'q2', name: 'Plain Errand', description: 'Go.', status: 'active' },
            { id: 'q3', name: 'Own Pursuit', description: 'Find the missing family.', status: 'active', promised: 'nothing but answers' },
        ]));
        expect(text).toContain(`- **The Manifest** [id: q1] — for Hesper Vane · promised: ${'p'.repeat(120)}. Now: The weir is guarded.`);
        expect(text).toContain('- **Plain Errand** [id: q2]: Go.');
        expect(text).toContain('- **Own Pursuit** [id: q3] — promised: nothing but answers. Now: Find the missing family.');
    });

    it('twelve max-size rows with patron and promise stay under 10,000 chars', () => {
        const rows = Array.from({ length: 12 }, (_, i) => ({
            id: `q${i}`, name: `Quest ${i} `.padEnd(160, 'n'), description: 'd'.repeat(800), status: 'active',
            patron: 'P'.repeat(80), promised: 'x'.repeat(120),
        }));
        expect(block(prompt(rows)).length).toBeLessThan(10000);
    });

    it('QUEST TRACKING asks for patron, promised and outcome; LEVELING asks for one sentence of fiction after a Level Up row', () => {
        const text = prompt([]);
        expect(text).toContain('`patron` (who asked, by their full known name');
        expect(text).toContain('`promised` (the fee or stake agreed');
        expect(text).toContain('with `outcome`: one line of how it ended');
        expect(text).toContain('A **Level Up!** system line in the conversation is a beat');
        expect(text).toContain('"patron": "who asked');
    });
});
