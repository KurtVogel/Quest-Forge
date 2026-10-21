/**
 * Memory-research M1 (2026-10-21): the RETRIEVED MEMORIES block says when —
 * each stamped line ends "— N turns ago" in conversational distance, a
 * stamp-less row prints no age, the header tells the DM an older memory of a
 * passing state may no longer hold, and the ceiling counts the suffix.
 */
import { describe, expect, it } from 'vitest';
import { buildRetrievedMemoriesBlock, RETRIEVED_MEMORIES_CHAR_CEILING, RETRIEVED_MEMORY_ROW_MAX } from './promptBuilder.js';
import { describeTurnsAgo } from '../engine/replayLedger.js';

const turn = (i) => [{ role: 'user', content: `Player line ${i}` }, { role: 'assistant', content: `DM answer ${i}` }];
const messages = [...turn(0), ...turn(1), ...turn(2), { role: 'system', content: 'engine line' }, ...turn(3), ...turn(4)];
// The age is THE phrase every memory line uses (the dossier's, the epitaph's): 5 turns here.
const ageOf1 = describeTurnsAgo(messages, 1);

describe('RETRIEVED MEMORIES says when', () => {
    it('a stamped line ends with its age in turns; a stamp-less one prints no age; no transcript means no age', () => {
        const rows = [
            { text: 'The harbor road is flooded.', category: 'journal', location: 'Saltmere', atMessage: 1 },
            { text: 'Orsa keeps the countinghouse.', category: 'world_fact' },
            { text: 'I pay the reeve.', category: 'player', atMessage: messages.length },
        ];
        const block = buildRetrievedMemoriesBlock(rows, { messages });
        expect(ageOf1).toBe('5 turns ago');
        expect(block).toContain(`- [journal — recorded at: Saltmere] The harbor road is flooded. — ${ageOf1}`);
        expect(block).toContain('- [world_fact] Orsa keeps the countinghouse.\n');
        expect(block).not.toMatch(/countinghouse\. —/);
        expect(block).toContain('I pay the reeve. — just now');
        expect(block).not.toContain('0 turns ago');
        expect(block).toContain('A line\'s "N turns ago" is when it was recorded');

        const ageless = buildRetrievedMemoriesBlock(rows);
        expect(ageless).not.toContain('turns ago\n');
        expect(ageless).not.toContain('— just now');
    });

    it('the ceiling counts the age suffix: a row the suffix pushes over the ceiling is omitted, never clipped mid-age', () => {
        const long = 'x'.repeat(RETRIEVED_MEMORY_ROW_MAX);
        const rows = Array.from({ length: 16 }, (_, i) => ({ text: long, category: `c${i}`, atMessage: 1 }));
        const block = buildRetrievedMemoriesBlock(rows, { messages });
        const lines = block.split('\n').filter(line => line.startsWith('- ['));
        const used = lines.filter(line => !line.startsWith('- (+')).reduce((sum, line) => sum + line.length + 1, 0);
        expect(used).toBeLessThanOrEqual(RETRIEVED_MEMORIES_CHAR_CEILING);
        expect(block).toMatch(/\(\+\d+ more relevant memories omitted for length\)/);
        for (const line of lines) {
            if (!line.startsWith('- (+')) expect(line.endsWith(` — ${ageOf1}`)).toBe(true);
        }
    });
});
