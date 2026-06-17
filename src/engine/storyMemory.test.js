import { describe, expect, it, vi } from 'vitest';
import {
    buildStoryMemoryPromptBlock,
    curateStoryMemory,
    findStoryMemoryMatch,
    normalizeStoryMemoryCard,
} from './storyMemory.js';

describe('story memory normalization', () => {
    it('normalizes compact callback cards and clamps scores', () => {
        const card = normalizeStoryMemoryCard({
            type: 'promise',
            text: '  Mira promised to leave a blue ribbon if the well road became unsafe.  ',
            subject: 'Mira ribbon',
            tags: ['Mira', 'promise', 'Mira'],
            salience: 99,
            emotional_charge: -4,
            linked_npc_names: ['Mira'],
            location: 'Millhaven',
        });

        expect(card).toMatchObject({
            type: 'promise',
            text: 'Mira promised to leave a blue ribbon if the well road became unsafe.',
            subject: 'Mira ribbon',
            tags: ['Mira', 'promise'],
            salience: 5,
            emotionalCharge: 0,
            linkedNpcNames: ['Mira'],
            location: 'Millhaven',
            status: 'active',
        });
    });

    it('dedupes by exact text or same subject/type', () => {
        const existing = [
            normalizeStoryMemoryCard({ type: 'wound', subject: 'black arrow scar', text: 'The black arrow left a scar.' }),
        ];
        expect(findStoryMemoryMatch(existing, { type: 'wound', subject: 'black arrow scar', text: 'Different wording.' })).toBe(0);
        expect(findStoryMemoryMatch(existing, { type: 'callback', subject: 'other', text: 'The black arrow left a scar.' })).toBe(0);
    });
});

describe('story memory curation', () => {
    it('scores by relevance, emotional charge, location, NPC, and suppresses cooldown/resolved cards', () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-06-17T12:00:00Z'));
        const now = Date.now();
        const memories = [
            normalizeStoryMemoryCard({
                type: 'promise',
                subject: 'Mira ribbon',
                text: 'Mira promised to leave a blue ribbon if the well road became unsafe.',
                tags: ['ribbon', 'well'],
                salience: 3,
                emotionalCharge: 4,
                linkedNpcNames: ['Mira'],
                location: 'Millhaven',
                lastSeenAt: now,
            }),
            normalizeStoryMemoryCard({
                type: 'callback',
                subject: 'old stew',
                text: 'The inn once served thin onion stew.',
                salience: 1,
                emotionalCharge: 0,
            }),
            normalizeStoryMemoryCard({
                type: 'mystery',
                subject: 'freshly used',
                text: 'This was just recalled.',
                lastUsedAt: now,
                salience: 5,
            }),
            normalizeStoryMemoryCard({
                type: 'wound',
                subject: 'resolved scar',
                text: 'Resolved memory.',
                status: 'resolved',
                salience: 5,
            }),
        ];

        const curated = curateStoryMemory({
            memories,
            query: 'I search the well road for Mira and any sign of a ribbon.',
            location: 'Millhaven',
            npcs: [{ name: 'Mira' }],
            now,
        });

        expect(curated[0].subject).toBe('Mira ribbon');
        expect(curated.map(m => m.subject)).not.toContain('freshly used');
        expect(curated.map(m => m.subject)).not.toContain('resolved scar');
        vi.useRealTimers();
    });

    it('builds a bounded prompt block with callback guidance', () => {
        const cards = Array.from({ length: 7 }, (_, i) => normalizeStoryMemoryCard({
            type: 'callback',
            subject: `Memory ${i}`,
            text: `Callback ${i}`,
            salience: 3,
        }));

        const block = buildStoryMemoryPromptBlock(cards);
        expect(block).toContain('## DRAMATIC CALLBACK OPPORTUNITIES');
        expect(block).toContain('Use at most ONE naturally');
        expect(block).toContain('Callback 0');
        expect(block).not.toContain('Callback 6');
    });
});
