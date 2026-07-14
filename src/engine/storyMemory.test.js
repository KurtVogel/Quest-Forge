import { describe, expect, it, vi } from 'vitest';
import {
    buildStoryMemoryPromptBlock,
    curateStoryMemory,
    findStoryMemoryMatch,
    isNearDuplicateStoryCard,
    normalizeStoryMemoryCard,
    normalizeStoryMemoryUpdate,
    pickMergedCardText,
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

describe('near-duplicate restatement detection (2026-07-14 eval flooding)', () => {
    // Real duplicate quartet from the 30-turn memory playtest: one promise,
    // four cards, every subject and text worded differently.
    const sundialA = {
        type: 'promise',
        subject: 'Sundial, Oren, Jack',
        text: "Jack's promise to Oren to mend the cracked sundial before the harvest.",
    };
    const sundialB = {
        type: 'promise',
        subject: 'Oren and the sundial',
        text: "Jack's promise to Oren to mend the cracked sundial, now amidst the escalating violence and Jack's abandonment of the orchard.",
    };
    const sundialC = {
        type: 'promise',
        subject: 'Oren, Jack, the sundial',
        text: "Jack's broken promise to Oren to mend the cracked sundial, now amidst the valley's collapse.",
    };

    it('recognizes the same promise restated with fresh framing', () => {
        expect(isNearDuplicateStoryCard(sundialA, sundialB)).toBe(true);
        expect(isNearDuplicateStoryCard(sundialB, sundialC)).toBe(true);
        expect(findStoryMemoryMatch([normalizeStoryMemoryCard(sundialA)], sundialB)).toBe(0);
    });

    it('recognizes a text-containment restatement with unrelated subjects', () => {
        const verbose = {
            type: 'npcAgenda',
            subject: 'barricade',
            text: 'The Rusted Raider explicitly stated he needs the player character alive to drop the barricade.',
        };
        const terse = {
            type: 'npcAgenda',
            subject: "raider's agenda",
            text: 'The raider needs the hero alive to drop the barricade.',
        };
        expect(isNearDuplicateStoryCard(verbose, terse)).toBe(true);
    });

    it('never merges across card types or genuinely different beats', () => {
        expect(isNearDuplicateStoryCard(sundialA, { ...sundialA, type: 'playerCanon' })).toBe(false);
        expect(isNearDuplicateStoryCard(
            { type: 'wound', subject: "hero's shoulder wound", text: 'The hero suffered a vicious axe wound to the shoulder, bleeding heavily.' },
            { type: 'wound', subject: "player's arm", text: 'The player suffered a brutal bite to the arm from the Scarred Hound.' },
        )).toBe(false);
        expect(isNearDuplicateStoryCard(
            { type: 'mystery', subject: 'Oren', text: 'The unseen archivist believes Oren is likely dead.' },
            { type: 'mystery', subject: 'orchard incident', text: 'Oren called out Jack’s name in disbelief just before hounds began baying.' },
        )).toBe(false);
    });

    it('keeps the richer text when a fragment restates an existing card', () => {
        const rich = 'The Greenhouse Raider intends to finish the job his crew started hours ago and secure the conservatory.';
        expect(pickMergedCardText(rich, 'Hooks: finish the job his crew started hours ago')).toBe(rich);
        expect(pickMergedCardText(rich, 'The raider now plans to torch the conservatory at dawn instead.'))
            .toBe('The raider now plans to torch the conservatory at dawn instead.');
        expect(pickMergedCardText('', 'anything')).toBe('anything');
        expect(pickMergedCardText(rich, '')).toBe(rich);
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

describe('normalizeStoryMemoryUpdate', () => {
    it('normalizes the full rewrite branches: text, subject, tags, linked NPCs, location', () => {
        const out = normalizeStoryMemoryUpdate({
            id: ' mem-1 ',
            text: '  Maren now knows the hero lied about Tanelorn.  ',
            subject: 'Tanelorn lie',
            tags: ['tanelorn', 'lie', 'tanelorn'],
            linked_npc_names: ['Maren'],
            location: 'Millhaven',
        });
        expect(out.id).toBe('mem-1');
        expect(out.text).toBe('Maren now knows the hero lied about Tanelorn.');
        expect(out.subject).toBe('Tanelorn lie');
        expect(out.tags).toContain('lie');
        expect(out.linkedNpcNames).toEqual(['Maren']);
        expect(out.location).toBe('Millhaven');
    });

    it('stamps lastUsedAt from used:true and clamps salience/emotionalCharge', () => {
        const before = Date.now();
        const out = normalizeStoryMemoryUpdate({ id: 'mem-1', used: true, salience: 99, emotional_charge: -4 });
        expect(out.lastUsedAt).toBeGreaterThanOrEqual(before);
        expect(out.salience).toBe(5);
        expect(out.emotionalCharge).toBe(0);
    });

    it('ignores a raw lastUsedAt override — the engine owns the cooldown clock', () => {
        const farFuture = Date.now() + 1000 * 60 * 60 * 24 * 365;
        const withUsed = normalizeStoryMemoryUpdate({ id: 'mem-1', used: true, lastUsedAt: farFuture });
        expect(withUsed.lastUsedAt).toBeLessThan(farFuture);
        const withoutUsed = normalizeStoryMemoryUpdate({ id: 'mem-1', last_used_at: farFuture, status: 'active' });
        expect(withoutUsed.lastUsedAt).toBeUndefined();
    });

    it('drops unknown statuses and returns null without any identity', () => {
        expect(normalizeStoryMemoryUpdate({ id: 'mem-1', status: 'exploded' }).status).toBeUndefined();
        expect(normalizeStoryMemoryUpdate({ status: 'resolved' })).toBe(null);
        expect(normalizeStoryMemoryUpdate(null)).toBe(null);
        expect(normalizeStoryMemoryUpdate('mem-1')).toBe(null);
    });
});
