import { describe, expect, it, vi } from 'vitest';
import {
    buildStoryMemoryPromptBlock,
    curateStoryMemory,
    findStoryMemoryMatch,
    mergeStoryCards,
    normalizeStoryMemoryCard,
    normalizeStoryMemoryUpdate,
    pickMergedCardText,
    possibleSameCardPairs,
    scoreStoryMemory,
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

    // Flipped 2026-11-08 (identity by reference, lane 8): the exact text under
    // the SAME type is the one text rung; a shared subject is not identity,
    // and the same words under another type are another card.
    it('dedupes by the exact text under the same type; a same subject or another type is a new card', () => {
        const existing = [
            normalizeStoryMemoryCard({ type: 'wound', subject: 'black arrow scar', text: 'The black arrow left a scar.' }),
        ];
        expect(findStoryMemoryMatch(existing, { type: 'wound', subject: 'black arrow scar', text: 'Different wording.' })).toBe(-1);
        expect(findStoryMemoryMatch(existing, { type: 'callback', subject: 'other', text: 'The black arrow left a scar.' })).toBe(-1);
        expect(findStoryMemoryMatch(existing, { type: 'wound', subject: 'other', text: 'the black arrow left a scar.' })).toBe(0);
        expect(findStoryMemoryMatch(existing, { id: existing[0].id, type: 'wound', subject: 'x', text: 'Different wording.' })).toBe(0);
    });
});

// Flipped 2026-11-08 (lane 8): a restatement in other words is a NEW card at
// the reducer; the pair is offered to the cadence reflection (possibleSameCardPairs),
// whose merge_cards answer folds them by id (mergeStoryCards).
describe('a restatement in other words is a new card; the reflection is offered the pair (was: near-duplicate detection, 2026-07-14)', () => {
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

    it('the same promise restated with fresh framing is a new card at the reducer', () => {
        const held = normalizeStoryMemoryCard({ ...sundialA, id: 'c-a', firstSeenMessage: 4 });
        expect(findStoryMemoryMatch([held], sundialB)).toBe(-1);
        expect(findStoryMemoryMatch([held], { ...sundialB, id: 'c-a' })).toBe(0); // the id the Scribe echoes decides
    });

    it('the reflection is offered the pair (same type, shared meaning), never a cross-type or an unrelated pair', () => {
        const a = normalizeStoryMemoryCard({ ...sundialA, id: 'c-a', firstSeenMessage: 4, lastSeenMessage: 4 });
        const b = normalizeStoryMemoryCard({ ...sundialB, id: 'c-b', firstSeenMessage: 30, lastSeenMessage: 30 });
        const c = normalizeStoryMemoryCard({ ...sundialC, id: 'c-c', type: 'playerCanon', firstSeenMessage: 40 });
        const bite = normalizeStoryMemoryCard({ id: 'c-bite', type: 'promise', subject: "player's arm", text: 'The player suffered a brutal bite to the arm from the Scarred Hound.', firstSeenMessage: 50 });
        expect(possibleSameCardPairs([a, b, c, bite])).toEqual([{ ids: ['c-a', 'c-b'], type: 'promise', texts: [a.text, b.text] }]);
        // Resolved, engine and roster-snapshot cards are never offered.
        expect(possibleSameCardPairs([{ ...a, status: 'resolved' }, b])).toEqual([]);
        expect(possibleSameCardPairs([{ ...a, source: 'engine' }, b])).toEqual([]);
        expect(possibleSameCardPairs([{ ...a, source: 'npc_roster' }, b])).toEqual([]);
    });

    it('mergeStoryCards folds the reflection\'s answer by id: the longer text, the higher scores, the unions, the spanned stamps', () => {
        const a = normalizeStoryMemoryCard({ ...sundialA, id: 'c-a', salience: 3, emotionalCharge: 1, tags: ['promise'], linkedNpcNames: ['Oren'], firstSeenMessage: 4, lastSeenMessage: 4, sourceMessage: 'm4' });
        const b = normalizeStoryMemoryCard({ ...sundialB, id: 'c-b', salience: 4, emotionalCharge: 2, tags: ['sundial'], linkedNpcNames: ['Jack'], firstSeenMessage: 30, lastSeenMessage: 30, sourceMessage: 'm30' });
        const other = normalizeStoryMemoryCard({ id: 'c-x', type: 'mystery', text: 'Who rang the chapel bell?' });
        const merged = mergeStoryCards([a, b, other], 'c-a', 'c-b');
        expect(merged.map(card => card.id)).toEqual(['c-a', 'c-x']);
        expect(merged[0]).toMatchObject({ id: 'c-a', text: sundialB.text, salience: 4, emotionalCharge: 2, firstSeenMessage: 4, lastSeenMessage: 30, sourceMessage: 'm4', witnesses: ['m30'] });
        expect(merged[0].tags).toEqual(expect.arrayContaining(['promise', 'sundial']));
        expect(merged[0].linkedNpcNames).toEqual(['Oren', 'Jack']);
        // A resolved half resolves the beat; a public half makes it public.
        expect(mergeStoryCards([a, { ...b, status: 'resolved' }], 'c-a', 'c-b')[0].status).toBe('resolved');
        expect(mergeStoryCards([{ ...a, knownBy: ['Oren'] }, b], 'c-a', 'c-b')[0].knownBy).toBeUndefined();
        expect(mergeStoryCards([{ ...a, knownBy: ['Oren'] }, { ...b, knownBy: ['Jack'] }], 'c-a', 'c-b')[0].knownBy).toEqual(['Oren', 'Jack']);
        // Unknown or equal ids leave the pool alone.
        const pool = [a, b];
        expect(mergeStoryCards(pool, 'c-a', 'nope')).toBe(pool);
        expect(mergeStoryCards(pool, 'c-a', 'c-a')).toBe(pool);
    });

    it('a re-report keeps the LONGER text — plain length, no fragment guard reading the words (lane 8)', () => {
        const rich = 'The Greenhouse Raider intends to finish the job his crew started hours ago and secure the conservatory.';
        expect(pickMergedCardText(rich, 'Hooks: finish the job his crew started hours ago')).toBe(rich);
        // A shorter text in other words no longer replaces (the old guard let it).
        expect(pickMergedCardText(rich, 'The raider now plans to torch the conservatory at dawn instead.')).toBe(rich);
        const longer = 'The Greenhouse Raider intends to finish the job his crew started hours ago, secure the conservatory and torch it at dawn.';
        expect(pickMergedCardText(rich, longer)).toBe(longer);
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
        expect(block).toContain('could say it: the hero (a passing thought)');
        expect(block).toContain('Callback 0');
        expect(block).not.toContain('Callback 6');
    });
});

describe('normalizeStoryMemoryUpdate', () => {
    it('carries id / subject / text as LOOKUP keys and drops tags, linked NPCs, location (the DM lane is a status channel, 2026-10-24)', () => {
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
        expect(out.tags).toBeUndefined();
        expect(out.linkedNpcNames).toBeUndefined();
        expect(out.location).toBeUndefined();
    });

    it('carries used:true as a FLAG (the reducer stamps the clocks) and clamps salience/emotionalCharge', () => {
        const out = normalizeStoryMemoryUpdate({ id: 'mem-1', used: true, salience: 99, emotional_charge: -4 });
        expect(out.used).toBe(true);
        expect(out.lastUsedAt).toBeUndefined();
        expect(out.salience).toBe(5);
        expect(out.emotionalCharge).toBe(0);
        // A worded false is not a use (2026-10-12, read through toFlag).
        expect(normalizeStoryMemoryUpdate({ id: 'mem-1', used: 'false' }).used).toBeUndefined();
    });

    it('ignores a raw lastUsedAt override — the engine owns the cooldown clock', () => {
        const farFuture = Date.now() + 1000 * 60 * 60 * 24 * 365;
        const withUsed = normalizeStoryMemoryUpdate({ id: 'mem-1', used: true, lastUsedAt: farFuture });
        expect(withUsed.lastUsedAt).toBeUndefined();
        const withoutUsed = normalizeStoryMemoryUpdate({ id: 'mem-1', last_used_at: farFuture, status: 'active' });
        expect(withoutUsed.lastUsedAt).toBeUndefined();
        expect(withoutUsed.used).toBeUndefined();
    });

    it('drops unknown statuses and returns null without any identity', () => {
        expect(normalizeStoryMemoryUpdate({ id: 'mem-1', status: 'exploded' }).status).toBeUndefined();
        expect(normalizeStoryMemoryUpdate({ status: 'resolved' })).toBe(null);
        expect(normalizeStoryMemoryUpdate(null)).toBe(null);
        expect(normalizeStoryMemoryUpdate('mem-1')).toBe(null);
    });
});

describe('exported read-path guards (2026-07-28 audit)', () => {
    it('scoreStoryMemory tolerates string-valued tags/linkedNpcNames without throwing', () => {
        const score = scoreStoryMemory({
            type: 'promise',
            status: 'active',
            text: 'Aune promised safe passage across the ferry line.',
            subject: 'ferry promise',
            salience: 3,
            emotionalCharge: 2,
            tags: 'ferry',
            linkedNpcNames: 'Aune',
        }, { query: 'the ferry line', npcs: [{ name: 'Aune' }] });

        expect(Number.isFinite(score)).toBe(true);
        expect(score).toBeGreaterThan(0);
    });

    it('buildStoryMemoryPromptBlock skips a non-array linkedNpcNames instead of throwing on .join', () => {
        const block = buildStoryMemoryPromptBlock([{
            type: 'promise',
            salience: 3,
            text: 'Aune promised safe passage.',
            // A string is truthy and has .length — but no .join.
            linkedNpcNames: 'Aune',
        }]);

        expect(block).toContain('Aune promised safe passage.');
        expect(block).not.toContain('NPCs:');
    });
});

describe('normalizeStoryMemoryCard two-arg merge (existing-preserve branches)', () => {
    const existing = normalizeStoryMemoryCard({
        id: 'mem-1',
        type: 'promise',
        text: 'Jack promised Oren a barge by midsummer.',
        subject: "Jack's promise to Oren",
        salience: 4,
        emotionalCharge: 3,
        status: 'dormant',
        source: 'scribe',
        location: 'the ferry landing',
        firstSeenAt: 1000,
        lastUsedAt: 2000,
    });

    it('an update carrying only new text keeps every durable field from the existing card', () => {
        const merged = normalizeStoryMemoryCard({ text: 'Jack broke his promise to Oren.' }, existing);

        expect(merged).toMatchObject({
            id: 'mem-1',
            type: 'promise',
            text: 'Jack broke his promise to Oren.',
            subject: "Jack's promise to Oren",
            salience: 4,
            emotionalCharge: 3,
            status: 'dormant',
            source: 'scribe',
            location: 'the ferry landing',
            firstSeenAt: 1000,
            lastUsedAt: 2000,
        });
    });

    it('an empty update falls back to the existing text instead of nulling the card', () => {
        const merged = normalizeStoryMemoryCard({}, existing);
        expect(merged.text).toBe('Jack promised Oren a barge by midsummer.');
        expect(merged.id).toBe('mem-1');
    });

    it('explicit update fields still win over the existing card', () => {
        const merged = normalizeStoryMemoryCard({ status: 'resolved', salience: 2, location: 'Kuusisaari' }, existing);
        expect(merged.status).toBe('resolved');
        expect(merged.salience).toBe(2);
        expect(merged.location).toBe('Kuusisaari');
    });
});

describe('scene-driven curation and conversational windows (2026-09-06 audit)', () => {
    const celeste = normalizeStoryMemoryCard({
        type: 'relationship',
        subject: 'Celeste floorboard letter',
        text: 'Celeste hid a letter under the parlour floorboard for the hero.',
        salience: 3,
        emotionalCharge: 2,
        linkedNpcNames: ['Celeste'],
        location: 'Parlour',
    });
    const smuggler = normalizeStoryMemoryCard({
        type: 'npcAgenda',
        subject: 'Vasko smuggling run',
        text: 'Vasko plans to run contraband past the toll gate at the new moon.',
        salience: 3,
        emotionalCharge: 2,
        linkedNpcNames: ['Vasko'],
        location: 'Toll gate',
    });
    const scene = { query: 'I ask Celeste about the ledger.', location: 'Parlour' };
    const transcript = (n) => Array.from({ length: n }, (_, i) => ({
        role: i % 2 ? 'assistant' : 'user', content: `line ${i}`,
    }));

    it('the linked-NPC bonus fires only for NPCs PRESENT in the scene — an absent person earns nothing', () => {
        const absent = scoreStoryMemory(smuggler, { ...scene, npcs: [] });
        // Celeste is present; Vasko is two towns away: no bonus for his card.
        // toBeCloseTo: the wall-clock recency term drifts between two calls across a ms boundary.
        expect(scoreStoryMemory(smuggler, { ...scene, npcs: [{ name: 'Celeste' }] })).toBeCloseTo(absent, 5);
        // Present: +5 for the linked person, and his name joins the query tokens (+3 overlap).
        expect(scoreStoryMemory(smuggler, { ...scene, npcs: [{ name: 'Vasko' }] })).toBeCloseTo(absent + 8, 5);
        // And the person the hero is talking to outscores the absent smuggler.
        const curated = curateStoryMemory({ memories: [smuggler, celeste], ...scene, npcs: [{ name: 'Celeste' }] });
        expect(curated[0].subject).toBe('Celeste floorboard letter');
    });

    it('roster dispositions and notes no longer feed the query tokens', () => {
        // One clock for both calls: the score's legacy recency term reads
        // `now` (default Date.now()), so two calls a millisecond apart could
        // differ in the last float digit and fail this exact comparison about
        // one run in five (found 2026-10-04).
        const now = Date.now();
        const plain = scoreStoryMemory(smuggler, { ...scene, now, npcs: [{ name: 'Celeste' }] });
        const noisy = scoreStoryMemory(smuggler, {
            ...scene,
            now,
            npcs: [{ name: 'Celeste', disposition: 'wary', lastNotes: 'Mentioned contraband, the toll gate, and the new moon smuggling run.' }],
        });
        expect(noisy).toBe(plain);
    });

    it('the callback cooldown is measured in conversational messages when the card carries a use stamp', () => {
        // Seen at 10 (past the DM window by the time it is checked), paid off at 40.
        const card = { ...celeste, lastUsedMessage: 40, lastSeenMessage: 10 };
        // Four conversational messages since the DM paid it off: still cooling.
        expect(scoreStoryMemory(card, { query: 'x', messages: transcript(44) })).toBe(0);
        // System lines and hidden rows never age the window (the ledger rule).
        const padded = [
            ...transcript(44),
            ...Array.from({ length: 10 }, () => ({ role: 'system', content: 'Rolled 12.' })),
            { role: 'user', content: 'withheld setup', hidden: true },
        ];
        expect(scoreStoryMemory(card, { query: 'x', messages: padded })).toBe(0);
        // Eight conversational messages later the card is eligible again.
        expect(scoreStoryMemory(card, { query: 'x', messages: transcript(48) })).toBeGreaterThan(0);
        // Without the transcript the raw index gap is the fallback measure.
        expect(scoreStoryMemory(card, { query: 'x', messageCount: 44 })).toBe(0);
        expect(scoreStoryMemory(card, { query: 'x', messageCount: 48 })).toBeGreaterThan(0);
    });

    it('a card inside the DM window scores 0 and the age bonus grows to +3 past it (WOW 2026-10-14 inverted the recency term)', () => {
        const stamped = { ...celeste, lastSeenMessage: 18 };
        expect(scoreStoryMemory(stamped, { query: 'x', messages: transcript(18) })).toBe(0);
        const edge = scoreStoryMemory(stamped, { query: 'x', messages: transcript(38) });
        const stale = scoreStoryMemory(stamped, { query: 'x', messages: transcript(110) });
        expect(edge).toBeGreaterThan(0);
        expect(stale - edge).toBeCloseTo(3, 5);
    });

    it('legacy cards without message stamps fall back to their wall-clock stamps', () => {
        const now = Date.now();
        const justUsed = { ...celeste, lastUsedAt: now - 60_000 };
        expect(scoreStoryMemory(justUsed, { query: 'x', now, messages: transcript(40) })).toBe(0);
        const longAgo = { ...celeste, lastUsedAt: now - 1000 * 60 * 60 };
        expect(scoreStoryMemory(longAgo, { query: 'x', now, messages: transcript(40) })).toBeGreaterThan(0);
    });
});
