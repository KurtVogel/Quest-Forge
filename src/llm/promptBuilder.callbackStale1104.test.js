/**
 * Memory-research M0 (2026-11-04, D3 / D1): a callback premised on a
 * since-flipped fact says so. The judge the RETRIEVED MEMORIES rows have used
 * since 2026-10-30 (`listStaleFacts` + `describeStaleTwin`, now on
 * engine/worldFacts.js) reaches its second reader — the DRAMATIC CALLBACKS
 * line — and a card's own `story_*` RAG row joins the taggable categories.
 * Nothing about the card changes: the line is SHOWN the live twin before its age.
 */
import { describe, expect, it } from 'vitest';
import { buildStoryMemoryPromptBlock } from '../engine/storyMemory.js';
import { describeStaleTwin, listStaleFacts, STALE_ROW_CONTAINMENT } from '../engine/worldFacts.js';
import { buildRetrievedMemoriesBlock, STALE_ROW_CONTAINMENT as RE_EXPORTED } from './promptBuilder.js';

const facts = [
    { id: 'f1', fact: 'The bridge at Ashford is passable.', atMessage: 4, supersededBy: 'f2', supersededAtMessage: 30 },
    { id: 'f2', fact: 'The bridge at Ashford is not passable.', atMessage: 30, supersedes: 'f1' },
    { id: 'f3', fact: 'Orsa keeps the countinghouse.', atMessage: 6 },
    { id: 'r1', fact: 'Tammo owes the hero a ferry crossing.', atMessage: 8, supersededBy: 'r2', supersededAtMessage: 40, retractedAtMessage: 41 },
    { id: 'r2', fact: 'Tammo owes the hero nothing.', atMessage: 40, supersedes: 'r1' },
];
const staleFacts = listStaleFacts(facts);
const judge = text => describeStaleTwin(text, staleFacts);
const tag = ' — since changed: "The bridge at Ashford is not passable."';

const card = (text, extra = {}) => ({ id: `card-${text.length}`, type: 'promise', salience: 4, text, ageTurns: 12, speakers: ['Tammo'], ...extra });

describe('a DRAMATIC CALLBACK premised on a since-flipped fact says so (2026-11-04 M0)', () => {
    it('a card restating the old truth gets the tag before its age; one already on the new side, one unrelated, and a card with no judge do not', () => {
        const block = buildStoryMemoryPromptBlock([
            card('Tammo promised to ferry the hero once the bridge at Ashford is passable again.'),
            card('Tammo swore the bridge at Ashford is not passable and never will be.'),
            card('Orsa keeps the countinghouse and owes the hero a favor.'),
        ], { staleTwinFor: judge });
        const lines = block.split('\n').filter(line => line.startsWith('- '));
        expect(lines[0]).toContain(`passable again.${tag} — 12 turns ago · could say it: Tammo`);
        expect(lines[1]).not.toContain('since changed');
        expect(lines[2]).not.toContain('since changed');
        expect(block.split('since changed').length - 1).toBe(1);

        const bare = buildStoryMemoryPromptBlock([card('Tammo promised to ferry the hero once the bridge at Ashford is passable again.')]);
        expect(bare).not.toContain('since changed');
        expect(bare).toContain('passable again. — 12 turns ago');
    });

    it('a retracted twin never tags, and the judge is one copy — the builder re-exports the engine constant', () => {
        expect(judge('Tammo owes the hero a ferry crossing, he said twice.')).toBe('');
        expect(RE_EXPORTED).toBe(STALE_ROW_CONTAINMENT);
        expect(STALE_ROW_CONTAINMENT).toBe(0.8);
    });

    it('a story card\'s own RAG row (`story_*`) is taggable; a player row and the world_fact row stay untouched', () => {
        const rows = [
            { text: 'Tammo promised to ferry the hero once the bridge at Ashford is passable again.', category: 'story_promise' },
            { text: 'The bridge at Ashford is passable, I insist.', category: 'player' },
            { text: 'The bridge at Ashford is passable.', category: 'world_fact' },
        ];
        const block = buildRetrievedMemoriesBlock(rows, { worldFacts: facts });
        const lines = block.split('\n').filter(line => line.startsWith('- ['));
        expect(lines[0]).toContain(tag);
        expect(lines[1]).not.toContain('since changed');
        expect(lines[2]).not.toContain('since changed');
    });
});
