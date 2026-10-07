import { describe, expect, it } from 'vitest';
import { classifyFactCandidate, describeSupersededTag, hasNegation, isLiveFact, liveWorldFacts } from './worldFacts.js';
import { buildSystemPrompt } from '../llm/promptBuilder.js';

const fact = (id, text, extra = {}) => ({ id, fact: text, category: 'general', knownBy: [], timestamp: 1, ...extra });

describe('hasNegation — the polarity the stop words erase', () => {
    it('reads not / no / never / none / nobody / cannot / without and n\'t contractions', () => {
        for (const text of ['The bridge is not passable.', 'No boat has reached the keeper.', 'Orsa never forgives a debt.', 'The keeper isn\'t coming back.', 'The pass cannot be crossed in winter.', 'Nobody lives at the mill now.']) {
            expect(hasNegation(text), text).toBe(true);
        }
        for (const text of ['The bridge is passable.', 'A boat reached the keeper.', 'The knot is called a bowline.', '']) {
            expect(hasNegation(text), text).toBe(false);
        }
    });
});

describe('classifyFactCandidate', () => {
    const live = [fact('f1', 'The bridge at Ashford is passable.'), fact('f2', 'Odo Ferrin is dead, killed at the docks during the smuggler raid.')];

    it('a genuinely new fact is new', () => {
        expect(classifyFactCandidate('Serah now leads the dockworkers.', live).kind).toBe('new');
    });
    it('a same-polarity restatement is a duplicate of its twin', () => {
        const verdict = classifyFactCandidate('Odo Ferrin was killed at the docks.', live);
        expect(verdict).toMatchObject({ kind: 'duplicate', of: { id: 'f2' } });
    });
    it('a near-duplicate whose negation differs is a FLIP of its twin (the case the dedupe used to DROP)', () => {
        const verdict = classifyFactCandidate('The bridge at Ashford is not passable.', live);
        expect(verdict).toMatchObject({ kind: 'flip', of: { id: 'f1' } });
        // And back again, judged against a negated live twin.
        const back = classifyFactCandidate('The bridge at Ashford is passable.', [fact('f3', 'The bridge at Ashford is NOT passable.')]);
        expect(back).toMatchObject({ kind: 'flip', of: { id: 'f3' } });
    });
    it('an empty candidate is a duplicate of nothing (rejected), and a semantic contradiction without a negation stands as its own fact', () => {
        expect(classifyFactCandidate('   ', live).kind).toBe('duplicate');
        expect(classifyFactCandidate('The bridge at Ashford has burned down.', live).kind).toBe('new');
    });
    it('reuses caller token sets when given', () => {
        const sets = live.map(() => new Set(['unrelated']));
        expect(classifyFactCandidate('The bridge at Ashford is not passable.', live, sets).kind).toBe('new');
    });
});

describe('liveWorldFacts / isLiveFact', () => {
    it('drops superseded rows and junk, keeps live records', () => {
        const list = [fact('a', 'A.'), fact('b', 'B.', { supersededBy: 'c' }), null, 'junk', { id: 'x' }, fact('c', 'Not B.', { supersedes: 'b' })];
        expect(liveWorldFacts(list).map(f => f.id)).toEqual(['a', 'c']);
        expect(isLiveFact(list[1])).toBe(false);
        expect(isLiveFact(list[5])).toBe(true);
    });
});

describe('describeSupersededTag', () => {
    it('is empty for a live fact and a history tag for a superseded one, in turns', () => {
        expect(describeSupersededTag(fact('a', 'A.'))).toBe('');
        const messages = Array.from({ length: 30 }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', content: 'x' }));
        expect(describeSupersededTag(fact('b', 'B.', { supersededBy: 'c', supersededAtMessage: 10 }), { messages, messageCount: 30 })).toMatch(/^\[NO LONGER TRUE — changed 10 turns ago\] $/);
        expect(describeSupersededTag(fact('b', 'B.', { supersededBy: 'c' }))).toBe('[NO LONGER TRUE] ');
    });
});

describe('the DM prompt carries only the present', () => {
    it('WORLD FACTS lists live facts and omits a superseded one', () => {
        const prompt = buildSystemPrompt({
            character: null, inventory: [], quests: [], rollHistory: [], preset: 'classicFantasy', ruleset: 'simplified5e',
            customSystemPrompt: '', journal: [], npcs: [], party: [], currentLocation: 'Ashford', combat: null,
            worldFacts: [
                fact('f1', 'The bridge at Ashford is passable.', { supersededBy: 'f2', supersededAtMessage: 4 }),
                fact('f2', 'The bridge at Ashford is not passable.', { supersedes: 'f1' }),
            ],
            fronts: [], storyMemory: [], retrievedMemories: [], premise: '',
        });
        expect(prompt).toContain('The bridge at Ashford is not passable.');
        expect(prompt).not.toContain('- The bridge at Ashford is passable.');
    });

    it('WORLD FACTS renders a plan as planned with its age under a header that says a plan is not a deed, and omits a closed plan (2026-10-07)', () => {
        const prompt = buildSystemPrompt({
            character: null, inventory: [], quests: [], rollHistory: [], preset: 'classicFantasy', ruleset: 'simplified5e',
            customSystemPrompt: '', journal: [], npcs: [], party: [], currentLocation: 'Ashford', combat: null,
            worldFacts: [
                fact('p1', 'The Guild means to seize the Ashford mill at the new moon.', { aspect: 'intent', atMessage: 0 }),
                fact('p2', 'Tammo promised to return the knife.', { aspect: 'intent', atMessage: 0, supersededBy: 'd2', supersededAtMessage: 0 }),
                fact('d2', 'Tammo returned the knife.', { supersedes: 'p2' }),
            ],
            fronts: [], storyMemory: [], retrievedMemories: [], premise: '',
        });
        expect(prompt).toContain('- planned (as of this turn): The Guild means to seize the Ashford mill at the new moon.');
        expect(prompt).toContain('a line opening "planned (as of N turns ago)" is an INTENT');
        expect(prompt).toContain('- Tammo returned the knife.');
        expect(prompt).not.toContain('Tammo promised to return the knife.');
    });
});
